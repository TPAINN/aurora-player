// ─── Aurora LRU Cache ───────────────────────────────────────────────────────
// In-memory LRU with TTL. SQLite-ready interface for future persistence.

import type { StructuredLyrics, CacheEntry } from './types.js';

const DEFAULT_TTL = 60 * 60 * 1000;  // 1 hour
const MAX_ENTRIES = 200;

export class LyricsCache {
  private store = new Map<string, CacheEntry<StructuredLyrics>>();
  private ttl: number;
  private maxEntries: number;

  constructor(ttl = DEFAULT_TTL, maxEntries = MAX_ENTRIES) {
    this.ttl = ttl;
    this.maxEntries = maxEntries;
  }

  /** Normalize cache key from artist + title */
  static key(artist: string, title: string): string {
    return `${artist}|${title}`
      .toLowerCase()
      .replace(/[^a-z0-9|]/g, '')
      .trim();
  }

  get(artist: string, title: string): StructuredLyrics | null {
    const key = LyricsCache.key(artist, title);
    const entry = this.store.get(key);
    if (!entry) return null;

    // Expired — evict
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // LRU: move to end (most recent)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(artist: string, title: string, value: StructuredLyrics): void {
    const key = LyricsCache.key(artist, title);

    // Evict oldest if at capacity
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttl,
    });
  }

  has(artist: string, title: string): boolean {
    return this.get(artist, title) !== null;
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

// Singleton instance
export const lyricsCache = new LyricsCache();
