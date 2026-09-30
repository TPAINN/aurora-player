# Aurora redesign implementation plan

**Goal:** Replace landing and old frontend with the approved artwork-led music application and functioning multi-source lyrics.
**Architecture:** React shell consumes a dedicated playback hook and normalized lyric provider endpoint. Keep current YouTube search server function and palette utility. One root Vercel app; legacy landing redirects to the app until its alias can be moved.
**Tech Stack:** React 19, Vite, existing Motion and Lucide, native browser APIs and Node serverless functions.

## Constraints
No accounts, no application ads, no fake quality or sync claims. Preserve existing user changes. User approved automated design/implementation decisions. Reference images determine layout. Validate provider inputs, use fixed upstreams, timeout and cache requests. Honor reduced motion.

- [x] Backend: implement api/lyrics provider adapters and normalizers, check real provider responses and malformed inputs.
- [x] Playback: implement src/hooks/usePlayer.js using existing video search, race-safe selection, seek/volume/queue/repeat, real lyric payloads.
- [x] UI: replace src/App.jsx and styles with home/search/library, desktop cover carousel, mobile immersive player and synchronized lyrics.
- [ ] Deployment: remove landing implementation, ship PWA assets, update docs, verify build/lint and desktop/mobile flows in live preview.
- [ ] Review: independent code/security review, fix findings, commit/push authorized changes, verify production or clearly report access blocker.

