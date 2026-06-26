// ─── Aurora Structured Lyrics Types ─────────────────────────────────────────

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
  label: string;        // Original header, e.g. "Verse 1", "Chorus", "Pre-Chorus"
  content: string[];    // Array of lyric lines in this section
  timestamp?: number;   // Optional start time (from LRCLib sync)
}

export interface StructuredLyrics {
  artist: string;
  title: string;
  sections: LyricsSection[];
  rawText: string;               // Full plain text
  source: 'genius-api' | 'genius-ajax' | 'genius-cheerio' | 'genius-puppeteer' | 'genius-rapidapi' | 'musixmatch-rapidapi' | 'timestamp-rapidapi' | 'lrclib';
  syncedLrc?: string;            // Raw LRC string if from LRCLib
  richSyncJson?: string;         // Raw rich sync JSON if available
  fetchedAt: number;             // Date.now() timestamp
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface ScraperResult {
  lyrics: StructuredLyrics | null;
  error?: string;
}
