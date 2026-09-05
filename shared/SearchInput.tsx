import { useRef, useState } from 'react';
import { useTrackSearch, type TrackSuggestion } from './useTrackSearch';

export interface SearchInputProps {
  /** Called when the user submits a query (Enter with no selection, or the query alone). */
  onSubmitQuery: (query: string) => void;
  /** Called when the user picks a specific suggestion. */
  onSelectTrack?: (track: TrackSuggestion) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Standalone search box for the landing page: styled to match the app's
 * .sbox/.drop visual language (same CSS vars/tokens), backed by a simple
 * iTunes-only lookup (see useTrackSearch) rather than the app's full
 * multi-source scoring pipeline -- the landing page only needs "type, see
 * plausible matches, hand off to the app," not real match ranking.
 */
export function SearchInput({ onSubmitQuery, onSelectTrack, placeholder = 'Search artist or song…', autoFocus, className = '' }: SearchInputProps) {
  const { query, setQuery, suggestions, isSearching } = useTrackSearch();
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (index: number) => {
    if (index >= 0 && suggestions[index] && onSelectTrack) {
      onSelectTrack(suggestions[index]);
    } else if (query.trim()) {
      onSubmitQuery(query.trim());
    }
  };

  return (
    <div className={`aurora-search ${className}`} style={{ position: 'relative', width: '100%', maxWidth: 520 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          height: 52,
          padding: '0 16px',
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(10,12,24,0.6)',
        }}
      >
        <span aria-hidden="true" style={{ opacity: 0.5, fontFamily: 'var(--mono)', fontSize: 14 }}>
          {isSearching ? '…' : '⌕'}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(e) => { setQuery(e.target.value); setHighlightedIndex(-1); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && suggestions.length > 0) {
              e.preventDefault();
              setHighlightedIndex((i) => (i + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
              e.preventDefault();
              setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              submit(highlightedIndex);
              setOpen(false);
            } else if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#fff',
            fontFamily: 'var(--font)',
            fontSize: 15,
          }}
        />
      </div>

      {open && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 8,
            maxHeight: '44vh',
            overflowY: 'auto',
            borderRadius: 18,
            background: 'linear-gradient(180deg, rgba(10,13,27,0.97), rgba(7,9,20,0.95))',
            zIndex: 20,
          }}
        >
          {suggestions.map((track, i) => (
            <button
              key={track.id}
              type="button"
              onMouseDown={() => submit(i)}
              onMouseEnter={() => setHighlightedIndex(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '9px 15px',
                background: highlightedIndex === i ? 'rgba(255,255,255,0.045)' : 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              {track.art ? (
                <img src={track.art} alt="" width={30} height={30} style={{ borderRadius: 7, objectFit: 'cover' }} />
              ) : (
                <span style={{ width: 30, height: 30, borderRadius: 7, background: 'rgba(255,255,255,0.07)' }} />
              )}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 650, color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {track.trackName}
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'rgba(255,255,255,0.34)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {track.artistName}{track.albumName ? ` · ${track.albumName}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}