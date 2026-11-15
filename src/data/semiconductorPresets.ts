import { SEMICONDUCTOR_MATERIALS } from './semiconductorMaterials';
import { getElementByZ } from './index';
import type { TrimCalcMode, TrimLayerConfig, TrimSetupConfig } from '../physics/types';

export type PresetCategory =
  | 'Si CMOS FEOL'
  | 'Power (SiC / GaN)'
  | 'III-V / Photonics'
  | 'Display / Mask / FIB';

export interface SemiconductorPreset {
  id: string;
  title: string;
  category: PresetCategory;
  summary: string;
  processTag: string;
  config: TrimSetupConfig;
}

const matById = new Map(SEMICONDUCTOR_MATERIALS.map((m) => [m.id, m]));

function layerFromMat(matId: string, widthA: number, customName?: string): TrimLayerConfig {
  const mat = matById.get(matId);
  if (!mat) {
    throw new Error(`Unknown material id: ${matId}`);
  }
  return {
    id: `${mat.id}-${widthA}`,
    name: customName ?? mat.name.split(' (')[0],
    widthA,
    densityGPerCm3: mat.densityGPerCm3,
    phase: mat.phase,
    compoundCorr: mat.compoundCorr,
    elements: mat.elements.map((e) => ({ ...e })),
  };
}

interface PresetSeed {
  id: string;
  title: string;
  category: PresetCategory;
  summary: string;
  processTag: string;
  z1: number;
  massAmu: number;
  energyKeV: number;
  angleDeg: number;
  calculationMode: TrimCalcMode;
  totalIons?: number;
  layers: { matId: string; widthA: number; name?: string }[];
}

function buildPreset(seed: PresetSeed): SemiconductorPreset {
  const el = getElementByZ(seed.z1);
  const layers = seed.layers.map((l) => layerFromMat(l.matId, l.widthA, l.name));
  let cum = 0;
  const zones = layers.map((l, idx) => {
    cum += l.widthA;
    return { layerIndex: idx, endDepthA: cum };
  });

  return {
    id: seed.id,
    title: seed.title,
    category: seed.category,
    summary: seed.summary,
    processTag: seed.processTag,
    config: {
      title: seed.title,
      ion: {
        z1: seed.z1,
        symbol: el.symbol,
        name: el.name,
        massAmu: seed.massAmu,
        energyKeV: seed.energyKeV,
        angleDeg: seed.angleDeg,
      },
      calculationMode: seed.calculationMode,
      totalIons: seed.totalIons ?? 1000,
      randomSeed: 98765,
      braggCorrection: 1.0,
      autoSaveNumber: 10000,
      plotType: 0,
      plotXMinA: 0,
      plotXMaxA: cum,
      zones,
      layers,
    },
  };
}

const PRESET_SEEDS: PresetSeed[] = [
  // === 1. Si CMOS FEOL ===
  {
    id: 'cmos-usj-as',
    title: 'NMOS USJ S/D Extension: 75As+ (2 keV, 7°) -> Screen SiO2 / c-Si',
    category: 'Si CMOS FEOL',
    summary: 'Ultra-shallow n+ source/drain extension through 1.5 nm screen oxide with 7° channeling suppression tilt.',
    processTag: 'USJ NMOS',
    z1: 33,
    massAmu: 74.9216,
    energyKeV: 2.0,
    angleDeg: 7.0,
    calculationMode: 2,
    layers: [
      { matId: 'mat-th-sio2', widthA: 15, name: 'Screen SiO2' },
      { matId: 'mat-c-si', widthA: 350, name: 'c-Si Substrate' },
    ],
  },
  {
    id: 'cmos-usj-p',
    title: 'NMOS LDD / Extension: 31P+ (3 keV, 7°) -> Screen SiO2 / c-Si',
    category: 'Si CMOS FEOL',
    summary: 'Low-energy Phosphorus LDD implantation for graded drain electric field control.',
    processTag: 'LDD NMOS',
    z1: 15,
    massAmu: 30.9738,
    energyKeV: 3.0,
    angleDeg: 7.0,
    calculationMode: 1,
    layers: [
      { matId: 'mat-th-sio2', widthA: 15, name: 'Screen SiO2' },
      { matId: 'mat-c-si', widthA: 450, name: 'c-Si Substrate' },
    ],
  },
  {
    id: 'cmos-usj-b',
    title: 'PMOS USJ Extension (BF2 eq.): 11B+ (1 keV, 7°) -> Screen SiO2 / c-Si',
    category: 'Si CMOS FEOL',
    summary: 'Ultra-low energy Boron implantation equivalent to ~4.5 keV BF2+ for shallow p+ junction formation.',
    processTag: 'USJ PMOS',
    z1: 5,
    massAmu: 11.0093,
    energyKeV: 1.0,
    angleDeg: 7.0,
    calculationMode: 1,
    layers: [
      { matId: 'mat-th-sio2', widthA: 12, name: 'Screen SiO2' },
      { matId: 'mat-c-si', widthA: 400, name: 'c-Si Substrate' },
    ],
  },
  {
    id: 'cmos-vt-hkmg',
    title: 'HKMG Gate Stack Channel Vt: 11B+ (25 keV, 7°) -> Poly/TiN/HfO2/SiO2/Si',
    category: 'Si CMOS FEOL',
    summary: '5-layer CMOS High-k Metal Gate stack penetration check for threshold voltage (Vt) tuning.',
    processTag: 'HKMG Stack',
    z1: 5,
    massAmu: 11.0093,
    energyKeV: 25.0,
    angleDeg: 7.0,
    calculationMode: 1,
    layers: [
      { matId: 'mat-poly-si', widthA: 500, name: 'Poly-Si Gate' },
      { matId: 'mat-tin', widthA: 40, name: 'TiN Workfunction' },
      { matId: 'mat-hfo2', widthA: 25, name: 'HfO2 High-k' },
      { matId: 'mat-th-sio2', widthA: 10, name: 'Interfacial SiO2' },
      { matId: 'mat-c-si', widthA: 1800, name: 'c-Si Channel' },
    ],
  },
  {
    id: 'cmos-halo-in',
    title: 'PMOS/NMOS Tilted Halo Pocket: 115In+ (80 keV, 35°) -> SiO2 / c-Si',
    category: 'Si CMOS FEOL',
    summary: 'High-tilt (35°) heavy Indium pocket implant under gate spacer to suppress short-channel effects.',
    processTag: '35° Halo',
    z1: 49,
    massAmu: 114.9039,
    energyKeV: 80.0,
    angleDeg: 35.0,
    calculationMode: 2,
    layers: [
      { matId: 'mat-th-sio2', widthA: 20, name: 'Screen SiO2' },
      { matId: 'mat-c-si', widthA: 1200, name: 'c-Si Substrate' },
    ],
  },
  {
    id: 'cmos-pwell',
    title: 'Retrograde P-Well: 11B+ (180 keV, 7°) -> Pad SiO2 / c-Si',
    category: 'Si CMOS FEOL',
    summary: 'Deep Boron well implantation for latch-up suppression and NMOS body bias.',
    processTag: 'P-Well',
    z1: 5,
    massAmu: 11.0093,
    energyKeV: 180.0,
    angleDeg: 7.0,
    calculationMode: 1,
    layers: [
      { matId: 'mat-th-sio2', widthA: 100, name: 'Pad SiO2' },
      { matId: 'mat-c-si', widthA: 12000, name: 'c-Si Wafer' },
    ],
  },
  {
    id: 'cmos-nwell',
    title: 'Retrograde N-Well: 31P+ (350 keV, 7°) -> Pad SiO2 / c-Si',
    category: 'Si CMOS FEOL',
    summary: 'Phosphorus N-well formation through 10 nm pad oxide.',
    processTag: 'N-Well',
    z1: 15,
    massAmu: 30.9738,
    energyKeV: 350.0,
    angleDeg: 7.0,
    calculationMode: 1,
    layers: [
      { matId: 'mat-th-sio2', widthA: 100, name: 'Pad SiO2' },
      { matId: 'mat-c-si', widthA: 10000, name: 'c-Si Wafer' },
    ],
  },
  {
    id: 'cmos-triple-well',
    title: 'MeV Deep N-Well Isolation: 31P+ (1200 keV, 7°) -> Si3N4 / c-Si',
    category: 'Si CMOS FEOL',
    summary: '1.2 MeV Phosphorus deep triple-well isolation beneath PMOS/NMOS active regions.',
    processTag: 'MeV Isolation',
    z1: 15,
    massAmu: 30.9738,
    energyKeV: 1200.0,
    angleDeg: 7.0,
    calculationMode: 1,
    layers: [
      { matId: 'mat-lpcvd-si3n4', widthA: 300, name: 'LPCVD Si3N4' },
      { matId: 'mat-c-si', widthA: 25000, name: 'c-Si Wafer' },
    ],
  },
  {
    id: 'cmos-pai-ge',
    title: 'Pre-Amorphization Implant (PAI): 74Ge+ (25 keV, 0°) -> c-Si [Cascade]',
    category: 'Si CMOS FEOL',
    summary: 'Germanium PAI prior to Boron USJ to eliminate channeling tails and evaluate vacancy profile.',
    processTag: 'Ge PAI',
    z1: 32,
    massAmu: 73.9212,
    energyKeV: 25.0,
    angleDeg: 0.0,
    calculationMode: 2,
    layers: [{ matId: 'mat-c-si', widthA: 1000, name: 'c-Si Substrate' }],
  },
  {
    id: 'cmos-smartcut-h',
    title: 'SOI Smart-Cut™ Layer Cleave: 1H+ (50 keV, 0°) -> Thermal SiO2 / c-Si',
    category: 'Si CMOS FEOL',
    summary: 'Hydrogen implantation peaking beneath BOX thermal oxide for Silicon-On-Insulator exfoliation.',
    processTag: 'SOI Smart-Cut',
    z1: 1,
    massAmu: 1.0078,
    energyKeV: 50.0,
    angleDeg: 0.0,
    calculationMode: 1,
    layers: [
      { matId: 'mat-th-sio2', widthA: 1500, name: 'BOX Thermal SiO2' },
      { matId: 'mat-c-si', widthA: 10000, name: 'c-Si Donor Wafer' },
    ],
  },

  // === 2. Power (SiC / GaN) ===
  {
    id: 'power-sic-al',
    title: '4H-SiC P-Well: 27Al+ (180 keV, 4°) -> Screen SiO2 / 4H-SiC',
    category: 'Power (SiC / GaN)',
    summary: 'Aluminum acceptor implantation for 4H-SiC Power MOSFET p-body/guard rings (4° off-axis).',
    processTag: '4H-SiC Al',
    z1: 13,
    massAmu: 26.9815,
    energyKeV: 180.0,
    angleDeg: 4.0,
    calculationMode: 2,
    layers: [
      { matId: 'mat-th-sio2', widthA: 300, name: 'Screen SiO2' },
      { matId: 'mat-4h-sic', widthA: 4500, name: '4H-SiC Epi' },
    ],
  },
  {
    id: 'power-sic-n',
    title: '4H-SiC N+ Source: 14N+ (80 keV, 4°) -> 4H-SiC',
    category: 'Power (SiC / GaN)',
    summary: 'Nitrogen donor implantation for low-resistance n+ source ohmic region in SiC.',
    processTag: '4H-SiC N+',
    z1: 7,
    massAmu: 14.0031,
    energyKeV: 80.0,
    angleDeg: 4.0,
    calculationMode: 1,
    layers: [{ matId: 'mat-4h-sic', widthA: 3000, name: '4H-SiC Epi' }],
  },
  {
    id: 'power-gan-si',
    title: 'GaN HEMT Ohmic Doping: 28Si+ (120 keV, 7°) -> AlN Cap / GaN',
    category: 'Power (SiC / GaN)',
    summary: 'Silicon donor selective-area implantation through AlN anneal cap into GaN channel.',
    processTag: 'GaN Si+',
    z1: 14,
    massAmu: 27.9769,
    energyKeV: 120.0,
    angleDeg: 7.0,
    calculationMode: 2,
    layers: [
      { matId: 'mat-aln', widthA: 200, name: 'AlN Cap' },
      { matId: 'mat-gan', widthA: 3500, name: 'GaN Buffer/Channel' },
    ],
  },
  {
    id: 'power-ga2o3-si',
    title: 'beta-Ga2O3 UWBG Contact: 28Si+ (60 keV, 7°) -> beta-Ga2O3',
    category: 'Power (SiC / GaN)',
    summary: 'Shallow Si donor implantation into ultra-wide bandgap monoclinic beta-Ga2O3.',
    processTag: 'Ga2O3 Si+',
    z1: 14,
    massAmu: 27.9769,
    energyKeV: 60.0,
    angleDeg: 7.0,
    calculationMode: 1,
    layers: [{ matId: 'mat-ga2o3', widthA: 2000, name: 'beta-Ga2O3' }],
  },

  // === 3. III-V / Photonics ===
  {
    id: 'iiiv-gaas-si',
    title: 'GaAs MESFET Channel: 28Si+ (100 keV, 7°) -> Si3N4 Cap / GaAs',
    category: 'III-V / Photonics',
    summary: 'n-channel Si implantation into GaAs capped with LPCVD Si3N4 to prevent As out-diffusion.',
    processTag: 'GaAs Si+',
    z1: 14,
    massAmu: 27.9769,
    energyKeV: 100.0,
    angleDeg: 7.0,
    calculationMode: 2,
    layers: [
      { matId: 'mat-lpcvd-si3n4', widthA: 400, name: 'Si3N4 Cap' },
      { matId: 'mat-gaas', widthA: 3000, name: 'GaAs Substrate' },
    ],
  },
  {
    id: 'iiiv-inp-h',
    title: 'InP Photonic Device Isolation: 1H+ (150 keV, 7°) -> InP',
    category: 'III-V / Photonics',
    summary: 'Proton bombardment creating high-resistivity isolation region in InP laser/detector.',
    processTag: 'InP Proton Isol.',
    z1: 1,
    massAmu: 1.0078,
    energyKeV: 150.0,
    angleDeg: 7.0,
    calculationMode: 1,
    layers: [{ matId: 'mat-inp', widthA: 22000, name: 'InP Wafer' }],
  },
  {
    id: 'photonics-linbo3-he',
    title: 'LiNbO3 Optical Waveguide: 4He+ (1800 keV, 0°) -> LiNbO3',
    category: 'III-V / Photonics',
    summary: 'High-energy Helium implantation forming low-index buried optical cladding barrier.',
    processTag: 'LiNbO3 Waveguide',
    z1: 2,
    massAmu: 4.0026,
    energyKeV: 1800.0,
    angleDeg: 0.0,
    calculationMode: 1,
    layers: [{ matId: 'mat-linbo3', widthA: 60000, name: 'LiNbO3 Crystal' }],
  },

  // === 4. Display / Mask / FIB ===
  {
    id: 'display-ltps-tft',
    title: 'LTPS Oxide TFT S/D: 31P+ (70 keV, 0°) -> TEOS SiO2 / Poly-Si / Buffer SiO2',
    category: 'Display / Mask / FIB',
    summary: 'AMLCD/OLED LTPS backplane source/drain implantation through 80 nm TEOS gate insulator.',
    processTag: 'LTPS TFT',
    z1: 15,
    massAmu: 30.9738,
    energyKeV: 70.0,
    angleDeg: 0.0,
    calculationMode: 1,
    layers: [
      { matId: 'mat-teos-sio2', widthA: 800, name: 'Gate TEOS SiO2' },
      { matId: 'mat-poly-si', widthA: 500, name: 'LTPS Poly-Si' },
      { matId: 'mat-teos-sio2', widthA: 1000, name: 'Buffer SiO2' },
    ],
  },
  {
    id: 'mask-pr-as',
    title: 'Photoresist Implant Masking: 75As+ (80 keV, 7°) -> DUV PR / SiO2 / c-Si',
    category: 'Display / Mask / FIB',
    summary: 'Verify blocking efficiency of 400 nm DUV organic photoresist against 80 keV Arsenic beam.',
    processTag: 'PR Blocking',
    z1: 33,
    massAmu: 74.9216,
    energyKeV: 80.0,
    angleDeg: 7.0,
    calculationMode: 1,
    layers: [
      { matId: 'mat-duv-pr', widthA: 4000, name: 'DUV Photoresist' },
      { matId: 'mat-th-sio2', widthA: 200, name: 'Thermal SiO2' },
      { matId: 'mat-c-si', widthA: 2000, name: 'c-Si Substrate' },
    ],
  },
  {
    id: 'fib-ga-cu-sio2',
    title: 'FIB Nanomachining & Sputtering: 69Ga+ (30 keV, 0°) -> Cu / SiO2 [Sputter]',
    category: 'Display / Mask / FIB',
    summary: 'Monolayer collision sputtering yield & Ga contamination profile in BEOL Cu/SiO2.',
    processTag: 'FIB Ga+ Sputter',
    z1: 31,
    massAmu: 68.9256,
    energyKeV: 30.0,
    angleDeg: 0.0,
    calculationMode: 3,
    totalIons: 1000,
    layers: [
      { matId: 'mat-cu', widthA: 400, name: 'Cu Interconnect' },
      { matId: 'mat-th-sio2', widthA: 800, name: 'IMD SiO2' },
    ],
  },
  {
    id: 'quantum-diamond-nv',
    title: 'Quantum Diamond NV-Center: 14N+ (15 keV, 0°) -> Diamond (c-C) [Cascade]',
    category: 'Display / Mask / FIB',
    summary: 'Nitrogen implantation into single-crystal diamond for shallow NV spin qubit creation.',
    processTag: 'Diamond NV',
    z1: 7,
    massAmu: 14.0031,
    energyKeV: 15.0,
    angleDeg: 0.0,
    calculationMode: 2,
    layers: [{ matId: 'mat-diamond', widthA: 1000, name: 'CVD Diamond' }],
  },
];

export const SEMICONDUCTOR_PRESETS: SemiconductorPreset[] = PRESET_SEEDS.map(buildPreset);
