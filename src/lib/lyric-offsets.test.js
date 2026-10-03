import test from 'node:test';
import assert from 'node:assert/strict';
import { readOffset, saveOffset } from './lyric-offsets.js';

const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) }; };

test('a lyric offset set by hand is remembered for that song, in any version', () => {
  const storage = memory();
  saveOffset({ artist: 'Band', title: 'Night Drive' }, 0.6, storage);
  assert.equal(readOffset({ artist: 'BAND', title: 'Night Drive (Remastered)' }, storage), 0.6);
  assert.equal(readOffset({ artist: 'Band', title: 'Morning Light' }, storage), 0, 'other songs start at zero');
});

test('resetting to zero forgets the song, and storage stays bounded', () => {
  const storage = memory();
  saveOffset({ artist: 'Band', title: 'Night Drive' }, 0.6, storage);
  saveOffset({ artist: 'Band', title: 'Night Drive' }, 0, storage);
  assert.equal(JSON.parse(storage.getItem('aurora-lyric-offsets')).length, 0);
  for (let i = 0; i < 320; i++) saveOffset({ artist: 'A', title: `Song ${i}` }, 0.1, storage);
  assert.equal(JSON.parse(storage.getItem('aurora-lyric-offsets')).length, 300);
  assert.equal(readOffset({ artist: 'A', title: 'Song 319' }, storage), 0.1, 'the newest are kept');
});

test('broken or missing storage never breaks lyrics', () => {
  assert.equal(readOffset({ artist: 'A', title: 'B' }, { getItem: () => '{nope' }), 0);
  assert.doesNotThrow(() => saveOffset({ artist: 'A', title: 'B' }, 1, { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } }));
});
