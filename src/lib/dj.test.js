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
  assert.ok(point >= 120 * .72 && point <= 114);
});
test('steady energy uses the natural ending and short files stay bounded', () => {
  assert.equal(findMixPoint(new Float32Array(12000).fill(.4), 100), 114);
  assert.equal(findMixPoint(new Float32Array(1000), 100), 4);
});

test('intro cue trims clear silence only and preserves music starting immediately', () => {
  const samples = new Float32Array(1000); samples.fill(.3, 200);
  assert.ok(Math.abs(findIntroStart(samples, 100) - 1.95) < .001);
  assert.equal(findIntroStart(new Float32Array(1000).fill(.3), 100), 0);
  assert.equal(findIntroStart(new Float32Array(1000), 100), 0);
});
