export interface WebGpuParams {
  z1: number;
  m1: number;
  energyEv: number;
  angleRad: number;
  z2: number;
  m2: number;
  atomDensityA3: number;
  targetWidthA: number;
  edEv: number;
  esEv: number;
  binWidthA: number;
}

export interface WebGpuBatchResult {
  rangeHist: number[];
  stoppedX: number[];
  stoppedY: number[];
  stoppedZ: number[];
  stoppedCount: number;
  backscatterCount: number;
  transmitCount: number;
}

/**
 * Checks if WebGPU is available in the current browser/runtime.
 */
export function isWebGpuSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
}

/**
 * High-performance WGSL Compute Shader for Monte Carlo Binary Collision Approximation (BCA).
 * Computes individual ion trajectories in parallel using GPU workgroups.
 */
export const WGSL_TRIM_SHADER = `
struct SimParams {
  z1: f32,
  m1: f32,
  energyEv: f32,
  angleRad: f32,
  z2: f32,
  m2: f32,
  atomDensityA3: f32,
  targetWidthA: f32,
  edEv: f32,
  esEv: f32,
  binWidthA: f32,
  batchCount: u32,
  seedBase: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
};

struct StoppedIon {
  x: f32,
  y: f32,
  z: f32,
  fate: u32, // 0 = stopped, 1 = backscattered, 2 = transmitted
};

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> histBins: array<atomic<u32>, 100>;
@group(0) @binding(2) var<storage, read_write> stoppedIons: array<StoppedIon>;
@group(0) @binding(3) var<storage, read_write> globalCounters: array<atomic<u32>, 4>; // [stopped, backscatter, transmit, totalCompleted]

// PCG 32-bit pseudorandom generator
fn pcg32(state: ptr<function, u32>) -> f32 {
  let old = *state;
  *state = old * 747796405u + 2891336453u;
  var word = ((old >> ((old >> 28u) + 4u)) ^ old) * 277803737u;
  word = (word >> 22u) ^ word;
  return f32(word) / 4294967296.0;
}

// ZBL Magic Scattering approximation on GPU
fn calcScatteringTheta(eps: f32, bRed: f32) -> f32 {
  let alpha = 1.0 + 4.0 * eps * eps * bRed * bRed;
  return 2.0 * acos(clamp(sqrt(1.0 / alpha), 0.0, 1.0));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let ionIdx = global_id.x;
  if (ionIdx >= params.batchCount) {
    return;
  }

  var rngState = params.seedBase + ionIdx * 1973u + 9277u;

  let z1 = params.z1;
  let m1 = params.m1;
  let z2 = params.z2;
  let m2 = params.m2;
  let N = params.atomDensityA3;
  let widthA = params.targetWidthA;
  let eStop = max(5.0, params.esEv);

  var energy = params.energyEv;
  var x = 0.0;
  var y = 0.0;
  var z = 0.0;
  var cosX = cos(params.angleRad);
  var cosY = sin(params.angleRad);
  var cosZ = 0.0;

  let aU = 0.46853 / (pow(z1, 0.23) + pow(z2, 0.23));
  let gamma = (4.0 * m1 * m2) / ((m1 + m2) * (m1 + m2));
  let monoL = pow(N, -1.0 / 3.0);
  let pMax = 1.0 / sqrt(3.14159265 * N * monoL);

  var steps = 0u;
  var fate = 0u; // 0 = stopped, 1 = backscatter, 2 = transmit

  while (steps < 4000u && energy > eStop) {
    steps = steps + 1u;

    // Approximate electronic stopping loss Se
    let deElec = 0.8 * sqrt(max(1.0, energy)) * 0.05 * monoL;
    energy = max(0.0, energy - deElec);
    if (energy <= eStop) {
      break;
    }

    let nextX = x + monoL * cosX;
    let nextY = y + monoL * cosY;
    let nextZ = z + monoL * cosZ;

    // Check boundaries
    if (nextX < 0.0) {
      fate = 1u;
      x = 0.0;
      break;
    }
    if (nextX > widthA) {
      fate = 2u;
      x = widthA;
      break;
    }

    x = nextX;
    y = nextY;
    z = nextZ;

    // Elastic collision
    let randP = pcg32(&rngState);
    let b = pMax * sqrt(randP);
    let eCm = (energy * m2) / (m1 + m2);
    let eps = (eCm * aU) / (14.4 * z1 * z2);
    let bRed = b / aU;

    let theta = calcScatteringTheta(eps, bRed);
    let sinT = sin(theta);
    let cosT = cos(theta);
    let recoilE = gamma * energy * sinT * sinT * 0.5;
    energy = max(0.0, energy - recoilE);

    // Azimuthal deflection
    let phi = 6.2831853 * pcg32(&rngState);
    cosX = clamp(cosX * cosT - sin(acos(clamp(cosX, -1.0, 1.0))) * sinT * cos(phi), -1.0, 1.0);
    cosY = sin(acos(cosX)) * cos(phi);
    cosZ = sin(acos(cosX)) * sin(phi);
  }

  // Update global counters
  atomicAdd(&globalCounters[fate], 1u);
  atomicAdd(&globalCounters[3], 1u);

  // If stopped inside target, record into depth histogram
  if (fate == 0u) {
    let binIdx = u32(clamp(x / params.binWidthA, 0.0, 99.0));
    atomicAdd(&histBins[binIdx], 1u);
  }

  // Record stopped ion coordinates (up to 1024 ions)
  if (ionIdx < 1024u) {
    stoppedIons[ionIdx].x = x;
    stoppedIons[ionIdx].y = y;
    stoppedIons[ionIdx].z = z;
    stoppedIons[ionIdx].fate = fate;
  }
}
`;

/**
 * Runner managing WebGPU device, compute pipeline, and simulation execution.
 */
export class WebGpuTrimRunner {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private isReady = false;

  public async init(): Promise<boolean> {
    if (!isWebGpuSupported()) {
      return false;
    }
    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!adapter) return false;

      this.device = await adapter.requestDevice();
      const module = this.device.createShaderModule({
        code: WGSL_TRIM_SHADER,
      });

      this.pipeline = await this.device.createComputePipelineAsync({
        layout: 'auto',
        compute: {
          module,
          entryPoint: 'main',
        },
      });

      this.isReady = true;
      return true;
    } catch {
      this.isReady = false;
      this.device = null;
      this.pipeline = null;
      return false;
    }
  }

  public get ready(): boolean {
    return this.isReady && !!this.device && !!this.pipeline;
  }

  public async runBatch(count: number, params: WebGpuParams): Promise<WebGpuBatchResult> {
    if (!this.ready || !this.device || !this.pipeline) {
      throw new Error('WebGPU not initialized or supported in this environment');
    }

    const nIons = Math.max(1, Math.min(65535, count));

    // 1. Uniform Buffer: 64 bytes
    const uniformArray = new Float32Array(16);
    uniformArray[0] = params.z1;
    uniformArray[1] = params.m1;
    uniformArray[2] = params.energyEv;
    uniformArray[3] = params.angleRad;
    uniformArray[4] = params.z2;
    uniformArray[5] = params.m2;
    uniformArray[6] = params.atomDensityA3;
    uniformArray[7] = params.targetWidthA;
    uniformArray[8] = params.edEv;
    uniformArray[9] = params.esEv;
    uniformArray[10] = params.binWidthA;
    // Uint32 views for integer params
    const u32View = new Uint32Array(uniformArray.buffer);
    u32View[11] = nIons;
    u32View[12] = (Date.now() & 0xffffffff) >>> 0;

    const uniformBuffer = this.device.createBuffer({
      size: uniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    // 2. Histogram storage buffer: 100 * 4 = 400 bytes
    const histBuffer = this.device.createBuffer({
      size: 100 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // 3. Stopped ions buffer: 1024 * 16 = 16384 bytes
    const maxIonsToRecord = Math.min(1024, nIons);
    const stoppedBufferSize = maxIonsToRecord * 16;
    const stoppedBuffer = this.device.createBuffer({
      size: stoppedBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // 4. Global counters buffer: 4 * 4 = 16 bytes
    const countersBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // Staging buffers for readback
    const stageHist = this.device.createBuffer({
      size: 400,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const stageStopped = this.device.createBuffer({
      size: stoppedBufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const stageCounters = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: histBuffer } },
        { binding: 2, resource: { buffer: stoppedBuffer } },
        { binding: 3, resource: { buffer: countersBuffer } },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(nIons / 64));
    pass.end();

    commandEncoder.copyBufferToBuffer(histBuffer, 0, stageHist, 0, 400);
    commandEncoder.copyBufferToBuffer(stoppedBuffer, 0, stageStopped, 0, stoppedBufferSize);
    commandEncoder.copyBufferToBuffer(countersBuffer, 0, stageCounters, 0, 16);

    this.device.queue.submit([commandEncoder.finish()]);

    // Read back results asynchronously
    await Promise.all([
      stageHist.mapAsync(GPUMapMode.READ),
      stageStopped.mapAsync(GPUMapMode.READ),
      stageCounters.mapAsync(GPUMapMode.READ),
    ]);

    const histData = new Uint32Array(stageHist.getMappedRange());
    const rangeHist = Array.from(histData);

    const countersData = new Uint32Array(stageCounters.getMappedRange());
    const stoppedCount = countersData[0];
    const backscatterCount = countersData[1];
    const transmitCount = countersData[2];

    const stoppedFloats = new Float32Array(stageStopped.getMappedRange());
    const stoppedX: number[] = [];
    const stoppedY: number[] = [];
    const stoppedZ: number[] = [];

    for (let i = 0; i < maxIonsToRecord; i++) {
      const offset = i * 4;
      const x = stoppedFloats[offset];
      const y = stoppedFloats[offset + 1];
      const z = stoppedFloats[offset + 2];
      stoppedX.push(x);
      stoppedY.push(y);
      stoppedZ.push(z);
    }

    stageHist.unmap();
    stageStopped.unmap();
    stageCounters.unmap();

    uniformBuffer.destroy();
    histBuffer.destroy();
    stoppedBuffer.destroy();
    countersBuffer.destroy();
    stageHist.destroy();
    stageStopped.destroy();
    stageCounters.destroy();

    return {
      rangeHist,
      stoppedX,
      stoppedY,
      stoppedZ,
      stoppedCount,
      backscatterCount,
      transmitCount,
    };
  }
}
