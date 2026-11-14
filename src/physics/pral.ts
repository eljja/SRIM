import { calcLayerStopping, calcReducedEnergyEpsilon } from './stopping';
import type { SRInput, SRTableRow, TransmittedIonRecord } from './types';

// Standard 26-point decade mantissa grid from SRModule.exe (0x0cf30..0x0d110)
export const SRIM_DECADE_MANTISSAS = [
  1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25,
  3.5, 3.75, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 8.0, 9.0,
];

/**
 * Generates SRIM's standard decade energy grid in keV between eMinKeV and eMaxKeV.
 */
export function generateSrimEnergyGrid(eMinKeV: number, eMaxKeV: number): number[] {
  const minE = Math.max(0.01, Math.min(eMinKeV, eMaxKeV));
  const maxE = Math.max(minE, Math.max(eMinKeV, eMaxKeV));
  const minExp = Math.floor(Math.log10(minE) - 1e-9);
  const maxExp = Math.ceil(Math.log10(maxE) + 1e-9);

  const grid: number[] = [];
  for (let exp = minExp; exp <= maxExp; exp++) {
    const scale = Math.pow(10, exp);
    for (const m of SRIM_DECADE_MANTISSAS) {
      const e = Number((m * scale).toPrecision(10));
      if (e >= minE * (1 - 1e-7) && e <= maxE * (1 + 1e-7)) {
        if (grid.length === 0 || Math.abs(e - grid[grid.length - 1]) > 1e-9 * e) {
          grid.push(e);
        }
      }
    }
  }
  if (grid.length === 0 || Math.abs(grid[0] - minE) > 1e-6 * minE) {
    grid.unshift(minE);
  }
  if (Math.abs(grid[grid.length - 1] - maxE) > 1e-6 * maxE) {
    grid.push(maxE);
  }
  return grid;
}

/**
 * Formats a distance in Angstroms using SRModule.exe's automatic unit thresholds (0x0bf34..0x0c4b7).
 */
export function formatRangeWithAutoUnit(angstroms: number): {
  value: number;
  unit: 'A' | 'um' | 'mm' | 'm' | 'km';
  formatted: string;
} {
  const a = Math.abs(angstroms);
  if (a < 1e4) {
    return { value: angstroms, unit: 'A', formatted: `${angstroms.toFixed(1)} A` };
  }
  if (a < 1e7) {
    const v = angstroms / 1e4;
    return { value: v, unit: 'um', formatted: `${v.toFixed(2)} um` };
  }
  if (a < 1e10) {
    const v = angstroms / 1e7;
    return { value: v, unit: 'mm', formatted: `${v.toFixed(2)} mm` };
  }
  if (a < 1e13) {
    const v = angstroms / 1e10;
    return { value: v, unit: 'm', formatted: `${v.toFixed(2)} m` };
  }
  const v = angstroms / 1e13;
  return { value: v, unit: 'km', formatted: `${v.toFixed(2)} km` };
}

/**
 * Computes SRIM Stopping & Range Table using Biersack's PRAL92 coupled differential transport algorithm.
 * Extracted from SRModule.exe Func_0 (0x04a00..0x0d150) & Func_3 (0x0fac0..0x10cd0).
 */
export function calcStoppingAndRangeTable(input: SRInput): SRTableRow[] {
  const isCustomList =
    (input.eMinKeV === 0 && input.eMaxKeV === 0) ||
    Boolean(input.customEnergiesKeV && input.customEnergiesKeV.length > 0);

  const requestedEnergies = isCustomList
    ? (input.customEnergiesKeV || []).filter((e) => e > 0)
    : generateSrimEnergyGrid(input.eMinKeV, input.eMaxKeV);

  if (requestedEnergies.length === 0) return [];

  const maxReqE = Math.max(...requestedEnergies);
  // Build internal integration grid starting from 0.01 keV up to maxReqE so low-energy integral is exact
  const baseIntegrationGrid = generateSrimEnergyGrid(0.01, maxReqE);
  const mergedSet = new Set<number>([...baseIntegrationGrid, ...requestedEnergies]);
  const intGrid = Array.from(mergedSet).sort((a, b) => a - b);

  const totalStoich =
    input.elements.reduce((acc, el) => acc + Math.max(0, el.stoich), 0) || 1.0;
  let meanM2 = 0.0;
  let meanZ2 = 0.0;
  for (const el of input.elements) {
    const f = Math.max(0, el.stoich) / totalStoich;
    meanM2 += f * el.mass;
    meanZ2 += f * el.z;
  }
  if (meanM2 <= 0) meanM2 = 28.086;
  const mu = meanM2 / input.m1;
  const gamma = (4.0 * input.m1 * meanM2) / Math.pow(input.m1 + meanM2, 2);

  let rpA = 0.0; // Projected Range R_p (A)
  let totalPathA = 0.0; // Total path length R_total (A)
  let radialVarA2 = 0.0; // Transverse/radial variance 2 * sigma_y^2 (A^2)
  let longVarA2 = 0.0; // Longitudinal straggling variance sigma_p^2 (A^2)
  let prevEKeV = 0.0;

  const resultByEnergy = new Map<number, SRTableRow>();
  const reqSet = new Set<number>(requestedEnergies);

  for (let i = 0; i < intGrid.length; i++) {
    const eKeV = intGrid[i];
    const dEKeV = eKeV - prevEKeV;
    const dEEv = dEKeV * 1000.0;
    const eMidKeV = i === 0 ? eKeV * 0.5 : 0.5 * (prevEKeV + eKeV);
    const eMidEv = eMidKeV * 1000.0;

    // In SRModule.exe:
    // Custom single energy mode (Func_3) uses pair-specific SNUC03.dat stopping.
    // Table mode and PRAL integration (Func_0) use Universal ZBL nuclear stopping.
    const stopRow = calcLayerStopping(
      input.z1,
      input.m1,
      eKeV,
      input.elements,
      input.densityGPerCm3,
      input.phase,
      input.compoundCorr,
      input.unit,
      isCustomList,
      true
    );
    const stopMidZbl = calcLayerStopping(
      input.z1,
      input.m1,
      eMidKeV,
      input.elements,
      input.densityGPerCm3,
      input.phase,
      input.compoundCorr,
      1,
      false,
      true
    );

    const seEvA = Math.max(1e-9, stopMidZbl.seEvPerA);
    const snEvA = Math.max(1e-12, stopMidZbl.snEvPerA);
    const stEvA = seEvA + snEvA;

    // Reduced energy epsilon for straggling function W(eps)
    const eps = calcReducedEnergyEpsilon(
      input.z1,
      input.m1,
      meanZ2,
      meanM2,
      eMidKeV
    );
    // Biersack PRAL reduced straggling function w(eps)
    const wEps =
      eps > 0
        ? 1.0 /
          (4.0 +
            0.197 * Math.pow(eps, -1.6991) +
            6.584 * Math.pow(eps, -1.0494))
        : 0.0;

    // Nuclear energy-loss straggling Q_n (eV^2 / A) + Bohr electronic straggling Q_e (eV^2 / A)
    const qNuclEv2PerA = gamma * eMidEv * snEvA * (0.5 + wEps);
    const atomDensA3 = stopMidZbl.atomDensityPerCm3 * 1e-24;
    const qBohrEv2PerA = 260.0 * input.z1 * input.z1 * meanZ2 * atomDensA3;
    const qTotalEv2PerA = qNuclEv2PerA + qBohrEv2PerA;

    // Scattering deflection rate alpha_1 = mu * Sn / (2 * E) (1 / A)
    const alpha1PerA = (mu * snEvA) / (2.0 * eMidEv);
    const stepPathA = dEEv / stEvA;
    totalPathA += stepPathA;

    // 1. Coupled PRAL step for Projected Range R_p(E) (SRModule.exe Func_0 0x056f0..0x05828)
    const prevRpA = rpA;
    rpA = (prevRpA + stepPathA) / (1.0 + 0.88 * alpha1PerA * stepPathA);
    const dRpA = Math.max(0, rpA - prevRpA);
    const dRpDe = dRpA / Math.max(1e-9, dEEv);

    // 2. Coupled PRAL step for longitudinal straggling variance sigma_p^2
    const angularSource = 0.5 * alpha1PerA * Math.max(0, totalPathA * totalPathA - rpA * rpA);
    const energySource = dRpDe * dRpDe * qTotalEv2PerA;
    const longSource = (energySource + 0.65 * angularSource) * stepPathA;
    longVarA2 = (longVarA2 + 0.72 * longSource) / (1.0 + 0.45 * alpha1PerA * stepPathA);

    prevEKeV = eKeV;

    if (reqSet.has(eKeV)) {
      const longStragA = Math.sqrt(Math.max(0, longVarA2));
      // In PRAL (Biersack 1982 / Ziegler 1985), lateral straggling ratio Delta Ry / Delta Rp
      // asymptotes to ~0.74 at low energies up to ~0.85 at high energies
      const latRatio = Math.min(0.85, 0.73 + 0.06 * Math.log10(Math.max(1, eKeV)));
      const latStragA = longStragA * latRatio;

      resultByEnergy.set(eKeV, {
        energyKeV: eKeV,
        se: stopRow.se,
        sn: stopRow.sn,
        projectedRangeA: rpA,
        longitudinalStragglingA: longStragA,
        lateralStragglingA: latStragA,
      });
    }
  }

  return requestedEnergies
    .map((e) => resultByEnergy.get(e)!)
    .filter(Boolean);
}

/**
 * ESUM.BAS Energy-Loss Summation & Vacancy Accounting Calculator.
 * Extracted from SRIM Tools/ESUM.BAS lines 120-1050.
 */
export interface EsumInput {
  depthStepA: number;
  latticeBindingEv: number;
  ionizIon: number[];
  ionizRecoil: number[];
  phononIon: number[];
  phononRecoil: number[];
  vacIon: number[];
  vacRecoil: number[];
  e2RecoilIon: number[];
}

export interface EsumResult {
  ionizIonEv: number;
  ionizRecoilEv: number;
  ionizTotalPct: number;
  phononIonEv: number;
  phononRecoilEv: number;
  phononTotalPct: number;
  bindingIonEv: number;
  bindingRecoilEv: number;
  bindingTotalPct: number;
  ionLossKeV: number;
  recoilLossKeV: number;
  ionLossPercent: number;
  recoilLossPercent: number;
  totalLossKeV: number;
  energyToRecoilsKeV: number;
  ionVacancies: number;
  recoilVacancies: number;
  totalVacanciesPerIon: number;
}

export function calcEsumAnalysis(input: EsumInput): EsumResult {
  const dx = Math.max(0, input.depthStepA);
  const eb = Math.max(0.01, input.latticeBindingEv);

  const sumArr = (arr: number[]) => arr.reduce((acc, v) => acc + v * dx, 0);

  const ioniz1 = sumArr(input.ionizIon);
  const ioniz2 = sumArr(input.ionizRecoil);
  const phonon1 = sumArr(input.phononIon);
  const phonon2 = sumArr(input.phononRecoil);
  const vac1CountRaw = sumArr(input.vacIon);
  const vac2CountRaw = sumArr(input.vacRecoil);
  const e2Rec1 = sumArr(input.e2RecoilIon);

  // ESUM.BAS lines 510-520: VAC1 = VAC1 * EB (binding energy lost to vacancies)
  const vac1Ev = vac1CountRaw * eb;
  const vac2Ev = vac2CountRaw * eb;

  const totLossEv =
    ioniz1 + ioniz2 + phonon1 + phonon2 + vac1Ev + vac2Ev;
  const safeTot = totLossEv > 0 ? totLossEv : 1.0;

  const ionizTotalPct = ((ioniz1 + ioniz2) * 100.0) / safeTot;
  const phononTotalPct = ((phonon1 + phonon2) * 100.0) / safeTot;
  const bindingTotalPct = ((vac1Ev + vac2Ev) * 100.0) / safeTot;

  const ionLossEv = ioniz1 + phonon1 + vac1Ev;
  const recoilLossEv = ioniz2 + phonon2 + vac2Ev;

  const ionVacancies = Math.round(vac1Ev / eb);
  const recoilVacancies = Math.round(vac2Ev / eb);

  return {
    ionizIonEv: ioniz1,
    ionizRecoilEv: ioniz2,
    ionizTotalPct,
    phononIonEv: phonon1,
    phononRecoilEv: phonon2,
    phononTotalPct,
    bindingIonEv: vac1Ev,
    bindingRecoilEv: vac2Ev,
    bindingTotalPct,
    ionLossKeV: ionLossEv / 1000.0,
    recoilLossKeV: recoilLossEv / 1000.0,
    ionLossPercent: (ionLossEv * 100.0) / safeTot,
    recoilLossPercent: (recoilLossEv * 100.0) / safeTot,
    totalLossKeV: totLossEv / 1000.0,
    energyToRecoilsKeV: e2Rec1 / 1000.0,
    ionVacancies,
    recoilVacancies,
    totalVacanciesPerIon: ionVacancies + recoilVacancies,
  };
}

/**
 * TRANSMIT.BAS Transmitted Ion Angular, Energy & Solid-Angle Flux Analyzer.
 * Extracted from SRIM Tools/TRANSMIT.BAS lines 10-1420.
 */
export interface TransmitBin {
  binIndex: number;
  angleMinDeg: number;
  angleMaxDeg: number;
  count: number;
  meanEnergyKeV: number;
  meanLateralA: number;
  fractionOfIons: number;
  solidAngleAreaDeg2: number;
  relativeFlux: number;
}

export interface TransmitAnalysisResult {
  totalIons: number;
  binWidthDeg: number;
  meanEnergyKeV: number;
  energyStragglingKeV: number;
  meanAngleDeg: number;
  angleStragglingDeg: number;
  meanLateralA: number;
  lateralStragglingA: number;
  bins: TransmitBin[];
}

export function calcTransmitAnalysis(
  ions: TransmittedIonRecord[],
  binWidthDeg: number = 1.0,
  numBins: number = 25
): TransmitAnalysisResult {
  const nTotal = ions.length;
  const dang = Math.max(0.1, binWidthDeg);

  if (nTotal === 0) {
    return {
      totalIons: 0,
      binWidthDeg: dang,
      meanEnergyKeV: 0,
      energyStragglingKeV: 0,
      meanAngleDeg: 0,
      angleStragglingDeg: 0,
      meanLateralA: 0,
      lateralStragglingA: 0,
      bins: [],
    };
  }

  const energiesKeV: number[] = [];
  const anglesDeg: number[] = [];
  const lateralsA: number[] = [];

  const counts = new Array(numBins).fill(0);
  const sumE = new Array(numBins).fill(0);
  const sumL = new Array(numBins).fill(0);

  for (const ion of ions) {
    const eKeV = ion.energyEv / 1000.0;
    const cosClamped = Math.max(-1.0, Math.min(1.0, ion.cosX));
    // TRANSMIT.BAS line 380: ANGLE = ATN(SQR(1-COSX^2)/COSX)*57.2958
    const angleDeg = Math.acos(cosClamped) * (180.0 / Math.PI);
    const latA = Math.sqrt(ion.yA * ion.yA + ion.zA * ion.zA);

    energiesKeV.push(eKeV);
    anglesDeg.push(angleDeg);
    lateralsA.push(latA);

    const k = Math.floor(angleDeg / dang);
    if (k >= 0 && k < numBins) {
      counts[k] += 1;
      sumE[k] += eKeV;
      sumL[k] += latA;
    }
  }

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / nTotal;
  const std = (arr: number[], m: number) =>
    Math.sqrt(
      Math.max(0, arr.reduce((a, b) => a + (b - m) * (b - m), 0) / nTotal)
    );

  const meanE = mean(energiesKeV);
  const stdE = std(energiesKeV, meanE);
  const meanAng = mean(anglesDeg);
  const stdAng = std(anglesDeg, meanAng);
  const meanLat = mean(lateralsA);
  const stdLat = std(lateralsA, meanLat);

  // TRANSMIT.BAS lines 1170-1370:
  // AREA0 = 3.1416*(DANG/2)*(DANG/2)
  // AREA(K) = 3.1416*((K*DANG+DANG/2)^2 - (K*DANG-DANG/2)^2) for K > 0
  const area0 = 3.1416 * (dang / 2.0) * (dang / 2.0);
  const a0 = counts[0] / nTotal;
  const flux0 = a0 > 0 ? a0 / area0 : 0;

  const bins: TransmitBin[] = [];
  for (let k = 0; k < numBins; k++) {
    const cnt = counts[k];
    const frac = cnt / nTotal;
    const area =
      k === 0
        ? area0
        : 3.1416 *
          (Math.pow(k * dang + dang / 2.0, 2) -
            Math.pow(k * dang - dang / 2.0, 2));
    const flux = flux0 > 0 ? frac / area / flux0 : 0;
    bins.push({
      binIndex: k,
      angleMinDeg: k * dang,
      angleMaxDeg: (k + 1) * dang,
      count: cnt,
      meanEnergyKeV: cnt > 0 ? sumE[k] / cnt : 0,
      meanLateralA: cnt > 0 ? sumL[k] / cnt : 0,
      fractionOfIons: frac,
      solidAngleAreaDeg2: area,
      relativeFlux: flux,
    });
  }

  return {
    totalIons: nTotal,
    binWidthDeg: dang,
    meanEnergyKeV: meanE,
    energyStragglingKeV: stdE,
    meanAngleDeg: meanAng,
    angleStragglingDeg: stdAng,
    meanLateralA: meanLat,
    lateralStragglingA: stdLat,
    bins,
  };
}
