// Aurora motion tokens for framer-motion. Transitions are long and softly
// decelerating; interactions stay interruptible. MotionConfig honours reduced motion.

export const EASE = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT = [0.65, 0, 0.35, 1];
export const EASE_EXIT = [0.4, 0, 0.7, 0.2];

export const SOFT_SPRING = { type: 'spring', stiffness: 120, damping: 22, mass: 1 };
export const SHEET_SPRING = { type: 'spring', stiffness: 190, damping: 30, mass: 1 };
export const PILL_SPRING = { type: 'spring', stiffness: 380, damping: 34 };

export const page = {
  initial: { opacity: 0, y: 18, filter: 'blur(8px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.65, ease: EASE, staggerChildren: 0.07, delayChildren: 0.05 } },
  exit: { opacity: 0, y: -10, filter: 'blur(6px)', transition: { duration: 0.32, ease: EASE_EXIT } },
};

export const section = {
  initial: { opacity: 0, y: 22 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

export const player = {
  initial: { opacity: 0, y: 60, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { ...SOFT_SPRING, opacity: { duration: 0.5, ease: EASE } } },
  exit: { opacity: 0, y: 48, scale: 0.985, transition: { duration: 0.42, ease: EASE_EXIT } },
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
