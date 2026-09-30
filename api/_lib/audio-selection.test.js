import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreVideoCandidate } from '../video/search.js';

test('album audio outranks music video when song and duration match', () => {
  const score = (title, channel, seconds = 200) => scoreVideoCandidate(title, channel, seconds, 200, 'The Weeknd', 'Blinding Lights');
  assert.ok(score('Blinding Lights', 'The Weeknd - Topic') > score('The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO'));
  assert.ok(score('The Weeknd - Blinding Lights (Official Audio)', 'The Weeknd') > score('The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO'));
  assert.equal(score('The Weeknd - Blinding Lights', 'The Weeknd', 240), -99999);
});

test('altered uploads (8D, slowed, sped up, nightcore, loops) are rejected unless the song asks for them', () => {
  const score = (title, requested = 'Blinding Lights', variant = '') => scoreVideoCandidate(title, 'Some Channel', 200, 200, 'The Weeknd', requested, variant);
  for (const title of ['The Weeknd - Blinding Lights (8D Audio)', 'Blinding Lights 16D', 'The Weeknd - Blinding Lights (slowed + reverb)', 'Blinding Lights sped up', 'Blinding Lights nightcore', 'Blinding Lights BASS BOOSTED', 'Blinding Lights 1 hour loop', 'Blinding Lights 3D audio'])
    assert.equal(score(title), -99999, title);
  assert.ok(score('The Weeknd - Blinding Lights (8D Audio)', 'Blinding Lights (8D Audio)') > 0, 'the catalogue title itself asks for 8D');
  assert.ok(score('The Weeknd - Blinding Lights (8D Audio)', 'Blinding Lights', '8d') > score('The Weeknd - Blinding Lights (Official Audio)', 'Blinding Lights', '8d'), 'a search for 8D prefers the 8D upload');
  assert.ok(score('The Weeknd - Blinding Lights (slowed + reverb)', 'Blinding Lights', 'slowed') > 0);
});

test('variant hints are detected from search words only', async () => {
  const { requestedVariant } = await import('../video/search.js');
  assert.equal(requestedVariant('blinding lights 8d'), '8d');
  assert.equal(requestedVariant('Blinding Lights slowed reverb'), 'slowed');
  assert.equal(requestedVariant('nightcore mix'), 'nightcore');
  assert.equal(requestedVariant('blinding lights'), '');
  assert.equal(requestedVariant('8 days a week'), '');
});
