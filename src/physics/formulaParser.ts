import scoef03Raw from '../data/scoef03.json';
import type { ScoefElement } from './types';

export interface ParsedFormulaElement {
  z: number;
  symbol: string;
  stoich: number;
}

const AVOGADRO = 6.02214076e23;

const elementByExactSymbol = new Map<string, ScoefElement>();
for (const el of scoef03Raw as ScoefElement[]) {
  elementByExactSymbol.set(el.symbol, el);
}

/**
 * Recursive-descent parser for chemical & thin-film formulas.
 * Supports decimals (Si0.7Ge0.3, Hf0.5Zr0.5O2), parenthesized groups ((SiO2)0.8(GeO2)0.2),
 * and standard stoichiometry (Si3N4, InGaZnO4).
 */
export function parseChemicalFormula(input: string): ParsedFormulaElement[] | null {
  const cleaned = input.replace(/\s+/g, '');
  if (!cleaned) return null;

  let pos = 0;

  const parseNumber = (): number | null => {
    const start = pos;
    let hasDot = false;
    while (pos < cleaned.length) {
      const ch = cleaned[pos];
      if (ch >= '0' && ch <= '9') {
        pos++;
      } else if (ch === '.' && !hasDot) {
        hasDot = true;
        pos++;
      } else {
        break;
      }
    }
    if (pos === start) return null;
    const val = Number(cleaned.slice(start, pos));
    if (!Number.isFinite(val) || val <= 0) return null;
    return val;
  };

  const parseGroup = (stopAtParen: boolean): Map<number, number> | null => {
    const counts = new Map<number, number>();
    let parsedAny = false;

    while (pos < cleaned.length) {
      const ch = cleaned[pos];
      if (stopAtParen && ch === ')') {
        pos++;
        return parsedAny ? counts : null;
      }

      if (ch === '(') {
        pos++;
        const inner = parseGroup(true);
        if (!inner) return null;
        const mult = parseNumber() ?? 1;
        for (const [z, amt] of inner.entries()) {
          counts.set(z, (counts.get(z) ?? 0) + amt * mult);
        }
        parsedAny = true;
      } else if (ch >= 'A' && ch <= 'Z') {
        const start = pos;
        pos++;
        while (pos < cleaned.length && cleaned[pos] >= 'a' && cleaned[pos] <= 'z') {
          pos++;
        }
        const sym = cleaned.slice(start, pos);
        const elem = elementByExactSymbol.get(sym);
        if (!elem) return null;

        const mult = parseNumber() ?? 1;
        counts.set(elem.z, (counts.get(elem.z) ?? 0) + mult);
        parsedAny = true;
      } else {
        return null;
      }
    }

    if (stopAtParen) {
      // Unclosed '('
      return null;
    }
    return parsedAny ? counts : null;
  };

  const parsedMap = parseGroup(false);
  if (!parsedMap || parsedMap.size === 0 || pos !== cleaned.length) {
    return null;
  }

  const results: ParsedFormulaElement[] = [];
  for (const [z, rawStoich] of parsedMap.entries()) {
    const elem = (scoef03Raw as ScoefElement[]).find((e) => e.z === z);
    if (!elem) return null;
    results.push({
      z,
      symbol: elem.symbol,
      stoich: Number(rawStoich.toPrecision(6)),
    });
  }

  return results;
}

/**
 * Formats an element list into a compact empirical formula string (e.g., SiO2, Si0.7Ge0.3).
 */
export function formatFormulaString(
  elements: { symbol: string; stoich: number }[]
): string {
  if (!elements || elements.length === 0) return '';
  return elements
    .map((e) => {
      const s = Number(e.stoich.toFixed(4));
      if (Math.abs(s - 1) < 1e-6) return e.symbol;
      return `${e.symbol}${s}`;
    })
    .join('');
}

/**
 * Computes physical atomic density (atoms/cm³) from mass density (g/cm³) and stoichiometry.
 */
export function computeLayerAtomicDensity(
  densityGPerCm3: number,
  elements: { stoich: number; massAmu: number }[]
): number {
  if (densityGPerCm3 <= 0 || elements.length === 0) return 0;
  let totalStoich = 0;
  let totalMass = 0;
  for (const el of elements) {
    const st = Math.max(0, el.stoich);
    totalStoich += st;
    totalMass += st * Math.max(0.5, el.massAmu);
  }
  if (totalStoich <= 0 || totalMass <= 0) return 0;
  const meanMolarMass = totalMass / totalStoich;
  return (densityGPerCm3 * AVOGADRO) / meanMolarMass;
}
