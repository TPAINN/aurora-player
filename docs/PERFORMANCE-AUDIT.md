# Release audit — 2026-09-30

## Verified

- ESLint and legacy server TypeScript checks passed. 28 Node tests passed covering lyric parsers, resource/SSRF boundaries, recommendations, search, source scoring, DJ timing/envelopes and local preference ranking.
- Production build: JavaScript 400.96 KB raw / 127.76 KB gzip; CSS 36.76 KB / 8.85 KB gzip. Tegaki is generated ahead of time, not shipped as a runtime dependency.
- Browser preview at 390×844: LCP 260ms, CLS 0, zero observed long tasks, frame interval P95 8ms. Warm desktop hardware, no CPU/network throttling; these are not physical-phone or cold-network results. The last 3,600-frame sample had one frame above 33ms.
- 320×568 player had no horizontal overflow; seek bar was within viewport at y367–371. Mobile Previous/Next, independent Video mode, nested settings Back and closing transitions were exercised. Empty player is absent from both DOM and rendered home.
- Word fill now reads actual media time in one bounded animation loop; no whole-app 60fps rendering or delayed CSS interpolation. Reduced motion, seeks and cleanup are handled.
- Independent reviews found rapid-Next cursor loss and excessive LRC timestamp expansion; both corrected. Search now uses a bounded same-origin endpoint; live natori/Billie Eilish requests returned 36 results.

## Limits and outstanding device coverage

Physical Android/iOS, throttled mobile performance, subjective musical quality across a large catalogue, and every provider outage combination are not certified. YouTube buffering, ads and stream quality remain source-controlled. Online DJ uses volume fades, not Web Audio beatmatching. Exact lyric alignment depends on provider timestamps matching the selected recording.

No claim of universal zero buffering, perfect beat phase, or an end-to-end Lighthouse score is made. Production availability must be checked after deployment.
