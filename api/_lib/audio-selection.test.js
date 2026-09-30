import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreVideoCandidate } from '../video/search.js';

test('album audio outranks music video when song and duration match', () => {
  const score = (title, channel, seconds = 200) => scoreVideoCandidate(title, channel, seconds, 200, 'The Weeknd', 'Blinding Lights');
  assert.ok(score('Blinding Lights', 'The Weeknd - Topic') > score('The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO'));
  assert.ok(score('The Weeknd - Blinding Lights (Official Audio)', 'The Weeknd') > score('The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO'));
  assert.equal(score('The Weeknd - Blinding Lights', 'The Weeknd', 240), -99999);
});
