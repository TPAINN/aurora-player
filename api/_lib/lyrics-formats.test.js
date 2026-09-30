import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTtml, parseLrc, parsePlus, parseTrack, seconds } from './lyrics-formats.js';
import { allowedLyricsUrl, fetchLyrics } from './lyrics-providers.js';
import handler from '../lyrics/structured.js';

test('enhanced LRC rejects multiplicative timestamp expansion before cloning', () => {
  const expanded = '[00:01]'.repeat(500) + '<00:01>word '.repeat(500);
  assert.equal(parseLrc(expanded, 'test', 10), null);
  assert.equal(parseLrc('[00:01]'.repeat(2001) + 'line', 'test', 10), null);
});

test('TTML preserves real timing, entities and inter-word whitespace', () => {
  const result = parseTtml('<tt><body><p begin="1.1" end="3"><span begin="1.1" end="1.5">You</span> <span begin="1.8" end="3">&amp; me</span></p></body></tt>','test');
  assert.equal(result.sync,'word');
  assert.equal(result.lines[0].text,'You & me');
  assert.deepEqual(result.lines[0].words,[{start:1.1,end:1.5,text:'You '},{start:1.8,end:3,text:'& me'}]);
});
test('TTML rejects declarations and excessive content', () => {
  assert.equal(parseTtml('<!DOCTYPE tt><tt/>','test'),null);
  assert.equal(parseTtml('x'.repeat(400001),'test'),null);
});
test('line-only lyrics never invent words; multiple timestamps and plain fallback work', () => {
  const result = parseLrc('[00:01.50][00:05.50]Example\n[00:08.00]Next','test',10);
  assert.equal(result.sync,'line');
  assert.equal(result.lines.length,3);
  assert.equal(result.lines[0].words,undefined);
  assert.equal(result.lines[2].end,10);
  assert.equal(parseTrack({plainLyrics:'Example'},'test').sync,'plain');
});
test('LyricsPlus converts milliseconds without fabricating timing', () => {
  const result = parsePlus({lyrics:[{time:1000,duration:1000,text:'word',syllabus:[{text:'word',time:1000,duration:500}]}]},'test');
  assert.equal(result.lines[0].words[0].end,1.5);
  assert.equal(seconds('1:02.5'),62.5);
});

test('enhanced LRC retains the final word without a trailing timestamp', () => {
  const result = parseLrc('[00:01.00]<00:01.00>Hello <00:02.00>world\n[00:04.00]Next line','test',6);
  assert.deepEqual(result.lines[0].words,[{text:'Hello ',start:1,end:2},{text:'world',start:2,end:4}]);
  assert.equal(result.lines[0].end,4);
  const final = parseLrc('[00:01.00]<00:01.00>Only','test',3);
  assert.deepEqual(final.lines[0].words,[{text:'Only',start:1,end:3}]);
});

test('enhanced LRC respects an explicit trailing word end', () => {
  const result = parseLrc('[00:01.00]<00:01.00>Hello <00:02.00>world<00:03.00>\n[00:04.00]Next','test',6);
  assert.equal(result.lines[0].words.at(-1).end,3);
  assert.equal(result.lines[0].end,3);
});
test('SSRF boundaries reject alternate hosts, credentials, protocols and ports', () => {
  for (const url of ['http://lyrics-storage.binimum.org/a','https://localhost/a','https://lyrics-storage.binimum.org.evil.test/a','https://user@lyrics-storage.binimum.org/a','https://lyrics-storage.binimum.org:444/a']) assert.equal(allowedLyricsUrl(url),false);
  assert.equal(allowedLyricsUrl('https://lyrics-storage.binimum.org/song.ttml'),true);
});
test('handler rejects unsupported methods and invalid query without requests', async () => {
  const res = { setHeader() {}, status(code) { this.code=code; return this; }, json(value) { this.value=value; return this; } };
  await handler({method:'POST'},res);
  assert.equal(res.code,405);
  await handler({method:'GET',query:{artist:'Example',title:'Example',duration:['1','2']}},res);
  assert.equal(res.code,400);
});
test('provider failures fall back to real LRCLib line timing', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).startsWith('https://lrclib.net/')) return new Response(JSON.stringify({syncedLyrics:'[00:01.00]A line'}));
    return new Response('unavailable',{status:503});
  };
  try {
    const result = await fetchLyrics({artist:'A',title:'B',duration:10,album:'',videoId:''});
    assert.equal(result.source,'LRCLib');
    assert.equal(result.sync,'line');
  } finally { globalThis.fetch = original; }
});
