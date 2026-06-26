// ─── Motion System ─────────────────────────────────────────────────────────────
// Standardized animation tokens and easing functions for Aurora
// Ensures consistent, polished motion language across the entire application

// ─── Easing Functions (cubic-bezier presets) ─────────────────────────────────
// Organic, sophisticated easing curves for premium feel

export const EASING = {
  // Primary spring - for most UI interactions
  // Feels responsive but not bouncy
  spring: 'cubic-bezier(0.16, 1, 0.24, 1)',
  
  // Soft spring - for entrance animations
  // Gentle ease-in with smooth settle
  softSpring: 'cubic-bezier(0.22, 1, 0.36, 1)',
  
  // Out quad - for exit/disappear animations
  // Quick start, decelerating finish
  outQuad: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  
  // In-out quad - for toggle/transition animations
  // Balanced entry and exit
  inOutQuad: 'cubic-bezier(0.45, 0.05, 0.55, 0.95)',
  
  // Out expo - for popups and overlays
  // Subtle acceleration feel
  outExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  
  // In out expo - for dramatic transitions
  // Smooth start and end with subtle ease
  inOutExpo: 'cubic-bezier(0.87, 0, 0.13, 1)',
  
  // Snappy - for micro-interactions (hover, click)
  // Ultra-fast response
  snappy: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  
  // Smooth scroll - for scrolling content
  smoothScroll: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  
  // Organic - for ambient/living elements
  // Natural, breathing feel
  organic: 'cubic-bezier(0.42, 0, 0.58, 1)',
  
  // Subtle - for background transitions
  // Very gentle, almost imperceptible
  subtle: 'cubic-bezier(0.4, 0, 0.2, 1)',
};

// ─── Duration Tokens ───────────────────────────────────────────────────────────
// Precise timing for different animation types

export const DURATION = {
  // Micro-interactions (hover, click feedback)
  micro: '100ms',
  microMs: 100,
  
  // Quick transitions (button states, toggles)
  quick: '150ms',
  quickMs: 150,
  
  // Standard transitions (UI state changes)
  standard: '250ms',
  standardMs: 250,
  
  // Smooth transitions (panel reveals, dropdowns)
  smooth: '350ms',
  smoothMs: 350,
  
  // Page transitions (content swaps)
  page: '450ms',
  pageMs: 450,
  
  // Dramatic transitions (modal opens, major reveals)
  dramatic: '600ms',
  dramaticMs: 600,
  
  // Ambient animations (background effects)
  ambient: '1000ms',
  ambientMs: 1000,
  
  // Long ambient (aurora, gradient sweeps)
  longAmbient: '2000ms',
  longAmbientMs: 2000,
  
  // Ultra-slow (section transitions)
  section: '2500ms',
  sectionMs: 2500,
};

// ─── Stagger Configuration ──────────────────────────────────────────────────────
// For list item animations

export const STAGGER = {
  // Quick stagger - for small lists
  quick: 30,
  
  // Standard stagger - for most lists
  standard: 50,
  
  // Slow stagger - for large lists
  slow: 80,
  
  // Micro stagger - for dense grids
  micro: 20,
};

// ─── Animation Keyframes Presets ───────────────────────────────────────────────

export const KEYFRAMES = {
  // Fade in with slight rise
  fadeInUp: {
    from: { opacity: 0, transform: 'translateY(8px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  
  // Fade in with slight scale
  fadeInScale: {
    from: { opacity: 0, transform: 'scale(0.96)' },
    to: { opacity: 1, transform: 'scale(1)' },
  },
  
  // Soft bounce settle
  softSettle: {
    '0%': { opacity: 0, transform: 'translateY(-10px) scale(0.98)' },
    '60%': { opacity: 1, transform: 'translateY(2px) scale(1.01)' },
    '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
  },
  
  // Pulse glow
  pulseGlow: {
    '0%, 100%': { transform: 'scale(1)', opacity: 0.8 },
    '50%': { transform: 'scale(1.02)', opacity: 1 },
  },
  
  // Breathing (for ambient elements)
  breathing: {
    '0%, 100%': { transform: 'scale(1)', filter: 'brightness(1)' },
    '50%': { transform: 'scale(1.015)', filter: 'brightness(1.05)' },
  },
  
  // Beat pulse (synced to BPM)
  beatPulse: {
    '0%': { transform: 'scale(1)', opacity: 0.3 },
    '8%': { transform: 'scale(1.08)', opacity: 0.9 },
    '15%': { transform: 'scale(1.02)', opacity: 0.6 },
    '25%': { transform: 'scale(1.04)', opacity: 0.7 },
    '100%': { transform: 'scale(1)', opacity: 0.3 },
  },
  
  // Float (ambient particles)
  float: {
    '0%, 100%': { transform: 'translate(0, 0)' },
    '25%': { transform: 'translate(3%, -5%)' },
    '50%': { transform: 'translate(-2%, -3%)' },
    '75%': { transform: 'translate(-4%, 2%)' },
  },
  
  // Slide in from right
  slideInRight: {
    from: { opacity: 0, transform: 'translateX(20px)' },
    to: { opacity: 1, transform: 'translateX(0)' },
  },
  
  // Slide in from left
  slideInLeft: {
    from: { opacity: 0, transform: 'translateX(-20px)' },
    to: { opacity: 1, transform: 'translateX(0)' },
  },
  
  // Expand from center
  expandCenter: {
    from: { opacity: 0, transform: 'scale(0.8)' },
    to: { opacity: 1, transform: 'scale(1)' },
  },
};

// ─── CSS Variable Injection ───────────────────────────────────────────────────
// Inject animation tokens as CSS custom properties

export const injectMotionTokens = () => {
  const root = document.documentElement;
  
  // Easing functions
  Object.entries(EASING).forEach(([name, value]) => {
    root.style.setProperty(`--ease-${name}`, value);
  });
  
  // Durations
  Object.entries(DURATION).forEach(([name, value]) => {
    root.style.setProperty(`--duration-${name}`, value);
  });
  
  // Common animation presets as CSS variables
  root.style.setProperty('--ease-spring', EASING.spring);
  root.style.setProperty('--ease-soft', EASING.softSpring);
  root.style.setProperty('--ease-out', EASING.outQuad);
  root.style.setProperty('--ease-smooth', EASING.inOutQuad);
  root.style.setProperty('--ease-snappy', EASING.snappy);
};

// ─── Framer Motion Variants ────────────────────────────────────────────────────
// Pre-configured animation variants for framer-motion components

export const motionVariants = {
  // Page transitions
  pageIn: {
    initial: { opacity: 0, y: 12 },
    animate: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.4, ease: EASING.spring }
    },
    exit: { 
      opacity: 0, 
      y: -8,
      transition: { duration: 0.25, ease: EASING.outQuad }
    },
  },
  
  // List items with stagger
  staggerList: (delay = 0.05) => ({
    initial: { opacity: 0, y: 10 },
    animate: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.3, delay, ease: EASING.softSpring }
    },
  }),
  
  // Modal/dialog
  modal: {
    initial: { opacity: 0, scale: 0.95, y: 10 },
    animate: { 
      opacity: 1, 
      scale: 1, 
      y: 0,
      transition: { duration: 0.35, ease: EASING.spring }
    },
    exit: { 
      opacity: 0, 
      scale: 0.96,
      transition: { duration: 0.2, ease: EASING.outQuad }
    },
  },
  
  // Tooltip/dropdown
  dropdown: {
    initial: { opacity: 0, y: -6, scale: 0.98 },
    animate: { 
      opacity: 1, 
      y: 0, 
      scale: 1,
      transition: { duration: 0.2, ease: EASING.snappy }
    },
    exit: { 
      opacity: 0, 
      y: -4,
      transition: { duration: 0.15, ease: EASING.outQuad }
    },
  },
  
  // Hover scale
  hoverScale: {
    scale: 1.02,
    transition: { duration: 0.15, ease: EASING.snappy }
  },
  
  // Button press
  buttonTap: {
    scale: 0.97,
    transition: { duration: 0.1, ease: EASING.snappy }
  },
  
  // Loading spinner
  spinner: {
    rotate: { rotate: 360 },
    transition: { duration: 1, repeat: Infinity, ease: 'linear' }
  },
  
  // Skeleton pulse
  skeleton: {
    opacity: [0.3, 0.6, 0.3],
    transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
  },
};

// ─── Performance-Aware Animation Config ───────────────────────────────────────
// Adjust animation parameters based on device performance tier

export const getPerfAdjustedMotion = (tier = 'high') => {
  const multipliers = {
    high: 1,
    mid: 0.6,
    low: 0.3,
  };
  
  const m = multipliers[tier] || 1;
  
  return {
    enabled: tier !== 'low',
    staggerDelay: STAGGER.standard * m,
    animationDuration: DURATION.standardMs * m,
    particleCount: tier === 'high' ? 12 : tier === 'mid' ? 6 : 0,
    blurIntensity: tier === 'high' ? 0 : tier === 'mid' ? 3 : 8,
    fpsCap: tier === 'high' ? 0 : tier === 'mid' ? 30 : 15,
  };
};

export default {
  EASING,
  DURATION,
  STAGGER,
  KEYFRAMES,
  injectMotionTokens,
  motionVariants,
  getPerfAdjustedMotion,
};
