import test from 'node:test';
import assert from 'node:assert/strict';
import { peakMoments, isPeakAt, lineSpan, splitBackingVocals } from './lyrics.js';

const pool = 'river stone paper window morning coffee letter station garden winter summer shadow mirror candle ocean silver thunder meadow velvet harbor lantern compass feather canyon'.split(' ');
const verse = n => Array.from({ length: 4 }, (_, i) => `${pool[(n * 7 + i * 3) % pool.length]} ${pool[(n * 5 + i * 7 + 1) % pool.length]} walking ${pool[(n * 11 + i * 5 + 2) % pool.length]} ${n}${i}`);
const chorus = ['we are the fire in the night sky', 'nothing can hold us down tonight', 'burning brighter than the stars above', 'we are the fire forever more'];
const song = [...verse(1), ...chorus, ...verse(2), ...chorus, ...verse(3), ...chorus]
  .map((text, index) => ({ time: 10 + index * 4, text }));

test('the refrain is a peak, verses are not', () => {
  const peaks = peakMoments(song);
  assert.ok(peaks.length >= 2, JSON.stringify(peaks));
  assert.equal(isPeakAt(peaks, song[13].time + 1), true, 'second chorus');
  assert.equal(isPeakAt(peaks, song[17].time + 1), false, 'third verse');
  assert.equal(isPeakAt(peaks, 5), false, 'intro');
});

test('a long held word marks a peak even outside the refrain', () => {
  const lines = [
    { time: 10, text: 'short line', words: [{ text: 'short ', start: 10, end: 10.4 }, { text: 'line', start: 10.4, end: 10.8 }] },
    { time: 20, text: 'and I scream', words: [{ text: 'and ', start: 20, end: 20.3 }, { text: 'I ', start: 20.3, end: 20.5 }, { text: 'scream', start: 20.5, end: 23.5 }] },
  ];
  const peaks = peakMoments(lines);
  assert.equal(isPeakAt(peaks, 22), true);
  assert.equal(isPeakAt(peaks, 12), false);
});

test('untimed and missing lyrics never invent peaks', () => {
  assert.deepEqual(peakMoments([]), []);
  assert.deepEqual(peakMoments(null), []);
  assert.deepEqual(peakMoments(song.map(({ text }) => ({ text }))), []);
});

test('a line stays live until its last word, even after the next line starts', () => {
  const line = { time: 10, words: [{ start: 10, end: 11 }, { start: 13.2, end: 14.6 }] };
  assert.deepEqual(lineSpan(line), { start: 10, end: 14.6 });
  assert.deepEqual(lineSpan({ time: 5, end: 8 }), { start: 5, end: 8 });
});

test('parenthesised backing vocals are marked word by word', () => {
  const words = ['Usually, ', 'I ', 'like ', 'to ', 'love ', '(I ', 'like ', 'to ', 'love)'];
  assert.deepEqual(splitBackingVocals(words), [false, false, false, false, false, true, true, true, true]);
  assert.deepEqual(splitBackingVocals(['(Oh) ', 'yeah']), [true, false]);
  assert.deepEqual(splitBackingVocals(['no ', 'brackets']), [false, false]);
});

test('the best part is the longest peak, the earliest one on ties', async () => {
  const { bestPart } = await import('./lyrics.js');
  assert.equal(bestPart([]), null);
  assert.deepEqual(bestPart([{ start: 30, end: 42 }, { start: 90, end: 110 }, { start: 150, end: 166 }]), { start: 90, end: 110 });
  assert.deepEqual(bestPart([{ start: 30, end: 40 }, { start: 90, end: 100 }]), { start: 30, end: 40 });
});

// Word-timed version of the same song: every line's first word starts 0.4 s after
// the line, and the last word ends 3.1 s after it.
const timedSong = song.map(line => ({ ...line, words: line.text.split(' ').map((text, i, all) => ({ text: `${text} `, start: line.time + 0.4 + i * (2.7 / all.length), end: line.time + 0.4 + (i + 1) * (2.7 / all.length) })) }));

test('refrain peaks start on the first sung word and end on the last one', () => {
  const peaks = peakMoments(timedSong);
  const second = peaks.find(range => range.start > timedSong[11].time && range.start < timedSong[13].time);
  assert.ok(second, JSON.stringify(peaks));
  assert.ok(Math.abs(second.start - (timedSong[12].time + 0.4)) < 1e-6, `start ${second.start}`);
  assert.ok(Math.abs(second.end - (timedSong[15].time + 3.1)) < 1e-6, `end ${second.end}`);
});

test('a held note is a peak exactly while it is held', () => {
  const lines = [{ time: 20, text: 'and I scream', words: [{ text: 'and ', start: 20, end: 20.3 }, { text: 'I ', start: 20.3, end: 20.5 }, { text: 'scream', start: 20.5, end: 23.5 }] }];
  const [peak] = peakMoments(lines);
  assert.ok(Math.abs(peak.start - 20.5) < 1e-6 && Math.abs(peak.end - 23.8) < 1e-6, JSON.stringify(peak));
});

test('the refrain never swallows the verse line after it', () => {
  const peaks = peakMoments(timedSong);
  assert.equal(isPeakAt(peaks, timedSong[16].time + 1), false);
  assert.equal(isPeakAt(peaks, timedSong[8].time + 1), false);
});
