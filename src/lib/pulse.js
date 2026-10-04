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
