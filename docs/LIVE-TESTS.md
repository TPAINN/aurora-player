# Live interaction tests

`scripts/live-tests.mjs` drives the real app in Chromium. The catalogue, lyrics and tempo APIs are stubbed (some deliberately slow or failing), and a simulated YouTube player records loads, plays, pauses, seeks, volumes and playback rates. Group G decodes real generated WAV audio. 371 checks in eighteen groups (plus four run on demand: P, a frame-timing profile; R, an opening/closing audit; V, a phone screenshot tour; T, a frame-by-frame film of the lyrics toggle):

| Group | Covers | Checks |
| --- | --- | --- |
| A | Home, carousel, navigation, sidebar, shortcuts | 16 |
| B | Search: ideas, dedupe, stale results, skeletons, keys, retry, recents, Play next, 8D variant | 23 |
| C | Playback, keyboard, seek, volume, likes, lyrics sync/scroll/interlude, backing vocals past the next line, peak backdrop, beat kick and bar ring on peaks with the lifted backdrop (tempo, running, frame rate, locked to the beat within 25 ms), the player never scrolling into its backdrop overscan, cover direction on Next/Previous, queue and sheets, a11y names | 58 |
| D | DJ priming, overlap, a real blend (both songs within 6 dB of full for most of it, not a fade-out then fade-in), blend curve, deep sweep, tempo glide bounds, rate read-back, tempos meeting in the middle, manual blend, song B entry past a long intro, 0.05-step embeds, seamless mode, main-thread load, an early manual Next that keeps song A at full level while B buffers and then blends | 45 |
| E | Mobile (390 px), tablet (900 px), reduced motion | 15 |
| F | Search categories, collections, Back gestures, adaptive radio and home (spotlight, Made for you, Daily rotation), quality chip and audio sheet, blend length, motion backdrop, opening, favicons, local file format | 39 |
| G | Local DJ transition with real decoded WAV audio (120 → 126 BPM): glide, bound, shared tempo, entry at B's first full section, hand-over, easing back, completion | 10 |
| H | Scroll lock behind sheets (desktop and phone, stacked sheets), name greeting, On repeat, Your artists, More like…, refrain marks and Best part, scroll reveal, word-by-word headline, spotlight, heart pop, play/pause morph, 5–10 s blend options | 17 |
| I | Resilience and new interactions: skipping unplayable songs (with notice and queue marking), refused uploads falling back (including a refused video result, and a failed search that stays retryable), DJ preparing past an unplayable song, DJ with shuffle, swipe gestures, arrow keys on the timeline, mood chips (desktop and phone) | 26 |
| J | Timeline, player and phone robustness: a tap, click or off-rail drag seeks and the slider keeps moving, also across a song change; seeking into the DJ zone still blends; lyrics keep moving after a DJ hand-over while the outgoing lyrics hold still; spamming open/close forces no scroll layout, re-decodes no artwork and never stacks players; the screen stays awake while playing and the lock screen shows the song; the home carousel swipes; the queue grows from what is heard, never with another version of a queued song | 27 |
| K | Gapless song changes, best parts with lyrics shown (desktop and phone), loudness (Quiet, Normal, Loud) and its persistence, the sectioned queue | 24 |
| L | A seeded 100-action fuzzer (taps, swipes, seeks, skips, sheets, keys) with invariants after every step: one player, a moving clock, title and dock in agreement, no errors | 6 |
| M | Lyrics focus at five sizes (desktop, laptop, phone, phone on its side, tablet): cover, name under it and lyrics, with the controls subdued; lyrics keep following; Escape, I and Exit focus; the video toggle stays reachable and leaves focus; closing the player leaves focus | 35 |
| N | Best parts from the music: the analysis asks for the playing video, Best part jumps to the most-replayed section, the backdrop and timeline light it, the peak lasts whole bars at 120 BPM, replays from a different-length upload are ignored | 8 |
| O | Lyric timing that adapts to the upload: caption-matched timing applies by itself and is named; the line on screen follows it; settings name the source; a nudge by hand wins and Auto hands back; another edit asks for lyrics timed for its own length and the footer says so otherwise | 8 |
| Q | Interaction audit on desktop and phone (home, search, player, settings): every visible button answers a press and none moves while pressed | 6 |
| S | Scroll reveal on desktop and phone: cards that arrive after their section came into view still reveal | 4 |
| W | A song with no catalogue tempo pulses on the beat measured from its word-timed vocal; with no beat evidence, no pulse | 4 |

Result on the production build (`npm run preview`): **370 / 371 passed**; the one miss is C's held-note frame rate under software rendering (24.7–29 fps against 30 across runs), which varies without a GPU. The hand-over now renders as a React transition, so the long-task check at the blend also passes in development mode.

A separate responsive sweep drives home, search, album, player and lyrics at 13 viewports (320×568 to 2560×1440, including landscape phones). It fails on any element that spills off-screen, then checks that the player never runs under the dock.

## Defects the suite found and fixed

Round six:
- Lyrics on and off jumped: the cover snapped across before the lyrics faded in, and back after they faded out; on phones the name block jumped and blanked. Filmed frame by frame (group T), it is now one glide.
- Most online songs never pulsed: a phase needed word-timed lyrics and a tempo needed catalogue BPM. Line starts now place a known tempo, and word-timed vocals reveal an unknown one.
- A manual Next with Live DJ changes faded song A to silence while B loaded (A fell from 68 to 53 before B sounded); B now buffers under A at full level.

Round five:
- Home cards that arrived after their section had scrolled into view stayed invisible (the reveal only reached children present when it fired). Sections now reveal from state.
- Online DJ blends were closer to a crossfade: both songs were within 6 dB of full for only 42 % of a 5 s blend. The curve now brings song B up early and rides both together through the middle.
- The local tempo glide stalled one sub-step short of its target until the blend began; it now steps evenly and lands exactly.
- The dock equalizer and the phone focus thumbnail appeared and vanished without an exit.

Round four:
- A line's word fill froze as soon as the next line started, so backing vocals that run on (for example “(I like to…)”) never filled. Every line is now painted until its last word ends.
- The first version of the peak backdrop animated brightness under a large blur, and the lyrics fell to about 10 fps in software rendering. It now moves only scale and opacity.

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

## Smoothness profile (group P, `node scripts/live-tests.mjs P`)

Phone size with a 4× CPU slowdown; every frame gap and long task is recorded per interaction (`PROFILE=`, `TRACE=`, `CALLERS=` and `LINES=` add CPU, timeline and per-line breakdowns on the dev server). Fixes it led to: lyric lines memoized and faded on the compositor only (20 → 0–1 slow frames while lyrics play), the best-part lift drawn once instead of blurred live, a song change rendering 12 times instead of 38, and the bar ring kept to phones.
