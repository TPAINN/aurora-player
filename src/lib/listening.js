const KEY = 'aurora-listening';
const identity = track => `${track.artist}|${track.title}`.normalize('NFKD').toLowerCase();

function readHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(data) ? data.filter(item => typeof item?.artist === 'string' && typeof item?.key === 'string' && Number.isFinite(item.affinity) && Number.isFinite(item.at)).slice(-120) : [];
  } catch { return []; }
}

// Bounded preferences stay on this device; no account or telemetry.
export function recordListening(track, seconds, duration) {
  if (!track?.artist || track.localUrl || !Number.isFinite(seconds) || seconds < 5) return;
  const ratio = duration > 0 ? Math.min(1, seconds / duration) : Math.min(1, seconds / 180);
  const affinity = ratio >= .65 ? 2 : seconds < 30 ? -1 : 0.5;
  const history = readHistory();
  history.push({ key: identity(track), artist: track.artist.toLowerCase(), affinity, at: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(history.slice(-120))); } catch { /* Playback never depends on storage. */ }
}

export function rankForTaste(tracks) {
  const history = readHistory();
  const now = Date.now();
  const score = track => {
    let value = track.lyricsAvailable === true ? 5 : 0;
    for (const item of history) {
      if (item.artist !== track.artist?.toLowerCase()) continue;
      const recency = Math.max(0, 1 - (now - item.at) / (30 * 86400000));
      value += Math.max(-2, Math.min(2, item.affinity)) * recency * .2;
      if (item.key === identity(track) && now - item.at < 86400000) value -= 4;
    }
    return value;
  };
  // Reorder only related candidates; never introduce unrelated taste matches.
  return tracks.map((track, index) => ({ track, score: score(track), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.track);
}
