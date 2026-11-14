import React, { useState, useEffect } from 'react';
import { Navbar, type ActiveModule } from './components/Navbar';
import { SetupStudio } from './components/SetupStudio';
import { TrimCockpit } from './components/TrimCockpit';
import { SrCalculator } from './components/SrCalculator';
import { ImplantAnalytics } from './components/ImplantAnalytics';
import { PTableModal } from './components/PTableModal';
import { PhysicsReference } from './components/PhysicsReference';
import { parseTrimIn } from './physics/formats';
import { encodeConfigToHash, decodeConfigFromHash } from './physics/sessionUrl';
import type { DemoPreset } from './data';
import type { TrimSetupConfig } from './physics/types';

const DEFAULT_TRIM_CONFIG: TrimSetupConfig = {
  title: '6 C (3 keV) into Silicon Wafer [TDATA.sav Golden Benchmark]',
  ion: {
    z1: 6,
    symbol: 'C',
    name: 'Carbon',
    massAmu: 12.011,
    energyKeV: 3.0,
    angleDeg: 0.0,
  },
  calculationMode: 1,
  totalIons: 250,
  randomSeed: 98765,
  braggCorrection: 1.0,
  autoSaveNumber: 10000,
  plotType: 0,
  plotXMinA: 0,
  plotXMaxA: 13000,
  zones: [{ layerIndex: 0, endDepthA: 13000 }],
  layers: [
    {
      id: 'layer-si',
      name: 'Si wafer',
      widthA: 13000,
      densityGPerCm3: 2.3212,
      phase: 0,
      compoundCorr: 1.0,
      elements: [
        {
          z: 14,
          symbol: 'Si',
          name: 'Silicon',
          stoich: 1.0,
          massAmu: 28.086,
          displacementEv: 10.0,
          latticeBindingEv: 3.0,
          surfaceBindingEv: 2.1,
        },
      ],
    },
  ],
};

export function App() {
  const [activeModule, setActiveModule] = useState<ActiveModule>('cockpit');
  const [trimConfig, setTrimConfig] =
    useState<TrimSetupConfig>(DEFAULT_TRIM_CONFIG);
  const [showQuickPTable, setShowQuickPTable] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Check URL hash on initial load for shared session
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const decoded = decodeConfigFromHash(window.location.hash);
      if (decoded) {
        setTrimConfig(decoded);
        setToastMessage(`Shared session loaded: "${decoded.title}"`);
        const timer = setTimeout(() => setToastMessage(null), 4000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handleShareSession = () => {
    const hash = encodeConfigToHash(trimConfig);
    const fullUrl = `${window.location.origin}${window.location.pathname}${hash}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(fullUrl).then(() => {
        setToastMessage('Session link copied to clipboard! (공유 URL 복사 완료)');
        setTimeout(() => setToastMessage(null), 3000);
      });
    } else {
      window.location.hash = hash;
      setToastMessage('Session URL updated in address bar!');
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  const handleLoadDemo = (demo: DemoPreset) => {
    const parsed = parseTrimIn(demo.rawTrimIn);
    setTrimConfig(parsed);
    setActiveModule('cockpit');
  };

  const handleLoadPreset = (presetConfig: TrimSetupConfig) => {
    setTrimConfig(presetConfig);
    setActiveModule('cockpit');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-16 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 border border-emerald-500/50 text-emerald-300 text-xs font-semibold shadow-xl shadow-black/60 animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      <Navbar
        activeModule={activeModule}
        onSelectModule={setActiveModule}
        onLoadDemo={handleLoadDemo}
        onLoadPreset={handleLoadPreset}
        onOpenPTableModal={() => setShowQuickPTable(true)}
        onShareSession={handleShareSession}
        currentTitle={trimConfig.title}
      />

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 py-6">
        {activeModule === 'setup' && (
          <SetupStudio
            config={trimConfig}
            onChangeConfig={setTrimConfig}
            onLaunchCockpit={() => setActiveModule('cockpit')}
          />
        )}

        {activeModule === 'cockpit' && <TrimCockpit config={trimConfig} />}

        {activeModule === 'sr' && <SrCalculator trimConfig={trimConfig} />}

        {activeModule === 'tcad' && <ImplantAnalytics trimConfig={trimConfig} />}

        {activeModule === 'ptable' && (
          <PTableModal initialZ={trimConfig.ion.z1} />
        )}

        {activeModule === 'physics' && <PhysicsReference />}
      </main>

      {showQuickPTable && (
        <PTableModal
          isModal
          initialZ={trimConfig.ion.z1}
          onClose={() => setShowQuickPTable(false)}
        />
      )}
    </div>
  );
}

export default App;
