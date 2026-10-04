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
