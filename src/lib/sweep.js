// Online songs play inside YouTube's player, whose audio cannot be filtered.
// For online DJ blends Aurora layers its own synthesized sweep over the crossfade.
// It is deep rather than airy: a quiet, warm band of pink noise that rises only
// into the low mids by the swap and sinks into the bass, under a long sub drop that
// gives the hand-over weight. Felt more than heard; the music stays in front.

export const SWEEP_TAIL = .35;
const LOW = 140, HIGH = 900, DEEP = 90;
export const SWEEP_LEVEL = 0.18; // the noise band's peak, relative to the music
export const SUB_LEVEL = 0.26; // the sub drop's peak: the depth leads

// Level (0–1) and band frequency at a point of the blend (0 = start, 1 = end, tail after).
export function sweepShape(progress) {
  const p = Math.max(0, Math.min(1 + SWEEP_TAIL, progress));
  const ease = x => x * x * (3 - 2 * x);
  if (p <= .5) {
    const x = p / .5;
    return { level: ease(x), frequency: LOW * (HIGH / LOW) ** ease(x) };
  }
  const x = (p - .5) / (.5 + SWEEP_TAIL);
  return { level: 1 - ease(x), frequency: HIGH * (DEEP / HIGH) ** ease(x) };
}

let noise = null;
function pinkNoise(context) {
  if (noise?.sampleRate === context.sampleRate) return noise;
  const length = context.sampleRate * 2;
  noise = context.createBuffer(1, length, context.sampleRate);
  const data = noise.getChannelData(0);
  // Paul Kellet's economy pink filter: warmer than white noise, less hiss.
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = .99765 * b0 + white * .099046;
    b1 = .963 * b1 + white * .2965164;
    b2 = .57 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * .1848) * .18;
  }
  return noise;
}

// Schedules the sweep on `context`, starting now. Returns a stop function.
export function playSweep(context, { seconds, volume = 1, beatSeconds = null }) {
  const now = context.currentTime;
  const total = seconds * (1 + SWEEP_TAIL);
  const points = 96;
  const level = new Float32Array(points), frequency = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const shape = sweepShape((i / (points - 1)) * (1 + SWEEP_TAIL));
    level[i] = shape.level * SWEEP_LEVEL * volume;
    frequency[i] = shape.frequency;
  }
  const source = context.createBufferSource();
  source.buffer = pinkNoise(context); source.loop = true;
  const band = context.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 2.2;
  const gain = context.createGain(); gain.gain.value = 0;
  // A short tempo-synced echo gives the sweep a little space, never a long hollow tail.
  const delay = context.createDelay(2); delay.delayTime.value = Math.min(1.5, (beatSeconds || .5) * .75);
  const feedback = context.createGain(); feedback.gain.value = .22;
  const tone = context.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 900;
  const out = context.createGain(); out.gain.value = 1;
  source.connect(band).connect(gain).connect(out);
  gain.connect(delay).connect(tone).connect(feedback).connect(delay);
  tone.connect(out);
  out.connect(context.destination);
  band.frequency.setValueCurveAtTime(frequency, now, total);
  gain.gain.setValueCurveAtTime(level, now, total);
  // Sub drop at the swap: a low sine that falls slowly and fades long, the weight
  // under song B's arrival. A short swell in (no click), then a long release.
  const sub = context.createOscillator(); sub.type = 'sine';
  const subGain = context.createGain(); subGain.gain.value = 0;
  const drop = now + seconds * .55;
  sub.frequency.setValueAtTime(62, drop);
  sub.frequency.exponentialRampToValueAtTime(31, drop + 2.4);
  subGain.gain.setValueAtTime(0, drop);
  subGain.gain.linearRampToValueAtTime(SUB_LEVEL * volume, drop + .09);
  subGain.gain.exponentialRampToValueAtTime(.0005, drop + 2.8);
  sub.connect(subGain).connect(out);
  source.start(now); sub.start(now);
  const end = now + total + 3;
  source.stop(end); sub.stop(end);
  let stopped = false;
  source.onended = () => out.disconnect();
  return () => {
    if (stopped) return;
    stopped = true;
    const at = context.currentTime;
    out.gain.cancelScheduledValues(at); out.gain.setTargetAtTime(0, at, .08);
    try { source.stop(at + .5); sub.stop(at + .5); } catch { /* already stopped */ }
  };
}
