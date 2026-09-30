// Audio-altering re-uploads are never chosen unless the catalogue title itself
// or the listener's own search asks for that version.
export const VARIANTS = [
  ['8d', /\b(?:8|16)\s?d\b|\b3d audio\b/],
  ['slowed', /\bslowed\b|\breverb\b/],
  ['sped up', /\bsped\s?up\b|\bspeed\s?up\b/],
  ['nightcore', /\bnightcore\b/],
  ['bass boosted', /\bbass\s?boost(?:ed)?\b/],
  ['loop', /\b\d+\s?(?:hour|hr)s?\b|\bloop(?:ed)?\b/],
];

const clean = value => String(value || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

export function requestedVariant(text) {
  const value = clean(text);
  return VARIANTS.find(([, pattern]) => pattern.test(value))?.[0] ?? '';
}
