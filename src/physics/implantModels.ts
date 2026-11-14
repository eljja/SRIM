import { calcStoppingAndRangeTable } from './pral';
import { SEMICONDUCTOR_MATERIALS } from '../data/semiconductorMaterials';

const AVOGADRO = 6.02214076e23;
const Q_E = 1.602176634e-19;
const A0_ANGSTROM = 0.52917721;

export interface CompactTargetElement {
  z: number;
  name: string;
  stoich: number;
  mass: number;
}

export interface CompactRangeResult {
  model: 'LSS' | 'Empirical';
  reducedEnergy: number;
  projectedRangeA: number;
  stragglingA: number;
  lateralStragglingA: number;
  pathLengthA: number;
}

function computeEffectiveTarget(
  elements: CompactTargetElement[],
  densityGPerCm3: number
) {
  let sumStoich = 0;
  let sumZ = 0;
  let sumM = 0;
  for (const el of elements) {
    const s = Math.max(0, el.stoich);
    sumStoich += s;
    sumZ += s * el.z;
    sumM += s * el.mass;
  }
  const denom = Math.max(1e-9, sumStoich);
  const z2Mean = sumZ / denom;
  const m2Mean = sumM / denom;
  const atomDensityCm3 = (Math.max(1e-5, densityGPerCm3) * AVOGADRO) / Math.max(0.5, m2Mean);
  const atomDensityA3 = atomDensityCm3 * 1e-24;
  return { z2Mean, m2Mean, atomDensityCm3, atomDensityA3 };
}

/**
 * Lindhard-Scharff-Schiott (LSS) reduced analytical range & straggling model.
 * Computes dimensionless reduced energy epsilon, Thomas-Fermi nuclear stopping s_n(eps),
 * Lindhard-Scharff electronic stopping s_e(eps) = k_e * sqrt(eps), and integrates reduced
 * path length rho(eps) via quadrature before converting path length to projected range & straggle.
 */
export function calcLssCompactRange(
  z1: number,
  m1: number,
  energyKeV: number,
  elements: CompactTargetElement[],
  densityGPerCm3: number
): CompactRangeResult {
  const { z2Mean, m2Mean, atomDensityA3 } = computeEffectiveTarget(
    elements,
    densityGPerCm3
  );

  const zFactor = Math.pow(Math.pow(z1, 2 / 3) + Math.pow(z2Mean, 2 / 3), 0.5);
  const aTf = (0.8853 * A0_ANGSTROM) / zFactor;

  // Dimensionless LSS reduced energy epsilon
  const reducedEnergy =
    (32.53 * m2Mean * Math.max(0.001, energyKeV)) /
    (z1 * z2Mean * (m1 + m2Mean) * zFactor);

  // Length conversion factor: rho = R(A) * cRho
  const massFactor = (4 * m1 * m2Mean) / Math.pow(m1 + m2Mean, 2);
  const cRho = atomDensityA3 * Math.PI * aTf * aTf * massFactor;

  // Lindhard-Scharff electronic stopping constant k_e
  const ke =
    (0.0793 *
      Math.pow(z1, 2 / 3) *
      Math.pow(z2Mean, 0.5) *
      Math.pow(m1 + m2Mean, 1.5)) /
    (Math.pow(zFactor, 1.5) * Math.pow(m1, 1.5) * Math.pow(m2Mean, 0.5));

  // Integrate rho = \int_0^\varepsilon d\varepsilon' / (s_n(\varepsilon') + k_e \sqrt{\varepsilon'})
  // Using log-uniform grid transformation \varepsilon' = u^2 so d\varepsilon' / \sqrt{\varepsilon'} = 2 du
  const nSteps = 64;
  const uMax = Math.sqrt(reducedEnergy);
  const du = uMax / nSteps;
  let rho = 0;

  for (let i = 0; i < nSteps; i++) {
    const uMid = (i + 0.5) * du;
    const eps = uMid * uMid;
    // ZBL reduced nuclear stopping analytic approximation
    const sn =
      eps <= 30
        ? (0.5 * Math.log(1 + 1.1383 * eps)) /
          (eps + 0.01321 * Math.pow(eps, 0.21226) + 0.19593 * Math.sqrt(eps))
        : Math.log(eps) / (2 * eps);
    const se = ke * uMid;
    const totalStop = Math.max(1e-9, sn + se);
    rho += (2 * uMid * du) / totalStop;
  }

  const pathLengthA = rho / Math.max(1e-12, cRho);
  // Schiott path-to-projected conversion
  const projRatio = 1 / (1 + m2Mean / (3 * Math.max(0.5, m1)));
  const projectedRangeA = pathLengthA * projRatio;

  // LSS / Schiott longitudinal straggling ratio
  const massSym = Math.sqrt(m1 * m2Mean) / (m1 + m2Mean);
  const straggleRatio = Math.max(
    0.12,
    Math.min(0.7, (2 / 3) * massSym * Math.sqrt(1 + (0.15 * m2Mean) / Math.max(0.5, m1)))
  );
  const stragglingA = projectedRangeA * straggleRatio;
  const lateralStragglingA = stragglingA * (m1 < m2Mean ? 1.12 : 0.86);

  return {
    model: 'LSS',
    reducedEnergy,
    projectedRangeA,
    stragglingA,
    lateralStragglingA,
    pathLengthA,
  };
}

/**
 * Classic Semiconductor VLSI Empirical Power-Law Range Formula (Gibbons / Sze compact approximation).
 * Provides an analytical closed-form benchmark vs PRAL92 ODEs and Monte Carlo simulation.
 */
export function calcEmpiricalPowerLawRange(
  z1: number,
  m1: number,
  energyKeV: number,
  elements: CompactTargetElement[],
  densityGPerCm3: number
): CompactRangeResult {
  const { z2Mean, m2Mean } = computeEffectiveTarget(elements, densityGPerCm3);
  const eSafe = Math.max(0.01, energyKeV);

  const alpha = 0.88 - 0.14 * Math.min(1, z1 / 35);
  const denom = Math.pow(z1, 0.48) + 0.15 * Math.pow(z2Mean, 0.48);
  const targetScale = Math.pow(m2Mean, 0.25) / Math.max(0.01, densityGPerCm3);

  const projectedRangeA = (155 * Math.pow(eSafe, alpha) * targetScale) / denom;
  const massSym = Math.sqrt(m1 * m2Mean) / (m1 + m2Mean);
  const stragglingA = projectedRangeA * (0.45 * massSym + 0.12);
  const lateralStragglingA = stragglingA * 0.92;

  return {
    model: 'Empirical',
    reducedEnergy: 0,
    projectedRangeA,
    stragglingA,
    lateralStragglingA,
    pathLengthA: projectedRangeA * (1 + m2Mean / (3.2 * Math.max(0.5, m1))),
  };
}

/**
 * 1-2 Moment Symmetric Gaussian Dopant Profile (cm^-3).
 */
export function evaluateGaussianProfile(
  depthsA: number[],
  doseCm2: number,
  rpA: number,
  straggleA: number
): number[] {
  const sigmaCm = Math.max(1e-8, straggleA * 1e-8);
  const norm = doseCm2 / (Math.sqrt(2 * Math.PI) * sigmaCm);
  return depthsA.map((d) => {
    const z = (d - rpA) / Math.max(1e-4, straggleA);
    return norm * Math.exp(-0.5 * z * z);
  });
}

/**
 * 3-Moment Joined Half-Gaussian (Gibbons Asymmetric Compact Model, cm^-3).
 * Solves modal range Rm and asymmetric left/right widths (sigma1, sigma2) from (Rp, sigma, skewness).
 */
export function evaluateJoinedHalfGaussianProfile(
  depthsA: number[],
  doseCm2: number,
  rpA: number,
  straggleA: number,
  skewness: number
): number[] {
  const sigma = Math.max(1e-4, straggleA);
  // Joined Half-Gaussian skewness is bounded by ~ +/- 0.995
  const gamma = Math.max(-0.92, Math.min(0.92, skewness));
  const sqrt2OverPi = Math.sqrt(2 / Math.PI);

  // Numerical moments of Joined Half-Gaussian parameterized by asymmetry delta in (-0.9, 0.9)
  // Let sigma1 = s*(1 - delta), sigma2 = s*(1 + delta), where total variance matches sigma^2.
  const evalSkewFromDelta = (delta: number) => {
    const k1 = 1 - delta;
    const k2 = 1 + delta;
    const meanShift = sqrt2OverPi * (k2 - k1); // 2*sqrt(2/pi)*delta
    const e2 = 0.5 * (k1 * k1 + k2 * k2) - k1 * k2 * 0 + 0; // wait: exact second moment around mode:
    // For PDF f(x) = sqrt(2/pi)/(s1+s2) * exp(-(x-m)^2/(2*si^2)), weights w1 = s1/(s1+s2), w2 = s2/(s1+s2)
    const s1 = k1;
    const s2 = k2;
    const sum = s1 + s2;
    const m1 = (sqrt2OverPi * (s2 * s2 - s1 * s1)) / sum;
    const m2 = (s1 * s1 * s1 + s2 * s2 * s2) / sum;
    const variance = Math.max(1e-8, m2 - m1 * m1);
    const m3 =
      (2 * sqrt2OverPi * (Math.pow(s2, 4) - Math.pow(s1, 4))) / sum;
    const mu3 = m3 - 3 * m1 * m2 + 2 * Math.pow(m1, 3);
    return {
      skew: mu3 / Math.pow(variance, 1.5),
      variance,
      m1,
      s1,
      s2,
      sum,
    };
  };

  // Bisection on delta
  let lo = -0.88;
  let hi = 0.88;
  for (let it = 0; it < 32; it++) {
    const mid = 0.5 * (lo + hi);
    const { skew } = evalSkewFromDelta(mid);
    if (skew < gamma) lo = mid;
    else hi = mid;
  }
  const deltaBest = 0.5 * (lo + hi);
  const { variance, m1, s1, s2 } = evalSkewFromDelta(deltaBest);
  const scale = sigma / Math.sqrt(variance);

  const sigLeft = s1 * scale;
  const sigRight = s2 * scale;
  const rmA = rpA - m1 * scale;

  const normCm =
    (2 * doseCm2) / (Math.sqrt(2 * Math.PI) * (sigLeft + sigRight) * 1e-8);

  return depthsA.map((x) => {
    const dx = x - rmA;
    const sig = dx < 0 ? sigLeft : sigRight;
    const z = dx / Math.max(1e-4, sig);
    return normCm * Math.exp(-0.5 * z * z);
  });
}

/**
 * 4-Moment Pearson Type IV Distribution (Hofker / SUPREM / SRIM Analytical Benchmark).
 * Solves d(ln f)/du = -(u - a)/(b0 + b1*u + b2*u^2) using (Rp, straggling, skewness, kurtosis).
 */
export function evaluatePearsonIVProfile(
  depthsA: number[],
  doseCm2: number,
  rpA: number,
  straggleA: number,
  skewness: number,
  kurtosis: number
): number[] {
  const sigma = Math.max(1e-4, straggleA);
  const gamma = Math.max(-2.0, Math.min(2.0, skewness));
  const beta1 = gamma * gamma;
  // Ensure strict Pearson IV domain: 10*beta2 - 12*beta1 - 18 > 0 and b0 + b1*u + b2*u^2 strictly negative (no real roots)
  const minKurtosis = Math.max(2.6, 2.05 + 1.55 * beta1);
  const beta2 = Math.max(minKurtosis, Math.min(12.0, kurtosis));

  const denom = 10 * beta2 - 12 * beta1 - 18;
  const a = -(sigma * gamma * (beta2 + 3)) / denom;
  const b1 = a;
  const b0 = -(sigma * sigma * (4 * beta2 - 3 * beta1)) / denom;
  const b2 = -(2 * beta2 - 3 * beta1 - 6) / denom;

  // Evaluate on a fine symmetric-extended numerical grid to ensure exact normalization to doseCm2
  const span = Math.max(sigma * 10, Math.abs(depthsA[depthsA.length - 1] - rpA) + sigma * 4);
  const nGrid = 1001;
  const uMin = -span;
  const uMax = span;
  const du = (uMax - uMin) / (nGrid - 1);

  const lnVals = new Float64Array(nGrid);
  // Start at u = a (distribution mode) where ln(f) = 0 and integrate outward to both sides
  const modeIdx = Math.max(
    0,
    Math.min(nGrid - 1, Math.round((a - uMin) / du))
  );

  const dLnF = (u: number) => {
    const q = b0 + b1 * u + b2 * u * u;
    // In Pearson IV, b0 < 0 and b2 < 0 so q < 0 everywhere; (u - a)/q peaks at u = a and decays to both tails
    return (u - a) / (q >= -1e-12 ? -1e-12 : q);
  };

  lnVals[modeIdx] = 0;
  for (let i = modeIdx + 1; i < nGrid; i++) {
    const u0 = uMin + (i - 1) * du;
    const u1 = uMin + i * du;
    const uMid = 0.5 * (u0 + u1);
    lnVals[i] = lnVals[i - 1] + (du / 6) * (dLnF(u0) + 4 * dLnF(uMid) + dLnF(u1));
  }
  for (let i = modeIdx - 1; i >= 0; i--) {
    const u0 = uMin + (i + 1) * du;
    const u1 = uMin + i * du;
    const uMid = 0.5 * (u0 + u1);
    lnVals[i] = lnVals[i + 1] - (du / 6) * (dLnF(u0) + 4 * dLnF(uMid) + dLnF(u1));
  }

  let maxLn = -Infinity;
  for (let i = 0; i < nGrid; i++) {
    if (lnVals[i] > maxLn) maxLn = lnVals[i];
  }

  const fGrid = new Float64Array(nGrid);
  let integralA = 0;
  for (let i = 0; i < nGrid; i++) {
    const val = Math.exp(Math.max(-80, lnVals[i] - maxLn));
    fGrid[i] = val;
    const w = i === 0 || i === nGrid - 1 ? 0.5 : 1.0;
    integralA += w * val * du;
  }

  const scaleToCm3 = doseCm2 / Math.max(1e-30, integralA * 1e-8);

  return depthsA.map((depthA) => {
    const u = depthA - rpA;
    if (u <= uMin || u >= uMax) return 0;
    const idxFloat = (u - uMin) / du;
    const i0 = Math.max(0, Math.min(nGrid - 2, Math.floor(idxFloat)));
    const frac = idxFloat - i0;
    const fInterp = fGrid[i0] * (1 - frac) + fGrid[i0 + 1] * frac;
    return fInterp * scaleToCm3;
  });
}

/**
 * Caughey-Thomas / Arora Concentration- and Temperature-Dependent Silicon Carrier Mobility (cm^2 / V·s).
 */
export function calcCaugheyThomasMobility(
  dopantType: 'n' | 'p',
  totalDopingCm3: number,
  temperatureK: number = 300
): number {
  const tr = Math.max(0.5, temperatureK / 300);
  const nSafe = Math.max(1e12, totalDopingCm3);

  if (dopantType === 'n') {
    const muMin = 92 * Math.pow(tr, -0.57);
    const muMax = 1360 * Math.pow(tr, -2.33);
    const nRef = 1.3e17 * Math.pow(tr, 2.4);
    const alpha = 0.91 * Math.pow(tr, -0.146);
    return muMin + (muMax - muMin) / (1 + Math.pow(nSafe / nRef, alpha));
  } else {
    const muMin = 54.3 * Math.pow(tr, -0.57);
    const muMax = 461 * Math.pow(tr, -2.23);
    const nRef = 2.35e17 * Math.pow(tr, 2.4);
    const alpha = 0.88 * Math.pow(tr, -0.146);
    return muMin + (muMax - muMin) / (1 + Math.pow(nSafe / nRef, alpha));
  }
}

export interface JunctionPredictionInput {
  depthsA: number[];
  concentrationCm3: number[];
  dopantType: 'n' | 'p';
  backgroundDopingCm3: number;
  activationEfficiency: number; // 0..1
  solidSolubilityCm3: number;
  temperatureK?: number;
  annealDiffusionLengthNm?: number; // sqrt(2*D*t) in nm
}

export interface JunctionPredictionResult {
  junctionDepthNm: number;
  junctionDepthUm: number;
  sheetResistanceOhmPerSq: number;
  effectiveResistivityOhmCm: number;
  activeDoseCm2: number;
  activatedFractionPct: number;
  peakConcentrationCm3: number;
  peakDepthNm: number;
  surfaceConcentrationCm3: number;
  averageMobilityCm2Vs: number;
  effectiveProfileCm3: number[];
  activeProfileCm3: number[];
  mobilityProfileCm2Vs: number[];
  cumulativeSheetConductanceS: number[];
}

/**
 * Convolves a 1D depth profile with a reflecting-surface (Neumann) Gaussian diffusion kernel
 * representing thermal RTA broadening with diffusion length sigma = sqrt(2*D*t).
 */
function applyThermalBroadening(
  depthsA: number[],
  conc: number[],
  diffLengthNm: number
): number[] {
  const sigmaA = diffLengthNm * 10;
  if (sigmaA <= 1 || depthsA.length < 2) return [...conc];

  const dxA = depthsA[1] - depthsA[0];
  if (dxA <= 0) return [...conc];

  const halfWindow = Math.min(depthsA.length - 1, Math.ceil((4 * sigmaA) / dxA));
  const out = new Array(depthsA.length).fill(0);

  for (let i = 0; i < depthsA.length; i++) {
    let sum = 0;
    let wSum = 0;
    for (let k = -halfWindow; k <= halfWindow; k++) {
      const distA = k * dxA;
      const w = Math.exp(-0.5 * (distA / sigmaA) * (distA / sigmaA));
      // Reflecting boundary at surface x=0 (mirror negative index -> |idx|)
      let srcIdx = i + k;
      if (srcIdx < 0) srcIdx = -srcIdx;
      if (srcIdx >= conc.length) srcIdx = conc.length - 1;
      sum += conc[srcIdx] * w;
      wSum += w;
    }
    out[i] = wSum > 0 ? sum / wSum : 0;
  }
  return out;
}

/**
 * Solves metallurgical junction depth (xj) and 4-point-probe sheet resistance (Rs)
 * by integrating carrier density * concentration-dependent mobility up to xj.
 */
export function predictJunctionAndSheetResistance(
  input: JunctionPredictionInput
): JunctionPredictionResult {
  const {
    depthsA,
    concentrationCm3,
    dopantType,
    backgroundDopingCm3,
    activationEfficiency,
    solidSolubilityCm3,
    temperatureK = 300,
    annealDiffusionLengthNm = 0,
  } = input;

  const effConc = applyThermalBroadening(
    depthsA,
    concentrationCm3,
    Math.max(0, annealDiffusionLengthNm)
  );

  const n = depthsA.length;
  const activeProfileCm3 = new Array<number>(n);
  const mobilityProfileCm2Vs = new Array<number>(n);
  const cumulativeSheetConductanceS = new Array<number>(n).fill(0);

  let peakConc = 0;
  let peakDepthA = 0;
  let totalRawDose = 0;

  for (let i = 0; i < n; i++) {
    const rawC = Math.max(0, effConc[i]);
    if (rawC > peakConc) {
      peakConc = rawC;
      peakDepthA = depthsA[i];
    }
    const actC = Math.min(solidSolubilityCm3, rawC * Math.max(0, Math.min(1, activationEfficiency)));
    activeProfileCm3[i] = actC;
    mobilityProfileCm2Vs[i] = calcCaugheyThomasMobility(
      dopantType,
      Math.max(rawC, backgroundDopingCm3),
      temperatureK
    );

    const dxA =
      i === 0
        ? n > 1
          ? depthsA[1] - depthsA[0]
          : 10
        : depthsA[i] - depthsA[i - 1];
    totalRawDose += rawC * Math.max(0, dxA) * 1e-8;
  }

  // Locate metallurgical junction xj: deepest point beyond peak where active concentration crosses N_B
  const peakIdx = activeProfileCm3.indexOf(Math.max(...activeProfileCm3));
  let junctionDepthA = depthsA[n - 1] ?? 0;
  let foundCrossing = false;

  if (activeProfileCm3[peakIdx] <= backgroundDopingCm3) {
    junctionDepthA = 0;
  } else {
    for (let i = Math.max(1, peakIdx + 1); i < n; i++) {
      const cPrev = activeProfileCm3[i - 1];
      const cCurr = activeProfileCm3[i];
      if (cPrev >= backgroundDopingCm3 && cCurr < backgroundDopingCm3) {
        // Log-linear interpolation for exponential tails
        const logPrev = Math.log10(Math.max(1, cPrev));
        const logCurr = Math.log10(Math.max(1, cCurr));
        const logBg = Math.log10(Math.max(1, backgroundDopingCm3));
        const denom = Math.abs(logPrev - logCurr) > 1e-9 ? logPrev - logCurr : 1;
        const frac = Math.max(0, Math.min(1, (logPrev - logBg) / denom));
        junctionDepthA = depthsA[i - 1] + frac * (depthsA[i] - depthsA[i - 1]);
        foundCrossing = true;
        break;
      }
    }
    if (!foundCrossing && activeProfileCm3[n - 1] >= backgroundDopingCm3) {
      junctionDepthA = depthsA[n - 1];
    }
  }

  // Integrate sheet conductance G_s = q * \int_0^{x_j} N_act(x) * mu(N_tot(x)) dx
  let sheetConductanceS = 0;
  let activeDoseCm2 = 0;
  let weightedMobSum = 0;

  for (let i = 1; i < n; i++) {
    const x0 = depthsA[i - 1];
    const x1 = depthsA[i];
    if (x0 >= junctionDepthA) {
      cumulativeSheetConductanceS[i] = sheetConductanceS;
      continue;
    }

    const effX1 = Math.min(x1, junctionDepthA);
    const dxCm = Math.max(0, effX1 - x0) * 1e-8;
    const netAct0 = Math.max(0, activeProfileCm3[i - 1] - backgroundDopingCm3);
    const netAct1 = Math.max(0, activeProfileCm3[i] - backgroundDopingCm3);
    const netActMid = 0.5 * (netAct0 + netAct1);
    const mobMid = 0.5 * (mobilityProfileCm2Vs[i - 1] + mobilityProfileCm2Vs[i]);

    const dDose = netActMid * dxCm;
    activeDoseCm2 += dDose;
    weightedMobSum += dDose * mobMid;
    sheetConductanceS += Q_E * dDose * mobMid;
    cumulativeSheetConductanceS[i] = sheetConductanceS;
  }

  const sheetResistanceOhmPerSq =
    sheetConductanceS > 1e-12 ? 1 / sheetConductanceS : Infinity;
  const junctionDepthNm = junctionDepthA * 0.1;
  const junctionDepthUm = junctionDepthNm * 1e-3;
  const effectiveResistivityOhmCm =
    Number.isFinite(sheetResistanceOhmPerSq) && junctionDepthNm > 0
      ? sheetResistanceOhmPerSq * (junctionDepthNm * 1e-7)
      : Infinity;

  return {
    junctionDepthNm,
    junctionDepthUm,
    sheetResistanceOhmPerSq,
    effectiveResistivityOhmCm,
    activeDoseCm2,
    activatedFractionPct: totalRawDose > 0 ? Math.min(100, (activeDoseCm2 / totalRawDose) * 100) : 0,
    peakConcentrationCm3: peakConc,
    peakDepthNm: peakDepthA * 0.1,
    surfaceConcentrationCm3: effConc[0] ?? 0,
    averageMobilityCm2Vs: activeDoseCm2 > 0 ? weightedMobSum / activeDoseCm2 : 0,
    effectiveProfileCm3: effConc,
    activeProfileCm3,
    mobilityProfileCm2Vs,
    cumulativeSheetConductanceS,
  };
}

export interface ThinFilmBenchmarkRow {
  id: string;
  name: string;
  formula: string;
  densityGPerCm3: number;
  projectedRangeA: number;
  projectedRangeNm: number;
  longitudinalStraggleA: number;
  lateralStraggleA: number;
  masking999ThicknessNm: number;
  seEvPerA: number;
  snEvPerA: number;
  nuclearFractionPct: number;
}

const KEY_BENCHMARK_IDS = new Set([
  'mat-c-si',
  'mat-th-sio2',
  'mat-teos-sio2',
  'mat-lpcvd-si3n4',
  'mat-pecvd-sinx',
  'mat-sicoh',
  'mat-hfo2',
  'mat-al2o3-ald',
  'mat-tin',
  'mat-tan',
  'mat-sige20',
  'mat-4h-sic',
  'mat-gan',
  'mat-gaas',
  'mat-inp',
  'mat-igzo',
  'mat-ito',
  'mat-cu',
  'mat-w',
  'mat-duv-pr',
]);

/**
 * Extracts projected range, longitudinal/lateral straggle, stopping powers (Se/Sn),
 * and 99.9% masking thickness (Rp + 3.09 * dRp) across major semiconductor thin films.
 */
export function computeThinFilmBenchmarks(
  z1: number,
  m1: number,
  energyKeV: number,
  filterIds?: Set<string>
): ThinFilmBenchmarkRow[] {
  const idFilter = filterIds ?? KEY_BENCHMARK_IDS;
  const targets = SEMICONDUCTOR_MATERIALS.filter((m) => idFilter.has(m.id));

  return targets.map((mat) => {
    const elemList = mat.elements.map((e) => ({
      z: e.z,
      symbol: e.symbol,
      name: e.name,
      stoich: e.stoich,
      mass: e.massAmu,
    }));

    const rows = calcStoppingAndRangeTable({
      z1,
      m1,
      elements: elemList,
      densityGPerCm3: mat.densityGPerCm3,
      phase: mat.phase,
      compoundCorr: mat.compoundCorr,
      unit: 1, // eV / Angstrom
      eMinKeV: 0,
      eMaxKeV: 0,
      customEnergiesKeV: [energyKeV],
    });
    const r = rows[0];
    const sTot = Math.max(1e-9, r.se + r.sn);
    return {
      id: mat.id,
      name: mat.name,
      formula: mat.formula,
      densityGPerCm3: mat.densityGPerCm3,
      projectedRangeA: r.projectedRangeA,
      projectedRangeNm: r.projectedRangeA * 0.1,
      longitudinalStraggleA: r.longitudinalStragglingA,
      lateralStraggleA: r.lateralStragglingA,
      masking999ThicknessNm: (r.projectedRangeA + 3.09 * r.longitudinalStragglingA) * 0.1,
      seEvPerA: r.se,
      snEvPerA: r.sn,
      nuclearFractionPct: (r.sn / sTot) * 100,
    };
  });
}
