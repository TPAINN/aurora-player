import test from 'node:test';
import assert from 'node:assert/strict';
import { songKey } from './titles.js';

test('every version of one song shares a key', () => {
  const versions = ['Healing (Sousa AfroHouse Remix)', 'Healing [Ultra Records]', 'HEALING (YUMA REMIX)', 'Healing (Radio Version) [Shortened]', 'Healing', 'Healing - KREAM Remix', 'Healing (feat. Someone)', 'Healing feat. Someone'];
  assert.deepEqual([...new Set(versions.map(songKey))], ['healing']);
});

test('different songs keep different keys', () => {
  assert.notEqual(songKey('Heal'), songKey('Healing'));
  assert.notEqual(songKey('Night Drive'), songKey('Night Drive Home'));
  assert.equal(songKey('Ελπίδα (Live)'), songKey('ελπίδα'), 'any script, accents folded');
  assert.equal(songKey('(Intro)'), 'intro', 'a title made only of brackets keeps its words');
});
