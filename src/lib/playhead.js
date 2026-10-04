// The YouTube embed reports its time only every 100–250 ms, so a word wipe driven
// by it moves in steps and trails the singer. Between reports the playhead moves on
// at the reported playback rate; it never steps back for a slightly late report,
// follows a real seek at once, and never runs further ahead than one missed report.
const MAX_PROJECTION = 0.35;
const JITTER = 0.3;

export function createPlayhead() {
  let raw = null, at = 0, rate = 1, last = null;
  return {
    read({ raw: value, playing, rate: currentRate = 1, now }) {
      if (!Number.isFinite(value)) { raw = null; last = null; return 0; }
      if (value !== raw) { raw = value; at = now; rate = currentRate || 1; }
      if (!playing) { last = value; return value; }
      const projected = Math.round((value + Math.min(MAX_PROJECTION, Math.max(0, now - at) / 1000) * rate) * 1e6) / 1e6;
      if (last !== null && projected < last && last - projected < JITTER) return last;
      last = projected;
      return projected;
    },
    reset() { raw = null; last = null; },
  };
}

// Device audio runs through Web Audio, so the speaker plays a sample the graph's
// base and output latency after the decoder reports it; Bluetooth adds the most.
// While playing, lyrics follow what is heard. Capped, as a few drivers misreport.
const MAX_LATENCY = 0.5;
export function heardTime(mediaTime, { playing, latency }) {
  if (!playing || !Number.isFinite(latency) || latency <= 0) return mediaTime;
  return Math.max(0, Math.round((mediaTime - Math.min(MAX_LATENCY, latency)) * 1e6) / 1e6);
}
