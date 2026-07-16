// ─── BeatReactiveBackground Component ────────────────────────────────────────
// Provides a subtle, pulsing ambient gradient light effect that synchronizes
// with the music's BPM and energy level

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import './BeatReactiveBackground.css';

const BeatReactiveBackground = ({
  bpm = 120,
  energy = 0,
  beatIntensity = 0,
  isPlaying = false,
  palette = ['167,139,250', '244,114,182', '103,232,249'],
  className = ''
}) => {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);
  const timeRef = useRef(0);
  const lastFrameRef = useRef(0);

  // Calculate pulse interval from BPM (in milliseconds)
  const beatInterval = useMemo(() => 60000 / bpm, [bpm]);
  
  // Smoothed values for organic movement
  const smoothEnergyRef = useRef(0);
  const smoothBeatRef = useRef(0);

  // Live prop mirrors — read inside the rAF loop via refs so that frequent
  // energy/beatIntensity updates do NOT recreate `render` and tear down/rebuild
  // the animation frame on every change.
  const energyRef = useRef(energy);
  const beatRef = useRef(beatIntensity);
  useEffect(() => { energyRef.current = energy; }, [energy]);
  useEffect(() => { beatRef.current = beatIntensity; }, [beatIntensity]);

  // Generate initial particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W;
    canvas.height = H;

    // Create ambient particles
    const count = Math.min(12, Math.floor(W * H / 80000));
    particlesRef.current = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * W,
      y: Math.random() * H,
      baseX: Math.random() * W,
      baseY: Math.random() * H,
      size: 80 + Math.random() * 120,
      hue: Math.random() * 360,
      speed: 0.0003 + Math.random() * 0.0004,
      phase: Math.random() * Math.PI * 2,
      opacity: 0.03 + Math.random() * 0.04
    }));
  }, []);

  // Main render loop
  const render = useCallback((timestamp) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    const W = canvas.width;
    const H = canvas.height;

    // Delta time for smooth animation
    const delta = lastFrameRef.current ? (timestamp - lastFrameRef.current) / 1000 : 0.016;
    lastFrameRef.current = timestamp;
    timeRef.current += delta;

    // Clear with fade effect (organic motion persistence)
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.fillRect(0, 0, W, H);

    // Smooth the beat intensity and energy (Organic interpolation)
    smoothBeatRef.current = smoothBeatRef.current * 0.88 + beatRef.current * 0.12;
    smoothEnergyRef.current = smoothEnergyRef.current * 0.94 + energyRef.current * 0.06;

    const currentBeat = smoothBeatRef.current;
    const currentEnergy = smoothEnergyRef.current;

    if (!isPlaying && currentEnergy < 0.01 && currentBeat < 0.01) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }

    // Use screen blending for a high-fidelity light glow effect that feels integrated
    ctx.globalCompositeOperation = 'screen';

    // 1. High-Fidelity Central Pulse Glow (Maps to amplitude/energy AND beats)
    const baseScale = Math.max(W, H);
    // Scales to amplitude organically, bumps on beat
    const glowScale = 0.45 + (currentEnergy * 0.5) + (currentBeat * 0.25);
    const glowRadius = baseScale * glowScale;
    
    // Smooth, deep organic glow drift
    const cx = W / 2 + Math.sin(timeRef.current * 0.5) * (W * 0.1);
    const cy = H / 2 + Math.cos(timeRef.current * 0.3) * (H * 0.1);
    
    // Intensity mapped directly to current energy and beat
    const glowIntensity = 0.01 + (currentEnergy * 0.22) + (currentBeat * 0.28);
    
    if (glowIntensity > 0.01) {
      const coreGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      coreGradient.addColorStop(0, `rgba(${palette[0]}, ${glowIntensity})`);
      coreGradient.addColorStop(0.35, `rgba(${palette[1]}, ${glowIntensity * 0.45})`);
      coreGradient.addColorStop(0.7, `rgba(${palette[2]}, ${glowIntensity * 0.15})`);
      coreGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = coreGradient;
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Slow ambient radial swells — a calm wash, NOT a beat pulse. Real beat
    // sync is impossible (cross-origin audio), so a slow ~7s drift always reads
    // as intentional rather than out-of-sync.
    if (currentEnergy > 0.04) {
      const AMBIENT_PERIOD = 7000; // ms per swell cycle (calm, not rhythmic)
      const pulsePhase = (timeRef.current * 1000 / AMBIENT_PERIOD) % 1;
      const rippleCount = 2; // Keep it lightweight during video playback

      for (let r = 0; r < rippleCount; r++) {
        const ripplePhase = (pulsePhase + r * 0.5) % 1;
        // Ease out quad for ripple expansion
        const rippleEased = 1 - Math.pow(1 - ripplePhase, 2); 
        const rippleScale = 0.2 + rippleEased * 0.8 + currentBeat * 0.2;
        
        const rCx = W * (0.3 + (r * 0.4));
        const rCy = H * (0.4 + ((r % 2) * 0.2));
        
        const gradient = ctx.createRadialGradient(rCx, rCy, 0, rCx, rCy, baseScale * rippleScale * 0.7);
        
        // Fades out as it expands
        const rippleAlpha = (0.01 + currentBeat * 0.05) * (1 - ripplePhase);
        
        gradient.addColorStop(0, `rgba(${palette[r % 3]}, 0)`);
        gradient.addColorStop(0.8, `rgba(${palette[(r + 1) % 3]}, ${rippleAlpha})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // 3. Ambient Floating Particles (Bokeh/Light dust effect)
    for (const p of particlesRef.current) {
      const t = timeRef.current;
      p.x = p.baseX + Math.sin(t * p.speed + p.phase) * (60 + currentEnergy * 40);
      p.y = p.baseY + Math.cos(t * p.speed * 0.7 + p.phase) * (40 + currentEnergy * 30);
      
      // Screen wrap
      if (p.x < -p.size) p.baseX += W + p.size * 2;
      if (p.x > W + p.size) p.baseX -= W + p.size * 2;
      if (p.y < -p.size) p.baseY += H + p.size * 2;
      if (p.y > H + p.size) p.baseY -= H + p.size * 2;

      const pBeatScale = 1 + currentBeat * (0.2 + p.phase % 0.3);
      const size = p.size * pBeatScale;

      const dynamicOpacity = p.opacity * (0.8 + currentEnergy * 1.5 + currentBeat * 0.5);
      
      if (dynamicOpacity > 0.005) {
        const pGradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
        pGradient.addColorStop(0, `rgba(${palette[Math.floor(p.hue) % 3]}, ${dynamicOpacity})`);
        pGradient.addColorStop(0.6, `rgba(${palette[(Math.floor(p.hue) + 1) % 3]}, ${dynamicOpacity * 0.4})`);
        pGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = pGradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    rafRef.current = requestAnimationFrame(render);
  }, [isPlaying, beatInterval, palette]);

  // Start/stop animation — also pauses while the tab is hidden
  useEffect(() => {
    const stop = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const start = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(render);
    };

    if (isPlaying) {
      start();
    } else {
      stop();
      // Fade out the canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    const handleVisibility = () => {
      if (document.hidden) stop();
      else if (isPlaying) start();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stop();
    };
  }, [isPlaying, render]);

  // Handle resize - Optimize rendering resolution
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      // Optimize: cap rendering resolution for performance during video playback
      // Visual scaling up via CSS creates a softer organic glow anyway
      const maxRes = 900;
      let W = canvas.offsetWidth;
      let H = canvas.offsetHeight;
      
      if (W > maxRes) {
        H = (H / W) * maxRes;
        W = maxRes;
      }
      
      canvas.width = Math.floor(W);
      canvas.height = Math.floor(H);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`beat-reactive-bg ${className}`}
      aria-hidden="true"
    />
  );
};

export default BeatReactiveBackground;
