import { describe, it, expect } from 'vitest';
import {
  generateTrimIn,
  parseTrimIn,
  generateSrIn,
  parseSrIn,
  generateSimFile,
  parseSimFile,
  generateTrimDat,
  parseTrimDat,
  generateAllTrimOutputs,
  generateSrTableTxt,
} from './formats';
import { TrimSimulator } from './trim';
import { calcStoppingAndRangeTable } from './pral';
import { DEMO_PRESETS } from '../data';
import type { SRInput, TrimSetupConfig } from './types';

describe('SRIM / TRIM / SRModule / SRIMKorea File Format Parsers & Generators', () => {
  const sampleTrimConfig: TrimSetupConfig = {
    title: '6 C into SiO2 / Si (10 keV)',
    ion: {
      z1: 6,
      symbol: 'C',
      name: 'Carbon',
      massAmu: 12.011,
      energyKeV: 10.0,
      angleDeg: 7.0,
    },
    calculationMode: 2,
    totalIons: 20,
    randomSeed: 98765,
    braggCorrection: 0.96,
    autoSaveNumber: 5000,
    plotType: 0,
    plotXMinA: 0,
    plotXMaxA: 1000,
    zones: [
      { layerIndex: 0, endDepthA: 200 },
      { layerIndex: 1, endDepthA: 1000 },
    ],
    layers: [
      {
        id: 'layer-1',
        name: 'SiO2 Oxide',
        widthA: 200,
        densityGPerCm3: 2.2,
        phase: 0,
        compoundCorr: 0.96,
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
          {
            z: 8,
            symbol: 'O',
            name: 'Oxygen',
            stoich: 2.0,
            massAmu: 15.999,
            displacementEv: 28.0,
            latticeBindingEv: 3.0,
            surfaceBindingEv: 2.0,
          },
        ],
      },
      {
        id: 'layer-2',
        name: 'Silicon Substrate',
        widthA: 800,
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

  it('round-trips TRIM.IN generation and parsing including official DEMO_PRESETS', () => {
    const trimInText = generateTrimIn(sampleTrimConfig);
    expect(trimInText).toContain('==> SRIM-2003.20 This file controls TRIM Calculations.');
    expect(trimInText).toContain('SiO2 Oxide');
    expect(trimInText).toContain('Silicon Substrate');

    const parsed = parseTrimIn(trimInText);
    expect(parsed.ion.z1).toBe(6);
    expect(parsed.ion.energyKeV).toBeCloseTo(10.0, 4);
    expect(parsed.ion.angleDeg).toBeCloseTo(7.0, 4);
    expect(parsed.calculationMode).toBe(2);
    expect(parsed.layers).toHaveLength(2);
    expect(parsed.layers[0].name).toBe('SiO2 Oxide');
    expect(parsed.layers[0].widthA).toBeCloseTo(200, 3);
    expect(parsed.layers[0].densityGPerCm3).toBeCloseTo(2.2, 3);
    expect(parsed.layers[1].widthA).toBeCloseTo(800, 3);

    // Parse all 12 official SRIM 2003 demo files
    for (const demo of DEMO_PRESETS) {
      const demoParsed = parseTrimIn(demo.rawTrimIn);
      expect(demoParsed.ion.z1).toBe(demo.ionZ);
      expect(demoParsed.layers.length).toBeGreaterThan(0);
    }
  });

  it('round-trips SR.IN in both energy-range mode and custom energy-list (0 0) mode', () => {
    const srRangeInput: SRInput = {
      title: 'H in Liquid Water',
      z1: 1,
      m1: 1.008,
      elements: [
        { z: 1, symbol: 'H', name: 'Hydrogen', stoich: 2, mass: 1.008 },
        { z: 8, symbol: 'O', name: 'Oxygen', stoich: 1, mass: 15.999 },
      ],
      densityGPerCm3: 1.0,
      phase: 0,
      compoundCorr: 0.89,
      unit: 5,
      eMinKeV: 10.0,
      eMaxKeV: 10000.0,
      outputFilename: 'WATER_H.TXT',
    };

    const srInRangeTxt = generateSrIn(srRangeInput);
    const parsedRange = parseSrIn(srInRangeTxt);
    expect(parsedRange.z1).toBe(1);
    expect(parsedRange.unit).toBe(5);
    expect(parsedRange.densityGPerCm3).toBeCloseTo(1.0, 4);
    expect(parsedRange.compoundCorr).toBeCloseTo(0.89, 4);
    expect(parsedRange.eMinKeV).toBeCloseTo(10.0, 4);
    expect(parsedRange.eMaxKeV).toBeCloseTo(10000.0, 4);

    const srCustomInput: SRInput = {
      ...srRangeInput,
      eMinKeV: 0,
      eMaxKeV: 0,
      customEnergiesKeV: [1.02, 2.55, 3.98],
    };
    const srInCustomTxt = generateSrIn(srCustomInput);
    const parsedCustom = parseSrIn(srInCustomTxt);
    expect(parsedCustom.eMinKeV).toBe(0);
    expect(parsedCustom.eMaxKeV).toBe(0);
    expect(parsedCustom.customEnergiesKeV).toEqual([1.02, 2.55, 3.98]);
  });

  it('round-trips SRIMKorea .sim file format', () => {
    const simTxt = generateSimFile(sampleTrimConfig);
    const parsed = parseSimFile(simTxt);
    expect(parsed.ion.z1).toBe(6);
    expect(parsed.ion.energyKeV).toBeCloseTo(10.0, 4);
    expect(parsed.layers).toHaveLength(2);
    expect(parsed.layers[0].widthA).toBeCloseTo(200, 3);
    expect(parsed.layers[1].widthA).toBeCloseTo(800, 3);
  });

  it('round-trips TRIM.DAT custom recoil cascade event file', () => {
    const events = [
      { name: 'EV001', z1: 5, energyEv: 12500, xA: 120.5, yA: -10.2, zA: 4.5, cosX: 0.98, cosY: 0.14, cosZ: -0.14 },
      { name: 'EV002', z1: 15, energyEv: 45000, xA: 350.0, yA: 22.0, zA: -8.0, cosX: 0.95, cosY: -0.312, cosZ: 0.0 },
    ];
    const datTxt = generateTrimDat('Custom Recoil Events', events);
    const parsedEvents = parseTrimDat(datTxt);
    expect(parsedEvents).toHaveLength(2);
    expect(parsedEvents[0].name).toBe('EV001');
    expect(parsedEvents[0].z1).toBe(5);
    expect(parsedEvents[0].energyEv).toBeCloseTo(12500, 2);
    expect(parsedEvents[1].z1).toBe(15);
    expect(parsedEvents[1].xA).toBeCloseTo(350.0, 2);
  });

  it('generates all 12 official SRIM .TXT output files and SR Stopping Table .TXT', () => {
    const sim = new TrimSimulator(sampleTrimConfig);
    const snap = sim.runBatch(20);
    const files = generateAllTrimOutputs(sampleTrimConfig, snap);

    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'TDATA.TXT',
        'RANGE.TXT',
        'RANGE_3D.TXT',
        'LATERAL.TXT',
        'E2RECOIL.TXT',
        'IONIZ.TXT',
        'PHONON.TXT',
        'VACANCY.TXT',
        'NOVAC.TXT',
        'BACKSCAT.TXT',
        'TRANSMIT.TXT',
        'SPUTTER.TXT',
        'COLLISON.TXT',
      ])
    );
    expect(files['TDATA.TXT']).toContain('SRIM-2003');
    expect(files['RANGE.TXT']).toContain('DEPTH');
    expect(files['VACANCY.TXT']).toContain('Vacancies');

    const srInput: SRInput = {
      title: 'C in Si',
      z1: 6,
      m1: 12.011,
      elements: [{ z: 14, symbol: 'Si', name: 'Silicon', stoich: 1, mass: 28.086 }],
      densityGPerCm3: 2.3212,
      phase: 0,
      compoundCorr: 1.0,
      unit: 1,
      eMinKeV: 10,
      eMaxKeV: 100,
    };
    const rows = calcStoppingAndRangeTable(srInput);
    const srTxt = generateSrTableTxt(srInput, rows);
    expect(srTxt).toContain('Stopping Units =  eV / Angstrom');
    expect(srTxt).toContain('Projected');

    // M1: Verify authentic RANGE_3D and TRANSMIT headers
    expect(files['RANGE_3D.TXT']).toContain('Ion       Depth  X   Lateral Y   Lateral Z');
    expect(files['TRANSMIT.TXT']).toContain('Column #1: S= Sputtered Atom, B= Backscattered Ion, T= Transmitted Ion');
  });

  it('includes Target Energies (eV) block in generateTrimIn and round-trips with parseTrimIn', () => {
    const text = generateTrimIn(sampleTrimConfig);
    expect(text).toContain('Target Energies (eV): Binding, Surface, Individual Displacement');
    const parsed = parseTrimIn(text);
    expect(parsed.layers).toHaveLength(sampleTrimConfig.layers.length);
    expect(parsed.layers[0].name).toBe('SiO2 Oxide');
    expect(parsed.layers[0].elements[0].displacementEv).toBe(15.0);
    expect(parsed.layers[0].elements[1].displacementEv).toBe(28.0);
  });

  it('accurately parses authentic legacy TRIM.IN and SRIMKorea Al2O3_Si.sim files from disk', () => {
    const fs = require('fs');
    const path = require('path');

    // 1. Authentic TRIM.IN from SRIM 2003
    const trimInPath = path.resolve('..', 'SRIM', 'SRIM 2003', 'TRIM.IN');
    if (fs.existsSync(trimInPath)) {
      const trimInRaw = fs.readFileSync(trimInPath, 'latin1');
      const parsedTrimIn = parseTrimIn(trimInRaw);
      expect(parsedTrimIn.ion.z1).toBe(6);
      expect(parsedTrimIn.ion.massAmu).toBeCloseTo(12.011, 3);
      expect(parsedTrimIn.ion.energyKeV).toBe(3);
      expect(parsedTrimIn.totalIons).toBe(10000);
      expect(parsedTrimIn.layers).toHaveLength(1);
      expect(parsedTrimIn.layers[0].name).toBe('Si wafer');
      expect(parsedTrimIn.layers[0].widthA).toBe(13000);
      expect(parsedTrimIn.layers[0].densityGPerCm3).toBeCloseTo(2.3212, 4);
    }

    // 2. Authentic Al2O3_Si.sim from SRIMKorea
    const simPath = path.resolve('..', 'SRIM', 'SRIMKorea', 'Al2O3_Si.sim');
    if (fs.existsSync(simPath)) {
      const simRaw = fs.readFileSync(simPath, 'latin1');
      const parsedSim = parseSimFile(simRaw);
      expect(parsedSim.ion.z1).toBe(18); // Ar
      expect(parsedSim.ion.energyKeV).toBe(15000); // 15 MeV
      expect(parsedSim.layers).toHaveLength(2);
      expect(parsedSim.layers[0].name).toBe('Si Substrate');
      expect(parsedSim.layers[0].widthA).toBe(10000);
      expect(parsedSim.layers[1].name).toBe('Al2O3');
      expect(parsedSim.layers[1].widthA).toBe(300);
    }
  });
});
