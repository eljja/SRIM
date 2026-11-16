export type StoppingUnit =
  | 1 // eV / Angstrom
  | 2 // keV / micron
  | 3 // MeV / mm
  | 4 // keV / (ug/cm2)
  | 5 // MeV / (mg/cm2)
  | 6 // keV / (mg/cm2)
  | 7 // eV / (1E15 atoms/cm2)
  | 8; // L.S.S. reduced units

export const STOPPING_UNIT_LABELS: Record<StoppingUnit, string> = {
  1: 'eV / Å',
  2: 'keV / µm',
  3: 'MeV / mm',
  4: 'keV / (µg/cm²)',
  5: 'MeV / (mg/cm²)',
  6: 'keV / (mg/cm²)',
  7: 'eV / (10¹⁵ atoms/cm²)',
  8: 'L.S.S. reduced units',
};

export type TrimCalcMode =
  | 1 // Ion Distribution and Quick Calculation of Damage (Kinchin-Pease)
  | 2 // Detailed Calculation with Full Damage Cascades
  | 3 // Monolayer Collision Steps / Surface Sputtering
  | 4; // Special Calculation from TRIM.DAT

export interface ScoefElement {
  z: number;
  symbol: string;
  name: string;
  maiMass: number;
  maiWeight: number;
  naturalWeight: number;
  solidDensity: number;
  solidAtomDensity: number;
  fermiVelocity: number;
  heatSubl: number;
  gasDensity: number;
  gasAtomDensity: number;
  pstop: number[];
  hestop: number[];
  listop: number[];
  hip1: number[];
  hip2: number[];
  i0Solid: number;
  i0Gas: number;
  i0Compound: number;
  shellLow: number[];
  shellHigh: number[];
  hiEffCharge: number[];
  raw: number[];
}

export interface CABResult {
  sCab: number;
  sBraggSolid: number;
  sBraggGas: number;
  sBraggStd: number;
  solidBindingCorr: number;
  gasBindingCorr: number;
  recommendedCorr: number;
  targetPhaseCorr: number;
}

export interface SRInput {
  title?: string;
  z1: number;
  m1: number;
  elements: { z: number; symbol?: string; name: string; stoich: number; mass: number }[];
  densityGPerCm3: number;
  phase: 0 | 1;
  compoundCorr: number;
  unit: StoppingUnit;
  eMinKeV: number;
  eMaxKeV: number;
  customEnergiesKeV?: number[];
  outputFilename?: string;
}

export interface SRTableRow {
  energyKeV: number;
  se: number;
  sn: number;
  projectedRangeA: number;
  longitudinalStragglingA: number;
  lateralStragglingA: number;
}

export interface TransmittedIonRecord {
  ionNumber: number;
  z1: number;
  energyEv: number;
  xA: number;
  yA: number;
  zA: number;
  cosX: number;
  cosY: number;
  cosZ: number;
}

export interface TrimIonConfig {
  z1: number;
  symbol: string;
  name: string;
  massAmu: number;
  energyKeV: number;
  angleDeg: number;
}

export interface TrimElementConfig {
  z: number;
  symbol: string;
  name: string;
  stoich: number;
  massAmu: number;
  displacementEv: number;
  latticeBindingEv: number;
  surfaceBindingEv: number;
}

export interface TrimLayerConfig {
  id: string;
  name: string;
  widthA: number;
  densityGPerCm3: number;
  phase: 0 | 1; // 0 = Solid, 1 = Gas
  compoundCorr: number;
  elements: TrimElementConfig[];
}

export interface TrimZoneConfig {
  layerIndex: number;
  endDepthA: number;
}

export interface TrimCustomDatEvent {
  name: string;
  z1: number;
  energyEv: number;
  xA: number;
  yA: number;
  zA: number;
  cosX: number;
  cosY: number;
  cosZ: number;
}

export type CrystalLatticeType = 'diamond' | 'zincblende' | 'wurtzite' | 'fcc' | 'bcc';
export type CrystalOrientation = '<100>' | '<110>' | '<111>' | '<112>' | 'custom';
export type ScreeningPotentialType = 'zbl' | 'krc' | 'moliere';

export interface TrimAdvancedPhysicsConfig {
  // 1. Crystal-TRIM Single-Crystal Channeling & Dynamic Damage
  crystalMode: boolean;
  crystalLattice: CrystalLatticeType;
  latticeConstantA: number;
  latticeCConstantA?: number;
  crystalOrientation: CrystalOrientation;
  customMiller?: [number, number, number];
  crystalTiltDeg: number; // Fine polar tilt away from crystal axis (e.g. -15 to +15 deg)
  crystalTwistDeg: number; // Azimuthal wafer twist (0 to 360 deg)
  targetTempK: number; // Substrate temperature (K) for Debye vibration
  debyeTempK: number; // Material Debye temperature (K)
  doseCm2: number; // Fluence (ions/cm^2) for dynamic damage & TRIDYN
  dynamicDamage: boolean; // Dose-dependent amorphization blocking channeling
  criticalDpa: number; // Critical dpa for amorphization (~0.1 for Si)
  // 2. Impact-Parameter Dependent Local Electronic Stopping (Oen-Robinson / Firsov)
  localElectronicStopping: boolean;
  // 3. Athermal Frenkel-Pair Recombination (Nordlund ARC-dpa / IAEA)
  arcDpaRecombination: boolean;
  // 4. TRIDYN Dynamic Target Composition & Surface Erosion
  dynamicComposition: boolean;
  // 5. Interatomic Screening Potential & Simultaneous Weak Collisions
  screeningPotential: ScreeningPotentialType;
  simultaneousCollisions: boolean;
  // 6. 2D Device Mask / Gate Edge Shadowing
  mask2dEnabled: boolean;
  maskThicknessA: number;
  maskOpeningA: number; // Opening aperture width in Y [-W/2, W/2] (nm/A)
}

export interface TrimSetupConfig {
  title: string;
  ion: TrimIonConfig;
  calculationMode: TrimCalcMode;
  totalIons: number;
  randomSeed: number;
  braggCorrection: number;
  autoSaveNumber: number;
  plotType: number;
  plotXMinA: number;
  plotXMaxA: number;
  zones: TrimZoneConfig[];
  layers: TrimLayerConfig[];
  customTrimDatEvents?: TrimCustomDatEvent[];
  advancedPhysics?: TrimAdvancedPhysicsConfig;
}

export interface TrimMoments {
  meanA: number;
  stragglingA: number;
  skewness: number;
  kurtosis: number;
}

export interface TrimPoint3D {
  xA: number;
  yA: number;
  zA: number;
  energyEv: number;
}

export interface TrimRecoilTrack {
  z2: number;
  symbol: string;
  points: TrimPoint3D[];
}

export interface TrimTrajectory {
  ionNumber: number;
  eventName?: string;
  z1: number;
  fate: 'stopped' | 'backscattered' | 'transmitted';
  points: TrimPoint3D[];
  recoils: TrimRecoilTrack[];
}

export interface TrimSputteredAtom {
  ionNumber: number;
  z2: number;
  symbol: string;
  energyEv: number;
  surfaceArrivalEnergyEv: number;
  xA: number;
  yA: number;
  zA: number;
  cosX: number;
  cosY: number;
  cosZ: number;
}

export interface TrimCollisionEvent {
  ionNumber: number;
  energyKeV: number;
  depthA: number;
  yA: number;
  zA: number;
  seEvPerA: number;
  z2: number;
  symbol: string;
  recoilEnergyEv: number;
  displacements: number;
  vacancies: number;
  replacements: number;
  interstitials: number;
}

export interface TrimSnapshot {
  completedIons: number;
  totalIons: number;
  stoppedCount: number;
  backscatteredCount: number;
  transmittedCount: number;
  stoppedPct: number;
  backscatteredPct: number;
  transmittedPct: number;
  totalVacancies: number;
  totalDisplacements: number;
  totalReplacements: number;
  totalInterstitials: number;
  totalEscapedRecoils: number;
  vacanciesPerIon: number;
  displacementsPerIon: number;
  replacementsPerIon: number;
  interstitialsPerIon: number;
  sputteringYield: number;
  sputteringYieldByElement: { z: number; symbol: string; name: string; yieldPerIon: number; meanEnergyEv: number }[];
  sputterYieldVsEs: { esEv: number; totalYield: number; byElement: number[] }[];
  energyLossIonizationPct: number;
  energyLossPhononsPct: number;
  energyLossBindingPct: number;
  energyIonizByIonPct: number;
  energyIonizByRecoilPct: number;
  energyPhononByIonPct: number;
  energyPhononByRecoilPct: number;
  energyBindingByIonPct: number;
  energyBindingByRecoilPct: number;
  rangeMoments: TrimMoments;
  lateralMoments: TrimMoments;
  radialMoments: TrimMoments;
  binWidthA: number;
  binDepthsA: number[];
  histograms: {
    ionRange: number[]; // (atoms/cm3) / (atoms/cm2) = cm^-1
    recoilRangeByElement: number[][]; // [elemIndex][bin] (atoms/cm3) / (atoms/cm2)
    lateralY: number[];
    lateralZ: number[];
    radialR: number[];
    ionizationIon: number[]; // eV / (A - ion)
    ionizationRecoil: number[]; // eV / (A - ion)
    phononsIon: number[]; // eV / (A - ion)
    phononsRecoil: number[]; // eV / (A - ion)
    energyToRecoils: number[]; // eV / (A - ion)
    vacanciesIon: number[]; // Vacancies / (A - ion)
    vacanciesRecoil: number[]; // Vacancies / (A - ion)
    vacanciesByElement: number[][]; // [elemIndex][bin] Vacancies / (A - ion)
    replacements: number[]; // Replacements / (A - ion)
    interstitials: number[]; // Interstitials / (A - ion)
  };
  trajectories: TrimTrajectory[];
  backscatteredIons: TransmittedIonRecord[];
  transmittedIons: TransmittedIonRecord[];
  stoppedIons: TransmittedIonRecord[];
  sputteredAtoms: TrimSputteredAtom[];
  collisions: TrimCollisionEvent[];
  advancedDiagnostics?: {
    amorphousFractionProfile: number[];
    erodedDepthA: number;
    retainedDoseFraction: number;
    arcDpaVacanciesPerIon: number;
    channeledFractionPct: number;
    crystalAxisAlignedCos?: number;
  };
}
