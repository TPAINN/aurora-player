// ─── Background Component ─────────────────────────────────────────────────────
// Beat-reactive canvas background with ambient particles and chorus glow

import React, { useRef, useEffect, useCallback } from 'react';
import './Background.css';

interface BackgroundProps {
  artUrl?: string | null;
  bpm?: number;
  energy?: number;
  beatIntensity?: number;
  isPlaying?: boolean;
  palette?: string[];
  isChorus?: boolean;
  videoBgActive?: boolean;
}

const Background: React.FC<BackgroundProps> = ({
  artUrl,
  bpm = 120,
  energy = 0,
  beatIntensity = 0,
  isPlaying = false,
  palette = ['167,139,250', '244,114,182', '103,232,249'],
  isChorus = false,
  videoBgActive = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const lastFrameRef = useRef(0);
  const smoothEnergyRef = useRef(0);
  const smoothBeatRef = useRef(0);
  const particlesRef = useRef<Array<{
    x: number; y: number; baseX: number; baseY: number;
    size: number; speed: number; phase: number; opacity: number; colorIdx: number;
  }>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.offsetWidth || 1280;
    const H = canvas.offsetHeight || 720;
    canvas.width = Math.min(W, 1200);
    canvas.height = Math.min(H, 800);
    const count = Math.min(14, Math.floor(canvas.width * canvas.height / 70000));
    particlesRef.current = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      baseX: Math.random() * canvas.width,
      baseY: Math.random() * canvas.height,
      size: 70 + Math.random() * 130,
      speed: 0.0003 + Math.random() * 0.0004,
      phase: Math.random() * Math.PI * 2,
      opacity: 0.025 + Math.random() * 0.04,
      colorIdx: i % 3,
    }));
  }, []);

  const render = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    const delta = lastFrameRef.current ? (timestamp - lastFrameRef.current) / 1000 : 0.016;
    lastFrameRef.current = timestamp;
    timeRef.current += delta;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = videoBgActive ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, W, H);

    smoothBeatRef.current = smoothBeatRef.current * 0.88 + beatIntensity * 0.12;
    smoothEnergyRef.current = smoothEnergyRef.current * 0.94 + energy * 0.06;

    const cBeat = smoothBeatRef.current;
    const cEnergy = smoothEnergyRef.current;

    if (!isPlaying && cEnergy < 0.01 && cBeat < 0.01) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }

    ctx.globalCompositeOperation = 'screen';

    // Central glow
    const baseScale = Math.max(W, H);
    const glowScale = 0.45 + cEnergy * 0.5 + cBeat * 0.25;
    const cx = W / 2 + Math.sin(timeRef.current * 0.5) * W * 0.1;
    const cy = H / 2 + Math.cos(timeRef.current * 0.3) * H * 0.1;
    const glowAlpha = 0.01 + cEnergy * 0.22 + cBeat * 0.28;

    if (glowAlpha > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseScale * glowScale);
      g.addColorStop(0, `rgba(${palette[0]},${glowAlpha})`);
      g.addColorStop(0.35, `rgba(${palette[1]},${glowAlpha * 0.45})`);
      g.addColorStop(0.7, `rgba(${palette[2]},${glowAlpha * 0.15})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Chorus extra bloom
    if (isChorus && cEnergy > 0.02) {
      const chorusAlpha = 0.04 + cEnergy * 0.12;
      const chorusGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, baseScale * 0.9);
      chorusGrad.addColorStop(0, `rgba(${palette[1]},${chorusAlpha})`);
      chorusGrad.addColorStop(0.5, `rgba(${palette[0]},${chorusAlpha * 0.3})`);
      chorusGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = chorusGrad;
      ctx.fillRect(0, 0, W, H);
    }

    // BPM ripples
    if (cEnergy > 0.04) {
      const beatInterval = 60000 / bpm;
      const pulsePhase = (timeRef.current * 1000 / beatInterval) % 1;
      for (let r = 0; r < 2; r++) {
        const rPhase = (pulsePhase + r * 0.2) % 1;
        const rEased = 1 - Math.pow(1 - rPhase, 2);
        const rCx = W * (0.3 + r * 0.4);
        const rCy = H * (0.4 + (r % 2) * 0.2);
        const rippleGrad = ctx.createRadialGradient(rCx, rCy, 0, rCx, rCy, baseScale * (0.2 + rEased * 0.8) * 0.7);
        const rippleAlpha = (0.01 + cBeat * 0.05) * (1 - rPhase);
        rippleGrad.addColorStop(0, `rgba(${palette[r % 3]},0)`);
        rippleGrad.addColorStop(0.8, `rgba(${palette[(r + 1) % 3]},${rippleAlpha})`);
        rippleGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rippleGrad;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // Ambient particles
    for (const p of particlesRef.current) {
      const t = timeRef.current;
      p.x = p.baseX + Math.sin(t * p.speed + p.phase) * (60 + cEnergy * 40);
      p.y = p.baseY + Math.cos(t * p.speed * 0.7 + p.phase) * (40 + cEnergy * 30);
      if (p.x < -p.size) p.baseX += W + p.size * 2;
      if (p.x > W + p.size) p.baseX -= W + p.size * 2;
      if (p.y < -p.size) p.baseY += H + p.size * 2;
      if (p.y > H + p.size) p.baseY -= H + p.size * 2;
      const size = p.size * (1 + cBeat * 0.2);
      const alpha = p.opacity * (0.8 + cEnergy * 1.5 + cBeat * 0.5);
      if (alpha > 0.004) {
        const pGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
        pGrad.addColorStop(0, `rgba(${palette[p.colorIdx]},${alpha})`);
        pGrad.addColorStop(0.6, `rgba(${palette[(p.colorIdx + 1) % 3]},${alpha * 0.4})`);
        pGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = pGrad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    rafRef.current = requestAnimationFrame(render);
  }, [bpm, energy, beatIntensity, isPlaying, palette, isChorus, videoBgActive]);

  useEffect(() => {
    if (isPlaying || energy > 0.01) {
      rafRef.current = requestAnimationFrame(render);
    }
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [isPlaying, render, energy]);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.min(canvas.offsetWidth || 1280, 1200);
      canvas.height = Math.min(canvas.offsetHeight || 720, 800);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="aurora-bg" aria-hidden="true">
      {artUrl && (
        <div
          className="aurora-bg__art"
          style={{ backgroundImage: `url(${artUrl})` }}
        />
      )}
      <div className="aurora-bg__mesh" />
      <canvas ref={canvasRef} className="aurora-bg__canvas" />
      <div className={`aurora-bg__chorus-glow${isChorus ? ' active' : ''}`} />
      <div className="aurora-bg__vignette" />
      <div className="aurora-bg__grain" />
    </div>
  );
};

export default Background;
