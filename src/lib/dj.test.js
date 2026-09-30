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
  assert.equal(planTransition({ bpm: 120, confidence: .9 }, { bpm: 126, confidence: .9 }).rate, 1.05);
  assert.equal(planTransition({ bpm: 80, confidence: .9 }, { bpm: 140, confidence: .9 }).rate, 1);
  assert.equal(planTransition({ bpm: 120, confidence: .2 }, { bpm: 126, confidence: .9 }).rate, 1);
  const halfTime = planTransition({ bpm: 120, confidence: .9 }, { bpm: 63, confidence: .9 });
  assert.equal(halfTime.rate, 1.05);
  assert.equal(halfTime.targetBpm, 126);
});
test('equal power overlap preserves power and endpoints', () => {
  assert.deepEqual(equalPower(0), [1, 0]);
  const [outgoing, incoming] = equalPower(.5);
  assert.ok(Math.abs(outgoing ** 2 + incoming ** 2 - 1) < 1e-6);
  assert.ok(equalPower(1)[0] < 1e-10);
});

test('mix point follows a quiet outro phrase within safe final-track bounds', () => {
  const rate = 100;
  const samples = new Float32Array(rate * 120).fill(.4);
  samples.fill(.015, rate * 99, rate * 101);
  const point = findMixPoint(samples, rate);
  assert.ok(point >= 99 && point <= 101);
  assert.ok(point >= 120 * .72 && point <= 115);
});
test('steady energy uses the natural ending and short files stay bounded', () => {
  assert.equal(findMixPoint(new Float32Array(12000).fill(.4), 100), 115);
  assert.equal(findMixPoint(new Float32Array(1000), 100), 5);
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
  const bars = plan.seconds * plan.targetBpm / 240;
  assert.ok(Math.abs(bars - Math.round(bars)) < 1e-9);
  const plain = planTransition(null, null);
  assert.deepEqual([plain.rate, plain.rampSeconds, plain.seconds, plain.matched], [1, 0, 5, false]);
  assert.equal(planTransition({ bpm: 100, confidence: .9 }, { bpm: 100 * (1 + MAX_TEMPO_SHIFT + .01), confidence: .9 }).rate, 1);
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

test('blend length preference scales the bar-quantised overlap', () => {
  const quick = planTransition({ bpm: 120, confidence: .9 }, { bpm: 120, confidence: .9 }, 3);
  const long = planTransition({ bpm: 120, confidence: .9 }, { bpm: 120, confidence: .9 }, 8);
  assert.ok(quick.seconds >= 2.4 && quick.seconds <= 4.2, String(quick.seconds));
  assert.ok(long.seconds >= 6.4 && long.seconds <= 11.2, String(long.seconds));
  assert.equal(planTransition(null, null, 8).seconds, 8);
  assert.equal(planOnlineCue(200, [], 8).seconds, 8);
});
