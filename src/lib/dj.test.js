import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTempo, planTransition, equalPower, findMixPoint, findIntroStart } from './dj.js';

test('detects regular pulses and rejects silence', () => {
  const samples = new Float32Array(22050 * 20);
  for (let i = 0; i < samples.length; i += 11025) for (let j = 0; j < 220; j++) samples[i + j] = Math.exp(-j / 40);
  const tempo = estimateTempo(samples, 22050);
  assert.ok(Math.abs(tempo.bpm - 120) < 3);
  assert.ok(tempo.confidence >= 0.7);
  assert.equal(estimateTempo(new Float32Array(22050), 22050), null);
});
test('only trustworthy close tempos receive bounded ramp', () => {
  assert.ok(Math.abs(planTransition({ bpm: 120, confidence: .9 }, { bpm: 126, confidence: .9 }).rate - Math.sqrt(1.05)) < 1e-9);
  assert.equal(planTransition({ bpm: 80, confidence: .9 }, { bpm: 105, confidence: .9 }).rate, 1);
  assert.equal(planTransition({ bpm: 120, confidence: .2 }, { bpm: 126, confidence: .9 }).rate, 1);
  const halfTime = planTransition({ bpm: 120, confidence: .9 }, { bpm: 63, confidence: .9 });
  assert.ok(Math.abs(halfTime.rate - Math.sqrt(1.05)) < 1e-9);
  assert.equal(halfTime.targetBpm, 126);
});
test('equal power overlap preserves power and endpoints', () => {
  assert.deepEqual(equalPower(0), [1, 0]);
  const [outgoing, incoming] = equalPower(.5);
  assert.ok(Math.abs(outgoing ** 2 + incoming ** 2 - 1) < 1e-6);
  assert.ok(equalPower(1)[0] < 1e-10);
});

// A 190 s song: full energy to 168 s, a quieter outro to 186 s, then silence.
const withOutro = (rate = 100) => {
  const samples = new Float32Array(rate * 190).fill(.4);
  samples.fill(.15, rate * 168, rate * 186);
  samples.fill(0, rate * 186);
  return samples;
};
test('song A leaves where its outro begins, the best point in its last 30 seconds', () => {
  const point = findMixPoint(withOutro(), 100, 8);
  assert.ok(point >= 167 && point <= 169, String(point));
});
test('the blend never runs into the silent tail', () => {
  const point = findMixPoint(withOutro(), 100, 10);
  assert.ok(point + 10 <= 186 + 4, String(point));
});
test('the exit lands on a phrase boundary when the beat is known', () => {
  // Beats every 0.5 s from 0.25 s: 4-bar phrases start every 8 s (…, 160.25, 168.25).
  const point = findMixPoint(withOutro(), 100, 8, { origin: .25, period: .5 });
  assert.ok(Math.abs(point - 168.25) < 1e-6 || Math.abs(point - 160.25) < 1e-6, String(point));
});
test('steady energy uses the natural ending and short files stay bounded', () => {
  assert.equal(findMixPoint(new Float32Array(12000).fill(.4), 100, 5), 115);
  assert.equal(findMixPoint(new Float32Array(1000), 100, 5), 5);
});

test('intro cue trims clear silence only and preserves music starting immediately', () => {
  const samples = new Float32Array(1000); samples.fill(.3, 200);
  assert.ok(Math.abs(findIntroStart(samples, 100) - 1.95) < .001);
  assert.equal(findIntroStart(new Float32Array(1000).fill(.3), 100), 0);
  assert.equal(findIntroStart(new Float32Array(1000), 100), 0);
});

// ── v2: tempo glide, beat grid and cue selection ─────────────────────────────
import { snapToBeat, beatAlignedEntry, glideRate, planOnlineCue, quantizeRate, MAX_TEMPO_SHIFT } from './dj.js';

const pulses = (rate, seconds, bpm, offset = 0) => {
  const samples = new Float32Array(rate * seconds);
  const step = rate * 60 / bpm;
  for (let start = offset * rate; start < samples.length; start += step) for (let j = 0; j < rate / 50; j++) samples[Math.floor(start) + j] = Math.exp(-j / (rate / 500));
  return samples;
};

test('tempo estimate reports a sub-hop accurate bpm and the beat phase', () => {
  const tempo = estimateTempo(pulses(22050, 20, 123, .37), 22050);
  assert.ok(Math.abs(tempo.bpm - 123) < 1.2, `bpm ${tempo.bpm}`);
  const period = 60 / tempo.bpm;
  const distance = Math.abs(((tempo.phase - .37) % period + period * 1.5) % period - period / 2);
  assert.ok(distance < .03, `phase ${tempo.phase}`);
});

test('transition plan glides before a bar-quantised overlap of about five seconds', () => {
  const plan = planTransition({ bpm: 120, confidence: .9 }, { bpm: 126, confidence: .9 });
  assert.equal(plan.matched, true);
  assert.ok(plan.rampSeconds >= 3 && plan.rampSeconds <= 8);
  assert.ok(plan.seconds >= 4 && plan.seconds <= 7);
  const bars = plan.seconds * plan.blendBpm / 240;
  assert.ok(Math.abs(bars - Math.round(bars)) < 1e-9);
  const plain = planTransition(null, null);
  assert.deepEqual([plain.rate, plain.rampSeconds, plain.seconds, plain.matched], [1, 0, 5, false]);
  assert.equal(planTransition({ bpm: 100, confidence: .9 }, { bpm: 100 * (1 + 2 * MAX_TEMPO_SHIFT + .01), confidence: .9 }).rate, 1);
});

test('wide tempo gaps meet in the middle so neither song stretches past the bound', () => {
  const plan = planTransition({ bpm: 120, confidence: .9 }, { bpm: 126, confidence: .9 });
  // Song A speeds up, song B enters slowed to the same tempo, then returns to its own.
  assert.ok(Math.abs(120 * plan.rate - 126 * plan.inRate) < 1e-9, 'both decks share one tempo during the blend');
  assert.ok(plan.rate > 1 && plan.inRate < 1);
  assert.ok(plan.recoverSeconds >= 3 && plan.recoverSeconds <= 8);
  const wide = planTransition({ bpm: 100, confidence: .9 }, { bpm: 115, confidence: .9 });
  assert.equal(wide.matched, true);
  assert.ok(Math.abs(wide.rate - 1) <= MAX_TEMPO_SHIFT && Math.abs(wide.inRate - 1) <= MAX_TEMPO_SHIFT);
  // Small gaps stay on song A alone; song B plays untouched.
  const close = planTransition({ bpm: 120, confidence: .9 }, { bpm: 124, confidence: .9 });
  assert.ok(Math.abs(close.rate - 124 / 120) < 1e-9);
  assert.deepEqual([close.inRate, close.recoverSeconds], [1, 0]);
  assert.deepEqual([planTransition(null, null).inRate, planTransition(null, null).recoverSeconds], [1, 0]);
});

test('song B eases from the shared tempo back to its own after the blend', async () => {
  const { recoverRate } = await import('./dj.js');
  assert.equal(recoverRate(0, 4, .97), .97);
  assert.equal(recoverRate(4, 4, .97), 1);
  assert.ok(Math.abs(recoverRate(2, 4, .97) - .985) < 1e-9);
  assert.equal(recoverRate(1, 0, .97), 1);
});

test('a slowed incoming deck still lands its beat on the outgoing grid', async () => {
  const { beatAlignedEntry, phaseNudge } = await import('./dj.js');
  // Next outgoing beat in 0.2 s of wall time; B plays at 0.95×, so it covers 0.19 s of media first.
  const entry = beatAlignedEntry({ introStart: 1, inGrid: { origin: 1.25, period: .5 }, outPosition: 20.3, outGrid: { origin: 0, period: .5 }, rate: 1, inRate: .95 });
  assert.ok(Math.abs(entry - (1.25 - .2 * .95)) < 1e-9);
  // B's period at 0.95× matches A's at 1.0×: the nudge engages instead of refusing.
  const nudge = phaseNudge({ inPosition: 10.05, inGrid: { origin: 0, period: .475 }, outPosition: 20, outGrid: { origin: 0, period: .5 }, outRate: 1, inRate: .95 });
  assert.notEqual(nudge, 1);
});

test('the hollow sweep rises to the swap, then falls away into a tail', async () => {
  const { sweepShape, SWEEP_TAIL } = await import('./sweep.js');
  assert.equal(sweepShape(0).level, 0);
  assert.equal(sweepShape(1 + SWEEP_TAIL).level, 0);
  const peak = sweepShape(.5);
  assert.ok(Math.abs(peak.level - 1) < 1e-9);
  assert.ok(sweepShape(.25).level > 0 && sweepShape(.25).level < 1);
  assert.ok(peak.frequency > sweepShape(0).frequency && peak.frequency > sweepShape(1 + SWEEP_TAIL).frequency, 'the band climbs, then sinks');
  assert.ok(sweepShape(1 + SWEEP_TAIL).frequency < sweepShape(0).frequency, 'it ends deeper than it began');
});

test('the DJ blend holds the outgoing song, then swaps without a loudness hole', async () => {
  const { blendCurve } = await import('./dj.js');
  assert.deepEqual(blendCurve(0), [1, 0]);
  const [endOut, endIn] = blendCurve(1);
  assert.ok(endOut < 1e-9 && endIn === 1);
  let previous = blendCurve(0);
  for (let i = 1; i <= 100; i++) {
    const current = blendCurve(i / 100);
    assert.ok(current[0] <= previous[0] + 1e-12 && current[1] >= previous[1] - 1e-12, 'monotonic');
    const power = current[0] ** 2 + current[1] ** 2;
    assert.ok(power >= 1 - 1e-9 && power <= 1.6, `power ${power} at ${i}`);
    previous = current;
  }
  // The outgoing song is still near full level a quarter of the way in.
  assert.ok(blendCurve(.2)[0] > .97);
});

test('glide eases from native tempo to the target and holds it', () => {
  assert.equal(glideRate(9, 10, 5, 1.06), 1);
  assert.equal(glideRate(15, 10, 5, 1.06), 1.06);
  assert.ok(Math.abs(glideRate(12.5, 10, 5, 1.06) - 1.03) < 1e-9);
  assert.ok(glideRate(10.5, 10, 5, 1.06) - 1 < .003, 'starts gently');
  assert.equal(glideRate(20, 10, 0, 1.06), 1.06);
});

test('beat snapping and beat-aligned entry land incoming beats on the outgoing grid', () => {
  assert.ok(Math.abs(snapToBeat(10.2, { origin: .1, period: .5 }) - 10.1) < 1e-9);
  assert.equal(snapToBeat(10.2, null), 10.2);
  // Outgoing at 20.3 s, beats every 0.5 s from 0 at rate 1: next beat in 0.2 s.
  const entry = beatAlignedEntry({ introStart: 1, inGrid: { origin: 1.25, period: .5 }, outPosition: 20.3, outGrid: { origin: 0, period: .5 }, rate: 1 });
  assert.ok(Math.abs(entry - 1.05) < 1e-9);
  // A faster outgoing rate shortens the wall-clock wait.
  const fast = beatAlignedEntry({ introStart: 1, inGrid: { origin: 1.25, period: .5 }, outPosition: 20.3, outGrid: { origin: 0, period: .5 }, rate: 1.25 });
  assert.ok(Math.abs(fast - (1.25 - .2 / 1.25)) < 1e-9);
  assert.equal(beatAlignedEntry({ introStart: 2, inGrid: null, outPosition: 5, outGrid: null, rate: 1 }), 2);
});

test('intro cue skips a noise floor relative to the music but keeps a soft intro', () => {
  const floor = new Float32Array(1000).fill(.004); floor.fill(.3, 300);
  assert.ok(Math.abs(findIntroStart(floor, 100) - 2.95) < .001);
  const soft = new Float32Array(1000).fill(.05); soft.fill(.3, 300);
  assert.equal(findIntroStart(soft, 100), 0);
});

test('online cue follows genuinely timed vocals, otherwise the natural ending', () => {
  const lines = [{ time: 10, end: 14 }, { time: 170, end: 175, words: [{ start: 170, end: 172 }, { start: 172, end: 176 }] }];
  assert.deepEqual(planOnlineCue(200, lines), { start: 177, end: 182, seconds: 5, source: 'lyrics' });
  assert.deepEqual(planOnlineCue(200, [{ time: 190, end: 200 }]), { start: 193.5, end: 198.5, seconds: 5, source: 'ending' });
  assert.deepEqual(planOnlineCue(200, [{ time: 20, end: 40 }]), { start: 193.5, end: 198.5, seconds: 5, source: 'ending' });
  assert.equal(planOnlineCue(8, []).start, 1.5);
});

test('playback rates snap to what the player supports', () => {
  assert.equal(quantizeRate([.25, .5, .75, 1, 1.25], 1.05), 1);
  assert.equal(quantizeRate([.95, 1, 1.05, 1.1], 1.06), 1.05);
  assert.equal(quantizeRate(undefined, 1.06), 1);
});

test('phase nudge pulls a late or early incoming beat back onto the grid', async () => {
  const { phaseNudge } = await import('./dj.js');
  const grid = { origin: 0, period: .5 };
  assert.equal(phaseNudge({ inPosition: 10, inGrid: grid, outPosition: 20, outGrid: grid, outRate: 1 }), 1);
  assert.ok(phaseNudge({ inPosition: 10.05, inGrid: grid, outPosition: 20, outGrid: grid, outRate: 1 }) < 1, 'incoming ahead slows down');
  assert.ok(phaseNudge({ inPosition: 9.95, inGrid: grid, outPosition: 20, outGrid: grid, outRate: 1 }) > 1, 'incoming behind speeds up');
  assert.ok(Math.abs(phaseNudge({ inPosition: 10.2, inGrid: grid, outPosition: 20, outGrid: grid, outRate: 1 }) - 1) <= .04 + 1e-9);
  assert.equal(phaseNudge({ inPosition: 10.1, inGrid: { origin: 0, period: .25 }, outPosition: 20, outGrid: grid, outRate: 1.3 }), 1, 'unrelated periods are left alone');
  assert.equal(phaseNudge({ inPosition: 10, inGrid: null, outPosition: 20, outGrid: grid, outRate: 1 }), 1);
});

test('blends last 5–10 seconds, in whole bars when the beat is known', () => {
  for (const bpm of [70, 90, 120, 128, 150, 174])
    for (const target of [5, 8, 10]) {
      const plan = planTransition({ bpm, confidence: .9 }, { bpm, confidence: .9 }, target);
      assert.ok(plan.seconds >= 5 - 1e-9 && plan.seconds <= 10 + 1e-9, `${bpm} bpm, ${target} s → ${plan.seconds}`);
      const bars = plan.seconds * bpm / 240;
      assert.ok(Math.abs(bars - Math.round(bars)) < 1e-9 || Math.abs(plan.seconds - 10) < 1e-9 || Math.abs(plan.seconds - 5) < 1e-9);
    }
  const long = planTransition({ bpm: 120, confidence: .9 }, { bpm: 120, confidence: .9 }, 10);
  assert.equal(long.seconds, 10);
  assert.equal(planTransition(null, null, 8).seconds, 8);
  assert.equal(planOnlineCue(200, [], 8).seconds, 8);
});

test('players that only take 0.05 speed steps still line the tempos up', () => {
  // 120 → 126: song A to 1.05× hits 126 exactly.
  const up = planTransition({ bpm: 120, confidence: .9 }, { bpm: 126, confidence: .9 }, 8, { step: .05 });
  assert.deepEqual([up.matched, up.rate, up.inRate], [true, 1.05, 1]);
  // 120 → 133: A 1.05× (126) meets B 0.95× (126.35).
  const wide = planTransition({ bpm: 120, confidence: .9 }, { bpm: 133, confidence: .9 }, 8, { step: .05 });
  assert.deepEqual([wide.matched, wide.rate, wide.inRate], [true, 1.05, .95]);
  // 120 → 123: no pair on the grid comes within 1 %, so no tempo claim.
  const off = planTransition({ bpm: 120, confidence: .9 }, { bpm: 123, confidence: .9 }, 8, { step: .05 });
  assert.deepEqual([off.matched, off.rate, off.inRate], [false, 1, 1]);
});

test('entry into song B matches the energy song A is leaving with, on a phrase boundary', async () => {
  const { chooseEntry } = await import('./dj.js');
  // 0.5 s levels: a quiet ambient intro for 16 s, then the full beat.
  const levels = Array.from({ length: 70 }, (_, i) => (i < 32 ? .05 : .4));
  const grid = { origin: 0, period: .5 };
  assert.equal(chooseEntry({ levels, introStart: 0, grid, targetLevel: .4 }), 16, 'a driving outro meets the first full section');
  assert.equal(chooseEntry({ levels, introStart: 0, grid, targetLevel: .05 }), 0, 'a quiet fade meets the soft intro');
  assert.equal(chooseEntry({ levels, introStart: 1.2, grid, targetLevel: null }), 1.2, 'unknown energy keeps the natural start');
  const steady = Array.from({ length: 70 }, () => .3);
  assert.equal(chooseEntry({ levels: steady, introStart: 0, grid, targetLevel: .3 }), 0, 'equal candidates prefer the earliest');
  assert.ok(chooseEntry({ levels, introStart: 0, grid: null, targetLevel: .4 }) <= 30, 'never skips more than 30 seconds');
});

test('online entry lets a long instrumental intro run out just as the blend completes', async () => {
  const { planOnlineEntry } = await import('./dj.js');
  assert.equal(planOnlineEntry([{ time: 38 }, { time: 42 }], 5), 29);
  assert.equal(planOnlineEntry([{ time: 7 }], 5), 0, 'short intros play from the top');
  assert.equal(planOnlineEntry([], 5), 0);
  assert.equal(planOnlineEntry([{ time: 120 }], 5), 45, 'bounded skip');
});

test('a breakbeat (kick once a bar, snare on 2 and 4, hats) still reads its tempo', () => {
  const rate = 22050, bpm = 100, beat = 60 / bpm;
  const samples = new Float32Array(rate * 24);
  const hit = (time, gain, decay) => { const start = Math.floor(time * rate); for (let j = 0; j < rate * .2 && start + j < samples.length; j++) samples[start + j] += Math.exp(-j / (rate * decay)) * gain * Math.sin(j / 3); };
  for (let b = 0; b * beat * 4 < 24; b++) {
    const t0 = b * beat * 4;
    hit(t0, .9, .06);
    hit(t0 + beat, .4, .03); hit(t0 + 3 * beat, .4, .03);
    for (let e = 0; e < 8; e++) hit(t0 + e * beat / 2, .08, .005);
  }
  const tempo = estimateTempo(samples, rate);
  assert.ok(tempo, 'tempo found');
  const octave = [tempo.bpm, tempo.bpm * 2, tempo.bpm / 2].some(value => Math.abs(value - bpm) < 1.5);
  assert.ok(octave, `bpm ${tempo.bpm}`);
});

test('song A leaves when its last full-energy section ends, not deep in the fade', () => {
  // Full energy to 54 s, then an outro 10 % quieter that fades to silence by 70 s.
  const rate = 100, samples = new Float32Array(rate * 72.5);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    samples[i] = t < 54 ? .16 : t < 70 ? .145 * (1 - (t - 54) / 16 * .8) : 0;
  }
  const point = findMixPoint(samples, rate, 8);
  assert.ok(point >= 53 && point <= 56, String(point));
});

test('auto blend length prefers the longest blend the music leaves room for', async () => {
  const { adaptiveBlend } = await import('./dj.js');
  assert.equal(adaptiveBlend({}), 10, 'nothing in the way: the longest');
  assert.equal(adaptiveBlend({ outroSpan: 7.2 }), 7.2, 'song A starts singing again 7.2 s before its end');
  assert.equal(adaptiveBlend({ outroSpan: 30, introSpan: 6.5 }), 6.5, 'song B sings after 6.5 s');
  assert.equal(adaptiveBlend({ outroSpan: 2, introSpan: 3 }), 5, 'never shorter than five seconds');
  assert.equal(adaptiveBlend({ outroSpan: Infinity, introSpan: NaN }), 10);
});

test('online outro and intro spans come from genuinely timed lyrics only', async () => {
  const { vocalSpans } = await import('./dj.js');
  const a = [{ time: 150, words: [{ start: 150, end: 151 }, { start: 151, end: 190.5 - 0 }] }];
  assert.deepEqual(vocalSpans({ duration: 200, outLines: a, inLines: [{ time: 8.5 }], entry: 0 }), { outroSpan: 9.5, introSpan: 8.5 });
  assert.deepEqual(vocalSpans({ duration: 200, outLines: [], inLines: [], entry: 0 }), { outroSpan: Infinity, introSpan: Infinity });
  assert.deepEqual(vocalSpans({ duration: 200, outLines: [], inLines: [{ time: 40 }], entry: 25 }), { outroSpan: Infinity, introSpan: 15 });
  const lead = [{ time: 8, words: [{ start: 11.2, end: 11.6 }] }];
  assert.equal(vocalSpans({ duration: 200, inLines: lead, entry: 0 }).introSpan, 11.2, 'the first sung word, not the line start');
});
