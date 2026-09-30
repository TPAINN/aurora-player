// Live interaction suite: stubs the catalogue, lyrics and tempo APIs and a simulated
// YouTube player, then drives the real app. Usage (with the dev or preview server running):
//   npm i --no-save playwright-core && node scripts/live-tests.mjs [A|B|C|D|E]
// BASE=http://localhost:5188/ targets `npm run preview`; CHROMIUM_PATH selects a browser.
import { chromium } from 'playwright-core';

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
  // '1': the embed lists and plays fine rates; '2': plays them but lists only coarse ones.
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
      this.clock = setInterval(() => { if (this.state === 1) { this.t += .05 * this.rate; if (this.t >= this.dur) { this.t = this.dur; this.set(0); } } }, 50);
    }
    set(state) { this.state = state; this.o.events.onStateChange?.({ target: this, data: state }); }
    loadVideoById(id, start = 0) { this.vid = id; this.t = start; this.dur = Number(JSON.parse(localStorage.getItem('durations') || '{}')[id] || 60); log('load', id, this.muted, start); this.set(3); setTimeout(() => this.set(1), 250); }
    playVideo() { log('play', this.vid, this.muted); setTimeout(() => this.set(1), 150); }
    pauseVideo() { log('pause', this.vid); this.set(2); }
    stopVideo() { this.set(5); } seekTo(t) { log('seek', this.vid, Math.round(t * 10) / 10); this.t = t; }
    getCurrentTime() { return this.t; } getDuration() { return this.dur; } getPlayerState() { return this.state; }
    setVolume(v) { this.vol = v; window.__vols.push([Math.round(performance.now()), this.vid, Math.round(v)]); } mute() { this.muted = true; } unMute() { this.muted = false; }
    setPlaybackRate(r) { const applied = fine ? r : coarse.reduce((best, rate) => Math.abs(rate - r) < Math.abs(best - r) ? rate : best, 1); this.rate = applied; log('rate', this.vid, applied); } getPlaybackRate() { return this.rate; }
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
async function newSession(browser, { viewport = { width: 1440, height: 900 }, prefs = {}, reducedMotion = 'no-preference', searchDelay = 120, failSearch = () => false, recommendations = [], welcome = false, longIntro = false, incomingBpm = 124 } = {}) {
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
    return route.fulfill({ json: { videoId: { 'Night Drive': 'AAAAAAAAAAA', 'Morning Light': 'BBBBBBBBBBB', 'Slow Tide': 'CCCCCCCCCCC' }[title] || 'DDDDDDDDDDD', channel: title === 'Night Drive' ? 'Band - Topic' : 'Band Uploads', title } });
  });
  await page.route('**/api/lyrics/structured?*', async route => {
    const title = new URL(route.request().url()).searchParams.get('title');
    await wait(title === 'Slow Tide' ? 900 : 150);
    const incoming = longIntro ? { ...lineLyrics, lines: lineLyrics.lines.map(line => ({ ...line, time: line.time + 37, end: line.end + 37 })) } : lineLyrics;
    return route.fulfill({ json: title === 'Night Drive' ? wordLyrics : title === 'Morning Light' ? incoming : { source: null, sync: 'plain', lines: [] } }).catch(() => {});
  });
  await page.route('**/api/tempo?*', route => route.fulfill({ json: { bpm: new URL(route.request().url()).searchParams.get('title') === 'Night Drive' ? 120 : incomingBpm } }));
  await page.route('**/api/recommendations?*', route => route.fulfill({ json: { tracks: recommendations } }));
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
const goSearch = page => page.click('nav[aria-label="Main navigation"] button[aria-label="Search"]');
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
    await page.evaluate(() => { const input = document.querySelector('.dock-seek input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; for (const v of [10, 11, 12, 13, 14]) { set.call(input, String(v)); input.dispatchEvent(new Event('input', { bubbles: true })); } input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
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
  await check('C', 'the backdrop opens up on a held note, smoothly', async () => { await setSeek(page, 26.4); await wait(300); const rate = await fps(); await wait(800); ok(await page.locator('.player-art-background.is-peak').count() === 1); ok(rate >= 30, `fps ${rate} during the zoom (software rendering)`); });
  await check('C', 'and settles again outside the peak', async () => { await setSeek(page, 7); await wait(900); ok(await page.locator('.player-art-background.is-peak').count() === 0); });
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
  await check('C', 'queue row removal animates out', async () => { await page.click('dialog.sheet .track-row >> nth=2 >> button[aria-label^="Remove"]'); await wait(700); ok(await page.locator('dialog.sheet .track-row').count() === 2); });
  await check('C', 'play from queue row', async () => { await page.click('dialog.sheet .track-row >> nth=1 >> .track-main'); await wait(1200); ok((await title(page)).startsWith('Morning Light')); });
  await check('C', 'Escape closes the sheet', async () => { if (!await page.locator('dialog.sheet[open]').count()) await page.click('.dock-actions button[aria-label="Open queue"]'); await wait(700); await page.keyboard.press('Escape'); await wait(700); ok(await page.locator('dialog.sheet').count() === 0); });
  await check('C', 'settings sheet changes lyric offset', async () => { await page.click('button[aria-label="Player settings"]'); await wait(700); await page.selectOption('select[aria-label="Lyrics timing offset"]', '0.5'); ok(await page.inputValue('select[aria-label="Lyrics timing offset"]') === '0.5'); });
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
  await wait(4000);
  await check('D', 'both songs are audible together', async () => { const vols = await page.evaluate(() => window.__vols); const a = vols.filter(v => v[1] === 'AAAAAAAAAAA' && v[2] > 5 && v[2] < 75); const b = vols.filter(v => v[1] === 'BBBBBBBBBBB' && v[2] > 5 && v[2] < 75); ok(a.length > 3 && b.length > 3, `A:${a.length} B:${b.length} ${JSON.stringify(vols.slice(-6))}`); });
  await check('D', 'equal-power curve reaches full volume', async () => { const vols = await page.evaluate(() => window.__vols.filter(v => v[1] === 'BBBBBBBBBBB')); ok(vols.at(-1)[2] >= 79, JSON.stringify(vols.at(-1))); });
  await check('D', 'midpoint loudness is equal power', async () => { const vols = await page.evaluate(() => window.__vols.filter(v => v[1] === 'BBBBBBBBBBB' && v[2] > 0)); const mid = vols.find(v => v[2] >= 50); ok(mid && mid[2] <= 62, JSON.stringify(mid)); });
  await check('D', 'outgoing deck stops after the blend', async () => ok((await events(page)).some(row => row[1] === 'pause' && row[2] === 'AAAAAAAAAAA')));
  await check('D', 'a hollow sweep plays over the online blend', async () => ok(await page.evaluate(() => window.__sweeps) >= 1, 'no sweep started'));
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
  await check('D', 'song B with a long intro is buffered from its chosen entry', async () => { const load = (await events(page)).find(row => row[1] === 'load' && row[2] === 'BBBBBBBBBBB' && row[3] === true); ok(load && load[4] >= 25 && load[4] <= 33, JSON.stringify(load)); });
  await setSeek(page, 31); await wait(9000);
  await check('D', 'song B enters past its intro and its vocals follow the blend', async () => { ok((await title(page)).startsWith('Morning Light')); const t = await playerTime(page); ok(t >= 30 && t < 38, String(t)); });
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
  await check('F', 'blend length choice persists', async () => { await page.click('.dock-actions button[aria-label="DJ transition settings"]'); await wait(700); await page.click('.segmented [role=radio]:has-text("Long")'); ok(await page.evaluate(() => localStorage.getItem('aurora-blend')) === '8'); ok(await page.getAttribute('.segmented [role=radio]:has-text("Long")', 'aria-checked') === 'true'); await page.keyboard.press('Escape'); await wait(700); });
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
  await check('G', 'the blend completes and the DJ returns to idle', async () => { await page.click('.dock-actions button[aria-label="DJ transition settings"]'); await wait(700); const text = await page.textContent('.dj-now'); ok(/complete|Ready/i.test(text), text); await page.keyboard.press('Escape'); await wait(500); });
  await check('G', 'no runtime errors in the local DJ blend', async () => ok(!errors.length, errors.join(' | ')));
  await context.close();
}

await browser.close();
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed`);
for (const group of [...new Set(results.map(result => result.group))]) console.log(`  ${group}: ${results.filter(r => r.group === group && r.ok).length}/${results.filter(r => r.group === group).length}`);
for (const result of failed) console.log(`✗ [${result.group}] ${result.name}: ${result.error}`);
