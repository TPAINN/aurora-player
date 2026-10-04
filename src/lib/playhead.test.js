import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayhead } from './playhead.js';

test('between coarse samples the playhead advances smoothly at the playback rate', () => {
  const head = createPlayhead();
  assert.equal(head.read({ raw: 10, playing: true, rate: 1, now: 1000 }), 10);
  assert.equal(head.read({ raw: 10, playing: true, rate: 1, now: 1100 }), 10.1);
  assert.equal(head.read({ raw: 10, playing: true, rate: 1.05, now: 1200 }), 10.2, 'rate is taken from the sample, not mid-way');
  assert.equal(head.read({ raw: 10.25, playing: true, rate: 1.05, now: 1250 }), 10.25);
  assert.ok(Math.abs(head.read({ raw: 10.25, playing: true, rate: 1.05, now: 1350 }) - 10.355) < 1e-9, 'a new sample carries its own rate');
});

test('the playhead never steps backwards for sample jitter, but follows a real seek', () => {
  const head = createPlayhead();
  head.read({ raw: 20, playing: true, rate: 1, now: 0 });
  assert.equal(head.read({ raw: 20, playing: true, rate: 1, now: 240 }), 20.24);
  assert.equal(head.read({ raw: 20.2, playing: true, rate: 1, now: 250 }), 20.24, 'a sample slightly behind the projection holds');
  assert.equal(head.read({ raw: 5, playing: true, rate: 1, now: 300 }), 5, 'a seek back is followed at once');
});

test('the playhead does not run ahead of a stalled or paused source', () => {
  const head = createPlayhead();
  head.read({ raw: 30, playing: true, rate: 1, now: 0 });
  assert.equal(head.read({ raw: 30, playing: true, rate: 1, now: 2000 }), 30.35, 'projection is capped');
  assert.equal(head.read({ raw: 30.5, playing: false, rate: 1, now: 2100 }), 30.5, 'paused: the raw time');
  assert.equal(head.read({ raw: Number.NaN, playing: true, rate: 1, now: 2200 }), 0);
});

test('device audio: lyrics follow what is heard, the output latency behind the decoder', async () => {
  const { heardTime } = await import('./playhead.js');
  assert.equal(heardTime(10, { playing: true, latency: 0.12 }), 9.88);
  assert.equal(heardTime(10, { playing: false, latency: 0.12 }), 10); // paused: exactly where it stopped
  assert.equal(heardTime(0.05, { playing: true, latency: 0.12 }), 0); // never before the start
  assert.equal(heardTime(10, { playing: true, latency: 2 }), 9.5); // an implausible report is capped
  for (const latency of [undefined, NaN, -1]) assert.equal(heardTime(10, { playing: true, latency }), 10);
});
