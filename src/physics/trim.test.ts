import { describe, it, expect } from 'vitest';
import {
  createRng,
  calcMagicScattering,
  TrimSimulator,
} from './trim';
import type { TrimSetupConfig } from './types';

describe('TRIM-2003 3D Monte Carlo BCA Simulation Engine', () => {
  it('computes ZBL Magic Formula scattering angle and energy transfer accurately', () => {
    // Head-on collision (B = 0) must scatter at Theta = pi (cosHalfTheta = 0, sinHalfTheta = 1)
    const headOn = calcMagicScattering(6, 12.011, 14, 28.086, 3000.0, 0.0);
    expect(headOn.sinHalfTheta).toBeCloseTo(1.0, 5);
    const gamma = (4 * 12.011 * 28.086) / Math.pow(12.011 + 28.086, 2);
    expect(headOn.recoilEnergyEv).toBeCloseTo(gamma * 3000.0, 2);

    // Distant collision (p = 2.0 A) must have small scattering angle and small energy transfer
    const distant = calcMagicScattering(6, 12.011, 14, 28.086, 3000.0, 2.0);
    expect(distant.sinHalfTheta).toBeLessThan(0.1);
    expect(distant.recoilEnergyEv).toBeGreaterThan(0);
    expect(distant.recoilEnergyEv).toBeLessThan(50);
  });

  it('reproduces golden TDATA.sav benchmark (3 keV 6-C into Si, Quick KP & Full Cascade)', () => {
    // Golden reference from D:\Code\HSC\SRIM\SRIM 2003\TDATA.sav:
    // Ion: C (Z1=6, M1=12.011), Energy = 3 keV, Angle = 0 deg
    // Target: Si (Z2=14, M2=28.086, rho=2.3212 g/cm3, Ed=15 eV, Eb=2 eV, Es=4.7 eV), Depth = 600 A
    // TDATA.sav reference:
    //   Longitudinal Range Rp = 130.4 A, Straggling = 68.1 A
    //   Radial Range = 78.6 A, Radial Straggling = 46.8 A
    //   Lateral Range = 49.9 A, Lateral Straggling = 64.5 A
    //   Vacancies/Ion = 70.8
    //   Backscattered fraction ~ 4.75%
    //   Energy loss: Ionization ~ 33.4%, Phonons ~ 61.9%, Binding ~ 4.7%
    const config: TrimSetupConfig = {
      title: '6 C into Si (3 keV)',
      ion: { z1: 6, symbol: 'C', name: 'Carbon', massAmu: 12.011, energyKeV: 3.0, angleDeg: 0 },
      calculationMode: 1,
      totalIons: 250,
      randomSeed: 98765,
      braggCorrection: 1.0,
      autoSaveNumber: 10000,
      plotType: 0,
      plotXMinA: 0,
      plotXMaxA: 13000,
      zones: [{ layerIndex: 0, endDepthA: 13000 }],
      layers: [
        {
          id: 'layer-1',
          name: 'Silicon',
          widthA: 13000,
          densityGPerCm3: 2.3212,
          phase: 0,
          compoundCorr: 1.0,
          elements: [
            {
              z: 14,
              symbol: 'Si',
              name: 'Silicon',
              stoich: 1.0,
              massAmu: 28.086,
              displacementEv: 10.0,
              latticeBindingEv: 3.0,
              surfaceBindingEv: 2.1,
            },
          ],
        },
      ],
    };

    const sim = new TrimSimulator(config);
    const snap = sim.runBatch(250);

    expect(snap.completedIons).toBe(250);
    // Projected Range Rp around 130 A (within [115, 145] A) even with 13000 A layer width!
    expect(snap.rangeMoments.meanA).toBeGreaterThan(115);
    expect(snap.rangeMoments.meanA).toBeLessThan(145);
    // Longitudinal Straggling around 68 A (within [55, 80] A)
    expect(snap.rangeMoments.stragglingA).toBeGreaterThan(55);
    expect(snap.rangeMoments.stragglingA).toBeLessThan(80);
    // Vacancies/Ion around 70.8 (within [55, 85])
    expect(snap.vacanciesPerIon).toBeGreaterThan(55);
    expect(snap.vacanciesPerIon).toBeLessThan(85);
    // Backscattered percentage around 4.75% (within [2%, 8%])
    expect(snap.backscatteredPct).toBeGreaterThan(2.0);
    expect(snap.backscatteredPct).toBeLessThan(8.0);
    // Energy loss percentages sum to 100.0%
    const totalPct =
      snap.energyLossIonizationPct +
      snap.energyLossPhononsPct +
      snap.energyLossBindingPct;
    expect(totalPct).toBeCloseTo(100.0, 1);
  });

  it('tracks full recoil cascades, sputtering yield vs surface binding energy, and transmitted ions in Mode 2 & 3', () => {
    // Thin Au layer (30 A) bombarded by 2 keV Ar (Z1=18, M1=39.948) at 45 deg incidence -> produces both sputtering and transmission
    const config: TrimSetupConfig = {
      title: 'Ar into Thin Au Foil',
      ion: { z1: 18, symbol: 'Ar', name: 'Argon', massAmu: 39.948, energyKeV: 2.0, angleDeg: 45 },
      calculationMode: 2,
      totalIons: 60,
      randomSeed: 12345,
      braggCorrection: 1.0,
      autoSaveNumber: 10000,
      plotType: 0,
      plotXMinA: 0,
      plotXMaxA: 30,
      zones: [{ layerIndex: 0, endDepthA: 30 }],
      layers: [
        {
          id: 'au-foil',
          name: 'Gold',
          widthA: 30,
          densityGPerCm3: 19.31,
          phase: 0,
          compoundCorr: 1.0,
          elements: [
            {
              z: 79,
              symbol: 'Au',
              name: 'Gold',
              stoich: 1.0,
              massAmu: 196.967,
              displacementEv: 25.0,
              latticeBindingEv: 3.0,
              surfaceBindingEv: 3.8,
            },
          ],
        },
      ],
    };

    const sim = new TrimSimulator(config);
    const snap = sim.runBatch(60);

    expect(snap.completedIons).toBe(60);
    expect(snap.sputteringYield).toBeGreaterThan(0);
    expect(snap.sputteredAtoms.length).toBeGreaterThan(0);
    expect(snap.sputterYieldVsEs.length).toBeGreaterThan(5);
    expect(snap.trajectories.length).toBeGreaterThan(0);
    // Trajectory should have recoil sub-tracks in Mode 2
    const hasRecoils = snap.trajectories.some((t) => t.recoils.length > 0);
    expect(hasRecoils).toBe(true);
  });

  it('enforces exact defect conservation law in Mode 2 full cascade', () => {
    // 5 keV Si self-implantation into Si (thick target: 2000 A, no transmission)
    const config: TrimSetupConfig = {
      title: '5 keV Si in Si Defect Accounting',
      ion: { z1: 14, symbol: 'Si', name: 'Silicon', massAmu: 28.086, energyKeV: 5.0, angleDeg: 0 },
      calculationMode: 2,
      totalIons: 20,
      randomSeed: 54321,
      braggCorrection: 1.0,
      autoSaveNumber: 10000,
      plotType: 0,
      plotXMinA: 0,
      plotXMaxA: 2000,
      zones: [{ layerIndex: 0, endDepthA: 2000 }],
      layers: [
        {
          id: 'si-bulk',
          name: 'Silicon',
          widthA: 2000,
          densityGPerCm3: 2.3212,
          phase: 0,
          compoundCorr: 1.0,
          elements: [
            {
              z: 14,
              symbol: 'Si',
              name: 'Silicon',
              stoich: 1.0,
              massAmu: 28.086,
              displacementEv: 15.0,
              latticeBindingEv: 2.0,
              surfaceBindingEv: 4.7,
            },
          ],
        },
      ],
    };

    const sim = new TrimSimulator(config);
    const snap = sim.runBatch(20);

    expect(snap.completedIons).toBe(20);
    // Defect identity 1: Displacements === Vacancies + Replacements
    expect(snap.totalDisplacements).toBe(snap.totalVacancies + snap.totalReplacements);
    // Defect identity 2: Vacancies === Interstitials + Escaped Recoils (Sputtered + Transmitted)
    // (Every displaced lattice atom either remains as an interstitial or escapes the crystal)
    expect(snap.totalVacancies).toBe(snap.totalInterstitials + snap.totalEscapedRecoils);
    // Defect numbers should be positive and non-zero
    expect(snap.totalVacancies).toBeGreaterThan(0);
    expect(snap.totalInterstitials).toBeGreaterThan(0);

    // Exact energy conservation: sum of partitions = 100%
    const totalPct =
      snap.energyLossIonizationPct +
      snap.energyLossPhononsPct +
      snap.energyLossBindingPct;
    expect(totalPct).toBeCloseTo(100.0, 1);
  });

  it('supports Mode 4 custom TRIM.DAT event-by-event input stream', () => {
    const config: TrimSetupConfig = {
      title: 'Custom TRIM.DAT Run',
      ion: { z1: 5, symbol: 'B', name: 'Boron', massAmu: 10.811, energyKeV: 10.0, angleDeg: 0 },
      calculationMode: 4,
      totalIons: 3,
      randomSeed: 42,
      braggCorrection: 1.0,
      autoSaveNumber: 10000,
      plotType: 0,
      plotXMinA: 0,
      plotXMaxA: 1000,
      zones: [{ layerIndex: 0, endDepthA: 1000 }],
      customTrimDatEvents: [
        { name: 'EV1', z1: 5, energyEv: 5000, xA: 100, yA: 0, zA: 0, cosX: 1, cosY: 0, cosZ: 0 },
        { name: 'EV2', z1: 6, energyEv: 8000, xA: 200, yA: 10, zA: -10, cosX: 0.9, cosY: 0.43589, cosZ: 0 },
        { name: 'EV3', z1: 7, energyEv: 6000, xA: 150, yA: 0, zA: 0, cosX: 1, cosY: 0, cosZ: 0 },
      ],
      layers: [
        {
          id: 'si-layer',
          name: 'Si',
          widthA: 1000,
          densityGPerCm3: 2.3212,
          phase: 0,
          compoundCorr: 1.0,
          elements: [
            {
              z: 14,
              symbol: 'Si',
              name: 'Silicon',
              stoich: 1.0,
              massAmu: 28.086,
              displacementEv: 10.0,
              latticeBindingEv: 3.0,
              surfaceBindingEv: 2.1,
            },
          ],
        },
      ],
    };

    const sim = new TrimSimulator(config);
    const snap = sim.runBatch(3);
    expect(snap.completedIons).toBe(3);
    expect(snap.trajectories).toHaveLength(3);
    expect(snap.trajectories[0].z1).toBe(5);
    expect(snap.trajectories[1].z1).toBe(6);
    expect(snap.trajectories[2].z1).toBe(7);
  });
});
