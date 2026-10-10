import { paletteIdOf } from './palette-identity.js';

/**
 * Read the caller's actual generation palette, never UI/global palette preferences.
 * Identity follows the existing HEAD contract: explicit paletteId, or legacy code.
 * Entries remain the caller's real objects; no matching, filtering or RGB deduplication.
 */
export function resolveSmartTolerancePaletteContext({ paletteEntries, paletteKey } = {}) {
  if (typeof paletteKey !== 'string' || !paletteKey.trim()) {
    throw new TypeError('Smart tolerance requires an explicit paletteKey');
  }
  if (!Array.isArray(paletteEntries) || !paletteEntries.length) {
    throw new TypeError('Smart tolerance requires non-empty generation palette entries');
  }
  const paletteIds = [];
  const seen = new Set();
  for (let index = 0; index < paletteEntries.length; index += 1) {
    const entry = paletteEntries[index];
    if (!entry || typeof entry !== 'object' || typeof entry.code !== 'string' || !entry.code.trim()
      || !Array.isArray(entry.rgb) || entry.rgb.length !== 3
      || ![0, 1, 2].every(channel => typeof entry.rgb[channel] === 'number' && Number.isFinite(entry.rgb[channel]) && entry.rgb[channel] >= 0 && entry.rgb[channel] <= 255)
      || (entry.paletteId != null && (typeof entry.paletteId !== 'string' || !entry.paletteId.trim()))) {
      throw new TypeError(`Invalid smart tolerance palette entry at ${index}`);
    }
    const id = paletteIdOf(entry);
    if (!id || seen.has(id)) {
      throw new TypeError(`Missing or duplicate smart tolerance palette identity at ${index}`);
    }
    seen.add(id);
    paletteIds.push(id);
  }
  return { paletteEntries: [...paletteEntries], paletteIds, paletteKey };
}
