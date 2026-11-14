import { SCOEF03, SNUC03_PAIRS, getElementByZ } from '../data';
import type { CABResult, StoppingUnit } from './types';

// Elements whose SCOEF03.dat parameters are stored for the GAS phase (flag_gas = 1)
// Extracted from SRModule.exe 0x41a38c / Func_13
export const GAS_STORED_ELEMENTS = new Set<number>([
  1, 2, 7, 8, 9, 10, 17, 18, 35, 36, 53, 54, 85, 86,
]);

// Noble gases forced to gas phase in SRModule.exe Func_7 (0x12a30..0x12b20)
export const NOBLE_GAS_ELEMENTS = new Set<number>([2, 10, 18, 36, 54, 86]);

// 18 Chemical Bond Stopping Powers at 125 keV/amu proton (eV / 1E15 atoms/cm2)
// Extracted from TIN.exe G_0x4a7208 (0x86c80..0x87230)
export interface BondDefinition {
  index: number;
  label: string;
  stopping125keV: number;
}

export const BOND_DEFINITIONS: BondDefinition[] = [
  { index: 0, label: 'H - H', stopping125keV: 10.3181 },
  { index: 1, label: 'H - C', stopping125keV: 7.40343 },
  { index: 2, label: 'H - N', stopping125keV: 8.41394 },
  { index: 3, label: 'H - O', stopping125keV: 10.0614 },
  { index: 4, label: 'C - C', stopping125keV: 4.00266 },
  { index: 5, label: 'C = C', stopping125keV: 9.98219 },
  { index: 6, label: 'C ≡ C', stopping125keV: 14.4233 },
  { index: 7, label: 'C - N', stopping125keV: 5.1155 },
  { index: 8, label: 'C - O', stopping125keV: 5.75015 },
  { index: 9, label: 'C = O', stopping125keV: 14.2633 },
  { index: 10, label: 'C - F', stopping125keV: 11.0429 },
  { index: 11, label: 'C - Cl', stopping125keV: 3.71828 },
  { index: 12, label: 'N ≡ N', stopping125keV: 21.0365 },
  { index: 13, label: 'N - O', stopping125keV: 15.7906 },
  { index: 14, label: 'O = O', stopping125keV: 22.006 },
  { index: 15, label: 'S - H', stopping125keV: 4.51273 },
  { index: 16, label: 'S - C', stopping125keV: 1.66518 },
  { index: 17, label: 'S - F', stopping125keV: 2.0 },
];

// 11 Closed-Shell Core Stopping Powers at 125 keV/amu proton (eV / 1E15 atoms/cm2)
// Extracted from TIN.exe G_0x4a7220 (0x86dd0..0x871d0)
export const CORE_STOPPING_125KEV: Record<number, number> = {
  1: 0.0,
  2: 6.75,
  3: 9.2,
  4: 10.0,
  5: 13.2,
  6: 6.2892,
  7: 6.01368,
  8: 5.45459,
  9: 5.44283,
  16: 34.2991,
  17: 29.0821,
};

// Fast lookup table for SNUC03 pair parameters (a, b, c, d)
const snucPairMap = new Map<number, [number, number, number, number]>();
for (const row of SNUC03_PAIRS) {
  const zMin = Math.min(row[0], row[1]);
  const zMax = Math.max(row[0], row[1]);
  const key = zMin * 100 + zMax;
  snucPairMap.set(key, [row[2], row[3], row[4], row[5]]);
}

export function getSnucCoeffs(z1: number, z2: number): [number, number, number, number] {
  const zMin = Math.max(1, Math.min(92, Math.min(Math.round(z1), Math.round(z2))));
  const zMax = Math.max(1, Math.min(92, Math.max(Math.round(z1), Math.round(z2))));
  return snucPairMap.get(zMin * 100 + zMax) || [1.1383, 0.01321, 0.21226, 0.19593];
}

/**
 * Computes reduced energy epsilon for nuclear stopping (SRModule.exe Func_4 & STOP.BAS line 173).
 */
export function calcReducedEnergyEpsilon(
  z1: number,
  m1: number,
  z2: number,
  m2: number,
  energyKeV: number
): number {
  const denom = z1 * z2 * (m1 + m2) * (Math.pow(z1, 0.23) + Math.pow(z2, 0.23));
  if (denom <= 0 || energyKeV <= 0) return 0;
  return (32.53 * m2 * energyKeV) / denom;
}

/**
 * Computes pair-specific nuclear stopping power from SNUC03.dat in eV / (1E15 atoms/cm2) (Unit 7).
 * Extracted from SRModule.exe Func_4 (0x10cd0..0x11850).
 */
export function calcNuclearStoppingSNUC03(
  z1: number,
  m1: number,
  z2: number,
  m2: number,
  energyKeV: number
): number {
  if (energyKeV <= 0) return 0;
  const eps = calcReducedEnergyEpsilon(z1, m1, z2, m2, energyKeV);
  if (eps <= 0) return 0;
  const [c1, c2, c3, c4] = getSnucCoeffs(z1, z2);
  let snReduced: number;
  if (eps > 30) {
    snReduced = Math.log(eps) / (2 * eps);
  } else {
    const denom = eps + c2 * Math.pow(eps, c3) + c4 * Math.pow(eps, 0.5);
    snReduced = (0.5 * Math.log(1 + c1 * eps)) / denom;
  }
  const factor =
    (8.462 * z1 * z2 * m1) / ((m1 + m2) * (Math.pow(z1, 0.23) + Math.pow(z2, 0.23)));
  return snReduced * factor;
}

/**
 * Computes ZBL universal nuclear stopping power in eV / (1E15 atoms/cm2) (Unit 7).
 * Extracted from STOP.BAS lines 171-182 & SRModule.exe PRAL92 loop (0xcd18..0xd268).
 */
export function calcNuclearStoppingZBL(
  z1: number,
  m1: number,
  z2: number,
  m2: number,
  energyKeV: number
): number {
  if (energyKeV <= 0) return 0;
  const eps = calcReducedEnergyEpsilon(z1, m1, z2, m2, energyKeV);
  if (eps <= 0) return 0;
  let snReduced: number;
  if (eps >= 30) {
    snReduced = Math.log(eps) / (2 * eps);
  } else {
    const a = 0.01321 * Math.pow(eps, 0.21226) + 0.19593 * Math.pow(eps, 0.5);
    snReduced = (0.5 * Math.log(1 + 1.1383 * eps)) / (eps + a);
  }
  const factor =
    (8.462 * z1 * z2 * m1) / ((m1 + m2) * (Math.pow(z1, 0.23) + Math.pow(z2, 0.23)));
  return snReduced * factor;
}

/**
 * Relativistic Bethe-Bloch electronic stopping with Shell, Barkas, and Bloch corrections.
 * Extracted from SRModule.exe Func_11 (0x14870..0x156f0).
 * @param z1 Ion atomic number
 * @param z2 Target atomic number
 * @param ePerAmu Ion energy in keV/amu
 * @param solidGas 0 = Solid, 1 = Gas, 2 = Compound
 * @returns Stopping power in eV / (1E15 atoms/cm2)
 */
export function calcBetheBloch(
  z1: number,
  z2: number,
  ePerAmu: number,
  solidGas: number = 0
): number {
  const el2 = getElementByZ(z2);
  const eClamped = Math.max(100, ePerAmu);
  const ratio = 1.0 + eClamped / 931494.0;
  const betaSq = 1.0 - 1.0 / (ratio * ratio);

  // Shell correction C/Z2 (Func_11 0x14bc5..0x14e40)
  let shellCorr = 0.0;
  if (eClamped <= 45000.0) {
    const lnE = Math.log(eClamped);
    for (let k = 0; k < 11; k++) {
      shellCorr += el2.shellLow[k] * Math.pow(lnE, k);
    }
  } else {
    const lnEMeV = Math.log(0.001 * eClamped);
    for (let k = 0; k < 8; k++) {
      shellCorr += el2.shellHigh[k] * Math.pow(lnEMeV, k);
    }
  }

  // Mean excitation energy I0 (col 67 = Solid, col 68 = Gas, col 69 = Compound)
  let i0 = el2.i0Solid;
  if (solidGas === 1) i0 = el2.i0Gas;
  else if (solidGas === 2) i0 = el2.i0Compound;
  if (i0 <= 0) i0 = el2.i0Solid || 10.0 * z2;

  const l0 = Math.log((1022000.0 * betaSq) / (1.0 - betaSq)) - betaSq - Math.log(i0);

  // Bloch correction Z1^2 * L2 (Func_11 0x15080..0x15220)
  const y = z1 / 137.036;
  const ySq = (y * y) / betaSq;
  const z1SqL2 =
    -ySq * (1.20206 - ySq * (1.042 - 0.8549 * ySq + 0.343 * ySq * ySq));

  // Barkas correction Z1 * L1 (Func_11 0x15230..0x15470)
  const eMeV = 0.001 * eClamped;
  const lLow =
    1.5 / (Math.pow(eClamped, 0.4) + (45000.0 / z2) * Math.pow(eMeV, 1.6));
  const cHigh = z2 === 1 ? 1.35 : 1.5;
  const lHigh = cHigh / Math.pow(eMeV, 0.4);
  const l1Factor = (lLow * lHigh) / (lLow + lHigh);
  const z1L1 = z1 * l1Factor * (l0 - shellCorr);

  const bracket = l0 - shellCorr + z1L1 + z1SqL2;
  return ((z1 * z1 * z2) / (1961.16 * betaSq)) * Math.max(0.01, bracket);
}

/**
 * Light-ion fit formula shared by PSTOP (Z1=1), HESTOP (Z1=2), and LISTOP (Z1=3).
 * Extracted from SRModule.exe Func_8, Func_9, Func_10 (0x13190..0x14870).
 */
function evalLightIonFit(coeffs: number[], e: number): number {
  const sLow =
    coeffs[0] * Math.pow(e, coeffs[1]) +
    coeffs[2] * Math.pow(e, coeffs[3]) +
    coeffs[8] * Math.pow(e, 0.5);
  const sHigh =
    (coeffs[4] / Math.pow(e, coeffs[5])) *
    (Math.log(coeffs[6] / e + coeffs[7] * e) + coeffs[9] / Math.pow(e, 0.2));
  if (sLow + sHigh <= 0) return 0;
  return (sLow * sHigh) / (sLow + sHigh);
}

export function calcLightIonStopping(
  z1: 1 | 2 | 3,
  z2: number,
  ePerAmu: number,
  solidGas: number = 0
): number {
  if (ePerAmu <= 0) return 0;
  const el2 = getElementByZ(z2);
  const coeffs = z1 === 1 ? el2.pstop : z1 === 2 ? el2.hestop : el2.listop;
  const eMin = 2.0;
  const eMax = z1 === 1 ? 1000.0 : 2000.0;

  if (ePerAmu > 1.2 * eMax) {
    return calcBetheBloch(z1, z2, ePerAmu, solidGas);
  }
  if (ePerAmu < eMin) {
    const sMin = evalLightIonFit(coeffs, eMin);
    return sMin * Math.pow(ePerAmu / eMin, 0.5);
  }
  if (ePerAmu <= eMax) {
    return evalLightIonFit(coeffs, ePerAmu);
  }
  // Linear interpolation between eMax and 1.2 * eMax (0x136b2..0x137b8)
  const sMax = evalLightIonFit(coeffs, eMax);
  const sBB = calcBetheBloch(z1, z2, 1.2 * eMax, solidGas);
  return sMax + ((sBB - sMax) * (ePerAmu - eMax)) / (0.2 * eMax);
}

/**
 * Heavy-ion stopping power HISTOP (Z1 > 3).
 * Extracted from SRModule.exe Func_12 (0x156f0..0x165d0).
 */
export function calcHeavyIonStopping(
  z1: number,
  z2: number,
  ePerAmu: number,
  solidGas: number = 0
): number {
  if (ePerAmu <= 0) return 0;
  const el1 = getElementByZ(z1);
  const el2 = getElementByZ(z2);
  const eMin = 2.0;
  const eMax = 30000.0;

  const evalPolyFit = (e: number): number => {
    const lnE = Math.log(e);
    let p1 = 0.0;
    let p2 = 0.0;
    for (let k = 0; k < 13; k++) {
      const pwr = Math.pow(lnE, k);
      p1 += el1.hip1[k] * pwr;
      p2 += el2.hip2[k] * pwr;
    }
    const sHe = calcLightIonStopping(2, z2, e, solidGas);
    return ((z1 * z1) / 4.0) * sHe * p1 * p2;
  };

  if (ePerAmu < eMin) {
    return evalPolyFit(eMin) * Math.pow(ePerAmu / eMin, 0.5);
  }
  if (ePerAmu <= eMax) {
    return evalPolyFit(ePerAmu);
  }

  // High-energy heavy-ion regime (E > 30000 keV/amu) (0x15e6d..0x165c8)
  const h = el1.hiEffCharge; // h[0..4] = c[1..5]
  const evalZeta = (eVal: number): number => {
    const x = Math.log10(eVal);
    const d = x - h[1];
    const w = d >= 0 ? h[3] : h[2];
    const sig = w !== 0 ? 1.0 / (1.0 + Math.exp(-d / w)) : 1.0;
    const bump = h[4] * Math.exp(-Math.abs(h[1] + 1.3 - x));
    return h[0] + (1.0 - h[0]) * sig + bump;
  };

  const sFitMax = evalPolyFit(eMax);
  const zetaMax = evalZeta(eMax);
  const zetaE = evalZeta(ePerAmu);
  const bbMax = calcBetheBloch(2, z2, eMax, solidGas);
  const bbE = calcBetheBloch(2, z2, ePerAmu, solidGas);

  if (bbMax <= 0 || zetaMax <= 0) return sFitMax;
  return sFitMax * ((bbE * zetaE * zetaE) / (bbMax * zetaMax * zetaMax));
}

/**
 * Full single-element electronic stopping power STOP2003 in eV / (1E15 atoms/cm2) (Unit 7).
 * Includes Gas/Solid phase correction and Bohr-velocity sigmoid decay of compound/phase corrections.
 * Extracted from SRModule.exe Func_7 (0x12250..0x13090).
 */
export function calcElectronicStoppingElement(
  z1: number,
  m1: number,
  z2: number,
  energyKeV: number,
  solidGasInput: 0 | 1 = 0,
  compoundCorr: number = 1.0
): number {
  if (energyKeV <= 0 || m1 <= 0) return 0;
  const ePerAmu = energyKeV / m1;

  // Noble gases always use gas phase (0x12a30..0x12b20)
  const solidGas: 0 | 1 = NOBLE_GAS_ELEMENTS.has(z2) ? 1 : solidGasInput;

  let seBase: number;
  if (z1 === 1) {
    seBase = calcLightIonStopping(1, z2, ePerAmu, solidGas);
  } else if (z1 === 2) {
    seBase = calcLightIonStopping(2, z2, ePerAmu, solidGas);
  } else if (z1 === 3) {
    seBase = calcLightIonStopping(3, z2, ePerAmu, solidGas);
  } else {
    seBase = calcHeavyIonStopping(z1, z2, ePerAmu, solidGas);
  }

  // Phase correction against how Z2 is stored in SCOEF03.dat (0x12bc5..0x12d74)
  const flagGas = GAS_STORED_ELEMENTS.has(z2) ? 1 : 0;
  let phaseCorr = 1.0;
  if (solidGas !== flagGas) {
    phaseCorr = flagGas === 1 ? 0.92 : 1.0 / 0.92;
  }

  const corr0 = compoundCorr > 0 ? compoundCorr * phaseCorr : phaseCorr;
  if (Math.abs(corr0 - 1.0) < 1e-9) {
    return seBase;
  }

  // Bohr-velocity decay of compound & phase correction (0x12d9d..0x12fac)
  const vBohr = Math.sqrt(ePerAmu / 25.0);
  const vMid = z1 === 1 ? 7.0 : 4.0;
  const decay = 1.0 + (corr0 - 1.0) / (1.0 + Math.exp(1.48 * (vBohr - vMid)));
  return seBase * decay;
}

/**
 * Converts a stopping power value from Unit 7 (eV / (1E15 atoms/cm2)) to any of the 8 SRIM units.
 * Extracted from STOP.BAS lines 148-155 and SRModule.exe (0x0da60..0x0dc60).
 */
export function convertStoppingUnit(
  sUnit7: number,
  unit: StoppingUnit,
  atomDensityPerCm3: number,
  meanTargetMassAmu: number,
  z1: number = 1,
  m1: number = 1.008,
  meanZ2: number = 14
): number {
  const sEvAng2 = sUnit7 * 10.0; // 1 eV/(1E15 atoms/cm2) = 10 eV * A^2 / atom
  switch (unit) {
    case 1: // eV / Angstrom
      return sEvAng2 * atomDensityPerCm3 * 1e-24;
    case 2: // keV / micron
      return sEvAng2 * atomDensityPerCm3 * 1e-23;
    case 3: // MeV / mm
      return sEvAng2 * atomDensityPerCm3 * 1e-23;
    case 4: // keV / (ug/cm2)
      return sEvAng2 * (0.060222 / meanTargetMassAmu);
    case 5: // MeV / (mg/cm2)
      return sEvAng2 * (0.060222 / meanTargetMassAmu);
    case 6: // keV / (mg/cm2)
      return sEvAng2 * (0.060222 / meanTargetMassAmu) * 1000.0;
    case 7: // eV / (1E15 atoms/cm2)
      return sUnit7;
    case 8: {
      // L.S.S. reduced units
      const lssFactor =
        (8.462 * z1 * meanZ2 * m1) /
        ((m1 + meanTargetMassAmu) * (Math.pow(z1, 0.23) + Math.pow(meanZ2, 0.23)));
      return lssFactor > 0 ? sUnit7 / lssFactor : sUnit7;
    }
  }
}

/**
 * Computes compound/multi-element layer electronic & nuclear stopping powers.
 * Matches SRModule.exe (0x0c800..0x0dc60).
 */
export function calcLayerStopping(
  z1: number,
  m1: number,
  energyKeV: number,
  elements: { z: number; mass: number; stoich: number }[],
  densityGPerCm3: number,
  phase: 0 | 1 = 0,
  compoundCorr: number = 1.0,
  unit: StoppingUnit = 1,
  useSnuc03: boolean = true,
  skipEffCharge: boolean = false
): {
  se: number;
  sn: number;
  sTotal: number;
  seUnit7: number;
  snUnit7: number;
  seEvPerA: number;
  snEvPerA: number;
  effCharge: number;
  atomDensityPerCm3: number;
  meanMassAmu: number;
} {
  const totalStoich = elements.reduce((acc, el) => acc + Math.max(0, el.stoich), 0) || 1.0;
  let meanMassAmu = 0.0;
  let meanZ2 = 0.0;
  for (const el of elements) {
    const frac = Math.max(0, el.stoich) / totalStoich;
    meanMassAmu += frac * el.mass;
    meanZ2 += frac * el.z;
  }
  if (meanMassAmu <= 0) meanMassAmu = 28.086;

  // Atomic density N (atoms/cm^3) = rho * N_A / meanMassAmu
  const atomDensityPerCm3 = (densityGPerCm3 * 6.02214076e23) / meanMassAmu;

  let seUnit7 = 0.0;
  let snUnit7 = 0.0;
  let seProtonUnit7 = 0.0;

  for (const el of elements) {
    const frac = Math.max(0, el.stoich) / totalStoich;
    if (frac <= 0) continue;
    seUnit7 +=
      frac *
      calcElectronicStoppingElement(z1, m1, el.z, energyKeV, phase, compoundCorr);
    if (!skipEffCharge) {
      seProtonUnit7 +=
        frac *
        calcElectronicStoppingElement(1, 1.008, el.z, (energyKeV / m1) * 1.008, phase, 1.0);
    }
    snUnit7 +=
      frac *
      (useSnuc03
        ? calcNuclearStoppingSNUC03(z1, m1, el.z, el.mass, energyKeV)
        : calcNuclearStoppingZBL(z1, m1, el.z, el.mass, energyKeV));
  }

  const effCharge =
    !skipEffCharge && seProtonUnit7 > 1e-12
      ? Math.sqrt(Math.max(0, seUnit7 / seProtonUnit7))
      : z1;

  const se = convertStoppingUnit(
    seUnit7,
    unit,
    atomDensityPerCm3,
    meanMassAmu,
    z1,
    m1,
    meanZ2
  );
  const sn = convertStoppingUnit(
    snUnit7,
    unit,
    atomDensityPerCm3,
    meanMassAmu,
    z1,
    m1,
    meanZ2
  );
  const seEvPerA = convertStoppingUnit(
    seUnit7,
    1,
    atomDensityPerCm3,
    meanMassAmu,
    z1,
    m1,
    meanZ2
  );
  const snEvPerA = convertStoppingUnit(
    snUnit7,
    1,
    atomDensityPerCm3,
    meanMassAmu,
    z1,
    m1,
    meanZ2
  );

  return {
    se,
    sn,
    sTotal: se + sn,
    seUnit7,
    snUnit7,
    seEvPerA,
    snEvPerA,
    effCharge,
    atomDensityPerCm3,
    meanMassAmu,
  };
}

/**
 * Ziegler-Manoyan Core-and-Bond (CAB) Compound Binding & Phase Correction Calculator.
 * Extracted from TIN.exe Func_CAB (0x86a80..0x8a900).
 */
export function calcCoreAndBond(
  z1: number,
  elements: { z: number; stoich: number }[],
  bonds: number[],
  densityGPerCm3: number = 1.0,
  compoundName: string = ''
): CABResult {
  // Sum stoichiometry as given (in Compound.dat, stoich is atoms per molecule matching the bond counts)
  let sCoreSum = 0.0;
  for (const el of elements) {
    if (el.stoich <= 0) continue;
    let coreVal = CORE_STOPPING_125KEV[el.z];
    if (coreVal === undefined) {
      // Heavy element core stopping is proton stopping at 125 keV/u in Solid (0x88f5a)
      coreVal = calcElectronicStoppingElement(1, 1.0, el.z, 125.0, 0, 1.0);
    }
    sCoreSum += el.stoich * coreVal;
  }

  let sBondSum = 0.0;
  for (let i = 0; i < Math.min(18, bonds.length); i++) {
    if (bonds[i] > 0) {
      sBondSum += bonds[i] * BOND_DEFINITIONS[i].stopping125keV;
    }
  }

  const sCab = sCoreSum + sBondSum;

  // Ion scale factor F_ion and Bragg evaluation parameters (TIN.exe 0x89591..0x899a2)
  let fIon = 1.0;
  let zEval = 1;
  let mEval = 1.0;
  let eEvalKeV = 125.0;
  if (z1 === 2) {
    fIon = 2.8207;
    zEval = 2;
    mEval = 4.0;
    eEvalKeV = 500.0;
  } else if (z1 > 2) {
    fIon = 1.93;
    zEval = 3;
    mEval = 7.0;
    eEvalKeV = 175.0;
  }

  // Standard gas elements in TIN.exe (0x89f90): H(1), N(7), O(8), F(9), Cl(17)
  const tinGasSet = new Set([1, 7, 8, 9, 17]);

  let sBraggSolid = 0.0;
  let sBraggGas = 0.0;
  let sBraggStd = 0.0;

  for (const el of elements) {
    if (el.stoich <= 0) continue;
    // Notice TIN.exe calls STOP2000 for each target element in Solid vs Gas
    const seSolid = calcElectronicStoppingElement(zEval, mEval, el.z, eEvalKeV, 0, 1.0);
    const seGas = calcElectronicStoppingElement(zEval, mEval, el.z, eEvalKeV, 1, 1.0);
    const seStd = tinGasSet.has(el.z) ? seGas : seSolid;
    sBraggSolid += el.stoich * seSolid;
    sBraggGas += el.stoich * seGas;
    sBraggStd += el.stoich * seStd;
  }

  let solidBindingCorr =
    sBraggSolid > 0 && sBondSum > 0 ? (0.92 * fIon * sCab) / sBraggSolid : 1.0;
  let gasBindingCorr =
    sBraggGas > 0 && sBondSum > 0 ? (fIon * sCab) / sBraggGas : 1.0;

  // Special TIN.exe override for "Water" (0x89db5..0x89ef0)
  const cleanName = compoundName.trim().toLowerCase();
  if (cleanName === 'water' || cleanName === 'water_liquid' || cleanName === 'water (h2o)') {
    if (z1 === 1) {
      solidBindingCorr = 0.89;
      gasBindingCorr = 0.94;
    } else if (z1 === 2) {
      solidBindingCorr = 0.95;
      gasBindingCorr = 1.01;
    }
  }

  const isGasTarget = densityGPerCm3 < 0.1;
  const targetPhaseCorr =
    sBraggStd > 0
      ? isGasTarget
        ? sBraggGas / sBraggStd
        : sBraggSolid / sBraggStd
      : 1.0;

  const recommendedCorr = isGasTarget ? gasBindingCorr : solidBindingCorr;

  return {
    sCab,
    sBraggSolid,
    sBraggGas,
    sBraggStd,
    solidBindingCorr,
    gasBindingCorr,
    recommendedCorr,
    targetPhaseCorr,
  };
}
