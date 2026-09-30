import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodeKrc, parseKrc } from './lyrics-formats.js';
import { fetchLyrics } from './lyrics-providers.js';

const KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
const encodeKrc = text => {
  const body = deflateSync(Buffer.from(text, 'utf8'));
  for (let i = 0; i < body.length; i++) body[i] ^= KEY[i % KEY.length];
  return Buffer.concat([Buffer.from('krc1'), body]).toString('base64');
};
const krc = '[ti:Night Drive]\n[ar:Band]\n[1000,2000]<0,500,0>Under <500,700,0>the <1200,800,0>lights\n[3500,1500]<0,1500,0>Again\n';

test('KuGou KRC decrypts to genuine word timing', () => {
  const text = decodeKrc(encodeKrc(krc));
  assert.equal(text, krc);
  const result = parseKrc(text, 'KuGou', 10);
  assert.equal(result.sync, 'word');
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.lines[0].words.map(word => [word.text, word.start, word.end]), [['Under ', 1, 1.5], ['the ', 1.5, 2.2], ['lights', 2.2, 3]]);
  assert.equal(result.lines[0].time, 1);
  assert.equal(result.lines[1].text, 'Again');
  assert.equal(decodeKrc('bm90IGtyYw=='), null, 'non-KRC payloads are rejected');
});

const json = value => new Response(JSON.stringify(value));
test('KuGou word lyrics are found by artist, title and duration', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    const address = new URL(url);
    if (address.hostname === 'krcs.kugou.com') return json({ candidates: [{ id: '1', accesskey: 'k1', song: 'Other', singer: 'Band', duration: 180000 }, { id: '2', accesskey: 'k2', song: 'Night Drive', singer: 'Band', duration: 181000 }] });
    if (address.hostname === 'lyrics.kugou.com') { assert.equal(address.searchParams.get('id'), '2'); return json({ status: 200, content: encodeKrc(krc) }); }
    return new Response('{}', { status: 404 });
  });
  const result = await fetchLyrics({ title: 'Night Drive', artist: 'Band', album: '', duration: 180, videoId: '' });
  assert.equal(result.source, 'KuGou');
  assert.equal(result.sync, 'word');
});

test('NetEase line lyrics fill in when others miss, matched by duration', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    const address = new URL(url);
    if (address.hostname === 'music.163.com' && address.pathname === '/api/search/get') return json({ result: { songs: [{ id: 5, name: 'Night Drive', artists: [{ name: 'Band' }], duration: 400000 }, { id: 6, name: 'Night Drive', artists: [{ name: 'Band' }], duration: 180500 }] } });
    if (address.hostname === 'music.163.com' && address.pathname === '/api/song/lyric') { assert.equal(address.searchParams.get('id'), '6'); return json({ lrc: { lyric: '[00:01.00]Under the lights\n[00:04.00]Again' } }); }
    return new Response('{}', { status: 404 });
  });
  const result = await fetchLyrics({ title: 'Night Drive', artist: 'Band', album: '', duration: 180, videoId: '' });
  assert.equal(result.source, 'NetEase');
  assert.equal(result.sync, 'line');
});
