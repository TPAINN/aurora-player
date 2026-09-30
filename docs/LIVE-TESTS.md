# Live interaction tests

`scripts/live-tests.mjs` drives the real app in Chromium. The catalogue, lyrics and tempo APIs are stubbed (some deliberately slow or failing), and a simulated YouTube player records loads, plays, pauses, seeks, volumes and playback rates. Group G decodes real generated WAV audio. 184 checks in seven groups:

| Group | Covers | Checks |
| --- | --- | --- |
| A | Home, carousel, navigation, sidebar, shortcuts | 16 |
| B | Search: ideas, dedupe, stale results, skeletons, keys, retry, recents, Play next, 8D variant | 23 |
| C | Playback, keyboard, seek, volume, likes, lyrics sync/scroll/interlude, queue and sheets, a11y names | 51 |
| D | DJ priming, overlap, equal power, tempo glide bounds, manual blend, song B entry past a long intro, seamless mode, main-thread load | 32 |
| E | Mobile (390 px), tablet (900 px), reduced motion | 15 |
| F | Search categories, collections, Back gestures, adaptive radio and home (spotlight, Made for you, Daily rotation), quality chip and audio sheet, blend length, motion backdrop, opening, favicons, local file format | 39 |
| G | Local DJ transition with real decoded WAV audio (120 → 126 BPM): glide, bound, blend, entry at B's first full section, hand-over, completion | 8 |

Result on the production build (`npm run preview`): **184 / 184 passed**. The hand-over now renders as a React transition, so the long-task check at the blend also passes in development mode.

A separate responsive sweep drives home, search, album, player and lyrics at 13 viewports (320×568 to 2560×1440, including landscape phones). It fails on any element that spills off-screen, then checks that the player never runs under the dock.

## Defects the suite found and fixed

Round three:
- Turning on Motion backdrop crashed the app (a value was read before its declaration).
- On desktops and tablets up to about 1024×768 (and 768×1024 portrait), the title block slid under the dock. On landscape phones the artwork was clipped. The desktop player is now sized to fit the viewport.
- On 320–360 px phones the page scrolled sideways by 6 px, because the edge-to-edge shelves used the wider gutter.

Earlier rounds:
- While playing, the whole app re-rendered four times a second (the clock lived in top-level state), and ten times a second during a blend. The clock and blend progress now live in external stores; long tasks while playing fell from 16–17 per 4 s to 0.
- A mask on the lyrics scroller re-rasterised the whole list for every painted word. Edge fading now uses an `IntersectionObserver` class, and the per-frame painter writes only changed values. In production, under headless software rendering, the lyrics frame rate rose from ~21–28 to ~54 fps.
- Keyboard shortcuts were ignored after clicking any button or using a slider, because focus stayed there.
- Ctrl+K and `/` opened Search without focusing the field, because the page animates in after focus was requested.
- The DJ priming stage treated a still-constructing standby deck as a failure. A primed blend's cue could also jump back to a lyric cue that had already passed and cancel itself.
- Pressing Play on a search result replaced the queue, discarding songs queued by hand.

All figures were measured without a GPU; real devices render faster. The online checks cannot hear audio: YouTube, Deezer and LRCLib are unreachable from the test environment.
