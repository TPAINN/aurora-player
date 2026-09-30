// DJ transition engine. Everything here is pure and measured: no tempo is
// better than an invented tempo, and no cue is guessed from nothing.

// Beyond ±8% time-stretching becomes audible even with pitch preservation.
export const MAX_TEMPO_SHIFT = .08;
const TARGET_OVERLAP = 5;

// Conservative onset-envelope estimate with sub-frame lag refinement and beat phase.
export function estimateTempo(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate / 100));
  const frameRate = sampleRate / hop;
  const raw = [];
  let previous = 0;
  for (let i = 0; i + hop < samples.length; i += hop) {
    let energy = 0;
    for (let j = i; j < i + hop; j++) energy += samples[j] ** 2;
    energy = Math.sqrt(energy / hop);
    raw.push(Math.max(0, energy - previous)); previous = energy;
  }
  if (raw.length < 800) return null;
  // A light symmetric blur keeps onsets that straddle two frames correlated
  // without moving their centre, so the phase estimate stays unbiased.
  const envelope = raw.map((value, i) => .25 * (raw[i - 1] || 0) + .5 * value + .25 * (raw[i + 1] || 0));
  const minLag = Math.floor(frameRate * 60 / 182), maxLag = Math.ceil(frameRate * 60 / 60);
  const scores = new Map();
  let best = 0, lag = 0;
  for (let offset = minLag - 1; offset <= maxLag + 1; offset++) {
    let dot = 0, left = 0, right = 0;
    for (let i = offset; i < envelope.length; i++) {
      dot += envelope[i] * envelope[i - offset]; left += envelope[i] ** 2; right += envelope[i - offset] ** 2;
    }
    const score = dot / (Math.sqrt(left * right) || 1);
    scores.set(offset, score);
    if (offset >= minLag && offset <= maxLag && score > best + .01) { best = score; lag = offset; }
  }
  if (best < .7) return null;
  // Parabolic interpolation around the peak recovers tempos between whole frames.
  const [a, b, c] = [scores.get(lag - 1), best, scores.get(lag + 1)];
  const curvature = a - 2 * b + c;
  const period = lag + (curvature < 0 ? Math.max(-.5, Math.min(.5, .5 * (a - c) / curvature)) : 0);
  let phaseFrame = 0, strongest = -1;
  for (let k = 0; k < Math.round(period); k++) {
    let sum = 0;
    for (let n = 0; k + n * period < envelope.length; n++) sum += envelope[Math.round(k + n * period)] || 0;
    if (sum > strongest) { strongest = sum; phaseFrame = k; }
  }
  return { bpm: Math.round(600 * frameRate / period) / 10, confidence: best, phase: phaseFrame / frameRate };
}

// Nearest octave equivalent: autocorrelation can hear a half- or double-time pulse.
function octaveTarget(outBpm, inBpm) {
  return [inBpm, inBpm / 2, inBpm * 2].reduce((best, bpm) => Math.abs(bpm / outBpm - 1) < Math.abs(best / outBpm - 1) ? bpm : best);
}

export function planTransition(outro, intro, target = TARGET_OVERLAP) {
  const known = outro?.bpm > 0 && intro?.bpm > 0;
  const targetBpm = known ? octaveTarget(outro.bpm, intro.bpm) : null;
  const ratio = targetBpm ? targetBpm / outro.bpm : 1;
  const matched = Boolean(known && outro.confidence >= .7 && intro.confidence >= .7 && Math.abs(ratio - 1) <= MAX_TEMPO_SHIFT + 1e-9);
  const beatBpm = matched ? targetBpm : outro?.confidence >= .7 && outro.bpm > 0 ? outro.bpm : null;
  // Whole bars near five seconds: a tempo-sized overlap, not a claimed downbeat grid.
  let seconds = target;
  if (beatBpm) {
    const bar = 240 / beatBpm;
    let bars = Math.max(1, Math.round(target / bar));
    while (bars * bar > target * 1.4 && bars > 1) bars--;
    while (bars * bar < target * .8) bars++;
    seconds = bars * bar;
  }
  // Glide song A toward song B at roughly one percent per second before the blend.
  const rampSeconds = matched && ratio !== 1 ? Math.min(8, Math.max(3, Math.abs(ratio - 1) * 120)) : 0;
  return { rate: matched ? ratio : 1, matched, seconds, rampSeconds, targetBpm: matched ? targetBpm : null, beatSeconds: beatBpm ? 60 / beatBpm : null };
}

export function equalPower(progress) {
  const phase = Math.max(0, Math.min(1, progress)) * Math.PI / 2;
  return [Math.cos(phase), Math.sin(phase)];
}

export function smoothstep(progress) {
  const p = Math.max(0, Math.min(1, progress));
  return p * p * (3 - 2 * p);
}

// Playback rate at `time` for a glide from 1 to `rate` starting at `rampStart`.
export function glideRate(time, rampStart, rampSeconds, rate) {
  if (time < rampStart) return 1;
  if (!(rampSeconds > 0)) return rate;
  return 1 + (rate - 1) * smoothstep((time - rampStart) / rampSeconds);
}

export function snapToBeat(time, grid) {
  if (!grid?.period) return time;
  return grid.origin + Math.round((time - grid.origin) / grid.period) * grid.period;
}

// Start the incoming deck so its next beat sounds when the outgoing deck's next beat does.
export function beatAlignedEntry({ introStart, inGrid, outPosition, outGrid, rate = 1 }) {
  if (!inGrid?.period || !outGrid?.period) return introStart;
  const nextOut = outGrid.origin + Math.ceil((outPosition - outGrid.origin) / outGrid.period) * outGrid.period;
  const wait = (nextOut - outPosition) / Math.max(.5, rate);
  let beat = inGrid.origin + Math.ceil((introStart - inGrid.origin) / inGrid.period - 1e-9) * inGrid.period;
  while (beat - wait < Math.max(0, introStart - .15)) beat += inGrid.period;
  return beat - wait;
}

// Online playback has no PCM, so only genuinely timed vocals may move the cue.
export function planOnlineCue(duration, lines = [], seconds = TARGET_OVERLAP) {
  const natural = Math.max(0, duration - seconds - 1.5);
  let lastVocal = -Infinity;
  for (const line of lines || []) {
    const end = line.words?.length ? line.words.at(-1).end : line.end;
    if (Number.isFinite(end) && end > lastVocal) lastVocal = end;
  }
  const start = lastVocal >= duration - 30 && lastVocal + 1 <= natural ? lastVocal + 1 : natural;
  return { start, end: Math.min(duration, start + seconds), seconds, source: start === natural ? 'ending' : 'lyrics' };
}

export function quantizeRate(available, value) {
  if (!Array.isArray(available) || !available.length) return 1;
  return available.reduce((best, rate) => Math.abs(rate - value) < Math.abs(best - value) ? rate : best, 1);
}

export async function analyzeLocalTempo(file, context) {
  // Decode one file at a time; large files retain a plain crossfade.
  if (file.size > 32 * 1024 * 1024) return null;
  const buffer = await context.decodeAudioData(await file.arrayBuffer());
  return analyzeSamples(buffer.getChannelData(0), buffer.sampleRate);
}

export function analyzeSamples(data, sampleRate) {
  const length = Math.min(data.length, sampleRate * 24);
  const introTempo = estimateTempo(data.subarray(0, length), sampleRate);
  const outroTempo = estimateTempo(data.subarray(data.length - length), sampleRate);
  const windowStart = (data.length - length) / sampleRate;
  const intro = introTempo && { ...introTempo, grid: { origin: introTempo.phase, period: 60 / introTempo.bpm } };
  const outro = outroTempo && { ...outroTempo, grid: { origin: windowStart + outroTempo.phase, period: 60 / outroTempo.bpm } };
  const mixStart = findMixPoint(data, sampleRate, TARGET_OVERLAP, outro?.grid);
  return { introStart: findIntroStart(data, sampleRate), mixStart, intro, outro, duration: data.length / sampleRate, levels: loudness(data, sampleRate, 0, 35), exitLevel: average(loudness(data, sampleRate, mixStart, TARGET_OVERLAP)) };
}

// Prefer a low-energy phrase in the final 30 seconds, snapped to the beat grid when known.
export function findMixPoint(samples, sampleRate, seconds = TARGET_OVERLAP, grid = null) {
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
  const snapped = snapToBeat(best, grid);
  return snapped >= earliest && snapped <= latest ? snapped : best;
}

// Skip silence and noise floors relative to the song's own intro loudness; keep soft music.
export function findIntroStart(samples, sampleRate) {
  const hop = Math.max(1, Math.floor(sampleRate * .05));
  const windowEnd = Math.min(samples.length, sampleRate * 30);
  const levels = [];
  for (let start = 0; start < windowEnd; start += hop) {
    let energy = 0;
    const end = Math.min(samples.length, start + hop);
    for (let i = start; i < end; i++) energy += samples[i] ** 2;
    levels.push(Math.sqrt(energy / Math.max(1, end - start)));
  }
  const reference = [...levels].sort((a, b) => a - b)[Math.floor(levels.length * .9)] || 0;
  // About -24 dB below the intro's loud passages, never below a hard floor.
  const threshold = Math.max(.008, reference * .06);
  const limit = Math.min(levels.length, Math.ceil(12 / (hop / sampleRate)));
  for (let index = 0; index < limit; index++) if (levels[index] > threshold) return Math.max(0, index * hop / sampleRate - .05);
  return 0;
}

// Jog-wheel style correction: a small, bounded rate offset that walks the incoming
// beat onto the outgoing beat. Only applied when both decks share a beat period.
export function phaseNudge({ inPosition, inGrid, outPosition, outGrid, outRate = 1 }) {
  if (!inGrid?.period || !outGrid?.period) return 1;
  const outPeriod = outGrid.period / Math.max(.5, outRate);
  if (Math.abs(inGrid.period / outPeriod - 1) > .03) return 1;
  const phase = (position, grid) => (((position - grid.origin) / grid.period) % 1 + 1) % 1;
  let error = phase(inPosition, inGrid) - phase(outPosition, outGrid);
  if (error >= .5) error -= 1;
  if (error < -.5) error += 1;
  const seconds = error * inGrid.period;
  if (Math.abs(seconds) < .008) return 1;
  return 1 - Math.max(-.04, Math.min(.04, seconds * .8));
}

// Best entry into song B: within its first 30 seconds, on a 4-bar phrase boundary
// when the beat is known, pick the section whose loudness best continues what
// song A is leaving with. Earlier is preferred, so intros are never skipped for
// a marginal gain, and unknown energy keeps B's natural start.
export function chooseEntry({ levels, hop = .5, introStart = 0, grid = null, targetLevel = null, maxSeconds = 30 }) {
  if (!(targetLevel > 0) || !levels?.length) return introStart;
  const span = 4;
  const levelAt = time => {
    const from = Math.max(0, Math.floor(time / hop)), to = Math.min(levels.length, Math.ceil((time + span) / hop));
    if (to <= from) return 0;
    let sum = 0;
    for (let i = from; i < to; i++) sum += levels[i];
    return sum / (to - from);
  };
  const candidates = [{ time: introStart, phrase: true }];
  if (grid?.period) {
    const bar = grid.period * 4;
    for (let k = Math.ceil((introStart - grid.origin) / bar - 1e-9); ; k++) {
      const time = grid.origin + k * bar;
      if (time > maxSeconds) break;
      if (time > introStart + 1e-6) candidates.push({ time, phrase: k % 4 === 0 });
    }
  } else {
    for (let time = Math.ceil(introStart / 2) * 2; time <= maxSeconds; time += 2) if (time > introStart) candidates.push({ time, phrase: true });
  }
  let best = candidates[0], lowest = Infinity;
  for (const candidate of candidates) {
    const score = Math.abs(Math.log((levelAt(candidate.time) + 1e-3) / (targetLevel + 1e-3))) + .015 * (candidate.time - introStart) + (candidate.phrase ? 0 : .1);
    if (score < lowest - 1e-9) { lowest = score; best = candidate; }
  }
  return Math.round(best.time * 1000) / 1000;
}

// Online, only genuinely timed lyrics reveal an instrumental intro: start song B
// so the blend completes a few seconds before its first sung line.
export function planOnlineEntry(lines = [], seconds = 5) {
  const first = (lines || []).find(line => Number.isFinite(line?.time))?.time;
  if (!(first > seconds + 10)) return 0;
  return Math.min(45, Math.round(first - seconds - 4));
}

// RMS per half second: a small loudness profile for choosing entry points.
export function loudness(samples, sampleRate, from, seconds, hop = .5) {
  const levels = [];
  const step = Math.max(1, Math.floor(sampleRate * hop));
  const end = Math.min(samples.length, Math.floor((from + seconds) * sampleRate));
  for (let start = Math.floor(from * sampleRate); start < end; start += step) {
    let sum = 0;
    const stop = Math.min(end, start + step);
    for (let i = start; i < stop; i++) sum += samples[i] ** 2;
    levels.push(Math.sqrt(sum / Math.max(1, stop - start)));
  }
  return levels;
}
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
