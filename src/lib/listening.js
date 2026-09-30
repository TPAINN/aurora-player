const KEY = 'aurora-listening';
const DAY = 86400000;
const identity = track => `${track.artist}|${track.title}`.normalize('NFKD').toLowerCase();
// A compact snapshot lets history seed radio and home without another lookup.
const snapshot = track => ({ id: String(track.id), title: track.title, artist: track.artist, album: track.album || '', artwork: track.artwork || '', duration: track.duration || 0, genre: track.genre, videoId: track.videoId });

function readHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(data) ? data.filter(item => typeof item?.artist === 'string' && typeof item?.key === 'string' && Number.isFinite(item.affinity) && Number.isFinite(item.at)).slice(-120) : [];
  } catch { return []; }
}
function append(entry) {
  const history = readHistory();
  history.push(entry);
  try { localStorage.setItem(KEY, JSON.stringify(history.slice(-120))); } catch { /* Playback never depends on storage. */ }
}

// Bounded preferences stay on this device; no account or telemetry.
export function recordListening(track, seconds, duration) {
  if (!track?.artist || track.localUrl || !Number.isFinite(seconds) || seconds < 5) return;
  const ratio = duration > 0 ? Math.min(1, seconds / duration) : Math.min(1, seconds / 180);
  const affinity = ratio >= .65 ? 2 : seconds < 30 ? -1 : 0.5;
  append({ key: identity(track), artist: track.artist.toLowerCase(), affinity, at: Date.now(), type: 'play', recommended: track.recommended === true, track: snapshot(track) });
}

export function recordLike(track) {
  if (!track?.artist || track.localUrl) return;
  append({ key: identity(track), artist: track.artist.toLowerCase(), affinity: 3, at: Date.now(), type: 'like', track: snapshot(track) });
}

// Keep following the current song, unless the listener keeps skipping what radio
// offers: then anchor on the freshest song they finished or liked.
export function pickSeed(current) {
  const history = readHistory();
  const plays = history.filter(item => item.type !== 'like').slice(-4);
  const skips = plays.filter(item => item.affinity < 0).length;
  if (skips >= 2) {
    const anchor = [...history].reverse().find(item => item.affinity >= 2 && item.track?.title && item.key !== identity(current));
    if (anchor) return { track: anchor.track, reason: `Because you loved “${anchor.track.title}”` };
  }
  return { track: current, reason: null };
}

export function tasteFilter(tracks) {
  const history = readHistory();
  const now = Date.now();
  const net = new Map();
  const recent = new Set();
  for (const item of history) {
    if (now - item.at < 14 * DAY) net.set(item.artist, (net.get(item.artist) || 0) + item.affinity);
    if (item.type !== 'like' && now - item.at < 3 * 3600000) recent.add(item.key);
  }
  return tracks.filter(track => (net.get(track.artist?.toLowerCase()) ?? 0) > -2 && !recent.has(identity(track)));
}

// Distinct artists the listener enjoys most (recency-weighted), newest song of each.
// Liked and recently played songs fill in when history has no usable songs yet.
export function homeSeeds(count = 2, fallback = []) {
  const seeds = historySeeds(count);
  const artists = new Set(seeds.map(track => track.artist?.toLowerCase()));
  for (const track of fallback) {
    if (seeds.length >= count) break;
    if (!track?.title || !track.artist || track.localUrl || artists.has(track.artist.toLowerCase())) continue;
    artists.add(track.artist.toLowerCase());
    seeds.push(track);
  }
  return seeds;
}

// Artist names by listening weight, for taste-shaped searches.
export function topArtists(count = 2, fallback = []) {
  const names = homeSeeds(count, fallback).map(track => track.artist);
  return [...new Set(names)].slice(0, count);
}

function historySeeds(count) {
  const now = Date.now();
  const artists = new Map();
  for (const item of readHistory()) {
    if (!item.track?.title) continue;
    const weight = item.affinity * Math.max(.2, 1 - (now - item.at) / (30 * DAY));
    const entry = artists.get(item.artist) || { score: 0, track: null, at: 0 };
    entry.score += weight;
    if (item.affinity >= 2 && item.at >= entry.at) { entry.track = item.track; entry.at = item.at; }
    artists.set(item.artist, entry);
  }
  return [...artists.values()].filter(entry => entry.score > 0 && entry.track).sort((a, b) => b.score - a.score || b.at - a.at).slice(0, count).map(entry => entry.track);
}

export function rankForTaste(tracks) {
  const history = readHistory();
  const now = Date.now();
  const score = track => {
    let value = track.lyricsAvailable === true ? 5 : 0;
    for (const item of history) {
      if (item.artist !== track.artist?.toLowerCase()) continue;
      const recency = Math.max(0, 1 - (now - item.at) / (30 * DAY));
      value += Math.max(-2, Math.min(3, item.affinity)) * recency * .2;
      if (item.key === identity(track) && now - item.at < DAY) value -= 4;
    }
    return value;
  };
  // Reorder only related candidates; never introduce unrelated taste matches.
  return tracks.map((track, index) => ({ track, score: score(track), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.track);
}
