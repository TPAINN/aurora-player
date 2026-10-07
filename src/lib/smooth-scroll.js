// Smooth wheel scrolling for the page (Lenis), loaded after first paint so it
// never delays the app. Only where it helps: a mouse or trackpad, without
// reduced motion. Touch keeps the platform's own native scrolling. Lenis stops
// itself whenever the page is scroll-locked behind a sheet (autoToggle reads
// the root's overflow), and nested scrollers (lyrics, shelves, queues, sheets)
// keep their own wheel.
let lenis = null;
let loading = null;

export function startSmoothScroll() {
  if (lenis || loading || typeof window === 'undefined') return;
  const media = query => window.matchMedia?.(query).matches;
  if (media('(prefers-reduced-motion: reduce)') || !media('(pointer: fine)')) return;
  loading = import('lenis').then(({ default: Lenis }) => {
    lenis = new Lenis({
      autoRaf: true,
      autoToggle: true,
      allowNestedScroll: true,
      lerp: 0.11,
      wheelMultiplier: 0.95,
      smoothWheel: true,
      syncTouch: false,
      prevent: node => !!node.closest?.('dialog, .sheet, .desktop-lyrics, [data-lenis-prevent]'),
    });
  }).catch(() => { /* Native scrolling stays. */ }).finally(() => { loading = null; });
}

// Moves the page at once, also cancelling any smooth scroll still under way.
export function jumpTo(top) {
  if (lenis) lenis.scrollTo(top, { immediate: true, force: true });
  else window.scrollTo({ top, behavior: 'instant' });
}
