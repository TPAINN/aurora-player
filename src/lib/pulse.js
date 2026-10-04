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
