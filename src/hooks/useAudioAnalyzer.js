// ─── useAudioAnalyzer Hook ─────────────────────────────────────────────────────
// Provides real-time audio analysis from YouTube iframe or external audio source
// Returns BPM, energy, and beat detection for reactive visualizations

import { useRef, useEffect, useCallback, useState } from 'react';

const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const ENERGY_SMOOTHING = 0.85;
const BPM_SMOOTHING = 0.92;

// Simple onset detection for beat tracking
const calculateOnsets = (freqData, prevFreqData, threshold = 0.65) => {
  if (!prevFreqData || prevFreqData.length !== freqData.length) return 0;
  
  let energy = 0;
  for (let i = 0; i < freqData.length; i++) {
    const diff = Math.max(0, freqData[i] - prevFreqData[i]);
    energy += diff * diff;
  }
  return Math.sqrt(energy / freqData.length);
};

export function useAudioAnalyzer() {
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const prevFreqRef = useRef(null);
  const lastBeatRef = useRef(0);
  const beatIntervalsRef = useRef([]);
  const energyHistoryRef = useRef([]);
  const bpmRef = useRef(120); // Default BPM
  const energyRef = useRef(0);
  const smoothEnergyRef = useRef(0);
  const rafRef = useRef(null);
  
  const [bpm, setBpm] = useState(120);
  const [energy, setEnergy] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [beatIntensity, setBeatIntensity] = useState(0);

  // Initialize audio context
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE
      });
    }
    if (!analyserRef.current) {
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = FFT_SIZE;
      analyserRef.current.smoothingTimeConstant = 0.3;
    }
    return { context: audioContextRef.current, analyser: analyserRef.current };
  }, []);

  // Extract audio from YouTube iframe
  const connectToYouTube = useCallback(async (playerElement) => {
    if (!playerElement || sourceRef.current) return;
    
    try {
      const { context, analyser } = initAudioContext();
      
      // Create media element source from YouTube iframe
      const source = context.createMediaElementSource(playerElement);
      
      try {
        // Initialize high-precision BPM analyzer (Web Audio API Worklet)
        const { createRealtimeBpmAnalyzer, getBiquadFilter } = await import('realtime-bpm-analyzer');
        const bpmAnalyzer = await createRealtimeBpmAnalyzer(context);
        const lowpass = getBiquadFilter(context);
        
        // Connect to specialized low-pass filter to catch kicks/bass accurately for BPM 
        source.connect(lowpass);
        lowpass.connect(bpmAnalyzer.node);
        
        bpmAnalyzer.on('bpmStable', (data) => {
          if (data.bpm && data.bpm.length > 0) {
            const detectedBpm = Math.round(data.bpm[0].tempo);
            if (detectedBpm >= 60 && detectedBpm <= 200) {
              bpmRef.current = detectedBpm;
              setBpm(detectedBpm);
            }
          }
        });
        
        bpmAnalyzer.on('bpm', (data) => {
          // Provide early continuous guesses if stable isn't reached yet
          if (data.bpm && data.bpm.length > 0 && bpmRef.current === 120) {
            const detectedBpm = Math.round(data.bpm[0].tempo);
            if (detectedBpm >= 60 && detectedBpm <= 200) {
              bpmRef.current = detectedBpm;
              setBpm(detectedBpm);
            }
          }
        });
      } catch (err) {
        console.warn('Realtime BPM Analyzer could not be initialized:', err);
      }
      
      // Connect main chain
      source.connect(analyser);
      analyser.connect(context.destination);
      sourceRef.current = source;
      setIsAnalyzing(true);
    } catch (e) {
      console.warn('Audio analyzer: Could not connect to YouTube player:', e);
    }
  }, [initAudioContext]);

  // Calculate energy from frequency data
  const calculateEnergy = useCallback((frequencyData) => {
    if (!frequencyData) return 0;
    
    let total = 0;
    for (let i = 0; i < frequencyData.length; i++) {
      total += frequencyData[i];
    }
    const avg = total / frequencyData.length / 255;
    
    // Smooth the energy
    smoothEnergyRef.current = smoothEnergyRef.current * ENERGY_SMOOTHING + avg * (1 - ENERGY_SMOOTHING);
    energyRef.current = smoothEnergyRef.current;
    
    return smoothEnergyRef.current;
  }, []);

  // Main analysis loop
  const analyze = useCallback(() => {
    if (!analyserRef.current) return;
    
    const frequencyData = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(frequencyData);
    
    // Calculate metrics
    const currentEnergy = calculateEnergy(frequencyData);
    
    // Focus on bass frequencies (60-200 Hz range) for beat intensity visually
    const bassRange = Math.floor(60 * FFT_SIZE / SAMPLE_RATE);
    const bassEnd = Math.floor(200 * FFT_SIZE / SAMPLE_RATE);
    
    let bassEnergy = 0;
    for (let i = bassRange; i < bassEnd && i < frequencyData.length; i++) {
      bassEnergy += frequencyData[i];
    }
    bassEnergy /= (bassEnd - bassRange);
    bassEnergy = bassEnergy / 255;
    
    // Maintain a 60-frame rolling average of bass energy for dynamic thresholding
    energyHistoryRef.current.push(bassEnergy);
    if (energyHistoryRef.current.length > 60) energyHistoryRef.current.shift();
    
    const avgBassEnergy = energyHistoryRef.current.reduce((a, b) => a + b, 0) / Math.max(1, energyHistoryRef.current.length);
    const dynamicThreshold = Math.max(0.18, avgBassEnergy * 1.55);
    
    const now = performance.now();
    const timeSinceLastBeat = now - lastBeatRef.current;
    
    if (bassEnergy > dynamicThreshold && timeSinceLastBeat > 300) {
      lastBeatRef.current = now;
    }
    
    // Calculate beat intensity (0-1 based on onset strength)
    const onsetStrength = calculateOnsets(frequencyData, prevFreqRef.current);
    const beatIntensity = Math.min(1, onsetStrength * 8);
    
    prevFreqRef.current = frequencyData.slice();
    
    // Update state (throttled)
    setEnergy(currentEnergy);
    setBeatIntensity(beatIntensity);
    
    rafRef.current = requestAnimationFrame(analyze);
  }, [calculateEnergy]);

  // Start analysis
  const startAnalysis = useCallback(() => {
    if (rafRef.current) return;
    setIsAnalyzing(true);
    rafRef.current = requestAnimationFrame(analyze);
  }, [analyze]);

  // Stop analysis
  const stopAnalysis = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsAnalyzing(false);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      stopAnalysis();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [stopAnalysis]);

  // Estimate BPM from song metadata when available
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
    // Direct refs for external use
    bpmRef,
    energyRef,
    analyserRef
  };
}

export default useAudioAnalyzer;
