# Aurora Player — codemap

Music player: word-synced lyrics + beat-reactive visuals. React 19 + Vite (root) · Express/tsx server (`server/`) · static landing (`web/index.html`, single minified line).

## Deploys (both Vercel projects are git-connected to THIS repo — push = deploy both)
| Surface | Where | Notes |
|---|---|---|
| App | https://aurora-player-seven.vercel.app (Vercel project `aurora-player`, Root Directory = repo root) | auto-deploys on push to main. Now ships co-located Serverless Functions in `/api` (framework=vite, standard vercel.json). |
| Landing | https://aurora-player-site.vercel.app (project `aurora-player-site`, **Root Directory = `web`**, framework Other, no build) | auto-deploys on push to main; legacy alias web-eight-mocha-75.vercel.app still attached |
| API | **Co-located** in `/api` on the app itself (same origin). `/api/video/search` resolves audio via YouTube InnerTube. No separate host needed. |
| Dead | **aurora-player-api.fly.dev is DOWN** (TLS handshake fails) — audio was migrated OFF it into `/api`. onrender.com 404s; aurora-player.vercel.app NOT ours (402). server/ (Express+yt-dlp+puppeteer) is `.vercelignore`d, kept only for reference. |

## Architecture
- `src/App.jsx` (~3000 lines) — the whole player. Search UI + suggestion scoring (`scoreSuggestionCandidate`, cutoff score<14), YT IFrame playback (hidden `yt-player`, audio = YouTube embed, NOT /api/stream), lyrics state, chorus refs. Beat visuals are driven by a **synthetic BPM pulse** in `useAudioAnalyzer.js` — a cross-origin YT iframe cannot be tapped by Web Audio (`createMediaElementSource` throws), so there is NO real FFT.
- `src/lib/api.js` — `buildApiUrl`; **default base = same-origin** (co-located `/api`). A stale `VITE_API_BASE_URL` pointing at `fly.dev` self-heals to same-origin.
- `api/video/search.js` — Vercel function. Primary source is YouTube **InnerTube** (`youtubei/v1/search`) because the results-page HTML scrape is served a consent page from datacenter IPs; HTML scrape is the fallback. Same scoring as the old server. `api/health|status` real; `api/genius/*`+`api/lyrics/structured` are JSON stubs (puppeteer scraper can't run serverless).
- `src/lib/lyrics.js` — sync + chorus: 3 detectors fused by `fuseChorusRanges`. `normalizeLyricText` is Unicode-aware (`\p{L}` — do NOT revert to a-z0-9, kills Greek).
- Motion: app **ignores OS reduce-motion** on purpose — `<MotionConfig reducedMotion="never">`, perf tier is hardware-only, no `prefers-reduced-motion` CSS blocks. Device animation-scaling never affects the app.
- Suggestions dropdown closes on blur (onBlur setTimeout 160ms) — headless tests see it as "never rendering". Items are `motion.button`; synthetic events don't trigger their onMouseDown (framer-motion gesture layer).

## Gotchas
- `vercel.json` is the STANDARD Vite schema (`framework: vite` + `/((?!api/).*)`→`/index.html`). Do NOT use the `services`/experimentalServices schema — it silently skips the `/api` directory ("will not be built because experimentalServices is configured").
- API functions are ESM (`export default`) because root `package.json` is `type: module`; `module.exports` throws "module is not defined in ES module scope" at runtime.
- Lyrics source: LRCLib primary (free, called client-side), Genius fallback now stubbed.
- An orphan Vercel project `aurora-player-api` (health/status only) exists from an earlier approach — unused, safe to delete.
