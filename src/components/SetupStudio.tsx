import React, { useState, useMemo, useEffect } from 'react';
import {
  Atom,
  Layers,
  Plus,
  Trash2,
  BookMarked,
  Calculator,
  Download,
  Upload,
  Play,
  Table2,
  Sparkles,
  Check,
  Cpu,
  FlaskConical,
  Scale,
} from 'lucide-react';
import {
  SCOEF03,
  COMPOUNDS,
  DEMO_PRESETS,
  getElementByZ,
  getPTableElement,
  type CompoundEntry,
  type DemoPreset,
} from '../data';
import {
  SEMICONDUCTOR_MATERIALS,
  type SemiconductorMaterial,
  type SemiMaterialCategory,
} from '../data/semiconductorMaterials';
import {
  SEMICONDUCTOR_PRESETS,
  type PresetCategory,
} from '../data/semiconductorPresets';
import {
  parseChemicalFormula,
  formatFormulaString,
  computeLayerAtomicDensity,
} from '../physics/formulaParser';
import { BOND_DEFINITIONS, calcCoreAndBond } from '../physics/stopping';
import {
  generateTrimIn,
  parseTrimIn,
  generateSimFile,
  parseSimFile,
  generateTrimDat,
  parseTrimDat,
} from '../physics/formats';
import { PTableModal } from './PTableModal';
import type {
  TrimCalcMode,
  TrimElementConfig,
  TrimLayerConfig,
  TrimSetupConfig,
} from '../physics/types';

interface SetupStudioProps {
  config: TrimSetupConfig;
  onChangeConfig: (next: TrimSetupConfig) => void;
  onLaunchCockpit: () => void;
}

export const SetupStudio: React.FC<SetupStudioProps> = ({
  config,
  onChangeConfig,
  onLaunchCockpit,
}) => {
  const [activeLayerIdx, setActiveLayerIdx] = useState<number>(0);
  const [compoundSearch, setCompoundSearch] = useState<string>('');
  const [compoundCategory, setCompoundCategory] = useState<string>('ALL');
  const [presetTab, setPresetTab] = useState<'semi' | 'srim'>('semi');
  const [presetCategory, setPresetCategory] = useState<'ALL' | PresetCategory>('ALL');
  const [materialTab, setMaterialTab] = useState<'semi' | 'legacy'>('semi');
  const [semiMatCategory, setSemiMatCategory] = useState<'ALL' | SemiMaterialCategory>('ALL');
  const [semiMatSearch, setSemiMatSearch] = useState<string>('');
  const [formulaInput, setFormulaInput] = useState<string>('');
  const [formulaError, setFormulaError] = useState<string | null>(null);
  const [showCabModal, setShowCabModal] = useState<boolean>(false);
  const [cabBonds, setCabBonds] = useState<number[]>(new Array(18).fill(0));
  const [cabCompoundName, setCabCompoundName] = useState<string>('');
  const [ptableTarget, setPtableTarget] = useState<
    | { mode: 'ion' }
    | { mode: 'layerElement'; layerIdx: number; elemIdx: number }
    | null
  >(null);

  const ionPtable = useMemo(
    () => getPTableElement(config.ion.z1),
    [config.ion.z1]
  );

  const categories = useMemo(() => {
    const s = new Set<string>(['ALL']);
    for (const c of COMPOUNDS) {
      if (c.category) s.add(c.category);
    }
    return Array.from(s);
  }, []);

  const filteredCompounds = useMemo(() => {
    const q = compoundSearch.trim().toLowerCase();
    return COMPOUNDS.filter((c) => {
      if (compoundCategory !== 'ALL' && c.category !== compoundCategory) {
        return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.comments.toLowerCase().includes(q)
      );
    }).slice(0, 120);
  }, [compoundSearch, compoundCategory]);

  const filteredSemiMaterials = useMemo(() => {
    const q = semiMatSearch.trim().toLowerCase();
    return SEMICONDUCTOR_MATERIALS.filter((m) => {
      if (semiMatCategory !== 'ALL' && m.category !== semiMatCategory) {
        return false;
      }
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.formula.toLowerCase().includes(q) ||
        m.processNote.toLowerCase().includes(q)
      );
    });
  }, [semiMatCategory, semiMatSearch]);

  const filteredSemiPresets = useMemo(() => {
    return SEMICONDUCTOR_PRESETS.filter((p) => {
      if (presetCategory !== 'ALL' && p.category !== presetCategory) {
        return false;
      }
      return true;
    });
  }, [presetCategory]);

  const currentLayer: TrimLayerConfig =
    config.layers[activeLayerIdx] || config.layers[0];

  const currentFormula = useMemo(
    () => (currentLayer ? formatFormulaString(currentLayer.elements) : ''),
    [currentLayer]
  );

  const currentAtomicDensity = useMemo(
    () =>
      currentLayer
        ? computeLayerAtomicDensity(currentLayer.densityGPerCm3, currentLayer.elements)
        : 0,
    [currentLayer]
  );

  useEffect(() => {
    setFormulaInput(currentFormula);
    setFormulaError(null);
  }, [activeLayerIdx, currentFormula]);

  const cabPreview = useMemo(() => {
    if (!currentLayer) return null;
    return calcCoreAndBond(
      config.ion.z1,
      currentLayer.elements.map((e) => ({ z: e.z, stoich: e.stoich })),
      cabBonds,
      currentLayer.densityGPerCm3,
      cabCompoundName || currentLayer.name
    );
  }, [config.ion.z1, currentLayer, cabBonds, cabCompoundName]);

  const updateIon = (patch: Partial<TrimSetupConfig['ion']>) => {
    onChangeConfig({
      ...config,
      ion: { ...config.ion, ...patch },
    });
  };

  const selectIonZ = (z1: number, customMass?: number) => {
    const el = getElementByZ(z1);
    updateIon({
      z1,
      symbol: el.symbol,
      name: el.name,
      massAmu: customMass ?? el.naturalWeight,
    });
  };

  const updateLayer = (
    layerIdx: number,
    patch: Partial<TrimLayerConfig>
  ) => {
    const nextLayers = config.layers.map((l, idx) =>
      idx === layerIdx ? { ...l, ...patch } : l
    );
    let cumDepth = 0;
    const zones = nextLayers.map((l, idx) => {
      cumDepth += l.widthA;
      return { layerIndex: idx, endDepthA: cumDepth };
    });
    onChangeConfig({
      ...config,
      layers: nextLayers,
      zones,
      plotXMaxA: cumDepth,
    });
  };

  const addLayer = () => {
    const si = getElementByZ(14);
    const newLayer: TrimLayerConfig = {
      id: `layer-${Date.now()}`,
      name: `Layer ${config.layers.length + 1} (Si)`,
      widthA: 500,
      densityGPerCm3: si.solidDensity,
      phase: 0,
      compoundCorr: 1.0,
      elements: [
        {
          z: 14,
          symbol: 'Si',
          name: 'Silicon',
          stoich: 1.0,
          massAmu: si.naturalWeight,
          displacementEv: 15.0,
          latticeBindingEv: 2.0,
          surfaceBindingEv: 4.7,
        },
      ],
    };
    const nextLayers = [...config.layers, newLayer];
    let cumDepth = 0;
    const zones = nextLayers.map((l, idx) => {
      cumDepth += l.widthA;
      return { layerIndex: idx, endDepthA: cumDepth };
    });
    onChangeConfig({
      ...config,
      layers: nextLayers,
      zones,
      plotXMaxA: cumDepth,
    });
    setActiveLayerIdx(nextLayers.length - 1);
  };

  const removeLayer = (idx: number) => {
    if (config.layers.length <= 1) return;
    const nextLayers = config.layers.filter((_, i) => i !== idx);
    let cumDepth = 0;
    const zones = nextLayers.map((l, i) => {
      cumDepth += l.widthA;
      return { layerIndex: i, endDepthA: cumDepth };
    });
    onChangeConfig({
      ...config,
      layers: nextLayers,
      zones,
      plotXMaxA: cumDepth,
    });
    setActiveLayerIdx(Math.max(0, Math.min(activeLayerIdx, nextLayers.length - 1)));
  };

  const applyCompoundToLayer = (comp: CompoundEntry) => {
    const elements: TrimElementConfig[] = comp.elements.map((ce) => {
      const sc = getElementByZ(ce.z);
      const pt = getPTableElement(ce.z);
      // If compound uses mass percent, convert wt% to atomic stoich
      const stoich = comp.isMassPercent
        ? ce.stoich / Math.max(1.0, sc.naturalWeight)
        : ce.stoich;
      return {
        z: ce.z,
        symbol: sc.symbol,
        name: sc.name,
        stoich: Number(stoich.toPrecision(5)),
        massAmu: sc.naturalWeight,
        displacementEv: pt?.defaultEd || 15.0,
        latticeBindingEv: pt?.defaultEb || 3.0,
        surfaceBindingEv: pt?.defaultEs || sc.heatSubl || 2.0,
      };
    });

    const bonds =
      comp.bonds && comp.bonds.length === 18
        ? [...comp.bonds]
        : new Array(18).fill(0);
    setCabBonds(bonds);
    setCabCompoundName(comp.name);

    const cab = calcCoreAndBond(
      config.ion.z1,
      comp.elements,
      bonds,
      comp.density,
      comp.name
    );

    updateLayer(activeLayerIdx, {
      name: comp.name,
      densityGPerCm3: comp.density || 1.0,
      phase: comp.state === 1 ? 1 : 0,
      compoundCorr: Number(cab.recommendedCorr.toFixed(4)),
      elements,
    });
  };

  const applySemiMaterialToLayer = (mat: SemiconductorMaterial) => {
    setCabCompoundName(mat.name);
    updateLayer(activeLayerIdx, {
      name: mat.name.split(' (')[0],
      densityGPerCm3: mat.densityGPerCm3,
      phase: mat.phase,
      compoundCorr: mat.compoundCorr,
      elements: mat.elements.map((e) => ({ ...e })),
    });
    setFormulaError(null);
  };

  const handleApplyFormula = () => {
    const parsed = parseChemicalFormula(formulaInput);
    if (!parsed) {
      setFormulaError('Invalid formula (e.g. SiO2, Si0.7Ge0.3, Si1.2N1.0, Hf0.5Zr0.5O2)');
      return;
    }
    const existingByZ = new Map(currentLayer.elements.map((el) => [el.z, el]));
    const nextElems: TrimElementConfig[] = parsed.map((p) => {
      const prev = existingByZ.get(p.z);
      const sc = getElementByZ(p.z);
      const pt = getPTableElement(p.z);
      return {
        z: p.z,
        symbol: sc.symbol,
        name: sc.name,
        stoich: p.stoich,
        massAmu: prev?.massAmu ?? sc.naturalWeight,
        displacementEv: prev?.displacementEv ?? pt?.defaultEd ?? 20.0,
        latticeBindingEv: prev?.latticeBindingEv ?? pt?.defaultEb ?? 2.5,
        surfaceBindingEv: prev?.surfaceBindingEv ?? pt?.defaultEs ?? sc.heatSubl ?? 2.5,
      };
    });
    updateLayer(activeLayerIdx, { elements: nextElems });
    setFormulaError(null);
  };

  const handleNormalizeStoich = () => {
    if (!currentLayer || currentLayer.elements.length === 0) return;
    const sum = currentLayer.elements.reduce((acc, el) => acc + Math.max(0, el.stoich), 0);
    if (sum <= 0) return;
    const nextElems = currentLayer.elements.map((el) => ({
      ...el,
      stoich: Number((el.stoich / sum).toFixed(4)),
    }));
    updateLayer(activeLayerIdx, { elements: nextElems });
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result || '');
      const fname = file.name.toLowerCase();
      if (fname.endsWith('.sim')) {
        onChangeConfig(parseSimFile(txt));
      } else if (fname.endsWith('.dat')) {
        const events = parseTrimDat(txt);
        onChangeConfig({
          ...config,
          calculationMode: 4,
          totalIons: events.length || config.totalIons,
          customTrimDatEvents: events,
        });
      } else {
        onChangeConfig(parseTrimIn(txt));
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & File I/O Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">
              Target & Ion Setup Studio (SRIMKorea + TIN.exe)
            </h1>
            <p className="text-xs text-slate-400">
              Configure Incident Ion, Isotopes, Multi-Layer Target, 386 Compounds & Ziegler-Manoyan Core-and-Bond (CAB) Corrections
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700">
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Import TRIM.IN / .sim / TRIM.DAT</span>
            <input
              type="file"
              accept=".in,.sim,.dat,.txt,.d00,.d01,.d02,.d03,.d04,.d05,.d06,.d07,.d08,.d09,.d10,.d11"
              onChange={handleFileImport}
              className="hidden"
            />
          </label>

          <button
            onClick={() => downloadFile('TRIM.IN', generateTrimIn(config))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export TRIM.IN</span>
          </button>

          <button
            onClick={() =>
              downloadFile(
                `${config.ion.symbol}_target.sim`,
                generateSimFile(config)
              )
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>Export SRIMKorea (.sim)</span>
          </button>

          <button
            onClick={onLaunchCockpit}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Launch 3D TRIM Simulation</span>
          </button>
        </div>
      </div>

      {/* Main 12-Col Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 4 Cols: Incident Ion & Calculation Mode */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Atom className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-white">
                  1. Incident Ion & Beam Kinetics
                </h2>
              </div>
              <button
                onClick={() => setPtableTarget({ mode: 'ion' })}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-semibold"
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Pick from PTable</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-400 mb-1">
                  Incident Ion Element (Z₁ = 1..92)
                </label>
                <select
                  value={config.ion.z1}
                  onChange={(e) => selectIonZ(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-medium"
                >
                  {SCOEF03.map((el) => (
                    <option key={el.z} value={el.z}>
                      Z={el.z} — {el.symbol} ({el.name}) · {el.naturalWeight} u
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Isotope / Atomic Mass (amu)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={config.ion.massAmu}
                  onChange={(e) =>
                    updateIon({ massAmu: Math.max(0.5, Number(e.target.value)) })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Known Isotopes ({ionPtable?.isotopes.length || 0})
                </label>
                <select
                  value=""
                  onChange={(e) => {
                    const w = parseFloat(e.target.value);
                    if (w > 0) updateIon({ massAmu: w });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="">
                    Select Isotope / Natural ({ionPtable?.naturalWeight} u)...
                  </option>
                  {ionPtable && (
                    <option value={ionPtable.maiWeight}>
                      MAI {ionPtable.symbol}-{ionPtable.maiMass} ({ionPtable.maiWeight} u)
                    </option>
                  )}
                  {ionPtable?.isotopes.map((iso, idx) => (
                    <option key={idx} value={iso.weight}>
                      {iso.isoName} — {iso.weight} u (
                      {iso.abundance > 0 ? `${iso.abundance}%` : iso.halfLife})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Ion Energy (keV)
                </label>
                <input
                  type="number"
                  step="any"
                  value={config.ion.energyKeV}
                  onChange={(e) =>
                    updateIon({
                      energyKeV: Math.max(0.01, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Angle of Incidence (0°–89.9°)
                </label>
                <input
                  type="number"
                  step="1"
                  min={0}
                  max={89.9}
                  value={config.ion.angleDeg}
                  onChange={(e) =>
                    updateIon({
                      angleDeg: Math.max(
                        0,
                        Math.min(89.9, Number(e.target.value))
                      ),
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Total Ions to Simulate (Max 1,000,000)
                </label>
                <input
                  type="number"
                  step="100"
                  min={1}
                  max={1000000}
                  value={config.totalIons}
                  onChange={(e) =>
                    onChangeConfig({
                      ...config,
                      totalIons: Math.min(
                        1000000,
                        Math.max(1, Math.round(Number(e.target.value) || 1))
                      ),
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {[
                    { label: '100', val: 100 },
                    { label: '1k', val: 1000 },
                    { label: '10k', val: 10000 },
                    { label: '100k', val: 100000 },
                    { label: '1M', val: 1000000 },
                  ].map((q) => (
                    <button
                      key={q.val}
                      type="button"
                      onClick={() =>
                        onChangeConfig({ ...config, totalIons: q.val })
                      }
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                        config.totalIons === q.val
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200 font-bold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Random Number Seed
                </label>
                <input
                  type="number"
                  value={config.randomSeed}
                  onChange={(e) =>
                    onChangeConfig({
                      ...config,
                      randomSeed: Math.round(Number(e.target.value)) || 98765,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
            </div>

            {/* 4 Calculation Modes */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <label className="block text-[11px] text-slate-400 font-semibold">
                TRIM Damage & Cascade Calculation Mode
              </label>
              {[
                {
                  mode: 1 as TrimCalcMode,
                  title: '(1) Ion Distribution & Quick Damage (Kinchin-Pease)',
                  desc: 'Fastest mode using NRT analytical damage energy partition per PKA.',
                },
                {
                  mode: 2 as TrimCalcMode,
                  title: '(2) Detailed Calculation with Full Damage Cascades',
                  desc: 'Follows every displaced target recoil in 3D until energy drops below Es.',
                },
                {
                  mode: 3 as TrimCalcMode,
                  title: '(3) Monolayer Collision Steps / Surface Sputtering',
                  desc: 'Forces exact monolayer steps without free-flight jumps for precision sputtering.',
                },
                {
                  mode: 4 as TrimCalcMode,
                  title: '(4) Special Calculation from TRIM.DAT Event Stream',
                  desc: 'Simulates custom recoil/ion events defined by (Z1, E, X, Y, Z, CosX, CosY, CosZ).',
                },
              ].map((m) => (
                <button
                  key={m.mode}
                  onClick={() =>
                    onChangeConfig({ ...config, calculationMode: m.mode })
                  }
                  className={`w-full text-left p-2.5 rounded-xl border transition-all ${
                    config.calculationMode === m.mode
                      ? 'bg-cyan-950/50 border-cyan-500 text-white'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-semibold flex items-center justify-between">
                    <span>{m.title}</span>
                    {config.calculationMode === m.mode && (
                      <Check className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {m.desc}
                  </div>
                </button>
              ))}

              {config.calculationMode === 4 && (
                <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-300">
                      Custom TRIM.DAT Events ({config.customTrimDatEvents?.length || 0})
                    </span>
                    <button
                      onClick={() => {
                        const sampleEvents = [
                          { name: 'PKA01', z1: 14, energyEv: 5000, xA: 100, yA: 0, zA: 0, cosX: 0.95, cosY: 0.312, cosZ: 0 },
                          { name: 'PKA02', z1: 8, energyEv: 3500, xA: 150, yA: 20, zA: -10, cosX: 0.9, cosY: -0.435, cosZ: 0 },
                          { name: 'PKA03', z1: 6, energyEv: 8000, xA: 50, yA: -15, zA: 15, cosX: 0.98, cosY: 0.14, cosZ: 0.14 },
                        ];
                        onChangeConfig({
                          ...config,
                          totalIons: sampleEvents.length,
                          customTrimDatEvents: sampleEvents,
                        });
                      }}
                      className="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                    >
                      Load Sample Recoil Events
                    </button>
                  </div>
                  {config.customTrimDatEvents &&
                    config.customTrimDatEvents.length > 0 && (
                      <button
                        onClick={() =>
                          downloadFile(
                            'TRIM.DAT',
                            generateTrimDat(
                              config.title,
                              config.customTrimDatEvents!
                            )
                          )
                        }
                        className="w-full py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-cyan-300"
                      >
                        Download TRIM.DAT
                      </button>
                    )}
                </div>
              )}
            </div>
          </div>

          {/* Semiconductor Process & Official SRIM Demo Presets */}
          <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-white">
                  Implantation Preset Library
                </h2>
              </div>
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
                <button
                  onClick={() => setPresetTab('semi')}
                  className={`px-2 py-1 rounded-md font-semibold transition-colors ${
                    presetTab === 'semi'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Semiconductor ({SEMICONDUCTOR_PRESETS.length})
                </button>
                <button
                  onClick={() => setPresetTab('srim')}
                  className={`px-2 py-1 rounded-md font-semibold transition-colors ${
                    presetTab === 'srim'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  SRIM Demos ({DEMO_PRESETS.length})
                </button>
              </div>
            </div>

            {presetTab === 'semi' ? (
              <>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      'ALL',
                      'Si CMOS FEOL',
                      'Power (SiC / GaN)',
                      'III-V / Photonics',
                      'Display / Mask / FIB',
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setPresetCategory(cat)}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                        presetCategory === cat
                          ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-1.5 max-h-[300px] overflow-y-auto pr-1">
                  {filteredSemiPresets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        onChangeConfig({
                          ...preset.config,
                          layers: preset.config.layers.map((l) => ({
                            ...l,
                            elements: l.elements.map((e) => ({ ...e })),
                          })),
                        });
                        setActiveLayerIdx(0);
                      }}
                      className="text-left p-2.5 rounded-lg bg-slate-950/75 hover:bg-slate-800 border border-slate-800/90 hover:border-cyan-500/40 transition-colors flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-100 leading-snug">
                          <span className="text-cyan-400 font-mono mr-1.5">
                            [{preset.processTag}]
                          </span>
                          {preset.title}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">
                          {preset.summary}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {preset.config.ion.symbol} ({preset.config.ion.energyKeV} keV,{' '}
                          {preset.config.ion.angleDeg}°) · {preset.config.layers.length}{' '}
                          Layer(s) · Mode {preset.config.calculationMode}
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-semibold mt-0.5">
                        Load
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 max-h-[300px] overflow-y-auto pr-1">
                {DEMO_PRESETS.map((demo: DemoPreset) => (
                  <button
                    key={demo.id}
                    onClick={() => {
                      onChangeConfig(parseTrimIn(demo.rawTrimIn));
                      setActiveLayerIdx(0);
                    }}
                    className="text-left p-2 rounded-lg bg-slate-950/70 hover:bg-slate-800 border border-slate-800/80 transition-colors flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-200">
                        <span className="text-amber-400 font-mono mr-1.5">
                          [{demo.id}]
                        </span>
                        {demo.title}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Ion Z={demo.ionZ} ({demo.energyKeV} keV, {demo.angleDeg}°) ·{' '}
                        {demo.layers.length} Layer(s) · Mode {demo.calcMode}
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 font-semibold">
                      Load
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center/Right 8 Cols: Multi-Layer Target Builder + Compound Dictionary + CAB */}
        <div className="lg:col-span-8 space-y-6">
          {/* Multi-Layer Stack Visualizer & Selector */}
          <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white">
                  2. Multi-Layer Target Architecture ({config.layers.length}{' '}
                  {config.layers.length === 1 ? 'Layer' : 'Layers'}, Total Depth ={' '}
                  {config.layers.reduce((a, b) => a + b.widthA, 0).toLocaleString()}{' '}
                  Å)
                </h2>
                <p className="text-xs text-slate-400">
                  Click any layer slab below to edit its stoichiometry, density, phase, and displacement/binding energies (E<sub>d</sub>, E<sub>b</sub>, E<sub>s</sub>)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCabModal(!showCabModal)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/40 text-xs font-semibold"
                >
                  <Calculator className="w-3.5 h-3.5" />
                  <span>Core-and-Bond (CAB) Calculator</span>
                </button>
                <button
                  onClick={addLayer}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Target Layer</span>
                </button>
              </div>
            </div>

            {/* Visual Layer Stack Bar */}
            <div className="flex rounded-xl overflow-hidden border border-slate-700 h-16 bg-slate-950">
              {config.layers.map((layer, idx) => {
                const totalW =
                  config.layers.reduce((a, b) => a + b.widthA, 0) || 1;
                const pct = Math.max(12, (layer.widthA / totalW) * 100);
                const isSelected = idx === activeLayerIdx;
                return (
                  <button
                    key={layer.id}
                    onClick={() => setActiveLayerIdx(idx)}
                    style={{ width: `${pct}%` }}
                    className={`h-full p-2 border-r border-slate-800 last:border-r-0 flex flex-col justify-between text-left transition-all ${
                      isSelected
                        ? 'bg-gradient-to-b from-cyan-900/80 to-blue-950/90 ring-2 ring-inset ring-cyan-400'
                        : 'bg-slate-900/70 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[11px] font-bold text-white truncate">
                        L{idx + 1}: {layer.name}
                      </span>
                      <span className="text-[10px] px-1.5 rounded bg-slate-950/70 text-cyan-300 font-mono">
                        {layer.phase === 1 ? 'GAS' : 'SOLID'}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-300 font-mono truncate">
                      {layer.widthA} Å · {layer.densityGPerCm3} g/cm³ · CAB=
                      {layer.compoundCorr}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Active Layer Editor */}
            {currentLayer && (
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Layer {activeLayerIdx + 1} Name / Description
                    </label>
                    <input
                      type="text"
                      value={currentLayer.name}
                      onChange={(e) =>
                        updateLayer(activeLayerIdx, { name: e.target.value })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Width (Å)
                    </label>
                    <input
                      type="number"
                      step="10"
                      value={currentLayer.widthA}
                      onChange={(e) =>
                        updateLayer(activeLayerIdx, {
                          widthA: Math.max(1, Number(e.target.value)),
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-mono"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-slate-400">
                        Density (g/cm³)
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateLayer(activeLayerIdx, {
                              densityGPerCm3: Number(
                                Math.max(0.001, currentLayer.densityGPerCm3 * 0.95).toFixed(4)
                              ),
                            })
                          }
                          title="Reduce density by 5% (e.g. porous / PECVD film)"
                          className="px-1 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300"
                        >
                          -5%
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateLayer(activeLayerIdx, {
                              densityGPerCm3: Number(
                                (currentLayer.densityGPerCm3 * 1.05).toFixed(4)
                              ),
                            })
                          }
                          title="Increase density by 5% (e.g. annealed / dense film)"
                          className="px-1 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300"
                        >
                          +5%
                        </button>
                      </div>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={currentLayer.densityGPerCm3}
                      onChange={(e) =>
                        updateLayer(activeLayerIdx, {
                          densityGPerCm3: Math.max(
                            0.00001,
                            Number(e.target.value)
                          ),
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-300 font-mono"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Compound Corr.
                      </label>
                      <input
                        type="number"
                        step="0.005"
                        value={currentLayer.compoundCorr}
                        onChange={(e) =>
                          updateLayer(activeLayerIdx, {
                            compoundCorr: Math.max(0.1, Number(e.target.value)),
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-300 font-mono"
                      />
                    </div>
                    <button
                      onClick={() =>
                        updateLayer(activeLayerIdx, {
                          phase: currentLayer.phase === 0 ? 1 : 0,
                        })
                      }
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold ${
                        currentLayer.phase === 1
                          ? 'bg-purple-950 border-purple-500 text-purple-200'
                          : 'bg-slate-900 border-slate-700 text-slate-300'
                      }`}
                      title="Toggle Solid (0) vs Gas (1) Phase"
                    >
                      {currentLayer.phase === 1 ? 'GAS' : 'SOLID'}
                    </button>
                    {config.layers.length > 1 && (
                      <button
                        onClick={() => removeLayer(activeLayerIdx)}
                        className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-700/50"
                        title="Delete Layer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Formula Quick Editor & Live Atomic Density Bar */}
                <div className="p-2.5 rounded-lg bg-slate-900/75 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-cyan-300 font-semibold">
                      <FlaskConical className="w-3.5 h-3.5" />
                      <span>Formula:</span>
                    </div>
                    <input
                      type="text"
                      value={formulaInput}
                      onChange={(e) => {
                        setFormulaInput(e.target.value);
                        setFormulaError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleApplyFormula();
                      }}
                      placeholder="e.g. SiO2, Si0.7Ge0.3, Si1.2N1.0"
                      className="bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-md px-2.5 py-1 text-xs font-mono text-white w-48"
                    />
                    <button
                      type="button"
                      onClick={handleApplyFormula}
                      className="px-2.5 py-1 rounded-md bg-cyan-600/80 hover:bg-cyan-500 text-white text-[11px] font-semibold transition-colors"
                    >
                      Apply Formula
                    </button>
                    {formulaError && (
                      <span className="text-[11px] text-rose-400">
                        {formulaError}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono">
                    <div>
                      <span className="text-slate-400">Empirical: </span>
                      <span className="text-cyan-300 font-bold">{currentFormula}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Atomic Density: </span>
                      <span className="text-emerald-300 font-bold">
                        {currentAtomicDensity.toExponential(3)} atoms/cm³
                      </span>
                    </div>
                  </div>
                </div>

                {/* Elements Table in Active Layer */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-300">
                      Atomic Stoichiometry & Damage Thresholds (E<sub>d</sub>, E<sub>b</sub>, E<sub>s</sub>)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleNormalizeStoich}
                        title="Normalize atomic stoichiometries so their sum equals 1.0"
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs"
                      >
                        <Scale className="w-3.5 h-3.5" />
                        <span>Normalize (Sum=1)</span>
                      </button>
                      <button
                        onClick={() => {
                          const oEl = getElementByZ(8);
                          const nextElems: TrimElementConfig[] = [
                            ...currentLayer.elements,
                            {
                              z: 8,
                              symbol: 'O',
                              name: 'Oxygen',
                              stoich: 1.0,
                              massAmu: oEl.naturalWeight,
                              displacementEv: 28.0,
                              latticeBindingEv: 3.0,
                              surfaceBindingEv: 2.0,
                            },
                          ];
                          updateLayer(activeLayerIdx, { elements: nextElems });
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Element to Layer</span>
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                          <th className="py-1.5 px-2">Element</th>
                          <th className="py-1.5 px-2">Stoich</th>
                          <th className="py-1.5 px-2">Mass (amu)</th>
                          <th className="py-1.5 px-2">Displacement Ed (eV)</th>
                          <th className="py-1.5 px-2">Lattice Binding Eb (eV)</th>
                          <th className="py-1.5 px-2">Surface Binding Es (eV)</th>
                          <th className="py-1.5 px-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentLayer.elements.map((el, eIdx) => (
                          <tr
                            key={eIdx}
                            className="border-b border-slate-900/80"
                          >
                            <td className="py-1.5 px-2">
                              <div className="flex items-center gap-1">
                                <select
                                  value={el.z}
                                  onChange={(ev) => {
                                    const nz = Number(ev.target.value);
                                    const sc = getElementByZ(nz);
                                    const pt = getPTableElement(nz);
                                    const next = currentLayer.elements.map(
                                      (item, k) =>
                                        k === eIdx
                                          ? {
                                              ...item,
                                              z: nz,
                                              symbol: sc.symbol,
                                              name: sc.name,
                                              massAmu: sc.naturalWeight,
                                              displacementEv:
                                                pt?.defaultEd || 15.0,
                                              latticeBindingEv:
                                                pt?.defaultEb || 3.0,
                                              surfaceBindingEv:
                                                pt?.defaultEs ||
                                                sc.heatSubl ||
                                                2.0,
                                            }
                                          : item
                                    );
                                    updateLayer(activeLayerIdx, {
                                      elements: next,
                                    });
                                  }}
                                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                >
                                  {SCOEF03.map((s) => (
                                    <option key={s.z} value={s.z}>
                                      {s.z} {s.symbol} ({s.name})
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() =>
                                    setPtableTarget({
                                      mode: 'layerElement',
                                      layerIdx: activeLayerIdx,
                                      elemIdx: eIdx,
                                    })
                                  }
                                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300"
                                  title="Pick from Periodic Table"
                                >
                                  <Table2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="number"
                                step="0.05"
                                min="0.0001"
                                value={el.stoich}
                                onChange={(ev) => {
                                  const next = currentLayer.elements.map(
                                    (item, k) =>
                                      k === eIdx
                                        ? {
                                            ...item,
                                            stoich: Math.max(
                                              0.0001,
                                              Number(ev.target.value)
                                            ),
                                          }
                                        : item
                                  );
                                  updateLayer(activeLayerIdx, {
                                    elements: next,
                                  });
                                }}
                                className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-white"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="number"
                                step="0.01"
                                value={el.massAmu}
                                onChange={(ev) => {
                                  const next = currentLayer.elements.map(
                                    (item, k) =>
                                      k === eIdx
                                        ? {
                                            ...item,
                                            massAmu: Math.max(
                                              0.5,
                                              Number(ev.target.value)
                                            ),
                                          }
                                        : item
                                  );
                                  updateLayer(activeLayerIdx, {
                                    elements: next,
                                  });
                                }}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-slate-200"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="number"
                                step="1"
                                value={el.displacementEv}
                                onChange={(ev) => {
                                  const next = currentLayer.elements.map(
                                    (item, k) =>
                                      k === eIdx
                                        ? {
                                            ...item,
                                            displacementEv: Math.max(
                                              1,
                                              Number(ev.target.value)
                                            ),
                                          }
                                        : item
                                  );
                                  updateLayer(activeLayerIdx, {
                                    elements: next,
                                  });
                                }}
                                className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-amber-300"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="number"
                                step="0.5"
                                value={el.latticeBindingEv}
                                onChange={(ev) => {
                                  const next = currentLayer.elements.map(
                                    (item, k) =>
                                      k === eIdx
                                        ? {
                                            ...item,
                                            latticeBindingEv: Math.max(
                                              0,
                                              Number(ev.target.value)
                                            ),
                                          }
                                        : item
                                  );
                                  updateLayer(activeLayerIdx, {
                                    elements: next,
                                  });
                                }}
                                className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-cyan-300"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="number"
                                step="0.1"
                                value={el.surfaceBindingEv}
                                onChange={(ev) => {
                                  const next = currentLayer.elements.map(
                                    (item, k) =>
                                      k === eIdx
                                        ? {
                                            ...item,
                                            surfaceBindingEv: Math.max(
                                              0.1,
                                              Number(ev.target.value)
                                            ),
                                          }
                                        : item
                                  );
                                  updateLayer(activeLayerIdx, {
                                    elements: next,
                                  });
                                }}
                                className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-emerald-300"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              {currentLayer.elements.length > 1 && (
                                <button
                                  onClick={() => {
                                    const next = currentLayer.elements.filter(
                                      (_, k) => k !== eIdx
                                    );
                                    updateLayer(activeLayerIdx, {
                                      elements: next,
                                    });
                                  }}
                                  className="p-1 text-rose-400 hover:text-rose-300"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Interactive Core-and-Bond (CAB) Calculator Panel */}
            {showCabModal && cabPreview && (
              <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-indigo-200">
                      Ziegler-Manoyan Core-and-Bond (CAB) Calculator (TIN.exe)
                    </h3>
                    <p className="text-xs text-slate-400">
                      18 Chemical Bond Stopping Powers + 11 Closed-Shell Cores at 125 keV/u Proton
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      updateLayer(activeLayerIdx, {
                        compoundCorr: Number(
                          cabPreview.recommendedCorr.toFixed(4)
                        ),
                      })
                    }
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
                  >
                    Apply CAB Correction ({cabPreview.recommendedCorr.toFixed(4)})
                  </button>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {BOND_DEFINITIONS.map((b) => (
                    <div
                      key={b.index}
                      className="p-2 rounded bg-slate-950/80 border border-slate-800"
                    >
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span className="font-bold text-indigo-300">
                          {b.label}
                        </span>
                        <span className="font-mono">
                          {b.stopping125keV.toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={cabBonds[b.index]}
                        onChange={(e) => {
                          const next = [...cabBonds];
                          next[b.index] = Math.max(0, Number(e.target.value));
                          setCabBonds(next);
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-white"
                      />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
                    <div className="text-[10px] text-slate-400">
                      S_CAB (125 keV/u H)
                    </div>
                    <div className="font-mono text-indigo-300 font-bold">
                      {cabPreview.sCab.toFixed(4)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
                    <div className="text-[10px] text-slate-400">
                      SOLID Binding Corr.
                    </div>
                    <div className="font-mono text-emerald-300 font-bold">
                      {cabPreview.solidBindingCorr.toFixed(4)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
                    <div className="text-[10px] text-slate-400">
                      GAS Binding Corr.
                    </div>
                    <div className="font-mono text-cyan-300 font-bold">
                      {cabPreview.gasBindingCorr.toFixed(4)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
                    <div className="text-[10px] text-slate-400">
                      Phase Corr. Ratio
                    </div>
                    <div className="font-mono text-amber-300 font-bold">
                      {cabPreview.targetPhaseCorr.toFixed(4)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Semiconductor Thin-Film Library & 386-Entry Compound Dictionary */}
          <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <BookMarked className="w-4 h-4 text-emerald-400" />
                <div>
                  <h2 className="text-sm font-bold text-white">
                    3. Semiconductor Thin-Film & Compound Library
                  </h2>
                  <p className="text-xs text-slate-400">
                    Click any film to apply its default formula & density to Layer{' '}
                    {activeLayerIdx + 1} — then freely fine-tune stoichiometry or
                    process density above
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  onClick={() => setMaterialTab('semi')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    materialTab === 'semi'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Semiconductor Films ({SEMICONDUCTOR_MATERIALS.length})
                </button>
                <button
                  onClick={() => setMaterialTab('legacy')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    materialTab === 'legacy'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Compound.dat + SRIMKorea ({COMPOUNDS.length})
                </button>
              </div>
            </div>

            {materialTab === 'semi' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <select
                    value={semiMatCategory}
                    onChange={(e) =>
                      setSemiMatCategory(e.target.value as 'ALL' | SemiMaterialCategory)
                    }
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    <option value="ALL">All Semiconductor Categories</option>
                    <option value="Substrates & Group IV">Substrates & Group IV</option>
                    <option value="Dielectrics (Oxide / Nitride / High-k / Low-k)">
                      Dielectrics (Oxide / Nitride / High-k / Low-k)
                    </option>
                    <option value="Metals / Barriers / Silicides">
                      Metals / Barriers / Silicides
                    </option>
                    <option value="III-V / Wide-Bandgap / Display / Memory">
                      III-V / Wide-Bandgap / Display / Memory
                    </option>
                    <option value="Photoresists & Hardmasks">
                      Photoresists & Hardmasks
                    </option>
                  </select>

                  <input
                    type="text"
                    placeholder="Search SiO2, HfO2, SiGe, TiN, SiCOH, IGZO, SiC, GaN..."
                    value={semiMatSearch}
                    onChange={(e) => setSemiMatSearch(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white w-72"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[340px] overflow-y-auto pr-1">
                  {filteredSemiMaterials.map((mat) => (
                    <button
                      key={mat.id}
                      onClick={() => applySemiMaterialToLayer(mat)}
                      className="text-left p-3 rounded-xl bg-slate-950/80 hover:bg-slate-800/90 border border-slate-800/90 hover:border-emerald-500/50 transition-all flex flex-col justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-bold text-white leading-snug">
                            {mat.name}
                          </span>
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono text-[10px] font-bold">
                            {mat.formula}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-emerald-300 mt-1">
                          ρ = {mat.densityGPerCm3.toFixed(3)} g/cm³{' '}
                          <span className="text-[10px] text-slate-400 font-sans">
                            ({mat.densityRange})
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                          {mat.processNote}
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">
                        {mat.category}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <select
                    value={compoundCategory}
                    onChange={(e) => setCompoundCategory(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Search SiO2, GaN, Kapton, Water, PMMA, Resist..."
                    value={compoundSearch}
                    onChange={(e) => setCompoundSearch(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white w-64"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[300px] overflow-y-auto pr-1">
                  {filteredCompounds.map((comp, idx) => {
                    const hasBonds =
                      comp.bonds && comp.bonds.some((b) => b > 0);
                    return (
                      <button
                        key={`${comp.name}-${idx}`}
                        onClick={() => applyCompoundToLayer(comp)}
                        className="text-left p-2.5 rounded-xl bg-slate-950/75 hover:bg-slate-800/90 border border-slate-800/90 hover:border-emerald-500/40 transition-all flex flex-col justify-between"
                      >
                        <div>
                          <div className="text-xs font-bold text-white truncate">
                            {comp.name}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {comp.category} · ρ={comp.density} g/cm³ ·{' '}
                            {comp.state === 1 ? 'Gas' : 'Solid'}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px]">
                          <span className="font-mono text-cyan-300">
                            {comp.elements
                              .map(
                                (e) =>
                                  `${getElementByZ(e.z).symbol}${
                                    e.stoich !== 1 ? e.stoich : ''
                                  }`
                              )
                              .join(' ')}
                          </span>
                          {hasBonds && (
                            <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              CAB Bonds
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Periodic Table Picker Modal */}
      {ptableTarget && (
        <PTableModal
          isModal
          initialZ={
            ptableTarget.mode === 'ion'
              ? config.ion.z1
              : config.layers[ptableTarget.layerIdx]?.elements[
                  ptableTarget.elemIdx
                ]?.z || 14
          }
          onClose={() => setPtableTarget(null)}
          onSelectElement={(z, massAmu) => {
            if (ptableTarget.mode === 'ion') {
              selectIonZ(z, massAmu);
            } else {
              const sc = getElementByZ(z);
              const pt = getPTableElement(z);
              const layer = config.layers[ptableTarget.layerIdx];
              if (layer) {
                const nextElems = layer.elements.map((item, k) =>
                  k === ptableTarget.elemIdx
                    ? {
                        ...item,
                        z,
                        symbol: sc.symbol,
                        name: sc.name,
                        massAmu: massAmu ?? sc.naturalWeight,
                        displacementEv: pt?.defaultEd || 15.0,
                        latticeBindingEv: pt?.defaultEb || 3.0,
                        surfaceBindingEv:
                          pt?.defaultEs || sc.heatSubl || 2.0,
                      }
                    : item
                );
                updateLayer(ptableTarget.layerIdx, { elements: nextElems });
              }
            }
            setPtableTarget(null);
          }}
        />
      )}
    </div>
  );
};
