# Motion, DJ transitions and coherent radio

**Goal:** Slower, continuous motion everywhere; lyrics that glide instead of snap; DJ transitions that glide the outgoing song's tempo into the next song's tempo and blend with a hollow effect; radio that stays in the same language and vibe; search and bug fixes found in the audit.

## Constraints
- No fabricated lyric timings, BPM or audio claims. Tempo is used only when measured (local PCM) or supplied by the catalogue (Deezer `bpm`), and only claimed in the UI when the player confirms the rate.
- YouTube exposes no PCM: filters (hollow) and measured BPM are local-audio only. Online gets a true two-deck overlap, plus a tempo glide when catalogue BPM exists for both songs and the embed accepts fine playback rates (verified with `getPlaybackRate`).
- Reduced motion is respected; the dark/mint system stays. Existing Motion (framer-motion) primitives only.

## Spec
### DJ engine (`src/lib/dj.js`, pure + tested)
1. `estimateTempo` also returns beat `phase` (seconds of the first beat in the analysed window).
2. `findIntroStart` uses a threshold relative to the intro's own loudness (quiet fade-ins and noise floors are skipped, soft musical intros are kept), and is snapped forward to the first beat when a tempo is known.
3. `planTransition`: overlap ≈ 5 s quantised to whole bars (clamped 4–7 s); tempo shift bound ±8 %; returns `rampSeconds` (a glide of up to 8 s *before* the overlap so song A reaches song B's tempo as the blend begins).
4. `planOnlineCue(duration, lyrics)`: outgoing cue after the last genuinely timed vocal line inside the final 30 s, otherwise the natural ending.
5. `beatAlignedEntry`: incoming cue so its first beat lands on the outgoing beat grid (rate-aware).
6. `tempoRamp(progress)` smoothstep easing for rate glides.

Local mix = tempo glide → equal-power overlap with band-narrowing hollow sweep (high-pass up, low-pass down) and a tempo-synced echo tail that decays after the outgoing deck; incoming opens from hollow to full range. `preservesPitch` stays on.

Online mix = standby YouTube deck is pre-buffered muted ~20 s before the cue, starts at the cue, equal-power volume overlap, video surfaces crossfade. If the standby does not start within 3 s the engine falls back to the previous fade-out/fade-in path.

### Radio (`api/_lib/recommendations.js`, `shared/language.js`)
- Language profile from script (Greek, Cyrillic, Hangul, Kana, Han, Arabic, Hebrew, Devanagari, Thai) and, for Latin script, stop-word scoring of real lyrics (LRCLib) — plus regional iTunes genres as a weak hint.
- Seed language: client-provided `lang` (from loaded lyrics) → seed lyrics/script → genre hint.
- Candidates: Deezer artist radio + related artists + own top tracks. A candidate whose language is confirmed different is dropped; confirmed matches rank above unknowns. Album genre families (cached) must intersect the seed's when both known. At most 2 songs per artist.
- `/api/tempo` returns catalogue BPM (Deezer) for DJ use; cached.

### Lyrics
- Soft feathered word wipe (mask gradient) instead of a hard clip; slow word lift/glow.
- Line emphasis transitions 700–900 ms; long eased auto-scroll (custom rAF, interruptible) instead of the native 300 ms jump.
- Interlude indicator breathes through instrumental gaps.

### Motion & UX
- Page crossfade/rise between Home/Search/Library; immersive player opens with a slow rise and closes with a fall; sheets slide from the bottom on mobile and scale in on desktop, with backdrop fade; artwork and background crossfade on track change; staggered list entrances; queue removals animate; toast springs; DJ pill shows live blend progress; seek progress interpolates.

### Audit fixes
- Re-arm DJ after seek/pause (`attemptedMix` reset by user actions only).
- Seek slider commits on release instead of seeking YouTube on every drag event.
- Search: keep previous results while refining, skeletons on first load, recent searches, dedupe versions, Enter plays the top result, real retry.

## Postconditions
`npm run lint`, `npm test`, `npm run build` green; Playwright desktop + mobile previews with stubbed APIs show home, search, player, lyrics, sheets without console errors.
