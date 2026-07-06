# Aurora Player — codemap

Music player: word-synced lyrics + beat-reactive visuals. React 19 + Vite (root) · Express/tsx server (`server/`) · static landing (`web/index.html`, single minified line).

## Deploys (both Vercel projects are git-connected to THIS repo — push = deploy both)
| Surface | Where | Notes |
|---|---|---|
| App | https://aurora-player-seven.vercel.app (Vercel project `aurora-player`, Root Directory = repo root) | auto-deploys on push to main |
| Landing | https://aurora-player-site.vercel.app (project `aurora-player-site`, **Root Directory = `web`**, framework Other, no build) | auto-deploys on push to main; legacy alias web-eight-mocha-75.vercel.app still attached |
| API | https://aurora-player-api.fly.dev (`flyctl deploy` from server/) | Dockerfile bundles standalone yt-dlp; puppeteer is optional lazy fallback (PUPPETEER_SKIP_DOWNLOAD) |
| Dead | aurora-player-api.onrender.com (404 all routes), aurora-player.vercel.app (NOT ours — 402) |

## Architecture
- `src/App.jsx` (~3000 lines) — the whole player. Search UI + suggestion scoring (`scoreSuggestionCandidate`, cutoff score<14), YT IFrame playback (hidden `yt-player`, audio = YouTube embed, NOT /api/stream), lyrics state, chorus refs.
- `src/lib/api.js` — `buildApiUrl`; default base = fly.dev, override `VITE_API_BASE_URL`.
- `src/lib/lyrics.js` — sync + chorus: 3 detectors (Genius headers / structured sections / statistical self-similarity) fused by `fuseChorusRanges` (corroboration wins). `normalizeLyricText` is Unicode-aware (`\p{L}` — do NOT revert to a-z0-9, kills Greek).
- `server/src/index.ts` — /api/health, /api/status, /api/video/search (needs `artist`+`title` params, not `q`), /api/genius/search?q=, /api/lyrics/structured, /api/genius/lyrics, /api/stream?v=<ytid> (yt-dlp resolve + range-proxy).
- Suggestions dropdown closes on blur (onBlur setTimeout 160ms) — headless tests see it as "never rendering".

## Gotchas
- Root `vercel.json` was REMOVED — old top-level schema conflicts with Vercel CLI services detection (server/fly.toml triggers it).
- Lyrics source: LRCLib primary (free), Genius scrape fallback.
