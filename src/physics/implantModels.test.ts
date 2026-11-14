import { describe, it, expect } from 'vitest';
import {
  calcLssCompactRange,
  calcEmpiricalPowerLawRange,
  evaluateGaussianProfile,
  evaluateJoinedHalfGaussianProfile,
  evaluatePearsonIVProfile,
  calcCaugheyThomasMobility,
  predictJunctionAndSheetResistance,
  computeThinFilmBenchmarks,
} from './implantModels';
import { calcStoppingAndRangeTable } from './pral';

describe('Compact / Empirical Implant Models & Junction/Sheet Resistivity Solver', () => {
  const siTarget = [
    { z: 14, name: 'Silicon', stoich: 1.0, mass: 28.086 },
  ];

  it('computes LSS compact range & straggling scaling physically with energy and matching order of magnitude of PRAL92', () => {
    const lss10 = calcLssCompactRange(5, 11.009, 10, siTarget, 2.329);
    const lss50 = calcLssCompactRange(5, 11.009, 50, siTarget, 2.329);
    const lss200 = calcLssCompactRange(5, 11.009, 200, siTarget, 2.329);

    expect(lss10.reducedEnergy).toBeGreaterThan(0);
    expect(lss10.projectedRangeA).toBeLessThan(lss50.projectedRangeA);
    expect(lss50.projectedRangeA).toBeLessThan(lss200.projectedRangeA);
    expect(lss50.stragglingA).toBeGreaterThan(0);

    // Compare against PRAL92 for 50 keV B -> Si
    const pral50 = calcStoppingAndRangeTable({
      z1: 5,
      m1: 11.009,
      elements: siTarget,
      densityGPerCm3: 2.329,
      phase: 0,
      compoundCorr: 1.0,
      unit: 1,
      eMinKeV: 0,
      eMaxKeV: 0,
      customEnergiesKeV: [50],
    })[0];
    const ratio = lss50.projectedRangeA / pral50.projectedRangeA;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(1.8);
  });

  it('computes Empirical Power-Law compact range cleanly for As, P, and B in Si', () => {
    const empAs = calcEmpiricalPowerLawRange(33, 74.922, 50, siTarget, 2.329);
    const empB = calcEmpiricalPowerLawRange(5, 11.009, 50, siTarget, 2.329);

    // Lighter B penetrates significantly deeper than heavy As at same energy
    expect(empB.projectedRangeA).toBeGreaterThan(empAs.projectedRangeA * 3);
    expect(empAs.stragglingA).toBeGreaterThan(0);
  });

  it('normalizes Gaussian, Joined Half-Gaussian, and Pearson IV profiles to total dose', () => {
    const dose = 1e15; // ions/cm^2
    const depthsA = Array.from({ length: 400 }, (_, i) => i * 25); // 0 .. 10000 A (1 um)
    const dxCm = 25 * 1e-8;

    const gauss = evaluateGaussianProfile(depthsA, dose, 1600, 500);
    const halfGauss = evaluateJoinedHalfGaussianProfile(depthsA, dose, 1600, 500, -0.4);
    const pearson = evaluatePearsonIVProfile(depthsA, dose, 1600, 500, -0.5, 3.6);

    const integrate = (arr: number[]) => arr.reduce((a, b) => a + b * dxCm, 0);

    expect(integrate(gauss)).toBeGreaterThan(0.97 * dose);
    expect(integrate(gauss)).toBeLessThan(1.03 * dose);

    expect(integrate(halfGauss)).toBeGreaterThan(0.95 * dose);
    expect(integrate(halfGauss)).toBeLessThan(1.05 * dose);

    expect(integrate(pearson)).toBeGreaterThan(0.95 * dose);
    expect(integrate(pearson)).toBeLessThan(1.05 * dose);

    // Negative skewness (typical for light Boron) shifts peak deeper than Rp
    const peakIdx = pearson.indexOf(Math.max(...pearson));
    expect(depthsA[peakIdx]).toBeGreaterThanOrEqual(1600);
  });

  it('computes Caughey-Thomas carrier mobility monotonically decreasing with doping', () => {
    const muNLow = calcCaugheyThomasMobility('n', 1e15, 300);
    const muNHigh = calcCaugheyThomasMobility('n', 1e20, 300);
    const muPLow = calcCaugheyThomasMobility('p', 1e15, 300);
    const muPHigh = calcCaugheyThomasMobility('p', 1e20, 300);

    expect(muNLow).toBeGreaterThan(1200);
    expect(muNHigh).toBeLessThan(150);
    expect(muPLow).toBeGreaterThan(400);
    expect(muPHigh).toBeLessThan(100);
  });

  it('predicts realistic junction depth xj and sheet resistance Rs for CMOS implants', () => {
    const depthsA = Array.from({ length: 500 }, (_, i) => i * 20); // 0 .. 10000 A
    // 30 keV Boron -> Si (~1000 A Rp, ~380 A dRp), Dose = 1e15 cm^-2, Nb = 1e16 cm^-3
    const profile = evaluateGaussianProfile(depthsA, 1e15, 1000, 380);
    const res = predictJunctionAndSheetResistance({
      depthsA,
      concentrationCm3: profile,
      dopantType: 'p',
      backgroundDopingCm3: 1e16,
      activationEfficiency: 1.0,
      solidSolubilityCm3: 2e20,
      temperatureK: 300,
    });

    // At 1e16 background vs 1e20 peak, Gaussian tail reaches 1e16 around Rp + ~4.3*dRp ~ 2600 A = 260 nm
    expect(res.junctionDepthNm).toBeGreaterThan(220);
    expect(res.junctionDepthNm).toBeLessThan(310);

    // Typical p+ Boron 1e15 cm^-2 sheet resistance in Si is around 60 - 180 Ohm/sq
    expect(res.sheetResistanceOhmPerSq).toBeGreaterThan(50);
    expect(res.sheetResistanceOhmPerSq).toBeLessThan(200);
    expect(res.activeDoseCm2).toBeGreaterThan(9.5e14);

    // Higher dose deepens xj and lowers Rs
    const profileHigh = evaluateGaussianProfile(depthsA, 5e15, 1000, 380);
    const resHigh = predictJunctionAndSheetResistance({
      depthsA,
      concentrationCm3: profileHigh,
      dopantType: 'p',
      backgroundDopingCm3: 1e16,
      activationEfficiency: 1.0,
      solidSolubilityCm3: 2e20,
      temperatureK: 300,
    });
    expect(resHigh.junctionDepthNm).toBeGreaterThan(res.junctionDepthNm);
    expect(resHigh.sheetResistanceOhmPerSq).toBeLessThan(res.sheetResistanceOhmPerSq);
  });

  it('extracts benchmark Rp, straggling, Se, Sn across major semiconductor thin films', () => {
    const rows = computeThinFilmBenchmarks(5, 11.009, 50);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const r of rows) {
      expect(r.projectedRangeA).toBeGreaterThan(0);
      expect(r.longitudinalStraggleA).toBeGreaterThan(0);
      expect(r.lateralStraggleA).toBeGreaterThan(0);
      expect(r.masking999ThicknessNm).toBeGreaterThan(r.projectedRangeNm);
    }
  });
});
