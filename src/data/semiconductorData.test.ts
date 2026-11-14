import { describe, it, expect } from 'vitest';
import { SEMICONDUCTOR_MATERIALS } from './semiconductorMaterials';
import { SEMICONDUCTOR_PRESETS } from './semiconductorPresets';
import { parseChemicalFormula } from '../physics/formulaParser';
import { generateTrimIn, parseTrimIn } from '../physics/formats';

describe('Semiconductor Thin-Film Library & Implantation Presets', () => {
  it('contains >= 40 semiconductor thin-film materials with valid formulas, densities, and damage thresholds', () => {
    expect(SEMICONDUCTOR_MATERIALS.length).toBeGreaterThanOrEqual(40);

    const names = SEMICONDUCTOR_MATERIALS.map((m) => m.name.toLowerCase()).join(' | ');
    for (const required of ['sio2', 'si3n4', 'hfo2', 'al2o3', 'tin', 'tan', 'sige', 'sic', 'gan', 'gaas', 'inp', 'igzo', 'ito', 'sicoh', 'nisi', 'cosi2']) {
      expect(names).toContain(required);
    }

    for (const mat of SEMICONDUCTOR_MATERIALS) {
      expect(mat.id.length).toBeGreaterThan(0);
      expect(mat.name.length).toBeGreaterThan(0);
      expect(mat.densityGPerCm3).toBeGreaterThan(0.1);
      expect(mat.elements.length).toBeGreaterThan(0);

      // Verify formula parses cleanly and matches declared stoichiometry
      const parsed = parseChemicalFormula(mat.formula);
      expect(parsed).not.toBeNull();
      expect(parsed!.length).toBe(mat.elements.length);

      for (const el of mat.elements) {
        expect(el.z).toBeGreaterThanOrEqual(1);
        expect(el.z).toBeLessThanOrEqual(92);
        expect(el.stoich).toBeGreaterThan(0);
        expect(el.massAmu).toBeGreaterThan(0.5);
        expect(el.displacementEv).toBeGreaterThan(0);
        expect(el.latticeBindingEv).toBeGreaterThanOrEqual(0);
        expect(el.surfaceBindingEv).toBeGreaterThan(0);
      }
    }
  });

  it('contains >= 16 realistic semiconductor & materials implantation presets that roundtrip TRIM.IN', () => {
    expect(SEMICONDUCTOR_PRESETS.length).toBeGreaterThanOrEqual(16);

    const categories = new Set(SEMICONDUCTOR_PRESETS.map((p) => p.category));
    expect(categories.size).toBeGreaterThanOrEqual(4);

    for (const preset of SEMICONDUCTOR_PRESETS) {
      const cfg = preset.config;
      expect(cfg.ion.z1).toBeGreaterThanOrEqual(1);
      expect(cfg.ion.energyKeV).toBeGreaterThan(0);
      expect(cfg.layers.length).toBeGreaterThanOrEqual(1);
      expect(cfg.zones.length).toBe(cfg.layers.length);
      expect(cfg.plotXMaxA).toBeGreaterThan(0);

      // Verify TRIM.IN serialization roundtrip
      const trimIn = generateTrimIn(cfg);
      const reparsed = parseTrimIn(trimIn);
      expect(reparsed.ion.z1).toBe(cfg.ion.z1);
      expect(reparsed.ion.energyKeV).toBeCloseTo(cfg.ion.energyKeV, 3);
      expect(reparsed.layers.length).toBe(cfg.layers.length);
      expect(reparsed.calculationMode).toBe(cfg.calculationMode);
    }
  });
});
