import { getElementByZ } from '../data';
import { formatRangeWithAutoUnit } from './pral';
import { convertStoppingUnit } from './stopping';
import type {
  SRInput,
  SRTableRow,
  StoppingUnit,
  TrimCalcMode,
  TrimCustomDatEvent,
  TrimElementConfig,
  TrimLayerConfig,
  TrimSetupConfig,
  TrimSnapshot,
} from './types';

function parseFortranFloat(val: string | undefined, fallback = 0.0): number {
  if (!val) return fallback;
  const s = val.trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Generates an official SRIM-2003 TRIM.IN file from TrimSetupConfig.
 */
export function generateTrimIn(config: TrimSetupConfig): string {
  // Collect unique target elements across all layers in order of appearance
  const targetElements: TrimElementConfig[] = [];
  for (const layer of config.layers) {
    for (const el of layer.elements) {
      targetElements.push(el);
    }
  }
  const nElem = Math.max(1, targetElements.length);
  const nLayers = Math.max(1, config.layers.length);

  const lines: string[] = [];
  lines.push('==> SRIM-2003.20 This file controls TRIM Calculations.');
  lines.push('Ion: Z1 ,  M1,  Energy (keV), Angle,Number,Bragg Corr,AutoSave Number.');
  lines.push(
    `     ${config.ion.z1}   ${config.ion.massAmu.toFixed(4)}         ${config.ion.energyKeV}       ${config.ion.angleDeg}   ${config.totalIons}        ${config.braggCorrection}           ${config.autoSaveNumber}`
  );
  lines.push('Cascades(1=No;2=Full;3=Sputt;4-5=Ions;6-7=Neutrons), Random Number Seed, Reminders');
  lines.push(`                      ${config.calculationMode}                                   ${config.randomSeed || 0}       0`);
  lines.push('Diskfiles (0=no,1=yes): RANGES, BACKSCATT, TRANSMIT, Sputtered, COLLISIONS(1=Ion;2=Ion+Recoils), Special EXYZ.txt file');
  lines.push('                          1       1           1       1               2                               0');
  lines.push('Target material : Number of Elements & Layers');
  lines.push(`"${config.title}"       ${nElem}               ${nLayers}`);
  // 2-line Target Energies (eV) block present in authentic TRIM.IN, Trim.d00..d11, and Al2O3_Si.sim
  lines.push('Target Energies (eV): Binding, Surface, Individual Displacement');
  const meanEb =
    targetElements.reduce((acc, el) => acc + (el.latticeBindingEv || 3.0), 0) / nElem;
  const meanEs =
    targetElements.reduce((acc, el) => acc + (el.surfaceBindingEv || 2.1), 0) / nElem;
  const edsStr = targetElements
    .map((el) => (el.displacementEv || 15.0).toString())
    .join('            ');
  lines.push(` ${meanEb.toFixed(1)}           ${meanEs.toFixed(1)}           ${edsStr} `);
  lines.push('PlotType (0-5); Plot Depths: Xmin, Xmax(Ang.) [=0 0 for Viewing Full Target]');
  lines.push(`       ${config.plotType || 0}                         ${config.plotXMinA || 0}          ${config.plotXMaxA || 0}`);
  lines.push('Target Elements:    Z   Mass(amu)');

  targetElements.forEach((el, idx) => {
    lines.push(
      `Atom ${idx + 1} = ${el.symbol} =       ${el.z}   ${el.massAmu.toFixed(3)}`
    );
  });

  const stoichHeaderCols = targetElements
    .map((el) => `${el.symbol} Stoich`)
    .join('  ');
  lines.push(`Layer   Layer Name /               Width Density    ${stoichHeaderCols}`);
  lines.push('Numb.   Description                (Ang) (g/cm3)');

  let elemCursor = 0;
  config.layers.forEach((layer, lIdx) => {
    const stoichVec = new Array<number>(nElem).fill(0);
    for (let k = 0; k < layer.elements.length; k++) {
      stoichVec[elemCursor + k] = layer.elements[k].stoich;
    }
    elemCursor += layer.elements.length;
    const paddedName = layer.name.padEnd(23, ' ');
    const stoichStr = stoichVec.map((s) => s.toPrecision(5)).join('  ');
    lines.push(
      ` ${lIdx + 1}      "${paddedName}"  ${layer.widthA}  ${layer.densityGPerCm3}    ${stoichStr}`
    );
  });

  lines.push('0  Target layer phases (0=Solid, 1=Gas)');
  lines.push(config.layers.map((l) => l.phase).join('  '));
  lines.push('Target Compound Corrections (Bragg)');
  lines.push(config.layers.map((l) => l.compoundCorr).join('  '));
  lines.push('Individual target atom displacement energies (eV)');
  lines.push('  ' + targetElements.map((el) => el.displacementEv).join('  '));
  lines.push('Individual target atom lattice binding energies (eV)');
  lines.push('  ' + targetElements.map((el) => el.latticeBindingEv).join('  '));
  lines.push('Individual target atom surface binding energies (eV)');
  lines.push('  ' + targetElements.map((el) => el.surfaceBindingEv).join('  '));
  lines.push('Stopping Power Version (1=1998, 0=1998)');
  lines.push(' 0 ');
  lines.push('');

  return lines.join('\r\n');
}

/**
 * Parses a TRIM.IN string into a TrimSetupConfig.
 */
export function parseTrimIn(rawText: string): TrimSetupConfig {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const ionHeaderIdx = lines.findIndex((l) => l.toLowerCase().startsWith('ion:'));
  const ionParts = (lines[ionHeaderIdx >= 0 ? ionHeaderIdx + 1 : 2] || '').split(/\s+/);
  const z1 = Math.max(1, Math.min(92, Math.round(parseFortranFloat(ionParts[0], 6))));
  const ionEl = getElementByZ(z1);
  const massAmu = parseFortranFloat(ionParts[1], ionEl.naturalWeight);
  const energyKeV = parseFortranFloat(ionParts[2], 10.0);
  const angleDeg = parseFortranFloat(ionParts[3], 0.0);
  const totalIons = Math.max(1, Math.round(parseFortranFloat(ionParts[4], 1000)));
  const braggCorrection = parseFortranFloat(ionParts[5], 1.0);
  const autoSaveNumber = Math.round(parseFortranFloat(ionParts[6], 10000));

  const cascadesHeaderIdx = lines.findIndex((l) => l.toLowerCase().startsWith('cascades'));
  const modeParts = (lines[cascadesHeaderIdx >= 0 ? cascadesHeaderIdx + 1 : 4] || '').split(/\s+/);
  const rawMode = Math.round(parseFortranFloat(modeParts[0], 1));
  const calculationMode: TrimCalcMode =
    rawMode === 2 ? 2 : rawMode === 3 ? 3 : rawMode === 4 || rawMode === 5 ? 4 : 1;
  const randomSeed = Math.round(parseFortranFloat(modeParts[1], 98765)) || 98765;

  const targetMatIdx = lines.findIndex((l) => l.toLowerCase().startsWith('target material'));
  const targetMatLine = lines[targetMatIdx >= 0 ? targetMatIdx + 1 : 8] || '';
  const titleMatch = targetMatLine.match(/^"([^"]*)"\s+(\d+)\s+(\d+)/);
  const title = titleMatch ? titleMatch[1].trim() : 'TRIM Simulation';
  const numElem = titleMatch ? Math.max(1, parseInt(titleMatch[2], 10)) : 1;
  const numLayers = titleMatch ? Math.max(1, parseInt(titleMatch[3], 10)) : 1;

  // Locate "Target Elements:" line dynamically
  let targetHeaderIdx = lines.findIndex((l) =>
    l.toLowerCase().startsWith('target elements')
  );
  if (targetHeaderIdx < 0) targetHeaderIdx = 11;

  const plotParts = (lines[targetHeaderIdx - 1] || '').split(/\s+/);
  const plotType = Math.round(parseFortranFloat(plotParts[0], 0));
  const plotXMinA = parseFortranFloat(plotParts[1], 0);
  const plotXMaxA = parseFortranFloat(plotParts[2], 0);

  const rawAtoms: { z: number; massAmu: number }[] = [];
  for (let k = 0; k < numElem; k++) {
    const line = lines[targetHeaderIdx + 1 + k] || '';
    const rhs = line.split('=').pop() || '';
    const parts = rhs.trim().split(/\s+/);
    const z = Math.max(1, Math.min(92, Math.round(parseFortranFloat(parts[0], 14))));
    const elInfo = getElementByZ(z);
    const mass = parseFortranFloat(parts[1], elInfo.naturalWeight);
    rawAtoms.push({ z, massAmu: mass });
  }

  // Find layer table start
  const layerTableIdx = lines.findIndex(
    (l, idx) =>
      l.toLowerCase().startsWith('layer') &&
      (lines[idx + 1] || '').toLowerCase().startsWith('numb')
  );
  const layerStartIdx =
    layerTableIdx >= 0 ? layerTableIdx + 2 : targetHeaderIdx + 1 + numElem + 2;

  const rawLayers: {
    name: string;
    widthA: number;
    densityGPerCm3: number;
    stoichs: number[];
  }[] = [];

  for (let lIdx = 0; lIdx < numLayers; lIdx++) {
    const lStr = lines[layerStartIdx + lIdx] || '';
    const m = lStr.match(/^\d+\s+"([^"]*)"\s+(.*)$/);
    let lname = `Layer ${lIdx + 1}`;
    let nums: number[] = [];
    if (m) {
      lname = m[1].trim() || lname;
      nums = m[2]
        .trim()
        .split(/\s+/)
        .map((x) => parseFortranFloat(x, 0));
    } else {
      const parts = lStr.split(/\s+/);
      lname = parts[1] ? parts[1].replace(/"/g, '') : lname;
      nums = parts.slice(2).map((x) => parseFortranFloat(x, 0));
    }
    const widthA = nums[0] || 1000.0;
    const densityGPerCm3 = nums[1] || 2.3212;
    const stoichs = nums.slice(2, 2 + numElem);
    while (stoichs.length < numElem) stoichs.push(0);
    rawLayers.push({ name: lname, widthA, densityGPerCm3, stoichs });
  }

  const findValueLineAfterKeyword = (keyword: string, fallbackIdx: number): string => {
    const startSearch = layerStartIdx + numLayers;
    const offset = lines
      .slice(startSearch)
      .findIndex((l) => l.toLowerCase().includes(keyword.toLowerCase()));
    if (offset >= 0 && startSearch + offset + 1 < lines.length) {
      return lines[startSearch + offset + 1];
    }
    return lines[fallbackIdx] || '';
  };

  const pIdx = layerStartIdx + numLayers;
  const phases = findValueLineAfterKeyword('phases', pIdx + 1)
    .split(/\s+/)
    .map((x) => (Math.round(parseFortranFloat(x, 0)) === 1 ? 1 : 0) as 0 | 1);
  const braggCorrs = findValueLineAfterKeyword('compound', pIdx + 3)
    .split(/\s+/)
    .map((x) => parseFortranFloat(x, 1.0));
  const eds = findValueLineAfterKeyword('displacement', pIdx + 5)
    .split(/\s+/)
    .map((x) => parseFortranFloat(x, 15.0));
  const ebs = findValueLineAfterKeyword('lattice', pIdx + 7)
    .split(/\s+/)
    .map((x) => parseFortranFloat(x, 3.0));
  const ess = findValueLineAfterKeyword('surface', pIdx + 9)
    .split(/\s+/)
    .map((x) => parseFortranFloat(x, 2.0));

  let curDepth = 0;
  const zones: { layerIndex: number; endDepthA: number }[] = [];
  const layers: TrimLayerConfig[] = rawLayers.map((rl, lIdx) => {
    curDepth += rl.widthA;
    zones.push({ layerIndex: lIdx, endDepthA: curDepth });

    const elements: TrimElementConfig[] = [];
    for (let k = 0; k < numElem; k++) {
      if (rl.stoichs[k] > 0) {
        const z = rawAtoms[k].z;
        const elInfo = getElementByZ(z);
        elements.push({
          z,
          symbol: elInfo.symbol,
          name: elInfo.name,
          stoich: rl.stoichs[k],
          massAmu: rawAtoms[k].massAmu,
          displacementEv: eds[k] ?? 15.0,
          latticeBindingEv: ebs[k] ?? 3.0,
          surfaceBindingEv: ess[k] ?? 2.0,
        });
      }
    }
    if (elements.length === 0) {
      const elInfo = getElementByZ(rawAtoms[0].z);
      elements.push({
        z: rawAtoms[0].z,
        symbol: elInfo.symbol,
        name: elInfo.name,
        stoich: 1.0,
        massAmu: rawAtoms[0].massAmu,
        displacementEv: eds[0] ?? 15.0,
        latticeBindingEv: ebs[0] ?? 3.0,
        surfaceBindingEv: ess[0] ?? 2.0,
      });
    }

    return {
      id: `layer-${lIdx + 1}`,
      name: rl.name,
      widthA: rl.widthA,
      densityGPerCm3: rl.densityGPerCm3,
      phase: phases[lIdx] ?? 0,
      compoundCorr: braggCorrs[lIdx] ?? 1.0,
      elements,
    };
  });

  return {
    title,
    ion: {
      z1,
      symbol: ionEl.symbol,
      name: ionEl.name,
      massAmu,
      energyKeV,
      angleDeg,
    },
    calculationMode,
    totalIons,
    randomSeed,
    braggCorrection,
    autoSaveNumber,
    plotType,
    plotXMinA,
    plotXMaxA: plotXMaxA > 0 ? plotXMaxA : curDepth,
    zones,
    layers,
  };
}

/**
 * Generates an official SR.IN control file for SRModule.exe.
 */
export function generateSrIn(input: SRInput): string {
  const lines: string[] = [];
  lines.push('---Stopping/Range Input Data (Number-format: Period = Decimal Point)');
  lines.push('---Output File Name');
  lines.push(`"${input.outputFilename || 'SR_OUTPUT.TXT'}"`);
  lines.push('---Ion(Z), Ion Mass(u)');
  lines.push(`${input.z1}   ${input.m1}`);
  lines.push('---Target Data: (Solid=0,Gas=1), Density(g/cm3), Compound Corr.');
  lines.push(`${input.phase}    ${input.densityGPerCm3}    ${input.compoundCorr}`);
  lines.push('---Number of Target Elements');
  lines.push(`${input.elements.length}`);
  lines.push('---Target Elements: (Z), Target name, Stoich, Target Mass(u)');
  for (const el of input.elements) {
    lines.push(`${el.z}   "${el.name}"               ${el.stoich}             ${el.mass}`);
  }
  lines.push('---Output Stopping Units (1-8)');
  lines.push(` ${input.unit}`);
  lines.push('---Ion Energy : E-Min(keV), E-Max(keV)');
  const isCustom =
    (input.eMinKeV === 0 && input.eMaxKeV === 0) ||
    Boolean(input.customEnergiesKeV && input.customEnergiesKeV.length > 0);
  if (isCustom && input.customEnergiesKeV && input.customEnergiesKeV.length > 0) {
    lines.push(' 0    0');
    for (const e of input.customEnergiesKeV) {
      lines.push(` ${e}`);
    }
    lines.push(' 0');
  } else {
    lines.push(` ${input.eMinKeV}    ${input.eMaxKeV}`);
  }
  lines.push('');
  return lines.join('\r\n');
}

/**
 * Parses an official SR.IN control file into SRInput.
 */
export function parseSrIn(rawText: string): SRInput {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const outputFilename = (lines[2] || '"SR_OUTPUT.TXT"').replace(/"/g, '').trim();
  const ionParts = (lines[4] || '1 1.008').split(/\s+/);
  const z1 = Math.max(1, Math.min(92, Math.round(parseFortranFloat(ionParts[0], 1))));
  const m1 = parseFortranFloat(ionParts[1], getElementByZ(z1).naturalWeight);

  const targetParts = (lines[6] || '0 2.3212 1.0').split(/\s+/);
  const phase = (Math.round(parseFortranFloat(targetParts[0], 0)) === 1 ? 1 : 0) as 0 | 1;
  const densityGPerCm3 = parseFortranFloat(targetParts[1], 2.3212);
  const compoundCorr = parseFortranFloat(targetParts[2], 1.0);

  const nElem = Math.max(1, Math.round(parseFortranFloat(lines[8], 1)));
  const elements: SRInput['elements'] = [];
  for (let i = 0; i < nElem; i++) {
    const l = lines[10 + i] || '';
    const m = l.match(/^(\d+)\s+"([^"]*)"\s+(.*)$/);
    if (m) {
      const z = Math.max(1, Math.min(92, parseInt(m[1], 10)));
      const name = m[2].trim();
      const rest = m[3].trim().split(/\s+/);
      const stoich = parseFortranFloat(rest[0], 1.0);
      const mass = parseFortranFloat(rest[1], getElementByZ(z).naturalWeight);
      elements.push({ z, symbol: getElementByZ(z).symbol, name, stoich, mass });
    } else {
      const parts = l.split(/\s+/);
      const z = Math.max(1, Math.min(92, Math.round(parseFortranFloat(parts[0], 14))));
      const elInfo = getElementByZ(z);
      elements.push({
        z,
        symbol: elInfo.symbol,
        name: elInfo.name,
        stoich: parseFortranFloat(parts[2], 1.0),
        mass: parseFortranFloat(parts[3], elInfo.naturalWeight),
      });
    }
  }

  const unitIdx = 10 + nElem + 1;
  const unitRaw = Math.round(parseFortranFloat(lines[unitIdx], 1));
  const unit: StoppingUnit =
    unitRaw >= 1 && unitRaw <= 8 ? (unitRaw as StoppingUnit) : 1;

  const eRangeIdx = unitIdx + 2;
  const eParts = (lines[eRangeIdx] || '10 1000').split(/\s+/);
  const eMinKeV = parseFortranFloat(eParts[0], 10);
  const eMaxKeV = parseFortranFloat(eParts[1], 1000);

  let customEnergiesKeV: number[] | undefined;
  if (eMinKeV === 0 && eMaxKeV === 0) {
    customEnergiesKeV = [];
    for (let k = eRangeIdx + 1; k < lines.length; k++) {
      const val = parseFortranFloat(lines[k], 0);
      if (val <= 0) break;
      customEnergiesKeV.push(val);
    }
  }

  return {
    title: outputFilename,
    z1,
    m1,
    elements,
    densityGPerCm3,
    phase,
    compoundCorr,
    unit,
    eMinKeV,
    eMaxKeV,
    customEnergiesKeV,
    outputFilename,
  };
}

/**
 * Generates a SRIMKorea .sim file from TrimSetupConfig.
 * In SRIMKorea (Al2O3_Si.sim), .sim files are authentic TRIM.IN files with Target Energies (eV).
 */
export function generateSimFile(config: TrimSetupConfig): string {
  return generateTrimIn(config);
}

/**
 * Parses a SRIMKorea .sim file into TrimSetupConfig.
 * Supports both authentic TRIM.IN format (like Al2O3_Si.sim) and legacy CSV-based formats.
 */
export function parseSimFile(rawText: string): TrimSetupConfig {
  const trimmed = rawText.trim();
  if (
    trimmed.startsWith('=== TRIM.IN') ||
    trimmed.startsWith('==>') ||
    trimmed.toLowerCase().includes('cascades(') ||
    trimmed.toLowerCase().includes('target material')
  ) {
    return parseTrimIn(rawText);
  }

  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const line0 = (lines[0] || '6, 12.011, 10').split(',').map((s) => s.trim());
  const z1 = Math.max(1, Math.min(92, Math.round(parseFortranFloat(line0[0], 6))));
  const ionEl = getElementByZ(z1);
  const massAmu = parseFortranFloat(line0[1], ionEl.naturalWeight);
  const energyKeV = parseFortranFloat(line0[2], 10.0);

  const line1 = (lines[1] || '0, 1000, 1').split(',').map((s) => s.trim());
  const angleDeg = parseFortranFloat(line1[0], 0.0);
  const totalIons = Math.max(1, Math.round(parseFortranFloat(line1[1], 1000)));
  const rawMode = Math.round(parseFortranFloat(line1[2], 1));
  const calculationMode: TrimCalcMode =
    rawMode >= 1 && rawMode <= 4 ? (rawMode as TrimCalcMode) : 1;

  const zoneDepths: { layerIdx: number; endDepthA: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const zp = (lines[2 + i] || '0, 0').split(',').map((s) => s.trim());
    const lIdx = Math.round(parseFortranFloat(zp[0], 0));
    const endD = parseFortranFloat(zp[1], 0);
    if (lIdx > 0 && endD > 0) {
      zoneDepths.push({ layerIdx: lIdx - 1, endDepthA: endD });
    }
  }

  const layers: TrimLayerConfig[] = [];
  let prevDepth = 0;
  for (let i = 0; i < 5; i++) {
    const baseLineIdx = 7 + i * 5;
    if (baseLineIdx >= lines.length) break;
    const lp = lines[baseLineIdx].split(',').map((s) => s.replace(/"/g, '').trim());
    const lname = lp[0] || `Layer ${i + 1}`;
    const density = parseFortranFloat(lp[1], 0);
    const compCorr = parseFortranFloat(lp[2], 1.0) || 1.0;
    const phase = (Math.round(parseFortranFloat(lp[3], 0)) === 1 ? 1 : 0) as 0 | 1;

    const elements: TrimElementConfig[] = [];
    for (let j = 0; j < 4; j++) {
      const ep = (lines[baseLineIdx + 1 + j] || '')
        .split(',')
        .map((s) => s.replace(/"/g, '').trim());
      const ez = Math.round(parseFortranFloat(ep[0], 0));
      const stoich = parseFortranFloat(ep[2], 0);
      if (ez >= 1 && ez <= 92 && stoich > 0) {
        const elInfo = getElementByZ(ez);
        elements.push({
          z: ez,
          symbol: ep[1] || elInfo.symbol,
          name: elInfo.name,
          stoich,
          massAmu: parseFortranFloat(ep[3], elInfo.naturalWeight),
          displacementEv: parseFortranFloat(ep[4], 15.0),
          latticeBindingEv: parseFortranFloat(ep[5], 3.0),
          surfaceBindingEv: parseFortranFloat(ep[6], 2.0),
        });
      }
    }

    if (elements.length > 0 && density > 0) {
      const zMatch = zoneDepths.find((z) => z.layerIdx === i);
      const endD = zMatch ? zMatch.endDepthA : prevDepth + 1000;
      const widthA = Math.max(1, endD - prevDepth);
      prevDepth = endD;
      layers.push({
        id: `sim-layer-${i + 1}`,
        name: lname,
        widthA,
        densityGPerCm3: density,
        phase,
        compoundCorr: compCorr,
        elements,
      });
    }
  }

  return {
    title: `${ionEl.symbol} (${energyKeV} keV) into ${layers.map((l) => l.name).join(' / ')}`,
    ion: {
      z1,
      symbol: ionEl.symbol,
      name: ionEl.name,
      massAmu,
      energyKeV,
      angleDeg,
    },
    calculationMode,
    totalIons,
    randomSeed: 98765,
    braggCorrection: 1.0,
    autoSaveNumber: 10000,
    plotType: 0,
    plotXMinA: 0,
    plotXMaxA: prevDepth || 1000,
    zones: layers.map((_, idx) => ({
      layerIndex: idx,
      endDepthA: layers.slice(0, idx + 1).reduce((a, b) => a + b.widthA, 0),
    })),
    layers,
  };
}

/**
 * Generates an official TRIM.DAT custom recoil cascade event file (10 header lines + data rows).
 */
export function generateTrimDat(
  title: string,
  events: TrimCustomDatEvent[]
): string {
  const lines: string[] = [
    `TRIM.DAT : ${title}`,
    '==============================================================================',
    'Custom recoil/ion event kinetics file for TRIM Calculation Mode 4.',
    'Format: 10 header lines followed by space-delimited event lines:',
    'EventName(5 chars)  Z1  Energy(eV)  X(A)  Y(A)  Z(A)  CosX  CosY  CosZ',
    '------------------------------------------------------------------------------',
    'Units: Energy in eV, Coordinates (X=Depth, Y, Z) in Angstroms.',
    'Directional Cosines: CosX^2 + CosY^2 + CosZ^2 = 1.0',
    '==============================================================================',
    'Event   Z1    Energy(eV)       X(A)         Y(A)         Z(A)       CosX       CosY       CosZ',
  ];

  for (const ev of events) {
    const nameStr = (ev.name || 'EV001').slice(0, 5).padEnd(5, ' ');
    lines.push(
      `${nameStr}  ${String(ev.z1).padStart(3, ' ')}  ${ev.energyEv.toFixed(2).padStart(12, ' ')}  ${ev.xA.toFixed(2).padStart(11, ' ')}  ${ev.yA.toFixed(2).padStart(11, ' ')}  ${ev.zA.toFixed(2).padStart(11, ' ')}  ${ev.cosX.toFixed(6).padStart(9, ' ')}  ${ev.cosY.toFixed(6).padStart(9, ' ')}  ${ev.cosZ.toFixed(6).padStart(9, ' ')}`
    );
  }
  lines.push('');
  return lines.join('\r\n');
}

/**
 * Parses a TRIM.DAT file (skipping 10 header lines or comment lines) into TrimCustomDatEvent[].
 */
export function parseTrimDat(rawText: string): TrimCustomDatEvent[] {
  const allLines = rawText.replace(/\r\n/g, '\n').split('\n');
  const dataLines = allLines.length > 10 ? allLines.slice(10) : allLines;
  const events: TrimCustomDatEvent[] = [];

  for (const rawLine of dataLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('=') || line.startsWith('-')) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const name = parts[0].slice(0, 5);
    const z1 = Math.max(1, Math.min(92, Math.round(parseFortranFloat(parts[1], 6))));
    const energyEv = parseFortranFloat(parts[2], 1000);
    const xA = parseFortranFloat(parts[3], 0);
    const yA = parseFortranFloat(parts[4], 0);
    const zA = parseFortranFloat(parts[5], 0);
    const cosX = parseFortranFloat(parts[6], 1);
    const cosY = parseFortranFloat(parts[7], 0);
    const cosZ = parseFortranFloat(parts[8], 0);
    events.push({ name, z1, energyEv, xA, yA, zA, cosX, cosY, cosZ });
  }
  return events;
}

/**
 * Generates all 12+ official SRIM/TRIM .TXT output files from a simulation snapshot.
 */
export function generateAllTrimOutputs(
  config: TrimSetupConfig,
  snap: TrimSnapshot
): Record<string, string> {
  const headerBanner = [
    '==============================================================================',
    '                  SRIM-2003.20 / SRIM-Web Simulation Output                   ',
    '==============================================================================',
    `Title            : ${config.title}`,
    `Ion              : ${config.ion.symbol} (Z1 = ${config.ion.z1}, Mass = ${config.ion.massAmu.toFixed(3)} amu)`,
    `Ion Energy       : ${config.ion.energyKeV.toFixed(3)} keV   Incidence Angle = ${config.ion.angleDeg.toFixed(2)} deg`,
    `Completed Ions   : ${snap.completedIons} / ${config.totalIons}   (Calculation Mode = ${config.calculationMode})`,
    '------------------------------------------------------------------------------',
  ].join('\r\n');

  // 1. TDATA.TXT
  const tdataTxt = [
    headerBanner,
    `Ion Longitudinal Range    = ${snap.rangeMoments.meanA.toFixed(2)} A   Straggling = ${snap.rangeMoments.stragglingA.toFixed(2)} A`,
    `Range Skewness            = ${snap.rangeMoments.skewness.toFixed(4)}     Kurtosis   = ${snap.rangeMoments.kurtosis.toFixed(4)}`,
    `Ion Radial Range          = ${snap.radialMoments.meanA.toFixed(2)} A   Straggling = ${snap.radialMoments.stragglingA.toFixed(2)} A`,
    `Ion Lateral Range         = ${snap.lateralMoments.meanA.toFixed(2)} A   Straggling = ${snap.lateralMoments.stragglingA.toFixed(2)} A`,
    `Backscattered Ions        = ${snap.backscatteredCount} (${((snap.backscatteredCount * 100) / Math.max(1, snap.completedIons)).toFixed(2)} %)`,
    `Transmitted Ions          = ${snap.transmittedCount} (${((snap.transmittedCount * 100) / Math.max(1, snap.completedIons)).toFixed(2)} %)`,
    `Total Vacancies / Ion     = ${snap.vacanciesPerIon.toFixed(2)}`,
    `Replacement Collisions    = ${snap.replacementsPerIon.toFixed(2)} / Ion`,
    `Total Sputtering Yield    = ${snap.sputteringYield.toFixed(4)} Atoms / Ion`,
    '------------------------------------------------------------------------------',
    'Energy Loss Partition (% of Total Ion Energy):',
    `  Ionization (Ions)       = ${snap.energyIonizByIonPct.toFixed(2)} %`,
    `  Ionization (Recoils)    = ${snap.energyIonizByRecoilPct.toFixed(2)} %`,
    `  Phonons (Ions)          = ${snap.energyPhononByIonPct.toFixed(2)} %`,
    `  Phonons (Recoils)       = ${snap.energyPhononByRecoilPct.toFixed(2)} %`,
    `  Binding Energy (Ions)   = ${snap.energyBindingByIonPct.toFixed(2)} %`,
    `  Binding Energy (Recoils)= ${snap.energyBindingByRecoilPct.toFixed(2)} %`,
    '',
  ].join('\r\n');

  // 2. RANGE.TXT
  const rangeRows = snap.binDepthsA.map((d, i) => {
    const ionVal = snap.histograms.ionRange[i] || 0;
    const recCols = snap.histograms.recoilRangeByElement
      .map((arr) => (arr[i] || 0).toExponential(4))
      .join('   ');
    return `${d.toFixed(2).padStart(10, ' ')}   ${ionVal.toExponential(4)}   ${recCols}`;
  });
  const rangeTxt = [
    headerBanner,
    'Final Distribution of Ions and Recoil Atoms',
    'Units = (atoms/cm3) / (atoms/cm2) = Atoms / cm',
    '    DEPTH       IONS         RECOIL ATOMS',
    '    (Ang)      (cm^-1)       (cm^-1)',
    ...rangeRows,
    '',
  ].join('\r\n');

  // 3. LATERAL.TXT
  const lateralRows = snap.binDepthsA.map((d, i) => {
    return `${d.toFixed(2).padStart(10, ' ')}   ${(snap.histograms.lateralY[i] || 0).toExponential(4)}   ${(snap.histograms.radialR[i] || 0).toExponential(4)}   ${(snap.histograms.lateralZ[i] || 0).toExponential(4)}`;
  });
  const lateralTxt = [
    headerBanner,
    'Lateral and Radial Range Profiles vs Depth',
    '    DEPTH      Lateral-Y      Radial-R       Lateral-Z',
    '    (Ang)        (Ang)          (Ang)          (Ang)',
    ...lateralRows,
    '',
  ].join('\r\n');

  // 4. E2RECOIL.TXT
  const e2RecRows = snap.binDepthsA.map((d, i) => {
    return `${d.toFixed(2).padStart(10, ' ')}   ${(snap.histograms.energyToRecoils[i] || 0).toExponential(4)}`;
  });
  const e2RecoilTxt = [
    headerBanner,
    'Energy Transferred from Ions to Target Recoil Atoms',
    'Units = eV / (Angstrom - Ion)',
    '    DEPTH     ENERGY TO RECOILS',
    ...e2RecRows,
    '',
  ].join('\r\n');

  // 5. IONIZ.TXT
  const ionizRows = snap.binDepthsA.map((d, i) => {
    return `${d.toFixed(2).padStart(10, ' ')}   ${(snap.histograms.ionizationIon[i] || 0).toExponential(4)}   ${(snap.histograms.ionizationRecoil[i] || 0).toExponential(4)}`;
  });
  const ionizTxt = [
    headerBanner,
    'Ionization Energy Loss by Ions and Recoil Cascades',
    'Units = eV / (Angstrom - Ion)',
    '    DEPTH     IONIZATION(IONS)  IONIZATION(RECOILS)',
    ...ionizRows,
    '',
  ].join('\r\n');

  // 6. PHONON.TXT
  const phononRows = snap.binDepthsA.map((d, i) => {
    return `${d.toFixed(2).padStart(10, ' ')}   ${(snap.histograms.phononsIon[i] || 0).toExponential(4)}   ${(snap.histograms.phononsRecoil[i] || 0).toExponential(4)}`;
  });
  const phononTxt = [
    headerBanner,
    'Phonon Energy Production by Ions and Recoil Cascades',
    'Units = eV / (Angstrom - Ion)',
    '    DEPTH      PHONONS(IONS)     PHONONS(RECOILS)',
    ...phononRows,
    '',
  ].join('\r\n');

  // 7. VACANCY.TXT
  const vacRows = snap.binDepthsA.map((d, i) => {
    const totVac =
      (snap.histograms.vacanciesIon[i] || 0) +
      (snap.histograms.vacanciesRecoil[i] || 0);
    return `${d.toFixed(2).padStart(10, ' ')}   ${(snap.histograms.vacanciesIon[i] || 0).toExponential(4)}   ${(snap.histograms.vacanciesRecoil[i] || 0).toExponential(4)}   ${totVac.toExponential(4)}`;
  });
  const vacancyTxt = [
    headerBanner,
    'Target Vacancies Produced by Ions and Recoil Cascades',
    'Units = Vacancies / (Angstrom - Ion)',
    '    DEPTH     VACANCIES(IONS)  VACANCIES(RECOILS)  TOTAL VACANCIES',
    ...vacRows,
    '',
  ].join('\r\n');

  // 8. NOVAC.TXT
  const novacRows = snap.binDepthsA.map((d, i) => {
    return `${d.toFixed(2).padStart(10, ' ')}   ${(snap.histograms.replacements[i] || 0).toExponential(4)}   ${(snap.histograms.interstitials[i] || 0).toExponential(4)}`;
  });
  const novacTxt = [
    headerBanner,
    'Replacement Collisions and Interstitial Atoms vs Depth',
    'Units = Number / (Angstrom - Ion)',
    '    DEPTH      REPLACEMENTS     INTERSTITIALS',
    ...novacRows,
    '',
  ].join('\r\n');

  // 9. RANGE_3D.TXT (Stopped ions 3D coordinates matching SRIM Outputs\RANGE_3D.txt)
  const range3dRows = snap.stoppedIons.map(
    (r) =>
      ` ${String(r.ionNumber).padStart(6, ' ')}   ${r.xA.toFixed(2).padStart(11, ' ')} ${r.yA.toFixed(2).padStart(11, ' ')} ${r.zA.toFixed(2).padStart(11, ' ')}`
  );
  const range3dTxt = [
    headerBanner,
    '====== SRIM Outputs\\RANGE_3D.txt : File of Final Ion Positions =====',
    '',
    `Ion = ${config.ion.symbol} (${config.ion.z1})   Ion Mass= ${config.ion.massAmu.toFixed(4)}`,
    `Energy  = ${config.ion.energyKeV} keV`,
    `Ion Angle to Surface = ${config.ion.angleDeg} degrees`,
    'Ion       Depth  X   Lateral Y   Lateral Z',
    'Number    (Angstrom) (Angstrom)  (Angstrom)',
    '-------  ----------- ----------- -----------',
    ...range3dRows,
    '',
  ].join('\r\n');

  const formatIonRecords = (
    prefix: string,
    titleLine: string,
    records: TrimSnapshot['transmittedIons']
  ) => {
    const rows = records.map(
      (r) =>
        `${prefix} ${String(r.ionNumber).padStart(5, ' ')}  ${String(r.z1).padStart(3, ' ')}  ${r.energyEv.toExponential(4)}  ${r.xA.toFixed(2).padStart(10, ' ')}  ${r.yA.toFixed(2).padStart(10, ' ')}  ${r.zA.toFixed(2).padStart(10, ' ')}  ${r.cosX.toFixed(6).padStart(9, ' ')}  ${r.cosY.toFixed(6).padStart(9, ' ')}  ${r.cosZ.toFixed(6).padStart(9, ' ')}`
    );
    return [
      headerBanner,
      titleLine,
      '=  Column #1: S= Sputtered Atom, B= Backscattered Ion, T= Transmitted Ion.   =',
      ' Ion  Atom   Energy        Depth       Lateral-Position        Atom Direction',
      ' Numb Numb    (eV)          X(A)        Y(A)       Z(A)      Cos(X)  Cos(Y) Cos(Z)',
      ...rows,
      '',
    ].join('\r\n');
  };

  const backscatTxt = formatIonRecords(
    'B',
    'BACKSCAT.TXT : Kinetics of Backscattered Ions Exiting Target Surface (X=0)',
    snap.backscatteredIons
  );
  const transmitTxt = formatIonRecords(
    'T',
    'TRANSMIT.TXT : Kinetics of Transmitted Ions Exiting Back of Target',
    snap.transmittedIons
  );

  // 12. SPUTTER.TXT
  const sputterRows = snap.sputteredAtoms.map(
    (s) =>
      `S ${String(s.ionNumber).padStart(6, ' ')}  ${String(s.z2).padStart(3, ' ')} (${s.symbol.padEnd(2, ' ')})  ${s.energyEv.toExponential(4)}  ${s.xA.toFixed(2).padStart(8, ' ')}  ${s.yA.toFixed(2).padStart(10, ' ')}  ${s.zA.toFixed(2).padStart(10, ' ')}  ${s.cosX.toFixed(6).padStart(9, ' ')}  ${s.cosY.toFixed(6).padStart(9, ' ')}  ${s.cosZ.toFixed(6).padStart(9, ' ')}`
  );
  const sputterTxt = [
    headerBanner,
    `SPUTTER.TXT : Sputtered Target Atoms (Total Yield = ${snap.sputteringYield.toFixed(4)} Atoms/Ion)`,
    'Type  IonNum   Z2        Energy(eV)      X(A)        Y(A)        Z(A)      CosX       CosY       CosZ',
    ...sputterRows,
    '',
  ].join('\r\n');

  // 13. COLLISON.TXT
  const colRows = snap.collisions.map(
    (c) =>
      ` ${String(c.ionNumber).padStart(5, ' ')}  ${c.energyKeV.toFixed(3).padStart(9, ' ')}  ${c.depthA.toFixed(1).padStart(9, ' ')}  ${c.yA.toFixed(1).padStart(8, ' ')}  ${c.zA.toFixed(1).padStart(8, ' ')}  ${c.seEvPerA.toFixed(3).padStart(8, ' ')}  ${c.symbol.padEnd(3, ' ')}  ${c.recoilEnergyEv.toFixed(1).padStart(10, ' ')}  ${c.displacements.toFixed(1).padStart(7, ' ')}  ${c.vacancies.toFixed(1).padStart(7, ' ')}  ${c.replacements.toFixed(1).padStart(6, ' ')}`
  );
  const collisonTxt = [
    headerBanner,
    'COLLISON.TXT : Detailed Ion-Target Binary Collision History Log',
    '  Ion#    E(keV)    Depth(A)     Y(A)      Z(A)   Se(eV/A)  Atom  Recoil(eV)     Disp     Vac    Repl',
    ...colRows,
    '',
  ].join('\r\n');

  return {
    'TDATA.TXT': tdataTxt,
    'RANGE.TXT': rangeTxt,
    'RANGE_3D.TXT': range3dTxt,
    'LATERAL.TXT': lateralTxt,
    'E2RECOIL.TXT': e2RecoilTxt,
    'IONIZ.TXT': ionizTxt,
    'PHONON.TXT': phononTxt,
    'VACANCY.TXT': vacancyTxt,
    'NOVAC.TXT': novacTxt,
    'BACKSCAT.TXT': backscatTxt,
    'TRANSMIT.TXT': transmitTxt,
    'SPUTTER.TXT': sputterTxt,
    'COLLISON.TXT': collisonTxt,
  };
}

const SR_UNIT_NAMES: Record<StoppingUnit, string> = {
  1: 'eV / Angstrom',
  2: 'keV / micron',
  3: 'MeV / mm',
  4: 'keV / (ug/cm2)',
  5: 'MeV / (mg/cm2)',
  6: 'keV / (mg/cm2)',
  7: 'eV / (1E15 atoms/cm2)',
  8: 'L.S.S. reduced units',
};

/**
 * Generates an official SRModule.exe Stopping & Range Table .TXT file.
 */
export function generateSrTableTxt(
  input: SRInput,
  rows: SRTableRow[]
): string {
  const ionEl = getElementByZ(input.z1);
  const totalStoich =
    input.elements.reduce((a, b) => a + Math.max(0, b.stoich), 0) || 1.0;
  let meanMass = 0.0;
  let meanZ2 = 0.0;
  for (const el of input.elements) {
    const f = Math.max(0, el.stoich) / totalStoich;
    meanMass += f * el.mass;
    meanZ2 += f * el.z;
  }
  const atomDensity = (input.densityGPerCm3 * 6.02214076e23) / meanMass;

  const lines: string[] = [
    '==============================================================================',
    '            SRIM version --- SRIM-2003.20 / SRIM-Web SR Module                ',
    '==============================================================================',
    `Ion = ${ionEl.name} [${input.z1}] , Mass = ${input.m1} amu`,
    `Target Density =  ${input.densityGPerCm3.toExponential(4)} g/cm3 = ${atomDensity.toExponential(4)} atoms/cm3`,
    `Target Phase   =  ${input.phase === 1 ? 'GAS' : 'SOLID'}   Bragg Compound Correction = ${input.compoundCorr.toFixed(4)}`,
    '======= Target Composition ========',
    '   Atom     Atom   Atomic    Mass',
    '   Name     Numb   Percent   Percent',
    '   ----     ----   -------   -------',
  ];

  const totalMass = input.elements.reduce(
    (a, b) => a + Math.max(0, b.stoich) * b.mass,
    0
  ) || 1.0;
  for (const el of input.elements) {
    const atPct = (el.stoich * 100.0) / totalStoich;
    const wtPct = (el.stoich * el.mass * 100.0) / totalMass;
    lines.push(
      `   ${(el.symbol || getElementByZ(el.z).symbol).padEnd(6, ' ')}    ${String(el.z).padStart(2, ' ')}    ${atPct.toFixed(2).padStart(6, ' ')}    ${wtPct.toFixed(2).padStart(6, ' ')}`
    );
  }

  lines.push('====================================');
  lines.push(`  Stopping Units =  ${SR_UNIT_NAMES[input.unit]}`);
  lines.push('==============================================================================');
  lines.push(
    '  Ion        dE/dx      dE/dx     Projected  Longitudinal   Lateral'
  );
  lines.push(
    ' Energy      Elec.     Nuclear      Range     Straggling   Straggling'
  );
  lines.push(
    '--------------  ---------- ---------- ----------  ----------  ----------'
  );

  for (const r of rows) {
    const eStr =
      r.energyKeV >= 1000
        ? `${(r.energyKeV / 1000).toFixed(2).padStart(7, ' ')} MeV`
        : `${r.energyKeV.toFixed(2).padStart(7, ' ')} keV`;
    const rp = formatRangeWithAutoUnit(r.projectedRangeA).formatted.padStart(10, ' ');
    const ls = formatRangeWithAutoUnit(r.longitudinalStragglingA).formatted.padStart(10, ' ');
    const lats = formatRangeWithAutoUnit(r.lateralStragglingA).formatted.padStart(10, ' ');
    lines.push(
      ` ${eStr}   ${r.se.toExponential(3).padStart(10, ' ')} ${r.sn.toExponential(3).padStart(10, ' ')}  ${rp}  ${ls}  ${lats}`
    );
  }

  lines.push('-----------------------------------------------------------');
  lines.push(' Multiply Stopping by        for Stopping Units');
  lines.push(' --------------------        ------------------');
  const baseVal = convertStoppingUnit(
    1.0,
    input.unit,
    atomDensity,
    meanMass,
    input.z1,
    input.m1,
    meanZ2
  );
  for (let u = 1 as StoppingUnit; u <= 8; u = (u + 1) as StoppingUnit) {
    const targetVal = convertStoppingUnit(
      1.0,
      u,
      atomDensity,
      meanMass,
      input.z1,
      input.m1,
      meanZ2
    );
    const mult = baseVal > 0 ? targetVal / baseVal : 1.0;
    lines.push(`  ${mult.toExponential(4).padStart(14, ' ')}             ${SR_UNIT_NAMES[u]}`);
  }
  lines.push('==============================================================================');
  lines.push('');

  return lines.join('\r\n');
}
