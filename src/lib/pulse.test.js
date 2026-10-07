import test from 'node:test';
import assert from 'node:assert/strict';
import { pulsePeriod, pulsePhase } from './pulse.js';

test('the pulse kicks on every beat; fast songs fall to every second beat', () => {
  assert.equal(pulsePeriod(120), 0.5); // one beat
  assert.equal(pulsePeriod(60), 1);
  assert.equal(pulsePeriod(90), 60 / 90);
  assert.equal(pulsePeriod(160), 0.75); // two beats: never a flicker
  assert.equal(pulsePeriod(174), 120 / 174);
  assert.equal(pulsePeriod(45), 60 / 45); // slow songs keep their own beat
  for (const bpm of [40, 70, 100, 140, 200, 240]) assert.ok(pulsePeriod(bpm) >= 0.42 && pulsePeriod(bpm) <= 1.5, String(bpm));
});

test('no tempo, no pulse: an unknown or implausible tempo never invents a beat', () => {
  for (const bpm of [null, undefined, 0, -10, NaN, Infinity, 20, 400]) assert.equal(pulsePeriod(bpm), null);
});

test('the phase is anchored to the peak start and stays put through seeks', () => {
  assert.equal(pulsePhase(30, 30, 1), 0);
  assert.ok(Math.abs(pulsePhase(30.25, 30, 1) - 0.25) < 1e-9);
  assert.ok(Math.abs(pulsePhase(42.75, 30, 1) - 0.75) < 1e-9);
  assert.ok(Math.abs(pulsePhase(29.75, 30, 1) - 0.75) < 1e-9); // before the anchor: late in the previous wave
});

test('the beat phase comes from sung onsets: long words on the beat outweigh pickups', async () => {
  const { beatPhase } = await import('./pulse.js');
  const period = 0.5, origin = 0.13; // beats at 0.13, 0.63, 1.13, …
  const words = [];
  for (let beat = 0; beat < 40; beat++) {
    words.push({ start: origin + beat * period + (beat % 3 === 0 ? 0.012 : -0.008), end: origin + beat * period + 0.4 }); // on the beat, held
    if (beat % 2) words.push({ start: origin + beat * period + 0.25, end: origin + beat * period + 0.33 }); // a short offbeat pickup
  }
  const found = beatPhase(words, period);
  assert.ok(found && Math.abs(found.origin - origin) < 0.02, JSON.stringify(found));
});

test('no clear lock, no phase: syncopated, sparse or untimed vocals change nothing', async () => {
  const { beatPhase } = await import('./pulse.js');
  const scattered = Array.from({ length: 40 }, (_, i) => ({ start: i * 0.37 + (i % 7) * 0.05, end: i * 0.37 + 0.2 }));
  assert.equal(beatPhase(scattered, 0.5), null);
  assert.equal(beatPhase([{ start: 1, end: 2 }, { start: 1.5, end: 2 }], 0.5), null);
  assert.equal(beatPhase([], 0.5), null);
  assert.equal(beatPhase(Array.from({ length: 30 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.3 })), null), null);
});

// A deterministic pseudo-random sequence, so the vocal fixtures are repeatable.
function rng(seed) {
  let value = seed;
  return () => ((value = (value * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
// A sung vocal on a beat grid: most syllables on beats or half beats, a few pickups,
// timing jitter of a few tens of milliseconds.
function vocal({ bpm, origin = 0.37, seconds = 150, seed = 7 }) {
  const random = rng(seed), beat = 60 / bpm, words = [];
  for (let t = origin + 8 * beat; t < seconds; t += beat / 2) {
    const onBeat = Math.round((t - origin) / beat * 2) % 2 === 0;
    if (random() > (onBeat ? 0.75 : 0.45)) continue;
    const start = t + (random() - 0.5) * 0.05;
    words.push({ start, end: start + (onBeat ? beat * 0.8 : beat * 0.3) });
  }
  return words;
}

test('without a catalogue tempo, the beat is measured from word-timed vocals', async () => {
  const { lyricBeat } = await import('./pulse.js');
  for (const bpm of [78, 96, 120, 128, 140]) {
    const grid = lyricBeat(vocal({ bpm, seed: bpm }));
    assert.ok(grid, `${bpm} BPM found`);
    // The same pulse as the song: the beat, or a whole multiple or division of it,
    // locked tightly enough to stay on the beat for a minute.
    const ratio = grid.period / (60 / bpm);
    const nearest = [0.5, 1, 2].reduce((best, value) => Math.abs(value - ratio) < Math.abs(best - ratio) ? value : best);
    assert.ok(Math.abs(ratio / nearest - 1) < 0.002, `${bpm}: period ${grid.period} (ratio ${ratio.toFixed(4)})`);
    const beat = 60 / bpm;
    const offset = ((grid.origin - 0.37) % beat + beat) % beat;
    assert.ok(Math.min(offset, beat - offset) < 0.04, `${bpm}: phase off by ${offset.toFixed(3)} s`);
  }
});

test('scattered or sparse vocals give no measured beat', async () => {
  const { lyricBeat } = await import('./pulse.js');
  const random = rng(3), scattered = [];
  for (let i = 0; i < 260; i++) { const start = random() * 160; scattered.push({ start, end: start + 0.2 + random() * 0.4 }); }
  assert.equal(lyricBeat(scattered), null);
  assert.equal(lyricBeat(vocal({ bpm: 120 }).slice(0, 20)), null);
  assert.equal(lyricBeat([]), null);
});

test('line-timed lyrics still place a known tempo on the beat', async () => {
  const { linePhase } = await import('./pulse.js');
  const beat = 0.5, origin = 0.21;
  // Lines start on downbeats (every 4 or 8 beats), give or take a little.
  const random = rng(11), lines = [];
  for (let bar = 4; bar < 80; bar += random() > 0.5 ? 2 : 1) lines.push({ time: origin + bar * 4 * beat + (random() - 0.5) * 0.06 });
  const phase = linePhase(lines, beat);
  assert.ok(phase && Math.abs(phase.origin - origin) < 0.04, JSON.stringify(phase));
  // Lines that ignore the beat give nothing.
  const loose = Array.from({ length: 40 }, () => ({ time: random() * 160 }));
  assert.equal(linePhase(loose, beat), null);
});

// Off-beat-heavy rap, fast verses and drifting live takes.
function phrased({ bpm, jitter = 0.05, keep, sixteenths = false, drift = 0, seed = 5 }) {
  const random = rng(seed), words = [];
  let beat = 60 / bpm, t = 0.37;
  const step = sixteenths ? 4 : 2;
  for (let i = 0; t < 150; i++) {
    const onBeat = i % step === 0;
    if (random() <= (onBeat ? keep[0] : keep[1])) { const start = t + (random() - 0.5) * jitter * 2; words.push({ start, end: start + (onBeat ? beat * 0.7 : (beat / step) * 0.8) }); }
    t += beat / step; beat *= 1 + drift / ((150 / beat) * step);
  }
  return words;
}
test('a measured pulse lands on beats, never off-beats, and a drifting take gets none', async () => {
  const { lyricBeat } = await import('./pulse.js');
  for (const [bpm, options] of [[92, { keep: [0.7, 0.6], sixteenths: true }], [150, { keep: [0.8, 0.5], sixteenths: true }]]) {
    const grid = lyricBeat(phrased({ bpm, ...options }));
    const beat = 60 / bpm, off = (((grid.origin - 0.37) % beat) + beat) % beat;
    assert.ok(Math.min(off, beat - off) < 0.03, `${bpm} BPM rap: ${(off * 1000).toFixed(0)} ms off the beat`);
  }
  assert.equal(lyricBeat(phrased({ bpm: 100, keep: [0.75, 0.45], drift: 0.02 })), null, 'a 2 % drifting live take');
  assert.equal(lyricBeat(phrased({ bpm: 100, keep: [0.75, 0.45], drift: 0.06, jitter: 0.08 })), null, 'rubato');
});

test('the best-part glow opens just ahead of the section and closes as it ends', async () => {
  const { peakWindow } = await import('./pulse.js');
  const peaks = [{ start: 20, end: 40 }, { start: 90, end: 110 }];
  const options = { lead: 0.3, close: 0.9 };
  assert.deepEqual(peakWindow(19.5, peaks, options), { index: -1, until: 0.2 }, 'opens one lead early');
  assert.equal(peakWindow(19.75, peaks, options).index, 0);
  assert.ok(Math.abs(peakWindow(30, peaks, options).until - 9.1) < 1e-9, 'closes 0.9 s before the end');
  assert.equal(peakWindow(39.2, peaks, options).index, -1, 'already closing as the section ends');
  assert.ok(Math.abs(peakWindow(50, peaks, options).until - 39.7) < 1e-9, 'next opening');
  assert.deepEqual(peakWindow(120, peaks, options), { index: -1, until: Infinity });
  // A peak shorter than its own lead and close still shows, for at least a moment.
  assert.equal(peakWindow(60.2, [{ start: 60, end: 61 }], options).index, 0);
});

test('the whole background breathes gently on every beat, and more in a best part', async () => {
  const { breath } = await import('./pulse.js');
  const calm = breath({ peak: false, strength: 1 });
  const light = breath({ peak: true, strength: 0.45 });
  const strong = breath({ peak: true, strength: 1 });
  assert.ok(calm.zoom > 0 && calm.zoom <= 0.01, JSON.stringify(calm));
  assert.ok(calm.zoom < light.zoom && light.zoom < strong.zoom && strong.zoom <= 0.025, JSON.stringify({ light, strong }));
  assert.ok(calm.glow > 0 && calm.glow < light.glow && light.glow < strong.glow && strong.glow <= 0.3);
  assert.deepEqual(breath({ peak: true, strength: 7 }), strong, 'strength is clamped');
});

test('the breath only starts or stops while the background is at rest, so it never jumps', async () => {
  const { atRest, BREATH_KEYS } = await import('./pulse.js');
  const rest = BREATH_KEYS.at(-2).offset;
  assert.equal(atRest(0.25, 0.5), false, 'mid-beat');
  assert.equal(atRest(0.5 * 0.1, 0.5), false, 'on the attack');
  assert.equal(atRest(0.5 * (rest + 0.01), 0.5), true, 'after the release');
  // Every key from the rest point on is the background's own size.
  assert.ok(BREATH_KEYS.filter(key => key.offset >= rest).every(key => key.level === 0));
  assert.equal(BREATH_KEYS[0].level, 0);
});
