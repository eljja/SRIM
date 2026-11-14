import { describe, it, expect } from 'vitest';
import {
  parseChemicalFormula,
  formatFormulaString,
  computeLayerAtomicDensity,
} from './formulaParser';

describe('Chemical Formula Parser & Layer Atomic Density', () => {
  it('parses standard semiconductor dielectrics (SiO2, Si3N4, HfO2, InGaZnO4)', () => {
    const sio2 = parseChemicalFormula('SiO2');
    expect(sio2).toEqual([
      { z: 14, symbol: 'Si', stoich: 1 },
      { z: 8, symbol: 'O', stoich: 2 },
    ]);

    const sin = parseChemicalFormula('Si3N4');
    expect(sin).toEqual([
      { z: 14, symbol: 'Si', stoich: 3 },
      { z: 7, symbol: 'N', stoich: 4 },
    ]);

    const igzo = parseChemicalFormula('InGaZnO4');
    expect(igzo).toEqual([
      { z: 49, symbol: 'In', stoich: 1 },
      { z: 31, symbol: 'Ga', stoich: 1 },
      { z: 30, symbol: 'Zn', stoich: 1 },
      { z: 8, symbol: 'O', stoich: 4 },
    ]);
  });

  it('parses fractional alloy and non-stoichiometric formulas (Si0.7Ge0.3, Hf0.5Zr0.5O2, Al0.25Ga0.75N)', () => {
    const sige = parseChemicalFormula('Si0.7Ge0.3');
    expect(sige).toEqual([
      { z: 14, symbol: 'Si', stoich: 0.7 },
      { z: 32, symbol: 'Ge', stoich: 0.3 },
    ]);

    const hzo = parseChemicalFormula('Hf0.5Zr0.5O2');
    expect(hzo).toEqual([
      { z: 72, symbol: 'Hf', stoich: 0.5 },
      { z: 40, symbol: 'Zr', stoich: 0.5 },
      { z: 8, symbol: 'O', stoich: 2 },
    ]);

    const algan = parseChemicalFormula('Al0.25Ga0.75N');
    expect(algan).toEqual([
      { z: 13, symbol: 'Al', stoich: 0.25 },
      { z: 31, symbol: 'Ga', stoich: 0.75 },
      { z: 7, symbol: 'N', stoich: 1 },
    ]);
  });

  it('handles parentheses and combines duplicate elements', () => {
    const mixedOxide = parseChemicalFormula('(SiO2)0.8(GeO2)0.2');
    expect(mixedOxide).not.toBeNull();
    expect(mixedOxide!.find((e) => e.symbol === 'Si')?.stoich).toBeCloseTo(0.8, 6);
    expect(mixedOxide!.find((e) => e.symbol === 'Ge')?.stoich).toBeCloseTo(0.2, 6);
    expect(mixedOxide!.find((e) => e.symbol === 'O')?.stoich).toBeCloseTo(2.0, 6);
  });

  it('returns null for malformed formulas or unknown elements', () => {
    expect(parseChemicalFormula('')).toBeNull();
    expect(parseChemicalFormula('XxO2')).toBeNull();
    expect(parseChemicalFormula('Si(O2')).toBeNull();
    expect(parseChemicalFormula('123')).toBeNull();
  });

  it('formats normalized empirical formula strings and computes physical atomic density', () => {
    expect(
      formatFormulaString([
        { symbol: 'Si', stoich: 1 },
        { symbol: 'O', stoich: 2 },
      ])
    ).toBe('SiO2');

    // c-Si: density 2.329 g/cm3, M = 28.0855 -> ~4.99e22 atoms/cm3
    const siDensity = computeLayerAtomicDensity(2.329, [
      { stoich: 1, massAmu: 28.0855 },
    ]);
    expect(siDensity).toBeGreaterThan(4.9e22);
    expect(siDensity).toBeLessThan(5.1e22);

    // Thermal SiO2: density 2.20 g/cm3, Si(28.086) + 2*O(15.999) = 60.084 g/mol formula unit -> 3 atoms/unit -> ~6.61e22 atoms/cm3
    const sio2Density = computeLayerAtomicDensity(2.2, [
      { stoich: 1, massAmu: 28.086 },
      { stoich: 2, massAmu: 15.999 },
    ]);
    expect(sio2Density).toBeGreaterThan(6.5e22);
    expect(sio2Density).toBeLessThan(6.75e22);
  });
});
