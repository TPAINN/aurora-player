// Best parts from real evidence only, never guessed:
//   · replays — YouTube's "Most replayed" markers for the exact video playing,
//   · energy  — loudness measured across the whole song (device audio),
//   · lyrics  — refrains and held notes found in genuinely timed lyrics.
// Audio evidence decides which lyric peaks matter and adds instrumental peaks;
// a beat grid then lands every peak on the beat, lasting whole bars.

const THRESHOLD = 0.55; // a highlight: clearly above the song's typical moments
const KEEP = 0.35; // a lyric peak still counts when the audio around it is lively
const MIN_SECONDS = 8;
const GAP = 3;

const clamp = value => Math.min(1, Math.max(0, value));
const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;
};

// One value per second, 0 (typical) … 1 (the song's most replayed moment).
function replayCurve(replays, length) {
  if (!Array.isArray(replays) || !replays.length) return null;
  const curve = Array.from({ length }, (_, s) => replays.find(marker => s + 0.5 >= marker.start && s + 0.5 < marker.end)?.score ?? NaN);
  const low = percentile(curve, 0.5), high = Math.max(...curve.filter(Number.isFinite));
  if (!(high - low >= 0.15)) return null;
  return curve.map(value => (Number.isFinite(value) ? clamp((value - low) / (high - low)) : 0));
}

// One value per second, 0 (median loudness) … 1 (the loud sections), in dB.
function energyCurve(energy, length) {
  const { hop, levels } = energy || {};
  if (!(hop > 0) || !Array.isArray(levels) || !levels.length) return null;
  const db = Array.from({ length }, (_, s) => {
    const from = Math.floor(s / hop), to = Math.max(from + 1, Math.floor((s + 1) / hop));
    const slice = levels.slice(from, to);
    return slice.length ? 20 * Math.log10(Math.max(1e-5, Math.max(...slice))) : NaN;
  });
  const low = percentile(db, 0.5), high = percentile(db, 0.95);
  if (!(high - low >= 3)) return null; // a flat song has no section that stands out
  return db.map(value => (Number.isFinite(value) ? clamp((value - low) / (high - low)) : 0));
}

function excitement({ replays, energy, duration }) {
  const length = Math.ceil(duration || 0);
  if (!(length > 0)) return null;
  const heard = replayCurve(replays, length), loud = energyCurve(energy, length);
  if (!heard && !loud) return null;
  const raw = heard && loud ? heard.map((value, s) => 0.6 * value + 0.4 * loud[s]) : heard || loud;
  return raw.map((_, s) => (raw[Math.max(0, s - 1)] + raw[s] + raw[Math.min(raw.length - 1, s + 1)]) / 3);
}

const meanOver = (curve, { start, end }) => {
  const from = Math.max(0, Math.floor(start)), to = Math.min(curve.length, Math.ceil(end));
  let sum = 0;
  for (let s = from; s < to; s++) sum += curve[s];
  return to > from ? sum / (to - from) : 0;
};

function runs(curve) {
  const found = [];
  curve.forEach((value, s) => {
    if (value < THRESHOLD) return;
    const last = found.at(-1);
    if (last && s - last.end <= GAP) last.end = s + 1;
    else found.push({ start: s, end: s + 1 });
  });
  return found.filter(range => range.end - range.start >= MIN_SECONDS);
}

// The sections that stand out in the audio, most exciting first.
export function audioHighlights({ replays, energy, duration } = {}) {
  const curve = excitement({ replays, energy, duration });
  if (!curve) return [];
  return runs(curve)
    .map(range => ({ ...range, score: meanOver(curve, range) }))
    .sort((a, b) => b.score - a.score);
}

// On a measured grid (origin + period) the start moves to the nearest beat; with
// tempo alone the real start stays. Either way the peak lasts whole 4-beat bars.
export function snapToGrid(range, grid) {
  const period = grid?.period;
  if (!Number.isFinite(period) || period < 0.25 || period > 1.5) return range;
  const start = Number.isFinite(grid.origin) ? grid.origin + Math.round((range.start - grid.origin) / period) * period : range.start;
  const bar = 4 * period;
  // Round up: the peak releases on the bar line after its last word, never before
  // it; a hair past a line (under 8% of a bar) still ends on that line.
  return { start, end: start + Math.max(1, Math.ceil((range.end - start) / bar - 0.08)) * bar };
}

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const longest = ranges => ranges.reduce((best, range) => (!best || range.end - range.start > best.end - best.start + 1e-9 ? range : best), null);

function merge(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) { last.end = Math.max(last.end, range.end); last.strength = Math.max(last.strength ?? 0, range.strength ?? 0); }
    else merged.push({ start: range.start, end: range.end, ...(range.strength !== undefined ? { strength: range.strength } : {}) });
  }
  return merged;
}

// The song's peaks (for the backdrop and timeline) and its single best part.
// Each peak also says how strong it is (0.45 light … 1 strong), so the backdrop
// lifts as much as the moment deserves; with audio evidence, intensity(t) follows
// that evidence second by second inside a peak.
//   · with replays or loudness: from the evidence itself, relative to the song's
//     strongest moment;
//   · with timed lyrics alone: refrains build toward the last one (a song's final
//     chorus is usually its biggest), and the best part is the strongest.
export function bestMoments({ lyricPeaks = [], replays, energy, grid, duration } = {}) {
  const curve = excitement({ replays, energy, duration });
  const snap = range => ({ ...snapToGrid({ start: range.start, end: range.end }, grid), ...(range.strength !== undefined ? { strength: range.strength } : {}) });
  if (!curve) {
    const best = longest(lyricPeaks);
    const ordered = [...lyricPeaks].sort((a, b) => a.start - b.start);
    const strengthOf = range => (range === best ? 1 : ordered.length > 1 ? 0.6 + (0.3 * ordered.indexOf(range)) / (ordered.length - 1) : 0.85);
    return { peaks: merge(lyricPeaks.map(range => snap({ ...range, strength: strengthOf(range) }))), best: best && snap(best), intensity: null };
  }
  const intensity = time => {
    const at = Math.min(curve.length - 1, Math.max(0, time)), from = Math.floor(at), to = Math.min(curve.length - 1, from + 1);
    return curve[from] + (curve[to] - curve[from]) * (at - from);
  };
  const sung = lyricPeaks.map(range => ({ start: range.start, end: range.end, score: meanOver(curve, range) })).filter(range => range.score >= KEEP);
  const instrumental = runs(curve)
    .map(range => ({ ...range, score: meanOver(curve, range) }))
    .filter(range => !sung.some(peak => overlap(peak, range) >= 0.5 * (range.end - range.start)));
  const candidates = [...sung, ...instrumental];
  // Excitement first; length breaks near-ties up to about 20 s of music.
  const rank = range => range.score * Math.sqrt(Math.min(1, (range.end - range.start) / 20));
  const best = candidates.reduce((top, range) => (!top || rank(range) > rank(top) ? range : top), null);
  const strongest = Math.max(1e-6, ...candidates.map(range => range.score));
  const strength = range => Math.round((0.45 + (0.55 * range.score) / strongest) * 100) / 100;
  return { peaks: merge(candidates.map(range => snap({ ...range, strength: strength(range) }))), best: best && snap(best), intensity };
}
