import type { TrimSetupConfig } from './types';

function toBase64Url(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  const binary = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  let s = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(s, 'base64').toString('utf-8');
  }

  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Encodes a TrimSetupConfig into a URL-safe hash fragment (#session=...).
 */
export function encodeConfigToHash(config: TrimSetupConfig): string {
  const jsonStr = JSON.stringify(config);
  const encoded = toBase64Url(jsonStr);
  return `#session=${encoded}`;
}

/**
 * Decodes a TrimSetupConfig from a URL hash string or raw payload.
 * Gracefully returns null if the payload is malformed or invalid.
 */
export function decodeConfigFromHash(hashOrPayload: string): TrimSetupConfig | null {
  if (!hashOrPayload || typeof hashOrPayload !== 'string') return null;

  let cleaned = hashOrPayload.trim();
  if (cleaned.startsWith('#')) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.startsWith('session=')) {
    cleaned = cleaned.slice('session='.length);
  }
  if (!cleaned) return null;

  try {
    const jsonStr = fromBase64Url(cleaned);
    const parsed = JSON.parse(jsonStr) as Partial<TrimSetupConfig>;

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.ion ||
      typeof parsed.ion.z1 !== 'number' ||
      typeof parsed.ion.energyKeV !== 'number' ||
      !Array.isArray(parsed.layers) ||
      parsed.layers.length === 0 ||
      typeof parsed.calculationMode !== 'number'
    ) {
      return null;
    }

    return parsed as TrimSetupConfig;
  } catch {
    return null;
  }
}
