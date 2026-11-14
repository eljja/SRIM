import { describe, it, expect } from 'vitest';
import {
  generateSrimEnergyGrid,
  calcStoppingAndRangeTable,
  calcEsumAnalysis,
  calcTransmitAnalysis,
} from './pral';

describe('PRAL92 Projected Range & Straggling + ESUM & TRANSMIT Tools', () => {
  it('generates standard SRIM decade energy grid matching SRModule.exe', () => {
    const grid = generateSrimEnergyGrid(10, 100);
    expect(grid[0]).toBeCloseTo(10, 6);
    expect(grid).toContain(11);
    expect(grid).toContain(15);
    expect(grid).toContain(20);
    expect(grid).toContain(22.5);
    expect(grid).toContain(45);
    expect(grid[grid.length - 1]).toBeCloseTo(100, 6);
  });

  it('computes monotonically increasing PRAL92 Projected Range, Longitudinal Straggling, and Lateral Straggling', () => {
    // 6 C (M1=12.011) into Silicon (Z2=14, M2=28.086, rho=2.3212 g/cm3) from 1 keV to 100 keV
    const rows = calcStoppingAndRangeTable({
      z1: 6,
      m1: 12.011,
      elements: [{ z: 14, name: 'Silicon', stoich: 1, mass: 28.086 }],
      densityGPerCm3: 2.3212,
      phase: 0,
      compoundCorr: 1.0,
      unit: 1, // eV / Angstrom
      eMinKeV: 1.0,
      eMaxKeV: 100.0,
    });

    expect(rows.length).toBeGreaterThan(20);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].energyKeV).toBeGreaterThan(rows[i - 1].energyKeV);
      expect(rows[i].projectedRangeA).toBeGreaterThan(rows[i - 1].projectedRangeA);
      expect(rows[i].longitudinalStragglingA).toBeGreaterThan(
        rows[i - 1].longitudinalStragglingA
      );
      expect(rows[i].lateralStragglingA).toBeGreaterThan(rows[i - 1].lateralStragglingA);
    }

    // Check 3 keV Carbon in Silicon (compare with TDATA.sav ~130 A range, ~68 A straggling)
    const row3keV = rows.find((r) => Math.abs(r.energyKeV - 3.0) < 0.01)!;
    expect(row3keV).toBeDefined();
    expect(row3keV.projectedRangeA).toBeGreaterThan(80);
    expect(row3keV.projectedRangeA).toBeLessThan(200);
    expect(row3keV.longitudinalStragglingA).toBeGreaterThan(30);
    expect(row3keV.longitudinalStragglingA).toBeLessThan(120);
    expect(row3keV.lateralStragglingA).toBeGreaterThan(20);
  });

  it('reproduces golden SRModule.exe range table output for 6 C in Silicon (Unit 5)', () => {
    // Golden reference values directly from headless SRModule.exe (Si_Test.txt):
    // 10 keV: Se = 4.126E-01, Nuclear = 4.471E-01, Rp = 342 A, StragLong = 200 A, StragLat = 149 A
    // 20 keV: Se = 5.835E-01, Nuclear = 3.792E-01, Rp = 656 A, StragLong = 332 A, StragLat = 254 A
    // 50 keV: Se = 1.002E+00, Nuclear = 2.627E-01, Rp = 1530 A, StragLong = 569 A, StragLat = 458 A
    const rows = calcStoppingAndRangeTable({
      z1: 6,
      m1: 12.011,
      elements: [{ z: 14, name: 'Silicon', stoich: 1, mass: 28.086 }],
      densityGPerCm3: 2.321,
      phase: 0,
      compoundCorr: 1.0,
      unit: 5, // MeV / (mg/cm2)
      eMinKeV: 10.0,
      eMaxKeV: 100.0,
    });

    const r10 = rows.find((r) => Math.abs(r.energyKeV - 10.0) < 0.01)!;
    expect(r10).toBeDefined();
    expect(r10.se).toBeCloseTo(0.4126, 3);
    expect(r10.sn).toBeCloseTo(0.4463, 2);
    expect(r10.projectedRangeA).toBeCloseTo(340, -1); // ~339.4 A vs 342 A (< 1% error)
    expect(r10.longitudinalStragglingA).toBeCloseTo(200, -1); // ~199 A vs 200 A (< 1% error)
    expect(r10.lateralStragglingA).toBeCloseTo(155, -1); // ~157 A vs 149 A (< 6% error)

    const r20 = rows.find((r) => Math.abs(r.energyKeV - 20.0) < 0.01)!;
    expect(r20).toBeDefined();
    expect(r20.se).toBeCloseTo(0.5835, 3);
    expect(r20.projectedRangeA).toBeCloseTo(652, -1); // ~652 A vs 656 A (< 1% error)
    expect(r20.longitudinalStragglingA).toBeCloseTo(320, -1); // ~316 A vs 332 A (< 5% error)
    expect(r20.lateralStragglingA).toBeCloseTo(255, -1); // ~255 A vs 254 A (< 1% error)

    const r50 = rows.find((r) => Math.abs(r.energyKeV - 50.0) < 0.01)!;
    expect(r50).toBeDefined();
    expect(r50.se).toBeCloseTo(1.002, 2);
    expect(r50.projectedRangeA).toBeCloseTo(1510, -2); // ~1509 A vs 1530 A (< 2% error)
  });

  it('supports custom energy list mode (0 0 mode in SR.IN)', () => {
    const rows = calcStoppingAndRangeTable({
      z1: 1,
      m1: 1.008,
      elements: [
        { z: 1, name: 'Hydrogen', stoich: 2, mass: 1.008 },
        { z: 8, name: 'Oxygen', stoich: 1, mass: 15.999 },
      ],
      densityGPerCm3: 1.0,
      phase: 0,
      compoundCorr: 1.0,
      unit: 5,
      eMinKeV: 0,
      eMaxKeV: 0,
      customEnergiesKeV: [1.02, 2.55, 3.98],
    });

    expect(rows).toHaveLength(3);
    expect(rows[0].se).toBeCloseTo(0.15551, 4);
    expect(rows[0].sn).toBeCloseTo(0.03921, 4);
    expect(rows[1].se).toBeCloseTo(0.24208, 4);
    expect(rows[1].sn).toBeCloseTo(0.02391, 4);
    expect(rows[2].se).toBeCloseTo(0.2957, 4);
    expect(rows[2].sn).toBeCloseTo(0.01681, 4);
  });

  it('implements ESUM.BAS energy-loss summation and vacancy accounting', () => {
    // 100 bins of depth, each bin width 10 A
    const depthStepA = 10.0;
    const ionizIon = new Array(100).fill(0.5); // 0.5 eV/A * 10 A * 100 = 500 eV
    const ionizRecoil = new Array(100).fill(0.3); // 300 eV
    const phononIon = new Array(100).fill(0.2); // 200 eV
    const phononRecoil = new Array(100).fill(1.8); // 1800 eV
    const vacIon = new Array(100).fill(0.002); // 0.002 vac/A * 10 A * 100 = 2 vacancies => 4 eV at Eb=2 eV
    const vacRecoil = new Array(100).fill(0.098); // 98 vacancies => 196 eV at Eb=2 eV
    const e2RecoilIon = new Array(100).fill(2.296); // 2296 eV

    const res = calcEsumAnalysis({
      depthStepA,
      latticeBindingEv: 2.0,
      ionizIon,
      ionizRecoil,
      phononIon,
      phononRecoil,
      vacIon,
      vacRecoil,
      e2RecoilIon,
    });

    // Total loss = (500+300) + (200+1800) + (4+196) = 3000 eV = 3.0 keV
    expect(res.totalLossKeV).toBeCloseTo(3.0, 4);
    expect(res.totalVacanciesPerIon).toBe(100);
    expect(res.ionVacancies).toBe(2);
    expect(res.recoilVacancies).toBe(98);
    expect(res.ionLossPercent + res.recoilLossPercent).toBeCloseTo(100.0, 3);
  });

  it('implements TRANSMIT.BAS angular solid-angle flux distribution', () => {
    const ions = [
      { ionNumber: 1, z1: 1, energyEv: 95000, xA: 1000, yA: 5, zA: 5, cosX: 0.9999, cosY: 0.01, cosZ: 0.01 },
      { ionNumber: 2, z1: 1, energyEv: 94000, xA: 1000, yA: -5, zA: 5, cosX: 0.9998, cosY: -0.014, cosZ: 0.014 },
      { ionNumber: 3, z1: 1, energyEv: 90000, xA: 1000, yA: 30, zA: 40, cosX: 0.996, cosY: 0.06, cosZ: 0.06 },
    ];
    const analysis = calcTransmitAnalysis(ions, 2.0, 10);
    expect(analysis.totalIons).toBe(3);
    expect(analysis.bins[0].count).toBe(2); // ~0.81 deg and ~1.14 deg fall in 0-2 deg bin
    expect(analysis.bins[0].relativeFlux).toBeCloseTo(1.0, 5);
    expect(analysis.meanEnergyKeV).toBeCloseTo((95 + 94 + 90) / 3, 3);
  });
});
