// ─── usePlayer Hook ───────────────────────────────────────────────────────────
// Core playback engine: LRC loading, rAF tick, seek, YouTube IFrame API

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  parseLRC,
  parseRichSync,
  injectGaps,
  findActiveLyricIndex,
  buildChorusRangesFromSections,
  detectChorusRanges,
  countRichLines,
} from '@/lib/lyrics';
import { fetchLrcLib, searchLrcLib, fetchStructuredLyrics, fetchVideoId } from '@/lib/api';
import { extractColors, buildPalette, applyPalette, DEFAULT_PALETTE } from '@/lib/colors';
import type {
  LyricLine,
  SongState,
  RevealPhase,
  BeatPalette,
  ChorusRange,
  HistoryEntry,
  SearchSuggestion,
} from '@/types';

const HISTORY_KEY = 'aurora_history_v2';
const MAX_HISTORY = 20;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {}
}

export interface PlayerReturn {
  // Playback state
  song: SongState | null;
  lyrics: LyricLine[];
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  activeIndex: number;
  lyricsOffset: number;
  setLyricsOffset: (v: number | ((prev: number) => number)) => void;

  // YouTube
  ytVideoId: string | null;
  ytReady: boolean;
  isVideoLoading: boolean;
  videoBgActive: boolean;
  setVideoBgActive: (v: boolean) => void;

  // UI state
  revealPhase: RevealPhase;
  isChorus: boolean;
  showMelody: boolean;
  showCountdown: boolean;
  activeSection: string;
  beatPalette: BeatPalette;
  history: HistoryEntry[];

  // Refs for imperative seek bar updates
  seekFillRef: React.RefObject<HTMLDivElement | null>;
  seekThumbRef: React.RefObject<HTMLDivElement | null>;
  currentTimeDisplayRef: React.RefObject<HTMLSpanElement | null>;
  lyricsRef: React.RefObject<HTMLDivElement | null>;
  beatRingRef: React.RefObject<HTMLDivElement | null>;

  // Actions
  loadTrack: (track: SearchSuggestion) => Promise<void>;
  togglePlay: () => void;
  handleBack: () => void;
  handleReset: () => void;
  seekTo: (t: number) => void;
  handleSeekStart: (clientX: number) => void;
  clearHistory: () => void;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
    __ytAPILoading?: boolean;
  }
}

export function usePlayer(): PlayerReturn {
  const [song, setSong] = useState<SongState | null>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [lyricsOffset, setLyricsOffset] = useState(0);
  const [ytVideoId, setYtVideoId] = useState<string | null>(null);
  const [ytReady, setYtReady] = useState(false);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoBgActive, setVideoBgActive] = useState(false);
  const [revealPhase, setRevealPhase] = useState<RevealPhase>('idle');
  const [isChorus, setIsChorus] = useState(false);
  const [showMelody, setShowMelody] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [beatPalette, setBeatPalette] = useState<BeatPalette>(DEFAULT_PALETTE);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  // Refs
  const seekFillRef = useRef<HTMLDivElement>(null);
  const seekThumbRef = useRef<HTMLDivElement>(null);
  const currentTimeDisplayRef = useRef<HTMLSpanElement>(null);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const beatRingRef = useRef<HTMLDivElement>(null);

  const rafRef = useRef<number | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const seekBaseRef = useRef(0);
  const wallBaseRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lyricsDataRef = useRef<LyricLine[]>([]);
  const chorusRangesRef = useRef<ChorusRange[]>([]);
  const sectionMapRef = useRef<string[]>([]);
  const lyricsOffsetRef = useRef(0);
  const beatDecayRef = useRef(0);
  const prevLineRef = useRef(-1);
  const lastActiveIndexRef = useRef(-1);
  const suppressUntilRef = useRef(0);
  const songRef = useRef<SongState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep songRef in sync
  useEffect(() => { songRef.current = song; }, [song]);
  useEffect(() => { lyricsOffsetRef.current = lyricsOffset; }, [lyricsOffset]);

  // ─── YouTube IFrame API bootstrap ────────────────────────────────────────────
  useEffect(() => {
    if (window.YT?.Player) { setYtReady(true); return; }
    if (window.__ytAPILoading) {
      const orig = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { orig?.(); setYtReady(true); };
      return;
    }
    window.__ytAPILoading = true;
    window.onYouTubeIframeAPIReady = () => setYtReady(true);
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }, []);

  // ─── Create/destroy YouTube player ───────────────────────────────────────────
  useEffect(() => {
    if (!ytReady || !ytVideoId) return;
    setIsVideoLoading(true);

    if (ytPlayerRef.current) {
      try { ytPlayerRef.current.loadVideoById(ytVideoId); }
      catch { ytPlayerRef.current = null; }
      return;
    }

    const container = document.getElementById('yt-player');
    if (!container) return;

    ytPlayerRef.current = new window.YT.Player('yt-player', {
      videoId: ytVideoId,
      playerVars: {
        autoplay: 1, controls: 0, disablekb: 1, fs: 0,
        iv_load_policy: 3, modestbranding: 1, rel: 0, enablejsapi: 1,
      },
      events: {
        onReady: () => setIsVideoLoading(false),
        onStateChange: (e: any) => {
          if (e.data === 1) setIsVideoLoading(false);
        },
      },
    });
  }, [ytReady, ytVideoId]);

  // ─── seekTo ──────────────────────────────────────────────────────────────────
  const seekTo = useCallback((t: number) => {
    const dur = songRef.current?.duration ?? 1;
    const clamped = Math.max(0, Math.min(dur, t));
    seekBaseRef.current = clamped;
    wallBaseRef.current = performance.now();
    suppressUntilRef.current = performance.now() + 300;
    setCurrentTime(clamped);

    if (seekFillRef.current) {
      seekFillRef.current.style.width = `${(clamped / dur) * 100}%`;
    }
    if (seekThumbRef.current) {
      seekThumbRef.current.style.left = `${(clamped / dur) * 100}%`;
    }
    if (currentTimeDisplayRef.current) {
      currentTimeDisplayRef.current.textContent = fmt(clamped);
    }
    try { ytPlayerRef.current?.seekTo(clamped, true); } catch {}
  }, []);

  // ─── Seek bar interaction ─────────────────────────────────────────────────────
  const getSeekTime = useCallback((clientX: number): number => {
    const bar = seekFillRef.current?.parentElement;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * (songRef.current?.duration ?? 1);
  }, []);

  const handleSeekStart = useCallback((clientX: number) => {
    isDraggingRef.current = true;
    seekTo(getSeekTime(clientX));
  }, [seekTo, getSeekTime]);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const t = getSeekTime(clientX);
      const dur = songRef.current?.duration ?? 1;
      if (seekFillRef.current) seekFillRef.current.style.width = `${(t / dur) * 100}%`;
      if (seekThumbRef.current) seekThumbRef.current.style.left = `${(t / dur) * 100}%`;
      if (currentTimeDisplayRef.current) currentTimeDisplayRef.current.textContent = fmt(t);
    };
    const onUp = (e: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
      seekTo(getSeekTime(clientX));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [getSeekTime, seekTo]);

  // ─── rAF tick ────────────────────────────────────────────────────────────────
  const handleTrackEnded = useCallback(() => {
    setIsPlaying(false);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  const tick = useCallback(() => {
    const lyrs = lyricsDataRef.current;
    const s = songRef.current;
    if (!s || !lyrs.length) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const elapsed = (performance.now() - wallBaseRef.current) / 1000;
    const t = Math.min(seekBaseRef.current + elapsed, s.duration + 0.5);
    const dur = s.duration;

    // Imperative seek bar update
    if (!isDraggingRef.current) {
      if (seekFillRef.current) seekFillRef.current.style.width = `${(t / dur) * 100}%`;
      if (seekThumbRef.current) seekThumbRef.current.style.left = `${(t / dur) * 100}%`;
      if (currentTimeDisplayRef.current) currentTimeDisplayRef.current.textContent = fmt(t);
    }

    const tLyrics = t + lyricsOffsetRef.current;
    const activeIdx = findActiveLyricIndex(lyrs, tLyrics);

    // Chorus detection
    const inChorus = chorusRangesRef.current.some(
      (r) => t >= r.start - 0.3 && t <= r.end + 0.5,
    );
    if (inChorus !== isChorus) setIsChorus(inChorus);

    // Beat pulse decay
    beatDecayRef.current *= 0.84;
    const bp = beatDecayRef.current;
    document.documentElement.style.setProperty('--beat-pulse', String(bp));
    if (beatRingRef.current) {
      beatRingRef.current.style.opacity = String(Math.min(1, bp * 1.4));
      beatRingRef.current.style.transform = `scale(${1 + bp * 0.06})`;
    }

    // Detect instrumental gap / countdown
    const nextLine = activeIdx + 1 < lyrs.length ? lyrs[activeIdx + 1] : null;
    const timeTillNext = nextLine ? nextLine.time - t : 999;
    const gapLine = activeIdx >= 0 ? lyrs[activeIdx] : null;
    const inMelody = !!(gapLine?.isGap && timeTillNext > 2);
    const inCountdown = !inMelody && timeTillNext > 0.5 && timeTillNext < 4;

    if (inMelody !== showMelody) setShowMelody(inMelody);
    if (inCountdown !== showCountdown) setShowCountdown(inCountdown);

    // Update currentTime only on line change to minimize re-renders
    if (activeIdx !== lastActiveIndexRef.current) {
      lastActiveIndexRef.current = activeIdx;
      setCurrentTime(t);
    }

    if (t >= s.duration + 0.2) {
      handleTrackEnded();
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [handleTrackEnded, isChorus, showMelody, showCountdown]);

  // Start/stop rAF based on isPlaying
  useEffect(() => {
    if (isPlaying) {
      wallBaseRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    }
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [isPlaying, tick]);

  // ─── Active index (memoized for render) ──────────────────────────────────────
  const activeLyricTime = useMemo(() => currentTime + lyricsOffset, [currentTime, lyricsOffset]);
  const activeIndex = useMemo(
    () => findActiveLyricIndex(lyrics, activeLyricTime),
    [lyrics, activeLyricTime],
  );

  // ─── Auto-scroll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeIndex < 0 || !lyricsRef.current) return;
    const container = lyricsRef.current;
    const el = container.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    if (!el) return;
    const containerH = container.clientHeight;
    const target = el.offsetTop - containerH * 0.38;
    container.scrollTo({ top: target, behavior: 'smooth' });
  }, [activeIndex]);

  // ─── togglePlay ──────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    if (!song) return;
    setIsPlaying((prev) => {
      const next = !prev;
      if (next) {
        wallBaseRef.current = performance.now();
        try { ytPlayerRef.current?.playVideo(); } catch {}
      } else {
        seekBaseRef.current += (performance.now() - wallBaseRef.current) / 1000;
        try { ytPlayerRef.current?.pauseVideo(); } catch {}
      }
      return next;
    });
  }, [song]);

  // ─── stopAll ─────────────────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { ytPlayerRef.current?.stopVideo(); } catch {}
    seekBaseRef.current = 0;
    wallBaseRef.current = 0;
    beatDecayRef.current = 0;
    prevLineRef.current = -1;
    lastActiveIndexRef.current = -1;
    setIsPlaying(false);
    setIsChorus(false);
    setShowMelody(false);
    setShowCountdown(false);
    setCurrentTime(0);
  }, []);

  // ─── loadTrack ───────────────────────────────────────────────────────────────
  const loadTrack = useCallback(async (track: SearchSuggestion) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    stopAll();
    setIsLoading(true);
    setLyrics([]);
    setRevealPhase('idle');
    setYtVideoId(null);
    setVideoBgActive(false);
    setActiveSection('');
    lyricsDataRef.current = [];
    chorusRangesRef.current = [];
    sectionMapRef.current = [];

    const artist = track.artistName ?? '';
    const title = track.trackName ?? '';
    const duration = track.duration ?? 0;
    const art = track.art ?? null;

    const newSong: SongState = {
      trackName: title,
      artistName: artist,
      albumName: track.albumName ?? '',
      duration: duration || 240,
      art,
      genre: track.genre ?? '',
    };
    setSong(newSong);
    songRef.current = newSong;

    // Update history
    const entry: HistoryEntry = {
      trackName: title,
      artistName: artist,
      albumName: track.albumName,
      art,
      duration,
      ts: Date.now(),
    };
    setHistory((prev) => {
      const filtered = prev.filter(
        (h) => !(h.trackName === title && h.artistName === artist),
      );
      const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
      saveHistory(updated);
      return updated;
    });

    // Apply album art colors
    if (art) {
      extractColors(art).then((colors) => {
        const palette = buildPalette(colors);
        setBeatPalette(palette);
        applyPalette(palette);
      }).catch(() => {});
    } else {
      setBeatPalette(DEFAULT_PALETTE);
      applyPalette(DEFAULT_PALETTE);
    }

    // Show cover reveal
    setRevealPhase('cover');

    // ── Fetch synced lyrics ────────────────────────────────────────────────
    let parsedLyrics: LyricLine[] = [];
    let structuredSections: any[] = [];

    try {
      // Try LRCLib exact match
      const lrcData = await fetchLrcLib(artist, title, track.albumName, duration);
      if (lrcData?.syncedLyrics) {
        // Prefer richSync if available
        if (lrcData.richSyncLyrics) {
          const rich = parseRichSync(lrcData.richSyncLyrics);
          if (rich && rich.length > 3) {
            parsedLyrics = injectGaps(rich);
          }
        }
        if (parsedLyrics.length === 0) {
          parsedLyrics = injectGaps(parseLRC(lrcData.syncedLyrics));
        }
        if (duration === 0 && lrcData.duration) {
          newSong.duration = lrcData.duration;
          setSong({ ...newSong });
          songRef.current = { ...newSong };
        }
      }
    } catch {}

    // LRCLib fuzzy fallback
    if (parsedLyrics.length === 0) {
      try {
        const results = await searchLrcLib(`${artist} ${title}`);
        const best = results.find((r: any) => r.syncedLyrics);
        if (best?.syncedLyrics) {
          parsedLyrics = injectGaps(parseLRC(best.syncedLyrics));
          if (best.duration && newSong.duration === 240) {
            newSong.duration = best.duration;
            setSong({ ...newSong });
            songRef.current = { ...newSong };
          }
        }
      } catch {}
    }

    // Backend structured lyrics fallback
    if (parsedLyrics.length === 0) {
      try {
        const structured = await fetchStructuredLyrics(artist, title);
        if (structured) {
          structuredSections = structured.sections ?? [];
          if (structured.syncedLrc) {
            parsedLyrics = injectGaps(parseLRC(structured.syncedLrc));
          }
        }
      } catch {}
    }

    if (parsedLyrics.length > 0) {
      lyricsDataRef.current = parsedLyrics;
      setLyrics(parsedLyrics);

      // Chorus detection
      if (structuredSections.length > 0) {
        chorusRangesRef.current = buildChorusRangesFromSections(parsedLyrics, structuredSections);
      } else {
        chorusRangesRef.current = detectChorusRanges(parsedLyrics);
      }
    }

    setIsLoading(false);
    setRevealPhase('playing');
    setIsPlaying(true);
    wallBaseRef.current = performance.now();

    // Background: fetch YouTube video
    fetchVideoId(artist, title, duration).then((vid) => {
      if (vid) {
        setYtVideoId(vid);
        setVideoBgActive(true);
      }
    }).catch(() => {});
  }, [stopAll]);

  // ─── handleBack ──────────────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    stopAll();
    setSong(null);
    setLyrics([]);
    setYtVideoId(null);
    setRevealPhase('idle');
    setIsLoading(false);
    setActiveSection('');
    setBeatPalette(DEFAULT_PALETTE);
    applyPalette(DEFAULT_PALETTE);
    lyricsDataRef.current = [];
    chorusRangesRef.current = [];
  }, [stopAll]);

  // ─── handleReset ─────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    seekBaseRef.current = 0;
    wallBaseRef.current = performance.now();
    setCurrentTime(0);
    try { ytPlayerRef.current?.seekTo(0, true); ytPlayerRef.current?.pauseVideo(); } catch {}
    setIsPlaying(false);
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  return {
    song,
    lyrics,
    isPlaying,
    isLoading,
    currentTime,
    activeIndex,
    lyricsOffset,
    setLyricsOffset,
    ytVideoId,
    ytReady,
    isVideoLoading,
    videoBgActive,
    setVideoBgActive,
    revealPhase,
    isChorus,
    showMelody,
    showCountdown,
    activeSection,
    beatPalette,
    history,
    seekFillRef,
    seekThumbRef,
    currentTimeDisplayRef,
    lyricsRef,
    beatRingRef,
    loadTrack,
    togglePlay,
    handleBack,
    handleReset,
    seekTo,
    handleSeekStart,
    clearHistory,
  };
}
