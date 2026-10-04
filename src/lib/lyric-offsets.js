// A lyric offset the listener sets by hand belongs to the song: it is kept on this
// device for the song in any version (artist plus song key), the newest 300 songs.
// Zero is a choice too; a song with nothing saved follows automatic timing.
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
  if (!track || !storage) return null;
  return load(storage).find(([id]) => id === idOf(track))?.[1] ?? null;
}

export function clearOffset(track, storage = globalThis.localStorage) {
  saveOffset(track, null, storage);
}

export function saveOffset(track, offset, storage = globalThis.localStorage) {
  if (!track || !storage) return;
  try {
    const id = idOf(track);
    const list = load(storage).filter(([entry]) => entry !== id);
    if (Number.isFinite(offset)) list.push([id, Math.round(offset * 100) / 100]);
    storage.setItem(KEY, JSON.stringify(list.slice(-LIMIT)));
  } catch { /* Storage can be unavailable; the offset still applies for this play. */ }
}

// Lyrics are timed for one edit of a song. When the playing upload is longer or
// shorter than the catalogue version by more than rounding (a music video's intro,
// a radio or extended edit), it is a different edit: its own timing is asked for.
const SAME_EDIT = 1.5;
export function versionGap(upload, catalogue) {
  if (!(upload > 0) || !(catalogue > 0)) return 0;
  const gap = Math.round((upload - catalogue) * 10) / 10;
  return Math.abs(gap) > SAME_EDIT ? gap : 0;
}
