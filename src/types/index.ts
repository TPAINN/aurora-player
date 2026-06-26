// ─── Aurora Player — Shared Frontend Types ────────────────────────────────────

export type SectionType =
  | 'verse'
  | 'chorus'
  | 'pre-chorus'
  | 'bridge'
  | 'intro'
  | 'outro'
  | 'hook'
  | 'interlude'
  | 'post-chorus'
  | 'refrain'
  | 'unknown';

export interface LyricsSection {
  type: SectionType;
  label: string;
  content: string[];
  timestamp?: number;
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface LyricLine {
  time: number;
  text: string;
  words: WordTiming[] | null;
  hasRichSync: boolean;
  isGap?: boolean;
}

export interface StructuredLyrics {
  artist: string;
  title: string;
  sections: LyricsSection[];
  rawText: string;
  source: string;
  syncedLrc?: string;
  richSyncJson?: string;
  fetchedAt: number;
}

export interface TrackMeta {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  art?: string | null;
  genre?: string;
  url?: string | null;
  hasSynced?: boolean;
  source?: string;
}

export interface SearchSuggestion extends TrackMeta {
  id: string | number;
  previewUrl?: string | null;
}

export interface SongState {
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  art: string | null;
  genre: string;
}

export type RevealPhase = 'idle' | 'cover' | 'playing';

export interface BeatPalette {
  c: string[];
  glow: string[];
  dim: string;
  bg: string;
}

export interface ChorusRange {
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
}

export interface HistoryEntry {
  trackName: string;
  artistName: string;
  albumName?: string;
  art?: string | null;
  duration?: number;
  ts: number;
}

export type PerfTier = 'low' | 'mid' | 'high';
