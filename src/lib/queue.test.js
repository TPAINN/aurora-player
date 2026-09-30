import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPlayable } from './queue.js';

const queue = ['a', 'b', 'c', 'd'].map(id => ({ id }));

test('the next song skips songs known to be unplayable', () => {
  assert.equal(nextPlayable(queue, 'a').item.id, 'b');
  assert.equal(nextPlayable(queue, 'a', { unplayable: new Set(['b', 'c']) }).item.id, 'd');
});

test('the end of the queue wraps only when allowed', () => {
  assert.equal(nextPlayable(queue, 'd').item, null);
  assert.equal(nextPlayable(queue, 'd', { wrap: true }).item.id, 'a');
  assert.equal(nextPlayable(queue, 'c', { wrap: true, unplayable: new Set(['d', 'a']) }).item.id, 'b');
  assert.equal(nextPlayable([], 'x', { wrap: true }).item, null);
});

test('shuffle picks the next song ahead of time and keeps it, so it can be prepared', () => {
  const first = nextPlayable(queue, 'b', { shuffle: true, random: () => .99 });
  assert.ok(first.item && first.item.id !== 'b');
  const again = nextPlayable(queue, 'b', { shuffle: true, pick: first.pick, random: () => 0 });
  assert.equal(again.item.id, first.item.id, 'stable for the same song');
  const skipped = nextPlayable(queue, 'b', { shuffle: true, pick: first.pick, unplayable: new Set([first.item.id]), random: () => 0 });
  assert.notEqual(skipped.item.id, first.item.id, 'a pick that turns out unplayable is replaced');
  assert.equal(nextPlayable([{ id: 'b' }], 'b', { shuffle: true }).item, null);
});
