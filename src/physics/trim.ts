import { getElementByZ } from '../data';
import { calcElectronicStoppingElement, calcLayerStopping } from './stopping';
import {
  buildCrystalRotationMatrix,
  buildCrystalUnitCell,
  calcArcDpaVacancies,
  calcDebyeVibrationSigmaA,
  calcOenRobinsonStoppingEv,
  calcScreeningLengthA,
  evalScreeningPotential,
  findCrystalCollisionsAlongRay,
  rotateCrystalToLab,
  rotateLabToCrystal,
  type CrystalUnitCellSpec,
  type Mat3,
} from './advancedPhysics';
import type {
  ScreeningPotentialType,
  TransmittedIonRecord,
  TrimAdvancedPhysicsConfig,
  TrimCollisionEvent,
  TrimElementConfig,
  TrimLayerConfig,
  TrimMoments,
  TrimPoint3D,
  TrimRecoilTrack,
  TrimSetupConfig,
  TrimSnapshot,
  TrimSputteredAtom,
  TrimTrajectory,
} from './types';

// ZBL Universal Screening Function coefficients
const ZBL_C = [0.18175, 0.50986, 0.28022, 0.02817] as const;
const ZBL_D = [3.1998, 0.94229, 0.4029, 0.20162] as const;

// Biersack-Haggmark Magic Formula constants
const MAGIC_C1 = 0.99229;
const MAGIC_C2 = 0.011615;
const MAGIC_C3 = 0.0071222;
const MAGIC_C4 = 14.813;
const MAGIC_C5 = 9.3066;

/** Upper bound for Monte Carlo ion histories (supports up to 1,000,000 ions). */
export const MAX_SIMULATION_IONS = 1_000_000;

/** Fixed surface binding energy sweep grid for O(1)-memory sputtering statistics. */
const SPUTTER_ES_GRID = [
  0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 6.0, 7.0, 8.0, 10.0, 12.0,
] as const;

/**
 * Deterministic Mulberry32 pseudo-random number generator returning values in (0, 1).
 */
export function createRng(seed: number = 12345): () => number {
  let state = (Math.floor(seed) || 12345) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return u <= 0 ? 1e-12 : u >= 1 ? 1 - 1e-12 : u;
  };
}

/**
 * Evaluates ZBL universal screening function Phi(x) and its first derivative Phi'(x).
 */
export function evalZblScreening(x: number): { phi: number; dPhi: number } {
  if (x <= 0) return { phi: 1.0, dPhi: -1.1489 };
  let phi = 0.0;
  let dPhi = 0.0;
  for (let i = 0; i < 4; i++) {
    const term = ZBL_C[i] * Math.exp(-ZBL_D[i] * x);
    phi += term;
    dPhi -= ZBL_D[i] * term;
  }
  return { phi, dPhi };
}

export interface MagicScatteringResult {
  screeningLengthA: number;
  reducedEnergyEps: number;
  reducedImpactB: number;
  closestApproachX0: number;
  cosHalfTheta: number;
  sinHalfTheta: number;
  recoilEnergyEv: number;
  cosPsiIon: number;
  sinPsiIon: number;
  cosPsiRecoil: number;
  sinPsiRecoil: number;
  timeIntegralTauA: number;
}

/**
 * Computes binary elastic collision scattering using ZBL, Kr-C, or Moliere screening potential
 * and Biersack-Haggmark Magic Formula (TRIM.exe 0x05200..0x07400).
 */
export function calcMagicScattering(
  z1: number,
  m1: number,
  z2: number,
  m2: number,
  energyEv: number,
  impactParamA: number,
  potential: ScreeningPotentialType = 'zbl'
): MagicScatteringResult {
  const aU = calcScreeningLengthA(z1, z2, potential);
  const eCmEv = (energyEv * m2) / (m1 + m2);
  const coulombEvA = 14.39979 * z1 * z2;
  const eps = Math.max(1e-9, (eCmEv * aU) / coulombEvA);
  const bRed = Math.max(0, impactParamA / aU);
  const gamma = (4.0 * m1 * m2) / Math.pow(m1 + m2, 2);

  // Head-on collision (B = 0) -> Theta = pi (cos(Theta/2) = 0, sin(Theta/2) = 1)
  if (bRed <= 1e-10) {
    // Solve Phi(x0)/x0 = eps for x0
    let x0 = eps > 1 ? 1.0 / eps : Math.pow(1.0 / eps, 0.35);
    for (let iter = 0; iter < 12; iter++) {
      const { phi, dPhi } = evalScreeningPotential(x0, potential);
      const f = phi - eps * x0;
      const df = dPhi - eps;
      const dx = f / (df !== 0 ? df : -1);
      x0 = Math.max(1e-6, x0 - dx);
      if (Math.abs(dx) < 1e-7 * x0) break;
    }
    const recoilEnergyEv = gamma * energyEv;
    const mu = m2 / m1;
    const cosPsiIon = mu < 1 ? 1.0 : -1.0;
    return {
      screeningLengthA: aU,
      reducedEnergyEps: eps,
      reducedImpactB: 0,
      closestApproachX0: x0,
      cosHalfTheta: 0.0,
      sinHalfTheta: 1.0,
      recoilEnergyEv,
      cosPsiIon,
      sinPsiIon: 0.0,
      cosPsiRecoil: 1.0,
      sinPsiRecoil: 0.0,
      timeIntegralTauA: x0 * aU,
    };
  }

  let cosHalfTheta = 1.0;
  let sinHalfTheta = 0.0;
  let x0 = bRed;

  // High reduced energy & large impact parameter asymptotic Rutherford regime
  if (eps > 10.0 && eps * bRed > 10.0) {
    const cotHalf = 2.0 * eps * bRed;
    sinHalfTheta = 1.0 / Math.sqrt(1.0 + cotHalf * cotHalf);
    cosHalfTheta = cotHalf * sinHalfTheta;
    x0 = bRed + 1.0 / (2.0 * eps);
  } else {
    // Solve f(x0) = 1 - Phi(x0)/(eps * x0) - (B / x0)^2 = 0 via Newton-Raphson
    const rMinCoul = (1.0 + Math.sqrt(1.0 + 4.0 * eps * eps * bRed * bRed)) / (2.0 * eps);
    x0 = Math.max(bRed + 1e-5, Math.min(rMinCoul, bRed + 1.2 / Math.pow(eps, 0.35)));

    for (let iter = 0; iter < 15; iter++) {
      const { phi, dPhi } = evalScreeningPotential(x0, potential);
      const invX = 1.0 / x0;
      const bRatio = bRed * invX;
      const f = 1.0 - (phi * invX) / eps - bRatio * bRatio;
      const df =
        -(dPhi * invX - phi * invX * invX) / eps + 2.0 * bRatio * bRatio * invX;
      if (Math.abs(df) < 1e-14) break;
      let nextX = x0 - f / df;
      if (nextX <= bRed) {
        nextX = 0.5 * (bRed + x0);
      }
      if (Math.abs(nextX - x0) < 1e-6 * x0) {
        x0 = nextX;
        break;
      }
      x0 = nextX;
    }

    const { phi, dPhi } = evalScreeningPotential(x0, potential);
    const denomRc = dPhi / x0 - phi / (x0 * x0);
    const numerRc = -2.0 * eps * (1.0 - phi / (eps * x0));
    const rC = Math.abs(denomRc) > 1e-14 ? Math.max(0, numerRc / denomRc) : 0.0;

    const sqrtEps = Math.sqrt(eps);
    const alpha = 1.0 + MAGIC_C1 / sqrtEps;
    const beta = (MAGIC_C2 + sqrtEps) / (MAGIC_C3 + sqrtEps);
    const gammaM = (MAGIC_C4 + eps) / (MAGIC_C5 + eps);
    const aTerm = 2.0 * alpha * eps * Math.pow(bRed, beta);
    const gTerm = gammaM / Math.max(1e-12, Math.sqrt(1.0 + aTerm * aTerm) - aTerm);
    const delta = (aTerm * (x0 - bRed)) / (1.0 + gTerm);

    cosHalfTheta = Math.max(
      0.0,
      Math.min(1.0, (bRed + rC + delta) / Math.max(1e-12, x0 + rC))
    );
    sinHalfTheta = Math.sqrt(Math.max(0.0, 1.0 - cosHalfTheta * cosHalfTheta));
  }

  const sinSqHalf = sinHalfTheta * sinHalfTheta;
  const recoilEnergyEv = gamma * energyEv * sinSqHalf;

  // Center-of-mass scattering angle Theta:
  // sin(Theta) = 2 * sin(Theta/2) * cos(Theta/2)
  // cos(Theta) = 1 - 2 * sin^2(Theta/2)
  const sinTheta = 2.0 * sinHalfTheta * cosHalfTheta;
  const cosTheta = 1.0 - 2.0 * sinSqHalf;

  // Laboratory scattering angle Psi for projectile:
  // tan(Psi) = sin(Theta) / (cos(Theta) + M1/M2)
  const massRatio = m1 / m2;
  const denomIon = Math.sqrt(
    Math.max(1e-18, sinTheta * sinTheta + Math.pow(cosTheta + massRatio, 2))
  );
  const cosPsiIon = Math.max(-1.0, Math.min(1.0, (cosTheta + massRatio) / denomIon));
  const sinPsiIon = Math.max(0.0, Math.min(1.0, sinTheta / denomIon));

  // Recoil scattering angle in laboratory frame: Psi_recoil = (pi - Theta) / 2
  // so cos(Psi_recoil) = sin(Theta/2), sin(Psi_recoil) = cos(Theta/2)
  const cosPsiRecoil = sinHalfTheta;
  const sinPsiRecoil = cosHalfTheta;

  const timeIntegralTauA = Math.max(0, (x0 - bRed) * aU * cosHalfTheta);

  return {
    screeningLengthA: aU,
    reducedEnergyEps: eps,
    reducedImpactB: bRed,
    closestApproachX0: x0,
    cosHalfTheta,
    sinHalfTheta,
    recoilEnergyEv,
    cosPsiIon,
    sinPsiIon,
    cosPsiRecoil,
    sinPsiRecoil,
    timeIntegralTauA,
  };
}

/**
 * Rotates a 3D unit vector (cosX, cosY, cosZ) by polar scattering angle Psi and azimuthal angle Phi.
 */
export function rotateDirection3D(
  cosX: number,
  cosY: number,
  cosZ: number,
  cosPsi: number,
  sinPsi: number,
  phi: number
): [number, number, number] {
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const sinTheta0Sq = cosY * cosY + cosZ * cosZ;

  let nx: number;
  let ny: number;
  let nz: number;

  if (sinTheta0Sq < 1e-10) {
    // Traveling nearly along the X axis
    const signX = cosX >= 0 ? 1.0 : -1.0;
    nx = signX * cosPsi;
    ny = sinPsi * cosPhi;
    nz = sinPsi * sinPhi;
  } else {
    const sinTheta0 = Math.sqrt(sinTheta0Sq);
    nx = cosX * cosPsi - sinTheta0 * sinPsi * cosPhi;
    ny =
      cosY * cosPsi +
      (sinPsi * (cosX * cosY * cosPhi - cosZ * sinPhi)) / sinTheta0;
    nz =
      cosZ * cosPsi +
      (sinPsi * (cosX * cosZ * cosPhi + cosY * sinPhi)) / sinTheta0;
  }

  // Renormalize to prevent floating-point drift
  const norm = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (norm <= 0) return [1.0, 0.0, 0.0];
  return [nx / norm, ny / norm, nz / norm];
}

/**
 * Computes the 4 SRIM statistical moments (Mean Rp, Straggling DeltaRp, Skewness Gamma, Kurtosis Beta).
 */
export function calcMoments(values: number[]): TrimMoments {
  const n = values.length;
  if (n === 0) {
    return { meanA: 0, stragglingA: 0, skewness: 0, kurtosis: 0 };
  }
  let sum = 0.0;
  for (let i = 0; i < n; i++) sum += values[i];
  const meanA = sum / n;

  let m2 = 0.0;
  let m3 = 0.0;
  let m4 = 0.0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - meanA;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;

  const stragglingA = Math.sqrt(Math.max(0, m2));
  const skewness =
    stragglingA > 1e-9 ? m3 / Math.pow(stragglingA, 3) : 0.0;
  const kurtosis =
    stragglingA > 1e-9 ? m4 / Math.pow(stragglingA, 4) : 3.0;

  return { meanA, stragglingA, skewness, kurtosis };
}

/**
 * Exact O(1)-memory single-pass 4-moment streaming accumulator (Terriberry/Pebay).
 * Avoids storing million-element coordinate arrays while computing exact mean,
 * straggling (sigma), skewness, and kurtosis during 1,000,000+ ion runs.
 */
export class RunningMoments {
  private n = 0;
  private mean = 0.0;
  private m2 = 0.0;
  private m3 = 0.0;
  private m4 = 0.0;

  public get count(): number {
    return this.n;
  }

  public push(x: number): void {
    const n1 = this.n;
    const n = n1 + 1;
    this.n = n;
    const delta = x - this.mean;
    const deltaN = delta / n;
    const deltaN2 = deltaN * deltaN;
    const term1 = delta * deltaN * n1;
    this.mean += deltaN;
    this.m4 +=
      term1 * deltaN2 * (n * n - 3 * n + 3) +
      6 * deltaN2 * this.m2 -
      4 * deltaN * this.m3;
    this.m3 += term1 * deltaN * (n - 2) - 3 * deltaN * this.m2;
    this.m2 += term1;
  }

  public getMoments(): TrimMoments {
    if (this.n === 0) {
      return { meanA: 0, stragglingA: 0, skewness: 0, kurtosis: 0 };
    }
    const variance = Math.max(0, this.m2 / this.n);
    const stragglingA = Math.sqrt(variance);
    const skewness =
      stragglingA > 1e-9 ? (this.m3 / this.n) / Math.pow(stragglingA, 3) : 0.0;
    const kurtosis =
      stragglingA > 1e-9 ? (this.m4 / this.n) / (variance * variance) : 3.0;
    return {
      meanA: this.mean,
      stragglingA,
      skewness,
      kurtosis,
    };
  }
}

/**
 * Norgett-Robinson-Torrens (NRT) / Lindhard damage partition for Quick Kinchin-Pease Mode 1.
 */
export function calcQuickKinchinPeaseDamage(
  z2: number,
  m2: number,
  recoilEnergyEv: number,
  edEv: number,
  ebEv: number,
  useArcDpa: boolean = false
): {
  vacancies: number;
  damageEnergyEv: number;
  recoilIonizationEv: number;
  recoilPhononEv: number;
  recoilBindingEv: number;
} {
  if (recoilEnergyEv <= 0) {
    return {
      vacancies: 0,
      damageEnergyEv: 0,
      recoilIonizationEv: 0,
      recoilPhononEv: 0,
      recoilBindingEv: 0,
    };
  }
  if (recoilEnergyEv < edEv) {
    // Sub-threshold collision -> all recoil energy goes into target phonons
    return {
      vacancies: 0,
      damageEnergyEv: 0,
      recoilIonizationEv: 0,
      recoilPhononEv: recoilEnergyEv,
      recoilBindingEv: 0,
    };
  }

  // Subtract lattice binding energy Eb when atom leaves lattice site
  const eRecoilInit = Math.max(0, recoilEnergyEv - ebEv);

  // Lindhard reduced energy epsilon_L for self-cascade (Z2, M2 into Z2, M2)
  const epsL =
    (0.01151 * eRecoilInit) / Math.pow(Math.max(1, z2), 7.0 / 3.0);
  const kL =
    (0.1337 * Math.pow(Math.max(1, z2), 2.0 / 3.0)) /
    Math.sqrt(Math.max(1, m2));
  const gEps =
    epsL + 0.40244 * Math.pow(epsL, 0.75) + 3.4008 * Math.pow(epsL, 1.0 / 6.0);

  const damageEnergyEv = eRecoilInit / (1.0 + kL * gEps);
  const recoilIonizationEv = Math.max(0, eRecoilInit - damageEnergyEv);

  // Modified Kinchin-Pease or Nordlund ARC-dpa surviving Frenkel pairs:
  let vacancies = 1.0;
  if (useArcDpa) {
    vacancies = calcArcDpaVacancies(damageEnergyEv, edEv, z2);
  } else if (damageEnergyEv >= 2.5 * edEv) {
    vacancies = (0.4 * damageEnergyEv) / Math.max(1.0, edEv);
  }

  const recoilBindingEv = Math.min(damageEnergyEv, vacancies * ebEv);
  const recoilPhononEv = Math.max(0, recoilEnergyEv - recoilIonizationEv - recoilBindingEv);

  return {
    vacancies,
    damageEnergyEv,
    recoilIonizationEv,
    recoilPhononEv,
    recoilBindingEv,
  };
}

interface PreparedLayer {
  layer: TrimLayerConfig;
  startDepthA: number;
  endDepthA: number;
  atomDensityPerA3: number;
  monolayerJumpA: number;
  pMaxMonoA: number;
  meanZ2: number;
  meanM2: number;
  meanEbEv: number;
  minEsEv: number;
  totalStoich: number;
  effectiveCompoundCorr: number;
  stoppingElements: { z: number; mass: number; stoich: number }[];
  elementProbs: number[];
}

interface UniqueTargetElement {
  z: number;
  symbol: string;
  name: string;
  massAmu: number;
  edEv: number;
  ebEv: number;
  esEv: number;
}

export class TrimSimulator {
  private config: TrimSetupConfig;
  private rng: () => number;
  private preparedLayers: PreparedLayer[] = [];
  private totalTargetDepthA: number = 0;
  private plotMinA: number = 0;
  private plotMaxA: number = 1000;
  private binWidthA: number = 10;
  private binDepthsA: number[] = [];
  private uniqueElements: UniqueTargetElement[] = [];
  private elemIndexByZ = new Map<number, number>();

  // Simulation counters
  private completedIons = 0;
  private stoppedCount = 0;
  private backscatteredCount = 0;
  private transmittedCount = 0;
  private totalVacancies = 0;
  private totalDisplacements = 0;
  private totalReplacements = 0;
  private totalInterstitials = 0;
  private escapedRecoilsCount = 0;
  private totalSputteredCount = 0;
  private sputteredCountByElem: number[] = [];
  private sputteredEnergySumByElem: number[] = [];

  // Total energy partitions (eV)
  private totalIonizIonEv = 0;
  private totalIonizRecoilEv = 0;
  private totalPhononIonEv = 0;
  private totalPhononRecoilEv = 0;
  private totalBindingIonEv = 0;
  private totalBindingRecoilEv = 0;

  // O(1)-memory streaming 4-moment accumulators (exact up to 1M+ ions)
  private rmDepth = new RunningMoments();
  private rmAbsLatY = new RunningMoments();
  private rmLatY = new RunningMoments();
  private rmRadial = new RunningMoments();

  // 100-bin depth histograms (raw sums, normalized in getSnapshot)
  private histIonRange = new Array<number>(100).fill(0);
  private histRecoilRangeByElem: number[][] = [];
  private histLatY = new Array<number>(100).fill(0);
  private histLatZ = new Array<number>(100).fill(0);
  private histRadialR = new Array<number>(100).fill(0);
  private histIonizIon = new Array<number>(100).fill(0);
  private histIonizRecoil = new Array<number>(100).fill(0);
  private histPhononIon = new Array<number>(100).fill(0);
  private histPhononRecoil = new Array<number>(100).fill(0);
  private histE2Recoil = new Array<number>(100).fill(0);
  private histVacIon = new Array<number>(100).fill(0);
  private histVacRecoil = new Array<number>(100).fill(0);
  private histVacByElem: number[][] = [];
  private histReplacements = new Array<number>(100).fill(0);
  private histInterstitials = new Array<number>(100).fill(0);

  // Bounded display records (up to 1M+ ions without OOM)
  private static readonly MAX_TRAJECTORIES = 500;
  private static readonly MAX_STOPPED_MARKERS = 4000;
  private static readonly MAX_ESCAPED_RECORDS = 2000;
  private static readonly MAX_SPUTTERED_RECORDS = 2000;
  private static readonly MAX_COLLISIONS = 500;

  private trajectories: TrimTrajectory[] = [];
  private backscatteredIons: TransmittedIonRecord[] = [];
  private transmittedIons: TransmittedIonRecord[] = [];
  private stoppedIons: TransmittedIonRecord[] = [];
  private sputteredAtoms: TrimSputteredAtom[] = [];
  // O(1)-memory surface arrival counts [elemIndex][esGridIdx] for sputtering yield vs Es curve
  private surfaceArrivalCounts: number[][] = [];
  private collisions: TrimCollisionEvent[] = [];

  // Post-SRIM-2003 Advanced Physics state
  private crystalRotMat: Mat3 | null = null;
  private crystalCell: CrystalUnitCellSpec | null = null;
  private crystalSigmaVibA = 0.0;
  private amorphousDpaByBin = new Float64Array(100);
  private slabDensityScale = new Float64Array(100).fill(1.0);
  private slabImplantedAtoms = new Float64Array(100);
  private erodedDepthA = 0.0;
  private channeledIonCount = 0;

  constructor(config: TrimSetupConfig) {
    this.config = {
      ...config,
      totalIons: Math.max(1, Math.min(MAX_SIMULATION_IONS, Math.round(config.totalIons || 1000))),
    };
    this.rng = createRng(config.randomSeed || 98765);
    this.initGeometry();
  }

  /**
   * Updates target ion count mid-run (up to 1,000,000) without discarding progress.
   */
  public setTotalIons(totalIons: number): void {
    this.config.totalIons = Math.max(
      1,
      Math.min(MAX_SIMULATION_IONS, Math.round(totalIons || 1))
    );
  }

  private initGeometry(): void {
    let curDepth = 0.0;
    this.preparedLayers = [];
    this.uniqueElements = [];
    this.elemIndexByZ.clear();

    for (const layer of this.config.layers) {
      const width = Math.max(1.0, layer.widthA);
      const startDepthA = curDepth;
      const endDepthA = curDepth + width;
      curDepth = endDepthA;

      const totalStoich =
        layer.elements.reduce((acc, el) => acc + Math.max(0, el.stoich), 0) || 1.0;
      let meanM2 = 0.0;
      let meanZ2 = 0.0;
      let meanEbEv = 0.0;
      let minEsEv = 1e9;
      const probs: number[] = [];

      for (const el of layer.elements) {
        const p = Math.max(0, el.stoich) / totalStoich;
        probs.push(p);
        meanM2 += p * el.massAmu;
        meanZ2 += p * el.z;
        meanEbEv += p * el.latticeBindingEv;
        if (el.surfaceBindingEv > 0 && el.surfaceBindingEv < minEsEv) {
          minEsEv = el.surfaceBindingEv;
        }
        if (!this.elemIndexByZ.has(el.z)) {
          this.elemIndexByZ.set(el.z, this.uniqueElements.length);
          this.uniqueElements.push({
            z: el.z,
            symbol: el.symbol,
            name: el.name,
            massAmu: el.massAmu,
            edEv: el.displacementEv,
            ebEv: el.latticeBindingEv,
            esEv: el.surfaceBindingEv,
          });
        }
      }
      if (meanM2 <= 0) meanM2 = 28.086;
      if (minEsEv > 1e8) minEsEv = 4.7;

      const atomDensityPerCm3 = (layer.densityGPerCm3 * 6.02214076e23) / meanM2;
      const atomDensityPerA3 = Math.max(1e-6, atomDensityPerCm3 * 1e-24);
      const monolayerJumpA = Math.pow(atomDensityPerA3, -1.0 / 3.0);
      const pMaxMonoA = 1.0 / Math.sqrt(Math.PI * atomDensityPerA3 * monolayerJumpA);

      const stoppingElements = layer.elements.map((e) => ({
        z: e.z,
        mass: e.massAmu,
        stoich: e.stoich,
      }));
      const effectiveCompoundCorr =
        layer.compoundCorr * (this.config.braggCorrection || 1.0);

      this.preparedLayers.push({
        layer,
        startDepthA,
        endDepthA,
        atomDensityPerA3,
        monolayerJumpA,
        pMaxMonoA,
        meanZ2,
        meanM2,
        meanEbEv,
        minEsEv,
        totalStoich,
        effectiveCompoundCorr,
        stoppingElements,
        elementProbs: probs,
      });
    }

    this.totalTargetDepthA = Math.max(10.0, curDepth);
    this.plotMinA = Math.max(0, this.config.plotXMinA || 0);
    this.plotMaxA =
      this.config.plotXMaxA && this.config.plotXMaxA > this.plotMinA
        ? Math.min(this.totalTargetDepthA, this.config.plotXMaxA)
        : this.totalTargetDepthA;
    this.binWidthA = Math.max(0.1, (this.plotMaxA - this.plotMinA) / 100.0);
    this.binDepthsA = Array.from(
      { length: 100 },
      (_, i) => this.plotMinA + (i + 0.5) * this.binWidthA
    );

    this.histRecoilRangeByElem = this.uniqueElements.map(() =>
      new Array<number>(100).fill(0)
    );
    this.histVacByElem = this.uniqueElements.map(() =>
      new Array<number>(100).fill(0)
    );
    this.surfaceArrivalCounts = this.uniqueElements.map(() =>
      new Array<number>(SPUTTER_ES_GRID.length).fill(0)
    );
    this.sputteredCountByElem = new Array<number>(this.uniqueElements.length).fill(0);
    this.sputteredEnergySumByElem = new Array<number>(this.uniqueElements.length).fill(0);

    // Initialize Crystal-TRIM rotation & unit cell + TRIDYN slab state if configured
    const adv = this.config.advancedPhysics;
    this.amorphousDpaByBin.fill(0);
    this.slabDensityScale.fill(1.0);
    this.slabImplantedAtoms.fill(0);
    this.erodedDepthA = 0.0;
    this.channeledIonCount = 0;

    if (adv?.crystalMode && this.preparedLayers.length > 0) {
      const l0 = this.preparedLayers[0];
      this.crystalRotMat = buildCrystalRotationMatrix(
        adv.crystalOrientation,
        adv.customMiller,
        adv.crystalTiltDeg || 0,
        adv.crystalTwistDeg || 0
      );
      this.crystalCell = buildCrystalUnitCell(
        adv.crystalLattice,
        adv.latticeConstantA || 5.431,
        adv.latticeCConstantA
      );
      this.crystalSigmaVibA = calcDebyeVibrationSigmaA(
        l0.meanM2,
        adv.debyeTempK || 645,
        adv.targetTempK || 300
      );
    } else {
      this.crystalRotMat = null;
      this.crystalCell = null;
      this.crystalSigmaVibA = 0.0;
    }
  }

  private getLayerAtDepth(xA: number): PreparedLayer {
    for (let i = 0; i < this.preparedLayers.length; i++) {
      const pl = this.preparedLayers[i];
      if (xA >= pl.startDepthA && xA <= pl.endDepthA) {
        return pl;
      }
    }
    return this.preparedLayers[this.preparedLayers.length - 1];
  }

  private depthToBin(xA: number): number {
    const idx = Math.floor((xA - this.plotMinA) / this.binWidthA);
    if (idx < 0 || idx >= 100) return -1;
    return idx;
  }

  private nextGaussian(): number {
    const u1 = Math.max(1e-12, this.rng());
    const u2 = this.rng();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  private selectTargetElement(pl: PreparedLayer): TrimElementConfig {
    const r = this.rng();
    let cum = 0.0;
    for (let i = 0; i < pl.layer.elements.length; i++) {
      cum += pl.elementProbs[i];
      if (r <= cum) return pl.layer.elements[i];
    }
    return pl.layer.elements[pl.layer.elements.length - 1];
  }

  /**
   * Simulates a batch of ions and returns the updated snapshot.
   */
  public runBatch(count: number = 10): TrimSnapshot {
    const targetTotal =
      this.config.calculationMode === 4 && this.config.customTrimDatEvents
        ? this.config.customTrimDatEvents.length
        : this.config.totalIons;
    const nToRun = Math.min(count, Math.max(0, targetTotal - this.completedIons));

    for (let i = 0; i < nToRun; i++) {
      this.simulateSingleIon();
    }
    return this.getSnapshot();
  }

  private simulateSingleIon(): void {
    const ionNumber = this.completedIons + 1;
    this.completedIons = ionNumber;

    let z1 = this.config.ion.z1;
    let m1 = this.config.ion.massAmu;
    let energyEv = this.config.ion.energyKeV * 1000.0;
    let xA = 0.0;
    let yA = 0.0;
    let zA = 0.0;
    const angleRad = (this.config.ion.angleDeg * Math.PI) / 180.0;
    let cosX = Math.cos(angleRad);
    let cosY = Math.sin(angleRad);
    let cosZ = 0.0;
    let eventName: string | undefined;

    if (
      this.config.calculationMode === 4 &&
      this.config.customTrimDatEvents &&
      this.config.customTrimDatEvents.length >= ionNumber
    ) {
      const ev = this.config.customTrimDatEvents[ionNumber - 1];
      eventName = ev.name;
      z1 = ev.z1;
      const elInfo = getElementByZ(z1);
      m1 = elInfo.naturalWeight || elInfo.maiWeight || 12.011;
      energyEv = ev.energyEv;
      xA = Math.max(0, ev.xA);
      yA = ev.yA;
      zA = ev.zA;
      const norm = Math.sqrt(ev.cosX * ev.cosX + ev.cosY * ev.cosY + ev.cosZ * ev.cosZ) || 1.0;
      cosX = ev.cosX / norm;
      cosY = ev.cosY / norm;
      cosZ = ev.cosZ / norm;
    }

    const trackReplaceIdx =
      this.trajectories.length < TrimSimulator.MAX_TRAJECTORIES
        ? this.trajectories.length
        : Math.floor(this.rng() * ionNumber);
    const recordTrack = trackReplaceIdx < TrimSimulator.MAX_TRAJECTORIES;
    const points: TrimPoint3D[] = recordTrack
      ? [{ xA, yA, zA, energyEv }]
      : [];
    const recoils: TrimRecoilTrack[] = [];

    const isCascadeMode =
      this.config.calculationMode === 2 ||
      this.config.calculationMode === 3 ||
      this.config.calculationMode === 4;
    const isMonolayerMode = this.config.calculationMode === 3;
    const adv = this.config.advancedPhysics;
    const potential: ScreeningPotentialType = adv?.screeningPotential ?? 'zbl';
    const useArcDpa = Boolean(adv?.arcDpaRecombination);
    const crystalActive = Boolean(
      adv?.crystalMode && this.crystalCell && this.crystalRotMat
    );
    const crystalCell = this.crystalCell;
    const crystalRot = this.crystalRotMat;
    const cyIonOffset = crystalCell ? this.rng() * crystalCell.ay : 0.0;
    const czIonOffset = crystalCell ? this.rng() * crystalCell.az : 0.0;

    // Dose weight per simulated ion (ions/cm^2 per history) for Dynamic Damage & TRIDYN
    const simIonTotal = Math.max(1, this.config.totalIons);
    const fluencePerSimIon = Math.max(0, adv?.doseCm2 ?? 1e13) / simIonTotal;

    // 2D Mask / Gate Edge Shadowing (Y window [-W/2, W/2] in [-0.75W, 0.75W] illuminated band)
    if (adv?.mask2dEnabled && (adv.maskOpeningA ?? 0) > 0 && this.config.calculationMode !== 4) {
      const halfOpen = 0.5 * adv.maskOpeningA;
      yA = (this.rng() * 2.0 - 1.0) * (1.5 * halfOpen);
      if (recordTrack && points.length > 0) {
        points[0].yA = yA;
      }
      if (Math.abs(yA) > halfOpen) {
        // Ion strikes opaque gate/hardmask overhang of thickness maskThicknessA (~W/SiO2 stopper)
        const maskStopEv = Math.max(0, (adv.maskThicknessA || 300) * 45.0);
        if (energyEv <= maskStopEv) {
          this.totalPhononIonEv += energyEv;
          energyEv = 0;
          if (recordTrack) points.push({ xA: 0, yA, zA, energyEv: 0 });
          this.stoppedCount += 1;
          return;
        }
        energyEv -= maskStopEv;
        this.totalIonizIonEv += maskStopEv;
      }
    }

    let steps = 0;
    const maxSteps = crystalActive ? 40000 : 20000;
    let totalStepsTaken = 0;
    let channeledSteps = 0;
    let fate: 'stopped' | 'backscattered' | 'transmitted' = 'stopped';

    while (steps < maxSteps) {
      steps++;
      const pl = this.getLayerAtDepth(xA);
      const eStopEv = Math.max(5.0, pl.minEsEv);
      if (energyEv <= eStopEv) {
        // Remaining kinetic energy goes to phonons
        this.totalPhononIonEv += energyEv;
        const bin = this.depthToBin(xA);
        if (bin >= 0) {
          this.histPhononIon[bin] += energyEv;
        }
        energyEv = 0;
        fate = 'stopped';
        break;
      }

      const curBinPre = this.depthToBin(xA);
      const rhoScale =
        adv?.dynamicComposition && curBinPre >= 0
          ? Math.max(0.1, this.slabDensityScale[curBinPre])
          : 1.0;
      const localAtomDensityA3 = pl.atomDensityPerA3 * rhoScale;
      const localDensityGcm3 = pl.layer.densityGPerCm3 * rhoScale;

      // Compute free-flight jump length L and max impact parameter P_max
      const aU = calcScreeningLengthA(z1, pl.meanZ2, potential);
      const eCmEv = (energyEv * pl.meanM2) / (m1 + pl.meanM2);
      const eps = Math.max(
        1e-7,
        (eCmEv * aU) / (14.39979 * z1 * pl.meanZ2)
      );
      const gammaMean =
        (4.0 * m1 * pl.meanM2) / Math.pow(m1 + pl.meanM2, 2);

      let jumpLengthA = pl.monolayerJumpA / Math.cbrt(rhoScale);
      if (!isMonolayerMode && energyEv > 200.0) {
        const tMinEv = 5.0;
        const bMaxRed = Math.sqrt(
          Math.max(
            0.25,
            (gammaMean * energyEv) /
              (tMinEv * Math.max(1.0, 4.0 * eps * eps))
          )
        );
        const pMaxEnergyA = Math.max(
          pl.pMaxMonoA,
          Math.min(aU * (bMaxRed + 1.5), pl.pMaxMonoA * 3.0)
        );
        const meanFreePathA =
          1.0 / (Math.PI * localAtomDensityA3 * pMaxEnergyA * pMaxEnergyA);
        const maxJumpPhysicalA = Math.min(
          40.0,
          Math.max(10.0, 0.05 * Math.sqrt(energyEv))
        );
        jumpLengthA = Math.max(
          pl.monolayerJumpA,
          Math.min(meanFreePathA, maxJumpPhysicalA)
        );
      }

      // Decide crystal lattice step vs amorphous BCA step (modulated by dynamic amorphization DPA)
      const dpaHere = curBinPre >= 0 ? this.amorphousDpaByBin[curBinPre] : 0.0;
      const critDpa = Math.max(1e-4, adv?.criticalDpa || 0.1);
      const pAmorphHere =
        crystalActive && adv?.dynamicDamage
          ? 1.0 - Math.exp(-dpaHere / critDpa)
          : 0.0;
      const useCrystalStep =
        crystalActive &&
        crystalCell !== null &&
        crystalRot !== null &&
        this.rng() >= pAmorphHere;

      let crystalHits: ReturnType<typeof findCrystalCollisionsAlongRay> = [];
      let crystalImpactRefA = 0.0;
      if (useCrystalStep && crystalCell && crystalRot) {
        const [cx0, cy0, cz0] = rotateLabToCrystal(crystalRot, xA, yA, zA);
        const [dxC, dyC, dzC] = rotateLabToCrystal(
          crystalRot,
          cosX,
          cosY,
          cosZ
        );
        const maxSearchA = Math.min(jumpLengthA, crystalCell.ax * 0.85, 8.0);
        const maxImpactCrystalA = Math.min(2.2, Math.max(1.3, pl.pMaxMonoA * 1.25));
        crystalHits = findCrystalCollisionsAlongRay(
          crystalCell,
          cx0,
          cy0 + cyIonOffset,
          cz0 + czIonOffset,
          dxC,
          dyC,
          dzC,
          0.15,
          maxSearchA,
          maxImpactCrystalA,
          this.crystalSigmaVibA,
          () => this.nextGaussian(),
          adv?.simultaneousCollisions ? 4 : 1
        );
        if (crystalHits.length > 0) {
          jumpLengthA = Math.max(0.15, crystalHits[0].pathStepA);
          crystalImpactRefA = crystalHits[0].impactParamA;
          if (crystalImpactRefA > 0.7) channeledSteps += 1;
        } else {
          // Open axial/planar channel glide!
          jumpLengthA = maxSearchA;
          crystalImpactRefA = maxImpactCrystalA;
          channeledSteps += 1;
        }
      }
      totalStepsTaken += 1;

      // Advance along current direction
      const nextXA = xA + jumpLengthA * cosX;
      const nextYA = yA + jumpLengthA * cosY;
      const nextZA = zA + jumpLengthA * cosZ;

      // Check surface exit (Backscattering: x < 0) or Transmission (x > totalTargetDepthA)
      if (nextXA < 0.0) {
        const frac = xA > 0 && cosX < 0 ? xA / (-jumpLengthA * cosX) : 0.0;
        const stepActualA = Math.max(0, frac * jumpLengthA);
        const stopInfo = calcLayerStopping(
          z1,
          m1,
          energyEv / 1000.0,
          pl.stoppingElements,
          localDensityGcm3,
          pl.layer.phase,
          pl.effectiveCompoundCorr,
          1,
          true,
          true
        );
        const deIonizEv = Math.min(energyEv, stopInfo.seEvPerA * stepActualA);
        energyEv -= deIonizEv;
        this.totalIonizIonEv += deIonizEv;
        const bin = this.depthToBin(0.5 * xA);
        if (bin >= 0) this.histIonizIon[bin] += deIonizEv;

        xA = 0.0;
        yA += stepActualA * cosY;
        zA += stepActualA * cosZ;
        if (recordTrack) points.push({ xA, yA, zA, energyEv });
        fate = 'backscattered';
        break;
      }

      if (nextXA > this.totalTargetDepthA) {
        const frac =
          xA < this.totalTargetDepthA && cosX > 0
            ? (this.totalTargetDepthA - xA) / (jumpLengthA * cosX)
            : 0.0;
        const stepActualA = Math.max(0, frac * jumpLengthA);
        const stopInfo = calcLayerStopping(
          z1,
          m1,
          energyEv / 1000.0,
          pl.stoppingElements,
          localDensityGcm3,
          pl.layer.phase,
          pl.effectiveCompoundCorr,
          1,
          true,
          true
        );
        const deIonizEv = Math.min(energyEv, stopInfo.seEvPerA * stepActualA);
        energyEv -= deIonizEv;
        this.totalIonizIonEv += deIonizEv;
        const bin = this.depthToBin(0.5 * (xA + this.totalTargetDepthA));
        if (bin >= 0) this.histIonizIon[bin] += deIonizEv;

        xA = this.totalTargetDepthA;
        yA += stepActualA * cosY;
        zA += stepActualA * cosZ;
        if (recordTrack) points.push({ xA, yA, zA, energyEv });
        fate = 'transmitted';
        break;
      }

      // Compute impact parameter P early if amorphous, so Oen-Robinson Se(b) can use it consistently
      const pMaxStepA = 1.0 / Math.sqrt(Math.PI * localAtomDensityA3 * jumpLengthA);
      const amorphousImpactParamA = pMaxStepA * Math.sqrt(this.rng());
      const effectiveImpactForSeA = useCrystalStep
        ? crystalImpactRefA
        : amorphousImpactParamA;

      // Electronic energy loss over jumpLengthA (SCOEF03 + optional Oen-Robinson b-dependence + Bohr straggling)
      const midXA = 0.5 * (xA + nextXA);
      const stopInfo = calcLayerStopping(
        z1,
        m1,
        energyEv / 1000.0,
        pl.stoppingElements,
        localDensityGcm3,
        pl.layer.phase,
        pl.effectiveCompoundCorr,
        1,
        true,
        true
      );
      const baseSeStepEv = adv?.localElectronicStopping
        ? calcOenRobinsonStoppingEv(
            stopInfo.seEvPerA,
            jumpLengthA,
            effectiveImpactForSeA,
            aU,
            Math.max(pMaxStepA, pl.pMaxMonoA * 1.25)
          )
        : stopInfo.seEvPerA * jumpLengthA;
      const meanDeIonizEv = Math.min(
        energyEv - eStopEv * 0.5,
        Math.max(0, baseSeStepEv)
      );
      // Lindhard-Scharff & Bonderup velocity reduction factor fStrag for low-velocity Bohr straggling
      const ePerAmu = energyEv / (1000.0 * m1);
      const fStrag = Math.min(1.0, ePerAmu / 25.0);
      const bohrVar = 260.0 * z1 * z1 * pl.meanZ2 * localAtomDensityA3 * jumpLengthA * fStrag;
      const maxStrag = 0.3 * meanDeIonizEv;
      const rawStrag = Math.sqrt(Math.max(0, bohrVar)) * this.nextGaussian();
      const stragEv = Math.min(maxStrag, Math.max(-maxStrag, rawStrag));
      const deIonizEv = Math.max(
        0,
        Math.min(energyEv - eStopEv * 0.5, meanDeIonizEv + stragEv)
      );
      if (deIonizEv > 0) {
        energyEv -= deIonizEv;
        this.totalIonizIonEv += deIonizEv;
        const binMid = this.depthToBin(midXA);
        if (binMid >= 0) {
          this.histIonizIon[binMid] += deIonizEv;
        }
      }

      xA = nextXA;
      yA = nextYA;
      zA = nextZA;

      if (energyEv <= eStopEv) {
        this.totalPhononIonEv += energyEv;
        const bin = this.depthToBin(xA);
        if (bin >= 0) this.histPhononIon[bin] += energyEv;
        energyEv = 0;
        if (recordTrack) points.push({ xA, yA, zA, energyEv });
        fate = 'stopped';
        break;
      }

      // Handle open-channel crystal glide (zero nuclear collision inside cutoff)
      if (useCrystalStep && crystalHits.length === 0) {
        if (recordTrack && (steps % 4 === 0 || energyEv <= eStopEv)) {
          points.push({ xA, yA, zA, energyEv });
        }
        continue;
      }

      // Select collision partner(s) & compute scattering (crystal simultaneous or amorphous single BCA)
      let targetEl = this.selectTargetElement(pl);
      let recoilEnergyEv = 0;
      let recCosX = cosX;
      let recCosY = cosY;
      let recCosZ = cosZ;

      if (useCrystalStep && crystalHits.length > 0 && crystalRot) {
        // Primary strongest / closest hit provides PKA direction; simultaneous neighbors add vector deflection
        let sumDvX = 0.0;
        let sumDvY = 0.0;
        let sumDvZ = 0.0;
        let primaryT = 0.0;

        for (let hIdx = 0; hIdx < crystalHits.length; hIdx++) {
          const hit = crystalHits[hIdx];
          const elAtSub =
            pl.layer.elements[hit.sublattice % pl.layer.elements.length] ||
            targetEl;
          const sHit = calcMagicScattering(
            z1,
            m1,
            elAtSub.z,
            elAtSub.massAmu,
            energyEv,
            hit.impactParamA,
            potential
          );
          const tHit = Math.min(energyEv, sHit.recoilEnergyEv);
          energyEv -= tHit;

          const [nxL, nyL, nzL] = rotateCrystalToLab(
            crystalRot,
            hit.normalCrystX,
            hit.normalCrystY,
            hit.normalCrystZ
          );
          // Deflect projectile away from atom along -nL cleanly in collision plane
          sumDvX += (sHit.cosPsiIon - 1.0) * cosX - sHit.sinPsiIon * nxL;
          sumDvY += (sHit.cosPsiIon - 1.0) * cosY - sHit.sinPsiIon * nyL;
          sumDvZ += (sHit.cosPsiIon - 1.0) * cosZ - sHit.sinPsiIon * nzL;

          if (hIdx === 0) {
            targetEl = elAtSub;
            primaryT = tHit;
            // Recoil kicks along atom direction (+nL)
            const rNorm =
              Math.sqrt(
                Math.pow(sHit.cosPsiRecoil * cosX + sHit.sinPsiRecoil * nxL, 2) +
                  Math.pow(sHit.cosPsiRecoil * cosY + sHit.sinPsiRecoil * nyL, 2) +
                  Math.pow(sHit.cosPsiRecoil * cosZ + sHit.sinPsiRecoil * nzL, 2)
              ) || 1.0;
            recCosX = (sHit.cosPsiRecoil * cosX + sHit.sinPsiRecoil * nxL) / rNorm;
            recCosY = (sHit.cosPsiRecoil * cosY + sHit.sinPsiRecoil * nyL) / rNorm;
            recCosZ = (sHit.cosPsiRecoil * cosZ + sHit.sinPsiRecoil * nzL) / rNorm;
          } else {
            this.totalPhononIonEv += tHit;
          }
        }
        recoilEnergyEv = primaryT;
        const uxNew = cosX + sumDvX;
        const uyNew = cosY + sumDvY;
        const uzNew = cosZ + sumDvZ;
        const uNorm = Math.sqrt(uxNew * uxNew + uyNew * uyNew + uzNew * uzNew) || 1.0;
        cosX = uxNew / uNorm;
        cosY = uyNew / uNorm;
        cosZ = uzNew / uNorm;
      } else {
        const scat = calcMagicScattering(
          z1,
          m1,
          targetEl.z,
          targetEl.massAmu,
          energyEv,
          amorphousImpactParamA,
          potential
        );
        recoilEnergyEv = Math.min(energyEv, scat.recoilEnergyEv);
        energyEv -= recoilEnergyEv;

        const phi = 2.0 * Math.PI * this.rng();
        [recCosX, recCosY, recCosZ] = rotateDirection3D(
          cosX,
          cosY,
          cosZ,
          scat.cosPsiRecoil,
          scat.sinPsiRecoil,
          phi + Math.PI
        );
        [cosX, cosY, cosZ] = rotateDirection3D(
          cosX,
          cosY,
          cosZ,
          scat.cosPsiIon,
          scat.sinPsiIon,
          phi
        );
      }

      const elemIdx = this.elemIndexByZ.get(targetEl.z) ?? 0;
      const binCol = this.depthToBin(xA);

      if (!isCascadeMode) {
        // Mode 1 (Quick Kinchin-Pease or Nordlund ARC-dpa)
        const kp = calcQuickKinchinPeaseDamage(
          targetEl.z,
          targetEl.massAmu,
          recoilEnergyEv,
          targetEl.displacementEv,
          targetEl.latticeBindingEv,
          useArcDpa
        );
        if (recoilEnergyEv >= targetEl.displacementEv) {
          this.totalDisplacements += kp.vacancies;
          this.totalVacancies += kp.vacancies;
          const isReplacement =
            energyEv < targetEl.displacementEv && z1 === targetEl.z ? 1 : 0;
          this.totalReplacements += isReplacement;
          this.totalInterstitials += Math.max(0, kp.vacancies - isReplacement);

          this.totalIonizRecoilEv += kp.recoilIonizationEv;
          this.totalPhononRecoilEv += kp.recoilPhononEv;
          const ionBind = Math.min(kp.recoilBindingEv, targetEl.latticeBindingEv);
          this.totalBindingIonEv += ionBind;
          this.totalBindingRecoilEv += Math.max(
            0,
            kp.recoilBindingEv - ionBind
          );

          if (binCol >= 0) {
            this.histE2Recoil[binCol] += recoilEnergyEv;
            this.histIonizRecoil[binCol] += kp.recoilIonizationEv;
            this.histPhononRecoil[binCol] += kp.recoilPhononEv;
            this.histVacIon[binCol] += Math.min(1.0, kp.vacancies);
            const secVac = Math.max(0, kp.vacancies - Math.min(1.0, kp.vacancies));
            this.histVacRecoil[binCol] += secVac;
            this.histVacByElem[elemIdx][binCol] += kp.vacancies;
            this.histRecoilRangeByElem[elemIdx][binCol] += kp.vacancies;
            this.histReplacements[binCol] += isReplacement;
            this.histInterstitials[binCol] += Math.max(
              0,
              kp.vacancies - isReplacement
            );
            // Accumulate DPA in slab for dynamic Crystal-TRIM amorphization
            if (adv?.dynamicDamage && fluencePerSimIon > 0) {
              const binAtomsPerCm2 = localAtomDensityA3 * 1e16 * this.binWidthA;
              this.amorphousDpaByBin[binCol] +=
                (kp.vacancies * fluencePerSimIon) / Math.max(1e10, binAtomsPerCm2);
            }
          }

          if (this.collisions.length < TrimSimulator.MAX_COLLISIONS) {
            this.collisions.push({
              ionNumber,
              energyKeV: (energyEv + recoilEnergyEv) / 1000.0,
              depthA: xA,
              yA,
              zA,
              seEvPerA: stopInfo.seEvPerA,
              z2: targetEl.z,
              symbol: targetEl.symbol,
              recoilEnergyEv,
              displacements: kp.vacancies,
              vacancies: kp.vacancies,
              replacements: isReplacement,
              interstitials: Math.max(0, kp.vacancies - isReplacement),
            });
          }
        } else {
          // Sub-threshold energy transfer from ion goes to ion phonons
          this.totalPhononIonEv += recoilEnergyEv;
          if (binCol >= 0) {
            this.histPhononIon[binCol] += recoilEnergyEv;
          }
        }
      } else {
        // Mode 2 / Mode 3 / Mode 4: Full Recoil Cascade Simulation
        const minCascadeThresholdEv = Math.min(
          targetEl.displacementEv,
          xA < 40.0 ? targetEl.surfaceBindingEv : targetEl.displacementEv
        );

        if (recoilEnergyEv >= minCascadeThresholdEv) {
          const isDisplaced = recoilEnergyEv >= targetEl.displacementEv;
          const ebCost = isDisplaced ? targetEl.latticeBindingEv : 0.0;
          const eRecoilStart = Math.max(0, recoilEnergyEv - ebCost);

          if (isDisplaced) {
            this.totalDisplacements += 1;
            this.totalVacancies += 1;
            this.totalBindingIonEv += ebCost;
            if (binCol >= 0) {
              this.histVacIon[binCol] += 1;
              this.histVacByElem[elemIdx][binCol] += 1;
            }
          }

          if (binCol >= 0) {
            this.histE2Recoil[binCol] += recoilEnergyEv;
          }

          const cascadeStats = this.simulateRecoilCascade(
            ionNumber,
            targetEl.z,
            targetEl.symbol,
            targetEl.massAmu,
            eRecoilStart,
            xA,
            yA,
            zA,
            recCosX,
            recCosY,
            recCosZ,
            isDisplaced,
            recordTrack && recoils.length < 60 ? recoils : undefined,
            potential
          );

          if (adv?.dynamicDamage && fluencePerSimIon > 0 && binCol >= 0 && isDisplaced) {
            const binAtomsPerCm2 = localAtomDensityA3 * 1e16 * this.binWidthA;
            this.amorphousDpaByBin[binCol] +=
              ((1 + cascadeStats.vacancies) * fluencePerSimIon) /
              Math.max(1e10, binAtomsPerCm2);
          }

          if (this.collisions.length < TrimSimulator.MAX_COLLISIONS && isDisplaced) {
            this.collisions.push({
              ionNumber,
              energyKeV: (energyEv + recoilEnergyEv) / 1000.0,
              depthA: xA,
              yA,
              zA,
              seEvPerA: stopInfo.seEvPerA,
              z2: targetEl.z,
              symbol: targetEl.symbol,
              recoilEnergyEv,
              displacements: 1 + cascadeStats.displacements,
              vacancies: 1 + cascadeStats.vacancies,
              replacements: cascadeStats.replacements,
              interstitials: cascadeStats.interstitials,
            });
          }
        } else {
          // Sub-threshold transfer -> ion phonon loss
          this.totalPhononIonEv += recoilEnergyEv;
          if (binCol >= 0) {
            this.histPhononIon[binCol] += recoilEnergyEv;
          }
        }
      }

      if (recordTrack && (steps % 2 === 0 || energyEv <= eStopEv)) {
        points.push({ xA, yA, zA, energyEv });
      }
    }

    // Ensure residual kinetic energy is credited to phonons if maxSteps was reached
    if (energyEv > 0 && fate === 'stopped') {
      this.totalPhononIonEv += energyEv;
      const bin = this.depthToBin(xA);
      if (bin >= 0) {
        this.histPhononIon[bin] += energyEv;
      }
      energyEv = 0;
    }

    // Record final ion fate
    if (fate === 'stopped') {
      this.stoppedCount += 1;
      this.rmDepth.push(xA);
      this.rmAbsLatY.push(Math.abs(yA));
      this.rmLatY.push(yA);
      const radR = Math.sqrt(yA * yA + zA * zA);
      this.rmRadial.push(radR);

      const bin = this.depthToBin(xA);
      if (bin >= 0) {
        this.histIonRange[bin] += 1;
        this.histLatY[bin] += Math.abs(yA);
        this.histLatZ[bin] += Math.abs(zA);
        this.histRadialR[bin] += radR;
        if (adv?.dynamicComposition && fluencePerSimIon > 0) {
          const plStop = this.getLayerAtDepth(xA);
          const slabCapacityCm2 = Math.max(1e10, plStop.atomDensityPerA3 * 1e16 * this.binWidthA);
          this.slabImplantedAtoms[bin] += fluencePerSimIon;
          this.slabDensityScale[bin] = 1.0 + Math.min(0.5, this.slabImplantedAtoms[bin] / slabCapacityCm2);
        }
      }
      if (crystalActive && totalStepsTaken > 0 && channeledSteps / totalStepsTaken > 0.25) {
        this.channeledIonCount += 1;
      }
      if (this.stoppedIons.length < TrimSimulator.MAX_STOPPED_MARKERS) {
        this.stoppedIons.push({
          ionNumber,
          z1,
          energyEv: 0,
          xA,
          yA,
          zA,
          cosX,
          cosY,
          cosZ,
        });
      } else {
        // Reservoir sampling keeps the displayed 3D marker cloud unbiased across 1,000,000 ions
        const replaceIdx = Math.floor(this.rng() * this.stoppedCount);
        if (replaceIdx < TrimSimulator.MAX_STOPPED_MARKERS) {
          this.stoppedIons[replaceIdx] = {
            ionNumber,
            z1,
            energyEv: 0,
            xA,
            yA,
            zA,
            cosX,
            cosY,
            cosZ,
          };
        }
      }
    } else if (fate === 'backscattered') {
      this.backscatteredCount += 1;
      if (this.backscatteredIons.length < TrimSimulator.MAX_ESCAPED_RECORDS) {
        this.backscatteredIons.push({
          ionNumber,
          z1,
          energyEv,
          xA: 0,
          yA,
          zA,
          cosX,
          cosY,
          cosZ,
        });
      }
    } else if (fate === 'transmitted') {
      this.transmittedCount += 1;
      if (this.transmittedIons.length < TrimSimulator.MAX_ESCAPED_RECORDS) {
        this.transmittedIons.push({
          ionNumber,
          z1,
          energyEv,
          xA: this.totalTargetDepthA,
          yA,
          zA,
          cosX,
          cosY,
          cosZ,
        });
      }
    }

    if (recordTrack) {
      const trajObj: TrimTrajectory = {
        ionNumber,
        eventName,
        z1,
        fate,
        points,
        recoils,
      };
      if (trackReplaceIdx < this.trajectories.length) {
        this.trajectories[trackReplaceIdx] = trajObj;
      } else {
        this.trajectories.push(trajObj);
      }
    }
  }

  /**
   * Simulates a full 3D recoil cascade in Mode 2 / Mode 3 / Mode 4 using an explicit stack.
   */
  private simulateRecoilCascade(
    ionNumber: number,
    initZ: number,
    initSymbol: string,
    initMass: number,
    initEnergyEv: number,
    initXA: number,
    initYA: number,
    initZA: number,
    initCosX: number,
    initCosY: number,
    initCosZ: number,
    initIsDisplaced: boolean,
    recoilTracksOut?: TrimRecoilTrack[],
    potential: ScreeningPotentialType = 'zbl'
  ): {
    displacements: number;
    vacancies: number;
    replacements: number;
    interstitials: number;
  } {
    const stack: {
      z: number;
      symbol: string;
      mass: number;
      energyEv: number;
      xA: number;
      yA: number;
      zA: number;
      cosX: number;
      cosY: number;
      cosZ: number;
      isDisplaced: boolean;
    }[] = [
      {
        z: initZ,
        symbol: initSymbol,
        mass: initMass,
        energyEv: initEnergyEv,
        xA: initXA,
        yA: initYA,
        zA: initZA,
        cosX: initCosX,
        cosY: initCosY,
        cosZ: initCosZ,
        isDisplaced: initIsDisplaced,
      },
    ];

    let displacements = 0;
    let vacancies = 0;
    let replacements = 0;
    let interstitials = 0;

    while (stack.length > 0) {
      const rec = stack.pop()!;
      const trackPoints: TrimPoint3D[] | undefined =
        recoilTracksOut && recoilTracksOut.length < 60
          ? [{ xA: rec.xA, yA: rec.yA, zA: rec.zA, energyEv: rec.energyEv }]
          : undefined;

      let steps = 0;
      while (steps < 800) {
        steps++;
        const pl = this.getLayerAtDepth(rec.xA);
        const recElemIdx = this.elemIndexByZ.get(rec.z) ?? 0;
        const recElemInfo = this.uniqueElements[recElemIdx];
        const esEv = recElemInfo ? recElemInfo.esEv : pl.minEsEv;
        const stopThresholdEv = Math.max(2.0, esEv);

        if (rec.energyEv <= stopThresholdEv) {
          this.totalPhononRecoilEv += rec.energyEv;
          const bin = this.depthToBin(rec.xA);
          if (bin >= 0) {
            this.histPhononRecoil[bin] += rec.energyEv;
            this.histRecoilRangeByElem[recElemIdx][bin] += 1;
            if (rec.isDisplaced) {
              this.histInterstitials[bin] += 1;
            }
          }
          if (rec.isDisplaced) {
            this.totalInterstitials += 1;
            interstitials += 1;
          }
          if (trackPoints) {
            trackPoints.push({
              xA: rec.xA,
              yA: rec.yA,
              zA: rec.zA,
              energyEv: 0,
            });
          }
          break;
        }

        const jumpA = pl.monolayerJumpA;
        const nextXA = rec.xA + jumpA * rec.cosX;
        const nextYA = rec.yA + jumpA * rec.cosY;
        const nextZA = rec.zA + jumpA * rec.cosZ;

        // Electronic stopping of recoil over jumpA using Bragg's rule sum
        let seEvPerA = 0.0;
        const totalStoich = pl.totalStoich;
        for (const el of pl.layer.elements) {
          const frac = Math.max(0, el.stoich) / totalStoich;
          if (frac <= 0) continue;
          const seUnit7 = calcElectronicStoppingElement(
            rec.z,
            rec.mass,
            el.z,
            rec.energyEv / 1000.0,
            pl.layer.phase,
            pl.layer.compoundCorr
          );
          seEvPerA += frac * seUnit7 * 10.0 * pl.atomDensityPerA3;
        }
        const deElecEv = Math.min(rec.energyEv * 0.5, Math.max(0, seEvPerA * jumpA));
        rec.energyEv -= deElecEv;
        this.totalIonizRecoilEv += deElecEv;
        const binMid = this.depthToBin(0.5 * (rec.xA + Math.max(0, nextXA)));
        if (binMid >= 0) {
          this.histIonizRecoil[binMid] += deElecEv;
        }

        // Check if recoil reaches the surface (x <= 0 -> candidate for Sputtering!)
        if (nextXA <= 0.0) {
          const normalEnergyEv = rec.energyEv * rec.cosX * rec.cosX;
          const arrRow = this.surfaceArrivalCounts[recElemIdx];
          if (arrRow) {
            for (let g = 0; g < SPUTTER_ES_GRID.length; g++) {
              if (normalEnergyEv > SPUTTER_ES_GRID[g]) {
                arrRow[g] += 1;
              }
            }
          }

          if (normalEnergyEv > esEv) {
            // Sputtered atom escapes planar surface barrier Es!
            if (rec.isDisplaced) {
              this.escapedRecoilsCount += 1;
            }
            const escapedEnergyEv = Math.max(0.01, rec.energyEv - esEv);
            this.totalSputteredCount += 1;
            if (this.config.advancedPhysics?.dynamicComposition) {
              const l0 = this.preparedLayers[0];
              const fluenceStep = Math.max(0, this.config.advancedPhysics.doseCm2 || 0) / Math.max(1, this.config.totalIons);
              const densCm2PerA = Math.max(1e10, (l0?.atomDensityPerA3 ?? 0.05) * 1e16);
              this.erodedDepthA += fluenceStep / densCm2PerA;
              if (this.slabDensityScale.length > 0) {
                this.slabDensityScale[0] = Math.max(0.4, 1.0 - Math.min(0.6, this.erodedDepthA / Math.max(1, this.binWidthA)));
              }
            }
            this.sputteredCountByElem[recElemIdx] =
              (this.sputteredCountByElem[recElemIdx] ?? 0) + 1;
            this.sputteredEnergySumByElem[recElemIdx] =
              (this.sputteredEnergySumByElem[recElemIdx] ?? 0) + escapedEnergyEv;
            const refractCosX = -Math.sqrt(
              Math.max(
                0.0,
                (normalEnergyEv - esEv) / Math.max(0.01, escapedEnergyEv)
              )
            );
            const sinScale = Math.sqrt(
              Math.max(
                0.0,
                (1.0 - refractCosX * refractCosX) /
                  Math.max(1e-9, 1.0 - rec.cosX * rec.cosX)
              )
            );
            if (this.sputteredAtoms.length < TrimSimulator.MAX_SPUTTERED_RECORDS) {
              this.sputteredAtoms.push({
                ionNumber,
                z2: rec.z,
                symbol: rec.symbol,
                energyEv: escapedEnergyEv,
                surfaceArrivalEnergyEv: rec.energyEv,
                xA: 0.0,
                yA: nextYA,
                zA: nextZA,
                cosX: refractCosX,
                cosY: rec.cosY * sinScale,
                cosZ: rec.cosZ * sinScale,
              });
            }
            if (trackPoints) {
              trackPoints.push({
                xA: 0,
                yA: nextYA,
                zA: nextZA,
                energyEv: escapedEnergyEv,
              });
            }
          } else {
            // Reflected back by surface barrier -> energy goes to surface phonons
            this.totalPhononRecoilEv += rec.energyEv;
            if (this.histPhononRecoil.length > 0) {
              this.histPhononRecoil[0] += rec.energyEv;
            }
            if (rec.isDisplaced) {
              this.totalInterstitials += 1;
              interstitials += 1;
              if (this.histInterstitials.length > 0) {
                this.histInterstitials[0] += 1;
              }
            }
          }
          break;
        }

        if (nextXA >= this.totalTargetDepthA) {
          // Recoil transmitted out of back surface
          if (rec.isDisplaced) {
            this.escapedRecoilsCount += 1;
          }
          if (trackPoints) {
            trackPoints.push({
              xA: this.totalTargetDepthA,
              yA: nextYA,
              zA: nextZA,
              energyEv: rec.energyEv,
            });
          }
          break;
        }

        rec.xA = nextXA;
        rec.yA = nextYA;
        rec.zA = nextZA;

        // Binary collision of moving recoil with a target atom
        const targetEl = this.selectTargetElement(pl);
        const targetElemIdx = this.elemIndexByZ.get(targetEl.z) ?? 0;
        const impactParamA = pl.pMaxMonoA * Math.sqrt(this.rng());

        const scat = calcMagicScattering(
          rec.z,
          rec.mass,
          targetEl.z,
          targetEl.massAmu,
          rec.energyEv,
          impactParamA,
          potential
        );

        const tEv = Math.min(rec.energyEv, scat.recoilEnergyEv);
        rec.energyEv -= tEv;

        const phi = 2.0 * Math.PI * this.rng();
        const [secCosX, secCosY, secCosZ] = rotateDirection3D(
          rec.cosX,
          rec.cosY,
          rec.cosZ,
          scat.cosPsiRecoil,
          scat.sinPsiRecoil,
          phi + Math.PI
        );
        [rec.cosX, rec.cosY, rec.cosZ] = rotateDirection3D(
          rec.cosX,
          rec.cosY,
          rec.cosZ,
          scat.cosPsiIon,
          scat.sinPsiIon,
          phi
        );

        const binCol = this.depthToBin(rec.xA);
        const subThresholdEv =
          rec.xA < 30.0
            ? Math.min(targetEl.displacementEv, targetEl.surfaceBindingEv)
            : targetEl.displacementEv;

        if (tEv >= subThresholdEv && stack.length < 150) {
          const isDisp = tEv >= targetEl.displacementEv;
          const eb = isDisp ? targetEl.latticeBindingEv : 0.0;
          if (isDisp) {
            displacements += 1;
            this.totalDisplacements += 1;
            if (rec.energyEv < targetEl.displacementEv && rec.z === targetEl.z) {
              // Replacement collision! Moving recoil replaces struck atom
              replacements += 1;
              this.totalReplacements += 1;
              this.totalPhononRecoilEv += rec.energyEv;
              if (binCol >= 0) {
                this.histReplacements[binCol] += 1;
                this.histPhononRecoil[binCol] += rec.energyEv;
              }
              rec.energyEv = 0;
              rec.isDisplaced = false; // Stopped in lattice site, NOT an interstitial
            } else {
              vacancies += 1;
              this.totalVacancies += 1;
              this.totalBindingRecoilEv += eb;
              if (binCol >= 0) {
                this.histVacRecoil[binCol] += 1;
                this.histVacByElem[targetElemIdx][binCol] += 1;
              }
            }
          }

          stack.push({
            z: targetEl.z,
            symbol: targetEl.symbol,
            mass: targetEl.massAmu,
            energyEv: Math.max(0, tEv - eb),
            xA: rec.xA,
            yA: rec.yA,
            zA: rec.zA,
            cosX: secCosX,
            cosY: secCosY,
            cosZ: secCosZ,
            isDisplaced: isDisp,
          });

          if (rec.energyEv === 0 && !rec.isDisplaced) {
            break; // Stop following rec since it replaced targetEl
          }
        } else {
          this.totalPhononRecoilEv += tEv;
          if (binCol >= 0) {
            this.histPhononRecoil[binCol] += tEv;
          }
        }

        if (trackPoints) {
          trackPoints.push({
            xA: rec.xA,
            yA: rec.yA,
            zA: rec.zA,
            energyEv: rec.energyEv,
          });
        }
      }

      // If step limit reached, credit residual recoil energy to phonons and track interstitial if displaced
      if (steps >= 800 && rec.energyEv > 0) {
        this.totalPhononRecoilEv += rec.energyEv;
        const bin = this.depthToBin(rec.xA);
        if (bin >= 0) {
          this.histPhononRecoil[bin] += rec.energyEv;
          if (rec.isDisplaced) {
            this.histInterstitials[bin] += 1;
          }
        }
        if (rec.isDisplaced) {
          this.totalInterstitials += 1;
          interstitials += 1;
        }
        rec.energyEv = 0;
      }

      if (trackPoints && trackPoints.length > 1 && recoilTracksOut) {
        recoilTracksOut.push({
          z2: rec.z,
          symbol: rec.symbol,
          points: trackPoints,
        });
      }
    }

    return { displacements, vacancies, replacements, interstitials };
  }

  /**
   * Returns a normalized snapshot of the current simulation state.
   */
  public getSnapshot(): TrimSnapshot {
    const nIons = Math.max(1, this.completedIons);
    const normFactor = 1.0 / (nIons * this.binWidthA);
    // (atoms/cm3) / (atoms/cm2) = 1/cm = 1e8 / A -> counts / (N_ions * binWidth_A * 1e-8)
    const rangeNormCmInv = 1e8 / (nIons * this.binWidthA);

    const totalEnergyLossEv =
      this.totalIonizIonEv +
      this.totalIonizRecoilEv +
      this.totalPhononIonEv +
      this.totalPhononRecoilEv +
      this.totalBindingIonEv +
      this.totalBindingRecoilEv;
    const safeTotalEv = totalEnergyLossEv > 0 ? totalEnergyLossEv : 1.0;

    const energyIonizByIonPct = (this.totalIonizIonEv * 100.0) / safeTotalEv;
    const energyIonizByRecoilPct = (this.totalIonizRecoilEv * 100.0) / safeTotalEv;
    const energyPhononByIonPct = (this.totalPhononIonEv * 100.0) / safeTotalEv;
    const energyPhononByRecoilPct = (this.totalPhononRecoilEv * 100.0) / safeTotalEv;
    const energyBindingByIonPct = (this.totalBindingIonEv * 100.0) / safeTotalEv;
    const energyBindingByRecoilPct = (this.totalBindingRecoilEv * 100.0) / safeTotalEv;

    // Sputtering yield by element & SBE curve (exact counters up to 1M+ ions)
    const sputterByElem = this.uniqueElements.map((el, elemIdx) => {
      const cnt = this.sputteredCountByElem[elemIdx] ?? 0;
      const eSum = this.sputteredEnergySumByElem[elemIdx] ?? 0;
      return {
        z: el.z,
        symbol: el.symbol,
        name: el.name,
        yieldPerIon: cnt / nIons,
        meanEnergyEv: cnt > 0 ? eSum / cnt : 0,
      };
    });

    const sputterYieldVsEs = SPUTTER_ES_GRID.map((esEv, gIdx) => {
      const byElement = this.uniqueElements.map((_, elemIdx) => {
        const cnt = this.surfaceArrivalCounts[elemIdx]?.[gIdx] ?? 0;
        return cnt / nIons;
      });
      const totalYield = byElement.reduce((a, b) => a + b, 0);
      return { esEv, totalYield, byElement };
    });

    const absLatM = this.rmAbsLatY.getMoments();
    const latM = this.rmLatY.getMoments();

    return {
      completedIons: this.completedIons,
      totalIons: this.config.totalIons,
      stoppedCount: this.stoppedCount,
      backscatteredCount: this.backscatteredCount,
      transmittedCount: this.transmittedCount,
      stoppedPct: (this.stoppedCount * 100.0) / nIons,
      backscatteredPct: (this.backscatteredCount * 100.0) / nIons,
      transmittedPct: (this.transmittedCount * 100.0) / nIons,
      totalVacancies: this.totalVacancies,
      totalDisplacements: this.totalDisplacements,
      totalReplacements: this.totalReplacements,
      totalInterstitials: this.totalInterstitials,
      totalEscapedRecoils: this.escapedRecoilsCount,
      vacanciesPerIon: this.totalVacancies / nIons,
      displacementsPerIon: this.totalDisplacements / nIons,
      replacementsPerIon: this.totalReplacements / nIons,
      interstitialsPerIon: this.totalInterstitials / nIons,
      sputteringYield: this.totalSputteredCount / nIons,
      sputteringYieldByElement: sputterByElem,
      sputterYieldVsEs,
      energyLossIonizationPct: energyIonizByIonPct + energyIonizByRecoilPct,
      energyLossPhononsPct: energyPhononByIonPct + energyPhononByRecoilPct,
      energyLossBindingPct: energyBindingByIonPct + energyBindingByRecoilPct,
      energyIonizByIonPct,
      energyIonizByRecoilPct,
      energyPhononByIonPct,
      energyPhononByRecoilPct,
      energyBindingByIonPct,
      energyBindingByRecoilPct,
      rangeMoments: this.rmDepth.getMoments(),
      lateralMoments: {
        meanA: absLatM.meanA,
        stragglingA: latM.stragglingA,
        skewness: latM.skewness,
        kurtosis: latM.kurtosis,
      },
      radialMoments: this.rmRadial.getMoments(),
      binWidthA: this.binWidthA,
      binDepthsA: this.binDepthsA,
      histograms: {
        ionRange: this.histIonRange.map((v) => v * rangeNormCmInv),
        recoilRangeByElement: this.histRecoilRangeByElem.map((arr) =>
          arr.map((v) => v * rangeNormCmInv)
        ),
        lateralY: this.histLatY.map((v, i) =>
          this.histIonRange[i] > 0 ? v / this.histIonRange[i] : 0
        ),
        lateralZ: this.histLatZ.map((v, i) =>
          this.histIonRange[i] > 0 ? v / this.histIonRange[i] : 0
        ),
        radialR: this.histRadialR.map((v, i) =>
          this.histIonRange[i] > 0 ? v / this.histIonRange[i] : 0
        ),
        ionizationIon: this.histIonizIon.map((v) => v * normFactor),
        ionizationRecoil: this.histIonizRecoil.map((v) => v * normFactor),
        phononsIon: this.histPhononIon.map((v) => v * normFactor),
        phononsRecoil: this.histPhononRecoil.map((v) => v * normFactor),
        energyToRecoils: this.histE2Recoil.map((v) => v * normFactor),
        vacanciesIon: this.histVacIon.map((v) => v * normFactor),
        vacanciesRecoil: this.histVacRecoil.map((v) => v * normFactor),
        vacanciesByElement: this.histVacByElem.map((arr) =>
          arr.map((v) => v * normFactor)
        ),
        replacements: this.histReplacements.map((v) => v * normFactor),
        interstitials: this.histInterstitials.map((v) => v * normFactor),
      },
      trajectories: this.trajectories,
      backscatteredIons: this.backscatteredIons,
      transmittedIons: this.transmittedIons,
      stoppedIons: this.stoppedIons,
      sputteredAtoms: this.sputteredAtoms,
      collisions: this.collisions,
      advancedDiagnostics: this.config.advancedPhysics
        ? {
            amorphousFractionProfile: Array.from(this.amorphousDpaByBin, (dpa) => {
              const crit = Math.max(1e-4, this.config.advancedPhysics?.criticalDpa || 0.1);
              return 1.0 - Math.exp(-dpa / crit);
            }),
            erodedDepthA: this.erodedDepthA,
            retainedDoseFraction: this.stoppedCount / nIons,
            arcDpaVacanciesPerIon: this.totalVacancies / nIons,
            channeledFractionPct: (this.channeledIonCount * 100.0) / nIons,
            crystalAxisAlignedCos: this.crystalRotMat ? this.crystalRotMat[0] : undefined,
          }
        : undefined,
    };
  }
}
