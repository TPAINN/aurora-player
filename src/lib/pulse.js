// The best-part backdrop pulse. Its period comes only from a measured or catalogue
// tempo: one, two or four beats, whichever first lasts at least 0.9 s (never over 1.8 s).
const MIN_BPM = 40;
const MAX_BPM = 240;
const FASTEST = 0.9;

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
