// Records real DJ transitions from the app so they can be listened to.
// Synthesizes original test songs (intro → main → outro → silence) at chosen tempos,
// plays each pair through the app's own local DJ engine in Chromium, and captures
// everything the app sends to the speakers as a WAV file.
//
//   npm run build && npm run preview -- --port 5188
//   BASE=http://localhost:5188/ CHROMIUM_PATH=... node scripts/render-transitions.mjs [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyzeSamples, planTransition } from '../src/lib/dj.js';

const BASE = process.env.BASE || 'http://localhost:5188/';
const OUT = process.argv[2] || 'transitions';
const RATE = 44100;
const BLEND = 8;
mkdirSync(OUT, { recursive: true });

// ── Song synthesis ───────────────────────────────────────────────────────────
function song({ bpm, root, seconds = 70, seed = 1, style = 'house' }) {
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

const pairs = [
  { name: '1-house-120-to-126', a: { bpm: 120, root: 55, seed: 1 }, b: { bpm: 126, root: 61.74, seed: 2 } },
  { name: '2-deep-124-to-118', a: { bpm: 124, root: 49, seed: 3 }, b: { bpm: 118, root: 58.27, seed: 4 } },
  { name: '3-wide-gap-100-to-112', a: { bpm: 100, root: 51.91, seed: 5, style: 'breaks' }, b: { bpm: 112, root: 55, seed: 6 } },
  { name: '4-same-tempo-128', a: { bpm: 128, root: 46.25, seed: 7 }, b: { bpm: 128, root: 55, seed: 8 } },
  { name: '5-half-time-87-to-174', a: { bpm: 87, root: 55, seed: 9, style: 'breaks' }, b: { bpm: 174, root: 49, seed: 10, style: 'breaks' } },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });
const report = [];
for (const pair of pairs) {
  const a = song(pair.a), b = song(pair.b);
  const from = analyzeSamples(a, RATE), to = analyzeSamples(b, RATE);
  const plan = planTransition(from.outro, to.intro, BLEND);
  const exit = Math.min(from.duration - plan.seconds, from.mixStart);
  // Ten seconds of song A before anything moves, then glide, blend, recovery and song B alone.
  const start = Math.max(0, exit - plan.rampSeconds - 10);
  const seconds = exit - start + plan.seconds + plan.recoverSeconds + 8;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    sessionStorage.setItem('aurora:welcome-seen', '1');
    localStorage.setItem('aurora-dj', 'true'); localStorage.setItem('aurora-autoplay', 'false'); localStorage.setItem('aurora-blend', '8');
    // Tap everything the app sends to the speakers.
    window.__recording = [];
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
  await page.evaluate(() => { window.__recording = []; window.__recordingOn = true; });
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
  report.push({ file, seconds: +(samples.length / rate).toFixed(1), exitAt: +Math.min(from.duration - plan.seconds, from.mixStart).toFixed(2), songA: from.duration.toFixed(1), bpm: [from.outro?.bpm, to.intro?.bpm], rate: +plan.rate.toFixed(4), inRate: +plan.inRate.toFixed(4), blend: +plan.seconds.toFixed(2), glide: +plan.rampSeconds.toFixed(1), recover: +plan.recoverSeconds.toFixed(1), labels: [...labels].filter(Boolean), title, errors });
  await context.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
