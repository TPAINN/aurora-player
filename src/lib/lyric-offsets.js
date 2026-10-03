// A lyric offset the listener sets by hand belongs to the song: it is kept on this
// device for the song in any version (artist plus song key), the newest 300 songs.
import { songKey } from '../../shared/titles.js';

const KEY = 'aurora-lyric-offsets';
const LIMIT = 300;
const idOf = track => `${String(track?.artist || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '')}|${songKey(track?.title)}`;

function load(storage) {
  try {
    const list = JSON.parse(storage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(entry[1])) : [];
  } catch { return []; }
}

export function readOffset(track, storage = globalThis.localStorage) {
  if (!track || !storage) return 0;
  return load(storage).find(([id]) => id === idOf(track))?.[1] ?? 0;
}

export function saveOffset(track, offset, storage = globalThis.localStorage) {
  if (!track || !storage) return;
  try {
    const id = idOf(track);
    const list = load(storage).filter(([entry]) => entry !== id);
    if (offset) list.push([id, Math.round(offset * 100) / 100]);
    storage.setItem(KEY, JSON.stringify(list.slice(-LIMIT)));
  } catch { /* Storage can be unavailable; the offset still applies for this play. */ }
}
