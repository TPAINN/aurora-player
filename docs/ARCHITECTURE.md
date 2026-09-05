# Aurora Player — architecture reference

Written during the redesign work (2026-09). Purpose: stop future sessions from
re-discovering this from scratch. Update this file when structure changes;
don't let it drift into fiction.

## Repo shape

One repo, two Vercel deployments:

| Surface | Root Directory | Framework | Notes |
|---|---|---|---|
| App | `/` (repo root) | Vite | `aurora-player-seven.vercel.app`. Ships `/api` serverless functions alongside the SPA. |
| Landing | `web/` | Other (no build) | `aurora-player-tpainn.vercel.app`. Currently a static, minified, single-line `index.html` — no React, no build step. This is changing per the redesign plan (`web/` becomes a real Vite+React project importing from `shared/`). |

Stack: **React 19 + Vite**, mostly `.jsx`, with `.ts` used for newer `lib/`/`hooks/`
files (`colors.ts`, `usePlayer.ts`, `useSearch.ts`). No Next.js anywhere — when
any external spec mentions `app/` App Router paths, the equivalent here is `src/`.
No TypeScript type-checking on the client build (only `server/` is typechecked).

Dependencies actually in use: `framer-motion`, `lucide-react`, `ogl` (lightweight
WebGL, used by `components/Particles.jsx`), `realtime-bpm-analyzer`. Nothing else —
no GSAP, Lenis, React Three Fiber, React Spring, or Anime.js are installed today.

## `src/App.jsx` — the whole player (one file, ~3000 lines)

Everything lives here: state, effects, module-level helper functions, and the
render tree. It has NOT been split into the `hooks/usePlayer.ts` /
`hooks/useSearch.ts` files that exist in `src/hooks/` — see "Dead code" below.

### Screen state (booleans/derived, not a router)

- `introPhase` (`'visible' | 'gone'`) — the branded splash (cover wall + wordmark
  + "welcome back"). Gated by `sessionStorage['aurora-intro-seen']` so it plays
  once per browser session, capped at 900ms, and is non-blocking: `.intro-overlay`
  has `pointer-events: none` in CSS, so the hero (with its search box) — already
  mounted underneath from the first frame — is always reachable immediately by
  click or keypress. A window `keydown` listener also force-dismisses it.
- `hasPlayer = !!(song || isLoading)` — drives an `AnimatePresence mode="wait"`
  swap between `hero` (home/search) and `player` (Now Playing). There is no
  router; this is the entire "navigation" model.
- `showSearch` — a modal search overlay shown from within the player view
  (triggered by the header search icon or Cmd/Ctrl+K).
- `zenMode` — immersive mode (hides the left panel). Toggled by the eye icon in
  the player header.

### Search (`src/App.jsx`, state ~line 1134, effect ~line 1880)

Inline dual-source search: iTunes (direct client-side fetch, always works,
no key) + Genius (via `/api/genius/search`, needs the backend). Debounced
180ms, deduped and scored (`scoreSuggestionCandidate`), with keyboard nav
(↑/↓/Enter/Esc), Cmd/Ctrl+K global focus, an `AbortController` per search
cycle, a 120ms-delayed skeleton (avoids flashing on fast responses), and
empty/error states. Matched substrings render via `highlightMatch()` (bold,
not color). "Listening History" (recent plays, `localStorage['aurora-history']`)
auto-surfaces on empty+focused, and closes as soon as the user types.

Deep links, read on mount only (`useEffect(..., [])`, placed after `loadTrack`
and `hasPlayer` are defined):
- `/?q=<query>` — prefills and runs a search.
- `/t/<iTunes trackId>` — looks up the track via
  `https://itunes.apple.com/lookup?id=<id>` and calls `loadTrack` directly.
  The SPA rewrite already in `vercel.json`
  (`{ "source": "/((?!api/).*)", "destination": "/index.html" }`) means this
  route needs no additional server config — it already serves `index.html` for
  any non-`/api` path, in both Vite's dev server and Vercel.

### Playback (`loadTrack`, `~line 2072`; `stopAll`, `~line 2023`)

`loadTrack(track)` is the core pipeline: `stopAll()` → sync state resets →
`setIsLoading(true)` → `resolveCanonicalTrack` → parallel YouTube video-ID
search (`loadVideoBackground`, non-blocking) → LRCLib exact match → LRCLib
fuzzy search → Genius unsynced fallback (chorus detection only) →
`setIsLoading(false)`. Chorus/section detection fuses THREE signals
(`fuseChorusRanges`): Genius `[Chorus]` headers, structured section data, and
statistical/energy-based detection (`estimateSongEnergy`). This is
significantly more sophisticated than a naive "detect chorus from lyrics"
pass — don't simplify it without understanding all three inputs.

Playback itself: hidden YouTube IFrame Player API (`yt-player` div), audio IS
the YouTube embed (not a separate `/api/stream`) — **there is no real Web Audio
FFT**, because a cross-origin YT iframe can't be tapped by
`createMediaElementSource`. Beat visuals in `useAudioAnalyzer.js` /
`BeatReactiveBackground.jsx` are a **synthetic BPM pulse**, not real onset
detection. CSS custom properties `--beat-pulse`, `--section-lift`,
`--section-bloom` are written per-frame from JS and drive reactive CSS (see
tokens below) — this is the closest thing to an "AmbientField" system already
in the codebase; it's 2D-canvas + CSS, not WebGL/shader-based (`ogl` is used
elsewhere, for `Particles.jsx`, not for this).

Seek bar updates are imperative (direct `style.width`/`style.left` writes via
refs — `seekFillRef`, `seekThumbRef`, `curTimeDisplayRef`), not React state per
frame. Preserve this pattern in any refactor; it's a deliberate perf choice.

**Known issue (found 2026-09-05, not fixed): `loadTrack` is not re-entrancy-safe.**
React 19 StrictMode (`main.jsx` wraps `<App/>` in `<StrictMode>`) double-invokes
the mount effect that handles `/t/<id>` deep links in dev, which calls
`loadTrack` twice back-to-back; the resulting overlapping async executions can
leave `hasPlayer`'s hero↔player `AnimatePresence` swap unstable (hero stays
mounted, player never settles) **in local dev only** — confirmed absent on the
production build (StrictMode's double-invoke is a dev-only React behavior; a
production build only invokes effects once). Reproduces via plain mouse-click
too, not just the deep link — so it's pre-existing, not caused by the search
UX changes. Not fixed yet: fixing it safely means making `loadTrack` guard
against overlapping calls (e.g. a generation counter, same pattern as the
existing `searchReqRef`), which touches core playback state and deserves its
own careful pass rather than a rushed inline patch. **Local dev testing of full
playback (Now Playing UI, sync offset, zen mode, lyrics) is unreliable until
this is fixed** — use the production tab as the reference for anything past
"does search find and select a track."

### Dead code: `src/hooks/useSearch.ts` and `src/hooks/usePlayer.ts`

Both are complete, well-written hooks — NOT imported anywhere in `App.jsx`
(grep confirms only `useAudioAnalyzer.js` is used). They also don't compile
against current reality: they import `searchGenius`, `searchItunes`,
`fetchLrcLib`, `searchLrcLib`, `fetchStructuredLyrics`, `fetchVideoId` from
`@/lib/api`, but `src/lib/api.js` only exports `buildApiUrl` — those functions
only exist as inline logic in `App.jsx` (module-level helpers + the `loadTrack`
body), under different organization entirely.

More importantly, the hooks represent an **earlier, simpler design** that
`App.jsx`'s inline code has since grown past:
- No multi-signal chorus fusion (hooks only call `detectChorusRanges`/
  `buildChorusRangesFromSections` — App.jsx fuses those with Genius headers
  AND statistical energy detection).
- No `resolveCanonicalTrack`, no metadata cache (`cacheGet`/`cacheSet`), no
  art-source preference logic (Genius art preferred over iTunes when available).
- `usePlayer.ts`'s `beatPalette` is a typed `BeatPalette` object
  (`{c, glow, dim, bg}`, from `colors.ts`); `App.jsx`'s inline `beatPalette` is a
  plain 3-string array, which is what `<BeatReactiveBackground palette={...}>`
  actually expects — wiring the hook in as-is would silently break that prop.
- `usePlayer.ts`'s `HISTORY_KEY = 'aurora_history_v2'` — the real, live
  localStorage key is `'aurora-history'`. Using the hook as-is would silently
  reset every user's play history.

**Do not "wire up" these hooks as a drop-in swap** — they're not compatible
with current behavior. Migrating `App.jsx` onto reusable hooks (the stated
goal) means either rewriting the hooks to faithfully extract what `App.jsx`
actually does today (recommended), or a deliberate, piece-by-piece port of the
missing features into the hooks with parity verified at each step. Either way
it's a substantially bigger lift than "import the hook" — treat it as its own
planned piece of work, not a mechanical refactor.

## CSS token system (`src/App.css:8`, `:root`)

Real values — mirror these, don't invent new ones:

```
--c1, --c2, --c3         palette-driven accent triad (violet/pink/cyan default),
                         set at runtime by colors.ts's applyPalette()
--c1-glow/--c2-glow/--c3-glow, --c1-dim   derived glow/dim variants
--bg-rgb                 6,7,14 (near-black base)
--font                   'Bricolage Grotesque' (variable, wght 200-800, opsz 12-96)
--mono                   'IBM Plex Mono' (wght 300/400/500)
--spring                 cubic-bezier(0.16, 1, 0.24, 1)
--dur                    0.58s
--chorus-in-dur / --section-in-dur / --section-out-dur
--beat-pulse / --section-lift / --section-bloom   written per-frame from JS
```

`src/lib/tokens.ts` re-exports these as JS/TS constants for non-CSS consumers
(the future `shared/` package). If you change a value, change both places.

`src/lib/colors.ts` (`extractColors`, `buildPalette`, `applyPalette`) is the
real, working palette-extraction pipeline (weighted HSL bucket clustering from
a 100×100 canvas sample) — this is what any "AmbientField"/palette work should
import and build on, not reimplement.

## Deploy

- `vercel.json` (repo root): `framework: vite`, standard rewrite
  (`/((?!api/).*)` → `/index.html`). Don't switch to the `services`/
  `experimentalServices` schema — it silently drops `/api`.
- `/api/*` are co-located Vercel Serverless Functions (ESM `export default`,
  required because root `package.json` is `"type": "module"`). They do **not**
  run under plain `vite dev` — the vite proxy target (`localhost:3001`,
  `vite.config.js`) points at the legacy `server/` (Express+yt-dlp+puppeteer,
  `.vercelignore`d, kept for reference only, not verified runnable). Local dev
  without a real backend means Genius search/lyrics, LRCLib-via-backend, and
  YouTube video-ID resolution all fail (502/ECONNREFUSED) — iTunes search
  still works (direct client-side fetch). `vercel dev` would fix this but
  needs `vercel link` (interactive auth) first; not set up in this environment.
- Local dev server: `npm run dev:client` (plain `vite`, port 5183 in this
  session's `.claude/launch.json` as `aurora-player`) — NOT `npm run dev`
  (that also spins up the legacy `server/`, unnecessary and possibly broken).
