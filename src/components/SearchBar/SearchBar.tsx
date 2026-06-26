// ─── SearchBar Component ──────────────────────────────────────────────────────

import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, History, Clock, Music2 } from 'lucide-react';
import type { SearchSuggestion, HistoryEntry } from '@/types';
import './SearchBar.css';

const fmt = (s: number) =>
  s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';

interface SearchBarProps {
  query: string;
  setQuery: (q: string) => void;
  suggestions: SearchSuggestion[];
  suggestionArts: Record<string, string>;
  showDrop: boolean;
  setShowDrop: (v: boolean) => void;
  isSuggesting: boolean;
  history: HistoryEntry[];
  clearHistory: () => void;
  onSelect: (track: SearchSuggestion) => void;
  autoFocus?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({
  query,
  setQuery,
  suggestions,
  suggestionArts,
  showDrop,
  setShowDrop,
  isSuggesting,
  history,
  clearHistory,
  onSelect,
  autoFocus,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = React.useState(false);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handleSelect = (track: SearchSuggestion) => {
    setShowDrop(false);
    setShowHistory(false);
    onSelect(track);
  };

  const handleHistorySelect = (entry: HistoryEntry) => {
    setShowHistory(false);
    onSelect({
      id: `${entry.artistName}-${entry.trackName}`,
      trackName: entry.trackName,
      artistName: entry.artistName,
      albumName: entry.albumName ?? '',
      duration: entry.duration ?? 0,
      art: entry.art ?? null,
      hasSynced: true,
      source: 'history',
    });
  };

  const getArt = (s: SearchSuggestion) => {
    if (s.art) return s.art;
    const key = `${s.artistName}|${s.trackName}`;
    return suggestionArts[key] ?? null;
  };

  const showHistoryDrop = showHistory && !query && history.length > 0;
  const showSuggestionDrop = showDrop && query.trim().length > 0 && suggestions.length > 0;

  return (
    <div className="sbar">
      <div className="sbar__row">
        <div className="sbar__box">
          <Search className="sbar__icon" size={18} />
          <input
            ref={inputRef}
            className="sbar__input"
            type="text"
            placeholder="Artist, song, or album..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowHistory(false);
            }}
            onFocus={() => {
              if (!query && history.length > 0) setShowHistory(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                setShowDrop(false);
                setShowHistory(false);
              }
              if (e.key === 'Enter' && suggestions[0]) {
                handleSelect(suggestions[0]);
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <AnimatePresence>
            {(query || isSuggesting) && (
              <motion.button
                className="sbar__clear"
                onClick={() => { setQuery(''); setShowDrop(false); inputRef.current?.focus(); }}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                aria-label="Clear search"
              >
                {isSuggesting
                  ? <span className="sbar__spinner" />
                  : <X size={14} />}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {history.length > 0 && (
          <button
            className={`sbar__hist-btn${showHistoryDrop ? ' active' : ''}`}
            onClick={() => { setShowHistory((v) => !v); setShowDrop(false); }}
            aria-label="Search history"
          >
            <History size={16} />
          </button>
        )}
      </div>

      {/* Suggestions dropdown */}
      <AnimatePresence>
        {showSuggestionDrop && (
          <motion.div
            className="sbar__drop"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <div className="sbar__drop-label">Best Matches</div>
            {suggestions.map((s, i) => {
              const art = getArt(s);
              return (
                <motion.button
                  key={`${s.id}-${i}`}
                  className="sbar__drop-item"
                  onClick={() => handleSelect(s)}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <div className="sbar__drop-art">
                    {art
                      ? <img src={art} alt="" loading="lazy" />
                      : <Music2 size={14} />}
                  </div>
                  <div className="sbar__drop-info">
                    <span className="sbar__drop-track">{s.trackName}</span>
                    <span className="sbar__drop-meta">
                      {s.artistName}
                      {s.albumName ? ` · ${s.albumName}` : ''}
                    </span>
                  </div>
                  {s.duration ? (
                    <span className="sbar__drop-dur">{fmt(s.duration)}</span>
                  ) : null}
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* History dropdown */}
      <AnimatePresence>
        {showHistoryDrop && (
          <motion.div
            className="sbar__drop"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <div className="sbar__drop-label">
              Listening History
              <button className="sbar__hist-clear" onClick={clearHistory}>Clear</button>
            </div>
            {history.map((entry, i) => (
              <motion.button
                key={`hist-${i}`}
                className="sbar__drop-item"
                onClick={() => handleHistorySelect(entry)}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <div className="sbar__drop-art">
                  {entry.art
                    ? <img src={entry.art} alt="" loading="lazy" />
                    : <Clock size={14} />}
                </div>
                <div className="sbar__drop-info">
                  <span className="sbar__drop-track">{entry.trackName}</span>
                  <span className="sbar__drop-meta">{entry.artistName}</span>
                </div>
                {entry.duration ? (
                  <span className="sbar__drop-dur">{fmt(entry.duration)}</span>
                ) : null}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SearchBar;
