# Aurora Player

A music-first React PWA with an artwork-led player, responsive discovery, local favorites, a queue, and synchronized lyrics. No account is required. The former marketing site redirects straight into the app.

## Run

```sh
npm ci
npm run dev -- --port 5187
```

Vite serves the same `/api/video/search` and `/api/lyrics/structured` handlers used on Vercel. The separate `server/` folder is a legacy optional backend; it is not required for the web app.

```sh
npm run lint
npm test
npm run build
npm run preview -- --port 5188
```

## Listening

Search has All, Songs, Videos, Albums, Artists and Playlists: songs and albums from iTunes, artists from Deezer, and videos and playlists from YouTube (remixes, slowed and sped-up edits, mashups, live sets), with a top result that follows intent. Online playback uses the YouTube IFrame player; availability, advertisements and audio quality are controlled by that source. Aurora adds no application advertisements. Device audio plays directly with the browser's supported codecs. Aurora reads each file's real format (for example FLAC 24-bit/96 kHz) and, outside DJ blends, plays it through a direct path with no effects; multichannel files go to every available speaker. Lossless and Dolby Atmos streaming require licensed services, so Aurora does not claim them for online songs. Favorites and history stay in local storage; local audio files are never uploaded.

Lyrics race BetterLyrics (plus its QQ source), Bini Lyrics, LyricsPlus, LRCLib exact and fuzzy search, KuGou (word-timed KRC) and NetEase Cloud Music, with SimpMusic available when a YouTube ID resolves; titles decorated with “feat.” or remaster notes are retried in their plain form. Genuine word timing is preferred, followed by line timing and plain text. Timing is never fabricated. Provider outages and missing lyrics do not stop audio.

## Design and motion

One responsive visual system connects discovery, search, library, queue and the full-screen player. Motion handles carousel springs and view transitions. [Calligraph](https://calligraph.raphaelsalaja.com/) animates changing track titles. [Tegaki](https://github.com/gkurt/tegaki) generated the welcome handwriting SVG at build time; its generator is not included in the runtime bundle. Reduced-motion preferences are respected.

[BitChord](https://github.com/kushagrasinghx/BitChord) informed the lyrics-provider research. Aurora's JavaScript adapters and renderer were independently implemented; no GPL implementation was copied. Music, cover art and lyrics remain the property of their respective rights holders.

## Deployment

The repository root is the Vercel Vite application (`npm run build`, output `dist`). `web/` only holds the redirect for the former `aurora-player-tpainn.vercel.app` landing deployment. Both projects follow the production branch.

The installable PWA caches its visited application shell and assets. Online catalogue, YouTube and lyric requests still require connectivity; it does not download music for offline use.

For opt-in diagnostics open `/?audit=1` and inspect the `#aurora-audit` output. Measurements stay in the page and are never sent elsewhere. See [performance audit](docs/PERFORMANCE-AUDIT.md), [design](DESIGN.md), and [product scope](PRODUCT.md).

## License

MIT for Aurora source; third-party packages retain their own licenses.

DJ mode glides the ending song into the next song's tempo before a beat-aligned, five-second blend. Local audio adds a hollow filter sweep and echo tail. Online playback overlaps two YouTube decks, and changes tempo only when catalogue BPM and the player allow it. With DJ off, online songs still hand over seamlessly. Altered uploads (8D, slowed, sped up, nightcore…) are only chosen when the song or your search asks for them. Back and swipe gestures close the top layer first and never leave the app by accident. The queue tops itself up in small batches based on what you finish, skip and like, and the home screen (spotlight, Made for you, Because you listened, Daily rotation) follows your own listening, likes and recent plays. Keyboard: Space, ← →, Shift+← →, L, M, F, /. See [DJ transition details](docs/DJ-TRANSITION.md) and the [live interaction tests](docs/LIVE-TESTS.md). Radio stays in the seed's language and a compatible genre. Search runs through the same-origin `/api/search` endpoint, and `/api/tempo` returns catalogue BPM. Recommendations and listening preferences remain account-free.

