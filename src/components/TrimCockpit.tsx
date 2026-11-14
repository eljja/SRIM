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
import { TrimSimulator } from '../physics/trim';
import { calcEsumAnalysis, calcTransmitAnalysis } from '../physics/pral';
import { generateAllTrimOutputs } from '../physics/formats';
import { generateSvgLinePlot, generateCsvData, downloadFile } from '../physics/exportUtils';
import { isWebGpuSupported, WebGpuTrimRunner } from '../physics/webgpuTrim';
import { TrajectoryViewer3D } from './TrajectoryViewer3D';
import { ContourMap2D } from './ContourMap2D';
import type { TrimSetupConfig, TrimSnapshot } from '../physics/types';
import type { TrimWorkerRequest, TrimWorkerResponse } from '../workers/trim.worker';

interface TrimCockpitProps {
  config: TrimSetupConfig;
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

export const TrimCockpit: React.FC<TrimCockpitProps> = ({ config }) => {
  const simRef = useRef<TrimSimulator>(new TrimSimulator(config));
  const workerRef = useRef<Worker | null>(null);
  const gpuRunnerRef = useRef<WebGpuTrimRunner | null>(null);

  const [snapshot, setSnapshot] = useState<TrimSnapshot>(() =>
    simRef.current.getSnapshot()
  );
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [batchSpeed, setBatchSpeed] = useState<number>(10);
  const [activeTab, setActiveTab] = useState<CockpitTab>('range');
  const [transmitBinWidthDeg, setTransmitBinWidthDeg] = useState<number>(2.0);
  const [selectedTxtFile, setSelectedTxtFile] = useState<string>('TDATA.TXT');

  // WebGPU state
  const [gpuSupported, setGpuSupported] = useState<boolean>(false);
  const [webGpuEnabled, setWebGpuEnabled] = useState<boolean>(false);

  useEffect(() => {
    setGpuSupported(isWebGpuSupported());
  }, []);

  // Re-initialize simulator or worker when config changes
  useEffect(() => {
    setIsRunning(false);

    try {
      if (typeof Worker !== 'undefined') {
        const w = new Worker(
          new URL('../workers/trim.worker.ts', import.meta.url),
          { type: 'module' }
        );
        w.onmessage = (e: MessageEvent<TrimWorkerResponse>) => {
          if (e.data?.type === 'SNAPSHOT') {
            setSnapshot(e.data.snapshot);
            if (e.data.snapshot.completedIons >= config.totalIons) {
              setIsRunning(false);
            }
          }
        };
        workerRef.current = w;
        w.postMessage({ type: 'INIT', config } satisfies TrimWorkerRequest);
        // Run initial batch
        const initialCount = Math.min(15, config.totalIons);
        w.postMessage({ type: 'RUN_BATCH', count: initialCount } satisfies TrimWorkerRequest);
      }
    } catch {
      workerRef.current = null;
    }

    if (!workerRef.current) {
      simRef.current = new TrimSimulator(config);
      const initialCount = Math.min(15, config.totalIons);
      setSnapshot(simRef.current.runBatch(initialCount));
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [config]);

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

  // Animation loop when running
  useEffect(() => {
    if (!isRunning) return;
    let timerId = 0;
    const stepLoop = () => {
      if (snapshot.completedIons >= config.totalIons) {
        setIsRunning(false);
        return;
      }

      if (webGpuEnabled && gpuRunnerRef.current?.ready) {
        const l0 = config.layers[0];
        const el0 = l0?.elements[0];
        const totalW = config.layers.reduce((a, b) => a + b.widthA, 0) || 1000;
        gpuRunnerRef.current
          .runBatch(batchSpeed, {
            z1: config.ion.z1,
            m1: config.ion.massAmu,
            energyEv: config.ion.energyKeV * 1000.0,
            angleRad: (config.ion.angleDeg * Math.PI) / 180.0,
            z2: el0?.z || 14,
            m2: el0?.massAmu || 28.086,
            atomDensityA3: 0.05,
            targetWidthA: totalW,
            edEv: el0?.displacementEv || 15,
            esEv: el0?.surfaceBindingEv || 2.1,
            binWidthA: snapshot.binWidthA || 10,
          })
          .then((res) => {
            setSnapshot((prev) => {
              const nextCompleted = prev.completedIons + batchSpeed;
              const newStoppedIons = [...prev.stoppedIons];
              for (let i = 0; i < res.stoppedX.length; i++) {
                if (newStoppedIons.length < 1000) {
                  newStoppedIons.push({
                    ionNumber: prev.completedIons + i + 1,
                    z1: config.ion.z1,
                    energyEv: 0,
                    xA: res.stoppedX[i],
                    yA: res.stoppedY[i],
                    zA: res.stoppedZ[i],
                    cosX: 1,
                    cosY: 0,
                    cosZ: 0,
                  });
                }
              }
              const rangeNormCmInv = 1e8 / (Math.max(1, nextCompleted) * prev.binWidthA);
              const mergedHist = prev.histograms.ionRange.map((oldVal, b) => {
                const oldCounts = (oldVal / rangeNormCmInv) * prev.completedIons;
                return (
                  ((oldCounts + (res.rangeHist[b] || 0)) / nextCompleted) *
                  rangeNormCmInv
                );
              });
              return {
                ...prev,
                completedIons: nextCompleted,
                stoppedCount: prev.stoppedCount + res.stoppedCount,
                backscatteredCount: prev.backscatteredCount + res.backscatterCount,
                transmittedCount: prev.transmittedCount + res.transmitCount,
                stoppedIons: newStoppedIons,
                histograms: {
                  ...prev.histograms,
                  ionRange: mergedHist,
                },
              };
            });
            timerId = window.setTimeout(stepLoop, 20);
          })
          .catch(() => {
            setWebGpuEnabled(false);
            timerId = window.setTimeout(stepLoop, 25);
          });
        return;
      }

      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'RUN_BATCH',
          count: batchSpeed,
        } satisfies TrimWorkerRequest);
        timerId = window.setTimeout(stepLoop, 25);
      } else {
        const snap = simRef.current.runBatch(batchSpeed);
        setSnapshot({ ...snap });
        if (snap.completedIons >= config.totalIons) {
          setIsRunning(false);
        } else {
          timerId = window.setTimeout(stepLoop, 25);
        }
      }
    };
    timerId = window.setTimeout(stepLoop, 25);
    return () => clearTimeout(timerId);
  }, [isRunning, batchSpeed, config.totalIons, snapshot.completedIons, webGpuEnabled]);

  const handleStep = (n: number) => {
    setIsRunning(false);
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'RUN_BATCH',
        count: n,
      } satisfies TrimWorkerRequest);
    } else {
      const snap = simRef.current.runBatch(n);
      setSnapshot({ ...snap });
    }
  };

  const handleReset = () => {
    setIsRunning(false);
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
            disabled={snapshot.completedIons >= config.totalIons}
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
            onClick={() => handleStep(50)}
            disabled={snapshot.completedIons >= config.totalIons}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 disabled:opacity-40"
          >
            <StepForward className="w-3.5 h-3.5 text-emerald-400" />
            <span>+50 Ions</span>
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
              <option value={2}>2 Ions / tick</option>
              <option value={10}>10 Ions / tick</option>
              <option value={25}>25 Ions / tick</option>
              <option value={100}>100 Ions / tick (Turbo)</option>
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

        {/* Progress Bar & Status */}
        <div className="flex-1 min-w-[260px] max-w-[440px]">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-300 font-semibold">
              Ion History Progress: {snapshot.completedIons.toLocaleString()} /{' '}
              {config.totalIons.toLocaleString()}
            </span>
            <span className="font-mono text-cyan-400 font-bold">
              {progressPct.toFixed(1)}%
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 transition-all duration-150"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
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

  const width = 680;
  const height = 290;
  const padL = 64;
  const padR = 20;
  const padT = 22;
  const padB = 38;
  const plotW = width - padL - padR;
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

      <div className="relative bg-slate-950/90 border border-slate-800 rounded-xl p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[290px] overflow-visible"
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
