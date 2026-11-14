import React, { useState, useMemo } from 'react';
import {
  Cpu,
  GitCompare,
  Gauge,
  Play,
  Download,
  FileSpreadsheet,
  Layers,
  BookOpen,
  Sliders,
} from 'lucide-react';
import { getElementByZ } from '../data';
import { SEMICONDUCTOR_MATERIALS } from '../data/semiconductorMaterials';
import { calcStoppingAndRangeTable } from '../physics/pral';
import { TrimSimulator } from '../physics/trim';
import {
  calcLssCompactRange,
  calcEmpiricalPowerLawRange,
  evaluateGaussianProfile,
  evaluateJoinedHalfGaussianProfile,
  evaluatePearsonIVProfile,
  predictJunctionAndSheetResistance,
  computeThinFilmBenchmarks,
} from '../physics/implantModels';
import {
  generateSvgLinePlot,
  generateCsvData,
  downloadFile,
} from '../physics/exportUtils';
import type { TrimSetupConfig, TrimSnapshot } from '../physics/types';

interface ImplantAnalyticsProps {
  trimConfig: TrimSetupConfig;
}

type AnalyticsTab = 'benchmarks' | 'models' | 'junction';

const COMMON_DOPANT_IONS = [
  { label: '11B+ (p-type)', z1: 5, m1: 11.0093, polarity: 'p' as const },
  { label: '31P+ (n-type)', z1: 15, m1: 30.9738, polarity: 'n' as const },
  { label: '75As+ (n-type)', z1: 33, m1: 74.9216, polarity: 'n' as const },
  { label: '115In+ (p-type)', z1: 49, m1: 114.9039, polarity: 'p' as const },
  { label: '121Sb+ (n-type)', z1: 51, m1: 120.9038, polarity: 'n' as const },
  { label: '27Al+ (SiC p-type)', z1: 13, m1: 26.9815, polarity: 'p' as const },
  { label: '14N+ (SiC n-type / NV)', z1: 7, m1: 14.0031, polarity: 'n' as const },
  { label: '1H+ (Smart-Cut)', z1: 1, m1: 1.0078, polarity: 'n' as const },
  { label: '4He+ (Waveguide)', z1: 2, m1: 4.0026, polarity: 'n' as const },
  { label: '69Ga+ (FIB)', z1: 31, m1: 68.9256, polarity: 'p' as const },
  { label: '40Ar+ (Etch / Sputter)', z1: 18, m1: 39.9624, polarity: 'n' as const },
];

export const ImplantAnalytics: React.FC<ImplantAnalyticsProps> = ({
  trimConfig,
}) => {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('benchmarks');

  // Shared / Tab 1 Ion & Energy state
  const [selectedIonZ, setSelectedIonZ] = useState<number>(trimConfig.ion.z1 || 5);
  const [selectedIonMass, setSelectedIonMass] = useState<number>(
    trimConfig.ion.massAmu || 11.0093
  );
  const [energyKeV, setEnergyKeV] = useState<number>(
    Math.max(1, trimConfig.ion.energyKeV || 50)
  );

  // Tab 2 Target selection & live MC snapshot
  const [targetMatId, setTargetMatId] = useState<string>('mat-c-si');
  const [doseCm2, setDoseCm2] = useState<number>(1e15);
  const [useLogScaleY, setUseLogScaleY] = useState<boolean>(true);
  const [mcSnapshot, setMcSnapshot] = useState<TrimSnapshot | null>(null);
  const [mcRunKey, setMcRunKey] = useState<string>('');

  // Tab 3 Junction & Sheet Resistance parameters
  const [dopantType, setDopantType] = useState<'n' | 'p'>(() =>
    [5, 13, 31, 49].includes(trimConfig.ion.z1) ? 'p' : 'n'
  );
  const [profileSource, setProfileSource] = useState<'mc' | 'pearson' | 'gaussian'>('pearson');
  const [bgDopingCm3, setBgDopingCm3] = useState<number>(1e16);
  const [activationPct, setActivationPct] = useState<number>(95);
  const [solidSolubilityCm3, setSolidSolubilityCm3] = useState<number>(2e20);
  const [annealDiffNm, setAnnealDiffNm] = useState<number>(5);
  const [tempK, setTempK] = useState<number>(300);

  const selectedIonMeta = useMemo(() => getElementByZ(selectedIonZ), [selectedIonZ]);

  const selectedTargetMat = useMemo(() => {
    if (targetMatId === 'active-layer-1' && trimConfig.layers[0]) {
      const l = trimConfig.layers[0];
      return {
        id: 'active-layer-1',
        name: `Active L1: ${l.name}`,
        formula: l.elements.map((e) => `${e.symbol}${e.stoich !== 1 ? e.stoich : ''}`).join(''),
        densityGPerCm3: l.densityGPerCm3,
        phase: l.phase,
        compoundCorr: l.compoundCorr,
        elements: l.elements,
      };
    }
    return (
      SEMICONDUCTOR_MATERIALS.find((m) => m.id === targetMatId) ||
      SEMICONDUCTOR_MATERIALS[0]
    );
  }, [targetMatId, trimConfig]);

  // === Tab 1: Benchmarks ===
  const benchmarkRows = useMemo(
    () => computeThinFilmBenchmarks(selectedIonZ, selectedIonMass, energyKeV),
    [selectedIonZ, selectedIonMass, energyKeV]
  );

  const handleExportBenchmarksCsv = () => {
    const headers = [
      'Thin Film',
      'Formula',
      'Density (g/cm3)',
      'Projected Range Rp (nm)',
      'Longitudinal Straggle dRp (nm)',
      'Lateral Straggle dRy (nm)',
      '99.9% Mask Thickness (nm)',
      'Se (eV/A)',
      'Sn (eV/A)',
      'Nuclear Loss (%)',
    ];
    const rows = benchmarkRows.map((r) => [
      r.name,
      r.formula,
      r.densityGPerCm3,
      Number(r.projectedRangeNm.toFixed(3)),
      Number((r.longitudinalStraggleA * 0.1).toFixed(3)),
      Number((r.lateralStraggleA * 0.1).toFixed(3)),
      Number(r.masking999ThicknessNm.toFixed(2)),
      Number(r.seEvPerA.toFixed(4)),
      Number(r.snEvPerA.toFixed(4)),
      Number(r.nuclearFractionPct.toFixed(2)),
    ]);
    downloadFile(
      generateCsvData(headers, rows),
      `srim_thin_film_benchmarks_${selectedIonMeta.symbol}_${energyKeV}keV.csv`,
      'text/csv;charset=utf-8'
    );
  };

  // === Tab 2: Compact Models vs SRIM PRAL92 & Monte Carlo ===
  const energySweepData = useMemo(() => {
    const energies = [1, 2, 5, 10, 20, 35, 50, 75, 100, 150, 200, 350, 500];
    const elems = selectedTargetMat.elements.map((e) => ({
      z: e.z,
      symbol: e.symbol,
      name: e.name,
      stoich: e.stoich,
      mass: e.massAmu,
    }));

    const pralRows = calcStoppingAndRangeTable({
      z1: selectedIonZ,
      m1: selectedIonMass,
      elements: elems,
      densityGPerCm3: selectedTargetMat.densityGPerCm3,
      phase: selectedTargetMat.phase,
      compoundCorr: selectedTargetMat.compoundCorr,
      unit: 1,
      eMinKeV: 0,
      eMaxKeV: 0,
      customEnergiesKeV: energies,
    });

    return energies.map((eKeV, i) => {
      const pral = pralRows[i];
      const lss = calcLssCompactRange(
        selectedIonZ,
        selectedIonMass,
        eKeV,
        elems,
        selectedTargetMat.densityGPerCm3
      );
      const emp = calcEmpiricalPowerLawRange(
        selectedIonZ,
        selectedIonMass,
        eKeV,
        elems,
        selectedTargetMat.densityGPerCm3
      );
      return {
        energyKeV: eKeV,
        pralRpNm: pral.projectedRangeA * 0.1,
        pralStraggleNm: pral.longitudinalStragglingA * 0.1,
        lssRpNm: lss.projectedRangeA * 0.1,
        lssStraggleNm: lss.stragglingA * 0.1,
        empRpNm: emp.projectedRangeA * 0.1,
        empStraggleNm: emp.stragglingA * 0.1,
      };
    });
  }, [selectedIonZ, selectedIonMass, selectedTargetMat]);

  const currentPointMetrics = useMemo(() => {
    const elems = selectedTargetMat.elements.map((e) => ({
      z: e.z,
      symbol: e.symbol,
      name: e.name,
      stoich: e.stoich,
      mass: e.massAmu,
    }));
    const pral = calcStoppingAndRangeTable({
      z1: selectedIonZ,
      m1: selectedIonMass,
      elements: elems,
      densityGPerCm3: selectedTargetMat.densityGPerCm3,
      phase: selectedTargetMat.phase,
      compoundCorr: selectedTargetMat.compoundCorr,
      unit: 1,
      eMinKeV: 0,
      eMaxKeV: 0,
      customEnergiesKeV: [energyKeV],
    })[0];
    const lss = calcLssCompactRange(
      selectedIonZ,
      selectedIonMass,
      energyKeV,
      elems,
      selectedTargetMat.densityGPerCm3
    );
    const emp = calcEmpiricalPowerLawRange(
      selectedIonZ,
      selectedIonMass,
      energyKeV,
      elems,
      selectedTargetMat.densityGPerCm3
    );
    return { pral, lss, emp };
  }, [selectedIonZ, selectedIonMass, energyKeV, selectedTargetMat]);

  const runTrimMonteCarloBenchmark = (ionCount = 400) => {
    const estDepthA = Math.max(
      400,
      Math.ceil(
        (currentPointMetrics.pral.projectedRangeA +
          4.8 * currentPointMetrics.pral.longitudinalStragglingA) /
          100
      ) * 100
    );
    const cfg: TrimSetupConfig = {
      title: `${selectedIonMeta.symbol} (${energyKeV} keV) into ${selectedTargetMat.name}`,
      ion: {
        z1: selectedIonZ,
        symbol: selectedIonMeta.symbol,
        name: selectedIonMeta.name,
        massAmu: selectedIonMass,
        energyKeV,
        angleDeg: 0,
      },
      calculationMode: 1,
      totalIons: ionCount,
      randomSeed: 98765,
      braggCorrection: 1.0,
      autoSaveNumber: 10000,
      plotType: 0,
      plotXMinA: 0,
      plotXMaxA: estDepthA,
      zones: [{ layerIndex: 0, endDepthA: estDepthA }],
      layers: [
        {
          id: 'bench-layer',
          name: selectedTargetMat.name,
          widthA: estDepthA,
          densityGPerCm3: selectedTargetMat.densityGPerCm3,
          phase: selectedTargetMat.phase,
          compoundCorr: selectedTargetMat.compoundCorr,
          elements: selectedTargetMat.elements.map((e) => ({ ...e })),
        },
      ],
    };
    const sim = new TrimSimulator(cfg);
    const snap = sim.runBatch(ionCount);
    setMcSnapshot(snap);
    setMcRunKey(`${selectedIonZ}-${energyKeV}-${selectedTargetMat.id}`);
  };

  const currentRunMatches =
    mcSnapshot !== null &&
    mcRunKey === `${selectedIonZ}-${energyKeV}-${selectedTargetMat.id}`;

  // Build 100-bin depth comparison arrays
  const depthComparison = useMemo(() => {
    const activeMc = currentRunMatches ? mcSnapshot : null;
    const maxDepthA = activeMc
      ? activeMc.binDepthsA[activeMc.binDepthsA.length - 1] +
        (activeMc.binDepthsA[1] - activeMc.binDepthsA[0]) * 0.5
      : Math.max(
          400,
          currentPointMetrics.pral.projectedRangeA +
            5 * currentPointMetrics.pral.longitudinalStragglingA
        );

    const depthsA = activeMc
      ? activeMc.binDepthsA
      : Array.from({ length: 100 }, (_, i) => ((i + 0.5) / 100) * maxDepthA);

    const rpA = activeMc?.rangeMoments.meanA || currentPointMetrics.pral.projectedRangeA;
    const sigA =
      activeMc?.rangeMoments.stragglingA ||
      currentPointMetrics.pral.longitudinalStragglingA;
    // Heuristic default skewness if MC hasn't been run yet: light ions negative skew, heavy ions positive skew
    const defaultSkew = selectedIonZ <= 7 ? -0.45 : selectedIonZ >= 25 ? 0.45 : -0.1;
    const skew = activeMc ? activeMc.rangeMoments.skewness : defaultSkew;
    const kurt = activeMc ? Math.max(2.9, activeMc.rangeMoments.kurtosis) : 3.4;

    const gaussCm3 = evaluateGaussianProfile(
      depthsA,
      doseCm2,
      currentPointMetrics.pral.projectedRangeA,
      currentPointMetrics.pral.longitudinalStragglingA
    );
    const halfGaussCm3 = evaluateJoinedHalfGaussianProfile(
      depthsA,
      doseCm2,
      rpA,
      sigA,
      skew
    );
    const pearsonCm3 = evaluatePearsonIVProfile(
      depthsA,
      doseCm2,
      rpA,
      sigA,
      skew,
      kurt
    );
    const mcCm3 = activeMc
      ? activeMc.histograms.ionRange.map((v) => v * doseCm2)
      : null;

    return {
      depthsA,
      depthsNm: depthsA.map((d) => d * 0.1),
      gaussCm3,
      halfGaussCm3,
      pearsonCm3,
      mcCm3,
      rpA,
      sigA,
      skew,
      kurt,
    };
  }, [
    currentRunMatches,
    mcSnapshot,
    currentPointMetrics,
    doseCm2,
    selectedIonZ,
  ]);

  // === Tab 3: Junction Depth & Sheet Resistance ===
  const junctionResult = useMemo(() => {
    let chosenProfile = depthComparison.pearsonCm3;
    if (profileSource === 'mc' && depthComparison.mcCm3) {
      chosenProfile = depthComparison.mcCm3;
    } else if (profileSource === 'gaussian') {
      chosenProfile = depthComparison.gaussCm3;
    }

    return predictJunctionAndSheetResistance({
      depthsA: depthComparison.depthsA,
      concentrationCm3: chosenProfile,
      dopantType,
      backgroundDopingCm3: bgDopingCm3,
      activationEfficiency: activationPct / 100,
      solidSolubilityCm3,
      temperatureK: tempK,
      annealDiffusionLengthNm: annealDiffNm,
    });
  }, [
    depthComparison,
    profileSource,
    dopantType,
    bgDopingCm3,
    activationPct,
    solidSolubilityCm3,
    tempK,
    annealDiffNm,
  ]);

  // Thermal Anneal sensitivity curve (sqrt(2Dt) from 0 .. 40 nm)
  const annealSweep = useMemo(() => {
    const baseConc =
      profileSource === 'mc' && depthComparison.mcCm3
        ? depthComparison.mcCm3
        : profileSource === 'gaussian'
        ? depthComparison.gaussCm3
        : depthComparison.pearsonCm3;
    const lengthsNm = [0, 2, 5, 10, 15, 20, 30, 40];
    return lengthsNm.map((len) => {
      const r = predictJunctionAndSheetResistance({
        depthsA: depthComparison.depthsA,
        concentrationCm3: baseConc,
        dopantType,
        backgroundDopingCm3: bgDopingCm3,
        activationEfficiency: activationPct / 100,
        solidSolubilityCm3,
        temperatureK: tempK,
        annealDiffusionLengthNm: len,
      });
      return {
        diffLenNm: len,
        xjNm: r.junctionDepthNm,
        rsOhmSq: Number.isFinite(r.sheetResistanceOhmPerSq)
          ? r.sheetResistanceOhmPerSq
          : 0,
      };
    });
  }, [
    depthComparison,
    profileSource,
    dopantType,
    bgDopingCm3,
    activationPct,
    solidSolubilityCm3,
    tempK,
  ]);

  return (
    <div className="space-y-6">
      {/* Header Strip */}
      <div className="bg-slate-900/85 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">
              Semiconductor TCAD, Compact Models & Junction Analytics
            </h1>
            <p className="text-xs text-slate-400">
              Thin-Film Stopping Benchmarks · LSS/Power-Law/Pearson IV vs SRIM · Junction Depth (x<sub>j</sub>) & Sheet Resistance (R<sub>s</sub>)
            </p>
          </div>
        </div>

        {/* Common Ion & Energy Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={`${selectedIonZ}:${selectedIonMass}`}
            onChange={(e) => {
              const [zStr, mStr] = e.target.value.split(':');
              const z = Number(zStr);
              const m = Number(mStr);
              setSelectedIonZ(z);
              setSelectedIonMass(m);
              const matched = COMMON_DOPANT_IONS.find((i) => i.z1 === z);
              if (matched) setDopantType(matched.polarity);
            }}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-semibold"
          >
            {COMMON_DOPANT_IONS.map((ion) => (
              <option key={ion.label} value={`${ion.z1}:${ion.m1}`}>
                {ion.label}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1">
            <span className="text-[11px] text-slate-400">Energy:</span>
            <input
              type="number"
              step="any"
              min={0.5}
              max={5000}
              value={energyKeV}
              onChange={(e) => setEnergyKeV(Math.max(0.5, Number(e.target.value)))}
              className="w-16 bg-transparent text-xs font-mono text-cyan-300 font-bold focus:outline-none"
            />
            <span className="text-[11px] text-slate-400">keV</span>
          </div>

          {[5, 20, 50, 100, 200].map((ePreset) => (
            <button
              key={ePreset}
              onClick={() => setEnergyKeV(ePreset)}
              className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                Math.abs(energyKeV - ePreset) < 1e-6
                  ? 'bg-cyan-600 text-white border-cyan-500'
                  : 'bg-slate-950 text-slate-400 hover:text-white border-slate-800'
              }`}
            >
              {ePreset} keV
            </button>
          ))}
        </div>
      </div>

      {/* Sub-Navigation Pills */}
      <div className="flex flex-wrap gap-2">
        {[
          {
            id: 'benchmarks' as AnalyticsTab,
            label: '1. Semiconductor Thin-Film Benchmarks',
            desc: 'Rp, ΔRp, ΔRy, Se/Sn across 20 Films',
            icon: <Layers className="w-4 h-4" />,
          },
          {
            id: 'models' as AnalyticsTab,
            label: '2. Compact / Empirical vs SRIM Comparison',
            desc: 'LSS, Empirical Power-Law, Gaussian, Pearson IV vs PRAL & TRIM MC',
            icon: <GitCompare className="w-4 h-4" />,
          },
          {
            id: 'junction' as AnalyticsTab,
            label: '3. Junction Depth (xj) & Sheet Resistance (Rs)',
            desc: 'Activation, Solid Solubility, Caughey-Thomas Mobility & RTA Budget',
            icon: <Gauge className="w-4 h-4" />,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-left transition-all ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-indigo-600/90 to-cyan-600/90 border-cyan-400 text-white shadow-lg shadow-cyan-950/50'
                : 'bg-slate-900/75 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            {tab.icon}
            <div>
              <div className="text-xs font-bold">{tab.label}</div>
              <div
                className={`text-[10px] ${
                  activeTab === tab.id ? 'text-cyan-100' : 'text-slate-400'
                }`}
              >
                {tab.desc}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* === TAB 1: THIN FILM BENCHMARKS === */}
      {activeTab === 'benchmarks' && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-white">
                Projected Range, Straggle & Masking Metrics for {selectedIonMeta.symbol} ({selectedIonMass.toFixed(2)} u) @ {energyKeV} keV
              </h2>
              <p className="text-xs text-slate-400">
                Computed via exact STOP2003 + SNUC03 + PRAL92 coupled differential transport equations across 20 semiconductor films.
              </p>
            </div>
            <button
              onClick={handleExportBenchmarksCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Table CSV</span>
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Semiconductor / Film</th>
                  <th className="py-2.5 px-3">Formula</th>
                  <th className="py-2.5 px-3 text-right">Density (g/cm³)</th>
                  <th className="py-2.5 px-3 text-right">Rp (nm)</th>
                  <th className="py-2.5 px-3 text-right">Long. ΔRp (nm)</th>
                  <th className="py-2.5 px-3 text-right">Lat. ΔRy (nm)</th>
                  <th className="py-2.5 px-3 text-right">99.9% Mask (nm)</th>
                  <th className="py-2.5 px-3 text-right">Se (eV/Å)</th>
                  <th className="py-2.5 px-3 text-right">Sn (eV/Å)</th>
                  <th className="py-2.5 px-3 text-right">Nuclear %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono">
                {benchmarkRows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2 px-3 font-sans font-semibold text-white">
                      {row.name}
                    </td>
                    <td className="py-2 px-3 text-cyan-300">{row.formula}</td>
                    <td className="py-2 px-3 text-right text-slate-300">
                      {row.densityGPerCm3.toFixed(3)}
                    </td>
                    <td className="py-2 px-3 text-right text-cyan-300 font-bold">
                      {row.projectedRangeNm.toFixed(1)}
                    </td>
                    <td className="py-2 px-3 text-right text-amber-300">
                      {(row.longitudinalStraggleA * 0.1).toFixed(1)}
                    </td>
                    <td className="py-2 px-3 text-right text-purple-300">
                      {(row.lateralStraggleA * 0.1).toFixed(1)}
                    </td>
                    <td className="py-2 px-3 text-right text-emerald-300 font-semibold">
                      {row.masking999ThicknessNm.toFixed(1)}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-300">
                      {row.seEvPerA.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-300">
                      {row.snEvPerA.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-400">
                      {row.nuclearFractionPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === TAB 2: COMPACT / EMPIRICAL VS SRIM === */}
      {activeTab === 'models' && (
        <div className="space-y-5">
          {/* Control & Monte Carlo Runner Bar */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400 font-semibold">Target Film:</span>
                <select
                  value={targetMatId}
                  onChange={(e) => setTargetMatId(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="active-layer-1">
                    Active Setup Layer 1 ({trimConfig.layers[0]?.name})
                  </option>
                  {SEMICONDUCTOR_MATERIALS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} [{m.formula}, ρ={m.densityGPerCm3}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400 font-semibold">Implant Dose Φ:</span>
                <select
                  value={doseCm2}
                  onChange={(e) => setDoseCm2(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-mono text-emerald-300"
                >
                  {[1e12, 1e13, 5e13, 1e14, 5e14, 1e15, 3e15, 5e15, 1e16].map((d) => (
                    <option key={d} value={d}>
                      {d.toExponential(0)} ions/cm²
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => setUseLogScaleY(!useLogScaleY)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-300 hover:text-white font-semibold"
              >
                Y-Axis: {useLogScaleY ? 'Logarithmic' : 'Linear'}
              </button>
            </div>

            <button
              onClick={() => runTrimMonteCarloBenchmark(400)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-xs font-bold shadow-lg"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>
                {currentRunMatches
                  ? `Re-Run 3D TRIM MC (${mcSnapshot?.completedIons} ions)`
                  : 'Run 3D TRIM MC Benchmark (400 Ions)'}
              </span>
            </button>
          </div>

          {/* Side-by-Side Comparison Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Plot A: Rp vs Energy across models */}
            <AnalyticsPlotCard
              title={`Projected Range Rp vs Energy (${selectedIonMeta.symbol} → ${selectedTargetMat.formula})`}
              subtitle="SRIM PRAL92 ODE vs LSS Compact Analytical vs Empirical Power-Law + Live TRIM MC Marker"
              xLabel="Implant Energy (keV)"
              yLabel="Projected Range Rp (nm)"
              xValues={energySweepData.map((d) => d.energyKeV)}
              logY={false}
              series={[
                {
                  name: 'SRIM PRAL92 ODE',
                  color: '#22d3ee',
                  data: energySweepData.map((d) => d.pralRpNm),
                },
                {
                  name: 'LSS Compact Theory',
                  color: '#f59e0b',
                  data: energySweepData.map((d) => d.lssRpNm),
                },
                {
                  name: 'Empirical Power-Law',
                  color: '#10b981',
                  data: energySweepData.map((d) => d.empRpNm),
                },
              ]}
              highlightPoint={
                currentRunMatches && mcSnapshot
                  ? {
                      x: energyKeV,
                      y: mcSnapshot.rangeMoments.meanA * 0.1,
                      label: `TRIM MC: ${(mcSnapshot.rangeMoments.meanA * 0.1).toFixed(1)} nm`,
                    }
                  : undefined
              }
            />

            {/* Plot B: Depth Concentration Profile C(x) comparing Gaussian / Half-Gaussian / Pearson IV / TRIM MC */}
            <AnalyticsPlotCard
              title={`Dopant Concentration Profile (Φ = ${doseCm2.toExponential(0)} cm⁻² @ ${energyKeV} keV)`}
              subtitle="Gaussian (2-Moment) vs Joined Half-Gaussian (3-Moment) vs Pearson IV (4-Moment) vs TRIM MC"
              xLabel="Depth x (nm)"
              yLabel="Concentration (atoms/cm³)"
              xValues={depthComparison.depthsNm}
              logY={useLogScaleY}
              series={[
                ...(depthComparison.mcCm3
                  ? [
                      {
                        name: 'Actual TRIM 3D MC',
                        color: '#22d3ee',
                        data: depthComparison.mcCm3,
                      },
                    ]
                  : []),
                {
                  name: 'Pearson Type IV (4-Moment)',
                  color: '#a855f7',
                  data: depthComparison.pearsonCm3,
                },
                {
                  name: 'Joined Half-Gaussian (3-Moment)',
                  color: '#f59e0b',
                  data: depthComparison.halfGaussCm3,
                },
                {
                  name: 'Gaussian (2-Moment)',
                  color: '#10b981',
                  data: depthComparison.gaussCm3,
                },
              ]}
            />
          </div>

          {/* Numerical Deviation Table & Equations Box */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-white">
                Quantitative Model Comparison @ {energyKeV} keV ({selectedIonMeta.symbol} → {selectedTargetMat.name})
              </h3>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3 font-sans">Range / Transport Model</th>
                      <th className="py-2 px-3 text-right">Rp (nm)</th>
                      <th className="py-2 px-3 text-right">ΔRp (nm)</th>
                      <th className="py-2 px-3 text-right">ΔRy (nm)</th>
                      <th className="py-2 px-3 text-right">Δ vs PRAL92</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    <tr className="bg-cyan-950/20">
                      <td className="py-2 px-3 font-sans font-bold text-cyan-300">
                        SRIM PRAL92 ODE (Reference)
                      </td>
                      <td className="py-2 px-3 text-right font-bold">
                        {(currentPointMetrics.pral.projectedRangeA * 0.1).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {(currentPointMetrics.pral.longitudinalStragglingA * 0.1).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {(currentPointMetrics.pral.lateralStragglingA * 0.1).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-400">0.0%</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-sans font-semibold text-amber-300">
                        LSS Compact Theory (ε = {currentPointMetrics.lss.reducedEnergy.toFixed(2)})
                      </td>
                      <td className="py-2 px-3 text-right">
                        {(currentPointMetrics.lss.projectedRangeA * 0.1).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {(currentPointMetrics.lss.stragglingA * 0.1).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {(currentPointMetrics.lss.lateralStragglingA * 0.1).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right text-amber-300">
                        {(
                          ((currentPointMetrics.lss.projectedRangeA -
                            currentPointMetrics.pral.projectedRangeA) /
                            Math.max(1e-6, currentPointMetrics.pral.projectedRangeA)) *
                          100
                        ).toFixed(1)}
                        %
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-sans font-semibold text-emerald-300">
                        Empirical Power-Law (Sze / Gibbons)
                      </td>
                      <td className="py-2 px-3 text-right">
                        {(currentPointMetrics.emp.projectedRangeA * 0.1).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {(currentPointMetrics.emp.stragglingA * 0.1).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {(currentPointMetrics.emp.lateralStragglingA * 0.1).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right text-emerald-300">
                        {(
                          ((currentPointMetrics.emp.projectedRangeA -
                            currentPointMetrics.pral.projectedRangeA) /
                            Math.max(1e-6, currentPointMetrics.pral.projectedRangeA)) *
                          100
                        ).toFixed(1)}
                        %
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-sans font-semibold text-purple-300">
                        Actual 3D TRIM Monte Carlo
                      </td>
                      {currentRunMatches && mcSnapshot ? (
                        <>
                          <td className="py-2 px-3 text-right font-bold text-purple-200">
                            {(mcSnapshot.rangeMoments.meanA * 0.1).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {(mcSnapshot.rangeMoments.stragglingA * 0.1).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {(mcSnapshot.lateralMoments.meanA * 0.1).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right text-purple-300">
                            {(
                              ((mcSnapshot.rangeMoments.meanA -
                                currentPointMetrics.pral.projectedRangeA) /
                                Math.max(1e-6, currentPointMetrics.pral.projectedRangeA)) *
                              100
                            ).toFixed(1)}
                            %
                          </td>
                        </>
                      ) : (
                        <td
                          colSpan={4}
                          className="py-2 px-3 text-right text-slate-500 font-sans italic"
                        >
                          Click "Run 3D TRIM MC Benchmark" above to populate live Monte Carlo moments
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="xl:col-span-5 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-2.5 text-xs">
              <div className="flex items-center gap-2 text-cyan-300 font-bold">
                <BookOpen className="w-4 h-4" />
                <span>Physical Compact & Distribution Equations</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="font-semibold text-amber-300">1. LSS Reduced Range Scaling</div>
                <div className="font-mono text-[11px] text-slate-300">
                  ε = 32.53 M₂ E / [Z₁Z₂(M₁+M₂)(Z₁²/³+Z₂²/³)¹/²], Rₚ ≈ R / (1 + M₂ / 3M₁)
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="font-semibold text-emerald-300">2. Empirical Power-Law (Bragg–Kleeman)</div>
                <div className="font-mono text-[11px] text-slate-300">
                  Rₚ(Å) ≈ 155 · E^α · M₂^0.25 / [ρ · (Z₁^0.48 + 0.15 Z₂^0.48)]
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="font-semibold text-purple-300">3. Pearson Type IV (4-Moment Hofker ODE)</div>
                <div className="font-mono text-[11px] text-slate-300">
                  d(ln f)/du = (u − a)/(b₀ + b₁u + b₂u²), u = x − Rₚ (γ={depthComparison.skew.toFixed(2)}, β₂={depthComparison.kurt.toFixed(2)})
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === TAB 3: JUNCTION DEPTH & SHEET RESISTANCE === */}
      {activeTab === 'junction' && (
        <div className="space-y-5">
          {/* TCAD Parameter Grid */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <div>
                  <h2 className="text-sm font-bold text-white">
                    Metallurgical Junction Depth (x<sub>j</sub>) & 4-Point Probe Sheet Resistance (R<sub>s</sub>) Predictor
                  </h2>
                  <p className="text-xs text-slate-400">
                    Integrates active carrier concentration min(η·C(x), C<sub>sol</sub>) × Caughey–Thomas mobility μ(N<sub>tot</sub>, T) down to background N<sub>B</sub>
                  </p>
                </div>
              </div>

              <button
                onClick={() => runTrimMonteCarloBenchmark(500)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Simulate 500-Ion TRIM MC Profile</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Profile Source
                </label>
                <select
                  value={profileSource}
                  onChange={(e) =>
                    setProfileSource(e.target.value as 'mc' | 'pearson' | 'gaussian')
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white"
                >
                  <option value="pearson">Pearson IV (4-Moment)</option>
                  <option value="gaussian">Gaussian (PRAL92)</option>
                  <option value="mc" disabled={!currentRunMatches}>
                    TRIM 3D MC {currentRunMatches ? '(Ready)' : '(Run MC first)'}
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Carrier Type
                </label>
                <select
                  value={dopantType}
                  onChange={(e) => setDopantType(e.target.value as 'n' | 'p')}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white font-semibold"
                >
                  <option value="p">p-type (Holes)</option>
                  <option value="n">n-type (Electrons)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Dose Φ (cm⁻²)
                </label>
                <select
                  value={doseCm2}
                  onChange={(e) => setDoseCm2(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono text-cyan-300"
                >
                  {[5e12, 1e13, 5e13, 1e14, 5e14, 1e15, 3e15, 5e15, 1e16].map((d) => (
                    <option key={d} value={d}>
                      {d.toExponential(0)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Background N<sub>B</sub> (cm⁻³)
                </label>
                <select
                  value={bgDopingCm3}
                  onChange={(e) => setBgDopingCm3(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono text-amber-300"
                >
                  {[1e14, 1e15, 5e15, 1e16, 5e16, 1e17, 5e17, 1e18].map((b) => (
                    <option key={b} value={b}>
                      {b.toExponential(0)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Activation η (%)
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={5}
                  value={activationPct}
                  onChange={(e) =>
                    setActivationPct(Math.max(1, Math.min(100, Number(e.target.value))))
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-emerald-300"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Solubility Limit (cm⁻³)
                </label>
                <select
                  value={solidSolubilityCm3}
                  onChange={(e) => setSolidSolubilityCm3(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono text-purple-300"
                >
                  {[5e19, 1e20, 2e20, 3e20, 5e20, 1e21].map((s) => (
                    <option key={s} value={s}>
                      {s.toExponential(0)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  RTA √(2Dt) (nm) / T(K)
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={annealDiffNm}
                    onChange={(e) =>
                      setAnnealDiffNm(Math.max(0, Number(e.target.value)))
                    }
                    title="Thermal anneal diffusion length sqrt(2Dt) in nm"
                    className="w-1/2 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono text-white"
                  />
                  <input
                    type="number"
                    min={200}
                    max={500}
                    step={10}
                    value={tempK}
                    onChange={(e) =>
                      setTempK(Math.max(200, Math.min(500, Number(e.target.value))))
                    }
                    title="Measurement Temperature (K)"
                    className="w-1/2 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono text-slate-300"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Junction & Sheet Resistance KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Junction Depth x<sub>j</sub>
              </div>
              <div className="text-xl font-extrabold font-mono text-cyan-300 mt-0.5">
                {junctionResult.junctionDepthNm.toFixed(1)} nm
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                = {junctionResult.junctionDepthUm.toFixed(4)} µm
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Sheet Resistance R<sub>s</sub>
              </div>
              <div className="text-xl font-extrabold font-mono text-emerald-300 mt-0.5">
                {Number.isFinite(junctionResult.sheetResistanceOhmPerSq)
                  ? `${junctionResult.sheetResistanceOhmPerSq.toFixed(1)} Ω/□`
                  : 'Open (>10⁹)'}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                ρ̄ ={' '}
                {Number.isFinite(junctionResult.effectiveResistivityOhmCm)
                  ? `${(junctionResult.effectiveResistivityOhmCm * 1e3).toFixed(2)} mΩ·cm`
                  : 'N/A'}
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Active Carrier Dose Φ<sub>act</sub>
              </div>
              <div className="text-xl font-extrabold font-mono text-amber-300 mt-0.5">
                {junctionResult.activeDoseCm2.toExponential(2)}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                {junctionResult.activatedFractionPct.toFixed(1)}% of Implanted Dose
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Peak / Surface Conc.
              </div>
              <div className="text-lg font-extrabold font-mono text-purple-300 mt-0.5">
                {junctionResult.peakConcentrationCm3.toExponential(2)}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                @ {junctionResult.peakDepthNm.toFixed(1)} nm (C₀={' '}
                {junctionResult.surfaceConcentrationCm3.toExponential(1)})
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Avg Carrier Mobility μ̄
              </div>
              <div className="text-xl font-extrabold font-mono text-sky-300 mt-0.5">
                {junctionResult.averageMobilityCm2Vs.toFixed(1)}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                cm²/(V·s) @ {tempK} K
              </div>
            </div>
          </div>

          {/* Plots: Active Carrier Profile + RTA Sensitivity */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <AnalyticsPlotCard
              title={`Activated Carrier vs Total Dopant Profile (xj = ${junctionResult.junctionDepthNm.toFixed(1)} nm)`}
              subtitle="Log concentration vs depth showing solid solubility saturation & background NB crossing"
              xLabel="Depth x (nm)"
              yLabel="Concentration (cm⁻³)"
              xValues={depthComparison.depthsNm}
              logY={true}
              series={[
                {
                  name: 'Total Chemical Dopant',
                  color: '#22d3ee',
                  data: junctionResult.effectiveProfileCm3,
                },
                {
                  name: 'Electrically Active Carriers',
                  color: '#10b981',
                  data: junctionResult.activeProfileCm3,
                },
                {
                  name: `Background Doping NB (${bgDopingCm3.toExponential(0)})`,
                  color: '#f43f5e',
                  data: depthComparison.depthsNm.map(() => bgDopingCm3),
                },
              ]}
              highlightPoint={{
                x: junctionResult.junctionDepthNm,
                y: bgDopingCm3,
                label: `xj = ${junctionResult.junctionDepthNm.toFixed(1)} nm`,
              }}
            />

            <AnalyticsPlotCard
              title="RTA Thermal Budget Sensitivity: Sheet Resistance Rs vs √(2Dt)"
              subtitle="Impact of post-implant thermal diffusion broadening on 4-point-probe sheet resistance"
              xLabel="RTA Diffusion Length √(2Dt) (nm)"
              yLabel="Sheet Resistance Rs (Ω/□)"
              xValues={annealSweep.map((a) => a.diffLenNm)}
              logY={false}
              series={[
                {
                  name: 'Sheet Resistance Rs (Ω/□)',
                  color: '#f59e0b',
                  data: annealSweep.map((a) => a.rsOhmSq),
                },
              ]}
              highlightPoint={
                Number.isFinite(junctionResult.sheetResistanceOhmPerSq)
                  ? {
                      x: annealDiffNm,
                      y: junctionResult.sheetResistanceOhmPerSq,
                      label: `Current: ${junctionResult.sheetResistanceOhmPerSq.toFixed(1)} Ω/□`,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

interface AnalyticsPlotCardProps {
  title: string;
  subtitle: string;
  xLabel: string;
  yLabel: string;
  xValues: number[];
  logY: boolean;
  series: { name: string; color: string; data: number[] }[];
  highlightPoint?: { x: number; y: number; label: string };
}

const AnalyticsPlotCard: React.FC<AnalyticsPlotCardProps> = ({
  title,
  subtitle,
  xLabel,
  yLabel,
  xValues,
  logY,
  series,
  highlightPoint,
}) => {
  const width = 640;
  const height = 280;
  const padL = 68;
  const padR = 20;
  const padT = 20;
  const padB = 38;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const minX = xValues[0] ?? 0;
  const maxX = Math.max(minX + 1e-6, xValues[xValues.length - 1] ?? 100);

  const { minY, maxY, transformY } = useMemo(() => {
    if (!logY) {
      let mx = 0;
      for (const s of series) {
        for (const v of s.data) if (v > mx) mx = v;
      }
      const hi = mx > 0 ? mx * 1.1 : 1.0;
      return {
        minY: 0,
        maxY: hi,
        transformY: (v: number) => Math.max(0, v),
      };
    } else {
      let mx = -Infinity;
      for (const s of series) {
        for (const v of s.data) {
          if (v > 0) {
            const lv = Math.log10(v);
            if (lv > mx) mx = lv;
          }
        }
      }
      const hiLog = Number.isFinite(mx) ? Math.ceil(mx * 2) / 2 : 21;
      const loLog = hiLog - 7; // 7 decades dynamic range
      return {
        minY: loLog,
        maxY: hiLog,
        transformY: (v: number) => Math.max(loLog, Math.log10(Math.max(1e-30, v))),
      };
    }
  }, [series, logY]);

  const scaleX = (x: number) => padL + ((x - minX) / (maxX - minX)) * plotW;
  const scaleY = (yVal: number) => {
    const t = transformY(yVal);
    const norm = (t - minY) / Math.max(1e-9, maxY - minY);
    return padT + plotH * (1 - Math.max(0, Math.min(1, norm)));
  };

  const handleExportSvg = () => {
    const svg = generateSvgLinePlot({
      title,
      xLabel,
      yLabel,
      series: series.map((s) => ({
        name: s.name,
        color: s.color,
        x: xValues,
        y: s.data,
      })),
      theme: 'academic',
    });
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    downloadFile(svg, `${safeName}.svg`, 'image/svg+xml;charset=utf-8');
  };

  const handleExportCsv = () => {
    const headers = [xLabel, ...series.map((s) => s.name)];
    const rows = xValues.map((xv, i) => [xv, ...series.map((s) => s.data[i] ?? 0)]);
    const csv = generateCsvData(headers, rows);
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    downloadFile(csv, `${safeName}.csv`, 'text/csv;charset=utf-8');
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-[11px] text-slate-400">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExportSvg}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold border border-slate-700"
          >
            <Download className="w-3 h-3 text-cyan-400" />
            <span>SVG</span>
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold border border-slate-700"
          >
            <FileSpreadsheet className="w-3 h-3 text-emerald-400" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px]">
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

      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[270px]">
          {[0, 0.25, 0.5, 0.75, 1.0].map((f, idx) => {
            const yPos = padT + plotH * (1 - f);
            const rawLabelVal = logY
              ? Math.pow(10, minY + (maxY - minY) * f)
              : minY + (maxY - minY) * f;
            return (
              <g key={idx}>
                <line
                  x1={padL}
                  y1={yPos}
                  x2={width - padR}
                  y2={yPos}
                  stroke="#1e293b"
                  strokeDasharray="3 3"
                />
                <text
                  x={padL - 6}
                  y={yPos + 3}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {logY || rawLabelVal >= 1000 || (rawLabelVal > 0 && rawLabelVal < 0.01)
                    ? rawLabelVal.toExponential(1)
                    : rawLabelVal.toFixed(1)}
                </text>
              </g>
            );
          })}

          {[0, 0.25, 0.5, 0.75, 1.0].map((f, idx) => {
            const xVal = minX + (maxX - minX) * f;
            const xPos = padL + plotW * f;
            return (
              <text
                key={idx}
                x={xPos}
                y={height - 16}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="10"
                fontFamily="monospace"
              >
                {xVal.toFixed(1)}
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

          {series.map((s) => {
            const pts = xValues
              .map((xv, i) => {
                const v = s.data[i] ?? 0;
                return `${scaleX(xv).toFixed(1)},${scaleY(v).toFixed(1)}`;
              })
              .join(' ');
            return (
              <polyline
                key={s.name}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                points={pts}
              />
            );
          })}

          {highlightPoint &&
            highlightPoint.x >= minX &&
            highlightPoint.x <= maxX && (
              <g>
                <line
                  x1={scaleX(highlightPoint.x)}
                  y1={padT}
                  x2={scaleX(highlightPoint.x)}
                  y2={padT + plotH}
                  stroke="#f43f5e"
                  strokeDasharray="4 2"
                  strokeWidth={1.2}
                />
                <circle
                  cx={scaleX(highlightPoint.x)}
                  cy={scaleY(highlightPoint.y)}
                  r={4.5}
                  fill="#f43f5e"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                />
                <text
                  x={Math.min(width - 110, Math.max(padL + 6, scaleX(highlightPoint.x) + 6))}
                  y={Math.max(padT + 14, scaleY(highlightPoint.y) - 8)}
                  fill="#fda4af"
                  fontSize="10"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {highlightPoint.label}
                </text>
              </g>
            )}
        </svg>
      </div>
    </div>
  );
};
