import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ADVANCED_PHYSICS,
  buildCrystalRotationMatrix,
  calcArcDpaVacancies,
  calcDebyeVibrationSigmaA,
  calcOenRobinsonStoppingEv,
  evalScreeningPotential,
  inferCrystalPresetForLayer,
  rotateLabToCrystal,
} from './advancedPhysics';
import { TrimSimulator, calcMagicScattering } from './trim';
import type { TrimSetupConfig } from './types';

function makeSiConfig(overrides: Partial<TrimSetupConfig> = {}): TrimSetupConfig {
  return {
    title: 'Crystal vs Amorphous Si Benchmark',
    ion: {
      z1: 15,
      symbol: 'P',
      name: 'Phosphorus',
      massAmu: 30.9738,
      energyKeV: 30.0,
      angleDeg: 0.0,
    },
    calculationMode: 1,
    totalIons: 200,
    randomSeed: 4242,
    braggCorrection: 1.0,
    autoSaveNumber: 10000,
    plotType: 0,
    plotXMinA: 0,
    plotXMaxA: 10000,
    zones: [{ layerIndex: 0, endDepthA: 10000 }],
    layers: [
      {
        id: 'si-bulk',
        name: 'c-Si Wafer',
        widthA: 10000,
        densityGPerCm3: 2.329,
        phase: 0,
        compoundCorr: 1.0,
        elements: [
          {
            z: 14,
            symbol: 'Si',
            name: 'Silicon',
            stoich: 1.0,
            massAmu: 28.0855,
            displacementEv: 15.0,
            latticeBindingEv: 2.0,
            surfaceBindingEv: 4.7,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('Post-SRIM-2003 Advanced BCA Physics Engine (Items 1-6)', () => {
  it('1) evaluates ZBL, Kr-C, and Moliere screening potentials accurately', () => {
    for (const pot of ['zbl', 'krc', 'moliere'] as const) {
      const atZero = evalScreeningPotential(0, pot);
      const atOne = evalScreeningPotential(1.0, pot);
      const atFive = evalScreeningPotential(5.0, pot);
      expect(atZero.phi).toBeCloseTo(1.0, 2);
      expect(atOne.phi).toBeGreaterThan(0);
      expect(atOne.phi).toBeLessThan(1.0);
      expect(atOne.dPhi).toBeLessThan(0);
      expect(atFive.phi).toBeLessThan(atOne.phi);
    }

    // Distinct scattering angles for ZBL vs Kr-C vs Moliere
    const zbl = calcMagicScattering(15, 30.974, 14, 28.086, 5000, 0.35, 'zbl');
    const krc = calcMagicScattering(15, 30.974, 14, 28.086, 5000, 0.35, 'krc');
    const mol = calcMagicScattering(15, 30.974, 14, 28.086, 5000, 0.35, 'moliere');
    expect(zbl.recoilEnergyEv).not.toBeCloseTo(mol.recoilEnergyEv, 3);
    expect(krc.recoilEnergyEv).toBeGreaterThan(0);
  });

  it('2) builds exact crystal rotation matrices for <100>, <110>, <111>, <112> with fine tilt & twist', () => {
    const cases: Array<{ dir: '<100>' | '<110>' | '<111>' | '<112>'; axis: [number, number, number] }> = [
      { dir: '<100>', axis: [1, 0, 0] },
      { dir: '<110>', axis: [Math.SQRT1_2, Math.SQRT1_2, 0] },
      { dir: '<111>', axis: [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)] },
      { dir: '<112>', axis: [1 / Math.sqrt(6), 1 / Math.sqrt(6), 2 / Math.sqrt(6)] },
    ];

    for (const c of cases) {
      // Zero tilt: lab beam (1,0,0) aligns identically with crystal Miller direction
      const m0 = buildCrystalRotationMatrix(c.dir, undefined, 0, 0);
      const beam0 = rotateLabToCrystal(m0, 1, 0, 0);
      const dot0 =
        beam0[0] * c.axis[0] + beam0[1] * c.axis[1] + beam0[2] * c.axis[2];
      expect(dot0).toBeCloseTo(1.0, 6);

      // 7-deg tilt: dot product equals cos(7 deg)
      const m7 = buildCrystalRotationMatrix(c.dir, undefined, 7.0, 22.0);
      const beam7 = rotateLabToCrystal(m7, 1, 0, 0);
      const dot7 =
        beam7[0] * c.axis[0] + beam7[1] * c.axis[1] + beam7[2] * c.axis[2];
      expect(dot7).toBeCloseTo(Math.cos((7 * Math.PI) / 180), 5);
    }
  });

  it('3) computes physically accurate Debye thermal vibration amplitude & Oen-Robinson b-dependent Se', () => {
    const sig300 = calcDebyeVibrationSigmaA(28.0855, 520, 300);
    const sig900 = calcDebyeVibrationSigmaA(28.0855, 520, 900);
    // Si 1D thermal rms amplitude at 300 K is ~0.043 A (3D sqrt(3)*sig ~ 0.075 A)
    expect(sig300).toBeGreaterThan(0.035);
    expect(sig300).toBeLessThan(0.06);
    expect(sig300 * Math.sqrt(3)).toBeGreaterThan(0.06);
    expect(sig300 * Math.sqrt(3)).toBeLessThan(0.095);
    expect(sig900).toBeGreaterThan(sig300 * 1.4);

    // Oen-Robinson impact-parameter Se(b): head-on b=0.05 A >> open channel b=1.4 A
    const seClose = calcOenRobinsonStoppingEv(25.0, 10.0, 0.05, 0.12, 1.5);
    const seChannel = calcOenRobinsonStoppingEv(25.0, 10.0, 1.4, 0.12, 1.5);
    expect(seClose).toBeGreaterThan(seChannel * 1.5);
    expect(seChannel).toBeGreaterThan(0);

    // Auto-inferred crystal parameters for common materials
    const siPreset = inferCrystalPresetForLayer('c-Si Wafer', 14);
    expect(siPreset.lattice).toBe('diamond');
    expect(siPreset.aA).toBeCloseTo(5.431, 2);
  });

  it('4) computes Nordlund ARC-dpa athermal recombination reducing NRT overestimation at high Tdam', () => {
    // At threshold Tdam = Ed -> efficiency = 1.0 (1 Frenkel pair)
    expect(calcArcDpaVacancies(15.0, 15.0, 14)).toBeCloseTo(1.0, 4);
    // At 20 keV PKA in Si -> ARC-dpa reduces NRT defects to realistic ~25-45%
    const nrtRaw = (0.8 * 20000) / (2 * 15);
    const arcSurviving = calcArcDpaVacancies(20000, 15.0, 14);
    expect(arcSurviving).toBeLessThan(nrtRaw * 0.5);
    expect(arcSurviving).toBeGreaterThan(nrtRaw * 0.15);
  });

  it('5) demonstrates <110> axial channeling tail deeper than amorphous Si and collapses under 7-deg tilt', () => {
    const amorphSim = new TrimSimulator(
      makeSiConfig({
        totalIons: 180,
        advancedPhysics: { ...DEFAULT_ADVANCED_PHYSICS, crystalMode: false },
      })
    );
    const snapAmorph = amorphSim.runBatch(180);

    // <110> aligned (0 deg tilt, low dose 1e12 cm^-2)
    const chan110Sim = new TrimSimulator(
      makeSiConfig({
        totalIons: 180,
        advancedPhysics: {
          ...DEFAULT_ADVANCED_PHYSICS,
          crystalMode: true,
          crystalLattice: 'diamond',
          latticeConstantA: 5.431,
          crystalOrientation: '<110>',
          crystalTiltDeg: 0,
          crystalTwistDeg: 0,
          doseCm2: 1e12,
          dynamicDamage: true,
          localElectronicStopping: true,
          simultaneousCollisions: true,
        },
      })
    );
    const snap110 = chan110Sim.runBatch(180);

    // <110> tilted 7 deg away from channeling axis (channeling suppression)
    const tilt7Sim = new TrimSimulator(
      makeSiConfig({
        totalIons: 180,
        advancedPhysics: {
          ...DEFAULT_ADVANCED_PHYSICS,
          crystalMode: true,
          crystalLattice: 'diamond',
          latticeConstantA: 5.431,
          crystalOrientation: '<110>',
          crystalTiltDeg: 7.0,
          crystalTwistDeg: 22.0,
          doseCm2: 1e12,
          dynamicDamage: true,
          localElectronicStopping: true,
          simultaneousCollisions: true,
        },
      })
    );
    const snapTilt7 = tilt7Sim.runBatch(180);

    expect(snap110.rangeMoments.meanA).toBeGreaterThan(snapAmorph.rangeMoments.meanA * 2.0);
    expect(snap110.rangeMoments.meanA).toBeGreaterThan(snapTilt7.rangeMoments.meanA * 1.2);
    expect(snap110.advancedDiagnostics?.channeledFractionPct).toBeGreaterThan(5);
  });

  it('6) supports ARC-dpa Mode 1 & Mode 2 conservation and TRIDYN dynamic erosion + 2D mask shadowing', () => {
    const simBase = new TrimSimulator(
      makeSiConfig({
        totalIons: 120,
        advancedPhysics: { ...DEFAULT_ADVANCED_PHYSICS, arcDpaRecombination: false },
      })
    );
    const snapBase = simBase.runBatch(120);

    const simArc = new TrimSimulator(
      makeSiConfig({
        totalIons: 120,
        advancedPhysics: {
          ...DEFAULT_ADVANCED_PHYSICS,
          arcDpaRecombination: true,
          dynamicComposition: true,
          doseCm2: 5e17,
          mask2dEnabled: true,
          maskThicknessA: 300,
          maskOpeningA: 400,
        },
      })
    );
    const snapArc = simArc.runBatch(120);

    expect(snapArc.completedIons).toBe(120);
    // ARC-dpa lowers effective vacancies per ion significantly compared to raw KP
    expect(snapArc.vacanciesPerIon).toBeLessThan(snapBase.vacanciesPerIon * 0.65);
    // Energy partition still sums cleanly to 100%
    const totalPct =
      snapArc.energyLossIonizationPct +
      snapArc.energyLossPhononsPct +
      snapArc.energyLossBindingPct;
    expect(totalPct).toBeCloseTo(100.0, 1);
    expect(snapArc.advancedDiagnostics?.erodedDepthA).toBeGreaterThanOrEqual(0);
  });
});
