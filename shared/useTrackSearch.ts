import { useState, useEffect, useRef } from 'react';

// Lightweight, standalone iTunes-only search for surfaces that don't need the
// app's full dual-source scoring/dedup pipeline (that logic lives inline in
// the app's App.jsx and is tightly coupled to its playback engine -- see
// docs/ARCHITECTURE.md). The landing page only needs "type -> see plausible
// matches -> hand the query to the app", so this intentionally stays simple.

export interface TrackSuggestion {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  art: string | null;
}

function mapHit(hit: any): TrackSuggestion {
  return {
    id: hit.trackId,
    trackName: hit.trackName,
    artistName: hit.artistName,
    albumName: hit.collectionName ?? '',
    duration: hit.trackTimeMillis ? hit.trackTimeMillis / 1000 : 0,
    art: hit.artworkUrl100 ? hit.artworkUrl100.replace(/\d+x\d+bb/, '600x600bb') : null,
  };
}

export interface UseTrackSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  suggestions: TrackSuggestion[];
  isSearching: boolean;
}

export function useTrackSearch(debounceMs = 180): UseTrackSearchReturn {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<TrackSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); setIsSearching(false); return; }

    setIsSearching(true);
    debRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=8`,
          { signal: controller.signal },
        );
        const data = await res.json();
        setSuggestions(Array.isArray(data.results) ? data.results.map(mapHit) : []);
      } catch (error: any) {
        if (error?.name !== 'AbortError') setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, debounceMs);

    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [query, debounceMs]);

  return { query, setQuery, suggestions, isSearching };
}