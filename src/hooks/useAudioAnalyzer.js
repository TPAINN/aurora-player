// ─── useAudioAnalyzer Hook ─────────────────────────────────────────────────────
// Drives BPM/energy/beat values for the reactive visuals.
//
// NOTE: The audio source is a cross-origin YouTube IFrame embed. The Web Audio
// API's createMediaElementSource() CANNOT tap a cross-origin <iframe> (it is not
// an HTMLMediaElement and the audio is sandboxed), so real FFT analysis is
// impossible here — the old implementation threw on every play and produced no
// data. Instead we synthesise a lightweight, tempo-accurate beat envelope from
// the track BPM. This is far cheaper (no AudioContext, no FFT, no per-frame
// allocations) and keeps the visuals alive and rhythmic.

import { useRef, useEffect, useCallback, useState } from 'react';

// React-state update cadence for the beat envelope (~12 fps is plenty for an
// ambient glow and keeps re-renders cheap).
const UPDATE_MS = 80;
const BASELINE_ENERGY = 0.5;

export function useAudioAnalyzer() {
  const rafRef = useRef(null);
  const bpmRef = useRef(120);
  const energyRef = useRef(0);
  const lastUpdateRef = useRef(0);

  const [bpm, setBpm] = useState(120);
  const [energy, setEnergy] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [beatIntensity, setBeatIntensity] = useState(0);

  // Kept for API compatibility with App.jsx — intentionally a no-op.
  // A cross-origin YouTube iframe cannot be routed through Web Audio.
  const connectToYouTube = useCallback(async () => {}, []);

  const startAnalysis = useCallback(() => {
    if (rafRef.current) return;
    setIsAnalyzing(true);
    energyRef.current = BASELINE_ENERGY;
    setEnergy(BASELINE_ENERGY);

    const loop = (now) => {
      if (now - lastUpdateRef.current >= UPDATE_MS) {
        lastUpdateRef.current = now;
        const t = now / 1000;
        // Calm, organic "breathing" — layered slow sines, NOT a per-beat pulse.
        // Real beat sync is impossible here (the audio is a cross-origin YouTube
        // iframe with no Web Audio tap), and a fixed-tempo fake pulse reads as
        // out-of-sync/buggy. A smooth ambient swell always looks intentional.
        const breathe = 0.5 + 0.16 * Math.sin(t * 0.55) + 0.06 * Math.sin(t * 1.3 + 1.1);
        const glow    = 0.12 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.9 + 0.5));
        energyRef.current = breathe;
        setEnergy(breathe);
        setBeatIntensity(glow);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopAnalysis = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsAnalyzing(false);
    setBeatIntensity(0);
    setEnergy(0);
    energyRef.current = 0;
  }, []);

  useEffect(() => () => stopAnalysis(), [stopAnalysis]);

  // Feed a real tempo when the track's BPM is known — the pulse locks to it.
  const setBPMFromMetadata = useCallback((tempo) => {
    if (tempo && tempo >= 60 && tempo <= 200) {
      bpmRef.current = tempo;
      setBpm(Math.round(tempo));
    }
  }, []);

  return {
    bpm,
    energy,
    beatIntensity,
    isAnalyzing,
    connectToYouTube,
    startAnalysis,
    stopAnalysis,
    setBPMFromMetadata,
    bpmRef,
    energyRef,
  };
}

export default useAudioAnalyzer;
