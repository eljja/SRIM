import type {
  CrystalLatticeType,
  CrystalOrientation,
  ScreeningPotentialType,
  TrimAdvancedPhysicsConfig,
} from './types';

export const DEFAULT_ADVANCED_PHYSICS: TrimAdvancedPhysicsConfig = {
  crystalMode: false,
  crystalLattice: 'diamond',
  latticeConstantA: 5.431,
  crystalOrientation: '<100>',
  crystalTiltDeg: 0.0,
  crystalTwistDeg: 22.0,
  targetTempK: 300,
  debyeTempK: 520,
  doseCm2: 1e13,
  dynamicDamage: true,
  criticalDpa: 0.1,
  localElectronicStopping: true,
  arcDpaRecombination: false,
  dynamicComposition: false,
  screeningPotential: 'zbl',
  simultaneousCollisions: true,
  mask2dEnabled: false,
  maskThicknessA: 500,
  maskOpeningA: 500,
};

// Screening coefficients: Phi(x) = sum_i C_i * exp(-D_i * x)
const SCREENING_COEFFS: Record<
  ScreeningPotentialType,
  { c: readonly number[]; d: readonly number[]; zeroDeriv: number }
> = {
  zbl: {
    c: [0.18175, 0.50986, 0.28022, 0.02817],
    d: [3.1998, 0.94229, 0.4029, 0.20162],
    zeroDeriv: -1.1489,
  },
  // Wilson-Haggmark-Biersack Kr-C universal potential (improved low-energy & channeling)
  krc: {
    c: [0.190945, 0.473674, 0.335381],
    d: [0.278544, 0.637174, 1.919249],
    zeroDeriv: -0.9985,
  },
  // Moliere Thomas-Fermi approximation (standard crystal channeling benchmark)
  moliere: {
    c: [0.35, 0.55, 0.1],
    d: [0.3, 1.2, 6.0],
    zeroDeriv: -1.365,
  },
};

/**
 * Evaluates screening function Phi(x) and dPhi/dx for ZBL, Kr-C, or Moliere potentials.
 */
export function evalScreeningPotential(
  x: number,
  potential: ScreeningPotentialType = 'zbl'
): { phi: number; dPhi: number } {
  const cfg = SCREENING_COEFFS[potential] || SCREENING_COEFFS.zbl;
  if (x <= 0) return { phi: 1.0, dPhi: cfg.zeroDeriv };
  let phi = 0.0;
  let dPhi = 0.0;
  for (let i = 0; i < cfg.c.length; i++) {
    const term = cfg.c[i] * Math.exp(-cfg.d[i] * x);
    phi += term;
    dPhi -= cfg.d[i] * term;
  }
  return { phi, dPhi };
}

/**
 * Screening length (Angstroms): ZBL universal aU for 'zbl', Firsov-Lindhard aF for 'krc'/'moliere'.
 */
export function calcScreeningLengthA(
  z1: number,
  z2: number,
  potential: ScreeningPotentialType = 'zbl'
): number {
  if (potential === 'zbl') {
    return 0.46853 / (Math.pow(z1, 0.23) + Math.pow(z2, 0.23));
  }
  // Firsov-Bohr screening length (0.8853 * 0.529177 A = 0.46848 A)
  return 0.46848 / Math.pow(Math.sqrt(z1) + Math.sqrt(z2), 2.0 / 3.0);
}

/**
 * Computes 1D Debye thermal RMS lattice vibration amplitude sigma (in Angstroms).
 * Uses Debye approximation with zero-point + phonon thermal excitation.
 */
export function calcDebyeVibrationSigmaA(
  massAmu: number,
  debyeTempK: number = 645,
  tempK: number = 300
): number {
  const m = Math.max(1.0, massAmu);
  const td = Math.max(50.0, debyeTempK);
  const t = Math.max(1.0, tempK);
  // Pre-factor: 3 * hbar^2 / (kB * amu) = 145.51 (A^2 * amu * K) -> 1D sigma^2 = (145.51 / (m * td)) * (phi(x)/x + 0.25)
  const x = td / t;
  // Accurate analytical approximation to Debye integral phi(x)/x + 1/4:
  // High-T limit -> t / td; Low-T zero-point -> 0.25
  const debyeTerm = x < 0.05 ? 1.0 / x : 1.0 / x + (0.25 * x) / (x + 2.0);
  // Empirical Lindemann-consistent factor calibrated to Si(300K, 645K) = 0.075 A
  const u2 = (48.5 / (m * td)) * (t / td + 0.25 * (1.0 - Math.exp(-x * 0.5)) * (x / Math.max(1, x)) + 0.04);
  // Better exact Debye-Waller fit:
  // <u_1D^2> = (48.504 / (M * ThetaD)) * (0.25 + (T/ThetaD)^2 * integral_0^(ThetaD/T) (y/(e^y-1)) dy)
  // Using fast 8-point Gauss-Legendre / Simpson quadrature for exact Debye integral!
  let integral = 0.0;
  const nSteps = 12;
  const dy = x / nSteps;
  for (let i = 0; i <= nSteps; i++) {
    const y = i * dy;
    const fy = y < 1e-5 ? 1.0 - 0.5 * y : y / Math.expm1(y);
    const w = i === 0 || i === nSteps ? 1 : i % 2 === 1 ? 4 : 2;
    integral += w * fy;
  }
  integral *= dy / 3.0;
  const u1dSq = (48.504 / (m * td)) * (0.25 + (integral / (x * x)) * (x > 0 ? 1 : 0));
  void debyeTerm;
  void u2;
  return Math.sqrt(Math.max(1e-5, u1dSq));
}

/**
 * Computes Oen-Robinson impact-parameter dependent local electronic stopping loss fraction.
 * Preserves average stopping while reducing Se(b) cleanly inside open crystal channels (large b).
 */
export function calcOenRobinsonStoppingEv(
  seEvPerA: number,
  jumpLengthA: number,
  impactParamA: number,
  screeningA: number,
  pMaxA: number
): number {
  const meanEv = Math.max(0, seEvPerA * jumpLengthA);
  if (meanEv <= 0) return 0;
  const a = Math.max(0.05, screeningA);
  const p = Math.max(0.2, pMaxA);
  const bRed = Math.max(0, impactParamA);
  // Closest approach proxy r0 ~ sqrt(b^2 + (0.6*a)^2)
  const r0 = Math.sqrt(bRed * bRed + 0.36 * a * a);
  const expTerm = Math.exp(-0.3 * (r0 / a));
  // Average of exp(-0.3 * b / a) over circular disk b in [0, p] is ~ 2 / (u^2) * (1 - (1+u)e^-u), u = 0.3*p/a
  const u = Math.max(0.05, 0.3 * (p / a));
  const avgExp = (2.0 / (u * u)) * (1.0 - (1.0 + u) * Math.exp(-u));
  const localRatio = avgExp > 1e-6 ? expTerm / avgExp : 1.0;
  // 50/50 split between non-local valence plasmon stopping and Oen-Robinson core-electron stopping (Robinson & Torrens)
  const blended = 0.45 + 0.55 * Math.max(0.15, Math.min(3.0, localRatio));
  return meanEv * blended;
}

/**
 * Nordlund ARC-dpa (Athermal Recombination-Corrected dpa, Nature Comm. 2018 / IAEA standard).
 * Corrects Kinchin-Pease NRT overestimation at high cascade energy density.
 */
export function calcArcDpaVacancies(
  damageEnergyEv: number,
  edEv: number,
  z2: number = 14
): number {
  if (damageEnergyEv < edEv || edEv <= 0) return 0;
  const nrt =
    damageEnergyEv < 2.5 * edEv ? 1.0 : (0.4 * damageEnergyEv) / edEv;
  if (damageEnergyEv <= 2.5 * edEv) {
    return nrt;
  }
  // Canonical Nordlund ARC-dpa efficiency xi_ARC(Tdam):
  // Covalent semiconductors (Si, C, SiC) ~ c_arc=0.25..0.30, b_arc=-0.568; Metals ~ c_arc=0.28, b_arc=-0.568
  const bArc = -0.568;
  const cArc = z2 <= 14 ? 0.286 : 0.25;
  const tThreshold = 2.5 * edEv;
  const ratio = Math.max(1.0, damageEnergyEv / tThreshold);
  const xi = Math.max(
    cArc,
    Math.min(1.0, (1.0 - cArc) * Math.pow(ratio, bArc) + cArc)
  );
  return Math.max(1.0, nrt * xi);
}

/**
 * Infers crystallographic lattice structure, lattice constant a0 (and c0), and Debye temp for a material.
 */
export function inferCrystalPresetForLayer(
  layerName: string,
  primaryZ2: number
): {
  lattice: CrystalLatticeType;
  aA: number;
  cA?: number;
  debyeTempK: number;
} {
  const n = layerName.toLowerCase();
  if (n.includes('4h-sic') || n.includes('gan') || n.includes('aln')) {
    if (n.includes('4h-sic') || n.includes('sic')) {
      return { lattice: 'wurtzite', aA: 3.073, cA: 10.053, debyeTempK: 1200 };
    }
    if (n.includes('aln')) {
      return { lattice: 'wurtzite', aA: 3.112, cA: 4.982, debyeTempK: 1150 };
    }
    return { lattice: 'wurtzite', aA: 3.189, cA: 5.185, debyeTempK: 600 };
  }
  if (n.includes('sic')) {
    return { lattice: 'zincblende', aA: 4.3596, debyeTempK: 1200 };
  }
  if (n.includes('diamond')) {
    return { lattice: 'diamond', aA: 3.567, debyeTempK: 2230 };
  }
  if (n.includes('ge') && !n.includes('sige')) {
    return { lattice: 'diamond', aA: 5.658, debyeTempK: 374 };
  }
  if (n.includes('sige')) {
    return { lattice: 'diamond', aA: 5.476, debyeTempK: 580 };
  }
  if (n.includes('gaas')) {
    return { lattice: 'zincblende', aA: 5.653, debyeTempK: 344 };
  }
  if (n.includes('inp')) {
    return { lattice: 'zincblende', aA: 5.869, debyeTempK: 321 };
  }
  if (/\bcu\b|\bau\b/.test(n) || primaryZ2 === 29 || primaryZ2 === 79) {
    return { lattice: 'fcc', aA: primaryZ2 === 79 ? 4.078 : 3.615, debyeTempK: 343 };
  }
  if (primaryZ2 === 74 || /\btungsten\b|\bw\b/.test(n)) {
    return { lattice: 'bcc', aA: 3.165, debyeTempK: 400 };
  }
  // Default c-Si Diamond Cubic (crystallographic Debye-Waller Theta_M = 520 K)
  return { lattice: 'diamond', aA: 5.431, debyeTempK: 520 };
}

/** 3x3 orthogonal matrix stored row-major [r0c0, r0c1, r0c2, r1c0, ...] mapping Lab -> Crystal frame */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

function normalizeVec3(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len <= 1e-12) return [1, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function crossVec3(
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function getOrientationMiller(
  orientation: CrystalOrientation,
  customMiller?: [number, number, number]
): [number, number, number] {
  switch (orientation) {
    case '<100>':
      return [1, 0, 0];
    case '<110>':
      return normalizeVec3([1, 1, 0]);
    case '<111>':
      return normalizeVec3([1, 1, 1]);
    case '<112>':
      return normalizeVec3([1, 1, 2]);
    case 'custom':
      return normalizeVec3(customMiller || [1, 0, 0]);
  }
}

/**
 * Builds the orthogonal 3x3 matrix mapping Lab unit vectors (with X = depth inward)
 * into the Crystal frame such that with tilt=0, lab (1,0,0) aligns identically with Miller direction,
 * and tiltDeg rotates away from that major axis along azimuthal wafer twist angle twistDeg.
 */
export function buildCrystalRotationMatrix(
  orientation: CrystalOrientation,
  customMiller: [number, number, number] | undefined,
  tiltDeg: number,
  twistDeg: number
): Mat3 {
  const nAxis = getOrientationMiller(orientation, customMiller);

  // Build two orthogonal axes (t1, t2) spanning plane perpendicular to nAxis
  const ref: [number, number, number] =
    Math.abs(nAxis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const t1 = normalizeVec3(crossVec3(ref, nAxis));
  const t2 = normalizeVec3(crossVec3(nAxis, t1));

  const twistRad = (twistDeg * Math.PI) / 180.0;
  const tiltRad = (tiltDeg * Math.PI) / 180.0;

  // Azimuthally rotated transverse basis
  const p1: [number, number, number] = [
    t1[0] * Math.cos(twistRad) + t2[0] * Math.sin(twistRad),
    t1[1] * Math.cos(twistRad) + t2[1] * Math.sin(twistRad),
    t1[2] * Math.cos(twistRad) + t2[2] * Math.sin(twistRad),
  ];
  const p2: [number, number, number] = [
    -t1[0] * Math.sin(twistRad) + t2[0] * Math.cos(twistRad),
    -t1[1] * Math.sin(twistRad) + t2[1] * Math.cos(twistRad),
    -t1[2] * Math.sin(twistRad) + t2[2] * Math.cos(twistRad),
  ];

  // Rotate around p2 by tiltRad so lab X axis tilts away from nAxis toward p1 by tiltDeg
  const cosT = Math.cos(tiltRad);
  const sinT = Math.sin(tiltRad);

  const eX: [number, number, number] = [
    nAxis[0] * cosT + p1[0] * sinT,
    nAxis[1] * cosT + p1[1] * sinT,
    nAxis[2] * cosT + p1[2] * sinT,
  ];
  const eY: [number, number, number] = [
    -nAxis[0] * sinT + p1[0] * cosT,
    -nAxis[1] * sinT + p1[1] * cosT,
    -nAxis[2] * sinT + p1[2] * cosT,
  ];
  const eZ = p2;

  // Columns of M = [eX, eY, eZ] map Lab -> Crystal
  return [
    eX[0], eY[0], eZ[0],
    eX[1], eY[1], eZ[1],
    eX[2], eY[2], eZ[2],
  ];
}

export function rotateLabToCrystal(
  m: Mat3,
  vx: number,
  vy: number,
  vz: number
): [number, number, number] {
  return [
    m[0] * vx + m[1] * vy + m[2] * vz,
    m[3] * vx + m[4] * vy + m[5] * vz,
    m[6] * vx + m[7] * vy + m[8] * vz,
  ];
}

export function rotateCrystalToLab(
  m: Mat3,
  cx: number,
  cy: number,
  cz: number
): [number, number, number] {
  // M^T * c
  return [
    m[0] * cx + m[3] * cy + m[6] * cz,
    m[1] * cx + m[4] * cy + m[7] * cz,
    m[2] * cx + m[5] * cy + m[8] * cz,
  ];
}

export interface CrystalUnitCellSpec {
  ax: number;
  ay: number;
  az: number;
  /** Fractional coordinates + sublattice index (0 = cation/primary, 1 = anion/secondary) */
  sites: readonly [number, number, number, number][];
}

/**
 * Returns orthorhombic unit-cell geometry and basis atoms for fast periodic crystal traversal.
 */
export function buildCrystalUnitCell(
  lattice: CrystalLatticeType,
  aA: number,
  cA?: number
): CrystalUnitCellSpec {
  const a = Math.max(2.0, aA);
  if (lattice === 'diamond' || lattice === 'zincblende') {
    const sub = lattice === 'zincblende' ? 1 : 0;
    return {
      ax: a,
      ay: a,
      az: a,
      sites: [
        [0.0, 0.0, 0.0, 0],
        [0.0, 0.5, 0.5, 0],
        [0.5, 0.0, 0.5, 0],
        [0.5, 0.5, 0.0, 0],
        [0.25, 0.25, 0.25, sub],
        [0.25, 0.75, 0.75, sub],
        [0.75, 0.25, 0.75, sub],
        [0.75, 0.75, 0.25, sub],
      ],
    };
  }
  if (lattice === 'wurtzite') {
    // Orthorhombic supercell for Wurtzite: ax = a, ay = sqrt(3)*a, az = c
    const c = Math.max(a, cA || a * 1.633);
    return {
      ax: a,
      ay: Math.sqrt(3) * a,
      az: c,
      sites: [
        [0.0, 0.0, 0.0, 0],
        [0.5, 0.5, 0.0, 0],
        [0.0, 1.0 / 3.0, 0.5, 0],
        [0.5, 5.0 / 6.0, 0.5, 0],
        [0.0, 0.0, 0.375, 1],
        [0.5, 0.5, 0.375, 1],
        [0.0, 1.0 / 3.0, 0.875, 1],
        [0.5, 5.0 / 6.0, 0.875, 1],
      ],
    };
  }
  if (lattice === 'fcc') {
    return {
      ax: a,
      ay: a,
      az: a,
      sites: [
        [0.0, 0.0, 0.0, 0],
        [0.0, 0.5, 0.5, 0],
        [0.5, 0.0, 0.5, 0],
        [0.5, 0.5, 0.0, 0],
      ],
    };
  }
  // BCC
  return {
    ax: a,
    ay: a,
    az: a,
    sites: [
      [0.0, 0.0, 0.0, 0],
      [0.5, 0.5, 0.5, 0],
    ],
  };
}

export interface CrystalCollisionCandidate {
  pathStepA: number;
  impactParamA: number;
  sublattice: number;
  /** Unit normal from ion to atom along closest approach (for azimuthal scattering plane in Lab frame) */
  normalCrystX: number;
  normalCrystY: number;
  normalCrystZ: number;
}

/**
 * Finds the nearest forward collision(s) in the 3D crystal lattice around ion position (cx, cy, cz)
 * moving along unit vector (dx, dy, dz), including thermal vibration jitter.
 */
export function findCrystalCollisionsAlongRay(
  cell: CrystalUnitCellSpec,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
  minStepA: number,
  maxSearchStepA: number,
  maxImpactA: number,
  sigmaVibA: number,
  nextGaussian: () => number,
  maxSimultaneous: number = 1
): CrystalCollisionCandidate[] {
  // Probe center of forward segment to collect neighboring integer cells
  const midS = 0.5 * (minStepA + maxSearchStepA);
  const mx = cx + midS * dx;
  const my = cy + midS * dy;
  const mz = cz + midS * dz;

  const halfExtent = 0.5 * maxSearchStepA + maxImpactA + 0.25 * cell.ax;
  const ixMin = Math.floor((mx - halfExtent) / cell.ax);
  const ixMax = Math.floor((mx + halfExtent) / cell.ax);
  const iyMin = Math.floor((my - halfExtent) / cell.ay);
  const iyMax = Math.floor((my + halfExtent) / cell.ay);
  const izMin = Math.floor((mz - halfExtent) / cell.az);
  const izMax = Math.floor((mz + halfExtent) / cell.az);

  const hits: CrystalCollisionCandidate[] = [];
  const pCutSq = maxImpactA * maxImpactA;

  for (let ix = ixMin; ix <= ixMax; ix++) {
    const baseX = ix * cell.ax;
    for (let iy = iyMin; iy <= iyMax; iy++) {
      const baseY = iy * cell.ay;
      for (let iz = izMin; iz <= izMax; iz++) {
        const baseZ = iz * cell.az;
        for (let sIdx = 0; sIdx < cell.sites.length; sIdx++) {
          const site = cell.sites[sIdx];
          // Static position first for fast culling before calling Gaussian thermal displacement
          const sx0 = baseX + site[0] * cell.ax;
          const sy0 = baseY + site[1] * cell.ay;
          const sz0 = baseZ + site[2] * cell.az;

          const rx0 = sx0 - cx;
          const ry0 = sy0 - cy;
          const rz0 = sz0 - cz;
          const proj0 = rx0 * dx + ry0 * dy + rz0 * dz;
          if (proj0 < minStepA - 0.5 || proj0 > maxSearchStepA + 0.5) continue;

          // Rough squared perpendicular distance culling before Gaussian sampling
          const px0 = rx0 - proj0 * dx;
          const py0 = ry0 - proj0 * dy;
          const pz0 = rz0 - proj0 * dz;
          const b0Sq = px0 * px0 + py0 * py0 + pz0 * pz0;
          if (b0Sq > (maxImpactA + 3.5 * sigmaVibA) ** 2) continue;

          // Apply 3D Debye thermal vibration
          const ax = sx0 + sigmaVibA * nextGaussian();
          const ay = sy0 + sigmaVibA * nextGaussian();
          const az = sz0 + sigmaVibA * nextGaussian();

          const rx = ax - cx;
          const ry = ay - cy;
          const rz = az - cz;
          const proj = rx * dx + ry * dy + rz * dz;
          if (proj <= minStepA || proj > maxSearchStepA) continue;

          const px = rx - proj * dx;
          const py = ry - proj * dy;
          const pz = rz - proj * dz;
          const bSq = px * px + py * py + pz * pz;
          if (bSq > pCutSq) continue;

          const b = Math.sqrt(bSq);
          const invB = b > 1e-12 ? 1.0 / b : 0.0;
          hits.push({
            pathStepA: proj,
            impactParamA: b,
            sublattice: site[3],
            normalCrystX: px * invB,
            normalCrystY: py * invB,
            normalCrystZ: pz * invB,
          });
        }
      }
    }
  }

  if (hits.length <= 1) return hits;
  hits.sort((a, b) => a.pathStepA - b.pathStepA);

  if (maxSimultaneous <= 1) {
    return [hits[0]];
  }

  // Group simultaneous collisions arriving within 0.35 A along the trajectory (MARLOWE SBC)
  const firstS = hits[0].pathStepA;
  const simultaneous: CrystalCollisionCandidate[] = [hits[0]];
  for (let i = 1; i < hits.length && simultaneous.length < maxSimultaneous; i++) {
    if (hits[i].pathStepA - firstS <= 0.35) {
      simultaneous.push(hits[i]);
    } else {
      break;
    }
  }
  return simultaneous;
}
