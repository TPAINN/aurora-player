import { useCallback, useEffect, useRef, useState } from 'react';

// One view model backed by the History API: every page, collection, player and
// sheet opening is an entry, so Back (browser button, Android back, iOS swipe)
// closes the top layer first instead of leaving Aurora.
const BASE = { page: 'home', collection: null, immersive: false, sheet: null, sheetDepth: 0 };
const GUARD = 'aurora-guard';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function readInitial() {
  const saved = window.history.state?.aurora;
  // A reload restores the page, never a transient overlay.
  if (saved) return { ...BASE, page: saved.page || 'home', collection: saved.collection || null };
  // Installed-app shortcuts open a page directly.
  const open = new URLSearchParams(window.location.search).get('open');
  return ['search', 'library'].includes(open) ? { ...BASE, page: open } : BASE;
}

export function useNavigation({ onLeaveHint } = {}) {
  const [view, setView] = useState(readInitial);
  const current = useRef(view);
  const leaving = useRef(0);
  useEffect(() => { current.current = view; }, [view]);

  useEffect(() => {
    // A guard entry under the app turns a Back on the first screen into
    // "go home", then "press Back again to leave".
    if (!window.history.state?.aurora) {
      window.history.replaceState({ [GUARD]: true }, '', window.location.pathname);
      window.history.pushState({ aurora: current.current }, '');
    }
    const onPop = event => {
      if (event.state?.[GUARD]) {
        const now = Date.now();
        if (!same(current.current, BASE)) {
          window.history.pushState({ aurora: BASE }, '');
          setView(BASE);
        } else if (now - leaving.current > 2200) {
          leaving.current = now;
          window.history.pushState({ aurora: BASE }, '');
          onLeaveHint?.();
        } else window.history.back();
        return;
      }
      setView({ ...BASE, ...(event.state?.aurora || {}) });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onLeaveHint]);

  const push = useCallback(next => {
    if (same(next, current.current)) return;
    window.history.pushState({ aurora: next }, '');
    current.current = next;
    setView(next);
  }, []);
  const replace = useCallback(next => {
    window.history.replaceState({ aurora: next }, '');
    current.current = next;
    setView(next);
  }, []);

  const goPage = useCallback((page, collection = null) => push({ ...BASE, page, collection }), [push]);
  const openPlayer = useCallback(() => { if (!current.current.immersive) push({ ...current.current, immersive: true, sheet: null, sheetDepth: 0 }); }, [push]);
  const openSheet = useCallback(sheet => {
    const view = current.current;
    if (view.sheet === sheet) return;
    push({ ...view, sheet, sheetDepth: (view.sheetDepth || 0) + 1 });
  }, [push]);
  // Closing walks back over the entries the overlay added, so Back never reopens it.
  const closeSheet = useCallback(() => {
    const depth = current.current.sheetDepth || 0;
    if (depth > 0 && window.history.state?.aurora?.sheet) window.history.go(-depth);
    else replace({ ...current.current, sheet: null, sheetDepth: 0 });
  }, [replace]);
  const backSheet = useCallback(() => window.history.back(), []);
  const closePlayer = useCallback(() => {
    if (!current.current.immersive) return;
    if (window.history.state?.aurora?.immersive) window.history.back();
    else replace({ ...current.current, immersive: false });
  }, [replace]);

  return { view, goPage, openPlayer, closePlayer, openSheet, closeSheet, backSheet };
}
