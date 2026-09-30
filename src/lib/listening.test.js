import test from 'node:test';
import assert from 'node:assert/strict';
import { recordListening, rankForTaste } from './listening.js';

test('listening preferences stay bounded and favor enjoyed related artists', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  try {
    const enjoyed = { id: '1', title: 'First song', artist: 'Enjoyed artist' };
    recordListening(enjoyed, 180, 200);
    const candidates = [{ title: 'Other', artist: 'Other artist' }, { title: 'Second song', artist: enjoyed.artist }];
    assert.equal(rankForTaste(candidates)[0].artist, enjoyed.artist);
    recordListening({ ...enjoyed, localUrl: 'blob:test' }, 200, 200);
    assert.equal(JSON.parse(values.get('aurora-listening')).length, 1);
    for (let i = 0; i < 130; i++) recordListening(enjoyed, 8, 200);
    assert.equal(JSON.parse(values.get('aurora-listening')).length, 120);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
