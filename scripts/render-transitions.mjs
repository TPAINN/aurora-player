// Records real DJ transitions from the app so they can be listened to.
// Synthesizes original test songs (intro → main → outro → silence) at chosen tempos,
// plays each pair through the app's own local DJ engine in Chromium, and captures
// everything the app sends to the speakers as a WAV file.
//
//   npm run build && npm run preview -- --port 5188
//   BASE=http://localhost:5188/ CHROMIUM_PATH=... node scripts/render-transitions.mjs [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyzeSamples, chooseBend, planTransition } from '../src/lib/dj.js';

const BASE = process.env.BASE || 'http://localhost:5188/';
const OUT = process.argv[2] || 'transitions';
const RATE = 44100;
// Auto, as the app plays it: the longest phrase up to 32 s, at most a quarter of either song.
import { MAX_BLEND } from '../src/lib/dj.js';
mkdirSync(OUT, { recursive: true });

// ── Song synthesis ───────────────────────────────────────────────────────────
function song({ bpm, root, seconds = 140, seed = 1, style = 'house' }) {
  let state = seed;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const beat = 60 / bpm, bar = beat * 4;
  const bars = Math.max(16, Math.round(seconds / bar));
  const length = Math.ceil((bars * bar + 2.5) * RATE);
  const data = new Float32Array(length);
  const add = (start, samples, fn) => {
    const from = Math.floor(start * RATE);
    for (let i = 0; i < samples && from + i < length; i++) data[from + i] += fn(i / RATE, i);
  };
  // Probe songs: a kick on every beat plus a short tone tick at the song's own pitch,
  // so each song's beats can be followed separately inside the mix.
  if (style === 'probe') {
    const intro = 8, outro = 8;
    for (let b = 0; b < bars; b++) {
      const section = b < intro ? 'intro' : b >= bars - outro ? 'outro' : 'main';
      // A club-style outro at full level, so the overlap measures the engine alone.
      const fade = 1;
      for (let q = 0; q < 4; q++) {
        const tb = b * bar + q * beat;
        if (section !== 'intro' || b >= intro - 4) add(tb, .3 * RATE, t => Math.sin(2 * Math.PI * (45 * t + 75 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 9) * .8 * fade);
        add(tb, .03 * RATE, t => Math.sin(2 * Math.PI * root * t) * Math.min(1, t / .002) * Math.exp(-t * 60) * .35 * fade);
      }
    }
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    for (let i = 0; i < length; i++) data[i] = data[i] / peak * .89;
    return data;
  }
  const minor = [0, 3, 7], major = [0, 4, 7];
  const progression = [[0, minor], [8, major], [3, major], [10, major]];
  const hz = semis => root * 2 ** (semis / 12);
  const intro = 8, outro = 8;
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const section = b < intro ? 'intro' : b >= bars - outro ? 'outro' : 'main';
    const fade = section === 'outro' ? Math.max(0, 1 - (b - (bars - outro)) / outro * .85) : 1;
    const [degree, chord] = progression[b % 4];
    // Pads carry the harmony in every section.
    for (const interval of chord) {
      const f = hz(degree + interval + 12);
      add(t0, bar * RATE, t => (Math.sin(2 * Math.PI * f * t) + .5 * Math.sin(2 * Math.PI * f * 1.003 * t)) * .05 * fade * Math.min(1, t / .3, (bar - t) / .2));
    }
    for (let q = 0; q < 4; q++) {
      const tb = t0 + q * beat;
      const kick = style === 'breaks' ? q === 0 : true;
      if (kick && (section !== 'intro' || b >= intro - 4)) add(tb, .35 * RATE, t => Math.sin(2 * Math.PI * (45 * t + 75 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 9) * .85 * fade);
      if (style === 'breaks' && q === 2 && (section !== 'intro' || b >= intro - 4)) add(tb + beat / 2, .35 * RATE, t => Math.sin(2 * Math.PI * (45 * t + 75 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 9) * .85 * fade);
      if ((q === 1 || q === 3) && section !== 'intro') add(tb, .2 * RATE, t => random() * Math.exp(-t * 22) * .3 * fade);
      for (const half of [0, .5]) add(tb + half * beat, .05 * RATE, t => random() * Math.exp(-t * 90) * (style === 'breaks' ? (half ? .16 : .26) : .1) * fade);
      // Breakbeats carry a ghost snare on the last sixteenth of each beat.
      if (style === 'breaks' && section !== 'intro') add(tb + beat * .75, .08 * RATE, t => random() * Math.exp(-t * 40) * .1 * fade);
      if (section === 'main') {
        // Offbeat bass and a sixteenth-note arpeggio in the main section.
        const bassF = hz(degree - 12);
        add(tb + beat / 2, beat / 2 * RATE, t => Math.tanh(3 * Math.sin(2 * Math.PI * bassF * t)) * .22 * Math.exp(-t * 4));
        for (let s = 0; s < 4; s++) {
          const f = hz(degree + chord[(q * 4 + s) % 3] + 24);
          add(tb + s * beat / 4, beat / 4 * RATE, t => (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * t)) * .07 * Math.exp(-t * 10));
        }
      }
    }
  }
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < length; i++) data[i] = data[i] / peak * .89;
  return data;
}

function wav(samples, rate = RATE) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples.length * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buffer;
}

// ── What a listener would hear ───────────────────────────────────────────────
// loudness: the quietest moment of the transition against both songs' own level
// (a dip is audible separation); flams: doubled kicks inside the overlap (beats not
// aligned); tempoJump: the largest change between consecutive beat intervals (a
// smooth glide stays small, a lurch shows up).
function measure(samples, rate, { before = 10, after = 8 } = {}) {
  const hop = Math.round(rate * 0.005), a = Math.exp(-2 * Math.PI * 120 / rate);
  let y = 0;
  const energy = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) { y = a * y + (1 - a) * samples[j]; sum += y * y; }
    energy.push(sum / hop);
  }
  const loud = Math.max(...energy);
  const onsets = [];
  for (let i = 20; i < energy.length - 1; i++) {
    let mean = 0; for (let k = i - 20; k < i; k++) mean += energy[k]; mean /= 20;
    if (energy[i] > mean * 2.4 && energy[i] > loud * 0.02 && energy[i] >= energy[i + 1] && (!onsets.length || (i * 0.005) - onsets.at(-1) > 0.025)) onsets.push(i * 0.005);
  }
  const total = samples.length / rate;
  const inBlend = time => time > before && time < total - after;
  // Doubled hits per second, inside the blend and in song A's own body (its bass
  // shares the kick's band, so the body is the baseline, not zero).
  const flamRate = (from, to) => onsets.filter((time, index) => index && time > from && time < to && time - onsets[index - 1] > 0.025 && time - onsets[index - 1] < 0.11).length / Math.max(1, to - from);
  const flams = +flamRate(before, total - after).toFixed(2), flamsAlone = +flamRate(1, before - 1).toFixed(2);
  // Beat intervals near their local median (offbeats removed): the largest change
  // between consecutive beats inside the blend.
  const beats = onsets.filter((time, index) => !index || time - onsets[index - 1] >= 0.11);
  const raw = beats.slice(1).map((time, index) => [time, time - beats[index]]);
  const intervals = raw.filter(([, gap], index) => { const near = raw.slice(Math.max(0, index - 6), index + 7).map(([, g]) => g).sort((x, z) => x - z); const mid = near[Math.floor(near.length / 2)]; return gap > mid * 0.85 && gap < mid * 1.15; });
  const jump = (from, to) => { let most = 0; for (let i = 1; i < intervals.length; i++) if (intervals[i][0] > from && intervals[i][0] < to && intervals[i][0] - intervals[i - 1][0] < 1) most = Math.max(most, Math.abs(intervals[i][1] / intervals[i - 1][1] - 1)); return most; };
  const tempoJump = jump(before, total - after), tempoJumpAlone = jump(1, before - 1);
  const window = Math.round(rate * 0.4), levels = [];
  for (let i = 0; i + window <= samples.length; i += Math.round(rate * 0.1)) { let sum = 0; for (let j = i; j < i + window; j++) sum += samples[j] * samples[j]; levels.push([i / rate, Math.sqrt(sum / window)]); }
  const median = list => { const sorted = [...list].sort((x, z) => x - z); return sorted[Math.floor(sorted.length / 2)] || 0; };
  const bodyA = median(levels.filter(([time]) => time < before - 1).map(([, level]) => level));
  const bodyB = median(levels.filter(([time]) => time > total - after + 1).map(([, level]) => level));
  const lowest = Math.min(...levels.filter(([time]) => inBlend(time)).map(([, level]) => level));
  return { loudnessDipDb: +(20 * Math.log10(lowest / Math.min(bodyA, bodyB))).toFixed(1), flamsPerSec: flams, flamsAlonePerSec: flamsAlone, tempoJumpPct: +(tempoJump * 100).toFixed(1), tempoJumpAlonePct: +(tempoJumpAlone * 100).toFixed(1) };
}

// Ground truth for a probe pair: each song's tick onsets (narrow-band), the phase
// error between the two songs' beats while both play, each song's tempo through the
// glide, and the loudness dip.
// One song's narrow-band power every 2 ms.
function goertzelPower(samples, rate, freq) {
  const hop = Math.round(rate * 0.002), size = Math.round(rate * 0.006);
  const k = 2 * Math.cos(2 * Math.PI * freq / rate), power = [];
  for (let i = 0; i + size <= samples.length; i += hop) {
    let s1 = 0, s2 = 0;
    for (let j = i; j < i + size; j++) { const s0 = samples[j] + k * s1 - s2; s2 = s1; s1 = s0; }
    power.push(s1 * s1 + s2 * s2 - k * s1 * s2);
  }
  return power;
}
function goertzelOnsets(samples, rate, freq) {
  const power = goertzelPower(samples, rate, freq);
  const loud = Math.max(...power), onsets = [];
  for (let i = 1; i < power.length; i++) if (power[i] > loud * 0.04 && power[i - 1] <= loud * 0.04 && (!onsets.length || i * 0.002 - onsets.at(-1) > 0.15)) onsets.push(i * 0.002);
  return onsets;
}
function probeSync(samples, rate, fA, fB, expectedPeriod, blendSeconds) {
  const a = goertzelOnsets(samples, rate, fA), b = goertzelOnsets(samples, rate, fB);
  const lastA = a.at(-1) ?? 0, firstB = b[0] ?? Infinity;
  // Both play between B's first tick and A's last tick.
  const both = b.filter(time => time > firstB + 0.5 && time < lastA - 0.2);
  // Only song A's regular beats count: a fading, time-stretched tick can fire early
  // and leave an irregular gap on both sides, so A onsets with no regular neighbour
  // interval are dropped. Each of B's beats is then measured against the nearest.
  const gap = list => list.slice(1).map((time, index) => time - list[index]);
  const typical = (() => { const sorted = gap(a).filter(value => value > .25 && value < .9).sort((x, z) => x - z); return sorted[Math.floor(sorted.length / 2)] || expectedPeriod; })();
  const regular = value => Math.abs(value / typical - 1) < .08;
  const clean = a.filter((time, index) => (index > 0 && regular(time - a[index - 1])) || (index < a.length - 1 && regular(a[index + 1] - time)));
  const signed = both.map(time => { const beat = clean.reduce((best, x) => Math.abs(x - time) < Math.abs(best - time) ? x : best, Infinity); return (time - beat) * 1000; }).filter(ms => Math.abs(ms) < typical * 500);
  const errors = signed.map(Math.abs);
  const curve = list => list.slice(1).map((time, index) => [time, 60 / (time - list[index])]).filter(([, bpm]) => bpm > 40 && bpm < 240);
  const steps = list => { let most = 0; for (let i = 1; i < list.length; i++) most = Math.max(most, Math.abs(list[i][1] / list[i - 1][1] - 1)); return +(most * 100).toFixed(2); };
  const median = list => { const sorted = [...list].sort((x, z) => x - z); return sorted[Math.floor(sorted.length / 2)] ?? NaN; };
  const cA = curve(a), cB = curve(b);
  if (process.env.TIMELINE) console.error(JSON.stringify({ onsetsA: a.filter(t => t > firstB - 1 && t < firstB + 5).map(t => +t.toFixed(3)), onsetsB: b.filter(t => t < firstB + 5).map(t => +t.toFixed(3)) }));
  if (process.env.TIMELINE) console.error(JSON.stringify({ errors: signed.map(ms => [0, +ms.toFixed(0)]), bpmB: cB.slice(0, 24).map(([t, v]) => [+t.toFixed(2), +v.toFixed(1)]), bpmA: cA.slice(-26).map(([t, v]) => [+t.toFixed(2), +v.toFixed(1)]) }));
  // Loudness while both play, against song B's own level once it plays alone.
  const rms = (from, to) => { let sum = 0, n = 0; for (let i = Math.floor(from * rate); i < Math.min(samples.length, to * rate); i++) { sum += samples[i] * samples[i]; n++; } return Math.sqrt(sum / Math.max(1, n)); };
  const blendEnd = firstB + blendSeconds;
  const after = rms(blendEnd + 1, blendEnd + 5);
  let lowest = Infinity;
  // Per-beat windows: loudness as it is heard, not the gaps between kicks.
  for (let t = firstB; t + expectedPeriod <= blendEnd; t += 0.1) lowest = Math.min(lowest, rms(t, t + expectedPeriod));
  if (process.env.TIMELINE) { const ref = rms(blendEnd + 1, blendEnd + 5); const curve = []; for (let t = firstB - 2; t < blendEnd + 2; t += 0.5) curve.push([+(t - firstB).toFixed(1), +(20 * Math.log10(rms(t, t + 0.5) / ref)).toFixed(1)]); console.error(JSON.stringify({ loudness: curve })); }
  // A real blend, not a fade-out then fade-in: how long each song is heard within
  // 6 dB of its own solo level at the same time, per beat-long window.
  const pa = goertzelPower(samples, rate, fA), pb = goertzelPower(samples, rate, fB);
  const band = (power, from, to) => { let sum = 0, n = 0; for (let i = Math.max(0, Math.floor(from / .002)); i < Math.min(power.length, to / .002); i++) { sum += power[i]; n++; } return sum / Math.max(1, n); };
  const window = Math.max(expectedPeriod, .4);
  const soloA = band(pa, firstB - 6, firstB - 1), soloB = band(pb, blendEnd + 1, blendEnd + 5);
  let together = 0;
  for (let t = firstB - 1; t + window <= blendEnd + 1; t += .1) if (10 * Math.log10(band(pa, t, t + window) / soloA) >= -6 && 10 * Math.log10(band(pb, t, t + window) / soloB) >= -6) together += .1;
  return {
    togetherSeconds: +together.toFixed(1),
    overlapDipDb: +(20 * Math.log10(lowest / after)).toFixed(1),
    overlapBeats: both.length,
    phaseErrorMs: { median: +median(errors).toFixed(1), worst: +Math.max(0, ...errors).toFixed(1) },
    tempoA: { start: +median(cA.slice(0, 6).map(([, v]) => v)).toFixed(2), end: +median(cA.slice(-4).map(([, v]) => v)).toFixed(2), maxStepPct: steps(cA) },
    tempoB: { start: +median(cB.slice(0, 4).map(([, v]) => v)).toFixed(2), end: +median(cB.slice(-6).map(([, v]) => v)).toFixed(2), maxStepPct: steps(cB) },
  };
}

const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const pairs = [
  { name: '1-house-120-to-126', a: { bpm: 120, root: 55, seed: 1 }, b: { bpm: 126, root: 61.74, seed: 2 } },
  { name: '2-deep-124-to-118', a: { bpm: 124, root: 49, seed: 3 }, b: { bpm: 118, root: 58.27, seed: 4 } },
  { name: '3-wide-gap-100-to-112', a: { bpm: 100, root: 51.91, seed: 5, style: 'breaks' }, b: { bpm: 112, root: 55, seed: 6 } },
  { name: '4-same-tempo-128', a: { bpm: 128, root: 46.25, seed: 7 }, b: { bpm: 128, root: 55, seed: 8 } },
  { name: '6-probe-120-to-126', a: { bpm: 120, root: 1000, seed: 11, style: 'probe' }, b: { bpm: 126, root: 2500, seed: 12, style: 'probe' } },
  { name: '7-probe-128-to-122', a: { bpm: 128, root: 1000, seed: 13, style: 'probe' }, b: { bpm: 122, root: 2500, seed: 14, style: 'probe' } },
  { name: '8-probe-same-124', a: { bpm: 124, root: 1000, seed: 15, style: 'probe' }, b: { bpm: 124, root: 2500, seed: 16, style: 'probe' } },
  { name: '9-probe-wide-100-to-112', a: { bpm: 100, root: 1000, seed: 17, style: 'probe' }, b: { bpm: 112, root: 2500, seed: 18, style: 'probe' } },
  { name: '10-probe-meet-118-to-132', a: { bpm: 118, root: 1000, seed: 19, style: 'probe' }, b: { bpm: 132, root: 2500, seed: 20, style: 'probe' } },
  { name: '11-probe-double-time-87-to-174', a: { bpm: 87, root: 1000, seed: 21, style: 'probe' }, b: { bpm: 174, root: 2500, seed: 22, style: 'probe' } },
  { name: '12-probe-close-122-to-125', a: { bpm: 122, root: 1000, seed: 23, style: 'probe' }, b: { bpm: 125, root: 2500, seed: 24, style: 'probe' } },
  { name: '5-half-time-87-to-174', a: { bpm: 87, root: 55, seed: 9, style: 'breaks' }, b: { bpm: 174, root: 49, seed: 10, style: 'breaks' } },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });
const report = [];
for (const pair of pairs.filter(item => !ONLY || ONLY.test(item.name))) {
  const a = song(pair.a), b = song(pair.b);
  const from = analyzeSamples(a, RATE), to = analyzeSamples(b, RATE);
  const plan = planTransition(from.outro, to.intro, Math.min(MAX_BLEND, from.duration / 4, to.duration / 4), { bend: chooseBend() });
  const exit = Math.min(from.duration - plan.seconds, from.mixStart);
  // Ten seconds of song A before anything moves, then glide, blend, recovery and song B alone.
  const start = Math.max(0, exit - plan.rampSeconds - 10);
  const seconds = exit - start + plan.seconds + plan.recoverSeconds + 8;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    sessionStorage.setItem('aurora:welcome-seen', '1');
    localStorage.setItem('aurora-dj', 'true'); localStorage.setItem('aurora-autoplay', 'false'); localStorage.setItem('aurora-blend', 'auto');
    // Tap everything the app sends to the speakers.
    window.__recording = [];
    window.__mediaLog = [];
    for (const name of ['playbackRate', 'currentTime']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name);
      Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, get() { return descriptor.get.call(this); }, set(value) { if (window.__recordingOn) window.__mediaLog.push([+(performance.now() - window.__recordStart).toFixed(0), (this.src || '').slice(-6), name, +Number(value).toFixed(4)]); descriptor.set.call(this, value); } });
    }
    const connect = AudioNode.prototype.connect;
    const buses = new WeakMap();
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        let bus = buses.get(target);
        if (!bus) {
          const context = target.context;
          bus = context.createGain();
          const tap = context.createScriptProcessor(4096, 2, 1);
          tap.onaudioprocess = event => { if (window.__recordingOn) { const l = event.inputBuffer.getChannelData(0), r = event.inputBuffer.getChannelData(1); const mono = new Float32Array(l.length); for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2; window.__recording.push(mono); } };
          connect.call(bus, target); connect.call(bus, tap); connect.call(tap, target);
          window.__recordRate = context.sampleRate;
          buses.set(target, bus);
        }
        return connect.call(this, bus, ...rest);
      }
      return connect.call(this, target, ...rest);
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(BASE); await page.waitForTimeout(800);
  await page.setInputFiles('input[type=file]', [
    { name: `Song A ${pair.a.bpm} BPM.wav`, mimeType: 'audio/wav', buffer: wav(a) },
    { name: `Song B ${pair.b.bpm} BPM.wav`, mimeType: 'audio/wav', buffer: wav(b) },
  ]);
  await page.waitForTimeout(4000);
  await page.evaluate(value => {
    const input = document.querySelector('.dock-seek input[aria-label="Seek in track"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, start);
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__recording = []; window.__recordingOn = true; window.__recordStart = performance.now(); });
  const labels = new Set();
  for (let t = 0; t < seconds * 1000; t += 500) {
    labels.add(await page.evaluate(() => document.querySelector('.dj-pill small')?.textContent || '').catch(() => ''));
    await page.waitForTimeout(500);
  }
  const { chunks, rate } = await page.evaluate(() => { window.__recordingOn = false; return { chunks: window.__recording.map(chunk => Array.from(chunk)), rate: window.__recordRate }; });
  const samples = Float32Array.from(chunks.flat());
  const file = `${OUT}/${pair.name}.wav`;
  writeFileSync(file, wav(samples, rate));
  const title = await page.evaluate(() => document.querySelector('.dock-track strong, .dock-title')?.textContent || document.title);
  if (process.env.TIMELINE) console.error(JSON.stringify({ media: await page.evaluate(() => window.__mediaLog) }));
  const metrics = { ...measure(samples, rate, { before: 10, after: 8 }), ...(pair.a.style === 'probe' ? probeSync(samples, rate, pair.a.root, pair.b.root, 60 / (pair.a.bpm * plan.rate), plan.seconds) : {}) };
  report.push({ metrics, file, seconds: +(samples.length / rate).toFixed(1), exitAt: +Math.min(from.duration - plan.seconds, from.mixStart).toFixed(2), songA: from.duration.toFixed(1), bpm: [from.outro?.bpm, to.intro?.bpm], rate: +plan.rate.toFixed(4), inRate: +plan.inRate.toFixed(4), blend: +plan.seconds.toFixed(2), glide: +plan.rampSeconds.toFixed(1), recover: +plan.recoverSeconds.toFixed(1), labels: [...labels].filter(Boolean), title, errors });
  await context.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
