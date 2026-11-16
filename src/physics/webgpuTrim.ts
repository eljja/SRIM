import { calcLayerStopping } from './stopping';
import type { TrimPoint3D, TrimSetupConfig, TrimTrajectory } from './types';

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
  /** Optional 128-point tabulated SCOEF03 Se(E) in eV/A (log-spaced from 5 eV to energyEv) */
  seTable?: Float32Array;
  /** Screening potential: 0 = ZBL, 1 = Kr-C, 2 = Moliere */
  potentialCode?: number;
}

export interface WebGpuBatchResult {
  rangeHist: number[];
  ionizationHist: number[];
  phononHist: number[];
  vacancyHist: number[];
  stoppedX: number[];
  stoppedY: number[];
  stoppedZ: number[];
  stoppedFate: number[];
  sampleTracks: TrimTrajectory[];
  stoppedCount: number;
  backscatterCount: number;
  transmitCount: number;
  totalIonizEv: number;
  totalPhononEv: number;
  totalBindingEv: number;
  totalVacancies: number;
}

const GPU_TRACK_COUNT = 64;
const GPU_TRACK_MAX_VERTS = 24;

/**
 * Checks if WebGPU is available in the current browser/runtime.
 */
export function isWebGpuSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
}

/**
 * Builds an exact 128-point tabulated SCOEF03 + CAB + Bragg electronic stopping table (eV/A)
 * log-spaced from 5 eV up to config.ion.energyKeV for GPU interpolation.
 */
export function buildGpuStoppingTable(config: TrimSetupConfig, layerIdx: number = 0): {
  seTable: Float32Array;
  atomDensityA3: number;
  meanZ2: number;
  meanM2: number;
} {
  const layer = config.layers[Math.min(layerIdx, config.layers.length - 1)] || config.layers[0];
  const totalStoich = layer.elements.reduce((a, b) => a + Math.max(0, b.stoich), 0) || 1;
  let meanZ2 = 0;
  let meanM2 = 0;
  const elements = layer.elements.map((e) => {
    const p = Math.max(0, e.stoich) / totalStoich;
    meanZ2 += p * e.z;
    meanM2 += p * e.massAmu;
    return { z: e.z, mass: e.massAmu, stoich: e.stoich };
  });
  meanM2 = meanM2 || 28.086;
  const atomDensityA3 = Math.max(
    1e-6,
    ((layer.densityGPerCm3 * 6.02214076e23) / meanM2) * 1e-24
  );
  const eMaxEv = Math.max(100, config.ion.energyKeV * 1000.0);
  const logMin = Math.log(5.0);
  const logMax = Math.log(eMaxEv);
  const seTable = new Float32Array(128);
  const compoundCorr = layer.compoundCorr * (config.braggCorrection || 1.0);

  for (let i = 0; i < 128; i++) {
    const eEv = Math.exp(logMin + ((logMax - logMin) * i) / 127);
    const info = calcLayerStopping(
      config.ion.z1,
      config.ion.massAmu,
      eEv / 1000.0,
      elements,
      layer.densityGPerCm3,
      layer.phase,
      compoundCorr,
      1,
      true,
      true
    );
    seTable[i] = info.seEvPerA;
  }

  return { seTable, atomDensityA3, meanZ2, meanM2 };
}

/**
 * Full-Fidelity WGSL Compute Shader for Monte Carlo Binary Collision Approximation (BCA).
 * Implements ZBL / Kr-C / Moliere screening with Newton-Raphson closest approach x0,
 * Biersack-Haggmark Magic Formula scattering, exact 3D direction rotation, tabulated SCOEF03 Se(E),
 * Kinchin-Pease NRT damage/ionization/phonon depth histograms, and 3D sample track recording.
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
  potentialCode: u32, // 0=ZBL, 1=Kr-C, 2=Moliere
  ebEv: f32,
  pad2: u32,
};

struct StoppedIon {
  x: f32,
  y: f32,
  z: f32,
  fate: u32, // lower 4 bits = fate (0=stopped,1=BS,2=TR); upper bits = vertCount for tracks
};

@group(0) @binding(0) var<uniform> params: SimParams;
// 0..99 = range count, 100..199 = ionization eV, 200..299 = phonon eV, 300..399 = vacancies * 10
@group(0) @binding(1) var<storage, read_write> histAll: array<atomic<u32>, 400>;
@group(0) @binding(2) var<storage, read_write> stoppedIons: array<StoppedIon>;
// [0]=stopped, [1]=backscatter, [2]=transmit, [3]=totalCompleted, [4]=bindingEv (stochastic)
@group(0) @binding(3) var<storage, read_write> globalCounters: array<atomic<u32>, 8>;
@group(0) @binding(4) var<storage, read> seTable: array<f32, 128>;
// Up to 64 sample trajectories * 24 vertices * vec4(x, y, z, energyEv)
@group(0) @binding(5) var<storage, read_write> trackVerts: array<vec4<f32>, 1536>;

fn pcg32(state: ptr<function, u32>) -> f32 {
  let old = *state;
  *state = old * 747796405u + 2891336453u;
  var word = ((old >> ((old >> 28u) + 4u)) ^ old) * 277803737u;
  word = (word >> 22u) ^ word;
  return max(1e-7, min(0.9999999, f32(word) / 4294967296.0));
}

fn evalScreening(x: f32, pot: u32) -> vec2<f32> {
  if (pot == 1u) {
    let t0 = 0.190945 * exp(-0.278544 * x);
    let t1 = 0.473674 * exp(-0.637174 * x);
    let t2 = 0.335381 * exp(-1.919249 * x);
    return vec2<f32>(t0 + t1 + t2, -(0.278544 * t0 + 0.637174 * t1 + 1.919249 * t2));
  }
  if (pot == 2u) {
    let t0 = 0.35 * exp(-0.3 * x);
    let t1 = 0.55 * exp(-1.2 * x);
    let t2 = 0.10 * exp(-6.0 * x);
    return vec2<f32>(t0 + t1 + t2, -(0.3 * t0 + 1.2 * t1 + 6.0 * t2));
  }
  let t0 = 0.18175 * exp(-3.1998 * x);
  let t1 = 0.50986 * exp(-0.94229 * x);
  let t2 = 0.28022 * exp(-0.4029 * x);
  let t3 = 0.02817 * exp(-0.20162 * x);
  let phi = t0 + t1 + t2 + t3;
  let dphi = -(3.1998 * t0 + 0.94229 * t1 + 0.4029 * t2 + 0.20162 * t3);
  return vec2<f32>(phi, dphi);
}

fn lookupSeEvPerA(energyEv: f32) -> f32 {
  let eMax = max(100.0, params.energyEv);
  let eClamped = max(5.0, min(eMax, energyEv));
  let t = log(eClamped / 5.0) / max(1e-4, log(eMax / 5.0));
  let fIdx = clamp(t * 127.0, 0.0, 126.999);
  let i0 = u32(fIdx);
  let i1 = min(127u, i0 + 1u);
  let frac = fIdx - f32(i0);
  return seTable[i0] * (1.0 - frac) + seTable[i1] * frac;
}

fn magicScatteringSinHalfTheta(eps: f32, bRed: f32, pot: u32) -> f32 {
  if (bRed <= 1e-6) {
    return 1.0;
  }
  if (eps > 10.0 && eps * bRed > 10.0) {
    let cotH = 2.0 * eps * bRed;
    return 1.0 / sqrt(1.0 + cotH * cotH);
  }
  let rMinCoul = (1.0 + sqrt(1.0 + 4.0 * eps * eps * bRed * bRed)) / (2.0 * eps);
  var x0 = max(bRed + 1e-5, min(rMinCoul, bRed + 1.2 / pow(max(1e-7, eps), 0.35)));
  for (var iter = 0u; iter < 12u; iter = iter + 1u) {
    let sd = evalScreening(x0, pot);
    let invX = 1.0 / x0;
    let br = bRed * invX;
    let f = 1.0 - (sd.x * invX) / eps - br * br;
    let df = -(sd.y * invX - sd.x * invX * invX) / eps + 2.0 * br * br * invX;
    if (abs(df) < 1e-12) { break; }
    var nx = x0 - f / df;
    if (nx <= bRed) { nx = 0.5 * (bRed + x0); }
    if (abs(nx - x0) < 1e-5 * x0) {
      x0 = nx;
      break;
    }
    x0 = nx;
  }
  let sd = evalScreening(x0, pot);
  let denomRc = sd.y / x0 - sd.x / (x0 * x0);
  let numerRc = -2.0 * eps * (1.0 - sd.x / (eps * x0));
  let rC = select(0.0, max(0.0, numerRc / denomRc), abs(denomRc) > 1e-12);
  let sqrtEps = sqrt(max(1e-9, eps));
  let alpha = 1.0 + 0.99229 / sqrtEps;
  let beta = (0.011615 + sqrtEps) / (0.0071222 + sqrtEps);
  let gammaM = (14.813 + eps) / (9.3066 + eps);
  let aTerm = 2.0 * alpha * eps * pow(bRed, beta);
  let gTerm = gammaM / max(1e-9, sqrt(1.0 + aTerm * aTerm) - aTerm);
  let delta = (aTerm * (x0 - bRed)) / (1.0 + gTerm);
  let cosHalf = clamp((bRed + rC + delta) / max(1e-9, x0 + rC), 0.0, 1.0);
  return sqrt(max(0.0, 1.0 - cosHalf * cosHalf));
}

fn rotateDir3D(d: vec3<f32>, cosPsi: f32, sinPsi: f32, phi: f32) -> vec3<f32> {
  let cosPhi = cos(phi);
  let sinPhi = sin(phi);
  let sinTheta0 = sqrt(max(0.0, 1.0 - d.x * d.x));
  var out = vec3<f32>(0.0);
  if (sinTheta0 < 1e-5) {
    let sgn = select(-1.0, 1.0, d.x >= 0.0);
    out = vec3<f32>(sgn * cosPsi, sinPsi * cosPhi, sinPsi * sinPhi);
  } else {
    out.x = d.x * cosPsi - sinPsi * sinTheta0 * cosPhi;
    out.y = d.y * cosPsi + (sinPsi * (d.x * d.y * cosPhi - d.z * sinPhi)) / sinTheta0;
    out.z = d.z * cosPsi + (sinPsi * (d.x * d.z * cosPhi + d.y * sinPhi)) / sinTheta0;
  }
  return normalize(out);
}

fn addHistStochastic(baseOffset: u32, xPosA: f32, val: f32, rng: ptr<function, u32>) {
  if (val <= 0.0 || xPosA < 0.0 || xPosA >= params.targetWidthA) { return; }
  let b = u32(clamp(xPosA / params.binWidthA, 0.0, 99.0));
  let rounded = u32(max(0.0, val + pcg32(rng)));
  if (rounded > 0u) {
    atomicAdd(&histAll[baseOffset + b], rounded);
  }
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
  let pot = params.potentialCode;
  let edEv = max(5.0, params.edEv);
  let ebEv = max(0.0, params.ebEv);

  var energy = params.energyEv;
  var pos = vec3<f32>(0.0, 0.0, 0.0);
  var dir = vec3<f32>(cos(params.angleRad), sin(params.angleRad), 0.0);

  let aU = select(
    0.46848 / pow(sqrt(z1) + sqrt(z2), 2.0 / 3.0),
    0.46853 / (pow(z1, 0.23) + pow(z2, 0.23)),
    pot == 0u
  );
  let gamma = (4.0 * m1 * m2) / ((m1 + m2) * (m1 + m2));
  let monoL = pow(N, -1.0 / 3.0);
  let pMaxMono = 1.0 / sqrt(3.14159265 * N * monoL);
  let massRatio = m1 / m2;
  let kL = (0.1337 * pow(max(1.0, z2), 2.0 / 3.0)) / sqrt(max(1.0, m2));

  let recordTrack = ionIdx < 64u;
  var vCount = 0u;
  if (recordTrack) {
    trackVerts[ionIdx * 24u] = vec4<f32>(pos.x, pos.y, pos.z, energy);
    vCount = 1u;
  }

  var steps = 0u;
  var fate = 0u;
  var bindSumEv = 0.0;

  while (steps < 12000u && energy > eStop) {
    steps = steps + 1u;

    let eCm = (energy * m2) / (m1 + m2);
    let eps = max(1e-7, (eCm * aU) / (14.39979 * z1 * z2));
    var jumpA = monoL;
    if (energy > 200.0) {
      let bMaxRed = sqrt(max(0.25, (gamma * energy) / (5.0 * max(1.0, 4.0 * eps * eps))));
      let pMaxE = max(pMaxMono, min(aU * (bMaxRed + 1.5), pMaxMono * 3.0));
      let mfp = 1.0 / (3.14159265 * N * pMaxE * pMaxE);
      let maxPhys = min(40.0, max(10.0, 0.05 * sqrt(energy)));
      jumpA = max(monoL, min(mfp, maxPhys));
    }

    let nextPos = pos + jumpA * dir;

    if (nextPos.x < 0.0) {
      fate = 1u;
      pos.x = 0.0;
      break;
    }
    if (nextPos.x > widthA) {
      fate = 2u;
      pos.x = widthA;
      break;
    }

    let se = lookupSeEvPerA(energy);
    let deElec = min(energy - 0.5 * eStop, max(0.0, se * jumpA));
    energy = max(0.0, energy - deElec);
    let midX = 0.5 * (pos.x + nextPos.x);
    addHistStochastic(100u, midX, deElec, &rngState);

    pos = nextPos;
    if (energy <= eStop) {
      addHistStochastic(200u, pos.x, energy, &rngState);
      energy = 0.0;
      break;
    }

    let pMaxStep = 1.0 / sqrt(3.14159265 * N * jumpA);
    let b = pMaxStep * sqrt(pcg32(&rngState));
    let bRed = b / aU;

    let sinHalf = magicScatteringSinHalfTheta(eps, bRed, pot);
    let sinSqHalf = sinHalf * sinHalf;
    let cosHalf = sqrt(max(0.0, 1.0 - sinSqHalf));
    let recoilE = min(energy, gamma * energy * sinSqHalf);
    energy = max(0.0, energy - recoilE);

    // Quick Kinchin-Pease energy partition into Ionization / Phonon / Vacancies
    if (recoilE >= edEv) {
      let eRecInit = max(0.0, recoilE - ebEv);
      let epsL = (0.01151 * eRecInit) / pow(max(1.0, z2), 7.0 / 3.0);
      let gEps = epsL + 0.40244 * pow(epsL, 0.75) + 3.4008 * pow(epsL, 1.0 / 6.0);
      let edam = eRecInit / (1.0 + kL * gEps);
      let recIoniz = max(0.0, eRecInit - edam);
      var vac = 1.0;
      if (edam >= 2.5 * edEv) {
        vac = (0.4 * edam) / edEv;
      }
      let recBind = vac * ebEv;
      let recPhon = max(0.0, recoilE - recIoniz - recBind);
      bindSumEv = bindSumEv + recBind;
      addHistStochastic(100u, pos.x, recIoniz, &rngState);
      addHistStochastic(200u, pos.x, recPhon, &rngState);
      addHistStochastic(300u, pos.x, vac * 10.0, &rngState);
    } else {
      addHistStochastic(200u, pos.x, recoilE, &rngState);
    }

    let sinTheta = 2.0 * sinHalf * cosHalf;
    let cosTheta = 1.0 - 2.0 * sinSqHalf;
    let denomIon = sqrt(max(1e-12, sinTheta * sinTheta + (cosTheta + massRatio) * (cosTheta + massRatio)));
    let cosPsiIon = clamp((cosTheta + massRatio) / denomIon, -1.0, 1.0);
    let sinPsiIon = clamp(sinTheta / denomIon, 0.0, 1.0);

    let phi = 6.2831853 * pcg32(&rngState);
    dir = rotateDir3D(dir, cosPsiIon, sinPsiIon, phi);

    if (recordTrack && vCount < 23u && (steps % 4u == 0u || recoilE >= 50.0)) {
      trackVerts[ionIdx * 24u + vCount] = vec4<f32>(pos.x, pos.y, pos.z, energy);
      vCount = vCount + 1u;
    }
  }

  if (fate == 0u && energy > 0.0) {
    addHistStochastic(200u, pos.x, energy, &rngState);
  }

  if (recordTrack && vCount < 24u) {
    trackVerts[ionIdx * 24u + vCount] = vec4<f32>(pos.x, pos.y, pos.z, 0.0);
    vCount = vCount + 1u;
  }

  atomicAdd(&globalCounters[fate], 1u);
  atomicAdd(&globalCounters[3], 1u);
  let bRound = u32(max(0.0, bindSumEv + pcg32(&rngState)));
  if (bRound > 0u) {
    atomicAdd(&globalCounters[4], bRound);
  }

  if (fate == 0u) {
    let binIdx = u32(clamp(pos.x / params.binWidthA, 0.0, 99.0));
    atomicAdd(&histAll[binIdx], 1u);
  }

  if (ionIdx < 4096u) {
    stoppedIons[ionIdx].x = pos.x;
    stoppedIons[ionIdx].y = pos.y;
    stoppedIons[ionIdx].z = pos.z;
    stoppedIons[ionIdx].fate = (vCount << 4u) | (fate & 15u);
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

    const nIons = Math.max(1, Math.min(1_000_000, Math.round(count)));

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
    const u32View = new Uint32Array(uniformArray.buffer);
    u32View[11] = nIons;
    u32View[12] = ((Date.now() ^ Math.floor(Math.random() * 1e9)) & 0xffffffff) >>> 0;
    u32View[13] = params.potentialCode ?? 0;
    uniformArray[14] = 2.0;

    const uniformBuffer = this.device.createBuffer({
      size: uniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    // 2. Combined histograms buffer: 400 * 4 = 1600 bytes
    const histBuffer = this.device.createBuffer({
      size: 400 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // 3. Stopped ions buffer: up to 4096 * 16 = 65536 bytes
    const maxIonsToRecord = Math.min(4096, nIons);
    const stoppedBufferSize = maxIonsToRecord * 16;
    const stoppedBuffer = this.device.createBuffer({
      size: stoppedBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // 4. Global counters buffer: 8 * 4 = 32 bytes
    const countersBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // 5. SCOEF03 Tabulated Stopping buffer: 128 * 4 = 512 bytes
    const seArr =
      params.seTable && params.seTable.length === 128
        ? params.seTable
        : new Float32Array(128).fill(Math.max(1.0, 0.04 * Math.sqrt(params.energyEv)));
    const seBuffer = this.device.createBuffer({
      size: 128 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(seBuffer, 0, seArr);

    // 6. GPU Sampled 3D Track buffer: 64 tracks * 24 vec4<f32> = 24,576 bytes
    const trackBufferSize = GPU_TRACK_COUNT * GPU_TRACK_MAX_VERTS * 16;
    const trackBuffer = this.device.createBuffer({
      size: trackBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Staging buffers for readback
    const stageHist = this.device.createBuffer({
      size: 400 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const stageStopped = this.device.createBuffer({
      size: stoppedBufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const stageCounters = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const stageTracks = this.device.createBuffer({
      size: trackBufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: histBuffer } },
        { binding: 2, resource: { buffer: stoppedBuffer } },
        { binding: 3, resource: { buffer: countersBuffer } },
        { binding: 4, resource: { buffer: seBuffer } },
        { binding: 5, resource: { buffer: trackBuffer } },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(nIons / 64));
    pass.end();

    commandEncoder.copyBufferToBuffer(histBuffer, 0, stageHist, 0, 400 * 4);
    commandEncoder.copyBufferToBuffer(stoppedBuffer, 0, stageStopped, 0, stoppedBufferSize);
    commandEncoder.copyBufferToBuffer(countersBuffer, 0, stageCounters, 0, 32);
    commandEncoder.copyBufferToBuffer(trackBuffer, 0, stageTracks, 0, trackBufferSize);

    this.device.queue.submit([commandEncoder.finish()]);

    await Promise.all([
      stageHist.mapAsync(GPUMapMode.READ),
      stageStopped.mapAsync(GPUMapMode.READ),
      stageCounters.mapAsync(GPUMapMode.READ),
      stageTracks.mapAsync(GPUMapMode.READ),
    ]);

    const histAll = new Uint32Array(stageHist.getMappedRange());
    const rangeHist = Array.from(histAll.subarray(0, 100));
    const ionizationHist = Array.from(histAll.subarray(100, 200));
    const phononHist = Array.from(histAll.subarray(200, 300));
    const vacancyHist = Array.from(histAll.subarray(300, 400), (v) => v / 10.0);

    let totalIonizEv = 0;
    let totalPhononEv = 0;
    let totalVacancies = 0;
    for (let b = 0; b < 100; b++) {
      totalIonizEv += ionizationHist[b];
      totalPhononEv += phononHist[b];
      totalVacancies += vacancyHist[b];
    }

    const countersData = new Uint32Array(stageCounters.getMappedRange());
    const stoppedCount = countersData[0];
    const backscatterCount = countersData[1];
    const transmitCount = countersData[2];
    const totalBindingEv = countersData[4];

    const stoppedView = new DataView(stageStopped.getMappedRange());
    const stoppedX: number[] = [];
    const stoppedY: number[] = [];
    const stoppedZ: number[] = [];
    const stoppedFate: number[] = [];
    const trackVertCounts: number[] = [];

    for (let i = 0; i < maxIonsToRecord; i++) {
      const byteOff = i * 16;
      stoppedX.push(stoppedView.getFloat32(byteOff, true));
      stoppedY.push(stoppedView.getFloat32(byteOff + 4, true));
      stoppedZ.push(stoppedView.getFloat32(byteOff + 8, true));
      const packed = stoppedView.getUint32(byteOff + 12, true);
      stoppedFate.push(packed & 15);
      if (i < GPU_TRACK_COUNT) {
        trackVertCounts.push((packed >>> 4) & 0x3f);
      }
    }

    const trackFloats = new Float32Array(stageTracks.getMappedRange());
    const sampleTracks: TrimTrajectory[] = [];
    const nTracks = Math.min(GPU_TRACK_COUNT, nIons);
    for (let t = 0; t < nTracks; t++) {
      const vc = Math.min(GPU_TRACK_MAX_VERTS, trackVertCounts[t] || 0);
      if (vc < 2) continue;
      const pts: TrimPoint3D[] = [];
      for (let v = 0; v < vc; v++) {
        const base = (t * GPU_TRACK_MAX_VERTS + v) * 4;
        pts.push({
          xA: trackFloats[base],
          yA: trackFloats[base + 1],
          zA: trackFloats[base + 2],
          energyEv: trackFloats[base + 3],
        });
      }
      const fCode = stoppedFate[t] ?? 0;
      sampleTracks.push({
        ionNumber: t + 1,
        z1: params.z1,
        fate: fCode === 1 ? 'backscattered' : fCode === 2 ? 'transmitted' : 'stopped',
        points: pts,
        recoils: [],
      });
    }

    stageHist.unmap();
    stageStopped.unmap();
    stageCounters.unmap();
    stageTracks.unmap();

    uniformBuffer.destroy();
    histBuffer.destroy();
    stoppedBuffer.destroy();
    countersBuffer.destroy();
    seBuffer.destroy();
    trackBuffer.destroy();
    stageHist.destroy();
    stageStopped.destroy();
    stageCounters.destroy();
    stageTracks.destroy();

    return {
      rangeHist,
      ionizationHist,
      phononHist,
      vacancyHist,
      stoppedX,
      stoppedY,
      stoppedZ,
      stoppedFate,
      sampleTracks,
      stoppedCount,
      backscatterCount,
      transmitCount,
      totalIonizEv,
      totalPhononEv,
      totalBindingEv,
      totalVacancies,
    };
  }
}
