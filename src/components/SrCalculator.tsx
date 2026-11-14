import React, { useState, useMemo } from 'react';
import {
  Activity,
  Download,
  Upload,
  Plus,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import {
  SCOEF03,
  COMPOUNDS,
  getElementByZ,
} from '../data';
import {
  calcStoppingAndRangeTable,
  formatRangeWithAutoUnit,
} from '../physics/pral';
import {
  generateSrIn,
  parseSrIn,
  generateSrTableTxt,
} from '../physics/formats';
import {
  STOPPING_UNIT_LABELS,
  type SRInput,
  type StoppingUnit,
  type TrimSetupConfig,
} from '../physics/types';

interface SrCalculatorProps {
  trimConfig: TrimSetupConfig;
}

export const SrCalculator: React.FC<SrCalculatorProps> = ({ trimConfig }) => {
  const [srInput, setSrInput] = useState<SRInput>(() => {
    const l0 = trimConfig.layers[0];
    return {
      title: `${trimConfig.ion.symbol} in ${l0?.name || 'Silicon'}`,
      z1: trimConfig.ion.z1,
      m1: trimConfig.ion.massAmu,
      elements: l0
        ? l0.elements.map((e) => ({
            z: e.z,
            symbol: e.symbol,
            name: e.name,
            stoich: e.stoich,
            mass: e.massAmu,
          }))
        : [{ z: 14, symbol: 'Si', name: 'Silicon', stoich: 1, mass: 28.086 }],
      densityGPerCm3: l0 ? l0.densityGPerCm3 : 2.3212,
      phase: l0 ? l0.phase : 0,
      compoundCorr: l0 ? l0.compoundCorr : 1.0,
      unit: 1,
      eMinKeV: 10.0,
      eMaxKeV: 10000.0,
      outputFilename: 'SR_OUTPUT.TXT',
    };
  });

  const [useCustomList, setUseCustomList] = useState<boolean>(false);
  const [customEnergyText, setCustomEnergyText] = useState<string>(
    '1.02, 2.55, 3.98, 10, 50, 100, 500, 1000'
  );
  const [plotMode, setPlotMode] = useState<'stopping' | 'range'>('stopping');
  const [logScaleX, setLogScaleX] = useState<boolean>(true);
  const [logScaleY, setLogScaleY] = useState<boolean>(false);

  const effectiveInput: SRInput = useMemo(() => {
    if (!useCustomList) return srInput;
    const nums = customEnergyText
      .split(/[\s,;]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return {
      ...srInput,
      eMinKeV: 0,
      eMaxKeV: 0,
      customEnergiesKeV: nums.length > 0 ? nums : [10, 100, 1000],
    };
  }, [srInput, useCustomList, customEnergyText]);

  const rows = useMemo(
    () => calcStoppingAndRangeTable(effectiveInput),
    [effectiveInput]
  );

  const syncFromTrimSetup = () => {
    const l0 = trimConfig.layers[0];
    if (!l0) return;
    setSrInput({
      ...srInput,
      title: `${trimConfig.ion.symbol} in ${l0.name}`,
      z1: trimConfig.ion.z1,
      m1: trimConfig.ion.massAmu,
      elements: l0.elements.map((e) => ({
        z: e.z,
        symbol: e.symbol,
        name: e.name,
        stoich: e.stoich,
        mass: e.massAmu,
      })),
      densityGPerCm3: l0.densityGPerCm3,
      phase: l0.phase,
      compoundCorr: l0.compoundCorr,
    });
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

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">
              SR Stopping & Range Module (SRModule.exe + Biersack PRAL92)
            </h1>
            <p className="text-xs text-slate-400">
              Exact SCOEF03.dat Electronic Stopping + SNUC03.dat Pair-Specific Nuclear Stopping + PRAL92 Range & Straggling across all 8 Units
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={syncFromTrimSetup}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-cyan-300 border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync from Active TRIM Layer</span>
          </button>

          <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700">
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Import SR.IN</span>
            <input
              type="file"
              accept=".in,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => {
                  const parsed = parseSrIn(String(r.result || ''));
                  setSrInput(parsed);
                  if (
                    parsed.customEnergiesKeV &&
                    parsed.customEnergiesKeV.length > 0
                  ) {
                    setUseCustomList(true);
                    setCustomEnergyText(parsed.customEnergiesKeV.join(', '));
                  } else {
                    setUseCustomList(false);
                  }
                };
                r.readAsText(f);
              }}
              className="hidden"
            />
          </label>

          <button
            onClick={() =>
              downloadFile('SR.IN', generateSrIn(effectiveInput))
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>Export SR.IN</span>
          </button>

          <button
            onClick={() =>
              downloadFile(
                effectiveInput.outputFilename || 'SR_OUTPUT.TXT',
                generateSrTableTxt(effectiveInput, rows)
              )
            }
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export SR Stopping Table (.TXT)</span>
          </button>
        </div>
      </div>

      {/* Main 12-Col Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 4 Cols: Ion, Target, Units & Energy Grid Setup */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-4 space-y-4">
            <h2 className="text-sm font-bold text-white border-b border-slate-800 pb-2">
              1. Ion & Stopping Unit Configuration
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-400 mb-1">
                  Incident Ion (Z₁ = 1..92)
                </label>
                <select
                  value={srInput.z1}
                  onChange={(e) => {
                    const z1 = Number(e.target.value);
                    const el = getElementByZ(z1);
                    setSrInput({ ...srInput, z1, m1: el.naturalWeight });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
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
                  Ion Mass M₁ (amu)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={srInput.m1}
                  onChange={(e) =>
                    setSrInput({
                      ...srInput,
                      m1: Math.max(0.5, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Output Stopping Unit (1–8)
                </label>
                <select
                  value={srInput.unit}
                  onChange={(e) =>
                    setSrInput({
                      ...srInput,
                      unit: Number(e.target.value) as StoppingUnit,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-cyan-300 font-semibold"
                >
                  {([1, 2, 3, 4, 5, 6, 7, 8] as StoppingUnit[]).map((u) => (
                    <option key={u} value={u}>
                      [{u}] {STOPPING_UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Energy Grid Mode */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">
                  Energy Grid Mode
                </span>
                <button
                  onClick={() => setUseCustomList(!useCustomList)}
                  className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300 hover:bg-slate-700"
                >
                  {useCustomList
                    ? 'Switch to E_min..E_max Range'
                    : 'Switch to Custom Energy List (0 0)'}
                </button>
              </div>

              {!useCustomList ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      E-Min (keV)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={srInput.eMinKeV}
                      onChange={(e) =>
                        setSrInput({
                          ...srInput,
                          eMinKeV: Math.max(0.01, Number(e.target.value)),
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      E-Max (keV)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={srInput.eMaxKeV}
                      onChange={(e) =>
                        setSrInput({
                          ...srInput,
                          eMaxKeV: Math.max(
                            srInput.eMinKeV,
                            Number(e.target.value)
                          ),
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Custom Energies in keV (comma or space separated)
                  </label>
                  <textarea
                    rows={2}
                    value={customEnergyText}
                    onChange={(e) => setCustomEnergyText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Target Composition Panel */}
          <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h2 className="text-sm font-bold text-white">
                2. Target Material & Bragg Correction
              </h2>
              <select
                defaultValue=""
                onChange={(e) => {
                  const comp = COMPOUNDS.find((c) => c.name === e.target.value);
                  if (!comp) return;
                  setSrInput({
                    ...srInput,
                    title: `${getElementByZ(srInput.z1).symbol} in ${comp.name}`,
                    densityGPerCm3: comp.density || 1.0,
                    phase: comp.state === 1 ? 1 : 0,
                    elements: comp.elements.map((ce) => {
                      const sc = getElementByZ(ce.z);
                      return {
                        z: ce.z,
                        symbol: sc.symbol,
                        name: sc.name,
                        stoich: ce.stoich,
                        mass: sc.naturalWeight,
                      };
                    }),
                  });
                }}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-emerald-300 max-w-[170px]"
              >
                <option value="" disabled>
                  Quick Load Compound...
                </option>
                {COMPOUNDS.slice(0, 120).map((c, idx) => (
                  <option key={`${c.name}-${idx}`} value={c.name}>
                    {c.name} ({c.density} g/cm³)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Density (g/cm³)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={srInput.densityGPerCm3}
                  onChange={(e) =>
                    setSrInput({
                      ...srInput,
                      densityGPerCm3: Math.max(0.00001, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-300 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Compound Corr.
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={srInput.compoundCorr}
                  onChange={(e) =>
                    setSrInput({
                      ...srInput,
                      compoundCorr: Math.max(0.1, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-amber-300 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Target Phase
                </label>
                <button
                  onClick={() =>
                    setSrInput({
                      ...srInput,
                      phase: srInput.phase === 0 ? 1 : 0,
                    })
                  }
                  className={`w-full py-1 rounded border text-xs font-bold ${
                    srInput.phase === 1
                      ? 'bg-purple-950 border-purple-500 text-purple-200'
                      : 'bg-slate-950 border-slate-700 text-slate-200'
                  }`}
                >
                  {srInput.phase === 1 ? 'GAS (1)' : 'SOLID (0)'}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {srInput.elements.map((el, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 bg-slate-950/80 p-1.5 rounded border border-slate-800 text-xs"
                >
                  <select
                    value={el.z}
                    onChange={(ev) => {
                      const nz = Number(ev.target.value);
                      const sc = getElementByZ(nz);
                      const next = srInput.elements.map((item, k) =>
                        k === idx
                          ? {
                              ...item,
                              z: nz,
                              symbol: sc.symbol,
                              name: sc.name,
                              mass: sc.naturalWeight,
                            }
                          : item
                      );
                      setSrInput({ ...srInput, elements: next });
                    }}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white flex-1"
                  >
                    {SCOEF03.map((s) => (
                      <option key={s.z} value={s.z}>
                        {s.z} {s.symbol} ({s.name})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.1"
                    value={el.stoich}
                    onChange={(ev) => {
                      const next = srInput.elements.map((item, k) =>
                        k === idx
                          ? {
                              ...item,
                              stoich: Math.max(0.001, Number(ev.target.value)),
                            }
                          : item
                      );
                      setSrInput({ ...srInput, elements: next });
                    }}
                    className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-white"
                    title="Stoichiometry"
                  />
                  {srInput.elements.length > 1 && (
                    <button
                      onClick={() =>
                        setSrInput({
                          ...srInput,
                          elements: srInput.elements.filter((_, k) => k !== idx),
                        })
                      }
                      className="p-1 text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => {
                  const oEl = getElementByZ(8);
                  setSrInput({
                    ...srInput,
                    elements: [
                      ...srInput.elements,
                      {
                        z: 8,
                        symbol: 'O',
                        name: 'Oxygen',
                        stoich: 1,
                        mass: oEl.naturalWeight,
                      },
                    ],
                  });
                }}
                className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Target Element</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right 8 Cols: Interactive Chart + Full SRIM Table */}
        <div className="lg:col-span-8 space-y-5">
          {/* Interactive Chart Card */}
          <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setPlotMode('stopping')}
                  className={`px-3 py-1 rounded text-xs font-bold ${
                    plotMode === 'stopping'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Stopping Power (Se, Sn, Stotal)
                </button>
                <button
                  onClick={() => setPlotMode('range')}
                  className={`px-3 py-1 rounded text-xs font-bold ${
                    plotMode === 'range'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  PRAL92 Range & Straggling (Rp, ΔRp, ΔRy)
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setLogScaleX(!logScaleX)}
                  className={`px-2.5 py-1 rounded border font-semibold ${
                    logScaleX
                      ? 'bg-indigo-950 border-indigo-500 text-indigo-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  X: {logScaleX ? 'Log Energy' : 'Linear Energy'}
                </button>
                <button
                  onClick={() => setLogScaleY(!logScaleY)}
                  className={`px-2.5 py-1 rounded border font-semibold ${
                    logScaleY
                      ? 'bg-indigo-950 border-indigo-500 text-indigo-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Y: {logScaleY ? 'Log Scale' : 'Linear Scale'}
                </button>
              </div>
            </div>

            <SrCurveChart
              rows={rows}
              plotMode={plotMode}
              unitLabel={STOPPING_UNIT_LABELS[srInput.unit]}
              logX={logScaleX}
              logY={logScaleY}
            />
          </div>

          {/* SRIM Stopping & Range Table */}
          <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                SRModule.exe Stopping & Range Table ({rows.length} Energy Points · Unit ={' '}
                <span className="text-cyan-300">
                  {STOPPING_UNIT_LABELS[srInput.unit]}
                </span>
                )
              </h3>
            </div>

            <div className="max-h-[360px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/70">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="py-2 px-3">Ion Energy</th>
                    <th className="py-2 px-3">dE/dx Elec.</th>
                    <th className="py-2 px-3">dE/dx Nuclear</th>
                    <th className="py-2 px-3">dE/dx Total</th>
                    <th className="py-2 px-3">Projected Range Rp</th>
                    <th className="py-2 px-3">Longitudinal Strag.</th>
                    <th className="py-2 px-3">Lateral Strag.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-slate-900 hover:bg-cyan-950/25"
                    >
                      <td className="py-1.5 px-3 text-white font-semibold">
                        {r.energyKeV >= 1000
                          ? `${(r.energyKeV / 1000).toFixed(2)} MeV`
                          : `${r.energyKeV.toFixed(2)} keV`}
                      </td>
                      <td className="py-1.5 px-3 text-cyan-300">
                        {r.se.toExponential(4)}
                      </td>
                      <td className="py-1.5 px-3 text-amber-300">
                        {r.sn.toExponential(4)}
                      </td>
                      <td className="py-1.5 px-3 text-emerald-300 font-bold">
                        {(r.se + r.sn).toExponential(4)}
                      </td>
                      <td className="py-1.5 px-3 text-white">
                        {formatRangeWithAutoUnit(r.projectedRangeA).formatted}
                      </td>
                      <td className="py-1.5 px-3 text-slate-300">
                        {
                          formatRangeWithAutoUnit(r.longitudinalStragglingA)
                            .formatted
                        }
                      </td>
                      <td className="py-1.5 px-3 text-slate-300">
                        {
                          formatRangeWithAutoUnit(r.lateralStragglingA)
                            .formatted
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface SrCurveChartProps {
  rows: ReturnType<typeof calcStoppingAndRangeTable>;
  plotMode: 'stopping' | 'range';
  unitLabel: string;
  logX: boolean;
  logY: boolean;
}

const SrCurveChart: React.FC<SrCurveChartProps> = ({
  rows,
  plotMode,
  unitLabel,
  logX,
  logY,
}) => {
  if (rows.length === 0) return null;

  const width = 720;
  const height = 270;
  const padL = 66;
  const padR = 24;
  const padT = 20;
  const padB = 36;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const eMin = Math.max(1e-3, rows[0].energyKeV);
  const eMax = Math.max(eMin * 1.1, rows[rows.length - 1].energyKeV);

  const series =
    plotMode === 'stopping'
      ? [
          {
            name: `Total Stopping (${unitLabel})`,
            color: '#34d399',
            values: rows.map((r) => r.se + r.sn),
          },
          {
            name: `Electronic Se (${unitLabel})`,
            color: '#22d3ee',
            values: rows.map((r) => r.se),
          },
          {
            name: `Nuclear Sn (${unitLabel})`,
            color: '#fbbf24',
            values: rows.map((r) => r.sn),
          },
        ]
      : [
          {
            name: 'Projected Range Rp (Å)',
            color: '#22d3ee',
            values: rows.map((r) => r.projectedRangeA),
          },
          {
            name: 'Longitudinal Straggling ΔRp (Å)',
            color: '#f97316',
            values: rows.map((r) => r.longitudinalStragglingA),
          },
          {
            name: 'Lateral Straggling ΔRy (Å)',
            color: '#a855f7',
            values: rows.map((r) => r.lateralStragglingA),
          },
        ];

  let yMax = 0;
  let yMinPos = 1e30;
  for (const s of series) {
    for (const v of s.values) {
      if (v > yMax) yMax = v;
      if (v > 0 && v < yMinPos) yMinPos = v;
    }
  }
  if (yMax <= 0) yMax = 1.0;
  if (yMinPos >= yMax) yMinPos = yMax * 1e-4;

  const mapX = (eKeV: number) => {
    if (logX) {
      const f =
        (Math.log10(Math.max(eMin, eKeV)) - Math.log10(eMin)) /
        Math.max(1e-9, Math.log10(eMax) - Math.log10(eMin));
      return padL + f * plotW;
    }
    const f = (eKeV - eMin) / Math.max(1e-9, eMax - eMin);
    return padL + f * plotW;
  };

  const mapY = (val: number) => {
    if (logY) {
      const vClamped = Math.max(yMinPos, val);
      const f =
        (Math.log10(vClamped) - Math.log10(yMinPos)) /
        Math.max(1e-9, Math.log10(yMax) - Math.log10(yMinPos));
      return padT + plotH * (1 - Math.max(0, Math.min(1, f)));
    }
    const f = val / (yMax * 1.06);
    return padT + plotH * (1 - Math.max(0, Math.min(1, f)));
  };

  return (
    <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-4 text-xs">
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

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[260px] overflow-visible"
      >
        {[0, 0.25, 0.5, 0.75, 1.0].map((f, idx) => {
          const y = padT + plotH * (1 - f);
          const v = logY
            ? Math.pow(
                10,
                Math.log10(yMinPos) +
                  f * (Math.log10(yMax) - Math.log10(yMinPos))
              )
            : yMax * 1.06 * f;
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
                {v >= 1000 || (v > 0 && v < 0.01)
                  ? v.toExponential(1)
                  : v.toFixed(2)}
              </text>
            </g>
          );
        })}

        {[0, 0.25, 0.5, 0.75, 1.0].map((f, idx) => {
          const x = padL + f * plotW;
          const eVal = logX
            ? Math.pow(
                10,
                Math.log10(eMin) + f * (Math.log10(eMax) - Math.log10(eMin))
              )
            : eMin + f * (eMax - eMin);
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
              {eVal >= 1000
                ? `${(eVal / 1000).toFixed(1)}M`
                : `${eVal.toFixed(1)}k`}
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
          Ion Energy (keV / MeV)
        </text>

        {series.map((s) => {
          const pts = rows
            .map((r, i) => `${mapX(r.energyKeV).toFixed(1)},${mapY(s.values[i]).toFixed(1)}`)
            .join(' ');
          return (
            <polyline
              key={s.name}
              fill="none"
              stroke={s.color}
              strokeWidth={2.2}
              points={pts}
            />
          );
        })}
      </svg>
    </div>
  );
};
