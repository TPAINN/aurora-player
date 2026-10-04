import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptionWords, alignToCaptions } from './caption-align.js';

const lyricText = [
  'Under the city lights we run',
  'Every signal turning green',
  'Hold the wheel and hold my hand',
  'We never needed any map',
  'Night drive night drive',
  'Till the morning finds us here',
  'Under the city lights we run',
  'Every signal turning green',
];
// Word-timed lyrics: one word every 0.4 s, lines 5 s apart from 10 s.
const wordLines = lyricText.map((text, i) => {
  const time = 10 + i * 5;
  return { time, text, words: text.split(' ').map((word, w) => ({ text: word, start: time + w * 0.4, end: time + w * 0.4 + 0.35 })) };
});
// YouTube json3 auto captions for the same song, heard 1.8 s later (a video intro).
const json3 = shift => ({ events: wordLines.map(line => ({ tStartMs: Math.round((line.time + shift) * 1000), segs: line.words.map((word, w) => ({ utf8: (w ? ' ' : '') + word.text.toLowerCase(), tOffsetMs: Math.round(w * 400) })) })) });

test('caption words are read from json3 events with absolute times', () => {
  const words = parseCaptionWords({ events: [{ tStartMs: 1000, segs: [{ utf8: 'Hello' }, { utf8: ' world', tOffsetMs: 500 }] }, { tStartMs: 3000 }, { segs: [{ utf8: 'x' }] }] });
  assert.deepEqual(words, [{ text: 'hello', start: 1 }, { text: 'world', start: 1.5 }]);
  assert.deepEqual(parseCaptionWords(null), []);
});

test('lyrics heard 1.8 s later than timed get a -1.8 s offset', () => {
  const result = alignToCaptions(wordLines, parseCaptionWords(json3(1.8)));
  assert.ok(result && Math.abs(result.offset - -1.8) < 0.06, JSON.stringify(result));
  assert.ok(result.matches >= 6);
});

test('lyrics heard early get a positive offset, from line-timed lyrics too', () => {
  const lineOnly = wordLines.map(({ time, text }) => ({ time, text }));
  const result = alignToCaptions(lineOnly, parseCaptionWords(json3(-0.5)));
  assert.ok(result && Math.abs(result.offset - 0.5) < 0.06, JSON.stringify(result));
});

test('captions that already agree need no offset', () => {
  const result = alignToCaptions(wordLines, parseCaptionWords(json3(0)));
  assert.ok(result && Math.abs(result.offset) < 0.06, JSON.stringify(result));
});

test('no consistent agreement, no offset: music-only captions, another song, scattered matches', () => {
  assert.equal(alignToCaptions(wordLines, parseCaptionWords({ events: [{ tStartMs: 0, segs: [{ utf8: '[Music]' }] }] })), null);
  const other = { events: [{ tStartMs: 5000, segs: 'completely different words that never appear in the song at all here'.split(' ').map((utf8, i) => ({ utf8: ` ${utf8}`, tOffsetMs: i * 300 })) }] };
  assert.equal(alignToCaptions(wordLines, parseCaptionWords(other)), null);
  // Each line heard at a random shift: no single offset explains them.
  const scattered = { events: wordLines.map((line, i) => ({ tStartMs: Math.round((line.time + [3, -4, 7, -2, 5, -6, 1, 9][i]) * 1000), segs: line.words.map((word, w) => ({ utf8: ` ${word.text}`, tOffsetMs: w * 400 })) })) };
  assert.equal(alignToCaptions(wordLines, parseCaptionWords(scattered)), null);
});

test('an implausible shift is never applied', () => {
  assert.equal(alignToCaptions(wordLines, parseCaptionWords(json3(25))), null);
});

test('lyrics carry the alignment when captions agree, and never wait long for slow captions', async () => {
  const { withAlignment } = await import('./caption-align.js');
  const lyrics = { source: 'Test', sync: 'word', lines: wordLines };
  const aligned = await withAlignment(Promise.resolve(lyrics), Promise.resolve(json3(1.8)));
  assert.ok(Math.abs(aligned.alignment.offset - -1.8) < 0.06);
  const started = Date.now();
  const slow = await withAlignment(Promise.resolve(lyrics), new Promise(resolve => setTimeout(() => resolve(json3(1.8)), 5000)), { wait: 100 });
  assert.equal(slow.alignment, undefined);
  assert.ok(Date.now() - started < 1000);
  const plain = { source: 'Test', sync: 'plain', lines: [] };
  assert.equal(await withAlignment(Promise.resolve(plain), Promise.resolve(json3(1.8))), plain);
  assert.equal(await withAlignment(Promise.resolve(lyrics), Promise.reject(new Error('down'))), lyrics);
});
