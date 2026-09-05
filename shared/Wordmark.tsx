import { WORDMARK } from './tokens';

interface WordmarkProps {
  size?: number;
  className?: string;
}

/** The app's "✦ aurora" wordmark: lowercase bold geometric grotesk + spark glyph. */
export function Wordmark({ size = 26, className = '' }: WordmarkProps) {
  return (
    <span
      className={`aurora-wordmark ${className}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em' }}
    >
      <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1, color: 'rgb(var(--c1))' }}>
        {WORDMARK.symbol}
      </span>
      <span
        style={{
          fontFamily: 'var(--font)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          fontSize: size,
          lineHeight: 1,
        }}
      >
        {WORDMARK.text}
      </span>
    </span>
  );
}