import React, { useState, useMemo } from 'react';
import {
  X,
  Search,
  Zap,
  Atom,
  History,
  Layers,
  Radiation,
  Compass,
  CheckCircle2,
} from 'lucide-react';
import {
  PTABLE_ELEMENTS,
  ALL_XRAYS,
  getElementByZ,
  type PTableElement,
} from '../data';

// Standard 18-column periodic table coordinates (row 1..9, col 1..18) for Z = 1..111
function getPeriodicPosition(z: number): { row: number; col: number; category: string } {
  if (z === 1) return { row: 1, col: 1, category: 'nonmetal' };
  if (z === 2) return { row: 1, col: 18, category: 'noble' };
  if (z >= 3 && z <= 4) return { row: 2, col: z - 2, category: z === 3 ? 'alkali' : 'alkaline' };
  if (z >= 5 && z <= 10) {
    const col = z + 8;
    const cat = z === 5 ? 'metalloid' : z === 10 ? 'noble' : z === 9 ? 'halogen' : 'nonmetal';
    return { row: 2, col, category: cat };
  }
  if (z >= 11 && z <= 12) return { row: 3, col: z - 10, category: z === 11 ? 'alkali' : 'alkaline' };
  if (z >= 13 && z <= 18) {
    const col = z;
    const cat = z === 13 ? 'post-transition' : z === 14 ? 'metalloid' : z === 18 ? 'noble' : z === 17 ? 'halogen' : 'nonmetal';
    return { row: 3, col, category: cat };
  }
  if (z >= 19 && z <= 36) {
    const col = z - 18;
    let cat = 'transition';
    if (z === 19) cat = 'alkali';
    else if (z === 20) cat = 'alkaline';
    else if (z === 31) cat = 'post-transition';
    else if (z === 32 || z === 33) cat = 'metalloid';
    else if (z === 34) cat = 'nonmetal';
    else if (z === 35) cat = 'halogen';
    else if (z === 36) cat = 'noble';
    return { row: 4, col, category: cat };
  }
  if (z >= 37 && z <= 54) {
    const col = z - 36;
    let cat = 'transition';
    if (z === 37) cat = 'alkali';
    else if (z === 38) cat = 'alkaline';
    else if (z === 49 || z === 50) cat = 'post-transition';
    else if (z === 51 || z === 52) cat = 'metalloid';
    else if (z === 53) cat = 'halogen';
    else if (z === 54) cat = 'noble';
    return { row: 5, col, category: cat };
  }
  if (z === 55 || z === 56) {
    return { row: 6, col: z - 54, category: z === 55 ? 'alkali' : 'alkaline' };
  }
  if (z >= 57 && z <= 71) {
    return { row: 8, col: z - 53, category: 'lanthanide' };
  }
  if (z >= 72 && z <= 86) {
    const col = z - 68;
    let cat = 'transition';
    if (z >= 81 && z <= 83) cat = 'post-transition';
    else if (z === 84) cat = 'metalloid';
    else if (z === 85) cat = 'halogen';
    else if (z === 86) cat = 'noble';
    return { row: 6, col, category: cat };
  }
  if (z === 87 || z === 88) {
    return { row: 7, col: z - 86, category: z === 87 ? 'alkali' : 'alkaline' };
  }
  if (z >= 89 && z <= 103) {
    return { row: 9, col: z - 85, category: 'actinide' };
  }
  return { row: 7, col: z - 100, category: 'transition' };
}

const CATEGORY_COLORS: Record<string, string> = {
  alkali: 'bg-rose-950/80 border-rose-500/50 text-rose-200 hover:bg-rose-900',
  alkaline: 'bg-orange-950/80 border-orange-500/50 text-orange-200 hover:bg-orange-900',
  transition: 'bg-sky-950/80 border-sky-500/50 text-sky-200 hover:bg-sky-900',
  'post-transition': 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200 hover:bg-emerald-900',
  metalloid: 'bg-teal-950/80 border-teal-500/50 text-teal-200 hover:bg-teal-900',
  nonmetal: 'bg-cyan-950/80 border-cyan-400/60 text-cyan-100 hover:bg-cyan-900',
  halogen: 'bg-indigo-950/80 border-indigo-400/60 text-indigo-200 hover:bg-indigo-900',
  noble: 'bg-purple-950/80 border-purple-400/60 text-purple-200 hover:bg-purple-900',
  lanthanide: 'bg-amber-950/80 border-amber-500/50 text-amber-200 hover:bg-amber-900',
  actinide: 'bg-fuchsia-950/80 border-fuchsia-500/50 text-fuchsia-200 hover:bg-fuchsia-900',
};

interface PTableModalProps {
  isModal?: boolean;
  onClose?: () => void;
  onSelectElement?: (z: number, massAmu?: number) => void;
  initialZ?: number;
}

export const PTableModal: React.FC<PTableModalProps> = ({
  isModal = false,
  onClose,
  onSelectElement,
  initialZ = 14,
}) => {
  const [selectedZ, setSelectedZ] = useState<number>(initialZ);
  const [activeTab, setActiveTab] = useState<
    'general' | 'history' | 'ionization' | 'isotopes' | 'xrays' | 'misc'
  >('general');
  const [viewMode, setViewMode] = useState<'ptable' | 'xtable'>('ptable');

  // Global X-Ray search state (frmXTable)
  const [xraySearchEnergy, setXraySearchEnergy] = useState<string>('');
  const [xrayToleranceKeV, setXrayToleranceKeV] = useState<string>('0.25');
  const [xrayElementFilter, setXrayElementFilter] = useState<string>('');
  const [xrayEdgeFilter, setXrayEdgeFilter] = useState<string>('ALL');

  const selectedElement: PTableElement = useMemo(() => {
    return (
      PTABLE_ELEMENTS.find((el) => el.z === selectedZ) || PTABLE_ELEMENTS[13]
    );
  }, [selectedZ]);

  const scoefInfo = useMemo(() => {
    return selectedZ <= 92 ? getElementByZ(selectedZ) : null;
  }, [selectedZ]);

  const filteredGlobalXrays = useMemo(() => {
    const centerE = parseFloat(xraySearchEnergy);
    const tolE = Math.max(0.001, parseFloat(xrayToleranceKeV) || 0.25);
    const symQuery = xrayElementFilter.trim().toLowerCase();

    return ALL_XRAYS.filter((x) => {
      if (xrayEdgeFilter !== 'ALL' && !x.edge.startsWith(xrayEdgeFilter)) {
        return false;
      }
      if (
        symQuery &&
        !x.symbol.toLowerCase().includes(symQuery) &&
        String(x.z) !== symQuery
      ) {
        return false;
      }
      if (!Number.isNaN(centerE) && centerE > 0) {
        if (Math.abs(x.energy - centerE) > tolE) return false;
      }
      return true;
    }).slice(0, 300);
  }, [xraySearchEnergy, xrayToleranceKeV, xrayElementFilter, xrayEdgeFilter]);

  const gridMap = useMemo(() => {
    const map = new Map<string, PTableElement>();
    for (const el of PTABLE_ELEMENTS) {
      const pos = getPeriodicPosition(el.z);
      map.set(`${pos.row}-${pos.col}`, el);
    }
    return map;
  }, []);

  const content = (
    <div className="bg-slate-950 text-slate-100 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col">
      {/* Header Bar */}
      <div className="px-6 py-4 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
            <Atom className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              PTableDB Periodic Table & X-Ray Encyclopedia
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                111 Elements · 3,112 Isotopes · 1,610 X-Ray Lines (Specon.mdb)
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Complete database of Dr. Wan Hong&apos;s PTableDB.exe + SRIM-2003 SCOEF03 parameters
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setViewMode('ptable')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                viewMode === 'ptable'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              111-Element Periodic Table
            </button>
            <button
              onClick={() => setViewMode('xtable')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                viewMode === 'xtable'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Global X-Ray Energy Lookup (frmXTable)
            </button>
          </div>

          {isModal && onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {viewMode === 'ptable' ? (
        <div className="p-5 grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Left 7 Cols: 18-Column Periodic Table Grid */}
          <div className="xl:col-span-7 overflow-x-auto">
            <div className="min-w-[740px]">
              <div className="grid grid-cols-18 gap-1">
                {Array.from({ length: 9 }, (_, rIdx) => {
                  const row = rIdx + 1;
                  return Array.from({ length: 18 }, (__, cIdx) => {
                    const col = cIdx + 1;
                    const el = gridMap.get(`${row}-${col}`);
                    if (!el) {
                      if (row === 6 && col === 3) {
                        return (
                          <div
                            key={`${row}-${col}`}
                            className="h-11 rounded border border-amber-500/30 bg-amber-950/30 flex flex-col items-center justify-center text-[9px] text-amber-300 font-semibold"
                          >
                            <span>57-71</span>
                            <span>La-Lu</span>
                          </div>
                        );
                      }
                      if (row === 7 && col === 3) {
                        return (
                          <div
                            key={`${row}-${col}`}
                            className="h-11 rounded border border-fuchsia-500/30 bg-fuchsia-950/30 flex flex-col items-center justify-center text-[9px] text-fuchsia-300 font-semibold"
                          >
                            <span>89-103</span>
                            <span>Ac-Lr</span>
                          </div>
                        );
                      }
                      return <div key={`${row}-${col}`} className="h-11" />;
                    }
                    const pos = getPeriodicPosition(el.z);
                    const colorCls =
                      CATEGORY_COLORS[pos.category] || CATEGORY_COLORS.transition;
                    const isSelected = el.z === selectedZ;
                    return (
                      <button
                        key={el.z}
                        onClick={() => setSelectedZ(el.z)}
                        className={`h-11 rounded border p-1 flex flex-col justify-between text-left transition-all ${colorCls} ${
                          isSelected
                            ? 'ring-2 ring-white scale-105 z-10 shadow-lg'
                            : 'opacity-90 hover:opacity-100'
                        }`}
                        title={`${el.z} ${el.name} (${el.naturalWeight} u)`}
                      >
                        <div className="flex items-center justify-between w-full leading-none">
                          <span className="text-[9px] font-mono opacity-80">
                            {el.z}
                          </span>
                          {el.z > 92 && (
                            <span className="text-[8px] text-amber-300">*</span>
                          )}
                        </div>
                        <div className="text-xs font-bold leading-none text-center w-full">
                          {el.symbol}
                        </div>
                        <div className="text-[8px] opacity-75 truncate w-full text-center leading-none">
                          {el.naturalWeight > 0
                            ? el.naturalWeight.toFixed(1)
                            : el.maiMass}
                        </div>
                      </button>
                    );
                  });
                })}
              </div>

              {/* Legend */}
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-300">
                {Object.entries({
                  alkali: 'Alkali Metal',
                  alkaline: 'Alkaline Earth',
                  transition: 'Transition Metal',
                  'post-transition': 'Post-Transition',
                  metalloid: 'Metalloid',
                  nonmetal: 'Nonmetal',
                  halogen: 'Halogen',
                  noble: 'Noble Gas',
                  lanthanide: 'Lanthanide',
                  actinide: 'Actinide',
                }).map(([key, label]) => (
                  <span
                    key={key}
                    className={`px-2 py-0.5 rounded border text-[10px] ${CATEGORY_COLORS[key]}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right 5 Cols: 6-Tab Element Detail Encyclopedia */}
          <div className="xl:col-span-5 bg-slate-900/70 rounded-xl border border-slate-800 p-4 flex flex-col">
            {/* Element Banner */}
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-800 border border-cyan-400/40 flex flex-col items-center justify-center shadow-md">
                  <span className="text-[10px] font-mono text-cyan-200 leading-none">
                    Z = {selectedElement.z}
                  </span>
                  <span className="text-2xl font-extrabold text-white leading-tight">
                    {selectedElement.symbol}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {selectedElement.name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Natural Wt:{' '}
                    <span className="text-cyan-300 font-mono">
                      {selectedElement.naturalWeight} u
                    </span>{' '}
                    · MAI Mass:{' '}
                    <span className="text-cyan-300 font-mono">
                      {selectedElement.maiWeight} u ({selectedElement.maiMass})
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Density:{' '}
                    <span className="text-emerald-300 font-mono">
                      {selectedElement.density} g/cm³
                    </span>{' '}
                    · Ed={selectedElement.defaultEd} eV, Eb=
                    {selectedElement.defaultEb} eV, Es={selectedElement.defaultEs}{' '}
                    eV
                  </p>
                </div>
              </div>

              {onSelectElement && selectedElement.z <= 92 && (
                <button
                  onClick={() => {
                    onSelectElement(selectedElement.z, selectedElement.naturalWeight);
                    if (onClose) onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Select {selectedElement.symbol}
                </button>
              )}
            </div>

            {/* 6 Detail Tabs */}
            <div className="flex flex-wrap gap-1 mb-3 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {[
                { id: 'general', label: 'General & SRIM', icon: <Atom className="w-3.5 h-3.5" /> },
                { id: 'history', label: 'History & Uses', icon: <History className="w-3.5 h-3.5" /> },
                { id: 'ionization', label: `Ionization (${selectedElement.ionizationPotentials.length})`, icon: <Zap className="w-3.5 h-3.5" /> },
                { id: 'isotopes', label: `Isotopes (${selectedElement.isotopes.length})`, icon: <Radiation className="w-3.5 h-3.5" /> },
                { id: 'xrays', label: `X-Rays (${selectedElement.xrays.length})`, icon: <Compass className="w-3.5 h-3.5" /> },
                { id: 'misc', label: 'Crystal/Misc', icon: <Layers className="w-3.5 h-3.5" /> },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as typeof activeTab)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                    activeTab === t.id
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto max-h-[380px] pr-1 text-xs space-y-2">
              {activeTab === 'general' && (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Atomic Density', `${selectedElement.atomDensity.toExponential(3)} atoms/cm³`],
                    ['Fermi Velocity', `${selectedElement.fermiVelocity} v₀`],
                    ['Heat of Sublimation', `${selectedElement.heatSubl} eV`],
                    ['Mean Excitation I₀ (Solid)', scoefInfo ? `${scoefInfo.i0Solid} eV` : 'N/A'],
                    ['Melting Point', `${selectedElement.general.meltingPointK} K`],
                    ['Boiling Point', `${selectedElement.general.boilingPointK} K`],
                    ['Heat of Fusion', `${selectedElement.general.heatFusion} kJ/mol`],
                    ['Heat of Vaporization', `${selectedElement.general.heatVapor} kJ/mol`],
                    ['Specific Heat Capacity', `${selectedElement.general.heatCapacity} J/(g·K)`],
                    ['Thermal Conductivity', `${selectedElement.general.thermalCond} W/(cm·K)`],
                    ['Electrical Resistivity', `${selectedElement.general.resistivity} µΩ·cm`],
                    ['Work Function', `${selectedElement.general.workFunction} eV`],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="p-2 rounded bg-slate-950/80 border border-slate-800/80"
                    >
                      <div className="text-[10px] text-slate-400">{k}</div>
                      <div className="font-mono text-slate-200 font-medium">{v || '—'}</div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-2">
                  {[
                    ['Discovery Year & Discoverer', `${selectedElement.history.discYear} — ${selectedElement.history.discoverer}`],
                    ['Origin of Name', selectedElement.history.nameOrigin],
                    ['Abundance (Earth / Cosmic)', `Earth: ${selectedElement.history.earthContent} ppm | Cosmic: ${selectedElement.history.cosmicContent}`],
                    ['Primary Mineral Source', selectedElement.history.source],
                    ['Applications & Uses', selectedElement.history.use],
                    ['Physical & Chemical Properties', selectedElement.history.properties],
                    ['Toxicity & Safety', selectedElement.history.toxicity],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="p-2.5 rounded bg-slate-950/80 border border-slate-800/80"
                    >
                      <div className="text-[10px] text-cyan-400 font-semibold mb-0.5">
                        {k}
                      </div>
                      <div className="text-slate-200 leading-relaxed">{v || '—'}</div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'ionization' && (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                      <th className="py-1.5 px-2">Charge State</th>
                      <th className="py-1.5 px-2">Ionization Potential (eV)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedElement.ionizationPotentials.map((ip, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-900 hover:bg-slate-800/40"
                      >
                        <td className="py-1 px-2 font-mono text-cyan-300">
                          {ip.charge}
                        </td>
                        <td className="py-1 px-2 font-mono">
                          {ip.potential.toFixed(3)} eV
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {activeTab === 'isotopes' && (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                      <th className="py-1.5 px-2">Isotope</th>
                      <th className="py-1.5 px-2">Mass (u)</th>
                      <th className="py-1.5 px-2">Abundance / T½</th>
                      <th className="py-1.5 px-2">Decay</th>
                      {onSelectElement && <th className="py-1.5 px-2">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedElement.isotopes.map((iso, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-900 hover:bg-slate-800/40"
                      >
                        <td className="py-1 px-2 font-semibold text-amber-300">
                          {iso.isoName}
                        </td>
                        <td className="py-1 px-2 font-mono">
                          {iso.weight.toFixed(4)}
                        </td>
                        <td className="py-1 px-2 font-mono text-slate-300">
                          {iso.abundance > 0
                            ? `${iso.abundance}%`
                            : iso.halfLife}
                        </td>
                        <td className="py-1 px-2 text-slate-400">{iso.decay}</td>
                        {onSelectElement && selectedElement.z <= 92 && (
                          <td className="py-1 px-2">
                            <button
                              onClick={() => {
                                onSelectElement(selectedElement.z, iso.weight);
                                if (onClose) onClose();
                              }}
                              className="px-2 py-0.5 rounded bg-cyan-600/30 hover:bg-cyan-600 text-cyan-200 hover:text-white text-[10px]"
                            >
                              Use Mass
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {activeTab === 'xrays' && (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                      <th className="py-1.5 px-2">Line</th>
                      <th className="py-1.5 px-2">Energy (keV)</th>
                      <th className="py-1.5 px-2">Rel. Intensity</th>
                      <th className="py-1.5 px-2">Edge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedElement.xrays.map((xr, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-900 hover:bg-slate-800/40"
                      >
                        <td className="py-1 px-2 font-mono text-cyan-300 font-semibold">
                          {xr.line}
                        </td>
                        <td className="py-1 px-2 font-mono text-emerald-300">
                          {xr.energy.toFixed(4)}
                        </td>
                        <td className="py-1 px-2 font-mono">{xr.intensity}</td>
                        <td className="py-1 px-2 text-slate-400">{xr.edge}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {activeTab === 'misc' && (
                <div className="grid grid-cols-1 gap-2">
                  {[
                    ['Electron Configuration', selectedElement.misc.elecConf],
                    ['Pauling Electronegativity', selectedElement.misc.paulingElectroneg],
                    ['Thermal Neutron Cross Section', `${selectedElement.misc.neutronCrossSection} barns`],
                    ['Atomic Radius', `${selectedElement.misc.atomicRadius} Å`],
                    ['Covalent Radius', `${selectedElement.misc.covalentRadius} Å`],
                    ['Crystal Structure', selectedElement.misc.crystalStructure],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="p-2.5 rounded bg-slate-950/80 border border-slate-800/80 flex justify-between"
                    >
                      <span className="text-slate-400">{k}</span>
                      <span className="font-mono text-slate-200 font-semibold">
                        {v || '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Global X-Ray Energy Lookup Table (frmXTable) */
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/70 p-4 rounded-xl border border-slate-800">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Target X-Ray Energy (keV)
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 1.74 (Si Ka1) or 8.04 (Cu Ka1)"
                  value={xraySearchEnergy}
                  onChange={(e) => setXraySearchEnergy(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Energy Window ±ΔE (keV)
              </label>
              <input
                type="number"
                step="0.05"
                value={xrayToleranceKeV}
                onChange={(e) => setXrayToleranceKeV(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Element Symbol or Z Filter
              </label>
              <input
                type="text"
                placeholder="e.g. Si, Au, Cu, 79..."
                value={xrayElementFilter}
                onChange={(e) => setXrayElementFilter(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Absorption Edge Filter
              </label>
              <select
                value={xrayEdgeFilter}
                onChange={(e) => setXrayEdgeFilter(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
              >
                <option value="ALL">All Edges (K, L, M)</option>
                <option value="K">K Edge</option>
                <option value="L">L1 / L2 / L3 Edges</option>
                <option value="M">M1 – M5 Edges</option>
              </select>
            </div>
          </div>

          <div className="max-h-[460px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/40">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2 px-4">Z</th>
                  <th className="py-2 px-4">Element</th>
                  <th className="py-2 px-4">Siegbahn Line</th>
                  <th className="py-2 px-4">Energy (keV)</th>
                  <th className="py-2 px-4">Relative Intensity</th>
                  <th className="py-2 px-4">Absorption Edge</th>
                </tr>
              </thead>
              <tbody>
                {filteredGlobalXrays.map((xr, idx) => (
                  <tr
                    key={idx}
                    onClick={() => {
                      setSelectedZ(xr.z);
                      setViewMode('ptable');
                      setActiveTab('xrays');
                    }}
                    className="border-b border-slate-800/60 hover:bg-cyan-950/30 cursor-pointer"
                  >
                    <td className="py-1.5 px-4 font-mono text-slate-400">
                      {xr.z}
                    </td>
                    <td className="py-1.5 px-4 font-bold text-white">
                      {xr.symbol}
                    </td>
                    <td className="py-1.5 px-4 font-mono text-cyan-300">
                      {xr.line}
                    </td>
                    <td className="py-1.5 px-4 font-mono text-emerald-300 font-semibold">
                      {xr.energy.toFixed(4)} keV
                    </td>
                    <td className="py-1.5 px-4 font-mono">{xr.intensity}</td>
                    <td className="py-1.5 px-4 text-slate-300">{xr.edge}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-[1440px]">{content}</div>
      </div>
    );
  }

  return content;
};
