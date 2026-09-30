import { readJson } from './recommendations.js';

const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const titleKey = value => fold(String(value || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/\s+-\s+(?:remaster|radio|live|explicit|clean|album|single|deluxe).*$/i, ''));

// Catalogue metadata only: an unknown tempo is returned as null, never estimated.
export async function fetchTempo({ artist, title }, { fetcher = fetch, signal = AbortSignal.timeout(5000) } = {}) {
  const deezer = path => readJson(new URL(path, 'https://api.deezer.com'), AbortSignal.any([signal, AbortSignal.timeout(2500)]), fetcher);
  const results = await deezer(`/search?q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}&limit=5`);
  const match = (results.data || []).find(item => Number.isSafeInteger(item.id) && fold(item.artist?.name) === fold(artist) && titleKey(item.title) === titleKey(title));
  if (!match) return { bpm: null };
  const track = await deezer(`/track/${match.id}`);
  const bpm = Number(track.bpm);
  return bpm >= 50 && bpm <= 220 ? { bpm: Math.round(bpm * 10) / 10, source: 'Deezer' } : { bpm: null };
}
