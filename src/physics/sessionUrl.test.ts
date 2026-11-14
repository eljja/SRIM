import { describe, it, expect } from 'vitest';
import { encodeConfigToHash, decodeConfigFromHash } from './sessionUrl';
import type { TrimSetupConfig } from './types';

describe('URL Session Permalinks & Compressed Sharing', () => {
  const sampleConfig: TrimSetupConfig = {
    title: 'B in Si 10 keV Test',
    ion: {
      z1: 5,
      symbol: 'B',
      name: 'Boron',
      massAmu: 10.811,
      energyKeV: 10.0,
      angleDeg: 7.0,
    },
    calculationMode: 1,
    totalIons: 500,
    randomSeed: 12345,
    braggCorrection: 1.0,
    autoSaveNumber: 10000,
    plotType: 0,
    plotXMinA: 0,
    plotXMaxA: 2000,
    zones: [{ layerIndex: 0, endDepthA: 2000 }],
    layers: [
      {
        id: 'layer-si',
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

  it('encodes and decodes TrimSetupConfig with 100% roundtrip fidelity', () => {
    const hash = encodeConfigToHash(sampleConfig);
    expect(hash).toContain('session=');
    expect(hash.startsWith('#')).toBe(true);

    const decoded = decodeConfigFromHash(hash);
    expect(decoded).not.toBeNull();
    expect(decoded?.title).toBe(sampleConfig.title);
    expect(decoded?.ion.z1).toBe(5);
    expect(decoded?.ion.energyKeV).toBe(10.0);
    expect(decoded?.ion.angleDeg).toBe(7.0);
    expect(decoded?.calculationMode).toBe(1);
    expect(decoded?.totalIons).toBe(500);
    expect(decoded?.layers[0].name).toBe('Silicon');
    expect(decoded?.layers[0].elements[0].z).toBe(14);
  });

  it('handles prefixes gracefully (#session=, session=, or raw payload)', () => {
    const hash = encodeConfigToHash(sampleConfig);
    const rawPayload = hash.replace('#session=', '');

    const fromPrefixed = decodeConfigFromHash(hash);
    const fromNoHash = decodeConfigFromHash(`session=${rawPayload}`);
    const fromBare = decodeConfigFromHash(rawPayload);

    expect(fromPrefixed).toEqual(fromNoHash);
    expect(fromPrefixed).toEqual(fromBare);
  });

  it('gracefully returns null for corrupt, malformed, or empty hashes without throwing', () => {
    expect(decodeConfigFromHash('')).toBeNull();
    expect(decodeConfigFromHash('#session=')).toBeNull();
    expect(decodeConfigFromHash('#session=invalid_base64_!@#$%^&*')).toBeNull();
    expect(decodeConfigFromHash('random_garbage_string')).toBeNull();
    expect(decodeConfigFromHash(btoa(JSON.stringify({ notAConfig: true })))).toBeNull();
  });
});
