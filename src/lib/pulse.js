// The best-part backdrop pulse. Its period comes only from a measured or catalogue
// tempo: it kicks on every beat, or every second beat when beats come faster than
// 0.42 s apart (over ~143 BPM), so it follows the music without ever flickering.
const MIN_BPM = 40;
const MAX_BPM = 240;
const FASTEST = 0.42;

export function pulsePeriod(bpm) {
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return null;
  let period = 60 / bpm;
  while (period < FASTEST) period *= 2;
  return period; // At 40 BPM and up one beat is at most 1.5 s.
}

// Seconds into the current wave, counted from the peak's first sung word.
export function pulsePhase(time, anchor, period) {
  return (((time - anchor) % period) + period) % period;
}

// Where the beats fall, from the sung words themselves. Syllables cluster on the
// beat grid, and long (stressed, held) words land on beats more than short pickups,
// so each onset is weighed by its length on the beat circle. Only a clear lock is
// returned; a syncopated or sparse vocal gives null and nothing is guessed.
const MIN_WORDS = 12;
const LOCK = 0.35;
export function beatPhase(words, period) {
  if (!Number.isFinite(period) || period <= 0 || !Array.isArray(words)) return null;
  let x = 0, y = 0, total = 0, count = 0;
  for (const word of words) {
    if (!Number.isFinite(word?.start)) continue;
    const weight = Math.min(1, Math.max(0.05, (Number(word.end) || word.start) - word.start));
    const angle = (2 * Math.PI * word.start) / period;
    x += weight * Math.cos(angle); y += weight * Math.sin(angle); total += weight; count++;
  }
  if (count < MIN_WORDS || !total) return null;
  const strength = Math.hypot(x, y) / total;
  if (strength < LOCK) return null;
  const origin = ((Math.atan2(y, x) / (2 * Math.PI)) * period + period) % period;
  return { origin: Math.round(origin * 1000) / 1000, strength: Math.round(strength * 100) / 100 };
}

// Line-timed lyrics carry no syllables, but lines start on the grid (mostly on
// downbeats), so their starts place a known tempo on the beat just as well.
export function linePhase(lines, period) {
  if (!Array.isArray(lines)) return null;
  const starts = lines.map(line => Number(line?.time ?? line?.start)).filter(Number.isFinite);
  return beatPhase(starts.map(start => ({ start, end: start + 1 })), period);
}

// With no catalogue tempo, word-timed vocals still show the beat: their onsets
// cohere on the beat circle at the song's beat period (or a whole multiple of it)
// and nowhere else. The period is scanned from 55 to 300 BPM (sung syllables often
// lock best on the half beat) and refined; only a
// lock far above what scattered onsets reach is accepted, so a free-timed vocal
// yields null and no beat is invented. The pulse only needs a period on the beat,
// so a half- or double-time answer is as good as the beat itself.
const SCAN = [0.2, 1.1];
const MIN_ONSETS = 40;
const MEASURED_LOCK = 0.38;
const SIGNIFICANCE = 6;
function coherence(onsets, period) {
  let x = 0, y = 0;
  for (const [time, weight] of onsets) {
    const angle = (2 * Math.PI * time) / period;
    x += weight * Math.cos(angle); y += weight * Math.sin(angle);
  }
  return [x, y];
}
export function lyricBeat(words) {
  if (!Array.isArray(words)) return null;
  const onsets = words
    .filter(word => Number.isFinite(word?.start))
    .map(word => [word.start, Math.min(1, Math.max(0.05, (Number(word.end) || word.start) - word.start))]);
  if (onsets.length < MIN_ONSETS) return null;
  const total = onsets.reduce((sum, [, weight]) => sum + weight, 0);
  const squares = onsets.reduce((sum, [, weight]) => sum + weight * weight, 0);
  const strength = period => Math.hypot(...coherence(onsets, period)) / total;
  // Coarse scan in steps of 0.15 % of the period, then refine around the best.
  let best = SCAN[0], top = 0;
  for (let period = SCAN[0]; period <= SCAN[1]; period *= 1.0015) {
    const value = strength(period);
    if (value > top) { top = value; best = period; }
  }
  for (let period = best * 0.998; period <= best * 1.002; period += best * 0.00002) {
    const value = strength(period);
    if (value > top) { top = value; best = period; }
  }
  // Scattered onsets cohere at about 1/sqrt(n) by chance; demand far more.
  const effective = (total * total) / squares;
  if (top < MEASURED_LOCK || top * Math.sqrt(effective) < SIGNIFICANCE) return null;
  const [x, y] = coherence(onsets, best);
  let origin = ((Math.atan2(y, x) / (2 * Math.PI)) * best + best) % best;
  // A half-beat lock is quicker than the pulse should run: double it. The doubled
  // grid can only sit on the measured grid, on one of its two halves; the one the
  // weighted (long, stressed, held) words lean toward is the beat.
  while (best < FASTEST) {
    const [dx, dy] = coherence(onsets, best * 2);
    const angle = (2 * Math.PI * origin) / (best * 2);
    if (dx * Math.cos(angle) + dy * Math.sin(angle) < 0) origin += best;
    best *= 2;
  }
  origin %= best;
  return { period: Math.round(best * 100000) / 100000, origin: Math.round(origin * 1000) / 1000, strength: Math.round(top * 100) / 100 };
}

// When the best-part glow is on, and how long until it next changes (so the
// player can flip it on time, not on the next coarse clock tick). It opens a
// little ahead of the section (`lead`, about half a beat), so the lift lands on
// the downbeat, and starts closing a little before the end (`close`), so the
// fade finishes as the section does instead of lingering into the next one. A
// peak too short for both still shows for at least half its length.
export function peakWindow(time, peaks, { lead = 0.25, close = 0.8 } = {}) {
  let until = Infinity;
  for (let index = 0; index < peaks.length; index++) {
    const { start, end } = peaks[index];
    const open = start - lead;
    const shut = Math.max(start + (end - start) / 2, end - close);
    if (time >= open && time < shut) return { index, until: shut - time };
    if (open > time) until = Math.min(until, open - time);
  }
  return { index: -1, until: Math.round(until * 1e9) / 1e9 };
}

// The whole background breathes with the beat all song long: a slight zoom in and
// back with a soft swell of light, never more than a hair's breadth, and opening
// up in a best part as far as that moment's strength allows.
const clampUnit = value => Math.min(1, Math.max(0, Number(value) || 0));
export function breath({ peak = false, strength = 0 } = {}) {
  const lift = peak ? clampUnit(strength) : 0;
  return { zoom: Math.round((0.008 + 0.014 * lift) * 10000) / 10000, glow: Math.round((0.09 + 0.17 * lift) * 1000) / 1000 };
}
// One beat of breath, as a share of the full swing (`level`): a quick, eased-out
// rise into the beat, a long smooth release, then a short rest at the
// background's own size before the next beat.
export const BREATH_KEYS = [
  { offset: 0, level: 0, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
  { offset: 0.14, level: 1, easing: 'cubic-bezier(0.45, 0, 0.3, 1)' },
  { offset: 0.9, level: 0, easing: 'linear' },
  { offset: 1, level: 0 },
];
// The breath starts, stops or changes depth only during that rest, so the
// background never jumps.
export function atRest(phase, period) {
  return phase >= BREATH_KEYS.at(-2).offset * period;
}
