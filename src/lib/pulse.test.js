import test from 'node:test';
import assert from 'node:assert/strict';
import { pulsePeriod, pulsePhase } from './pulse.js';

test('the pulse follows the measured tempo, folded into a slow, calm wave', () => {
  assert.equal(pulsePeriod(120), 1); // two beats
  assert.equal(pulsePeriod(60), 1); // one beat
  assert.equal(pulsePeriod(90), 4 / 3); // two beats
  assert.equal(pulsePeriod(174), 120 / 174 * 2); // four beats on fast songs
  assert.ok(pulsePeriod(174) >= 0.9 && pulsePeriod(174) <= 1.8);
  assert.equal(pulsePeriod(45), 60 / 45);
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
