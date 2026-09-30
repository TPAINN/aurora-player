# Live interaction tests

`scripts/live-tests.mjs` drives the real app in Chromium with the catalogue, lyrics and tempo APIs stubbed (some deliberately slow or failing) and a simulated YouTube player that records loads, plays, pauses, seeks, volumes and playback rates. 134 checks in five groups:

| Group | Covers | Checks |
| --- | --- | --- |
| A | Home, carousel, navigation, sidebar, shortcuts | 16 |
| B | Search: ideas, dedupe, stale results, skeletons, keys, retry, recents, Play next, 8D variant | 23 |
| C | Playback, keyboard, seek, volume, likes, lyrics sync/scroll/interlude, queue and sheets, a11y names | 51 |
| D | DJ priming, overlap, equal power, tempo glide bounds, manual blend, seamless mode, main-thread load | 29 |
| E | Mobile (390 px), tablet (900 px), reduced motion | 15 |

Result on the production build (`npm run preview`): **134 / 134 passed**. Development mode passes 133 / 134: React's dev overhead produces long tasks at the DJ hand-over, which the same check does not see in production.

## Defects the suite found and fixed

- The whole app re-rendered four times a second while playing (clock in top-level state) and ten times a second during a blend. The clock and blend progress now live in external stores; long tasks while playing fell from 16–17 per 4 s to 0.
- A mask on the lyrics scroller re-rasterised the whole list for every painted word. Edge fading now uses an `IntersectionObserver` class; the per-frame painter writes only changed values. Lyrics frame rate in headless software rendering rose from ~21–28 to ~54 fps (production).
- Keyboard shortcuts were ignored after clicking any button or using a slider (focus stayed there).
- Ctrl+K and `/` opened Search without focusing the field (the page animates in after focus was requested).
- The DJ priming stage treated a still-constructing standby deck as a failure; a primed blend's cue could jump back to a passed lyric cue and cancel itself.
- Pressing Play on a search result replaced the queue, discarding songs queued by hand.

Measured without a GPU; real devices render faster. The check intentionally cannot hear audio: YouTube, Deezer and LRCLib are unreachable from the test environment.
