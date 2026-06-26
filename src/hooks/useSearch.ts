// ─── useSearch Hook ───────────────────────────────────────────────────────────
// Debounced search with Genius + iTunes parallel requests, deduplication, scoring

import { useState, useEffect, useRef, useCallback } from 'react';
import { searchGenius, searchItunes } from '@/lib/api';
import type { SearchSuggestion } from '@/types';

const SEARCH_NOISE_RE =
  /\b(turkce ceviri|turkish translation|translation|translated|ceviri|çeviri|romanized|karaoke|nightcore|slowed|reverb|sped up|cover|tribute|parody|lyrics?|lyric video|official video|audio|visualizer)\b/i;

const _clean = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const normalizeArtist = (v = '') =>
  _clean(v).replace(/\b(the|dj|mc)\b/g, ' ').replace(/\s+/g, ' ').trim();

const normalizeTrack = (v = '') =>
  _clean(v)
    .replace(/\b(feat|ft|featuring)\b.*$/g, ' ')
    .replace(/\b(remaster(?:ed)?|live|version|edit|mono|stereo|explicit|clean|official|video|audio|visualizer|lyrics?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function tokenize(v = '') {
  return normalizeTrack(v).split(' ').filter(Boolean);
}

function tokenOverlap(a: string, b: string) {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (!aSet.size || !bSet.size) return 0;
  let hits = 0;
  for (const t of aSet) if (bSet.has(t)) hits++;
  return hits / Math.max(aSet.size, bSet.size);
}

function scoreCandidate(c: SearchSuggestion, query: string): number {
  const artist = c.artistName ?? '';
  const track = c.trackName ?? '';
  const album = c.albumName ?? '';
  const qClean = _clean(query);
  const combined = `${artist} ${track}`.trim();
  const reversed = `${track} ${artist}`.trim();

  let score = 0;
  score += tokenOverlap(combined, query) * 90;
  score += tokenOverlap(track, query) * 60;
  score += tokenOverlap(artist, query) * 50;

  if (_clean(combined) === qClean || _clean(reversed) === qClean) score += 75;
  else {
    if (_clean(track) && qClean.includes(_clean(track))) score += 34;
    if (_clean(artist) && qClean.includes(_clean(artist))) score += 30;
  }

  if (c.hasSynced) score += 10;
  if (c.art) score += 8;
  if ((c.duration ?? 0) > 30) score += 8;
  else if ((c.duration ?? 0) === 0) score -= c.source === 'itunes' ? 16 : 42;

  if (c.source === 'itunes') score += 18;
  else if (c.source === 'genius') score -= 4;

  const noisy =
    SEARCH_NOISE_RE.test(track) ||
    SEARCH_NOISE_RE.test(artist) ||
    SEARCH_NOISE_RE.test(album);
  if (noisy && !SEARCH_NOISE_RE.test(query)) score -= 72;

  return score;
}

const upgradeArtwork = (url: string | null | undefined, size: 'thumb' | 'full' = 'full') => {
  if (!url) return null;
  if (url.includes('mzstatic.com')) {
    const target = size === 'thumb' ? '120x120bb' : '1400x1400bb';
    return url.replace(/\d+x\d+bb/g, target);
  }
  return url;
};

const mapItunes = (h: any): SearchSuggestion => ({
  id: h.trackId ?? `${h.artistName}-${h.trackName}`,
  trackName: h.trackName,
  artistName: h.artistName,
  albumName: h.collectionName ?? '',
  duration: h.trackTimeMillis ? h.trackTimeMillis / 1000 : 0,
  art: h.artworkUrl100 ? upgradeArtwork(h.artworkUrl100, 'full') : null,
  genre: h.primaryGenreName ?? '',
  previewUrl: h.previewUrl ?? null,
  hasSynced: true,
  source: 'itunes',
});

const mapGenius = (h: any): SearchSuggestion => ({
  id: h.id ?? `${h.artist}-${h.title}`,
  trackName: h.title ?? '',
  artistName: h.artist ?? '',
  albumName: '',
  duration: h.duration ?? 0,
  art: h.art ?? null,
  hasSynced: false,
  source: 'genius',
  url: h.url ?? null,
});

function dedupeAndSort(items: SearchSuggestion[], query: string): SearchSuggestion[] {
  const seen = new Set<string>();
  const unique: SearchSuggestion[] = [];
  for (const item of items) {
    const key = `${normalizeArtist(item.artistName)}|${normalizeTrack(item.trackName)}`;
    if (!key || key === '|' || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique
    .map((item) => ({ ...item, _score: scoreCandidate(item, query) }))
    .filter((item) => (item as any)._score >= 14)
    .sort((a, b) => (b as any)._score - (a as any)._score)
    .slice(0, 8) as SearchSuggestion[];
}

function buildItunesQueries(query: string): string[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const queries = [query.trim()];
  if (tokens.length >= 2) {
    queries.push(tokens.slice().reverse().join(' '));
    queries.push(tokens.join('+'));
  }
  return [...new Set(queries)].slice(0, 3);
}

export interface SearchState {
  query: string;
  setQuery: (q: string) => void;
  suggestions: SearchSuggestion[];
  suggestionArts: Record<string, string>;
  showDrop: boolean;
  setShowDrop: (v: boolean) => void;
  isSuggesting: boolean;
  clearSearch: () => void;
}

export function useSearch(): SearchState {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionArts, setSuggestionArts] = useState<Record<string, string>>({});
  const [showDrop, setShowDrop] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setSuggestions([]);
      setShowDrop(false);
      setIsSuggesting(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSuggesting(true);
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const itunesQueries = buildItunesQueries(query);
        const [geniusRaw, ...itunesRaws] = await Promise.all([
          searchGenius(query),
          ...itunesQueries.map((q) => searchItunes(q, 8)),
        ]);

        const geniusMapped = (geniusRaw as any[]).map(mapGenius);
        const itunesMapped = (itunesRaws as any[][]).flat().map(mapItunes);
        const merged = dedupeAndSort([...geniusMapped, ...itunesMapped], query);

        setSuggestions(merged);
        setShowDrop(merged.length > 0);

        // Background art fill for Genius tracks missing artwork
        const missingArt = merged.filter((s) => !s.art && s.source === 'genius');
        if (missingArt.length > 0) {
          for (const item of missingArt) {
            searchItunes(`${item.artistName} ${item.trackName}`, 3)
              .then((results) => {
                const best = (results as any[]).find((r) => r.artworkUrl100);
                if (best) {
                  const artUrl = upgradeArtwork(best.artworkUrl100, 'full');
                  if (artUrl) {
                    const key = `${item.artistName}|${item.trackName}`;
                    setSuggestionArts((prev) => ({ ...prev, [key]: artUrl }));
                  }
                }
              })
              .catch(() => {});
          }
        }
      } finally {
        setIsSuggesting(false);
      }
    }, 180);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setSuggestions([]);
    setShowDrop(false);
    setIsSuggesting(false);
  }, []);

  return {
    query,
    setQuery,
    suggestions,
    suggestionArts,
    showDrop,
    setShowDrop,
    isSuggesting,
    clearSearch,
  };
}
