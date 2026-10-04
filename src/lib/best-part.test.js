import test from 'node:test';
import assert from 'node:assert/strict';
import { audioHighlights, bestMoments, snapToGrid } from './best-part.js';

const near = (actual, expected, tolerance = 0.02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
// A 200 s song whose listeners replay 120–150 s; everything else is lukewarm.
const replays = Array.from({ length: 100 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, score: i >= 60 && i < 75 ? 0.9 + (i === 66 ? 0.1 : 0) : 0.25 }));
// Energy: a quiet intro, verses at -14 dB, choruses at -6 dB (60–80 s and 120–150 s).
const energyLevels = Array.from({ length: 200 }, (_, s) => (s < 12 ? 0.02 : (s >= 60 && s < 80) || (s >= 120 && s < 150) ? 0.5 : 0.2));
const energy = { hop: 1, levels: energyLevels };

test('listener replays find the section people come back for', () => {
  const [top] = audioHighlights({ replays, duration: 200 });
  assert.ok(top.start >= 118 && top.start <= 122 && top.end >= 148 && top.end <= 152, JSON.stringify(top));
});

test('measured energy finds the loud choruses and skips the quiet intro', () => {
  const found = audioHighlights({ energy, duration: 200 });
  assert.equal(found.length, 2, JSON.stringify(found));
  assert.ok(found.every(range => range.start >= 58 && range.end <= 152));
});

test('no audio evidence, no audio highlights', () => {
  assert.deepEqual(audioHighlights({ duration: 200 }), []);
  assert.deepEqual(audioHighlights({ replays: [], energy: { hop: 1, levels: [] }, duration: 200 }), []);
  // A flat song has no section that stands out.
  assert.deepEqual(audioHighlights({ energy: { hop: 1, levels: Array(200).fill(0.3) }, duration: 200 }), []);
});

test('the best part is the replayed refrain, starting on its first sung word', () => {
  const lyricPeaks = [{ start: 61.3, end: 79.2 }, { start: 121.4, end: 149.6 }, { start: 30.2, end: 58.9 }];
  const { best, peaks } = bestMoments({ lyricPeaks, replays, energy, duration: 200 });
  near(best.start, 121.4);
  assert.ok(best.end >= 149 && best.end <= 151.5, JSON.stringify(best));
  // The long refrain in the quiet verse section is not a peak once audio disagrees.
  assert.ok(!peaks.some(range => range.start < 59), JSON.stringify(peaks));
});

test('an instrumental drop people replay is a best part even without lyrics there', () => {
  const lyricPeaks = [{ start: 30.2, end: 40 }];
  const { best } = bestMoments({ lyricPeaks: [], replays, duration: 200 });
  assert.ok(best && best.start >= 118 && best.start <= 122);
  const withLyrics = bestMoments({ lyricPeaks, replays, duration: 200 });
  assert.ok(withLyrics.best.start >= 118, JSON.stringify(withLyrics.best));
});

test('without audio evidence the longest timed refrain stays the best part', () => {
  const lyricPeaks = [{ start: 20, end: 30 }, { start: 50, end: 72 }];
  const { best, peaks } = bestMoments({ lyricPeaks, duration: 200 });
  assert.deepEqual(best, { start: 50, end: 72 });
  assert.equal(peaks.length, 2);
});

test('with a measured beat grid peaks start on the nearest beat and last whole bars', () => {
  const grid = { origin: 0.25, period: 0.5 }; // 120 BPM, beats at .25, .75, …
  const snapped = snapToGrid({ start: 121.4, end: 149.6 }, grid);
  near(snapped.start, 121.25);
  near((snapped.end - snapped.start) / 2 % 1, 0); // 2 s bars
  // Never cut the last sung word: release on the first bar line after it.
  assert.ok(snapped.end >= 149.6 && snapped.end < 149.6 + 2, JSON.stringify(snapped));
});

test('a held note shorter than a bar still lasts until its bar line, never shorter', () => {
  const snapped = snapToGrid({ start: 26.2, end: 28.5 }, { period: 0.5 });
  near(snapped.end, 30.2);
  // Within a hair of a bar line, the line itself is the end.
  near(snapToGrid({ start: 40, end: 52.1 }, { period: 0.5 }).end, 52);
});

test('with tempo but no phase only the length is counted in bars from the real start', () => {
  const snapped = snapToGrid({ start: 121.4, end: 149.6 }, { period: 0.5 });
  near(snapped.start, 121.4);
  near((snapped.end - snapped.start) % 2, 0);
});

test('an unknown or implausible grid leaves ranges untouched', () => {
  for (const grid of [null, {}, { period: 0 }, { period: NaN }, { period: 3 }]) assert.deepEqual(snapToGrid({ start: 10, end: 20 }, grid), { start: 10, end: 20 });
});
