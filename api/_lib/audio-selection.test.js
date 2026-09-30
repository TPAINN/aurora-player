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

test('neutral catalogue descriptors do not block a match', async () => {
  const { coreTitle } = await import('../video/search.js');
  assert.equal(coreTitle('Strings Of My Guitar (Original Mix)'), 'Strings Of My Guitar');
  assert.equal(coreTitle('Turned To Stone (feat. Kali Mija)'), 'Turned To Stone');
  assert.equal(coreTitle('Blue - Radio Edit'), 'Blue');
  assert.equal(coreTitle('Heroes (2017 Remaster)'), 'Heroes');
  assert.equal(coreTitle('Levels - Avicii By Avicii'), 'Levels - Avicii By Avicii', 'unknown suffixes stay');
  assert.equal(coreTitle('Titanium (David Guetta Remix)'), 'Titanium (David Guetta Remix)', 'a named remix is a different recording');
  assert.equal(coreTitle('Blue (Extended Mix)'), 'Blue (Extended Mix)', 'an extended mix is a different recording');
  assert.equal(coreTitle('Blue - Club Mix'), 'Blue - Club Mix', 'so is a club mix');
  const score = (title, track, seconds = 369) => scoreVideoCandidate(title, 'Chronical Deep - Topic', seconds, 369, 'Chronical Deep', track);
  assert.ok(score('Strings Of My Guitar', 'Strings Of My Guitar (Original Mix)') > 0, 'upload without "(Original Mix)"');
  assert.ok(scoreVideoCandidate('Turned To Stone', 'Samantha Loveridge - Topic', 250, 250, 'Samantha Loveridge', 'Turned To Stone (feat. Kali Mija)') > 0, 'upload without the featured artist');
});

test('the search tries the plain title too', async () => {
  const { videoQueriesFor } = await import('../video/search.js');
  const queries = videoQueriesFor('Chronical Deep', 'Strings Of My Guitar (Original Mix)');
  assert.ok(queries.some(query => query === 'Chronical Deep Strings Of My Guitar topic'));
  assert.ok(queries.includes('Chronical Deep Strings Of My Guitar (Original Mix) topic'), 'the full title is still tried first');
});

test('a relaxed pass accepts a close upload when nothing passes the strict rules', async () => {
  const { pickCandidate } = await import('../video/search.js');
  const candidates = [
    { videoId: 'AAAAAAAAAAA', title: 'Chronical Deep - Strings Of My Guitar', channel: 'House Uploads', duration: 395 },
    { videoId: 'BBBBBBBBBBB', title: 'Some other song', channel: 'X', duration: 369 },
  ];
  assert.equal(pickCandidate(candidates, { artist: 'Chronical Deep', title: 'Strings Of My Guitar (Original Mix)', duration: 369 }, { relaxed: false }), null);
  assert.equal(pickCandidate(candidates, { artist: 'Chronical Deep', title: 'Strings Of My Guitar (Original Mix)', duration: 369 }, { relaxed: true })?.videoId, 'AAAAAAAAAAA');
});

test('an extended or club mix never stands in for the ordinary song', async () => {
  const { pickCandidate } = await import('../video/search.js');
  const score = title => scoreVideoCandidate(title, 'Band - Topic', 240, 240, 'Band', 'Blue');
  assert.ok(score('Blue (Extended Mix)') < score('Blue'), 'the plain upload wins');
  const extended = [{ videoId: 'AAAAAAAAAAA', title: 'Band - Blue (Extended Mix)', channel: 'Band Uploads', duration: 262 }];
  assert.equal(pickCandidate(extended, { artist: 'Band', title: 'Blue', duration: 240 }, { relaxed: true }), null);
  assert.equal(pickCandidate(extended, { artist: 'Band', title: 'Blue (Extended Mix)', duration: 262 }, { relaxed: true })?.videoId, 'AAAAAAAAAAA', 'unless it was asked for');
});

test('instrumental and a cappella uploads never stand in for the original song', () => {
  const score = (title, requested = 'Blinding Lights', variant = '') => scoreVideoCandidate(title, 'Some Channel', 200, 200, 'The Weeknd', requested, variant);
  for (const title of ['The Weeknd - Blinding Lights (Instrumental)', 'Blinding Lights instrumental version', 'Blinding Lights - No Vocals', 'Blinding Lights (Backing Track)', 'Blinding Lights without vocals', 'The Weeknd - Blinding Lights (Acapella)', 'Blinding Lights a cappella', 'Blinding Lights (Vocals Only)'])
    assert.equal(score(title), -99999, title);
  assert.ok(score('The Weeknd - Blinding Lights (Instrumental)', 'Blinding Lights (Instrumental)') > 0, 'the catalogue title itself is the instrumental');
  assert.ok(score('The Weeknd - Blinding Lights (Instrumental)', 'Blinding Lights', 'instrumental') > score('The Weeknd - Blinding Lights (Official Audio)', 'Blinding Lights', 'instrumental'), 'a search for the instrumental prefers it');
});

test('asking for the instrumental is understood from search words', async () => {
  const { requestedVariant } = await import('../video/search.js');
  assert.equal(requestedVariant('blinding lights instrumental'), 'instrumental');
  assert.equal(requestedVariant('blinding lights karaoke'), 'instrumental');
  assert.equal(requestedVariant('blinding lights acapella'), 'acapella');
});
