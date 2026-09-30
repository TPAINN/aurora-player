// Conservative onset-envelope estimate: no tempo is better than an invented tempo.
export function estimateTempo(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate / 100));
  const envelope = [];
  let previous = 0;
  for (let i = 0; i + hop < samples.length; i += hop) {
    let energy = 0;
    for (let j = i; j < i + hop; j++) energy += samples[j] ** 2;
    energy = Math.sqrt(energy / hop);
    envelope.push(Math.max(0, energy - previous)); previous = energy;
  }
  if (envelope.length < 800) return null;
  let best = 0, lag = 0;
  for (let offset = 33; offset <= 100; offset++) {
    let dot = 0, left = 0, right = 0;
    for (let i = offset; i < envelope.length; i++) {
      dot += envelope[i] * envelope[i - offset]; left += envelope[i] ** 2; right += envelope[i - offset] ** 2;
    }
    const score = dot / (Math.sqrt(left * right) || 1);
    if (score > best + .01) { best = score; lag = offset; }
  }
  return best >= .7 ? { bpm: Math.round(6000 / lag), confidence: best } : null;
}

export function planTransition(outro, intro) {
  // Autocorrelation can hear a half-time pulse; compare musical octave equivalents.
  const targetBpm = intro?.bpm > 0 && outro?.bpm > 0
    ? [intro.bpm, intro.bpm / 2, intro.bpm * 2].reduce((best, bpm) => Math.abs(bpm / outro.bpm - 1) < Math.abs(best / outro.bpm - 1) ? bpm : best)
    : null;
  const ratio = targetBpm ? targetBpm / outro.bpm : 1;
  const matched = outro?.confidence >= .7 && intro?.confidence >= .7 && ratio >= .94 && ratio <= 1.06;
  // Use a whole number of four-beat groups near six seconds. This is a
  // tempo-sized overlap, not a claim to have detected a downbeat grid.
  const seconds = matched ? Math.max(4, Math.min(8, Math.round(6 * targetBpm / 240) * 240 / targetBpm)) : 6;
  return { rate: matched ? ratio : 1, matched: Boolean(matched), seconds, targetBpm: matched ? targetBpm : null };
}

export function equalPower(progress) {
  const phase = Math.max(0, Math.min(1, progress)) * Math.PI / 2;
  return [Math.cos(phase), Math.sin(phase)];
}

export async function analyzeLocalTempo(file, context) {
  // Decode one file at a time; large files retain a plain crossfade.
  if (file.size > 32 * 1024 * 1024) return null;
  const buffer = await context.decodeAudioData(await file.arrayBuffer());
  const data = buffer.getChannelData(0);
  const length = Math.min(data.length, buffer.sampleRate * 24);
  return { introStart: findIntroStart(data, buffer.sampleRate), mixStart: findMixPoint(data, buffer.sampleRate), intro: estimateTempo(data.subarray(0, length), buffer.sampleRate), outro: estimateTempo(data.subarray(data.length - length), buffer.sampleRate) };
}

// Prefer a low-energy phrase near the outro; this detects energy, not beat phase.
export function findMixPoint(samples, sampleRate, seconds = 6) {
  const duration = samples.length / sampleRate;
  if (duration < 16) return Math.max(0, duration - seconds);
  const earliest = Math.max(duration * .72, duration - 30);
  const latest = duration - seconds;
  const hop = Math.max(1, Math.floor(sampleRate / 2));
  let best = latest, lowest = Infinity;
  for (let time = earliest; time <= latest; time += .5) {
    const start = Math.floor(time * sampleRate);
    let sum = 0;
    for (let i = start; i < Math.min(samples.length, start + hop); i++) sum += samples[i] ** 2;
    const rms = Math.sqrt(sum / hop);
    // A tiny late preference keeps steady-energy songs close to their natural ending.
    const score = rms + .002 * (latest - time) / Math.max(1, latest - earliest);
    if (score < lowest) { lowest = score; best = time; }
  }
  return best;
}

// Trim only clear leading silence; never guess a musical intro cue.
export function findIntroStart(samples, sampleRate) {
  const hop = Math.max(1, Math.floor(sampleRate * .05));
  const end = Math.min(samples.length, sampleRate * 8);
  for (let start = 0; start < end; start += hop) {
    let energy = 0;
    for (let i = start; i < Math.min(samples.length, start + hop); i++) energy += samples[i] ** 2;
    if (Math.sqrt(energy / hop) > .012) return Math.max(0, start / sampleRate - .05);
  }
  return 0;
}
