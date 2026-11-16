import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  StepForward,
  Download,
  BarChart3,
  Flame,
  Zap,
  ShieldAlert,
  Sparkles,
  FileText,
  Compass,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import { RunningMoments, TrimSimulator } from '../physics/trim';
import { calcEsumAnalysis, calcTransmitAnalysis } from '../physics/pral';
import { generateAllTrimOutputs } from '../physics/formats';
import { generateSvgLinePlot, generateCsvData, downloadFile } from '../physics/exportUtils';
import {
  buildGpuStoppingTable,
  isWebGpuSupported,
  WebGpuTrimRunner,
} from '../physics/webgpuTrim';
import {
  DEFAULT_ADVANCED_PHYSICS,
  inferCrystalPresetForLayer,
} from '../physics/advancedPhysics';
import { TrajectoryViewer3D } from './TrajectoryViewer3D';
import { ContourMap2D } from './ContourMap2D';
import type {
  CrystalOrientation,
  ScreeningPotentialType,
  TrimAdvancedPhysicsConfig,
  TrimSetupConfig,
  TrimSnapshot,
} from '../physics/types';
import type { TrimWorkerRequest, TrimWorkerResponse } from '../workers/trim.worker';

interface TrimCockpitProps {
  config: TrimSetupConfig;
  onUpdateConfig?: (next: TrimSetupConfig) => void;
  onUpdateTotalIons?: (totalIons: number) => void;
}

type CockpitTab =
  | 'range'
  | 'contour2d'
  | 'vacancies'
  | 'ionization'
  | 'phonons'
  | 'recoilLateral'
  | 'sputtering'
  | 'esum'
  | 'transmit'
  | 'outputs';

export const TrimCockpit: React.FC<TrimCockpitProps> = ({
  config,
  onUpdateConfig,
  onUpdateTotalIons,
}) => {
  const simRef = useRef<TrimSimulator>(new TrimSimulator(config));
  const workerRef = useRef<Worker | null>(null);
  const gpuRunnerRef = useRef<WebGpuTrimRunner | null>(null);

  const [snapshot, setSnapshot] = useState<TrimSnapshot>(() =>
    simRef.current.getSnapshot()
  );
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [batchSpeed, setBatchSpeed] = useState<number>(100);
  const [activeTab, setActiveTab] = useState<CockpitTab>('range');
  const [transmitBinWidthDeg, setTransmitBinWidthDeg] = useState<number>(2.0);
  const [selectedTxtFile, setSelectedTxtFile] = useState<string>('TDATA.TXT');

  // WebGPU state
  const [gpuSupported, setGpuSupported] = useState<boolean>(false);
  const [webGpuEnabled, setWebGpuEnabled] = useState<boolean>(false);

  const configRef = useRef(config);
  configRef.current = config;
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;
  const batchSpeedRef = useRef(batchSpeed);
  batchSpeedRef.current = batchSpeed;
  const webGpuEnabledRef = useRef(webGpuEnabled);
  webGpuEnabledRef.current = webGpuEnabled;
  const inFlightRef = useRef<boolean>(false);
  const completedIonsRef = useRef<number>(snapshot.completedIons);
  completedIonsRef.current = snapshot.completedIons;

  const gpuAccumRef = useRef({
    ionizEv: 0,
    phononEv: 0,
    bindingEv: 0,
    vacancies: 0,
    absLatM: new RunningMoments(),
    latM: new RunningMoments(),
    radM: new RunningMoments(),
  });

  const resetGpuAccum = () => {
    gpuAccumRef.current = {
      ionizEv: 0,
      phononEv: 0,
      bindingEv: 0,
      vacancies: 0,
      absLatM: new RunningMoments(),
      latM: new RunningMoments(),
      radM: new RunningMoments(),
    };
  };

  useEffect(() => {
    setGpuSupported(isWebGpuSupported());
  }, []);

  // Structural simulation key excluding totalIons so raising target ions up to 1,000,000 preserves progress
  const structuralSimKey = useMemo(
    () =>
      JSON.stringify({
        ion: config.ion,
        calculationMode: config.calculationMode,
        randomSeed: config.randomSeed,
        braggCorrection: config.braggCorrection,
        plotXMinA: config.plotXMinA,
        plotXMaxA: config.plotXMaxA,
        layers: config.layers,
        customTrimDatEvents: config.customTrimDatEvents,
        advancedPhysics: config.advancedPhysics,
      }),
    [config]
  );

  // Precompute exact tabulated SCOEF03 Se(E) LUT for full-fidelity WebGPU dispatch
  const gpuLut = useMemo(() => buildGpuStoppingTable(config), [config]);

  const activeAdvPhysics: TrimAdvancedPhysicsConfig = useMemo(() => {
    if (config.advancedPhysics) return config.advancedPhysics;
    const l0 = config.layers[0];
    const inf = inferCrystalPresetForLayer(l0?.name || 'Si', l0?.elements[0]?.z || 14);
    return {
      ...DEFAULT_ADVANCED_PHYSICS,
      crystalLattice: inf.lattice,
      latticeConstantA: inf.aA,
      latticeCConstantA: inf.cA,
      debyeTempK: inf.debyeTempK,
    };
  }, [config.advancedPhysics, config.layers]);

  const updateAdvPhysics = (patch: Partial<TrimAdvancedPhysicsConfig>) => {
    if (!onUpdateConfig) return;
    onUpdateConfig({
      ...config,
      advancedPhysics: {
        ...activeAdvPhysics,
        ...patch,
      },
    });
  };

  // Sync totalIons updates mid-run without resetting completed ions (both CPU worker & active WebGPU state)
  useEffect(() => {
    if (webGpuEnabledRef.current) {
      setSnapshot((prev) => ({ ...prev, totalIons: config.totalIons }));
    } else if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'SET_TOTAL_IONS',
        totalIons: config.totalIons,
      } satisfies TrimWorkerRequest);
    } else {
      simRef.current.setTotalIons(config.totalIons);
      setSnapshot(simRef.current.getSnapshot());
    }
  }, [config.totalIons]);

  // Re-initialize simulator or worker only when structural target/ion/physics config changes
  useEffect(() => {
    setIsRunning(false);
    inFlightRef.current = false;
    resetGpuAccum();
    const activeConfig = configRef.current;

    try {
      if (typeof Worker !== 'undefined') {
        const w = new Worker(
          new URL('../workers/trim.worker.ts', import.meta.url),
          { type: 'module' }
        );
        w.onmessage = (e: MessageEvent<TrimWorkerResponse>) => {
          inFlightRef.current = false;
          if (e.data?.type === 'SNAPSHOT') {
            const snap = e.data.snapshot;
            setSnapshot(snap);
            if (snap.completedIons >= configRef.current.totalIons) {
              setIsRunning(false);
            } else if (isRunningRef.current && !webGpuEnabledRef.current) {
              const remaining = configRef.current.totalIons - snap.completedIons;
              const nextBatch = Math.max(
                1,
                Math.min(batchSpeedRef.current, remaining)
              );
              window.setTimeout(() => {
                if (
                  workerRef.current === w &&
                  isRunningRef.current &&
                  !webGpuEnabledRef.current &&
                  !inFlightRef.current
                ) {
                  inFlightRef.current = true;
                  w.postMessage({
                    type: 'RUN_BATCH',
                    count: nextBatch,
                  } satisfies TrimWorkerRequest);
                }
              }, 8);
            }
          }
        };
        workerRef.current = w;
        w.postMessage({
          type: 'INIT',
          config: activeConfig,
        } satisfies TrimWorkerRequest);
        // Run initial preview batch
        const initialCount = Math.min(25, activeConfig.totalIons);
        inFlightRef.current = true;
        w.postMessage({
          type: 'RUN_BATCH',
          count: initialCount,
        } satisfies TrimWorkerRequest);
      }
    } catch {
      workerRef.current = null;
      inFlightRef.current = false;
    }

    if (!workerRef.current) {
      simRef.current = new TrimSimulator(activeConfig);
      const initialCount = Math.min(25, activeConfig.totalIons);
      setSnapshot(simRef.current.runBatch(initialCount));
    }

    return () => {
      inFlightRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [structuralSimKey]);

  const handleToggleWebGpu = async () => {
    if (!webGpuEnabled) {
      if (!gpuRunnerRef.current) {
        gpuRunnerRef.current = new WebGpuTrimRunner();
      }
      if (!gpuRunnerRef.current.ready) {
        const ok = await gpuRunnerRef.current.init();
        if (ok) {
          setWebGpuEnabled(true);
        } else {
          setGpuSupported(false);
          setWebGpuEnabled(false);
        }
      } else {
        setWebGpuEnabled(true);
      }
    } else {
      setWebGpuEnabled(false);
    }
  };

  // Start / resume Monte Carlo loop when isRunning flips true
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;
    let timerId = 0;

    const kickLoop = () => {
      if (cancelled || !isRunningRef.current) return;
      const remaining = configRef.current.totalIons - completedIonsRef.current;
      if (remaining <= 0) {
        setIsRunning(false);
        return;
      }

      if (webGpuEnabledRef.current && gpuRunnerRef.current?.ready) {
        const requestedGpuBatch = Math.max(
          batchSpeedRef.current,
          configRef.current.totalIons >= 10000 ? 1000 : batchSpeedRef.current
        );
        const dispatchCount = Math.max(1, Math.min(requestedGpuBatch, remaining));
        const l0 = configRef.current.layers[0];
        const el0 = l0?.elements[0];
        const totalW =
          configRef.current.layers.reduce((a, b) => a + b.widthA, 0) || 1000;
        const potCode =
          activeAdvPhysics.screeningPotential === 'krc'
            ? 1
            : activeAdvPhysics.screeningPotential === 'moliere'
            ? 2
            : 0;
        gpuRunnerRef.current
          .runBatch(dispatchCount, {
            z1: configRef.current.ion.z1,
            m1: configRef.current.ion.massAmu,
            energyEv: configRef.current.ion.energyKeV * 1000.0,
            angleRad: (configRef.current.ion.angleDeg * Math.PI) / 180.0,
            z2: gpuLut.meanZ2 || el0?.z || 14,
            m2: gpuLut.meanM2 || el0?.massAmu || 28.086,
            atomDensityA3: gpuLut.atomDensityA3 || 0.05,
            targetWidthA: totalW,
            edEv: el0?.displacementEv || 15,
            esEv: el0?.surfaceBindingEv || 2.1,
            binWidthA: snapshot.binWidthA || 10,
            seTable: gpuLut.seTable,
            potentialCode: potCode,
          })
          .then((res) => {
            if (cancelled) return;
            const gAcc = gpuAccumRef.current;
            gAcc.ionizEv += res.totalIonizEv;
            gAcc.phononEv += res.totalPhononEv;
            gAcc.bindingEv += res.totalBindingEv;
            gAcc.vacancies += res.totalVacancies;

            // Update lateral & radial moments from stopped (fate===0) ions in GPU batch
            for (let i = 0; i < res.stoppedX.length; i++) {
              if ((res.stoppedFate[i] ?? 0) === 0) {
                const yA = res.stoppedY[i];
                const zA = res.stoppedZ[i];
                gAcc.absLatM.push(Math.abs(yA));
                gAcc.latM.push(yA);
                gAcc.radM.push(Math.sqrt(yA * yA + zA * zA));
              }
            }

            let finishedTarget = false;
            setSnapshot((prev) => {
              const prevCompleted = prev.completedIons;
              const nextCompleted = Math.min(
                configRef.current.totalIons,
                prevCompleted + dispatchCount
              );
              completedIonsRef.current = nextCompleted;
              finishedTarget = nextCompleted >= configRef.current.totalIons;

              const totalStopped = prev.stoppedCount + res.stoppedCount;
              const newStoppedIons = [...prev.stoppedIons];
              let seenStopped = prev.stoppedCount;
              for (let i = 0; i < res.stoppedX.length; i++) {
                if ((res.stoppedFate[i] ?? 0) !== 0) continue;
                seenStopped++;
                const rec = {
                  ionNumber: prevCompleted + i + 1,
                  z1: configRef.current.ion.z1,
                  energyEv: 0,
                  xA: res.stoppedX[i],
                  yA: res.stoppedY[i],
                  zA: res.stoppedZ[i],
                  cosX: 1,
                  cosY: 0,
                  cosZ: 0,
                };
                if (newStoppedIons.length < 4000) {
                  newStoppedIons.push(rec);
                } else {
                  const rIdx = Math.floor(Math.random() * seenStopped);
                  if (rIdx < 4000) newStoppedIons[rIdx] = rec;
                }
              }

              // Merge real 3D trajectories generated on GPU (up to 500 via reservoir sampling)
              const nextTrajectories = [...prev.trajectories];
              let seenTracks = prevCompleted;
              for (let t = 0; t < res.sampleTracks.length; t++) {
                seenTracks++;
                const tr = {
                  ...res.sampleTracks[t],
                  ionNumber: prevCompleted + t + 1,
                };
                if (nextTrajectories.length < 500) {
                  nextTrajectories.push(tr);
                } else {
                  const rIdx = Math.floor(Math.random() * seenTracks);
                  if (rIdx < 500) nextTrajectories[rIdx] = tr;
                }
              }

              const bw = Math.max(0.1, prev.binWidthA);
              const oldRangeNorm = 1e8 / (Math.max(1, prevCompleted) * bw);
              const newRangeNorm = 1e8 / (Math.max(1, nextCompleted) * bw);
              const mergedRangeCounts = prev.histograms.ionRange.map(
                (oldVal, b) =>
                  (prevCompleted > 0 ? oldVal / oldRangeNorm : 0) +
                  (res.rangeHist[b] || 0)
              );
              const mergedRangeHist = mergedRangeCounts.map(
                (c) => c * newRangeNorm
              );

              const oldDepthNorm = 1.0 / (Math.max(1, prevCompleted) * bw);
              const newDepthNorm = 1.0 / (Math.max(1, nextCompleted) * bw);
              const mergeDepthArr = (oldArr: number[], addArr: number[]) =>
                oldArr.map(
                  (oldVal, b) =>
                    ((prevCompleted > 0 ? oldVal / oldDepthNorm : 0) +
                      (addArr[b] || 0)) *
                    newDepthNorm
                );

              const nextIonizHist = mergeDepthArr(
                prev.histograms.ionizationIon,
                res.ionizationHist
              );
              const nextPhononHist = mergeDepthArr(
                prev.histograms.phononsIon,
                res.phononHist
              );
              const nextVacHist = mergeDepthArr(
                prev.histograms.vacanciesIon,
                res.vacancyHist
              );

              let countSum = 0;
              let sumX = 0;
              for (let b = 0; b < mergedRangeCounts.length; b++) {
                countSum += mergedRangeCounts[b];
                sumX += mergedRangeCounts[b] * (prev.binDepthsA[b] || 0);
              }
              const meanA =
                countSum > 0 ? sumX / countSum : prev.rangeMoments.meanA;
              let m2 = 0;
              let m3 = 0;
              let m4 = 0;
              if (countSum > 0) {
                for (let b = 0; b < mergedRangeCounts.length; b++) {
                  const d = (prev.binDepthsA[b] || 0) - meanA;
                  const c = mergedRangeCounts[b];
                  m2 += c * d * d;
                  m3 += c * d * d * d;
                  m4 += c * d * d * d * d;
                }
                m2 /= countSum;
                m3 /= countSum;
                m4 /= countSum;
              }
              const stragglingA = Math.sqrt(Math.max(0, m2));
              const skewness =
                stragglingA > 1e-9 ? m3 / Math.pow(stragglingA, 3) : 0;
              const kurtosis =
                stragglingA > 1e-9 ? m4 / Math.pow(stragglingA, 4) : 3;

              const absLatRes = gAcc.absLatM.getMoments();
              const latRes = gAcc.latM.getMoments();
              const radRes = gAcc.radM.getMoments();

              const totalGpuLoss = Math.max(
                1.0,
                gAcc.ionizEv + gAcc.phononEv + gAcc.bindingEv
              );

              return {
                ...prev,
                completedIons: nextCompleted,
                stoppedCount: totalStopped,
                backscatteredCount: prev.backscatteredCount + res.backscatterCount,
                transmittedCount: prev.transmittedCount + res.transmitCount,
                stoppedPct: (totalStopped * 100) / Math.max(1, nextCompleted),
                backscatteredPct:
                  ((prev.backscatteredCount + res.backscatterCount) * 100) /
                  Math.max(1, nextCompleted),
                transmittedPct:
                  ((prev.transmittedCount + res.transmitCount) * 100) /
                  Math.max(1, nextCompleted),
                totalVacancies: gAcc.vacancies,
                totalDisplacements: gAcc.vacancies,
                totalInterstitials: gAcc.vacancies,
                vacanciesPerIon: gAcc.vacancies / Math.max(1, nextCompleted),
                displacementsPerIon: gAcc.vacancies / Math.max(1, nextCompleted),
                interstitialsPerIon: gAcc.vacancies / Math.max(1, nextCompleted),
                energyLossIonizationPct: (gAcc.ionizEv * 100) / totalGpuLoss,
                energyLossPhononsPct: (gAcc.phononEv * 100) / totalGpuLoss,
                energyLossBindingPct: (gAcc.bindingEv * 100) / totalGpuLoss,
                energyIonizByIonPct: (gAcc.ionizEv * 100) / totalGpuLoss,
                energyPhononByIonPct: (gAcc.phononEv * 100) / totalGpuLoss,
                energyBindingByIonPct: (gAcc.bindingEv * 100) / totalGpuLoss,
                rangeMoments: { meanA, stragglingA, skewness, kurtosis },
                lateralMoments: {
                  meanA: absLatRes.meanA,
                  stragglingA: latRes.stragglingA,
                  skewness: latRes.skewness,
                  kurtosis: latRes.kurtosis,
                },
                radialMoments: radRes,
                trajectories: nextTrajectories,
                stoppedIons: newStoppedIons,
                histograms: {
                  ...prev.histograms,
                  ionRange: mergedRangeHist,
                  ionizationIon: nextIonizHist,
                  phononsIon: nextPhononHist,
                  vacanciesIon: nextVacHist,
                },
              };
            });

            if (
              completedIonsRef.current >= configRef.current.totalIons ||
              finishedTarget
            ) {
              setIsRunning(false);
            } else {
              timerId = window.setTimeout(kickLoop, 16);
            }
          })
          .catch(() => {
            setWebGpuEnabled(false);
            timerId = window.setTimeout(kickLoop, 20);
          });
        return;
      }

      if (workerRef.current) {
        if (!inFlightRef.current) {
          inFlightRef.current = true;
          workerRef.current.postMessage({
            type: 'RUN_BATCH',
            count: Math.min(batchSpeedRef.current, remaining),
          } satisfies TrimWorkerRequest);
        }
      } else {
        const snap = simRef.current.runBatch(
          Math.min(batchSpeedRef.current, remaining)
        );
        setSnapshot({ ...snap });
        if (snap.completedIons >= configRef.current.totalIons) {
          setIsRunning(false);
        } else {
          timerId = window.setTimeout(kickLoop, 16);
        }
      }
    };

    timerId = window.setTimeout(kickLoop, 12);
    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [isRunning, webGpuEnabled]);

  const handleStep = (n: number) => {
    setIsRunning(false);
    const remaining = Math.max(0, config.totalIons - snapshot.completedIons);
    const stepCount = Math.min(n, remaining);
    if (stepCount <= 0) return;
    if (workerRef.current) {
      inFlightRef.current = true;
      workerRef.current.postMessage({
        type: 'RUN_BATCH',
        count: stepCount,
      } satisfies TrimWorkerRequest);
    } else {
      const snap = simRef.current.runBatch(stepCount);
      setSnapshot({ ...snap });
    }
  };

  const handleReset = () => {
    setIsRunning(false);
    resetGpuAccum();
    completedIonsRef.current = 0;
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'INIT', config } satisfies TrimWorkerRequest);
    } else {
      simRef.current = new TrimSimulator(config);
      setSnapshot(simRef.current.getSnapshot());
    }
  };

  // Mean lattice binding energy Eb for ESUM analysis (stoichiometry-weighted across all target layers)
  const meanEbEv = useMemo(() => {
    let totalStoich = 0;
    let weightedEb = 0;
    for (const layer of config.layers) {
      for (const el of layer.elements) {
        const s = Math.max(0, el.stoich);
        totalStoich += s;
        weightedEb += s * (el.latticeBindingEv || 3.0);
      }
    }
    return totalStoich > 0 ? weightedEb / totalStoich : 3.0;
  }, [config]);

  const esumResult = useMemo(() => {
    return calcEsumAnalysis({
      depthStepA: snapshot.binWidthA,
      latticeBindingEv: meanEbEv,
      ionizIon: snapshot.histograms.ionizationIon,
      ionizRecoil: snapshot.histograms.ionizationRecoil,
      phononIon: snapshot.histograms.phononsIon,
      phononRecoil: snapshot.histograms.phononsRecoil,
      vacIon: snapshot.histograms.vacanciesIon,
      vacRecoil: snapshot.histograms.vacanciesRecoil,
      e2RecoilIon: snapshot.histograms.energyToRecoils,
    });
  }, [snapshot, meanEbEv]);

  const transmitResult = useMemo(() => {
    const sourceIons =
      snapshot.transmittedIons.length > 0
        ? snapshot.transmittedIons
        : snapshot.backscatteredIons.map((b) => ({
            ...b,
            cosX: Math.abs(b.cosX),
          }));
    return calcTransmitAnalysis(sourceIons, transmitBinWidthDeg, 25);
  }, [snapshot.transmittedIons, snapshot.backscatteredIons, transmitBinWidthDeg]);

  const outputFiles = useMemo(() => {
    if (activeTab !== 'outputs') return {};
    return generateAllTrimOutputs(config, snapshot);
  }, [activeTab, config, snapshot]);

  const progressPct = Math.min(
    100,
    (snapshot.completedIons * 100) / Math.max(1, config.totalIons)
  );

  return (
    <div className="space-y-5">
      {/* Execution Control Bar */}
      <div className="bg-slate-900/85 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsRunning(!isRunning)}
            disabled={!isRunning && snapshot.completedIons >= config.totalIons}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold shadow-lg transition-all ${
              isRunning
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white disabled:opacity-40'
            }`}
          >
            {isRunning ? (
              <>
                <Pause className="w-4 h-4 fill-current" />
                <span>Pause Monte Carlo</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>
                  {snapshot.completedIons > 0
                    ? 'Resume Simulation'
                    : 'Run Simulation'}
                </span>
              </>
            )}
          </button>

          <button
            onClick={() => handleStep(1)}
            disabled={snapshot.completedIons >= config.totalIons}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 disabled:opacity-40"
          >
            <StepForward className="w-3.5 h-3.5 text-cyan-400" />
            <span>+1 Ion</span>
          </button>

          <button
            onClick={() => handleStep(100)}
            disabled={snapshot.completedIons >= config.totalIons}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 disabled:opacity-40"
          >
            <StepForward className="w-3.5 h-3.5 text-emerald-400" />
            <span>+100 Ions</span>
          </button>

          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <div className="flex items-center gap-1.5 ml-2 text-xs text-slate-400">
            <span>Batch Speed:</span>
            <select
              value={batchSpeed}
              onChange={(e) => setBatchSpeed(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
            >
              <option value={10}>10 Ions / tick</option>
              <option value={100}>100 Ions / tick</option>
              <option value={500}>500 Ions / tick</option>
              <option value={2000}>2,000 Ions / tick (Fast)</option>
              <option value={10000}>10,000 Ions / tick (Turbo)</option>
              <option value={25000}>25,000 Ions / tick (1M Ultra)</option>
            </select>
          </div>

          <button
            onClick={handleToggleWebGpu}
            title={
              gpuSupported
                ? 'Toggle WebGPU compute acceleration on/off'
                : 'WebGPU is not supported by your browser or environment (CPU Worker active)'
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
              webGpuEnabled
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white border-cyan-400 shadow-md shadow-cyan-500/20'
                : gpuSupported
                ? 'bg-slate-950/80 text-slate-400 hover:text-slate-200 border-slate-700'
                : 'bg-slate-950/40 text-slate-600 border-slate-800 cursor-not-allowed'
            }`}
          >
            <Zap
              className={`w-3.5 h-3.5 ${
                webGpuEnabled ? 'text-amber-300 animate-pulse' : 'text-slate-500'
              }`}
            />
            <span>WebGPU {webGpuEnabled ? 'ON' : 'OFF'}</span>
            {!gpuSupported && (
              <span className="text-[10px] text-slate-500 font-normal">
                (N/A)
              </span>
            )}
          </button>
        </div>

        {/* Progress Bar & Inline Target Ions (Up to 1,000,000) */}
        <div className="flex-1 min-w-[280px] max-w-[520px] space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-300 font-semibold">
              Ion History: {snapshot.completedIons.toLocaleString()} /{' '}
              {config.totalIons.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              {onUpdateTotalIons && (
                <>
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    step={100}
                    value={config.totalIons}
                    onChange={(e) => {
                      const next = Math.min(
                        1000000,
                        Math.max(1, Math.round(Number(e.target.value) || 1))
                      );
                      onUpdateTotalIons(next);
                    }}
                    title="Target Total Ions (1 to 1,000,000)"
                    className="w-24 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono text-cyan-300 font-bold"
                  />
                  {[
                    { label: '1k', val: 1000 },
                    { label: '10k', val: 10000 },
                    { label: '100k', val: 100000 },
                    { label: '1M', val: 1000000 },
                  ].map((q) => (
                    <button
                      key={q.val}
                      type="button"
                      onClick={() => {
                        onUpdateTotalIons(q.val);
                        if (q.val >= 1000000 && batchSpeed < 10000) {
                          setBatchSpeed(25000);
                        } else if (q.val >= 100000 && batchSpeed < 2000) {
                          setBatchSpeed(10000);
                        } else if (q.val >= 10000 && batchSpeed < 500) {
                          setBatchSpeed(2000);
                        }
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                        config.totalIons === q.val
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200 font-bold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </>
              )}
              <span className="font-mono text-cyan-400 font-bold ml-1">
                {progressPct.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="h-2.5 w-full rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 transition-all duration-150"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Crystal-TRIM Orientation, Tilt/Twist & Post-SRIM-2003 Advanced Physics Strip */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">
            Post-SRIM Physics:
          </span>

          <button
            type="button"
            disabled={!onUpdateConfig}
            onClick={() =>
              updateAdvPhysics({ crystalMode: !activeAdvPhysics.crystalMode })
            }
            className={`px-2.5 py-1 rounded-lg font-semibold border transition-colors ${
              activeAdvPhysics.crystalMode
                ? 'bg-indigo-600 text-white border-indigo-400'
                : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-500'
            }`}
          >
            {activeAdvPhysics.crystalMode
              ? 'Crystal Lattice (Channeling ON)'
              : 'Amorphous (SRIM-2003)'}
          </button>

          {activeAdvPhysics.crystalMode && (
            <>
              <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
                <span className="text-slate-400">Axis:</span>
                {(['<100>', '<110>', '<111>', '<112>'] as CrystalOrientation[]).map(
                  (ori) => (
                    <button
                      key={ori}
                      type="button"
                      onClick={() => updateAdvPhysics({ crystalOrientation: ori })}
                      className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${
                        activeAdvPhysics.crystalOrientation === ori
                          ? 'bg-cyan-600 text-white font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {ori}
                    </button>
                  )
                )}
              </div>

              <label className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
                <span className="text-slate-400">Tilt:</span>
                <input
                  type="number"
                  step={0.5}
                  min={-25}
                  max={25}
                  value={activeAdvPhysics.crystalTiltDeg}
                  onChange={(e) =>
                    updateAdvPhysics({
                      crystalTiltDeg: Math.max(
                        -25,
                        Math.min(25, Number(e.target.value) || 0)
                      ),
                    })
                  }
                  className="w-12 bg-transparent font-mono text-cyan-300 font-bold focus:outline-none"
                />
                <span className="text-slate-500">°</span>
              </label>

              <label className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
                <span className="text-slate-400">Twist:</span>
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={360}
                  value={activeAdvPhysics.crystalTwistDeg}
                  onChange={(e) =>
                    updateAdvPhysics({
                      crystalTwistDeg: Math.max(
                        0,
                        Math.min(360, Number(e.target.value) || 0)
                      ),
                    })
                  }
                  className="w-12 bg-transparent font-mono text-emerald-300 font-bold focus:outline-none"
                />
                <span className="text-slate-500">°</span>
              </label>
            </>
          )}

          <select
            value={activeAdvPhysics.screeningPotential}
            onChange={(e) =>
              updateAdvPhysics({
                screeningPotential: e.target.value as ScreeningPotentialType,
              })
            }
            disabled={!onUpdateConfig}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-200"
            title="Interatomic Screening Potential"
          >
            <option value="zbl">Potential: ZBL Universal</option>
            <option value="krc">Potential: Kr-C (Channeling)</option>
            <option value="moliere">Potential: Moliere</option>
          </select>

          <button
            type="button"
            disabled={!onUpdateConfig}
            onClick={() =>
              updateAdvPhysics({
                localElectronicStopping: !activeAdvPhysics.localElectronicStopping,
              })
            }
            className={`px-2 py-1 rounded-lg border text-[11px] font-semibold ${
              activeAdvPhysics.localElectronicStopping
                ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-200'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
            title="Oen-Robinson impact-parameter b-dependent Se(b)"
          >
            Oen–Robinson Sₑ(b)
          </button>

          <button
            type="button"
            disabled={!onUpdateConfig}
            onClick={() =>
              updateAdvPhysics({
                arcDpaRecombination: !activeAdvPhysics.arcDpaRecombination,
              })
            }
            className={`px-2 py-1 rounded-lg border text-[11px] font-semibold ${
              activeAdvPhysics.arcDpaRecombination
                ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
            title="Nordlund ARC-dpa athermal Frenkel-pair recombination"
          >
            ARC-dpa
          </button>

          <button
            type="button"
            disabled={!onUpdateConfig}
            onClick={() =>
              updateAdvPhysics({
                dynamicComposition: !activeAdvPhysics.dynamicComposition,
              })
            }
            className={`px-2 py-1 rounded-lg border text-[11px] font-semibold ${
              activeAdvPhysics.dynamicComposition
                ? 'bg-amber-950/70 border-amber-500/50 text-amber-200'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
            title="TRIDYN dynamic composition, fluence accumulation & surface sputtering erosion"
          >
            TRIDYN Dynamic
          </button>
        </div>

        {snapshot.advancedDiagnostics && (
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-300">
            {activeAdvPhysics.crystalMode && (
              <span>
                Channeled:{' '}
                <strong className="text-cyan-300">
                  {snapshot.advancedDiagnostics.channeledFractionPct.toFixed(1)}%
                </strong>
              </span>
            )}
            {activeAdvPhysics.dynamicComposition && (
              <span>
                Eroded:{' '}
                <strong className="text-amber-300">
                  {snapshot.advancedDiagnostics.erodedDepthA.toFixed(2)} Å
                </strong>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Live Telemetry KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Mean Projected Range Rp
          </div>
          <div className="text-lg font-extrabold font-mono text-cyan-300 mt-0.5">
            {snapshot.rangeMoments.meanA.toFixed(1)} Å
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Straggle ΔRp = {snapshot.rangeMoments.stragglingA.toFixed(1)} Å
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Radial / Lateral Range
          </div>
          <div className="text-lg font-extrabold font-mono text-emerald-300 mt-0.5">
            {snapshot.radialMoments.meanA.toFixed(1)} Å
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Lateral Y = {snapshot.lateralMoments.meanA.toFixed(1)} Å
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Vacancies / Ion
          </div>
          <div className="text-lg font-extrabold font-mono text-amber-300 mt-0.5">
            {snapshot.vacanciesPerIon.toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Replacements = {snapshot.replacementsPerIon.toFixed(2)} / Ion
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Sputtering Yield Y
          </div>
          <div className="text-lg font-extrabold font-mono text-orange-400 mt-0.5">
            {snapshot.sputteringYield.toFixed(3)}{' '}
            <span className="text-xs font-normal">Atoms/Ion</span>
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Total Sputtered = {snapshot.sputteredAtoms.length}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Backscattered / Transmitted
          </div>
          <div className="text-lg font-extrabold font-mono text-purple-300 mt-0.5">
            {snapshot.backscatteredCount} / {snapshot.transmittedCount}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            BS:{' '}
            {(
              (snapshot.backscatteredCount * 100) /
              Math.max(1, snapshot.completedIons)
            ).toFixed(1)}
            % · TR:{' '}
            {(
              (snapshot.transmittedCount * 100) /
              Math.max(1, snapshot.completedIons)
            ).toFixed(1)}
            %
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Energy Partition (Ion+Rec)
          </div>
          <div className="text-xs font-mono text-slate-200 mt-1 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-cyan-300">Ionization:</span>
              <span className="font-bold">
                {snapshot.energyLossIonizationPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-amber-300">Phonons:</span>
              <span className="font-bold">
                {snapshot.energyLossPhononsPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-rose-300">Binding:</span>
              <span className="font-bold">
                {snapshot.energyLossBindingPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split: 3D Viewer + 4 Moments (Left 5 Cols) & Interactive Histogram/Tool Tabs (Right 7 Cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-5 space-y-4">
          <TrajectoryViewer3D
            layers={config.layers}
            trajectories={snapshot.trajectories}
            stoppedIons={snapshot.stoppedIons}
            maxDepthA={
              config.plotXMaxA ||
              config.layers.reduce((a, b) => a + b.widthA, 0)
            }
          />

          {/* 4 Statistical Moments Card (Rp, DeltaRp, Skewness, Kurtosis) */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2.5">
              SRIM 4-Moment Distribution Statistics (Stopped Ions ={' '}
              {snapshot.stoppedCount})
            </h3>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-1.5">Distribution</th>
                  <th className="py-1.5">Mean Range</th>
                  <th className="py-1.5">Straggling σ</th>
                  <th className="py-1.5">Skewness γ</th>
                  <th className="py-1.5">Kurtosis β</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-b border-slate-900">
                  <td className="py-1.5 font-sans font-semibold text-cyan-300">
                    Longitudinal (X)
                  </td>
                  <td className="py-1.5">
                    {snapshot.rangeMoments.meanA.toFixed(2)} Å
                  </td>
                  <td className="py-1.5">
                    {snapshot.rangeMoments.stragglingA.toFixed(2)} Å
                  </td>
                  <td className="py-1.5">
                    {snapshot.rangeMoments.skewness.toFixed(3)}
                  </td>
                  <td className="py-1.5">
                    {snapshot.rangeMoments.kurtosis.toFixed(3)}
                  </td>
                </tr>
                <tr className="border-b border-slate-900">
                  <td className="py-1.5 font-sans font-semibold text-emerald-300">
                    Radial (R)
                  </td>
                  <td className="py-1.5">
                    {snapshot.radialMoments.meanA.toFixed(2)} Å
                  </td>
                  <td className="py-1.5">
                    {snapshot.radialMoments.stragglingA.toFixed(2)} Å
                  </td>
                  <td className="py-1.5">
                    {snapshot.radialMoments.skewness.toFixed(3)}
                  </td>
                  <td className="py-1.5">
                    {snapshot.radialMoments.kurtosis.toFixed(3)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans font-semibold text-purple-300">
                    Lateral (Y)
                  </td>
                  <td className="py-1.5">
                    {snapshot.lateralMoments.meanA.toFixed(2)} Å
                  </td>
                  <td className="py-1.5">
                    {snapshot.lateralMoments.stragglingA.toFixed(2)} Å
                  </td>
                  <td className="py-1.5">
                    {snapshot.lateralMoments.skewness.toFixed(3)}
                  </td>
                  <td className="py-1.5">
                    {snapshot.lateralMoments.kurtosis.toFixed(3)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 7 Cols: Interactive Histograms, Sputtering SBE Curve, ESUM, TRANSMIT, 13 Outputs */}
        <div className="xl:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col">
          {/* Tab Strip */}
          <div className="flex flex-wrap gap-1 pb-3 mb-4 border-b border-slate-800">
            {[
              { id: 'range', label: 'Ion/Recoil Range', icon: <BarChart3 className="w-3.5 h-3.5" /> },
              { id: 'contour2d', label: '2D Contour Map', icon: <Layers className="w-3.5 h-3.5" /> },
              { id: 'vacancies', label: 'Vacancies & Damage', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
              { id: 'ionization', label: 'Ionization', icon: <Zap className="w-3.5 h-3.5" /> },
              { id: 'phonons', label: 'Phonons', icon: <Flame className="w-3.5 h-3.5" /> },
              { id: 'recoilLateral', label: 'E2Recoil & Lateral', icon: <Compass className="w-3.5 h-3.5" /> },
              { id: 'sputtering', label: 'Sputtering vs Es', icon: <Sparkles className="w-3.5 h-3.5" /> },
              { id: 'esum', label: 'ESUM.BAS Tool', icon: <BarChart3 className="w-3.5 h-3.5" /> },
              { id: 'transmit', label: 'TRANSMIT.BAS Tool', icon: <Compass className="w-3.5 h-3.5" /> },
              { id: 'outputs', label: '13 .TXT Outputs', icon: <FileText className="w-3.5 h-3.5" /> },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as CockpitTab)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === t.id
                    ? 'bg-cyan-600 text-white shadow'
                    : 'bg-slate-950/70 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Body */}
          <div className="flex-1">
            {activeTab === 'range' && (
              <DepthHistogramChart
                title="Final Ion & Recoil Depth Distribution (RANGE.TXT)"
                subtitle="100-bin depth concentration profile normalized to (atoms/cm³) / (atoms/cm²) = cm⁻¹"
                depthsA={snapshot.binDepthsA}
                series={[
                  {
                    name: `Stopped ${config.ion.symbol} Ions`,
                    color: '#22d3ee',
                    data: snapshot.histograms.ionRange,
                  },
                  ...(snapshot.histograms.recoilRangeByElement[0]
                    ? [
                        {
                          name: 'Target Recoil Atoms',
                          color: '#f97316',
                          data: snapshot.histograms.recoilRangeByElement[0],
                        },
                      ]
                    : []),
                ]}
                yUnit="cm⁻¹"
              />
            )}

            {activeTab === 'contour2d' && (
              <ContourMap2D snapshot={snapshot} config={config} />
            )}

            {activeTab === 'vacancies' && (
              <DepthHistogramChart
                title="Target Vacancies, Replacements & Interstitials vs Depth (VACANCY.TXT / NOVAC.TXT)"
                subtitle="Primary knock-on vacancies by ions + secondary cascade vacancies by recoils"
                depthsA={snapshot.binDepthsA}
                series={[
                  {
                    name: 'Vacancies by Ions',
                    color: '#38bdf8',
                    data: snapshot.histograms.vacanciesIon,
                  },
                  {
                    name: 'Vacancies by Recoils',
                    color: '#fbbf24',
                    data: snapshot.histograms.vacanciesRecoil,
                  },
                  {
                    name: 'Replacements',
                    color: '#34d399',
                    data: snapshot.histograms.replacements,
                  },
                ]}
                yUnit="Vacancies / (Å · Ion)"
              />
            )}

            {activeTab === 'ionization' && (
              <DepthHistogramChart
                title="Electronic Ionization Energy Loss vs Depth (IONIZ.TXT)"
                subtitle="Energy lost to target electrons by primary ions and secondary recoil cascades"
                depthsA={snapshot.binDepthsA}
                series={[
                  {
                    name: 'Ionization by Ions',
                    color: '#22d3ee',
                    data: snapshot.histograms.ionizationIon,
                  },
                  {
                    name: 'Ionization by Recoils',
                    color: '#f43f5e',
                    data: snapshot.histograms.ionizationRecoil,
                  },
                ]}
                yUnit="eV / (Å · Ion)"
              />
            )}

            {activeTab === 'phonons' && (
              <DepthHistogramChart
                title="Target Phonon Energy Production vs Depth (PHONON.TXT)"
                subtitle="Sub-threshold nuclear energy transfers and stopping recoil kinetic energy into lattice phonons"
                depthsA={snapshot.binDepthsA}
                series={[
                  {
                    name: 'Phonons by Ions',
                    color: '#38bdf8',
                    data: snapshot.histograms.phononsIon,
                  },
                  {
                    name: 'Phonons by Recoils',
                    color: '#f59e0b',
                    data: snapshot.histograms.phononsRecoil,
                  },
                ]}
                yUnit="eV / (Å · Ion)"
              />
            )}

            {activeTab === 'recoilLateral' && (
              <DepthHistogramChart
                title="Energy Transferred to Recoils (E2RECOIL.TXT) & Radial Spread (LATERAL.TXT)"
                subtitle="Primary knock-on energy transfer rate eV/(Å·Ion) and mean radial spread (Å)"
                depthsA={snapshot.binDepthsA}
                series={[
                  {
                    name: 'Energy to Recoils (eV/Å)',
                    color: '#ec4899',
                    data: snapshot.histograms.energyToRecoils,
                  },
                  {
                    name: 'Radial Spread R (Å)',
                    color: '#34d399',
                    data: snapshot.histograms.radialR,
                  },
                ]}
                yUnit="eV/Å | Å"
              />
            )}

            {activeTab === 'sputtering' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      Surface Sputtering Yield Sensitivity to Surface Binding Energy Es (SPUTTER.TXT)
                    </h4>
                    <p className="text-xs text-slate-400">
                      Recomputes sputtering yield Y(Es) across Es = 0.5 eV to 12.0 eV from surface recoil arrival distribution (Mode 2 & Mode 3)
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-xs text-slate-400">
                      Current Total Sputtering Yield
                    </div>
                    <div className="text-base font-bold text-orange-400">
                      Y = {snapshot.sputteringYield.toFixed(4)} Atoms / Ion
                    </div>
                  </div>
                </div>

                <DepthHistogramChart
                  title="Sputtering Yield Y(Es) vs Surface Binding Energy Es (eV)"
                  subtitle="Atoms/Ion escaping planar surface potential barrier E_normal > Es"
                  depthsA={snapshot.sputterYieldVsEs.map((s) => s.esEv)}
                  xLabel="Surface Binding Energy Es (eV)"
                  series={[
                    {
                      name: 'Total Sputtering Yield (Atoms/Ion)',
                      color: '#f97316',
                      data: snapshot.sputterYieldVsEs.map((s) => s.totalYield),
                    },
                  ]}
                  yUnit="Atoms / Ion"
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {snapshot.sputteringYieldByElement.map((el) => (
                    <div
                      key={el.z}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800"
                    >
                      <div className="text-xs font-bold text-white">
                        {el.symbol} ({el.name}, Z={el.z})
                      </div>
                      <div className="text-sm font-mono text-orange-300 mt-1">
                        Yield = {el.yieldPerIon.toFixed(4)} atoms/ion
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        Mean Ejected Energy = {el.meanEnergyEv.toFixed(2)} eV
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'esum' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div>
                      <h4 className="text-sm font-bold text-cyan-300">
                        SRIM Tools / ESUM.BAS — Integrated Energy-Loss & Vacancy Summation
                      </h4>
                      <p className="text-xs text-slate-400">
                        Integrates IONIZ.TXT + PHONON.TXT + VACANCY.TXT × Eb ({meanEbEv} eV) over all 100 depth bins (Δx = {snapshot.binWidthA.toFixed(2)} Å)
                      </p>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-xs text-slate-400">
                        Integrated Total Loss / Ion
                      </div>
                      <div className="text-base font-bold text-emerald-300">
                        {esumResult.totalLossKeV.toFixed(3)} keV
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-cyan-400 font-sans font-bold mb-1">
                        1. Ionization Loss ({esumResult.ionizTotalPct.toFixed(2)}%)
                      </div>
                      <div>By Ions: {esumResult.ionizIonEv.toFixed(1)} eV</div>
                      <div>By Recoils: {esumResult.ionizRecoilEv.toFixed(1)} eV</div>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-amber-400 font-sans font-bold mb-1">
                        2. Phonon Energy ({esumResult.phononTotalPct.toFixed(2)}%)
                      </div>
                      <div>By Ions: {esumResult.phononIonEv.toFixed(1)} eV</div>
                      <div>By Recoils: {esumResult.phononRecoilEv.toFixed(1)} eV</div>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-rose-400 font-sans font-bold mb-1">
                        3. Vacancy Binding ({esumResult.bindingTotalPct.toFixed(2)}%)
                      </div>
                      <div>
                        Ion Vacancies: {esumResult.ionVacancies} (
                        {esumResult.bindingIonEv.toFixed(1)} eV)
                      </div>
                      <div>
                        Recoil Vacancies: {esumResult.recoilVacancies} (
                        {esumResult.bindingRecoilEv.toFixed(1)} eV)
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-wrap justify-between text-xs font-mono">
                    <span>
                      Direct Ion Energy Loss:{' '}
                      <strong className="text-cyan-300">
                        {esumResult.ionLossKeV.toFixed(3)} keV (
                        {esumResult.ionLossPercent.toFixed(1)}%)
                      </strong>
                    </span>
                    <span>
                      Recoil Cascade Energy Loss:{' '}
                      <strong className="text-orange-300">
                        {esumResult.recoilLossKeV.toFixed(3)} keV (
                        {esumResult.recoilLossPercent.toFixed(1)}%)
                      </strong>
                    </span>
                    <span>
                      Total Vacancies/Ion:{' '}
                      <strong className="text-emerald-300">
                        {esumResult.totalVacanciesPerIon}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'transmit' && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-purple-300">
                      SRIM Tools / TRANSMIT.BAS — Angular & Solid-Angle Flux Analyzer
                    </h4>
                    <p className="text-xs text-slate-400">
                      Analyzes {transmitResult.totalIons} Escaped Ions (Mean Energy ={' '}
                      {transmitResult.meanEnergyKeV.toFixed(2)} ±{' '}
                      {transmitResult.energyStragglingKeV.toFixed(2)} keV, Mean Angle ={' '}
                      {transmitResult.meanAngleDeg.toFixed(2)}° ±{' '}
                      {transmitResult.angleStragglingDeg.toFixed(2)}°)
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Angular Bin Δθ (°):</span>
                    <input
                      type="number"
                      step="0.5"
                      min={0.5}
                      max={10}
                      value={transmitBinWidthDeg}
                      onChange={(e) =>
                        setTransmitBinWidthDeg(
                          Math.max(0.5, Number(e.target.value))
                        )
                      }
                      className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono"
                    />
                  </div>
                </div>

                <div className="max-h-[340px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/70">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
                      <tr>
                        <th className="py-1.5 px-3">Angle Bin (°)</th>
                        <th className="py-1.5 px-3">Ion Count</th>
                        <th className="py-1.5 px-3">Fraction</th>
                        <th className="py-1.5 px-3">Mean E (keV)</th>
                        <th className="py-1.5 px-3">Mean Lateral (Å)</th>
                        <th className="py-1.5 px-3">Ring Area (deg²)</th>
                        <th className="py-1.5 px-3">Rel. Flux (FLUX/FLUX0)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transmitResult.bins.map((b) => (
                        <tr
                          key={b.binIndex}
                          className="border-b border-slate-900 hover:bg-slate-800/40"
                        >
                          <td className="py-1 px-3 text-purple-300">
                            {b.angleMinDeg.toFixed(1)}° – {b.angleMaxDeg.toFixed(1)}°
                          </td>
                          <td className="py-1 px-3">{b.count}</td>
                          <td className="py-1 px-3">
                            {(b.fractionOfIons * 100).toFixed(2)}%
                          </td>
                          <td className="py-1 px-3 text-emerald-300">
                            {b.meanEnergyKeV.toFixed(2)}
                          </td>
                          <td className="py-1 px-3">
                            {b.meanLateralA.toFixed(1)}
                          </td>
                          <td className="py-1 px-3 text-slate-400">
                            {b.solidAngleAreaDeg2.toFixed(2)}
                          </td>
                          <td className="py-1 px-3 text-cyan-300 font-bold">
                            {b.relativeFlux.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'outputs' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(outputFiles).map((fname) => (
                      <button
                        key={fname}
                        onClick={() => setSelectedTxtFile(fname)}
                        className={`px-2 py-1 rounded text-[11px] font-mono font-semibold ${
                          selectedTxtFile === fname
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-950 text-slate-300 hover:bg-slate-800 border border-slate-800'
                        }`}
                      >
                        {fname}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      downloadFile(
                        outputFiles[selectedTxtFile] || '',
                        selectedTxtFile,
                        'text/plain;charset=utf-8'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download {selectedTxtFile}</span>
                  </button>
                </div>

                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-200 overflow-auto max-h-[340px] leading-relaxed">
                  {outputFiles[selectedTxtFile] || ''}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface DepthHistogramChartProps {
  title: string;
  subtitle: string;
  depthsA: number[];
  xLabel?: string;
  yUnit: string;
  series: { name: string; color: string; data: number[] }[];
}

const DepthHistogramChart: React.FC<DepthHistogramChartProps> = ({
  title,
  subtitle,
  depthsA,
  xLabel = 'Target Depth X (Å)',
  yUnit,
  series,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(880);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 240) setWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleExportSvg = () => {
    const svgStr = generateSvgLinePlot({
      title,
      xLabel,
      yLabel: `Concentration / Yield (${yUnit})`,
      series: series.map((s) => ({
        name: s.name,
        color: s.color,
        x: depthsA,
        y: s.data,
      })),
      theme: 'academic',
    });
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    downloadFile(svgStr, `${safeName}_academic.svg`, 'image/svg+xml;charset=utf-8');
  };

  const handleExportCsv = () => {
    const headers = [xLabel, ...series.map((s) => `${s.name} (${yUnit})`)];
    const rows = depthsA.map((depth, idx) => [
      depth,
      ...series.map((s) => s.data[idx] ?? 0),
    ]);
    const csvStr = generateCsvData(headers, rows);
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    downloadFile(csvStr, `${safeName}.csv`, 'text/csv;charset=utf-8');
  };

  const maxVal = useMemo(() => {
    let m = 0;
    for (const s of series) {
      for (const v of s.data) {
        if (v > m) m = v;
      }
    }
    return m > 0 ? m * 1.08 : 1.0;
  }, [series]);

  // 1.5x height (290 -> 435px) and dynamic full-container width with minimal side margins
  const height = 435;
  const padL = 56;
  const padR = 12;
  const padT = 18;
  const padB = 34;
  const plotW = Math.max(100, width - padL - padR);
  const plotH = height - padT - padB;
  const nBins = Math.max(1, depthsA.length);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-white">{title}</h4>
          <p className="text-[11px] text-slate-400">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-3 text-xs mr-2">
            {series.map((s) => (
              <span key={s.name} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-slate-200 font-medium">{s.name}</span>
              </span>
            ))}
          </div>

          <button
            onClick={handleExportSvg}
            title="Download publication-quality vector SVG (Paper theme)"
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold border border-slate-700 transition-colors"
          >
            <Download className="w-3 h-3 text-cyan-400" />
            <span>SVG (Paper)</span>
          </button>
          <button
            onClick={handleExportCsv}
            title="Download raw data as CSV spreadsheet"
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold border border-slate-700 transition-colors"
          >
            <FileSpreadsheet className="w-3 h-3 text-emerald-400" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      <div
        ref={boxRef}
        className="relative bg-slate-950/90 border border-slate-800 rounded-xl p-1"
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[435px] block overflow-visible"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Horizontal Grid Lines */}
          {[0, 0.25, 0.5, 0.75, 1.0].map((f, idx) => {
            const y = padT + plotH * (1 - f);
            const val = maxVal * f;
            return (
              <g key={idx}>
                <line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  stroke="#1e293b"
                  strokeDasharray="3 3"
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {val >= 1000 || (val > 0 && val < 0.01)
                    ? val.toExponential(1)
                    : val.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* X-Axis Ticks */}
          {[0, 0.25, 0.5, 0.75, 1.0].map((f, idx) => {
            const bIdx = Math.min(
              nBins - 1,
              Math.floor(f * (nBins - 1))
            );
            const x = padL + f * plotW;
            const dVal = depthsA[bIdx] ?? 0;
            return (
              <text
                key={idx}
                x={x}
                y={height - 16}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="10"
                fontFamily="monospace"
              >
                {dVal.toFixed(1)}
              </text>
            );
          })}

          <text
            x={padL + plotW * 0.5}
            y={height - 2}
            textAnchor="middle"
            fill="#cbd5e1"
            fontSize="11"
            fontWeight="bold"
          >
            {xLabel}
          </text>

          {/* Series Polylines & Area Fills */}
          {series.map((s) => {
            const pts = s.data.map((v, i) => {
              const x = padL + (i / Math.max(1, nBins - 1)) * plotW;
              const y = padT + plotH * (1 - Math.min(1, Math.max(0, v / maxVal)));
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            });
            const areaPts = [
              `${padL},${padT + plotH}`,
              ...pts,
              `${padL + plotW},${padT + plotH}`,
            ].join(' ');
            return (
              <g key={s.name}>
                <polygon
                  points={areaPts}
                  fill={s.color}
                  fillOpacity={0.14}
                />
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.0}
                  points={pts.join(' ')}
                />
              </g>
            );
          })}

          {/* Hover Crosshair */}
          {hoverIdx !== null && depthsA[hoverIdx] !== undefined && (
            <line
              x1={padL + (hoverIdx / Math.max(1, nBins - 1)) * plotW}
              y1={padT}
              x2={padL + (hoverIdx / Math.max(1, nBins - 1)) * plotW}
              y2={padT + plotH}
              stroke="#e2e8f0"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          )}

          {/* Invisible Hover Capture Rect */}
          <rect
            x={padL}
            y={padT}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
              const idx = Math.max(
                0,
                Math.min(nBins - 1, Math.round(relX * (nBins - 1)))
              );
              setHoverIdx(idx);
            }}
          />
        </svg>

        {hoverIdx !== null && depthsA[hoverIdx] !== undefined && (
          <div className="absolute top-3 right-4 px-3 py-1.5 rounded-lg bg-slate-900/95 border border-slate-700 text-[11px] font-mono text-slate-200 shadow-lg pointer-events-none">
            <div className="text-slate-400">
              X = {depthsA[hoverIdx].toFixed(2)} ({yUnit})
            </div>
            {series.map((s) => (
              <div key={s.name} style={{ color: s.color }}>
                {s.name}: {(s.data[hoverIdx] ?? 0).toExponential(3)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
