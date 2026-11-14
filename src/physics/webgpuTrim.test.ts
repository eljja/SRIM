import { describe, it, expect } from 'vitest';
import { isWebGpuSupported, WebGpuTrimRunner, WGSL_TRIM_SHADER } from './webgpuTrim';

describe('WebGPU Acceleration Engine', () => {
  it('detects WebGPU capability without throwing', () => {
    const supported = isWebGpuSupported();
    expect(typeof supported).toBe('boolean');
  });

  it('contains valid WGSL shader code with workgroup compute entrypoint', () => {
    expect(WGSL_TRIM_SHADER).toContain('@compute');
    expect(WGSL_TRIM_SHADER).toContain('@workgroup_size(');
    expect(WGSL_TRIM_SHADER).toContain('pcg32');
    expect(WGSL_TRIM_SHADER).toContain('ZBL Magic Scattering');
  });

  it('instantiates WebGpuTrimRunner and handles unsupported environments gracefully', async () => {
    const runner = new WebGpuTrimRunner();
    expect(runner).toBeDefined();

    // In Node/Vitest standard test environment, navigator.gpu is usually absent
    const initialized = await runner.init();
    expect(typeof initialized).toBe('boolean');

    if (!initialized) {
      // If WebGPU is absent, running batch should reject with clear error message
      await expect(runner.runBatch(10, {
        z1: 6,
        m1: 12.011,
        energyEv: 3000,
        angleRad: 0,
        z2: 14,
        m2: 28.086,
        atomDensityA3: 0.05,
        targetWidthA: 1000,
        edEv: 10,
        esEv: 2.1,
        binWidthA: 10,
      })).rejects.toThrow(/WebGPU not initialized/);
    }
  });
});
