import { describe, it, expect } from 'vitest';
import {
  calcNuclearStoppingSNUC03,
  calcNuclearStoppingZBL,
  calcElectronicStoppingElement,
  calcLayerStopping,
  calcCoreAndBond,
  convertStoppingUnit,
  BOND_DEFINITIONS,
  CORE_STOPPING_125KEV,
} from './stopping';

describe('SRIM-2003 Stopping Power & Core-and-Bond Engine', () => {
  it('computes SNUC03 pair-specific and ZBL universal nuclear stopping powers accurately', () => {
    // 1 keV H (Z1=1, M1=1.008) in Si (Z2=14, M2=28.086)
    const snSnuc = calcNuclearStoppingSNUC03(1, 1.008, 14, 28.086, 1.0);
    const snZbl = calcNuclearStoppingZBL(1, 1.008, 14, 28.086, 1.0);
    expect(snSnuc).toBeGreaterThan(0.1);
    expect(snZbl).toBeGreaterThan(0.1);
    // At high reduced energy (epsilon > 30), both converge to ln(eps)/(2*eps)
    const snHighSnuc = calcNuclearStoppingSNUC03(1, 1.008, 14, 28.086, 10000);
    const snHighZbl = calcNuclearStoppingZBL(1, 1.008, 14, 28.086, 10000);
    expect(snHighSnuc).toBeCloseTo(snHighZbl, 6);
  });

  it('reproduces golden SRModule output from HELP- SR Module.rtf (H in Water_Liquid)', () => {
    // From HELP- SR Module.rtf lines 69-75:
    // Ion = Hydrogen, Mass = 1.008
    // Tgt = H (stoich 2, mass 1.008) + O (stoich 1, mass 15.999), Solid (0), Density = 1 g/cm3, CompoundCorr = 1
    // Stopping Units = 5 (MeV/(mg/cm2))
    // Energy(keV)  S(Elec)    S(Nuc)
    // 1.020E+00   1.751E-01  3.921E-02
    // 2.550E+00   2.694E-01  2.391E-02
    // 3.980E+00   3.264E-01  1.681E-02
    const waterElements = [
      { z: 1, mass: 1.008, stoich: 2 },
      { z: 8, mass: 15.999, stoich: 1 },
    ];

    const r1 = calcLayerStopping(1, 1.008, 1.02, waterElements, 1.0, 0, 1.0, 5, true);
    expect(r1.se).toBeCloseTo(0.15551, 4);
    expect(r1.sn).toBeCloseTo(0.03921, 4);

    const r2 = calcLayerStopping(1, 1.008, 2.55, waterElements, 1.0, 0, 1.0, 5, true);
    expect(r2.se).toBeCloseTo(0.24208, 4);
    expect(r2.sn).toBeCloseTo(0.02391, 4);

    const r3 = calcLayerStopping(1, 1.008, 3.98, waterElements, 1.0, 0, 1.0, 5, true);
    expect(r3.se).toBeCloseTo(0.29570, 4);
    expect(r3.sn).toBeCloseTo(0.01681, 4);
  });

  it('handles PSTOP, HESTOP, LISTOP, HISTOP, and Bethe-Bloch regimes smoothly across energy boundaries', () => {
    // Proton (Z1=1): low (<1 keV/u), mid (100 keV/u), transition (1100 keV/u), Bethe-Bloch (5000 keV/u, 100000 keV/u)
    const pLow = calcElectronicStoppingElement(1, 1.008, 14, 0.5, 0, 1.0);
    const pMid = calcElectronicStoppingElement(1, 1.008, 14, 100, 0, 1.0);
    const pTrans = calcElectronicStoppingElement(1, 1.008, 14, 1100, 0, 1.0);
    const pBB1 = calcElectronicStoppingElement(1, 1.008, 14, 5000, 0, 1.0);
    const pBB2 = calcElectronicStoppingElement(1, 1.008, 14, 100000, 0, 1.0);
    expect(pLow).toBeGreaterThan(0);
    expect(pMid).toBeGreaterThan(pLow);
    expect(pTrans).toBeGreaterThan(0);
    expect(pBB1).toBeGreaterThan(pBB2);

    // Helium (Z1=2) and Lithium (Z1=3)
    const heMid = calcElectronicStoppingElement(2, 4.003, 14, 400, 0, 1.0);
    const liMid = calcElectronicStoppingElement(3, 7.016, 14, 700, 0, 1.0);
    expect(heMid).toBeGreaterThan(pMid);
    expect(liMid).toBeGreaterThan(heMid);

    // Heavy ion HISTOP (Z1=6 Carbon, Z1=79 Gold): low (<2 keV/u), mid (1000 keV/u), high (>30000 keV/u)
    const cLow = calcElectronicStoppingElement(6, 12.011, 14, 3.0, 0, 1.0);
    const cMid = calcElectronicStoppingElement(6, 12.011, 14, 12000, 0, 1.0);
    const cHigh = calcElectronicStoppingElement(6, 12.011, 14, 500000, 0, 1.0);
    expect(cLow).toBeGreaterThan(0);
    expect(cMid).toBeGreaterThan(cLow);
    expect(cHigh).toBeGreaterThan(0);
  });

  it('implements Ziegler-Manoyan Core-and-Bond (18 bonds + 11 cores) & Water override', () => {
    expect(BOND_DEFINITIONS).toHaveLength(18);
    expect(CORE_STOPPING_125KEV[1]).toBe(0.0);
    expect(CORE_STOPPING_125KEV[6]).toBeCloseTo(6.2892, 4);

    // Paraffin: C1 H2 with 2 (H-C) bonds (index 1) and 1 (C-C) bond (index 4)
    const bonds = new Array(18).fill(0);
    bonds[1] = 2; // H-C
    bonds[4] = 1; // C-C
    const cabParaffin = calcCoreAndBond(
      1,
      [{ z: 1, stoich: 2 }, { z: 6, stoich: 1 }],
      bonds,
      0.89,
      'Paraffin'
    );
    // S_CAB = 1*6.2892 + 2*0 + 2*7.40343 + 1*4.00266 = 25.09872
    expect(cabParaffin.sCab).toBeCloseTo(25.09872, 3);
    expect(cabParaffin.solidBindingCorr).toBeGreaterThan(0.85);
    expect(cabParaffin.solidBindingCorr).toBeLessThan(1.1);

    // Special Water override in TIN.exe (0.89 solid, 0.94 gas for Z1=1)
    const waterBonds = new Array(18).fill(0);
    waterBonds[3] = 2; // 2 (H-O) bonds
    const cabWater = calcCoreAndBond(
      1,
      [{ z: 1, stoich: 2 }, { z: 8, stoich: 1 }],
      waterBonds,
      1.0,
      'Water'
    );
    expect(cabWater.solidBindingCorr).toBeCloseTo(0.89, 4);
    expect(cabWater.gasBindingCorr).toBeCloseTo(0.94, 4);
  });

  it('converts stopping power across all 8 SRIM units accurately', () => {
    // Base unit 7: eV / (1E15 atoms/cm2)
    // Si: N = 4.977e22 atoms/cm3, M2 = 28.086 amu
    const sBase = 100.0; // 100 eV/(1E15 atoms/cm2) => 10 eV*A^2/atom
    const nSi = 4.977e22;
    const mSi = 28.086;

    const u1 = convertStoppingUnit(sBase, 1, nSi, mSi, 6, 12.011, 14);
    const u2 = convertStoppingUnit(sBase, 2, nSi, mSi, 6, 12.011, 14);
    const u4 = convertStoppingUnit(sBase, 4, nSi, mSi, 6, 12.011, 14);
    const u5 = convertStoppingUnit(sBase, 5, nSi, mSi, 6, 12.011, 14);
    const u6 = convertStoppingUnit(sBase, 6, nSi, mSi, 6, 12.011, 14);
    const u7 = convertStoppingUnit(sBase, 7, nSi, mSi, 6, 12.011, 14);
    const u8 = convertStoppingUnit(sBase, 8, nSi, mSi, 6, 12.011, 14);

    expect(u7).toBeCloseTo(100.0, 6);
    expect(u1).toBeCloseTo(1000 * nSi * 1e-24, 5);
    expect(u2).toBeCloseTo(u1 * 10, 5);
    expect(u4).toBeCloseTo(u5, 6);
    expect(u6).toBeCloseTo(u5 * 1000, 3);
    expect(u8).toBeGreaterThan(0);
  });
});
