import scoef03Raw from './scoef03.json';
import snuc03Raw from './snuc03.json';
import compoundsRaw from './compounds.json';
import ptableRaw from './ptable.json';
import demosRaw from './demos.json';
import type { ScoefElement } from '../physics/types';

export const SCOEF03: ScoefElement[] = scoef03Raw as ScoefElement[];
export const SNUC03_PAIRS: number[][] = snuc03Raw as number[][];

export interface CompoundEntry {
  name: string;
  category: string;
  state: number;
  density: number;
  isMassPercent: boolean;
  elements: { z: number; stoich: number }[];
  bonds: number[];
  comments: string;
}

export const COMPOUNDS: CompoundEntry[] = compoundsRaw as CompoundEntry[];

export interface PTableElement {
  z: number;
  symbol: string;
  name: string;
  maiMass: number;
  maiWeight: number;
  naturalWeight: number;
  density: number;
  atomDensity: number;
  fermiVelocity: number;
  screenFactor: number;
  heatSubl: number;
  defaultEd: number;
  defaultEb: number;
  defaultEs: number;
  general: {
    meltingPointK: string;
    boilingPointK: string;
    heatFusion: string;
    heatVapor: string;
    heatCapacity: string;
    entropy: string;
    atomicVolume: string;
    thermalCond: string;
    resistivity: string;
    workFunction: string;
    thermalExp: string;
  };
  history: {
    discYear: string;
    discoverer: string;
    nameOrigin: string;
    earthContent: string;
    chondriteContent: string;
    cosmicContent: string;
    cost: string;
    source: string;
    use: string;
    properties: string;
    toxicity: string;
  };
  misc: {
    elecConf: string;
    paulingElectroneg: string;
    neutronCrossSection: string;
    atomicRadius: string;
    covalentRadius: string;
    crystalStructure: string;
  };
  ionizationPotentials: { charge: string; potential: number }[];
  isotopes: {
    isoName: string;
    weight: number;
    abundance: number;
    halfLife: string;
    decay: string;
  }[];
  xrays: XrayLineEntry[];
}

export interface XrayLineEntry {
  z: number;
  symbol: string;
  line: string;
  energy: number;
  intensity: number;
  edge: string;
  xKey: number;
}

export const PTABLE_ELEMENTS: PTableElement[] = (ptableRaw as { elements: PTableElement[] }).elements;
export const ALL_XRAYS: XrayLineEntry[] = (ptableRaw as { allXrays: XrayLineEntry[] }).allXrays;

export interface DemoPreset {
  id: string;
  title: string;
  ionZ: number;
  ionMass: number;
  energyKeV: number;
  angleDeg: number;
  calcMode: number;
  xmin: number;
  xmax: number;
  targetElements: { z: number; mass: number; ed: number; eb: number; es: number }[];
  layers: {
    name: string;
    width: number;
    density: number;
    stoich: number[];
    phase: number;
    compoundCorr: number;
  }[];
  rawTrimIn: string;
}

export const DEMO_PRESETS: DemoPreset[] = demosRaw as DemoPreset[];

const scoefByZ = new Map<number, ScoefElement>();
const scoefBySymbol = new Map<string, ScoefElement>();
for (const el of SCOEF03) {
  scoefByZ.set(el.z, el);
  scoefBySymbol.set(el.symbol.toLowerCase(), el);
}

const ptableByZ = new Map<number, PTableElement>();
for (const el of PTABLE_ELEMENTS) {
  ptableByZ.set(el.z, el);
}

export function getElementByZ(z: number): ScoefElement {
  const clamped = Math.max(1, Math.min(92, Math.round(z)));
  return scoefByZ.get(clamped) || SCOEF03[0];
}

export function getElementBySymbol(sym: string): ScoefElement | undefined {
  return scoefBySymbol.get(sym.trim().toLowerCase());
}

export function getPTableElement(z: number): PTableElement | undefined {
  return ptableByZ.get(Math.round(z));
}
