import test from 'node:test';
import assert from 'node:assert/strict';
import { clearOffset, readOffset, saveOffset } from './lyric-offsets.js';

const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) }; };

test('a lyric offset set by hand is remembered for that song, in any version', () => {
  const storage = memory();
  saveOffset({ artist: 'Band', title: 'Night Drive' }, 0.6, storage);
  assert.equal(readOffset({ artist: 'BAND', title: 'Night Drive (Remastered)' }, storage), 0.6);
  assert.equal(readOffset({ artist: 'Band', title: 'Morning Light' }, storage), null, 'other songs have no choice saved');
});

test('zero set by hand is a choice; clearing returns the song to automatic timing', () => {
  const storage = memory();
  saveOffset({ artist: 'Band', title: 'Night Drive' }, 0.6, storage);
  saveOffset({ artist: 'Band', title: 'Night Drive' }, 0, storage);
  assert.equal(readOffset({ artist: 'Band', title: 'Night Drive' }, storage), 0);
  clearOffset({ artist: 'Band', title: 'Night Drive' }, storage);
  assert.equal(readOffset({ artist: 'Band', title: 'Night Drive' }, storage), null);
  assert.equal(JSON.parse(storage.getItem('aurora-lyric-offsets')).length, 0);
  for (let i = 0; i < 320; i++) saveOffset({ artist: 'A', title: `Song ${i}` }, 0.1, storage);
  assert.equal(JSON.parse(storage.getItem('aurora-lyric-offsets')).length, 300);
  assert.equal(readOffset({ artist: 'A', title: 'Song 319' }, storage), 0.1, 'the newest are kept');
});

test('broken or missing storage never breaks lyrics', () => {
  assert.equal(readOffset({ artist: 'A', title: 'B' }, { getItem: () => '{nope' }), null);
  assert.doesNotThrow(() => saveOffset({ artist: 'A', title: 'B' }, 1, { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } }));
});

test('an upload whose length differs from the catalogue version is a different edit', async () => {
  const { versionGap } = await import('./lyric-offsets.js');
  assert.equal(versionGap(212, 210.4), 1.6); // longer by more than a beat or two: another edit
  assert.equal(versionGap(208, 210.4), -2.4);
  assert.equal(versionGap(211, 210.4), 0); // the same recording, rounding apart
  for (const [upload, catalogue] of [[0, 210], [210, 0], [NaN, 210], [210, undefined]]) assert.equal(versionGap(upload, catalogue), 0);
});
