# 🎵 Aurora Player

**Premium synchronized lyrics player** — word-level karaoke, beat-reactive visuals, YouTube integration.

![Aurora Player](public/icons.svg)

## Features

- **Word-level karaoke** — every word highlights exactly on beat (Enhanced LRC + Rich Sync)
- **Beat-reactive background** — canvas animations that pulse with the music
- **YouTube integration** — plays the official video/audio in the background
- **Album art color extraction** — Material You adaptive palette from every album cover
- **Section detection** — verse, pre-chorus, chorus, bridge each trigger different visuals
- **Zen mode** — distraction-free full-screen lyrics
- **Smart search** — iTunes + Genius fallback with phonetic normalization
- **History & recommendations** — picks up where you left off
- **PWA** — install on mobile, works offline for the app shell

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Framer Motion + Vite 8 |
| Backend | Node 22 + Express + TypeScript |
| Lyrics | LRCLib · Genius (scraper) · Musixmatch (RapidAPI) |
| Music meta | iTunes Search API |
| Video | YouTube IFrame API (youtube-nocookie.com) |
| Deploy | Vercel (frontend) · Render (backend) |

## Getting started

```bash
# Clone
git clone https://github.com/TPAINN/aurora-player.git
cd aurora-player

# Install frontend
npm install

# Install backend
npm install --prefix server

# Configure backend (copy .env.example → .env)
cp server/.env.example server/.env
# Add your GENIUS_ACCESS_TOKEN and RAPIDAPI_KEY

# Start everything
npm run dev
```

Open http://localhost:5173

## Environment variables

**Backend** (`server/.env`):
```
GENIUS_ACCESS_TOKEN=   # https://genius.com/api-clients
RAPIDAPI_KEY=          # https://rapidapi.com (for Musixmatch + Timestamp Lyrics)
PORT=3001
```

**Frontend** (Vercel env vars):
```
VITE_API_BASE_URL=https://aurora-player-api.onrender.com
```

## Deploy

**Frontend → Vercel:**
1. Import `TPAINN/aurora-player` in Vercel
2. Framework: Vite, root: `/`
3. Add env var: `VITE_API_BASE_URL=https://aurora-player-api.onrender.com`

**Backend → Render:**
1. New Web Service → connect `TPAINN/aurora-player`
2. Root: `server`, build: `npm install && npm run build`, start: `node dist/index.js`
3. Add env vars: `GENIUS_ACCESS_TOKEN` and `RAPIDAPI_KEY`

Or use the included `render.yaml` for automatic setup.

## License

MIT — open source, do whatever you want.
