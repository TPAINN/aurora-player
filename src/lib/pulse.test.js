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
