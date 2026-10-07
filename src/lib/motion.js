// Aurora motion tokens for framer-motion. Transitions are long and softly
// decelerating; interactions stay interruptible. MotionConfig honours reduced motion.

export const EASE = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT = [0.65, 0, 0.35, 1];
export const EASE_EXIT = [0.4, 0, 0.7, 0.2];

export const SOFT_SPRING = { type: 'spring', stiffness: 120, damping: 22, mass: 1 };
export const SHEET_SPRING = { type: 'spring', stiffness: 190, damping: 30, mass: 1 };
export const PILL_SPRING = { type: 'spring', stiffness: 380, damping: 34 };

// Pages rise and fade. No blur: blurring a whole page every frame stutters on
// ordinary devices, most visibly in the reveal after the opening animation.
export const page = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE, staggerChildren: 0.07, delayChildren: 0.05 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.32, ease: EASE_EXIT } },
};

export const section = {
  initial: { opacity: 0, y: 22 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

// The full player rises like a sheet (distances relative to its own height, so a
// phone and a desktop move alike) and sinks back as it closes; opacity leads on the
// way in and trails on the way out, so it never flashes or pops.
export const player = {
  initial: { opacity: 0, y: '7%', scale: 0.975 },
  animate: { opacity: 1, y: '0%', scale: 1, transition: { ...SOFT_SPRING, opacity: { duration: 0.42, ease: EASE } } },
  exit: { opacity: 0, y: '6%', scale: 0.98, transition: { duration: 0.46, ease: EASE_EXIT, opacity: { duration: 0.34, delay: 0.08, ease: EASE_EXIT } } },
};

// Rows cascade in once; later renders keep their position without replaying.
export function listItem(index) {
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE, delay: Math.min(index, 14) * 0.04 } },
    exit: { opacity: 0, x: -24, transition: { duration: 0.3, ease: EASE_EXIT } },
  };
}

export const crossfade = {
  initial: { opacity: 0, scale: 1.03 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.9, ease: EASE } },
  exit: { opacity: 0, scale: 0.985, transition: { duration: 0.7, ease: EASE_IN_OUT } },
};

// Now-playing artwork on Next/Previous: the new cover glides in from the side the
// listener is travelling toward while the old one drifts out and softens.
export const coverSwap = {
  initial: direction => ({ opacity: 0, x: `${direction * 9}%`, scale: 0.94, filter: 'blur(12px)' }),
  animate: { opacity: 1, x: '0%', scale: 1, filter: 'blur(0px)', transition: { duration: 1.05, ease: EASE, opacity: { duration: 0.8, ease: EASE } } },
  exit: direction => ({ opacity: 0, x: `${direction * -7}%`, scale: 0.96, filter: 'blur(10px)', transition: { duration: 0.8, ease: EASE_IN_OUT } }),
};

// Small song names (the dock) swap like the cover, at text scale: a short glide.
export const textSwap = {
  initial: direction => ({ opacity: 0, x: direction * 10, filter: 'blur(3px)' }),
  animate: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: EASE } },
  exit: direction => ({ opacity: 0, x: direction * -8, filter: 'blur(2px)', transition: { duration: 0.25, ease: EASE_EXIT } }),
};

// Sections below the fold reveal as they scroll into view (once), and their cards
// cascade in after them. Cards take `revealCard` and inherit the section's state.
export const revealSection = {
  initial: 'hidden',
  whileInView: 'shown',
  viewport: { once: true, amount: 0.15 },
  variants: {
    hidden: { opacity: 0, y: 28 },
    shown: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE, staggerChildren: 0.055, delayChildren: 0.12 } },
  },
};
export const revealCard = {
  hidden: { opacity: 0, y: 18, scale: 0.97 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.75, ease: EASE } },
};

// Icon swaps (play ↔ pause): a soft turn and blur instead of a hard cut.
export const iconSwap = {
  initial: { opacity: 0, scale: 0.6, rotate: -35, filter: 'blur(3px)' },
  animate: { opacity: 1, scale: 1, rotate: 0, filter: 'blur(0px)', transition: { duration: 0.38, ease: EASE } },
  exit: { opacity: 0, scale: 0.6, rotate: 35, filter: 'blur(3px)', transition: { duration: 0.22, ease: EASE_EXIT } },
};

// The heart pops past full size when a song is liked.
export const HEART_SPRING = { type: 'spring', stiffness: 520, damping: 14, mass: 0.8 };

// Magnetic controls: quick to follow the pointer, soft to settle back.
export const MAGNET_SPRING = { stiffness: 260, damping: 18, mass: 0.6 };

// A DJ blend hands over as a slow dissolve that matches the music: the new cover
// sharpens out of a soft blur with a gentle settle, the old one melts away.
// Even (ease-in-out) curves, not front-loaded: the cover changes across the
// blend as the music does, instead of mostly in its first half-second.
export const blendSwap = {
  initial: { opacity: 0, scale: 1.06, filter: 'blur(16px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 3, ease: EASE_IN_OUT } },
  exit: { opacity: 0, scale: 0.98, filter: 'blur(12px)', transition: { duration: 2.8, ease: EASE_IN_OUT } },
};

// ── Opening and closing, one vocabulary ─────────────────────────────────────
// Something that adds a line or a section unfolds: its height grows while it
// fades in, so what sits below glides aside instead of jumping. It folds away the
// same way, a little quicker.
export const unfold = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto', transition: { height: { duration: 0.45, ease: EASE }, opacity: { duration: 0.35, delay: 0.08, ease: EASE } } },
  exit: { opacity: 0, height: 0, transition: { height: { duration: 0.34, ease: EASE_IN_OUT }, opacity: { duration: 0.18, ease: EASE_EXIT } } },
};

// A small control arrives with a soft pop (scale and a clearing blur) and leaves
// by shrinking back; exits are quicker than entrances.
export const pop = {
  initial: { opacity: 0, scale: 0.85, filter: 'blur(2px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.32, ease: EASE } },
  exit: { opacity: 0, scale: 0.9, filter: 'blur(1px)', transition: { duration: 0.18, ease: EASE_EXIT } },
};

// One glyph becomes another in place (a track number becomes the playing
// equalizer): the old one shrinks out upward while the new one grows in.
export const glyphSwap = {
  initial: { opacity: 0, scale: 0.6, y: 4 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.28, ease: EASE } },
  exit: { opacity: 0, scale: 0.6, y: -4, transition: { duration: 0.16, ease: EASE_EXIT } },
};

// One cover change, whatever kind it is, chosen by the presence's `custom` value
// ({ direction, blend }): the leaving cover reads the same value as the arriving
// one, so a DJ blend never pairs a slow dissolve with a quick slide.
export const coverChange = {
  initial: ({ direction, blend } = {}) => (blend ? blendSwap.initial : direction ? coverSwap.initial(direction) : crossfade.initial),
  animate: ({ direction, blend } = {}) => (blend ? blendSwap.animate : direction ? coverSwap.animate : crossfade.animate),
  exit: ({ direction, blend } = {}) => (blend ? blendSwap.exit : direction ? coverSwap.exit(direction) : crossfade.exit),
};

// The backdrop behind the player: the new artwork fades in over the old one, and
// the old stays fully lit underneath until it is covered, so a change never dips
// through dark. A DJ blend takes its time; a skip is quicker.
export const backdropChange = {
  initial: { opacity: 0, zIndex: 1 },
  animate: (blend = false) => ({ opacity: 1, zIndex: 1, transition: blend ? { duration: 3.6, ease: EASE_IN_OUT } : { duration: 1.4, ease: EASE } }),
  exit: (blend = false) => ({ opacity: 0, zIndex: 0, transition: { duration: 0.6, delay: blend ? 3.4 : 1.2, ease: EASE_IN_OUT } }),
};

// Lyrics hand over to the next song's: a skip swaps them briskly; a DJ blend lets
// the old words drift up and out while the new ones rise in after a beat.
export const lyricsChange = {
  initial: { opacity: 0, y: 22 },
  animate: (blend = false) => ({ opacity: 1, y: 0, transition: { duration: blend ? 1.6 : 0.8, ease: EASE, delay: blend ? 0.5 : 0.1 } }),
  exit: (blend = false) => ({ opacity: 0, y: -16, transition: { duration: blend ? 1.1 : 0.35, ease: EASE_IN_OUT } }),
};

// The song's name on a DJ blend: a soft blurred crossfade (a letter-by-letter
// morph between two titles passes through garbled half-words mid-blend).
export const nameBlend = {
  initial: { opacity: 0, filter: 'blur(6px)', y: 6 },
  animate: { opacity: 1, filter: 'blur(0px)', y: 0, transition: { duration: 1.2, ease: EASE, delay: 0.25 } },
  exit: { opacity: 0, filter: 'blur(6px)', y: -4, transition: { duration: 0.7, ease: EASE_IN_OUT } },
};
