import React from 'react';
import {
  Atom,
  Layers,
  Play,
  Activity,
  Table2,
  BookOpen,
  Sparkles,
  Share2,
} from 'lucide-react';
import { DEMO_PRESETS, type DemoPreset } from '../data';

export type ActiveModule =
  | 'setup'
  | 'cockpit'
  | 'sr'
  | 'ptable'
  | 'physics';

interface NavbarProps {
  activeModule: ActiveModule;
  onSelectModule: (mod: ActiveModule) => void;
  onLoadDemo: (demo: DemoPreset) => void;
  onOpenPTableModal: () => void;
  onShareSession?: () => void;
  currentTitle: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeModule,
  onSelectModule,
  onLoadDemo,
  onOpenPTableModal,
  onShareSession,
  currentTitle,
}) => {
  const navItems: {
    id: ActiveModule;
    label: string;
    sub: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'setup',
      label: 'Target & Ion Studio',
      sub: 'TIN.exe + SRIMKorea',
      icon: <Layers className="w-4 h-4" />,
    },
    {
      id: 'cockpit',
      label: 'TRIM 3D Cockpit',
      sub: 'Monte Carlo BCA + Tools',
      icon: <Play className="w-4 h-4" />,
    },
    {
      id: 'sr',
      label: 'SR Stopping & Range',
      sub: 'SRModule.exe + PRAL92',
      icon: <Activity className="w-4 h-4" />,
    },
    {
      id: 'ptable',
      label: 'PTableDB & X-Rays',
      sub: '111 Elements + 1,610 Lines',
      icon: <Table2 className="w-4 h-4" />,
    },
    {
      id: 'physics',
      label: 'Physics & Equations',
      sub: 'STOP2003 / ZBL / CAB',
      icon: <BookOpen className="w-4 h-4" />,
    },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
      <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Brand Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-cyan-500/20 border border-cyan-400/30">
            <Atom className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-white">
                SRIM-Web <span className="text-cyan-400">2003.20</span>
              </span>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold">
                TRIM · SRModule · SRIMKorea · PTableDB
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate max-w-[340px]">
              Active Setup: <span className="text-slate-200 font-medium">{currentTitle}</span>
            </p>
          </div>
        </div>

        {/* Module Navigation Pills */}
        <nav className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
          {navItems.map((item) => {
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectModule(item.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-900/40'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                {item.icon}
                <div>
                  <div className="text-xs font-semibold leading-tight">
                    {item.label}
                  </div>
                  <div
                    className={`text-[10px] leading-tight ${
                      isActive ? 'text-cyan-100' : 'text-slate-400'
                    }`}
                  >
                    {item.sub}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Quick Actions: Official Demo Loader & Quick Periodic Table */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 absolute left-2.5 pointer-events-none" />
            <select
              aria-label="Load Official SRIM Demo Preset"
              className="bg-slate-900 border border-slate-700 hover:border-amber-500/50 text-xs text-slate-200 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-cyan-500"
              defaultValue=""
              onChange={(e) => {
                const found = DEMO_PRESETS.find((d) => d.id === e.target.value);
                if (found) {
                  onLoadDemo(found);
                }
              }}
            >
              <option value="" disabled>
                Load Official Demo (Trim.d00–d11)...
              </option>
              {DEMO_PRESETS.map((d) => (
                <option key={d.id} value={d.id}>
                  [{d.id}] {d.title} ({d.energyKeV} keV)
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onOpenPTableModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-medium text-cyan-300 border border-cyan-500/30 transition-colors"
            title="Open Quick Periodic Table & X-Ray Lookup"
          >
            <Table2 className="w-3.5 h-3.5" />
            <span>Periodic Table</span>
          </button>

          {onShareSession && (
            <button
              onClick={onShareSession}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 text-xs font-medium text-emerald-300 border border-emerald-500/40 transition-colors shadow-sm shadow-emerald-950"
              title="Copy Sharable Session URL to Clipboard"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
