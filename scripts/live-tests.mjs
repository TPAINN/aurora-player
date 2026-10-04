// Live interaction suite: stubs the catalogue, lyrics and tempo APIs and a simulated
// YouTube player, then drives the real app. Usage (with the dev or preview server running):
//   npm i --no-save playwright-core && node scripts/live-tests.mjs [A|B|C|D|E]
// BASE=http://localhost:5188/ targets `npm run preview`; CHROMIUM_PATH selects a browser.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE || 'http://localhost:5187/';
const only = process.argv[2];
const results = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function ok(value, message) { if (!value) throw new Error(message || 'assertion failed'); }

// ── Fixtures ────────────────────────────────────────────────────────────────
const catalogue = [
  { trackId: 1, trackName: 'Night Drive', artistName: 'Band', collectionName: 'Roads', artworkUrl100: 'https://img.test/a/100x100bb.jpg', trackTimeMillis: 60000, primaryGenreName: 'Pop' },
  { trackId: 2, trackName: 'Morning Light', artistName: 'Band', collectionName: 'Roads', artworkUrl100: 'https://img.test/b/100x100bb.jpg', trackTimeMillis: 60000, primaryGenreName: 'Pop' },
  { trackId: 3, trackName: 'Night Drive', artistName: 'Band', collectionName: 'Roads (Deluxe)', artworkUrl100: 'https://img.test/a/100x100bb.jpg', trackTimeMillis: 60000 },
  { trackId: 4, trackName: 'Slow Tide', artistName: 'Other', collectionName: 'Sea', artworkUrl100: 'https://img.test/c/100x100bb.jpg', trackTimeMillis: 60000 },
  { trackId: 5, trackName: 'Φωτιά μου', artistName: 'Ελένη', collectionName: 'Ελλάδα', artworkUrl100: 'https://img.test/d/100x100bb.jpg', trackTimeMillis: 60000 },
];
const words = (text, start, span) => text.split(' ').map((word, i, all) => ({ text: `${word} `, start: start + i * span / all.length, end: start + (i + 1) * span / all.length }));
const wordLyrics = {
  source: 'Stub', sync: 'word',
  lines: [['Under the city lights we run', 2], ['Every signal turning green', 6], ['Hold the wheel and hold my hand', 10], ['We never needed any map', 14], ['Night drive, night drive', 26], ['Till the morning finds us here', 30]]
    .map(([text, time]) => ({ time, end: time + 3.4, text, words: words(text, time, 3.4) })),
};
// Backing vocals run past the next line's start (14 s), and one word is held.
wordLyrics.lines[2].words.push({ text: '(my ', start: 14.3, end: 14.9 }, { text: 'hand)', start: 14.9, end: 15.5 });
wordLyrics.lines[2].text += ' (my hand)';
wordLyrics.lines[4].words = [{ text: 'Night ', start: 26, end: 26.5 }, { text: 'drive, ', start: 26.5, end: 28.4 }, { text: 'night ', start: 28.4, end: 28.9 }, { text: 'drive', start: 28.9, end: 29.4 }];
const lineLyrics = { source: 'Stub', sync: 'line', lines: [['Sunrise on the water', 1], ['Waking up the town', 5], ['Morning light', 9]].map(([text, time], i, all) => ({ time, end: all[i + 1]?.[1] ?? time + 4, text })) };

function fakeYouTube() {
  window.__events = []; window.__vols = []; window.__longtasks = [];
  try { new PerformanceObserver(list => list.getEntries().forEach(entry => window.__longtasks.push(Math.round(entry.duration)))).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
  // '1': the embed lists and plays fine rates; '2': plays them but lists only coarse ones;
  // '3': plays only whole 0.05 steps.
  const fine = localStorage.getItem('fine-rates');
  const coarse = [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2];
  window.__sweeps = 0;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) { window.__sweeps++; return start.apply(this, args); };
  const log = (...row) => window.__events.push([Math.round(performance.now()), ...row]);
  class Player {
    constructor(mount, options) {
      this.o = options; this.state = -1; this.t = 0; this.rate = 1; this.vol = 100; this.vid = options.videoId || null; this.dur = 60; this.muted = false;
      const frame = document.createElement('iframe'); frame.title = 'stub'; mount.replaceWith(frame);
      log('create', this.vid);
      setTimeout(() => options.events.onReady({ target: this }), 40);
      // A media clock follows real time (like a real player's), but is reported only
      // in coarse 50 ms updates, as YouTube's embed reports its own.
      this.base = 0; this.since = performance.now();
      this.clock = setInterval(() => { if (this.state === 1) { this.t = this.exactTime(); if (this.t >= this.dur) { this.t = this.dur; this.rebase(); this.set(0); } } }, 50);
      (window.__ytPlayers = window.__ytPlayers || []).push(this);
    }
    rebase() { this.base = this.t; this.since = performance.now(); }
    set(state) { if (this.state === 1) this.t = Math.min(this.dur, this.exactTime()); this.rebase(); this.state = state; this.o.events.onStateChange?.({ target: this, data: state }); }
    loadVideoById(id, start = 0) { if (JSON.parse(localStorage.getItem('refused') || '[]').includes(id)) { this.vid = id; log('refused', id); setTimeout(() => this.o.events.onError?.({ target: this, data: 150 }), 120); return; } this.vid = id; this.t = start; this.rebase(); this.dur = Number(JSON.parse(localStorage.getItem('durations') || '{}')[id] || 60); log('load', id, this.muted, start); this.set(3); setTimeout(() => this.set(1), 250); }
    playVideo() { log('play', this.vid, this.muted); setTimeout(() => this.set(1), 150); }
    pauseVideo() { log('pause', this.vid); this.set(2); }
    stopVideo() { log('stop', this.vid); this.set(5); } seekTo(t) { log('seek', this.vid, Math.round(t * 10) / 10); this.t = t; this.rebase(); }
    // Ground truth for timing checks: the stepped clock plus the time since its step.
    exactTime() { return this.state === 1 ? this.base + (performance.now() - this.since) / 1000 * this.rate : this.t; }
    getCurrentTime() { return this.t; } getDuration() { return this.dur; } getPlayerState() { return this.state; }
    setVolume(v) { this.vol = v; window.__vols.push([Math.round(performance.now()), this.vid, Math.round(v)]); } mute() { this.muted = true; } unMute() { this.muted = false; }
    setPlaybackRate(r) { if (this.state === 1) this.t = this.exactTime(); this.rebase(); const applied = fine === '3' ? Math.round(r / .05) * .05 : fine ? r : coarse.reduce((best, rate) => Math.abs(rate - r) < Math.abs(best - r) ? rate : best, 1); this.rate = applied; log('rate', this.vid, applied); } getPlaybackRate() { return this.rate; }
    getAvailablePlaybackRates() { return fine === '1' ? Array.from({ length: 41 }, (_, i) => Math.round((.8 + i * .01) * 100) / 100) : coarse; }
    getVideoData() { return { video_id: this.vid }; } destroy() { clearInterval(this.clock); }
  }
  window.YT = { Player };
}

const videos = [
  { videoId: 'VVVVVVVVVV1', title: 'Night Drive (slowed + reverb)', artist: 'Band', channel: 'edits', duration: 214, artwork: 'https://img.test/b/v1.jpg', views: '1.2M views' },
  { videoId: 'VVVVVVVVVV2', title: 'Night Drive x Morning Light (mashup)', artist: 'mashups', channel: 'mashups', duration: 190, artwork: 'https://img.test/c/v2.jpg', views: '40K views' },
];
const categories = term => ({
  results: /ελ|φω/i.test(term) ? catalogue.slice(4) : catalogue.slice(0, 4),
  videos,
  albums: [{ id: 9, title: 'Roads', artist: 'Band', artwork: 'https://img.test/a/600x600bb.jpg', count: 3, year: '2024' }],
  artists: [{ id: 7, name: 'Band Of Night', artwork: 'https://img.test/d/artist.jpg', fans: 120000 }],
  playlists: [{ id: 'PLroads', title: 'Road trip', owner: 'Aurora fan', count: 2, artwork: 'https://img.test/c/pl.jpg' }],
  top: /^band of night$/i.test(term.trim()) ? { kind: 'artist', id: 7 } : /slowed|mashup/i.test(term) ? { kind: 'video', id: 'VVVVVVVVVV1' } : { kind: 'song', id: 1 },
});
async function newSession(browser, { viewport = { width: 1440, height: 900 }, prefs = {}, reducedMotion = 'no-preference', searchDelay = 120, failSearch = () => false, recommendations = [], welcome = false, longIntro = false, incomingBpm = 124, unplayable = [], replays = null, tempoLog = null, alignment = null, editGap = 0, lyricLog = null } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, hasTouch: viewport.width < 700 });
  await context.addInitScript(values => {
    if (!sessionStorage.getItem('seeded')) { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); }
    if (!values.__welcome) sessionStorage.setItem('aurora:welcome-seen', '1');
  }, { 'aurora-autoplay': 'false', ...prefs, __welcome: welcome ? '1' : '' });
  await context.addInitScript(fakeYouTube);
  const page = await context.newPage();
  const errors = []; const requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error' && !/ERR_|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await page.route('https://img.test/**', route => {
    const color = { a: '#b0413e', b: '#2f6f8f', c: '#6a8f2f', d: '#8f6a2f' }[new URL(route.request().url()).pathname.split('/')[1]] || '#555';
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${color}"/></svg>` });
  });
  let searchCount = 0;
  await page.route('**/api/search?*', async route => {
    searchCount++;
    const term = new URL(route.request().url()).searchParams.get('term');
    await wait(typeof searchDelay === 'function' ? searchDelay(term) : searchDelay);
    if (failSearch(term, searchCount)) return route.fulfill({ status: 502, json: { error: 'down' } }).catch(() => {});
    const type = new URL(route.request().url()).searchParams.get('type') || 'songs';
    const all = categories(term);
    const body = type === 'all' ? all : type === 'songs' ? { results: all.results } : { [type]: all[type] };
    return route.fulfill({ json: body }).catch(() => {});
  });
  await page.route('**/api/collection?*', route => {
    const type = new URL(route.request().url()).searchParams.get('type');
    const tracks = type === 'playlist' ? videos.map(v => ({ id: `yt:${v.videoId}`, videoId: v.videoId, title: v.title, artist: v.artist, artwork: v.artwork, duration: v.duration, source: 'video' }))
      : catalogue.slice(0, 3).map(item => ({ id: String(item.trackId), title: item.trackName, artist: item.artistName, album: item.collectionName, artwork: item.artworkUrl100.replace('100x100bb', '600x600bb'), duration: 60 }));
    return route.fulfill({ json: { title: type === 'artist' ? 'Band Of Night' : type === 'album' ? 'Roads' : '', subtitle: 'Stub', artwork: 'https://img.test/a/600x600bb.jpg', tracks } });
  });
  await page.route('**/api/video/search?*', route => {
    const title = new URL(route.request().url()).searchParams.get('title');
    if (unplayable.includes(title)) return route.fulfill({ json: { videoId: null, candidates: [] } });
    const videoId = { 'Night Drive': 'AAAAAAAAAAA', 'Morning Light': 'BBBBBBBBBBB', 'Slow Tide': 'CCCCCCCCCCC' }[title] || 'DDDDDDDDDDD';
    return route.fulfill({ json: { videoId, channel: title === 'Night Drive' ? 'Band - Topic' : 'Band Uploads', title, ...(editGap && title === 'Morning Light' ? { duration: 60 + editGap } : {}), candidates: [{ videoId }, { videoId: 'EEEEEEEEEEE' }] } });
  });
  await page.route('**/api/lyrics/structured?*', async route => {
    const params = new URL(route.request().url()).searchParams, title = params.get('title');
    lyricLog?.push(`${title}@${params.get('duration')}`);
    await wait(title === 'Slow Tide' ? 900 : 150);
    // The upload is another edit with no lyrics timed for its length.
    if (editGap && title === 'Morning Light' && Number(params.get('duration')) === 60 + editGap) return route.fulfill({ json: { source: null, sync: 'plain', lines: [] } }).catch(() => {});
    const incoming = longIntro ? { ...lineLyrics, lines: lineLyrics.lines.map(line => ({ ...line, time: line.time + 37, end: line.end + 37 })) } : lineLyrics;
    return route.fulfill({ json: title === 'Night Drive' ? (alignment === null ? wordLyrics : { ...wordLyrics, alignment: { offset: alignment, matches: 12, lines: 5 } }) : title === 'Morning Light' ? incoming : { source: null, sync: 'plain', lines: [] } }).catch(() => {});
  });
  await page.route('**/api/tempo?*', route => {
    const url = new URL(route.request().url());
    tempoLog?.push(url.search);
    const bpm = url.searchParams.get('title') === 'Night Drive' ? 120 : incomingBpm;
    const list = replays && url.searchParams.get('video') ? replays(url.searchParams.get('title')) : null;
    return route.fulfill({ json: list ? { bpm, replays: list } : { bpm } });
  });
  await page.route('**/api/recommendations?*', route => route.fulfill({ json: { tracks: recommendations } }));
  await page.route('**/api/mood?*', route => { const mood = new URL(route.request().url()).searchParams.get('mood'); return route.fulfill({ json: { tracks: Array.from({ length: 16 }, (_, i) => ({ id: `mood:${mood}:${i}`, title: `${mood} song ${i + 1}`, artist: `Mood artist ${i % 8}`, album: 'LP', artwork: 'https://img.test/c/m.jpg', duration: 60, mood })) } }); });
  await page.route('https://www.youtube.com/**', route => route.abort());
  return { context, page, errors, requests };
}

async function check(group, name, fn) {
  if (only && group !== only) return;
  const started = Date.now();
  try { await fn(); results.push({ group, name, ok: true, ms: Date.now() - started }); }
  catch (error) { results.push({ group, name, ok: false, ms: Date.now() - started, error: String(error.message || error).slice(0, 220) }); }
}
const events = page => page.evaluate(() => window.__events);
const title = page => page.evaluate(() => document.title);
const searchFor = async (page, text) => { await page.fill('input[aria-label="Search songs or artists"]', text); await wait(700); };
const goPage = (page, desktop, mobile) => page.locator(`nav[aria-label="Main navigation"] button[aria-label="${desktop}"] >> visible=true`).or(page.locator(`nav[aria-label="Mobile navigation"] button:has-text("${mobile}") >> visible=true`)).first().click();
const goSearch = page => page.locator('nav[aria-label="Main navigation"] button[aria-label="Search"] >> visible=true').or(page.locator('nav[aria-label="Mobile navigation"] button:has-text("Search") >> visible=true')).first().click();
const playerTime = page => page.evaluate(() => Number(document.querySelector('.dock-seek input')?.value || 0));
async function setSeek(page, seconds) {
  await page.evaluate(value => {
    const input = document.querySelector('.dock-seek input[aria-label="Seek in track"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, seconds);
}
async function startQueue(page, extra = ['Morning Light']) {
  await goSearch(page); await wait(400); await searchFor(page, 'band');
  for (const name of extra) await page.click(`.search-results .track-row:has-text("${name}") button[aria-label^="Add"]`);
  await page.click('.top-result-play'); await wait(900);
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });

// ── A. Home & navigation ───────────────────────────────────────────────────
if (!only || only === 'A') {
  const started = Date.now();
  const { context, page, errors } = await newSession(browser);
  await page.goto(BASE);
  await check('A', 'first meaningful render under 1.5 s', async () => { await page.waitForSelector('.page-heading h1', { timeout: 1500 }); ok(Date.now() - started < 4000); });
  await wait(900);
  await check('A', 'home heading present', async () => ok((await page.textContent('.page-heading h1')).includes('Find your frequency')));
  await check('A', 'carousel shows five cards', async () => ok(await page.locator('.carousel-card').count() === 5));
  const spotlight = () => page.textContent('.stage-copy h2');
  const initial = await spotlight();
  await check('A', 'next featured arrow changes spotlight', async () => { await page.click('button[aria-label="Next featured track"]'); await wait(900); ok(await spotlight() !== initial); });
  await check('A', 'previous featured arrow returns', async () => { await page.click('button[aria-label="Previous featured track"]'); await wait(900); ok(await spotlight() === initial); });
  await check('A', 'side carousel card focuses that track', async () => { await page.click('.carousel-card.offset-1'); await wait(900); ok(await spotlight() !== initial); });
  await check('A', 'mood card opens search with its query', async () => { await page.click('.mood-card >> nth=0'); await wait(900); ok((await page.inputValue('input[aria-label="Search songs or artists"]')).length > 2); });
  await check('A', 'sidebar Library shows empty state', async () => { await page.click('nav[aria-label="Main navigation"] button[aria-label="Your library"]'); await wait(900); ok((await page.textContent('.empty-state h2')).includes('Keep the ones')); });
  await check('A', 'selection pill follows navigation', async () => ok(await page.locator('nav[aria-label="Main navigation"] button[aria-label="Your library"] .nav-pill').count() === 1));
  await check('A', 'breadcrumb names the page', async () => ok((await page.textContent('.breadcrumb')).includes('Your library')));
  await check('A', 'sidebar collapses', async () => { await page.click('button[aria-label="Minimize sidebar"]'); await wait(500); ok(await page.locator('.aurora-app.sidebar-collapsed').count() === 1); });
  await check('A', 'sidebar expands', async () => { await page.click('button[aria-label="Expand sidebar"]'); await wait(500); ok(await page.locator('.aurora-app.sidebar-collapsed').count() === 0); });
  await check('A', 'Ctrl+K focuses search', async () => { await page.keyboard.press('Control+k'); await wait(700); ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search songs or artists')); });
  await check('A', '"/" opens search from home', async () => { await page.click('nav[aria-label="Main navigation"] button[aria-label="Listen now"]'); await wait(700); await page.locator('body').press('/'); await wait(700); ok((await page.textContent('.breadcrumb')).includes('Search')); });
  await check('A', 'default document title', async () => ok((await title(page)).startsWith('Aurora')));
  await check('A', 'no runtime errors on home', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

// ── B. Search ──────────────────────────────────────────────────────────────
if (!only || only === 'B') {
  const { context, page, errors, requests } = await newSession(browser, { searchDelay: term => (/slow/.test(term) ? 1400 : 150), failSearch: (() => { let flaky = 0; return term => term === 'flaky' && ++flaky === 1; })() });
  await page.goto(BASE); await wait(600); await goSearch(page); await wait(700);
  await check('B', 'single character shows ideas, not results', async () => { await searchFor(page, 'b'); ok(await page.locator('.search-results').count() === 0); ok(await page.locator('.chip').count() >= 3); });
  await check('B', 'idea chip runs a search', async () => { await page.click('.chip-group[aria-label="Search ideas"] .chip >> nth=0'); await wait(900); ok(await page.locator('.search-results .track-row').count() > 0); });
  await check('B', 'duplicate album versions removed', async () => { await searchFor(page, 'band'); ok(await page.locator('.search-results .track-row').count() === 3); });
  await check('B', 'stale results stay visible while refining', async () => { await page.fill('input[aria-label="Search songs or artists"]', 'band slow'); await wait(600); ok(await page.locator('.search-results .track-row').count() === 3); });
  await check('B', 'refining shows the progress line', async () => ok(await page.locator('.search-field.is-searching').count() === 1));
  await wait(1400);
  await check('B', 'skeleton on first slow search', async () => { await page.fill('input[aria-label="Search songs or artists"]', ''); await wait(400); await page.fill('input[aria-label="Search songs or artists"]', 'slow one'); await wait(700); ok(await page.locator('.search-skeleton').count() === 1); await wait(1500); });
  await check('B', 'Escape clears the query', async () => { await page.focus('input[aria-label="Search songs or artists"]'); await page.keyboard.press('Escape'); ok(await page.inputValue('input[aria-label="Search songs or artists"]') === ''); });
  await check('B', 'Escape on empty field blurs it', async () => { await page.keyboard.press('Escape'); ok(await page.evaluate(() => document.activeElement?.tagName !== 'INPUT')); });
  await check('B', 'ArrowDown moves into results', async () => { await searchFor(page, 'band'); await page.focus('input[aria-label="Search songs or artists"]'); await page.keyboard.press('ArrowDown'); ok(await page.evaluate(() => document.activeElement?.closest('.search-results') !== null)); });
  await check('B', 'clear button empties and refocuses', async () => { await page.click('button[aria-label="Clear search"]'); await wait(300); ok(await page.inputValue('input[aria-label="Search songs or artists"]') === '' && await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search songs or artists')); });
  await check('B', 'failed search offers a working retry', async () => { await searchFor(page, 'flaky'); await wait(500); ok(await page.locator('[role=alert]:has-text("Search")').count() === 1); await page.click('button:has-text("Try again")'); await wait(900); ok(await page.locator('.search-results .track-row').count() > 0); });
  await check('B', 'Play next is disabled before anything plays', async () => { await searchFor(page, 'band'); ok(await page.isDisabled('button:has-text("Play next")')); });
  await check('B', 'Add to queue confirms with a toast', async () => { await page.click('.search-results .track-row >> nth=1 >> button[aria-label^="Add"]'); await wait(300); ok((await page.textContent('.toast')).includes('queue')); });
  await check('B', 'Enter plays the top result', async () => { await page.focus('input[aria-label="Search songs or artists"]'); await page.keyboard.press('Enter'); await wait(1200); ok((await title(page)).startsWith('Night Drive')); });
  await check('B', 'queued song kept after playing a search result', async () => { ok((await page.textContent('.collection-link[aria-label="Play queue"] small')).startsWith('2')); });
  await check('B', 'recent search saved', async () => ok((await page.evaluate(() => localStorage.getItem('aurora-searches'))).includes('band')));
  await page.click('button[aria-label="Back to music"]'); await wait(900);
  await check('B', 'recent chip re-runs the search', async () => { await page.fill('input[aria-label="Search songs or artists"]', ''); await wait(700); await page.click('.chip-group[aria-label="Recent searches"] .chip >> nth=0'); await wait(900); ok(await page.inputValue('input[aria-label="Search songs or artists"]') === 'band'); });
  await check('B', 'Play next inserts after the current song', async () => { await page.click('button:has-text("Play next")'); await wait(300); ok((await page.textContent('.toast')).includes('next')); });
  await check('B', 'clear recent searches', async () => { await page.fill('input[aria-label="Search songs or artists"]', ''); await wait(700); await page.click('.chip-quiet'); await wait(300); ok(await page.locator('.chip-group[aria-label="Recent searches"]').count() === 0); });
  await check('B', 'Greek search renders unicode results', async () => { await searchFor(page, 'ελένη'); ok((await page.textContent('.search-results')).includes('Φωτιά μου')); });
  await check('B', 'plain search never requests an altered version', async () => ok(requests.filter(url => url.includes('/api/video/search')).every(url => !url.includes('variant='))));
  await check('B', '8D search requests the 8D version', async () => { await searchFor(page, 'night drive 8d'); await page.click('.top-result-play'); await wait(1000); ok(requests.some(url => url.includes('/api/video/search') && url.includes('variant=8d'))); });
  await check('B', 'no runtime errors in search', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

// ── C. Playback, player, lyrics, sheets ────────────────────────────────────
if (!only || only === 'C') {
  const { context, page, errors } = await newSession(browser);
  await page.goto(BASE); await wait(500);
  await startQueue(page, ['Morning Light', 'Slow Tide']);
  await check('C', 'playing opens the immersive player', async () => ok(await page.locator('.immersive-player').count() === 1));
  await check('C', 'document title follows the song', async () => ok((await title(page)).startsWith('Night Drive')));
  await check('C', 'dock slides in', async () => ok(await page.locator('.player-dock').count() === 1));
  await check('C', 'play/pause toggles', async () => { await page.click('.dock-transport button[aria-label="Pause"]'); await wait(300); ok(await page.locator('.dock-transport button[aria-label="Play"]').count() === 1); await page.click('.dock-transport button[aria-label="Play"]'); await wait(400); ok(await page.locator('.dock-transport button[aria-label="Pause"]').count() === 1); });
  await check('C', 'Space toggles playback', async () => { await page.locator('body').press(' '); await wait(300); ok(await page.locator('.dock-transport button[aria-label="Play"]').count() === 1); await page.locator('body').press(' '); await wait(400); });
  await check('C', 'ArrowRight seeks forward 5 s', async () => { const before = await playerTime(page); await page.locator('body').press('ArrowRight'); await wait(350); ok(await playerTime(page) >= before + 4); });
  await check('C', 'ArrowLeft seeks back 5 s', async () => { const before = await playerTime(page); await page.locator('body').press('ArrowLeft'); await wait(350); ok(await playerTime(page) <= before - 3); });
  await check('C', 'seek slider commits once per drag', async () => {
    const before = (await events(page)).filter(row => row[1] === 'seek').length;
    await page.evaluate(() => { const input = document.querySelector('.dock-seek input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); for (const v of [10, 11, 12, 13, 14]) { set.call(input, String(v)); input.dispatchEvent(new Event('input', { bubbles: true })); } input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
    await wait(300); ok((await events(page)).filter(row => row[1] === 'seek').length === before + 1);
  });
  await check('C', 'volume slider sets volume', async () => { await page.fill('input[aria-label="Volume"]', '40').catch(async () => { await page.evaluate(() => { const input = document.querySelector('input[aria-label="Volume"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '40'); input.dispatchEvent(new Event('input', { bubbles: true })); }); }); await wait(200); ok(await page.inputValue('input[aria-label="Volume"]') === '40'); });
  await check('C', 'M mutes', async () => { await page.locator('body').press('m'); await wait(200); ok(await page.inputValue('input[aria-label="Volume"]') === '0'); });
  await check('C', 'M restores the previous volume', async () => { await page.locator('body').press('m'); await wait(200); ok(await page.inputValue('input[aria-label="Volume"]') === '40'); });
  await check('C', 'F likes the song', async () => { await page.locator('body').press('f'); await wait(300); ok((await page.textContent('.collection-link[aria-label="Liked songs"] small')).startsWith('1')); });
  await check('C', 'F again unlikes', async () => { await page.locator('body').press('f'); await wait(300); ok((await page.textContent('.collection-link[aria-label="Liked songs"] small')).startsWith('0')); await page.locator('body').press('f'); await wait(200); });
  await check('C', 'L opens lyrics', async () => { await page.locator('body').press('l'); await wait(1200); ok(await page.locator('.desktop-lyrics .lyric-line').count() === 6); });
  await check('C', 'current lyric line follows time', async () => { await setSeek(page, 10.5); await wait(1500); const text = await page.textContent('.lyric-line.current'); ok(text.includes('wheel'), `${text} @ ${await playerTime(page)}`); });
  await check('C', 'word wipe is partially filled mid-line', async () => { const fills = await page.locator('.lyric-line.current .word-fill').evaluateAll(nodes => nodes.map(node => Number(node.style.getPropertyValue('--fill')))); ok(fills.some(v => v > 0 && v < 1) || (fills.some(v => v === 1) && fills.some(v => v === 0)), fills.join(',')); });
  await check('C', 'backing vocals keep filling after the next line starts', async () => {
    await setSeek(page, 13.1); await wait(2900);
    const state = await page.evaluate(() => { const line = document.querySelectorAll('.lyric-line')[2]; return { current: line.classList.contains('current'), backing: [...line.querySelectorAll('.lyric-word.backing .word-fill')].map(node => Number(node.style.getPropertyValue('--fill'))) }; });
    ok(!state.current && state.backing.length === 2 && state.backing.every(v => v > .9), JSON.stringify(state) + ` @ ${await playerTime(page)}`);
  });
  await check('C', 'lyrics auto-scroll keeps the current line in view', async () => { const box = await page.evaluate(() => { const line = document.querySelector('.lyric-line.current').getBoundingClientRect(); const list = document.querySelector('.lyrics-scroll').getBoundingClientRect(); return line.top >= list.top && line.bottom <= list.bottom; }); ok(box); });
  await check('C', 'clicking a line seeks to it', async () => { await page.click('.lyric-line >> nth=1'); await wait(500); const t = await playerTime(page); ok(t >= 6 && t < 8, String(t)); });
  await check('C', 'wheel scrolling pauses follow mode', async () => { await page.mouse.move(1000, 400); await page.mouse.wheel(0, 300); await wait(600); ok(await page.locator('button:has-text("Follow lyrics")').count() === 1); });
  await check('C', 'Follow lyrics resumes', async () => { await page.click('button:has-text("Follow lyrics")'); await wait(700); ok(await page.locator('button:has-text("Follow lyrics")').count() === 0); });
  await check('C', 'instrumental gap shows the interlude', async () => { await setSeek(page, 19); await wait(1200); ok(await page.locator('.lyric-interlude').count() === 1); });
  await check('C', 'lyric frame rate stays smooth', async () => { const fps = await page.evaluate(() => new Promise(resolve => { let frames = 0; const start = performance.now(); const tick = () => { frames++; if (performance.now() - start < 1500) requestAnimationFrame(tick); else resolve(frames / 1.5); }; requestAnimationFrame(tick); })); ok(fps >= 40, `fps ${fps} (headless software rendering)`); });
  const fps = () => page.evaluate(() => new Promise(resolve => { let frames = 0; const start = performance.now(); const tick = () => { frames++; if (performance.now() - start < 1500) requestAnimationFrame(tick); else resolve(frames / 1.5); }; requestAnimationFrame(tick); }));
  await check('C', 'the backdrop opens up on a held note, smoothly', async () => { await setSeek(page, 26.6); await wait(400); ok(await page.locator('.player-art-background.is-peak').count() === 1, 'no peak while the note is held'); const rate = await fps(); ok(rate >= 30, `fps ${rate} during the zoom (software rendering)`); });
  await check('C', 'the peak kicks on every beat and rings once a bar (120 BPM → 0.5 s, 2 s), lit brighter', async () => { await setSeek(page, 26.6); await wait(2400); const wave = await page.evaluate(() => { const element = document.querySelector('.beat-pulse-wave'); const ring = document.querySelector('.beat-pulse-ring'); const animation = element?.getAnimations()[0]; return element && { duration: getComputedStyle(element).animationDuration, bar: ring && getComputedStyle(ring).animationDuration, running: animation?.playState, boost: Number(getComputedStyle(document.querySelector('.player-art-boost')).opacity) }; }); ok(wave && wave.duration === '0.5s' && wave.bar === '2s' && wave.running === 'running' && wave.boost > 0.6, JSON.stringify(wave)); const rate = await fps(); ok(rate >= 30, `fps ${rate} while pulsing`); if (process.env.SHOTS) for (const [name, at] of [['crest', 0], ['trough', 0.48]]) { await page.evaluate(at => { for (const node of document.querySelectorAll('.beat-pulse-wave, .beat-pulse-ring')) { const animation = node.getAnimations()[0]; animation.pause(); animation.currentTime = at * 1000; } }, at); await page.screenshot({ path: `${process.env.SHOTS}/pulse-${name}.png` }); await page.evaluate(() => { for (const node of document.querySelectorAll('.beat-pulse-wave, .beat-pulse-ring')) node.getAnimations()[0].play(); }); } });
  await check('C', 'and settles again outside the peak', async () => { await setSeek(page, 7); await wait(900); ok(await page.locator('.player-art-background.is-peak').count() === 0); await wait(2600); if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/pulse-calm.png` }); ok(await page.locator('.beat-pulse').count() === 0, 'pulse lingers outside the peak'); ok(Number(await page.evaluate(() => getComputedStyle(document.querySelector('.player-art-boost')).opacity)) < 0.02, 'the lift lingers outside the peak'); });
  // Audio-visual sync is imperceptible within about ±45 ms (ITU-R BT.1359).
  await check('C', 'the kick stays on the beat as the song plays (median ≤ 25 ms, worst ≤ 50 ms)', async () => {
    await setSeek(page, 26.3); await wait(2200);
    const errors = [];
    for (let i = 0; i < 10; i++) {
      // Both read in the same task: the animation's position and the playing deck's exact time.
      const sample = await page.evaluate(() => { const node = document.querySelector('.beat-pulse-wave'); const animation = node?.getAnimations()[0]; const deck = (window.__ytPlayers || []).find(p => p.state === 1); return node && animation && deck && { origin: Number(node.dataset.beatOrigin), period: Number(node.dataset.period), at: Number(animation.currentTime) / 1000, time: deck.base + (document.timeline.currentTime - deck.since) / 1000 * deck.rate }; }); // the song's position at this frame's own timestamp
      const time = sample?.time;
      if (!sample) { errors.push('no pulse'); break; }
      const want = (((time - sample.origin) % sample.period) + sample.period) % sample.period;
      const have = ((sample.at % sample.period) + sample.period) % sample.period;
      const drift = Math.abs(want - have); errors.push(Math.round(Math.min(drift, sample.period - drift) * 1000));
      await wait(300);
    }
    const sorted = errors.filter(ms => typeof ms === 'number').sort((a, b) => a - b);
    ok(sorted.length === 10 && sorted[5] <= 25 && sorted.at(-1) <= 50, `drift (ms): ${errors.join(', ')}`);
  });
  await check('C', 'lyric clicks, wheel, follow and peaks never scroll the player into its backdrop overscan', async () => { const shift = await page.evaluate(() => { const player = document.querySelector('.immersive-player'); return [player.scrollLeft, player.scrollTop]; }); ok(shift.join() === '0,0', `player shifted by ${shift}`); });
  await check('C', 'video mode toggles on', async () => { await page.click('button[aria-label="Video mode"]'); await wait(500); ok(await page.locator('.aurora-app.has-video').count() === 1); });
  await check('C', 'artwork mode toggles back', async () => { await page.click('button[aria-label="Artwork mode"]'); await wait(500); ok(await page.locator('.aurora-app.has-video').count() === 0); });
  await check('C', 'next track advances the queue', async () => { await page.click('.dock-transport button[aria-label="Next track"]'); await wait(1200); ok((await title(page)).startsWith('Morning Light')); });
  await check('C', 'lyrics update for the next song', async () => { await wait(800); ok((await page.textContent('.desktop-lyrics')).includes('Sunrise')); });
  await check('C', 'line-synced lyrics show a current line', async () => { await setSeek(page, 5.5); await wait(1200); ok((await page.textContent('.lyric-line.current')).includes('Waking')); });
  await check('C', 'previous after 3 s restarts the song', async () => { await page.click('.dock-transport button[aria-label="Previous track"]'); await wait(500); ok(await playerTime(page) < 2 && (await title(page)).startsWith('Morning Light')); });
  await check('C', 'previous at the start goes back', async () => { await page.click('.dock-transport button[aria-label="Previous track"]'); await wait(1200); ok((await title(page)).startsWith('Night Drive')); });
  await check('C', 'Next slides the new cover in from the right, Previous from the left', async () => {
    const shift = name => page.evaluate(alt => { const img = document.querySelector(`.now-playing-art img[alt^="${alt}"]`); return img ? new DOMMatrix(getComputedStyle(img).transform).m41 : null; }, name);
    await page.click('.dock-transport button[aria-label="Next track"]'); await wait(200); const forward = await shift('Morning Light');
    await wait(1400);
    await page.click('.dock-transport button[aria-label="Previous track"]'); await wait(200); const back = await shift('Night Drive');
    await wait(1400);
    ok(forward > 1 && back < -1, `next ${forward}, previous ${back}`);
  });
  await check('C', 'panel open during a change still fills words', async () => { await page.click('.dock-transport button[aria-label="Next track"]'); await wait(900); await page.click('.dock-transport button[aria-label="Previous track"]'); await wait(1500); await setSeek(page, 3); await wait(1200); const filled = await page.locator('.word-fill').evaluateAll(nodes => nodes.some(node => Number(node.style.getPropertyValue('--fill')) > 0)); ok(filled, `${await title(page)} lines=${await page.locator('.lyric-line').count()} t=${await playerTime(page)}`); });
  await check('C', 'song without lyrics explains itself', async () => { await page.click('.dock-transport button[aria-label="Next track"]'); await wait(300); await page.click('.dock-transport button[aria-label="Next track"]'); await wait(2200); const text = await page.textContent('.desktop-lyrics'); ok(text.includes('Let the music speak'), `${await title(page)}: ${text.slice(0, 80)}`); });
  await check('C', 'repeat cycles off → all → one → off', async () => { const button = () => page.locator('.dock-transport button[aria-label^="Repeat"]'); const seen = []; for (let i = 0; i < 3; i++) { await button().click(); await wait(150); seen.push(await button().getAttribute('aria-label')); } ok(seen.join() === 'Repeat: all,Repeat: one,Repeat: off', seen.join()); });
  await check('C', 'shuffle toggles', async () => { await page.click('.dock-transport button[aria-label="Shuffle"]'); ok(await page.getAttribute('.dock-transport button[aria-label="Shuffle"]', 'aria-pressed') === 'true'); await page.click('.dock-transport button[aria-label="Shuffle"]'); });
  await check('C', 'media session metadata set', async () => ok(await page.evaluate(() => navigator.mediaSession?.metadata?.title?.length > 0)));
  await check('C', 'queue sheet opens', async () => { await page.click('.dock-actions button[aria-label="Open queue"]'); await wait(800); ok(await page.locator('dialog.sheet[open] .track-row').count() === 3); });
  await check('C', 'queue row removal animates out', async () => { await page.click('dialog.sheet button[aria-label="Remove Slow Tide from queue"]'); await wait(700); ok(await page.locator('dialog.sheet .track-row').count() === 2); });
  await check('C', 'play from queue row', async () => { await page.click('dialog.sheet details.queue-played summary').catch(() => {}); await wait(400); await page.click('dialog.sheet .track-row:has-text("Morning Light") .track-main'); await wait(1200); ok((await title(page)).startsWith('Morning Light')); });
  await check('C', 'Escape closes the sheet', async () => { if (!await page.locator('dialog.sheet[open]').count()) await page.click('.dock-actions button[aria-label="Open queue"]'); await wait(700); await page.keyboard.press('Escape'); await wait(700); ok(await page.locator('dialog.sheet').count() === 0); });
  await check('C', 'settings sheet changes lyric offset', async () => { await page.click('button[aria-label="Player settings"]'); await wait(700); for (let i = 0; i < 5; i++) { await page.click('button[aria-label="Show lyrics earlier"]'); await wait(80); } ok((await page.textContent('output[aria-label="Current lyrics offset"]')).trim() === '+0.5 s'); ok(await page.locator('.offset-stepper .small-pill:has-text("Auto")').count() === 1, 'no Auto once set by hand'); await page.click('.offset-stepper .small-pill:has-text("Auto")'); await wait(500); ok((await page.textContent('output[aria-label="Current lyrics offset"]')).trim() === '0.0 s', 'Auto returns to published timing'); for (let i = 0; i < 5; i++) await page.click('button[aria-label="Show lyrics earlier"]'); });
  await check('C', 'settings lists keyboard shortcuts', async () => ok(await page.locator('.shortcut-list kbd').count() >= 6));
  await check('C', 'settings → DJ link with back', async () => { await page.click('.dj-settings-link'); await wait(800); ok(await page.locator('dialog[aria-label="DJ transition"]').count() === 1); });
  await check('C', 'back returns to settings', async () => { await page.click('button[aria-label="Back to preferences"]'); await wait(800); ok(await page.locator('dialog[aria-label="Make it yours"]').count() === 1); });
  await check('C', 'backdrop click closes the sheet', async () => { await page.mouse.click(20, 20); await wait(800); ok(await page.locator('dialog.sheet').count() === 0); });
  await check('C', 'DJ switch persists', async () => { await page.click('.dock-actions button[aria-label="DJ transition settings"]'); await wait(700); await page.click('button[aria-label="Enable DJ transition"]'); ok(await page.evaluate(() => localStorage.getItem('aurora-dj')) === 'true'); });
  await check('C', 'autoplay switch persists', async () => { await page.click('button[aria-label="Autoplay similar songs"]'); ok(await page.evaluate(() => localStorage.getItem('aurora-autoplay')) === 'true'); await page.click('button[aria-label="Autoplay similar songs"]'); await page.keyboard.press('Escape'); await wait(600); });
  await check('C', 'toast dismisses itself', async () => { await page.locator('body').press('f'); await wait(300); ok(await page.locator('.toast').count() === 1); await wait(4200); ok(await page.locator('.toast').count() === 0); await page.locator('body').press('f'); await wait(200); });
  await check('C', 'Escape closes the player', async () => { await page.locator('body').press('Escape'); await wait(900); ok(await page.locator('.immersive-player').count() === 0); });
  await check('C', 'library shows the liked song', async () => { await page.click('nav[aria-label="Main navigation"] button[aria-label="Your library"]'); await wait(900); ok(await page.locator('.search-results .track-row').count() === 1); });
  await check('C', 'dock opens the player again', async () => { await page.click('.dock-track'); await wait(900); ok(await page.locator('.immersive-player').count() === 1); });
  await check('C', 'every visible control has an accessible name', async () => { const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, select')].filter(el => el.offsetParent && !(el.getAttribute('aria-label') || el.textContent.trim() || el.title)).map(el => el.outerHTML.slice(0, 80))); ok(!unnamed.length, unnamed.join(' | ')); });
  await check('C', 'no runtime errors in playback', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

// ── D. DJ transition and seamless hand-over ────────────────────────────────
async function djSession(prefs, options = {}) {
  const session = await newSession(browser, { viewport: { width: 1280, height: 800 }, prefs: { 'aurora-dj': 'true', ...prefs }, ...options });
  await session.page.goto(BASE); await wait(500); await startQueue(session.page);
  return session;
}
if (!only || only === 'D') {
  const { context, page, errors } = await djSession({ 'aurora-live-dj': 'true' });
  const t0 = await page.evaluate(() => performance.now());
  await check('D', 'timeline shows the DJ region', async () => { await wait(1500); ok(await page.locator('.dj-seek-zone').count() >= 1); });
  await check('D', 'standby deck exists before it is needed', async () => ok(await page.locator('.yt-deck').count() === 2));
  await check('D', 'next song buffers muted far ahead of the cue', async () => { await wait(6500); const load = (await events(page)).find(row => row[1] === 'load' && row[2] === 'BBBBBBBBBBB'); ok(load && load[3] === true, JSON.stringify(load)); ok(load[0] - t0 < 12000); });
  await check('D', 'standby is paused at its start once buffered', async () => { await wait(600); const rows = await events(page); ok(rows.some(row => row[1] === 'pause' && row[2] === 'BBBBBBBBBBB') && rows.some(row => row[1] === 'seek' && row[2] === 'BBBBBBBBBBB' && row[3] === 0)); });
  await check('D', 'pill says the next song is being prepared or ready', async () => { await page.click('.dock-actions button[aria-label="DJ transition settings"]'); await wait(700); const text = await page.textContent('.dj-now'); await page.keyboard.press('Escape'); await wait(500); ok(/ready|Ready/.test(text), text); });
  // Lyric cue: last vocal ends 33.4 s → blend starts at 34.4 s.
  await page.evaluate(() => { window.__longtasks = []; });
  await setSeek(page, 31);
  const markSeek = await page.evaluate(() => performance.now());
  await wait(4200);
  await check('D', 'blend starts on the post-vocal cue', async () => { const play = (await events(page)).find(row => row[1] === 'play' && row[2] === 'BBBBBBBBBBB' && row[0] > markSeek); ok(play, 'no standby play'); });
  await check('D', 'no reload of the next song on the audible deck', async () => ok(!(await events(page)).some(row => row[1] === 'load' && row[2] === 'BBBBBBBBBBB' && row[3] === false)));
  await check('D', 'title switches with the blend', async () => ok((await title(page)).startsWith('Morning Light')));
  await check('D', 'incoming lyrics ready at the hand-over', async () => { await page.click('button[aria-label="Show lyrics"]'); await wait(900); ok((await page.textContent('.desktop-lyrics')).includes('Sunrise')); });
  await wait(7500);
  await check('D', 'both songs are audible together', async () => { const vols = await page.evaluate(() => window.__vols); const a = vols.filter(v => v[1] === 'AAAAAAAAAAA' && v[2] > 5 && v[2] < 75); const b = vols.filter(v => v[1] === 'BBBBBBBBBBB' && v[2] > 5 && v[2] < 75); ok(a.length > 3 && b.length > 3, `A:${a.length} B:${b.length} ${JSON.stringify(vols.slice(-6))}`); });
  await check('D', 'equal-power curve reaches full volume', async () => { const vols = await page.evaluate(() => window.__vols.filter(v => v[1] === 'BBBBBBBBBBB')); ok(vols.at(-1)[2] === 68, `ends at the Normal loudness level (80 × 0.85): ${JSON.stringify(vols.at(-1))}`); });
  await check('D', 'midpoint loudness is equal power', async () => { const vols = await page.evaluate(() => window.__vols.filter(v => v[1] === 'BBBBBBBBBBB' && v[2] > 0)); const mid = vols.find(v => v[2] >= 50); ok(mid && mid[2] <= 62, JSON.stringify(mid)); });
  await check('D', 'outgoing deck stops after the blend', async () => ok((await events(page)).some(row => row[1] === 'pause' && row[2] === 'AAAAAAAAAAA')));
  await check('D', 'a deep sweep plays under the online blend', async () => ok(await page.evaluate(() => window.__sweeps) >= 1, 'no sweep started'));
  await check('D', 'coarse player rates never claim tempo matching', async () => ok(!(await events(page)).some(row => row[1] === 'rate' && row[3] !== 1)));
  await check('D', 'blend main thread stays free of long tasks', async () => { const tasks = await page.evaluate(() => window.__longtasks); ok(tasks.filter(t => t > 120).length <= 1, `blend-window long tasks: ${tasks.join(',')}`); });
  await check('D', 'no runtime errors during DJ blend', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'D') {
  const { context, page, errors } = await djSession({ 'fine-rates': '1' });
  await wait(7000); await setSeek(page, 24); await wait(12000);
  await check('D', 'tempo glides before the blend when rates allow', async () => { const rows = await events(page); const rates = rows.filter(row => row[1] === 'rate' && row[2] === 'AAAAAAAAAAA' && row[3] > 1); const play = rows.find(row => row[1] === 'play' && row[2] === 'BBBBBBBBBBB'); ok(rates.length >= 2 && play && rates[0][0] < play[0], JSON.stringify(rates)); });
  await check('D', 'glide stays within the ±8% bound', async () => ok((await events(page)).filter(row => row[1] === 'rate').every(row => row[3] >= .92 && row[3] <= 1.08)));
  await check('D', 'glided song hands over to the next title', async () => ok((await title(page)).startsWith('Morning Light')));
  await check('D', 'no runtime errors during glide', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'D') {
  // 120 → 126 BPM on an embed that only plays 0.05 speed steps.
  const { context, page, errors } = await djSession({ 'fine-rates': '3' }, { incomingBpm: 126 });
  await wait(7000); await setSeek(page, 24); await wait(14000);
  const rows = (await events(page)).filter(row => row[1] === 'rate');
  await check('D', 'a 0.05-step embed is detected and song A steps to 1.05× live', async () => ok(rows.some(row => row[2] === 'AAAAAAAAAAA' && Math.abs(row[3] - 1.05) < 1e-6), JSON.stringify(rows.slice(-6))));
  await check('D', 'on the step grid song A never goes past its bound', async () => ok(rows.filter(row => row[2] === 'AAAAAAAAAAA').every(row => row[3] <= 1.0501), JSON.stringify(rows)));
  await check('D', 'stepped tempo match hands over to the next song', async () => ok((await title(page)).startsWith('Morning Light')));
  await check('D', 'no runtime errors in a stepped-tempo blend', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'D') {
  // 120 → 130 BPM on an embed that plays fine rates without listing them.
  const { context, page, errors } = await djSession({ 'fine-rates': '2' }, { incomingBpm: 130 });
  await wait(7000); await setSeek(page, 24); await wait(23000);
  const rows = (await events(page)).filter(row => row[1] === 'rate');
  await check('D', 'reading a requested rate back discovers a fine-rate embed', async () => ok(rows.some(row => row[2] === 'AAAAAAAAAAA' && row[3] > 1.02), JSON.stringify(rows.slice(0, 8))));
  await check('D', 'wide tempo gaps meet in the middle: song A never passes +5%', async () => ok(rows.filter(row => row[2] === 'AAAAAAAAAAA').every(row => row[3] <= 1.045), JSON.stringify(rows.filter(row => row[2] === 'AAAAAAAAAAA').at(-1))));
  await check('D', 'song B enters at the shared tempo, then eases back to its own', async () => { const all = await events(page); const play = all.find(row => row[1] === 'play' && row[2] === 'BBBBBBBBBBB'); const b = rows.filter(row => row[2] === 'BBBBBBBBBBB' && play && row[0] >= play[0] - 50); ok(b.some(row => row[3] > .95 && row[3] < .97) && b.some(row => row[3] > .97 && row[3] < 1) && b.at(-1)[3] === 1, JSON.stringify(b.slice(-6))); });
  await check('D', 'no runtime errors in a split-tempo blend', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'D') {
  const { context, page, errors } = await djSession({ 'aurora-live-dj': 'true' });
  await wait(7500);
  await check('D', 'manual Next overlaps with the primed deck', async () => { const mark = await page.evaluate(() => performance.now()); await page.click('.dock-transport button[aria-label="Next track"]'); await wait(1500); const rows = await events(page); ok(rows.some(row => row[1] === 'play' && row[2] === 'BBBBBBBBBBB' && row[0] > mark) && !rows.some(row => row[1] === 'load' && row[2] === 'BBBBBBBBBBB' && row[3] === false)); });
  await check('D', 'manual blend lands on the next title', async () => { await wait(2500); ok((await title(page)).startsWith('Morning Light')); });
  await check('D', 'pausing mid-session keeps the new song', async () => { await page.click('.dock-transport button[aria-label="Pause"]'); await wait(400); ok((await title(page)).startsWith('Morning Light')); });
  await check('D', 'no runtime errors in manual blend', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'D') {
  const { context, page, errors } = await djSession({}, { longIntro: true });
  await wait(7500);
  await check('D', 'song B with a long intro is buffered from its chosen entry', async () => { const load = (await events(page)).find(row => row[1] === 'load' && row[2] === 'BBBBBBBBBBB' && row[3] === true); ok(load && load[4] >= 22 && load[4] <= 33, JSON.stringify(load)); });
  await setSeek(page, 31); await wait(9000);
  await check('D', 'song B enters past its intro and its vocals follow the blend', async () => { ok((await title(page)).startsWith('Morning Light')); const t = await playerTime(page); ok(t >= 27 && t < 38, String(t)); });
  await check('D', 'no runtime errors with a chosen entry', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'D') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 } });
  await page.goto(BASE); await wait(500); await startQueue(page);
  await wait(7000);
  await check('D', 'seamless mode (DJ off) pre-buffers the next song', async () => ok((await events(page)).some(row => row[1] === 'load' && row[2] === 'BBBBBBBBBBB' && row[3] === true)));
  await check('D', 'DJ off shows no DJ region', async () => ok(await page.locator('.dj-seek-zone').count() === 0));
  await setSeek(page, 56); await wait(5500);
  await check('D', 'seamless hand-over starts the next song before the end', async () => { const rows = await events(page); const play = rows.find(row => row[1] === 'play' && row[2] === 'BBBBBBBBBBB'); ok(play, 'no seamless start'); ok(!rows.some(row => row[1] === 'load' && row[2] === 'BBBBBBBBBBB' && row[3] === false), 'reloaded'); });
  await check('D', 'seamless hand-over lands on the next title', async () => ok((await title(page)).startsWith('Morning Light')));
  await check('D', 'no runtime errors in seamless mode', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

// ── E. Mobile, tablet, reduced motion ──────────────────────────────────────
if (!only || only === 'E') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 390, height: 844 } });
  await page.goto(BASE); await wait(1000);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await check('E', 'mobile home has no sideways scroll', async () => ok(!await overflow()));
  await check('E', 'mobile nav marks the page', async () => ok(await page.locator('nav[aria-label="Mobile navigation"] .nav-pill').count() === 1));
  await check('E', 'mobile search has no sideways scroll', async () => { await page.click('nav[aria-label="Mobile navigation"] button:has-text("Search")'); await wait(700); await searchFor(page, 'band'); ok(!await overflow()); });
  await check('E', 'mobile top result plays', async () => { await page.click('.top-result-play'); await wait(1400); ok(await page.locator('.immersive-player').count() === 1); });
  await check('E', 'mobile controls are at least 44 px', async () => { const small = await page.evaluate(() => [...document.querySelectorAll('.transport-large button, .player-pills button')].filter(el => { const r = el.getBoundingClientRect(); return r.height < 43; }).length); ok(small === 0, String(small)); });
  await check('E', 'mobile lyrics open in place', async () => { await page.click('.player-pills button:has-text("Lyrics")'); await wait(1400); ok(await page.locator('.lyric-line').count() === 6); });
  await check('E', 'mobile sheet rises from the bottom edge', async () => { await page.click('.player-pills button:has-text("Queue")'); await wait(900); const bottom = await page.evaluate(() => document.querySelector('dialog.sheet').getBoundingClientRect().bottom); ok(Math.abs(bottom - 844) < 2, String(bottom)); await page.keyboard.press('Escape'); await wait(600); });
  await check('E', 'swipe down on the queue pull closes the player', async () => { await page.click('.player-pills button:has-text("Lyrics")'); await wait(500); const box = await page.locator('.queue-pull').boundingBox(); if (!box) throw new Error('no pull'); await page.mouse.move(box.x + box.width / 2, box.y + 5); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + 120, { steps: 8 }); await page.mouse.up(); await wait(900); ok(await page.locator('.immersive-player').count() === 0); });
  await check('E', 'no runtime errors on mobile', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'E') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 900, height: 700 } });
  await page.goto(BASE); await wait(900);
  await check('E', 'tablet home has no sideways scroll', async () => ok(!await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await check('E', 'tablet player fits', async () => { await startQueue(page); ok(!await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)); });
  await check('E', 'no runtime errors on tablet', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'E') {
  const { context, page, errors } = await newSession(browser, { reducedMotion: 'reduce' });
  await page.goto(BASE); await wait(600); await startQueue(page);
  await check('E', 'reduced motion removes lyric transforms', async () => { await page.locator('body').press('l'); await wait(900); const transform = await page.evaluate(() => getComputedStyle(document.querySelector('.lyric-line')).transform); ok(transform === 'none', transform); });
  await check('E', 'reduced motion still plays and navigates', async () => { await page.locator('body').press('Escape'); await wait(500); ok(await page.locator('.immersive-player').count() === 0); });
  await check('E', 'no runtime errors with reduced motion', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

// ── F. Discovery, navigation, adaptive radio, audio honesty, polish ────────
if (!only || only === 'F') {
  const { context, page, errors } = await newSession(browser);
  await page.goto(BASE); await wait(600); await goSearch(page); await wait(600);
  await check('F', 'category tabs appear with a query', async () => { await searchFor(page, 'night drive'); ok(await page.locator('.search-tabs [role=tab]').count() === 6); ok(await page.getAttribute('.search-tabs [role=tab] >> nth=0', 'aria-selected') === 'true'); });
  await check('F', '"All" shows every section', async () => { await wait(500); for (const title of ['Songs', 'Videos', 'Artists', 'Albums', 'Playlists']) ok(await page.locator(`.result-section h2:has-text("${title}")`).count() === 1, title); });
  await check('F', 'Videos tab lists remixes and edits', async () => { await page.click('.search-tabs [role=tab]:has-text("Videos")'); await wait(900); ok((await page.textContent('.search-results')).includes('slowed')); ok(await page.locator('.video-card').count() === 2); });
  await check('F', 'tab indicator follows the selection', async () => ok(await page.locator('.search-tabs [role=tab][aria-selected=true] .nav-pill').count() === 1));
  await check('F', 'edit words make a video the top result', async () => { await page.click('.search-tabs [role=tab]:has-text("All")'); await searchFor(page, 'night drive slowed'); await wait(500); ok((await page.textContent('.top-result')).includes('Video')); });
  await check('F', 'playing a video uses its own source directly', async () => { await page.click('.top-result-play'); await wait(1200); ok((await title(page)).includes('slowed')); ok(await page.locator('.quality-chip:has-text("YouTube video")').count() >= 1); });
  await check('F', 'Back closes the player', async () => { await page.goBack(); await wait(900); ok(await page.locator('.immersive-player').count() === 0); ok((await page.textContent('.breadcrumb')).includes('Search')); });
  await check('F', 'artist query puts the artist on top', async () => { await searchFor(page, 'band of night'); await wait(400); ok((await page.textContent('.top-result')).includes('Artist')); });
  await check('F', 'Open artist shows top songs', async () => { await page.click('.top-result-play'); await wait(1300); ok((await page.textContent('.collection-head')).includes('Band Of Night')); ok(await page.locator('.search-results .track-row').count() === 3); });
  await check('F', 'Back returns to the search with its query', async () => { await page.goBack(); await wait(1000); ok(await page.inputValue('input[aria-label="Search songs or artists"]') === 'band of night'); });
  await check('F', 'album card opens the album', async () => { await page.click('.collection-card >> nth=0'); await wait(1300); ok((await page.textContent('.collection-head h1')).includes('Roads')); });
  await check('F', 'Play plays the album in order', async () => { await page.click('.collection-head .primary-button'); await wait(1300); ok((await title(page)).startsWith('Night Drive')); ok((await page.textContent('.collection-link[aria-label="Play queue"] small')).startsWith('3')); });
  await check('F', 'official source is labelled honestly', async () => ok(await page.locator('.quality-chip:has-text("Official audio")').count() >= 1));
  await check('F', 'quality chip opens the audio sheet', async () => { await page.click('.immersive-track-meta .quality-chip'); await wait(900); ok((await page.textContent('dialog[aria-label="Audio quality"]')).includes('Signal path')); });
  await check('F', 'audio sheet never claims lossless streaming', async () => { const text = await page.textContent('dialog[aria-label="Audio quality"] .audio-facts'); ok(!/lossless|atmos/i.test(text), text); });
  await check('F', 'Back closes the sheet, not the player', async () => { await page.goBack(); await wait(900); ok(await page.locator('dialog.sheet').count() === 0); ok(await page.locator('.immersive-player').count() === 1); });
  await check('F', 'settings → DJ → Back returns to settings', async () => { await page.click('button[aria-label="Player settings"]'); await wait(700); await page.click('.dj-settings-link >> nth=0'); await wait(800); await page.goBack(); await wait(800); ok(await page.locator('dialog[aria-label="Make it yours"]').count() === 1); });
  await check('F', 'closing a stacked sheet closes it completely', async () => { await page.click('.dj-settings-link >> nth=0'); await wait(700); await page.click('dialog[aria-label="DJ transition"] button[aria-label="Close DJ transition"]'); await wait(900); ok(await page.locator('dialog.sheet').count() === 0); await page.goBack(); await wait(900); ok(await page.locator('dialog.sheet').count() === 0, 'back reopened a sheet'); });
  await check('F', 'blend length choice persists', async () => { await page.click('.dock-actions button[aria-label="DJ transition settings"]'); await wait(700); await page.click('.segmented [role=radio]:has-text("Extended")'); ok(await page.evaluate(() => localStorage.getItem('aurora-blend')) === '32'); ok(await page.getAttribute('.segmented [role=radio]:has-text("Extended")', 'aria-checked') === 'true'); await page.keyboard.press('Escape'); await wait(700); });
  await check('F', 'motion backdrop shows the blurred video behind the artwork', async () => { if (!await page.locator('.immersive-player').count()) { await page.click('.dock-track'); await wait(900); } await page.click('button[aria-label="Player settings"]'); await wait(700); await page.click('button[aria-label="Motion backdrop"]'); await page.keyboard.press('Escape'); await wait(800); ok(await page.locator('.aurora-app.motion-art .video-surface.is-visible').count() === 1); ok(await page.locator('.now-playing-art').isVisible()); });
  await check('F', 'no runtime errors in discovery and navigation', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'F') {
  const radio = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ id: `deezer:${i}`, title: `Radio ${i}`, artist: i === 2 ? 'Skipped artist' : `Artist ${i}`, album: 'LP', artwork: 'https://img.test/c/r.jpg', duration: 60, recommended: true, recommendationReason: 'Same vibe as Band' }));
  const history = [0, 1, 2].map(i => ({ key: `skipped artist|nope ${i}`, artist: 'skipped artist', affinity: -1, at: Date.now() - 3600000, type: 'play', track: { id: `n${i}`, title: `Nope ${i}`, artist: 'Skipped artist' } }))
    .concat([{ key: 'band|night drive', artist: 'band', affinity: 2, at: Date.now() - 7200000, type: 'play', track: { id: '1', title: 'Night Drive', artist: 'Band', artwork: 'https://img.test/a/600x600bb.jpg', duration: 60 } }]);
  const { context, page, errors } = await newSession(browser, { prefs: { 'aurora-autoplay': 'true', 'aurora-listening': JSON.stringify(history) }, recommendations: radio });
  await page.goto(BASE); await wait(1500);
  await check('F', 'home adapts with a "Because you listened" row', async () => ok((await page.textContent('.for-you h2')).includes('Night Drive')));
  await check('F', 'home rows leave out artists the listener skips', async () => ok(!(await page.textContent('.for-you')).includes('Skipped artist')));
  await check('F', 'the spotlight becomes "Picked for you"', async () => { ok((await page.textContent('.stage-copy .feature-label')).includes('Picked for you')); ok(!(await page.textContent('.stage-copy h2')).includes('The Weeknd')); });
  await check('F', '"Made for a good listen" becomes "Made for you"', async () => ok((await page.textContent('.music-section:not(.for-you) h2')).includes('Made for you')));
  await check('F', 'Daily rotation searches the listener\'s own artists', async () => { await page.click('.mood-card >> nth=0'); await wait(900); const value = await page.inputValue('input[aria-label="Search songs or artists"]'); ok(/Band/.test(value), value); await page.click('nav[aria-label="Main navigation"] button[aria-label="Listen now"]'); await wait(900); });
  await check('F', 'greeting follows the time of day', async () => ok(/Good (morning|afternoon|evening)|Late night/.test(await page.textContent('.page-heading p'))));
  await goSearch(page); await wait(500); await searchFor(page, 'band song');
  await page.click('.search-results .track-row >> nth=0 >> .track-main'); await wait(2500);
  await check('F', 'radio adds a small batch, not an endless list', async () => { const count = Number((await page.textContent('.collection-link[aria-label="Play queue"] small')).split(' ')[0]); ok(count >= 3 && count <= 6, String(count)); });
  await check('F', 'radio additions skip the artist the listener skips', async () => { await page.click('.dock-actions button[aria-label="Open queue"]'); await wait(800); ok(!(await page.textContent('dialog.sheet')).includes('Skipped artist')); await page.keyboard.press('Escape'); await wait(600); });
  await check('F', 'queue grows again as it runs low', async () => {
    for (let i = 0; i < 3; i++) { await page.click('.dock-transport button[aria-label="Next track"]'); await wait(1400); }
    const count = Number((await page.textContent('.collection-link[aria-label="Play queue"] small')).split(' ')[0]);
    ok(count > 6, String(count));
  });
  await check('F', 'no runtime errors in adaptive radio', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'F') {
  const { context, page } = await newSession(browser);
  await page.goto(BASE); await wait(1000);
  await check('F', 'Back on a fresh home screen stays and asks first', async () => {
    await page.evaluate(() => history.back()); await wait(800);
    ok(page.url().startsWith(BASE), page.url());
    ok((await page.textContent('.toast')).includes('back again'));
  });
  await check('F', 'Back from a deeper page goes home first, not away', async () => {
    await goSearch(page); await wait(600); await page.evaluate(() => history.back()); await wait(700);
    ok((await page.textContent('.breadcrumb')).includes('Listen now'));
  });
  await context.close();
}
if (!only || only === 'F') {
  const { context, page, errors } = await newSession(browser, { welcome: true });
  await page.goto(BASE);
  await check('F', 'opening overlay shows the wordmark', async () => { await wait(400); ok(await page.locator('.aurora-welcome img').count() === 1); });
  await check('F', 'app is veiled while the opening plays', async () => ok(await page.locator('.aurora-app.is-veiled').count() === 1));
  await check('F', 'opening lifts on its own and reveals the app', async () => { await wait(3000); ok(await page.locator('.aurora-welcome').count() === 0); ok(await page.locator('.aurora-app.is-veiled').count() === 0); ok(Number(await page.evaluate(() => getComputedStyle(document.querySelector('.aurora-app')).opacity)) > .95); });
  await check('F', 'favicons are declared and served as images', async () => {
    const icons = await page.evaluate(() => [...document.querySelectorAll('link[rel~=icon]')].map(link => link.getAttribute('href')));
    ok(icons.length >= 3, icons.join());
    for (const href of icons) { const response = await page.request.get(new URL(href, BASE).href); ok(/image/.test(response.headers()['content-type'] || ''), `${href}: ${response.headers()['content-type']}`); }
  });
  await check('F', 'local FLAC shows its real hi-res format', async () => {
    const bytes = Buffer.alloc(4096); bytes.write('fLaC', 0, 'latin1'); bytes.set([0, 0, 0, 34], 4);
    const o = 18, rate = 96000, bits = 24, channels = 2;
    bytes[o] = (rate >> 12) & 0xff; bytes[o + 1] = (rate >> 4) & 0xff; bytes[o + 2] = ((rate & 0xf) << 4) | ((channels - 1) << 1) | (((bits - 1) >> 4) & 1); bytes[o + 3] = ((bits - 1) & 0xf) << 4;
    await page.setInputFiles('input[type=file]', { name: 'Studio master.flac', mimeType: 'audio/flac', buffer: bytes });
    await wait(1500);
    ok(await page.locator('.quality-chip:has-text("24-bit/96 kHz · Hi-Res Lossless")').count() >= 1, await page.textContent('.immersive-player').catch(() => ''));
  });
  await check('F', 'no runtime errors in opening and local files', async () => ok(!errors.filter(e => !/decode|NotSupported|no supported source/i.test(e)).length, errors.join(' | ')));
  await context.close();
}

// ── G. Local DJ transition with real decoded audio ─────────────────────────
function clickTrack(bpm, seconds = 40, rate = 22050, quietUntil = 0) {
  const samples = rate * seconds;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0, 'latin1'); data.writeUInt32LE(36 + samples * 2, 4); data.write('WAVEfmt ', 8, 'latin1');
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36, 'latin1'); data.writeUInt32LE(samples * 2, 40);
  const step = rate * 60 / bpm;
  for (let beat = 0; beat * step < samples; beat++) {
    const start = Math.floor(beat * step);
    const gain = start < quietUntil * rate ? .06 : 1;
    for (let j = 0; j < rate / 40 && start + j < samples; j++) data.writeInt16LE(Math.round(Math.exp(-j / (rate / 400)) * Math.sin(j / 3) * 20000 * gain), 44 + (start + j) * 2);
  }
  return data;
}
if (!only || only === 'G') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    sessionStorage.setItem('aurora:welcome-seen', '1');
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('aurora-dj', 'true'); localStorage.setItem('aurora-autoplay', 'false'); sessionStorage.setItem('seeded', '1'); }
    window.__rates = [];
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
    Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', { get() { return descriptor.get.call(this); }, set(value) { if (value !== 1) window.__rates.push(Math.round(value * 1000) / 1000); descriptor.set.call(this, value); } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(BASE); await wait(800);
  await page.setInputFiles('input[type=file]', [
    { name: 'Outgoing 120.wav', mimeType: 'audio/wav', buffer: clickTrack(120) },
    { name: 'Incoming 126.wav', mimeType: 'audio/wav', buffer: clickTrack(126, 48, 22050, 16) },
  ]);
  await wait(3500);
  await check('G', 'local files play and report their real format', async () => { ok((await title(page)).startsWith('Outgoing 120')); ok(await page.locator('.quality-chip:has-text("WAV · 16-bit/22.1 kHz · Lossless")').count() >= 1); });
  await check('G', 'the timeline shows the glide and blend region', async () => ok(await page.locator('.dj-seek-zone.glide').count() >= 1));
  await setSeek(page, 26);
  const states = new Set();
  for (let i = 0; i < 30 && !(await title(page)).startsWith('Incoming'); i++) { states.add(await page.textContent('.dock-actions button[aria-label="DJ transition settings"]').catch(() => '')); states.add(await page.evaluate(() => document.querySelector('.dj-pill small')?.textContent || '')); await wait(400); }
  await check('G', 'the outgoing song glides toward the incoming tempo', async () => { const rates = await page.evaluate(() => window.__rates); ok(rates.some(r => r > 1.01 && r <= 1.051), rates.slice(0, 12).join(',')); });
  await check('G', 'the glide never exceeds the ±8% bound', async () => ok((await page.evaluate(() => window.__rates)).every(r => r >= .9 && r <= 1.09)));
  await check('G', 'the blend hands over to the incoming song', async () => ok((await title(page)).startsWith('Incoming'), await title(page)));
  await check('G', 'song B enters at the shared tempo (tempos meet in the middle)', async () => { const rates = await page.evaluate(() => window.__rates); ok(rates.some(r => r > .97 && r < .98), rates.slice(-12).join(',')); });
  await check('G', 'song B enters at its first full section, not its quiet intro', async () => { const t = await playerTime(page); ok(t >= 15 && t <= 24, String(t)); });
  await wait(10000);
  await check('G', 'song B eases back to its own tempo instead of snapping', async () => { const rates = await page.evaluate(() => window.__rates); const entered = rates.findIndex(r => r > .97 && r < .98); ok(entered >= 0 && rates.slice(entered).some(r => r > .99 && r < 1), rates.slice(-10).join(',')); });
  await check('G', 'the blend completes and the DJ returns to idle', async () => { await page.click('.dock-actions button[aria-label="DJ transition settings"]'); await wait(700); let text = await page.textContent('.dj-now'); for (let i = 0; i < 24 && !/complete|Ready/i.test(text); i++) { await wait(500); text = await page.textContent('.dj-now'); } ok(/complete|Ready/i.test(text), text); await page.keyboard.press('Escape'); await wait(500); });
  await check('G', 'no runtime errors in the local DJ blend', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

// ── H: ten new scenarios (scroll lock, personal home, best part, blend lengths) ──
if (!only || only === 'H') {
  const hours = h => Date.now() - h * 3600000;
  const finish = (track, h) => ({ key: `${track.artist.toLowerCase()}|${track.title.toLowerCase()}`, artist: track.artist.toLowerCase(), affinity: 2, at: hours(h), type: 'play', track });
  const drive = { id: '1', title: 'Night Drive', artist: 'Band', artwork: 'https://img.test/a/600x600bb.jpg', duration: 60 };
  const tide = { id: '4', title: 'Slow Tide', artist: 'Other', artwork: 'https://img.test/c/100x100bb.jpg', duration: 60 };
  const history = [finish(drive, 30), finish(tide, 20), finish(drive, 10), finish(tide, 8), finish(drive, 2)];
  const radio = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ id: `deezer:${i}`, title: `Radio ${i}`, artist: `Artist ${i}`, album: 'LP', artwork: 'https://img.test/c/r.jpg', duration: 60, recommended: true }));
  const { context, page, errors } = await newSession(browser, { prefs: { 'aurora-listening': JSON.stringify(history) }, recommendations: radio });
  await page.goto(BASE); await wait(1500);
  const docScroll = () => page.evaluate(() => document.scrollingElement.scrollTop);
  await check('H', '1 · the page behind an open sheet does not scroll', async () => {
    await page.click('button[aria-label="Preferences"]:visible'); await wait(900);
    await page.mouse.move(700, 450); for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 400); await wait(80); }
    await page.mouse.move(20, 880); for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 400); await wait(80); }
    await wait(300); ok(await docScroll() === 0, `document scrolled to ${await docScroll()}`);
  });
  await check('H', '2 · stacked sheets keep the lock until the last one closes', async () => {
    await page.click('.dj-settings-link:has-text("DJ transition")'); await wait(900);
    ok(await page.evaluate(() => document.documentElement.classList.contains('scroll-locked')));
    await page.keyboard.press('Escape'); await wait(900);
    ok(!(await page.evaluate(() => document.documentElement.classList.contains('scroll-locked'))), 'lock released');
  });
  await check('H', '3 · closing the sheet gives scrolling back to the page', async () => { await page.mouse.move(700, 450); await page.mouse.wheel(0, 500); await wait(600); ok(await docScroll() > 0); await page.evaluate(() => window.scrollTo(0, 0)); await wait(300); });
  await check('H', '4 · the name you give is used to greet you, and remembered', async () => {
    await page.click('button[aria-label="Preferences"]:visible'); await wait(900);
    await page.fill('input[aria-label="Your name"]', 'Alex'); await page.keyboard.press('Escape'); await wait(900);
    ok((await page.textContent('.page-heading p')).includes(', Alex.'));
    await page.reload(); await wait(1500); ok((await page.textContent('.page-heading p')).includes(', Alex.'), 'after reload');
  });
  await check('H', '5 · "On repeat" lists the songs you keep finishing', async () => { const text = await page.textContent('.on-repeat'); ok(text.includes('Night Drive') && text.includes('Slow Tide'), text.slice(0, 120)); ok(text.indexOf('Night Drive') < text.indexOf('Slow Tide'), 'most played first'); });
  await check('H', '6 · "Your artists" shows the voices you come back to', async () => ok(await page.locator('.your-artists .artist-card').count() >= 2));
  await check('H', 'sections below the fold reveal as they scroll into view', async () => {
    const before = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.your-artists')).opacity));
    await page.evaluate(() => document.querySelector('.your-artists').scrollIntoView({ block: 'center' })); await wait(1400);
    const after = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.your-artists')).opacity));
    ok(before < .5 && after > .99, `before ${before}, after ${after}`);
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(400);
  });
  await check('H', 'a soft spotlight follows the pointer across mood cards', async () => {
    const box = await page.locator('.mood-card >> nth=1').boundingBox();
    await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.move(box.x + 60, box.y + 30, { steps: 4 }); await wait(200);
    const x = await page.evaluate(() => document.querySelectorAll('.mood-card')[1].style.getPropertyValue('--spot-x'));
    ok(/^\d+(\.\d+)?px$/.test(x) && Math.abs(parseFloat(x) - 60) < 3, x);
  });
  await check('H', 'the headline rises word by word and stays readable', async () => ok((await page.getAttribute('.page-heading h1', 'aria-label')).startsWith('Your frequency') && await page.locator('.page-heading .reveal-word').count() >= 3));
  await check('H', '7 · the heading speaks to you once home is personal', async () => ok(/Your frequency, (today|tonight)/.test(await page.textContent('.page-heading h1')), await page.textContent('.page-heading h1')));
  await check('H', '8 · a playing song leads home with "More like …"', async () => {
    await startQueue(page); await wait(800);
    await page.click('button[aria-label="Back to music"]').catch(() => {}); await wait(600);
    await page.click('nav[aria-label="Main navigation"] button[aria-label="Listen now"]'); await wait(1500);
    ok((await page.textContent('.for-you h2')).startsWith('More like Night Drive'), await page.textContent('.for-you h2'));
  });
  await check('H', '9 · the refrain is marked on the timeline and "Best part" jumps there', async () => {
    await page.click('.dock-track'); await wait(1200);
    ok(await page.locator('.seek-track .peak-mark').count() >= 1, 'no refrain marks');
    await page.click('.immersive-track-meta .best-part-chip'); await wait(900);
    const t = await playerTime(page); ok(t >= 24 && t <= 27, String(t));
  });
  await check('H', 'liking a song pops the heart with a ring', async () => {
    await page.click('.immersive-track-meta button[aria-label="Like track"]'); await wait(120);
    ok(await page.locator('.immersive-track-meta .like-ring').count() === 1);
    await wait(700); await page.click('.immersive-track-meta button[aria-label="Unlike track"]'); await wait(400);
  });
  await check('H', 'play and pause morph instead of cutting', async () => {
    await page.click('.dock-transport button[aria-label="Pause"]');
    const during = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(document.querySelectorAll('.dock-transport .play-glyph > span').length))));
    await wait(600);
    const settled = await page.locator('.dock-transport .play-glyph > span').count();
    ok(during === 2 && settled === 1, `during ${during}, settled ${settled}`);
    await page.click('.dock-transport button[aria-label="Play"]'); await wait(500);
  });
  await check('H', '10 · blends run in whole phrases: Auto (default), Short, Club and Extended', async () => {
    await page.click('.dock-actions button[aria-label="DJ transition settings"]'); await wait(800);
    const labels = await page.locator('.segmented [role=radio]').allTextContents();
    ok(labels.join('|') === 'AutoLongest fit|Short8s|Club16s|Extended32s', labels.join('|'));
    ok(await page.getAttribute('.segmented [role=radio]:has-text("Auto")', 'aria-checked') === 'true');
    await page.keyboard.press('Escape'); await wait(600);
  });
  await check('H', 'no runtime errors across the new scenarios', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
  const mobile = await newSession(browser, { viewport: { width: 390, height: 780 }, prefs: { 'aurora-listening': JSON.stringify(history) }, recommendations: radio });
  await mobile.page.goto(BASE); await wait(1500);
  await check('H', 'on a phone the page behind a sheet stays still too', async () => {
    await mobile.page.click('button[aria-label="Preferences"]:visible'); await wait(900);
    await mobile.page.mouse.move(195, 300); for (let i = 0; i < 5; i++) { await mobile.page.mouse.wheel(0, 400); await wait(80); }
    ok(await mobile.page.evaluate(() => document.scrollingElement.scrollTop) === 0);
    ok(await mobile.page.evaluate(() => getComputedStyle(document.querySelector('.sheet header')).position) === 'sticky', 'sticky sheet header');
  });
  await mobile.context.close();
}

// ── I: resilience — songs that can't play never stop the music ──
if (!only || only === 'I') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, unplayable: ['Morning Light'] });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Morning Light', 'Slow Tide']);
  await check('I', 'Next skips a song with no playable upload and keeps playing', async () => { await page.click('.dock-transport button[aria-label="Next track"]'); await wait(2200); ok((await title(page)).startsWith('Slow Tide'), await title(page)); });
  await check('I', 'a short notice says the song is skipped', async () => ok(/moved on|will be skipped/.test(await page.textContent('.toast').catch(() => ''))));
  await check('I', 'the skipped song is marked unavailable in the queue', async () => { await page.click('.dock-actions button[aria-label="Queue"], button[aria-label="Open queue"], .dock-actions button:has(svg.lucide-list-music)').catch(() => {}); await wait(900); ok(await page.locator('.track-row.is-unavailable').count() >= 1); await page.keyboard.press('Escape'); await wait(500); });
  await check('I', 'no runtime errors while skipping', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'I') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, prefs: { refused: JSON.stringify(['CCCCCCCCCCC']) } });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Slow Tide']);
  await check('I', 'a video YouTube refuses falls back to the next upload', async () => { await page.click('.dock-transport button[aria-label="Next track"]'); await wait(2500); const rows = await events(page); ok(rows.some(row => row[1] === 'refused' && row[2] === 'CCCCCCCCCCC') && rows.some(row => row[1] === 'load' && row[2] === 'EEEEEEEEEEE'), JSON.stringify(rows.filter(row => ['load', 'refused'].includes(row[1])).slice(-4))); ok((await title(page)).startsWith('Slow Tide')); });
  await check('I', 'no runtime errors on a refused video', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'I') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, prefs: { refused: JSON.stringify(['VVVVVVVVVV1']) } });
  await page.goto(BASE); await wait(500); await goSearch(page); await wait(400); await searchFor(page, 'band');
  await check('I', 'a refused video result searches for another upload of it', async () => { await page.click('.search-tabs [role=tab]:has-text("Videos")'); await wait(900); await page.click('.video-card >> nth=0'); await wait(2500); const rows = await events(page); ok(rows.some(row => row[1] === 'refused' && row[2] === 'VVVVVVVVVV1') && rows.some(row => row[1] === 'load' && row[2] === 'DDDDDDDDDDD'), JSON.stringify(rows.filter(row => ['load', 'refused'].includes(row[1])).slice(-4))); ok((await title(page)).includes('Night Drive'), await title(page)); });
  await check('I', 'no runtime errors on a refused video result', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'I') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, prefs: { refused: JSON.stringify(['VVVVVVVVVV1']) } });
  await page.goto(BASE); await wait(500); await goSearch(page); await wait(400); await searchFor(page, 'band');
  await page.route('**/api/video/search?*', route => route.fulfill({ status: 502, json: { error: 'down' } }));
  await check('I', 'a failed search for another upload stays retryable instead of skipping', async () => { await page.click('.search-tabs [role=tab]:has-text("Videos")'); await wait(900); await page.click('.video-card >> nth=0'); await wait(2500); const rows = await events(page); ok(!rows.some(row => row[1] === 'load' && row[2] === 'VVVVVVVVVV2'), JSON.stringify(rows.filter(row => ['load', 'refused'].includes(row[1])).slice(-4))); ok((await title(page)).includes('Night Drive'), await title(page)); ok(await page.locator('.track-row.is-unavailable').count() === 0); ok(/connect|retry/i.test(await page.textContent('.toast').catch(() => '')), await page.textContent('.toast').catch(() => 'no toast')); });
  await check('I', 'no runtime errors when the upload search fails', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'I') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, prefs: { 'aurora-dj': 'true' }, unplayable: ['Morning Light'] });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Morning Light', 'Slow Tide']); await wait(7500);
  await check('I', 'the DJ prepares the next playable song when one can\'t play', async () => { const load = (await events(page)).find(row => row[1] === 'load' && row[2] === 'CCCCCCCCCCC' && row[3] === true); ok(load, 'standby never loaded Slow Tide'); });
  await check('I', 'no runtime errors in a DJ queue with a gap', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'I') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, prefs: { 'aurora-dj': 'true' } });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Morning Light', 'Slow Tide']);
  await page.click('.dock-transport button[aria-label="Shuffle"]'); await wait(7500);
  await check('I', 'with shuffle on, the DJ still prepares the next song ahead', async () => { const load = (await events(page)).find(row => row[1] === 'load' && ['BBBBBBBBBBB', 'CCCCCCCCCCC'].includes(row[2]) && row[3] === true); ok(load, 'no muted standby load'); });
  await check('I', 'no runtime errors with shuffle and DJ', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

if (!only || only === 'I') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 } });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Morning Light', 'Slow Tide']);
  if (!(await page.locator('.immersive-player').count())) { await page.click('.dock-track'); await wait(1200); }
  const drag = async (dx, dy) => { const box = await page.locator('.now-playing-art').boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2; await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 6 }); await page.mouse.move(cx + dx, cy + dy, { steps: 6 }); await page.mouse.up(); };
  await check('I', 'swiping the cover left plays the next song', async () => { await drag(-190, 0); await wait(1500); ok((await title(page)).startsWith('Morning Light'), await title(page)); });
  await check('I', 'swiping the cover right goes back', async () => { await drag(190, 0); await wait(1500); ok((await title(page)).startsWith('Night Drive'), await title(page)); });
  await check('I', 'swiping the cover down closes the player', async () => { await drag(0, 180); await wait(1200); ok(await page.locator('.immersive-player').count() === 0); });
  await check('I', '← and → jump 5 s even while the timeline has focus', async () => {
    await page.focus('.dock-seek input[aria-label="Seek in track"]'); const before = await playerTime(page);
    await page.keyboard.press('ArrowRight'); await wait(400); const after = await playerTime(page);
    ok(after - before >= 4, `${before} → ${after}`);
  });
  await check('I', 'swiping a queue row left removes it', async () => {
    await page.click('button[aria-label="Open queue"]'); await wait(900);
    const count = await page.locator('.sheet .track-row').count();
    const row = await page.locator('.sheet .track-row:has-text("Slow Tide")').boundingBox();
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2); await page.mouse.down();
    await page.mouse.move(row.x + row.width / 2 - 90, row.y + row.height / 2, { steps: 5 }); await page.mouse.move(row.x + row.width / 2 - 200, row.y + row.height / 2, { steps: 5 }); await page.mouse.up();
    await wait(900);
    ok(await page.locator('.sheet .track-row').count() === count - 1 && await page.locator('.sheet .track-row:has-text("Slow Tide")').count() === 0);
    ok((await title(page)).startsWith('Night Drive'), 'the swipe did not play the row');
    await page.keyboard.press('Escape'); await wait(500);
  });
  await check('I', 'no runtime errors while swiping', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

if (!only || only === 'I') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 } });
  await page.goto(BASE); await wait(1500);
  await check('I', 'ten mood chips, in English', async () => { const labels = await page.locator('.mood-chips .mood-chip').allTextContents(); ok(labels.join('|') === 'Sad|Chill|Workout|Sleep|Energize|Romance|Feel good|Party|Commute|Focus', labels.join('|')); });
  await check('I', 'choosing a mood re-shapes the suggestions around it', async () => {
    await page.click('.mood-chip:has-text("Chill")'); await wait(1400);
    ok(await page.getAttribute('.mood-chip:has-text("Chill")', 'aria-pressed') === 'true');
    ok((await page.textContent('.stage-copy .feature-label')).includes('Chill'));
    ok((await page.textContent('.stage-copy h2, .stage-copy p')).length > 0);
    ok(await page.locator('.music-section h2:text-is("Chill")').count() === 1, 'Chill grid');
    ok(await page.locator('.mood-more').count() === 1, 'more chill shelf');
  });
  await check('I', 'another mood replaces it', async () => { await page.click('.mood-chip:has-text("Focus")'); await wait(1400); ok((await page.textContent('.stage-copy .feature-label')).includes('Focus')); ok(await page.getAttribute('.mood-chip:has-text("Chill")', 'aria-pressed') === 'false'); });
  await check('I', 'choosing the same mood again restores the default suggestions', async () => { await page.click('.mood-chip:has-text("Focus")'); await wait(1400); ok(!(await page.textContent('.stage-copy .feature-label')).includes('Focus')); ok(await page.locator('.mood-chip[aria-pressed="true"]').count() === 0); ok(await page.locator('.mood-more').count() === 0); });
  await check('I', 'no runtime errors with moods', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
  const phone = await newSession(browser, { viewport: { width: 360, height: 760 } });
  await phone.page.goto(BASE); await wait(1500);
  await check('I', 'on a phone the mood row scrolls sideways without moving the page', async () => {
    ok(await phone.page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), 'page overflows');
    ok(await phone.page.evaluate(() => { const row = document.querySelector('.mood-chips'); return row.scrollWidth > row.clientWidth; }), 'chips should scroll');
  });
  await phone.context.close();
}

if (!only || only === 'J') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 } });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Slow Tide']); await wait(1200);
  const seekInput = '.dock-seek input[aria-label="Seek in track"]';
  const tap = (value, order) => page.evaluate(([value, order, selector]) => {
    const input = document.querySelector(selector);
    const set = () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value)); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    if (order === 'touch') { input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); set(); } else { set(); input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }
  }, [value, order, seekInput]);
  await check('J', 'a tap on the timeline seeks and the slider keeps moving', async () => {
    await tap(20, 'touch'); await wait(300);
    const rows = await events(page); ok(rows.some(row => row[1] === 'seek' && Math.abs(row[3] - 20) < .2), 'no seek to 20');
    const first = await playerTime(page); await wait(1500); const later = await playerTime(page);
    ok(first >= 19.5 && later > first + .8, `slider stuck: ${first} → ${later}`);
  });
  await check('J', 'a click on the timeline seeks and the slider keeps moving', async () => {
    await tap(30, 'mouse'); await wait(300);
    const first = await playerTime(page); await wait(1500); const later = await playerTime(page);
    ok(first >= 29.5 && later > first + .8, `slider stuck: ${first} → ${later}`);
  });
  await check('J', 'a drag released outside the timeline still seeks and resumes', async () => {
    await page.evaluate(selector => { const input = document.querySelector(selector); input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '12'); input.dispatchEvent(new Event('input', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }, seekInput);
    await wait(300); const first = await playerTime(page); await wait(1500); const later = await playerTime(page);
    ok(first >= 11.5 && first < 20 && later > first + .8, `slider stuck: ${first} → ${later}`);
  });
  await check('J', 'changing song mid-drag leaves the slider following the new song', async () => {
    await page.evaluate(selector => { const input = document.querySelector(selector); input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '40'); input.dispatchEvent(new Event('input', { bubbles: true })); }, seekInput);
    await page.evaluate(() => document.querySelector('.dock-transport button[aria-label="Next track"]').click());
    await wait(1800); const first = await playerTime(page); await wait(1200); const later = await playerTime(page);
    ok((await title(page)).startsWith('Slow Tide'), await title(page));
    ok(first < 5 && later > first + .5, `slider not following the new song: ${first} → ${later}`);
  });
  await check('J', 'no runtime errors on the timeline', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'J') {
  // Phones: the home carousel follows a swipe; a swipe never plays a song by accident.
  const { context, page, errors } = await newSession(browser, { viewport: { width: 390, height: 844 } });
  await page.goto(BASE); await wait(1800);
  const counter = () => page.evaluate(() => document.querySelector('.stage-navigation span')?.textContent?.slice(0, 2));
  const swipe = async (from, to) => { const box = await page.locator('.cover-carousel').boundingBox(); const y = box.y + box.height / 2; await page.mouse.move(box.x + box.width * from, y); await page.mouse.down(); await page.mouse.move(box.x + box.width * ((from + to) / 2), y + 3, { steps: 4 }); await page.mouse.move(box.x + box.width * to, y + 4, { steps: 4 }); await page.mouse.up(); await wait(900); };
  const start = await counter();
  await check('J', 'swiping the home carousel left shows the next song', async () => { await swipe(0.8, 0.25); ok(await counter() === String(Number(start) + 1).padStart(2, '0'), `${start} → ${await counter()}`); });
  await check('J', 'swiping right goes back', async () => { await swipe(0.25, 0.8); ok(await counter() === start, `${start} → ${await counter()}`); });
  await check('J', 'a swipe never starts playback', async () => ok(await page.locator('.immersive-player').count() === 0 && !(await page.evaluate(() => (window.__events || []).some(row => row[1] === 'load')))));
  await check('J', 'no runtime errors swiping the carousel', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'J') {
  // The queue grows from what is heard, and never with another version of a queued song.
  const rec = (id, title, artist = 'Other Band') => ({ id, title, artist, album: 'LP', artwork: 'https://img.test/c/r.jpg', duration: 60, recommended: true });
  const recommendations = [rec('r1', 'Night Drive (Sousa Remix)', 'BAND x Friend'), rec('r2', 'Slow Tide [Ultra Records]'), rec('r3', 'Harbour Lights'), rec('r4', 'NIGHT DRIVE (YUMA REMIX)'), rec('r5', 'Glass City'), rec('r6', 'Paper Moons')];
  const { context, page, errors, requests } = await newSession(browser, { viewport: { width: 1280, height: 800 }, prefs: { 'aurora-autoplay': 'true' }, recommendations });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Morning Light', 'Slow Tide']); await wait(1500);
  const asked = () => requests.filter(url => url.includes('/api/recommendations')).length;
  // The opening refill already seeded from the first song; the next song heard grows it.
  await page.click('.dock-transport button[aria-label="Next track"]'); await wait(1500);
  const before = asked();
  await setSeek(page, 27); await wait(2500);
  await check('J', 'hearing a song for a while asks for more like it', async () => ok(asked() > before, `requests before ${before}, after ${asked()}`));
  await page.click('.dock-actions button:has(svg.lucide-list-music), button[aria-label="Queue"], button[aria-label="Open queue"]').catch(() => {}); await wait(900);
  const rows = await page.locator('dialog .track-row strong, dialog .track-row .track-title').allTextContents();
  await check('J', 'a song heard for a while adds more like it to the queue', async () => ok(rows.some(text => /Harbour Lights|Glass City|Paper Moons/.test(text)), JSON.stringify(rows)));
  await check('J', 'the queue never adds another version of a queued song', async () => ok(!rows.some(text => /Remix|Ultra Records/i.test(text)), JSON.stringify(rows)));
  await check('J', 'no runtime errors while the queue grows', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'J') {
  // Phones: the screen stays awake while music plays, and the lock screen shows a full player.
  const { context, page, errors } = await newSession(browser, { viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    window.__locks = { taken: 0, released: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { window.__locks.taken++; const listeners = []; return { released: false, addEventListener: (_, fn) => listeners.push(fn), release: async () => { window.__locks.released++; listeners.forEach(fn => fn()); } }; } } });
  });
  await page.goto(BASE); await wait(500);
  await page.click('nav[aria-label="Mobile navigation"] button:has-text("Search")'); await wait(400); await searchFor(page, 'band'); await page.click('.top-result-play'); await wait(1800);
  await check('J', 'the screen stays awake while a song plays', async () => ok((await page.evaluate(() => window.__locks)).taken >= 1, JSON.stringify(await page.evaluate(() => window.__locks))));
  await check('J', 'the lock-screen player shows the song with sized artwork', async () => {
    const meta = await page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, sizes: (navigator.mediaSession.metadata?.artwork || []).map(item => item.sizes), state: navigator.mediaSession.playbackState }));
    ok(meta.title === 'Night Drive' && meta.sizes.includes('512x512') && meta.state === 'playing', JSON.stringify(meta));
  });
  await check('J', 'pausing lets the screen sleep again', async () => { await page.evaluate(() => document.querySelector('.dock-transport button[aria-label="Pause"], button[aria-label="Pause"]')?.click()); await wait(700); const locks = await page.evaluate(() => window.__locks); ok(locks.released >= 1, JSON.stringify(locks)); });
  await check('J', 'no runtime errors with the lock-screen player', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'J') {
  // After a DJ hand-over the incoming lyrics keep following the incoming song.
  const { context, page, errors } = await djSession({ 'aurora-live-dj': 'true' }, { longIntro: true });
  await page.click('button[aria-label="Show lyrics"]').catch(() => {});
  await wait(7000); await setSeek(page, 31);
  // Watch the outgoing lyrics while they fade: they must hold their last line, not
  // follow the incoming song's clock.
  await page.evaluate(() => {
    window.__outgoing = [];
    const watch = () => {
      const outgoing = [...document.querySelectorAll('.lyrics-handover')].find(node => node.textContent.includes('Under') && !node.textContent.includes('Sunrise'));
      if (outgoing && document.querySelectorAll('.lyrics-handover').length > 1) window.__outgoing.push((outgoing.querySelector('.lyric-line.current')?.textContent || '').replace(/\s/g, '') + '#' + [...outgoing.querySelectorAll('.word-fill')].map(node => Math.round(Number(node.style.getPropertyValue('--fill') || 0) * 10)).join(''));
      if (performance.now() < window.__watchUntil) requestAnimationFrame(watch);
    };
    window.__watchUntil = performance.now() + 20000;
    requestAnimationFrame(watch);
  });
  for (let i = 0; i < 40 && !(await title(page)).startsWith('Morning Light'); i++) await wait(300);
  const seen = [];
  for (let i = 0; i < 28; i++) { seen.push([Math.round(await playerTime(page)), await page.textContent('.desktop-lyrics .lyric-line.current').catch(() => '')]); await wait(500); }
  await check('J', 'lyrics keep moving after a DJ hand-over', async () => {
    const lines = [...new Set(seen.map(([, text]) => text).filter(Boolean))];
    ok(lines.length >= 2, JSON.stringify(seen));
    ok(lines.some(text => /Sunrise|Waking|Morning/.test(text)), JSON.stringify(lines));
  });
  await check('J', 'outgoing lyrics hold still while they fade out', async () => { const frames = await page.evaluate(() => window.__outgoing); ok(frames.length > 0, 'no overlap observed'); ok(new Set(frames).size === 1, JSON.stringify([...new Set(frames)])); });
  await check('J', 'no runtime errors through the lyric hand-over', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'J') {
  // Seeking into the marked blend region re-plans the blend from there instead of fading out.
  const { context, page, errors } = await djSession({ 'aurora-live-dj': 'true' });
  // Before the standby has been prepared (it primes from 6 s here, 90 s ahead in a long song).
  ok(!(await events(page)).some(row => row[1] === 'load' && row[2] === 'BBBBBBBBBBB'), 'standby already primed');
  // Land inside the marked zone: its label reads "DJ transition from m:ss to m:ss".
  await setSeek(page, 45); await wait(400);
  const zoneLabel = await page.getAttribute('.dock-seek .dj-seek-zone', 'aria-label');
  const [zoneStart] = [...zoneLabel.matchAll(/(\d+):(\d+)/g)].map(m => Number(m[1]) * 60 + Number(m[2]));
  await setSeek(page, zoneStart + 1.5);
  const mark = await page.evaluate(() => performance.now());
  await check('J', 'seeking into the DJ zone still blends into the next song', async () => {
    await wait(6500);
    const rows = await events(page);
    ok(rows.some(row => row[1] === 'play' && row[2] === 'BBBBBBBBBBB' && row[0] > mark), JSON.stringify(rows.filter(row => row[0] > mark).slice(0, 8)));
    ok((await title(page)).startsWith('Morning Light'), await title(page));
  });
  await check('J', 'both songs overlap after a seek into the zone', async () => { await wait(4000); const vols = await page.evaluate(m => window.__vols.filter(v => v[0] > m), mark); const a = vols.filter(v => v[1] === 'AAAAAAAAAAA' && v[2] > 5 && v[2] < 75); const b = vols.filter(v => v[1] === 'BBBBBBBBBBB' && v[2] > 5 && v[2] < 75); ok(a.length > 3 && b.length > 3, `A:${a.length} B:${b.length}`); });
  await check('J', 'no runtime errors seeking into the zone', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'J') {
  // Opening and closing the player repeatedly stays cheap: no forced scroll layout,
  // no artwork re-decoding, never more than one player on screen.
  const { context, page, errors } = await newSession(browser, { viewport: { width: 390, height: 844 } });
  await page.goto(BASE); await wait(500);
  await page.click('nav[aria-label="Mobile navigation"] button:has-text("Search")'); await wait(400); await searchFor(page, 'band'); await page.click('.top-result-play'); await wait(1500);
  await page.evaluate(() => {
    window.__scrolls = 0; window.__decodes = 0; window.__maxOpen = 0;
    const scroll = window.scrollTo; window.scrollTo = (...args) => { window.__scrolls++; return scroll.apply(window, args); };
    const read = CanvasRenderingContext2D.prototype.getImageData; CanvasRenderingContext2D.prototype.getImageData = function (...args) { window.__decodes++; return read.apply(this, args); };
    const watch = () => { window.__maxOpen = Math.max(window.__maxOpen, document.querySelectorAll('.immersive-player').length); if (!window.__stop) requestAnimationFrame(watch); }; requestAnimationFrame(watch);
  });
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await wait(120);
    await page.evaluate(() => document.querySelector('.dock-track')?.click()); await wait(120);
  }
  await wait(1200);
  const probe = await page.evaluate(() => { window.__stop = true; return { scrolls: window.__scrolls, decodes: window.__decodes, maxOpen: window.__maxOpen }; });
  await check('J', 'spamming open/close forces no scroll layout', async () => ok(probe.scrolls === 0, JSON.stringify(probe)));
  await check('J', 'spamming open/close never re-decodes artwork colours', async () => ok(probe.decodes === 0, JSON.stringify(probe)));
  await check('J', 'spamming open/close never stacks two players', async () => ok(probe.maxOpen === 1, JSON.stringify(probe)));
  await check('J', 'no runtime errors while spamming the player', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

if (!only || only === 'K') {
  // Changing song by hand never leaves silence: the playing song keeps sounding until
  // the new one plays, then fades out under it.
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 } });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Morning Light']); await wait(1500);
  const mark = await page.evaluate(() => performance.now());
  await page.click('.dock-transport button[aria-label="Next track"]'); await wait(2600);
  const rows = (await events(page)).filter(row => row[0] > mark);
  const vols = await page.evaluate(m => window.__vols.filter(v => v[0] > m), mark);
  const startB = rows.find(row => row[1] === 'load' && row[2] === 'BBBBBBBBBBB');
  const silencedA = rows.find(row => (row[1] === 'stop' || row[1] === 'pause') && row[2] === 'AAAAAAAAAAA');
  await check('K', 'the new song is playing', async () => ok((await title(page)).startsWith('Morning Light') && startB, JSON.stringify(rows.slice(0, 8))));
  await check('K', 'a manual change never cuts the playing song before the new one sounds', async () => ok(!silencedA || silencedA[0] > startB[0] + 250, JSON.stringify(rows.slice(0, 10))));
  await check('K', 'the old song fades out under the new one', async () => { const a = vols.filter(v => v[1] === 'AAAAAAAAAAA' && v[2] > 0 && v[2] < 75); const b = vols.filter(v => v[1] === 'BBBBBBBBBBB' && v[2] > 0 && v[2] < 75); ok(a.length >= 3 && b.length >= 3, `A:${a.length} B:${b.length}`); });
  await check('K', 'the old song is stopped once the fade completes', async () => ok(silencedA, 'old deck still running'));
  await check('K', 'no runtime errors on a gapless change', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}
if (!only || only === 'K') {
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 } });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Morning Light', 'Slow Tide']); await wait(1500);
  const mark = await page.evaluate(() => performance.now());
  await page.evaluate(() => { const next = document.querySelector('.dock-transport button[aria-label="Next track"]'); next.click(); setTimeout(() => next.click(), 80); });
  await wait(2800);
  const rows = (await events(page)).filter(row => row[0] > mark);
  const startC = rows.find(row => row[1] === 'load' && row[2] === 'CCCCCCCCCCC');
  const silencedA = rows.find(row => (row[1] === 'stop' || row[1] === 'pause') && row[2] === 'AAAAAAAAAAA');
  await check('K', 'skipping twice in a row lands on the right song', async () => ok((await title(page)).startsWith('Slow Tide') && startC, `${await title(page)} ${JSON.stringify(rows.slice(0, 10))}`));
  await check('K', 'skipping twice keeps the first song sounding until the last one plays', async () => ok(!silencedA || silencedA[0] > startC[0] + 250, JSON.stringify(rows.slice(0, 12))));
  // Pause while a change is still crossing: neither deck may keep playing.
  await page.evaluate(() => { document.querySelector('.dock-transport button[aria-label="Previous track"]').click(); });
  await wait(700);
  await page.evaluate(() => document.querySelector('.dock-transport button[aria-label="Pause"]')?.click()); await wait(1500);
  await check('K', 'pausing mid-change leaves no deck playing', async () => {
    const audible = await page.evaluate(() => [...document.querySelectorAll('.yt-deck iframe, iframe')].length && (window.__events || []).reduce((state, row) => { if (['play', 'load'].includes(row[1])) state[row[2]] = 'on'; if (['pause', 'stop'].includes(row[1])) state[row[2]] = 'off'; return state; }, {}));
    ok(Object.entries(audible).every(([, state]) => state === 'off'), JSON.stringify(audible));
  });
  await check('K', 'no runtime errors while skipping fast', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

if (!only || only === 'K') {
  // Best parts open the backdrop up with the lyrics shown too, on desktop and phone.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const phone = viewport.width < 500;
    const { context, page, errors } = await newSession(browser, { viewport });
    await page.goto(BASE); await wait(500);
    if (phone) { await page.click('nav[aria-label="Mobile navigation"] button:has-text("Search")'); await wait(400); await searchFor(page, 'band'); await page.click('.top-result-play'); await wait(1500); await page.click('.player-pills button:has-text("Lyrics")'); }
    else { await startQueue(page, []); await page.click('button[aria-label="Show lyrics"]'); }
    await wait(1200);
    const look = () => page.evaluate(() => { const veil = document.querySelector('.player-veil'); const art = document.querySelector('.player-art-background'); return { peak: veil?.classList.contains('is-peak'), veil: Number(getComputedStyle(veil).opacity), vignette: Number(getComputedStyle(veil, '::after').opacity), light: Number(getComputedStyle(veil, '::before').opacity), art: Number(getComputedStyle(art).opacity), lyrics: !!document.querySelector('.with-lyrics .desktop-lyrics, .immersive-player.with-lyrics') }; });
    await setSeek(page, 12); await wait(4000); const calm = await look();
    await setSeek(page, 26.1); await wait(2600); const peak = await look();
    const name = phone ? 'phone' : 'desktop';
    await check('K', `${name}: with lyrics shown, a best part is detected`, async () => ok(calm.lyrics && !calm.peak && peak.peak, JSON.stringify({ calm, peak })));
    await check('K', `${name}: with lyrics shown, a best part brightens and adds contrast`, async () => ok(peak.veil < calm.veil - 0.1 && peak.vignette > calm.vignette + 0.3 && peak.light > calm.light && peak.art > calm.art, JSON.stringify({ calm, peak })));
    await check('K', `${name}: no runtime errors at best parts`, async () => ok(!errors.length, errors.join(' | ')));
    await context.close();
  }
}

if (!only || only === 'K') {
  // Loudness: Quiet / Normal / Loud scale what every deck plays; the slider keeps the listener's own volume.
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 } });
  await page.goto(BASE); await wait(500); await startQueue(page, []); await wait(1500);
  const lastVolume = () => page.evaluate(() => window.__vols.filter(v => v[1] === 'AAAAAAAAAAA').at(-1)?.[2]);
  const choose = async label => { await page.evaluate(() => document.querySelector('button[aria-label="Preferences"]')?.click()); await wait(800); await page.click(`[role="radiogroup"][aria-label="Loudness"] button:has-text("${label}")`); await wait(400); await page.keyboard.press('Escape'); await wait(500); };
  await check('K', 'Normal leaves a little headroom', async () => ok(await lastVolume() === 68, String(await lastVolume())));
  await check('K', 'Quiet plays softer at the same slider position', async () => { await choose('Quiet'); ok(await lastVolume() === 44, String(await lastVolume())); ok(await page.inputValue('input[aria-label="Volume"]') === '80'); });
  await check('K', 'Loud plays at full level', async () => { await choose('Loud'); ok(await lastVolume() === 80, String(await lastVolume())); });
  await check('K', 'the loudness choice is remembered', async () => { await page.reload(); await wait(1200); await page.evaluate(() => document.querySelector('button[aria-label="Preferences"]')?.click()); await wait(800); ok(await page.getAttribute('[role="radiogroup"][aria-label="Loudness"] button:has-text("Loud")', 'aria-checked') === 'true'); });
  await check('K', 'no runtime errors changing loudness', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

if (!only || only === 'K') {
  // The queue reads like a set list.
  const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, prefs: { 'aurora-autoplay': 'false' } });
  await page.goto(BASE); await wait(500); await startQueue(page, ['Morning Light', 'Slow Tide']); await wait(1200);
  await page.click('.dock-transport button[aria-label="Next track"]'); await wait(1500);
  const openQueue = async () => { await page.click('.dock-actions button:has(svg.lucide-list-music), button[aria-label="Queue"], button[aria-label="Open queue"]').catch(() => {}); await wait(900); };
  await openQueue();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/queue-desktop.png` });
  const sections = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('dialog .queue-section')].map(node => [node.getAttribute('aria-label') || 'Played', [...node.querySelectorAll('.track-row strong')].map(n => n.textContent)])));
  await check('K', 'the queue shows what plays now, next and before', async () => { const view = await sections(); ok(view['Now playing']?.[0] === 'Morning Light' && view['Up next']?.[0] === 'Slow Tide', JSON.stringify(view)); ok(await page.locator('dialog details.queue-played').count() === 1); });
  await check('K', 'up next tells its length', async () => ok(/1 song · \d+ min/.test(await page.textContent('dialog .queue-section[aria-label="Up next"] .queue-heading small')), await page.textContent('dialog .queue-section[aria-label="Up next"] .queue-heading small')));
  await check('K', 'removing a song from up next removes that song, not another', async () => { await page.click('dialog .queue-section[aria-label="Up next"] button[aria-label="Remove Slow Tide from queue"]'); await wait(600); const view = await sections(); ok(!JSON.stringify(view).includes('Slow Tide') && view['Now playing']?.[0] === 'Morning Light', JSON.stringify(view)); });
  await check('K', 'no runtime errors in the queue', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

if (!only || only === 'L') {
  // 100 unexpected actions (50 desktop, 50 phone), seeded so a failure replays exactly.
  // After every action the app must stay consistent.
  let seed = Number(process.env.SEED || 7);
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = list => list[Math.floor(random() * list.length)];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const phone = viewport.width < 500;
    const name = phone ? 'phone' : 'desktop';
    const { context, page, errors } = await newSession(browser, { viewport, prefs: { 'aurora-autoplay': 'false' } });
    await page.goto(BASE); await wait(600);
    if (phone) { await page.click('nav[aria-label="Mobile navigation"] button:has-text("Search")'); await wait(400); await searchFor(page, 'band'); for (const song of ['Morning Light', 'Slow Tide']) await page.click(`.search-results .track-row:has-text("${song}") button[aria-label^="Add"]`).catch(() => {}); await page.click('.top-result-play'); await wait(1200); }
    else { await startQueue(page, ['Morning Light', 'Slow Tide']); await wait(1000); }
    const click = selector => page.locator(`${selector} >> visible=true`).first().click({ timeout: 900 }).then(() => true, () => false);
    const key = code => page.keyboard.press(code).catch(() => {});
    const actions = {
      next: () => click('button[aria-label="Next track"]'),
      previous: () => click('button[aria-label="Previous track"]'),
      playPause: () => click('button[aria-label="Pause"], button[aria-label="Play"]'),
      seek: () => setSeek(page, Math.round(random() * 55)).catch(() => {}),
      arrows: () => key(pick(['ArrowLeft', 'ArrowRight'])),
      space: () => key('Space'),
      openPlayer: () => click('.dock-track'),
      escape: () => key('Escape'),
      lyrics: () => click('button[aria-label="Show lyrics"], button[aria-label="Hide lyrics"], .player-pills button'),
      queue: () => click('.dock-actions button:has(svg.lucide-list-music), button[aria-label="Queue"], button[aria-label="Open queue"], .player-pills button:has-text("Queue")'),
      removeFromQueue: () => click('dialog button[aria-label^="Remove"]'),
      settings: () => click('button[aria-label="Preferences"]'),
      loudness: () => click(`[aria-label="Loudness"] button:nth-child(${1 + Math.floor(random() * 3)})`),
      search: async () => { if (phone) await click('nav[aria-label="Mobile navigation"] button:has-text("Search")'); else await click('nav[aria-label="Main navigation"] button[aria-label="Search"]'); await page.fill('input[aria-label="Search songs or artists"]', pick(['band', 'night', 'φω', 'zz', ''])).catch(() => {}); },
      home: () => phone ? click('nav[aria-label="Mobile navigation"] button:has-text("Listen")') : click('nav[aria-label="Main navigation"] button[aria-label="Listen"], nav[aria-label="Main navigation"] button:first-child'),
      mood: () => click(`.mood-chip:nth-child(${1 + Math.floor(random() * 10)})`),
      carousel: () => click(pick(['button[aria-label="Next featured track"]', 'button[aria-label="Previous featured track"]'])),
      sidebar: () => phone ? Promise.resolve() : click('button[aria-label="Minimize sidebar"], button[aria-label="Expand sidebar"]'),
      resize: () => page.setViewportSize(phone ? pick([{ width: 390, height: 844 }, { width: 360, height: 740 }, { width: 430, height: 932 }]) : pick([{ width: 1280, height: 800 }, { width: 1024, height: 700 }, { width: 1440, height: 900 }])),
      doubleTap: async () => { await click('.dock-track'); await click('.dock-track'); },
    };
    const names = Object.keys(actions);
    const problems = [];
    const log = [];
    for (let step = 0; step < 50; step++) {
      const action = pick(names);
      log.push(action);
      try { await actions[action](); } catch (error) { problems.push(`${step}:${action} threw ${String(error.message).slice(0, 80)}`); }
      await wait(320);
      const state = await page.evaluate(() => {
        const decks = (window.__events || []).reduce((map, row) => { if (['play', 'load'].includes(row[1])) map[row[2]] = 'on'; if (['pause', 'stop'].includes(row[1])) map[row[2]] = 'off'; return map; }, {});
        const seekInput = document.querySelector('input[aria-label="Seek in track"]');
        return {
          players: document.querySelectorAll('.immersive-player').length,
          sheets: document.querySelectorAll('dialog[open]').length,
          overflow: document.scrollingElement.scrollWidth - innerWidth,
          seekOk: !seekInput || (Number(seekInput.value) >= 0 && Number(seekInput.value) <= Number(seekInput.max) + 0.5),
          decksOn: Object.values(decks).filter(value => value === 'on').length,
          titleOk: !document.querySelector('.dock-track strong') || [...document.querySelectorAll('.dock-track strong')].some(node => document.title.startsWith(node.textContent.trim())) || document.title === 'Aurora',
        };
      });
      if (state.players > 1) problems.push(`${step}:${action} two players`);
      if (state.sheets > 1) problems.push(`${step}:${action} two sheets`);
      if (state.overflow > 1) problems.push(`${step}:${action} page overflows by ${state.overflow}px`);
      if (!state.seekOk) problems.push(`${step}:${action} seek out of range`);
      if (state.decksOn > 2) problems.push(`${step}:${action} ${state.decksOn} decks sounding`);
      if (!state.titleOk) problems.push(`${step}:${action} title out of sync`);
      if (process.env.SHOTS && step % 10 === 9) await page.screenshot({ path: `${process.env.SHOTS}/fuzz-${name}-${step + 1}.png` });
    }
    await wait(2200);
    const settled = await page.evaluate(() => Object.values((window.__events || []).reduce((map, row) => { if (['play', 'load'].includes(row[1])) map[row[2]] = 'on'; if (['pause', 'stop'].includes(row[1])) map[row[2]] = 'off'; return map; }, {})).filter(value => value === 'on').length);
    await check('L', `${name}: 50 random actions keep the app consistent`, async () => ok(!problems.length, `${problems.slice(0, 6).join(' | ')} — actions: ${log.join(',')}`));
    await check('L', `${name}: once settled, at most one song sounds`, async () => ok(settled <= 1, `${settled} decks on — actions: ${log.join(',')}`));
    await check('L', `${name}: no runtime errors in 50 random actions`, async () => ok(!errors.length, `${errors.slice(0, 3).join(' | ')} — actions: ${log.join(',')}`));
    await context.close();
  }
}

// ── M: lyrics focus — only the cover, the song's name and its lyrics ──────
if (!only || only === 'M') {
  const visible = (page, selector) => page.evaluate(selector => { const node = document.querySelector(selector); if (!node) return false; const style = getComputedStyle(node); const box = node.getBoundingClientRect(); return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.5 && box.width > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth; }, selector);
  const focusView = async (page, label) => {
    const state = {};
    for (const [key, selector] of Object.entries({ cover: page.viewportSize().width <= 760 ? '.focus-thumb img' : '.now-playing-art', lyrics: '.desktop-lyrics .lyric-line.current', exit: '.focus-exit', topbar: '.player-topbar', dock: '.player-dock', sidebar: '.sidebar', chips: '.immersive-track-meta .meta-chips' })) state[key] = await visible(page, selector);
    state.title = await page.evaluate(() => [...document.querySelectorAll('.immersive-track-meta h1, .mobile-player-info h1, .focus-title h1')].some(node => { const box = node.getBoundingClientRect(); return getComputedStyle(node).display !== 'none' && box.width > 0 && box.top >= 0 && box.bottom <= innerHeight; }));
    state.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    state.subdued = await page.evaluate(() => { const node = document.querySelector('.mode-switch'); const style = node && getComputedStyle(node); return !!style && Number(style.opacity) < .6 && style.filter.includes('grayscale') && Number(style.scale) < 1; });
    state.rects = await page.evaluate(() => Object.fromEntries(['.now-playing-art', '.immersive-track-meta', '.mobile-player-info', '.desktop-lyrics', '.player-topbar'].map(selector => { const node = document.querySelector(selector); const box = node?.getBoundingClientRect(); return [selector, box && `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)} ${getComputedStyle(node).display}`]; })));
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/focus-${label}.png` });
    return state;
  };
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['laptop', { width: 1280, height: 720 }], ['phone', { width: 390, height: 844 }], ['phone-landscape', { width: 844, height: 390 }], ['tablet', { width: 820, height: 1180 }]]) {
    const { context, page, errors } = await newSession(browser, { viewport });
    await page.goto(BASE); await wait(1500);
    await startQueue(page); await wait(1200);
    if (!await page.locator('.immersive-player').count()) { await page.click('.dock-track'); await wait(1000); }
    await setSeek(page, 10.5); await wait(600);
    await check('M', `${label}: the focus button opens lyrics focus`, async () => { await page.click('button[aria-label="Lyrics focus"]'); await wait(180); if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/focus-${label}-glide.png` }); await wait(1120); const state = await focusView(page, label); ok(state.cover && state.lyrics && state.title && state.exit && state.topbar && state.subdued && !state.dock && !state.sidebar && !state.chips && state.overflow <= 0, JSON.stringify(state)); });
    await check('M', `${label}: lyrics keep following the song in focus`, async () => { await setSeek(page, 13.1); await wait(1500); ok((await page.textContent('.lyric-line.current')).length > 0); });
    await check('M', `${label}: Escape leaves focus but keeps the player open`, async () => { await page.keyboard.press('Escape'); await wait(900); ok(await page.locator('.immersive-player').count() === 1 && await page.locator('.focus-exit').count() === 0 && await visible(page, '.player-topbar')); });
    await check('M', `${label}: I toggles focus, and Exit focus brings everything back`, async () => { await page.keyboard.press('i'); await wait(1100); ok(await visible(page, '.focus-exit')); await page.click('.focus-exit'); await wait(1100); ok(await visible(page, '.player-topbar') && !(await page.locator('.focus-exit').count())); if (viewport.width > 760) ok(await visible(page, '.player-dock') && await visible(page, '.sidebar')); });
    await check('M', `${label}: the video toggle stays reachable in focus and hands the stage to the video`, async () => { await page.keyboard.press('i'); await wait(1000); const toggle = page.locator('button[aria-label="Video mode"]'); ok(await toggle.isVisible() && await toggle.isEnabled()); await toggle.click(); await wait(1100); ok(await page.locator('.focus-exit').count() === 0 && await page.locator('.immersive-player.with-video').count() === 1); await page.click('button[aria-label="Artwork mode"]'); await wait(900); ok(await page.locator('.immersive-player.with-video').count() === 0); });
    await check('M', `${label}: closing the player never reopens it in focus`, async () => { await page.keyboard.press('i'); await wait(900); await page.keyboard.press('Escape'); await wait(400); await page.keyboard.press('Escape'); await wait(1000); ok(await page.locator('.immersive-player').count() === 0); await page.keyboard.press('l'); await wait(1300); ok(await page.locator('.focus-exit').count() === 0); });
    await check('M', `${label}: no runtime errors`, async () => ok(!errors.length, errors.join(' | ')));
    await context.close();
  }
}

// ── N: best parts from the music itself — listener replays and the beat ──
if (!only || only === 'N') {
  // Night Drive runs 60 s; listeners replay 40–52 s, past its last refrain.
  const heatmap = (from, to, length = 60) => Array.from({ length: length / 2 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, score: i * 2 >= from && i * 2 < to ? 1 : 0.2 }));
  for (const [label, replays, expect] of [
    ['most replayed', () => heatmap(40, 52), [39.4, 41]],
    ['replays from another upload are ignored', () => heatmap(40, 52, 200), [24, 27]],
  ]) {
    const tempoLog = [];
    const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, replays, tempoLog });
    await page.goto(BASE); await wait(1500);
    await startQueue(page); await wait(1500);
    if (!await page.locator('.immersive-player').count()) { await page.click('.dock-track'); await wait(1000); }
    await check('N', `${label}: the analysis asks for the video that is playing`, async () => ok(tempoLog.some(search => /video=[\w-]{11}/.test(search)), tempoLog.join(' ')));
    await check('N', `${label}: Best part jumps to ${expect[0] > 30 ? 'the replayed section' : 'the refrain'}`, async () => {
      await page.click('.immersive-track-meta .best-part-chip'); await wait(900);
      const t = await playerTime(page); ok(t >= expect[0] && t <= expect[1], String(t));
    });
    if (expect[0] > 30) {
      await check('N', `${label}: the replayed section lights the backdrop and the timeline`, async () => {
        await setSeek(page, 46); await wait(700);
        ok(await page.locator('.player-art-background.is-peak').count() === 1, 'no peak at 46 s');
        const marks = await page.locator('.seek-track .peak-mark').count(); ok(marks >= 2, `${marks} marks`);
      });
      await check('N', `${label}: the peak lasts whole bars at 120 BPM`, async () => {
        await setSeek(page, 50.6); await wait(400); // 40 s + six 2 s bars ends at 52 s; sampled inside the last bar
        ok(await page.locator('.player-art-background.is-peak').count() === 1, 'peak ended before its last bar');
        await setSeek(page, 53); await wait(900);
        ok(await page.locator('.player-art-background.is-peak').count() === 0, 'peak runs past its last bar');
      });
    }
    await check('N', `${label}: no runtime errors`, async () => ok(!errors.length, errors.join(' | ')));
    await context.close();
  }
}

// ── P: smoothness profile — phone size, 4× CPU slowdown, every frame timed ──
if (only === 'P') {
  for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    const { context, page, errors } = await newSession(browser, { viewport });
    await page.goto(BASE); await wait(1500);
    await startQueue(page); await wait(1500);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // Frame gaps and long tasks for one interaction: p95 gap, frames over 25 ms and the worst gap.
    const profile = async (name, act, seconds = 3) => {
      await page.evaluate(() => {
        window.__gaps = []; window.__long = 0; let last = performance.now();
        const tick = now => { window.__gaps.push(now - last); last = now; if (window.__profiling) requestAnimationFrame(tick); };
        window.__profiling = true; requestAnimationFrame(tick);
        try { new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__long += entry.duration; }).observe({ type: 'longtask' }); } catch { /* unsupported */ }
      });
      const cpu = process.env.PROFILE && name.startsWith(process.env.PROFILE) && !process.env.TRACE;
      const timeline = process.env.TRACE && name.startsWith(process.env.TRACE);
      const traceEvents = [];
      if (timeline) {
        cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
        await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
      }
      if (cpu) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
      await act(); await wait(seconds * 1000);
      if (timeline) {
        const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end'); await done;
        // Main-thread time per event type (complete events only, top level by name).
        const main = traceEvents.find(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
        const totals = new Map();
        for (const event of traceEvents) if (event.ph === 'X' && event.dur && (!main || (event.pid === main.pid && event.tid === main.tid))) totals.set(event.name, (totals.get(event.name) || 0) + event.dur / 1000);
        console.log(`TRACE ${label} ${name}\n` + [...totals].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([key, ms]) => `  ${ms.toFixed(0).padStart(6)} ms  ${key}`).join('\n'));
      }
      if (cpu) {
        const { profile: trace } = await cdp.send('Profiler.stop');
        const self = new Map(), byId = new Map(trace.nodes.map(node => [node.id, node]));
        const dt = trace.timeDeltas; trace.samples.forEach((id, i) => { const node = byId.get(id); const f = node.callFrame; const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000); });
        // Inclusive time per app component: which of ours re-rendered, and for how long.
        const parent = new Map(); trace.nodes.forEach(node => (node.children || []).forEach(child => parent.set(child, node.id)));
        const inclusive = new Map();
        trace.samples.forEach((id, i) => { const seen = new Set(); for (let at = id; at; at = parent.get(at)) { const f = byId.get(at).callFrame; if (!/\/src\//.test(f.url)) continue; const key = `${f.functionName || '(anon)'} ${f.url.split('/src/').pop().split('?')[0]}:${f.lineNumber}`; if (seen.has(key)) continue; seen.add(key); inclusive.set(key, (inclusive.get(key) || 0) + (dt[i] || 0) / 1000); } });
        // Line-level self time inside app modules (dev server only): what each render spends on.
        const lines = new Map();
        for (const node of trace.nodes) { const f = node.callFrame; if (!/\/src\//.test(f.url)) continue; for (const tick of node.positionTicks || []) { const key = `${f.url.split('?')[0]}#${tick.line}`; lines.set(key, (lines.get(key) || 0) + tick.ticks); } }
        // Who creates the elements: element-creation time attributed to its caller.
        if (process.env.CALLERS) {
          const callers = new Map();
          trace.samples.forEach((id, i) => { const node = byId.get(id); if (!/^(exports\.)?(jsxDEV|jsx|jsxs|createElement)$/.test(node.callFrame.functionName)) return; let at = parent.get(id); while (at && !/\/src\//.test(byId.get(at).callFrame.url)) at = parent.get(at); const f = at ? byId.get(at).callFrame : { functionName: '(library)', url: '', lineNumber: 0 }; const key = `${f.functionName || '(anon)'} ${f.url.split('/src/').pop().split('?')[0]}:${f.lineNumber}`; callers.set(key, (callers.get(key) || 0) + (dt[i] || 0) / 1000); });
          console.log(`CALLERS ${label} ${name}\n` + [...callers].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, ms]) => `  ${ms.toFixed(0).padStart(6)} ms  ${key}`).join('\n'));
        }
        if (process.env.LINES) console.log(`LINES ${label} ${name}\n` + [...lines].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([key, ticks]) => `${ticks} ${key}`).join('\n'));
        console.log(`APP ${label} ${name}\n` + [...inclusive].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([key, ms]) => `  ${ms.toFixed(0).padStart(6)} ms  ${key}`).join('\n'));
        console.log(`CPU ${label} ${name}\n` + [...self].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([key, ms]) => `  ${ms.toFixed(0).padStart(6)} ms  ${key}`).join('\n'));
      }
      const stats = await page.evaluate(() => { window.__profiling = false; const gaps = window.__gaps.slice(1).sort((a, b) => a - b); return { frames: gaps.length, p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] || 0), over25: gaps.filter(gap => gap > 25).length, worst: Math.round(gaps.at(-1) || 0), longTaskMs: Math.round(window.__long) }; });
      console.log(`PERF ${label} ${name} ${JSON.stringify(stats)}`);
      return stats;
    };
    if (!await page.locator('.immersive-player').count()) await page.click('.dock-track, .mobile-mini-player, .player-dock').catch(() => {});
    await wait(1200);
    await profile('close player', () => page.keyboard.press('Escape'), 1.5);
    await profile('open player', () => page.click('.dock-track').catch(() => page.keyboard.press('l')), 1.5);
    await profile('lyrics on', () => page.keyboard.press('l'), 1.5);
    await profile('lyrics playing across lines', () => setSeek(page, 9.6), 6);
    await profile('best part (zoom + pulse)', () => setSeek(page, 26.4), 4);
    await profile('next song', () => page.keyboard.press('Shift+ArrowRight'), 3);
    await profile('queue sheet open', () => page.keyboard.press('Escape').then(() => wait(800)).then(() => page.click('button[aria-label="Open queue"], .queue-pull, button:has-text("Queue") >> visible=true').catch(() => {})), 1.5);
    await profile('queue sheet close', () => page.keyboard.press('Escape'), 1.5);
    await check('P', `${label}: no runtime errors while profiling`, async () => ok(!errors.length, errors.join(' | ')));
    await context.close();
  }
}

// ── O: lyric timing that adapts to the upload that plays ──────────────────
if (!only || only === 'O') {
  {
    const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, alignment: -1.8 });
    await page.goto(BASE); await wait(1500);
    await startQueue(page); await wait(1500);
    if (!await page.locator('.immersive-player').count()) { await page.click('.dock-track'); await wait(1000); }
    await page.keyboard.press('l'); await wait(1200);
    await check('O', 'captions-matched timing applies by itself and is named in the footer', async () => { const footer = await page.textContent('.lyric-footer'); ok(/synced to this video \(-1\.8 s\)/.test(footer), footer); });
    await check('O', 'the line on screen follows the corrected timing', async () => { await setSeek(page, 12.3); await wait(1500); const text = await page.textContent('.lyric-line.current'); ok(text.includes('wheel'), text); });
    await check('O', 'settings say where the timing comes from', async () => { await page.click('button[aria-label="Player settings"]'); await wait(800); ok((await page.textContent('output[aria-label="Current lyrics offset"]')).trim() === '-1.8 s'); ok((await page.textContent('.sheet')).includes('Matched to this video’s captions')); });
    await check('O', 'a nudge by hand wins, and Auto hands timing back to the captions', async () => {
      await page.click('button[aria-label="Show lyrics earlier"]'); await wait(300);
      ok((await page.textContent('output[aria-label="Current lyrics offset"]')).trim() === '-1.7 s');
      ok((await page.textContent('.sheet')).includes('Your timing'));
      await page.click('.offset-stepper .small-pill:has-text("Auto")'); await wait(500);
      ok((await page.textContent('output[aria-label="Current lyrics offset"]')).trim() === '-1.8 s');
    });
    await check('O', 'no runtime errors (captions timing)', async () => ok(!errors.length, errors.join(' | ')));
    await context.close();
  }
  {
    const lyricLog = [];
    const { context, page, errors } = await newSession(browser, { viewport: { width: 1280, height: 800 }, editGap: 6, lyricLog });
    await page.goto(BASE); await wait(1500);
    await startQueue(page); await wait(1200);
    await page.keyboard.press('Shift+ArrowRight'); await wait(2500);
    if (!await page.locator('.immersive-player').count()) { await page.click('.dock-track'); await wait(1000); }
    await page.keyboard.press('l'); await wait(1500);
    await check('O', 'another edit of the song asks for lyrics timed for its own length', async () => ok(lyricLog.includes('Morning Light@66'), lyricLog.join(' ')));
    await check('O', 'without them the catalogue timing stays, and the footer says so', async () => { const footer = await page.textContent('.lyric-footer'); ok(/timed for a 6\.0 s shorter edit/.test(footer), footer); ok(await page.locator('.desktop-lyrics .lyric-line').count() > 0); });
    await check('O', 'no runtime errors (other edit)', async () => ok(!errors.length, errors.join(' | ')));
    await context.close();
  }
}

// ── Q: interaction audit — every visible button answers a press, and nothing jumps ──
if (only === 'Q' || !only) {
  // Press without clicking: down on the button, slide off, release elsewhere.
  let innerHeightOf = 0;
  const audit = async (page, screen) => {
    innerHeightOf = page.viewportSize().height - 2;
    const buttons = await page.evaluate(() => [...document.querySelectorAll('button, [role="button"], a.album-card, .track-row .track-main')].map((node, index) => {
      node.dataset.auditIndex = index;
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      const visible = box.width > 8 && box.height > 8 && box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth && style.visibility !== 'hidden' && Number(style.opacity) > 0.2 && !node.disabled && style.pointerEvents !== 'none';
      const hit = visible && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return visible && hit && (hit === node || node.contains(hit)) ? { index, name: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 28) || node.className.slice(0, 28) } : null;
    }).filter(Boolean));
    const silent = [], jumpy = [];
    for (const button of buttons.slice(0, 40)) {
      const read = () => page.evaluate(index => { const node = document.querySelector(`[data-audit-index="${index}"]`); if (!node) return null; const style = getComputedStyle(node); const box = node.getBoundingClientRect(); return { look: [style.transform, style.scale, style.opacity, style.backgroundColor, style.boxShadow, style.color, style.filter].join('|'), x: box.left + box.width / 2, y: box.top + box.height / 2, w: box.width, h: box.height }; }, button.index);
      const before = await read(); if (!before) continue;
      await page.mouse.move(before.x, before.y); await wait(60);
      const hover = await read();
      await page.mouse.down(); await wait(170);
      const pressed = await read();
      // Slide off vertically: sideways would be a swipe on horizontal carousels.
      const at = pressed || hover || before;
      await page.mouse.move(at.x, Math.min(innerHeightOf, at.y + 400), { steps: 3 }); await page.mouse.up(); await wait(250);
      if (!hover) continue; // gone under the pointer (a hover-revealed control): nothing to compare
      if (!pressed) continue;
      if (pressed.look === hover.look) silent.push(button.name);
      const magnetic = await page.evaluate(index => !!document.querySelector(`[data-audit-index="${index}"]`)?.closest('.magnetic'), button.index);
      // A press shrinks the element a little; only a shift beyond that is a jump.
      if (!magnetic && Math.hypot(pressed.x - hover.x, pressed.y - hover.y) > Math.max(3, 0.05 * Math.min(pressed.w, pressed.h))) jumpy.push(`${button.name} (${Math.round(pressed.x - hover.x)},${Math.round(pressed.y - hover.y)})`);
    }
    console.log(`AUDIT ${screen}: ${buttons.length} buttons · silent: ${silent.join(', ') || 'none'} · moves when pressed: ${jumpy.join(', ') || 'none'}`);
    return { silent, jumpy };
  };
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const { context, page, errors } = await newSession(browser, { viewport });
    await page.goto(BASE); await wait(1800);
    const results = [];
    results.push(await audit(page, `${label} home`));
    await startQueue(page); await wait(1500);
    results.push(await audit(page, `${label} search`));
    if (!await page.locator('.immersive-player').count()) { await page.click('.dock-track'); await wait(1200); }
    results.push(await audit(page, `${label} player`));
    await page.click('button[aria-label="Player settings"]'); await wait(900);
    results.push(await audit(page, `${label} settings`));
    await page.keyboard.press('Escape'); await wait(700);
    await check('Q', `${label}: every visible button answers a press`, async () => ok(results.every(result => !result.silent.length), results.map(result => result.silent.join(', ')).filter(Boolean).join(' / ')));
    await check('Q', `${label}: no button moves when pressed`, async () => ok(results.every(result => !result.jumpy.length), results.map(result => result.jumpy.join(', ')).filter(Boolean).join(' / ')));
    await check('Q', `${label}: no runtime errors in the audit`, async () => ok(!errors.length, errors.join(' | ')));
    await context.close();
  }
}

// ── R: opening and closing audit — what appears or leaves without motion ──
if (only === 'R') {
  const install = () => {
    const sig = node => { const style = getComputedStyle(node); const box = node.getBoundingClientRect(); return [style.opacity, style.transform, style.scale, style.translate, style.filter, Math.round(box.height), Math.round(box.width), Math.round(box.top), Math.round(box.left)].join('|'); };
    const chain = node => { const list = []; for (let at = node, i = 0; at && at !== document.body && i < 4; at = at.parentElement, i++) list.push(at); return list; };
    const label = node => { const name = node.getAttribute?.('aria-label') || node.textContent?.trim().slice(0, 30) || ''; return `${node.tagName.toLowerCase()}.${String(node.className || '').split(' ').filter(Boolean).slice(0, 2).join('.')} "${name}"`; };
    const visible = node => { const box = node.getBoundingClientRect(); return box.width > 8 && box.height > 8 && box.bottom > 0 && box.top < innerHeight && getComputedStyle(node).visibility !== 'hidden'; };
    window.__audit = { pops: [], vanishes: [], tracked: new Map() };
    const tracked = window.__audit.tracked;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1 || node.closest('iframe, .yt-deck, .toast, svg') || [...tracked].some(([other, past]) => other !== node && performance.now() - past.added < 300 && other.contains?.(node))) continue;
          const first = chain(node).map(sig);
          const history = [];
          history.added = performance.now();
          tracked.set(node, history);
          setTimeout(() => { if (!node.isConnected || !visible(node)) return; history.push(chain(node).map(sig).join('#')); }, 20);
          setTimeout(() => { if (!node.isConnected || !visible(node)) return; const later = chain(node).map(sig); if (later.join('#') === first.join('#') && history[0] === later.join('#')) window.__audit.pops.push(label(node)); }, 160);
        }
        for (const node of record.removedNodes) {
          if (node.nodeType !== 1 || !tracked.has(node)) continue;
          const history = tracked.get(node); tracked.delete(node);
          const recent = history.filter(([time]) => typeof time === 'number' && performance.now() - time < 420).map(([, value]) => value);
          if (recent.length >= 3 && new Set(recent).size === 1 && history.visible) window.__audit.vanishes.push(label(node));
        }
      }
    });
    // Init scripts run before <body> exists: observe once the document is parsed.
    const observe = () => observer.observe(document.body, { childList: true, subtree: true });
    if (document.body) observe(); else document.addEventListener('DOMContentLoaded', observe, { once: true });
    // Every 40 ms, remember how each tracked element looks, to judge its exit.
    setInterval(() => { for (const [node, history] of tracked) { if (!node.isConnected) continue; const shown = visible(node); history.visible = shown; if (!shown) continue; history.push([performance.now(), chain(node).map(sig).join('#')]); if (history.length > 14) history.splice(1, history.length - 14); } }, 40);
  };
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const { context, page, errors } = await newSession(browser, { viewport });
    await page.addInitScript(install);
    await page.goto(BASE); await wait(2500);
    const step = async (name, act, settle = 1100) => { await act().catch(error => console.log(`AUDIT-STEP-FAIL ${name}: ${error.message.split('\n')[0]}`)); await wait(settle); };
    await step('search', () => goSearch(page));
    await step('type', () => searchFor(page, 'band'));
    await step('play', () => page.click('.top-result-play'), 1800);
    await step('open player', async () => { if (!await page.locator('.immersive-player').count()) await page.click('.dock-track'); });
    await step('lyrics', () => page.keyboard.press('l'));
    await step('queue', () => page.locator('button:has-text("Queue") >> visible=true').first().click());
    await step('close queue', () => page.keyboard.press('Escape'));
    await step('settings', () => page.click('button[aria-label="Player settings"]'));
    await step('audio sheet', () => page.locator('.sheet button:has-text("Audio") >> visible=true').first().click());
    await step('back', () => page.locator('button[aria-label="Back to preferences"]').first().click());
    await step('close settings', () => page.keyboard.press('Escape'));
    await step('dj sheet', () => page.locator('button[aria-label="DJ transition settings"] >> visible=true').first().click());
    await step('close dj', () => page.keyboard.press('Escape'));
    await step('focus', () => page.keyboard.press('i'));
    await step('unfocus', () => page.keyboard.press('Escape'));
    await step('next song', () => page.keyboard.press('Shift+ArrowRight'), 2200);
    await step('close player', () => page.keyboard.press('Escape'));
    await step('library', () => goPage(page, 'Your library', 'Library'));
    await step('home', () => goPage(page, 'Listen now', 'Listen'), 1800);
    const found = await page.evaluate(() => ({ pops: [...new Set(window.__audit.pops)], vanishes: [...new Set(window.__audit.vanishes)] }));
    console.log(`AUDIT-R ${label} pops in (${found.pops.length}):\n  ${found.pops.join('\n  ')}\nAUDIT-R ${label} vanishes (${found.vanishes.length}):\n  ${found.vanishes.join('\n  ')}`);
    await check('R', `${label}: no runtime errors in the transition audit`, async () => ok(!errors.length, errors.join(' | ')));
    await context.close();
  }
}

// Cards that arrive after their section has revealed still appear (phones load the
// recommendations late, often after the shelf has scrolled into view).
if (!only || only === 'S') {
  for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    const { context, page, errors } = await newSession(browser, { viewport });
    await page.goto(BASE); await wait(1500);
    await page.mouse.wheel(0, 900); await wait(3200);
    await check('S', `${label}: every card in view has revealed`, async () => {
      const hidden = await page.evaluate(() => [...document.querySelectorAll('.album-card, .video-card, .mood-card')].filter(node => { const box = node.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight - 120 && box.width > 0 && Number(getComputedStyle(node).opacity) < .99; }).map(node => node.textContent.trim().slice(0, 24)));
      ok(!hidden.length, hidden.join(', '));
    });
    await check('S', `${label}: no runtime errors`, async () => ok(!errors.length, errors.join(' | ')));
    await context.close();
  }
}

// On demand: a screenshot tour of the main screens at phone sizes, for visual review.
if (only === 'V') {
  const dir = process.env.SHOTS || 'shots'; await mkdir(dir, { recursive: true });
  for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['small', { width: 360, height: 740 }], ['landscape', { width: 844, height: 390 }]]) {
    const { context, page, errors } = await newSession(browser, { viewport });
    const shot = async name => { await wait(1300); await page.screenshot({ path: `${dir}/v-${label}-${name}.png` }); };
    const step = async (name, act) => { try { await act(); await shot(name); } catch (error) { console.log(`TOUR-FAIL ${label} ${name}: ${error.message.split('\n')[0]}`); } };
    await page.goto(BASE); await wait(2500); await shot('home');
    await page.mouse.wheel(0, 900); await shot('home-scrolled'); await wait(2500); await shot('home-scrolled-late');
    console.log('TOUR-CARDS', label, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.album-card, .video-card')].slice(0, 4).map(node => { const box = node.getBoundingClientRect(); return [Math.round(box.top), Math.round(box.height), getComputedStyle(node).opacity, getComputedStyle(node.closest('section') || node).opacity]; }))));
    await step('search', async () => { await goSearch(page); await searchFor(page, 'band'); });
    await step('player', async () => { await page.click('.top-result-play'); await wait(1500); if (!await page.locator('.immersive-player').count()) await page.click('.dock-track'); });
    await step('lyrics', () => page.keyboard.press('l'));
    await step('queue', () => page.locator('button:has-text("Queue") >> visible=true').first().click());
    await page.keyboard.press('Escape'); await wait(600);
    await step('settings', () => page.click('button[aria-label="Player settings"]'));
    await page.keyboard.press('Escape'); await wait(600);
    await step('dj', () => page.locator('button[aria-label="DJ transition settings"] >> visible=true').first().click());
    await page.keyboard.press('Escape'); await wait(600);
    await page.keyboard.press('Escape'); await wait(900);
    await step('dock', async () => {});
    await step('library', () => goPage(page, 'Your library', 'Library'));
    if (errors.length) console.log(`TOUR-ERRORS ${label}: ${errors.join(' | ')}`);
    await context.close();
  }
}

await browser.close();
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed`);
for (const group of [...new Set(results.map(result => result.group))]) console.log(`  ${group}: ${results.filter(r => r.group === group && r.ok).length}/${results.filter(r => r.group === group).length}`);
for (const result of failed) console.log(`✗ [${result.group}] ${result.name}: ${result.error}`);
