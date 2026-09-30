import { useCallback, useEffect, useRef, useState } from 'react';
import { buildApiUrl } from '../lib/api';
import { getSimilarTracks } from '../lib/catalog';
import { recordListening } from '../lib/listening';
import { analyzeLocalTempo, equalPower, planTransition } from '../lib/dj';

let youtubeApi;
function readPreference(key, fallback) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value === 'true'; }
  catch { return fallback; }
}
function savePreference(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Private storage can be unavailable. */ }
}
function loadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeApi) youtubeApi = new Promise((resolve, reject) => {
    let timer;
    const timeout = setTimeout(() => { clearInterval(timer); youtubeApi = null; reject(new Error('YouTube could not connect. Please retry.')); }, 15000);
    timer = setInterval(() => { if (window.YT?.Player) { clearInterval(timer); clearTimeout(timeout); resolve(window.YT); } }, 100);
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; document.head.append(script);
    }
  });
  return youtubeApi;
}

export function usePlayer() {
  const [track, setTrack] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, updateVolume] = useState(80);
  const [queue, updateQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [lyrics, setLyrics] = useState(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsOffset, setLyricsOffset] = useState(0);
  const [djEnabled, updateDjEnabled] = useState(() => readPreference('aurora-dj', false));
  const [liveDjChanges, updateLiveDjChanges] = useState(() => readPreference('aurora-live-dj', false));
  const [autoplay, updateAutoplay] = useState(() => readPreference('aurora-autoplay', true));
  const [djState, setDjState] = useState({ phase: 'idle', label: 'Ready for your next track', mode: 'online' });
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState('');
  const [djWindow, setDjWindow] = useState(null);
  const [radioRetry, setRadioRetry] = useState(0);
  const prepared = useRef(new Map());
  const waitingForRadio = useRef(false);
  const recommendationRequest = useRef(null);
  const recommendedFor = useRef(null);
  const decks = useRef([]);
  const context = useRef(null);
  const mix = useRef(null);
  const analysis = useRef(new Map());
  const attemptedMix = useRef('');
  const preferences = useRef({ djEnabled, autoplay, liveDjChanges });
  const manualChange = useRef(null);
  const pendingNext = useRef(null);
  const player = useRef(null);
  const mounted = useRef(false);
  const ready = useRef(null);
  const audio = useRef(null);
  const request = useRef(null);
  const generation = useRef(0);
  const source = useRef('youtube');
  const activeVideo = useRef(null);
  const localUrls = useRef(new Set());
  const listening = useRef({ seconds: 0, last: 0 });
  const actions = useRef({});
  const current = useRef({ track: null, queue: [], shuffle: false, repeat: 'off', volume: 80 });

  useEffect(() => { current.current = { track, queue, shuffle, repeat, volume, lyrics }; }, [track, queue, shuffle, repeat, volume, lyrics]);
  useEffect(() => {
    const retained = new Set([track, ...queue].filter(Boolean).map(item => item.localUrl));
    for (const url of localUrls.current) {
      if (retained.has(url)) continue;
      for (const deck of decks.current) {
        if (deck.element.src === url && deck.element !== audio.current) {
          deck.element.pause(); deck.element.removeAttribute('src'); deck.element.load();
        }
      }
      URL.revokeObjectURL(url); localUrls.current.delete(url);
    }
    const ids = new Set([track, ...queue].filter(Boolean).map(item => item.id));
    for (const id of analysis.current.keys()) if (!ids.has(id)) analysis.current.delete(id);
  }, [track, queue]);

  const cancelMix = useCallback(() => {
    pendingNext.current = null;
    if (manualChange.current) { clearInterval(manualChange.current); manualChange.current = null; }
    const activeMix = mix.current;
    mix.current = null;
    if (activeMix?.timer) clearInterval(activeMix.timer);
    for (const deck of decks.current) {
      // Media elements in refs are imperative resources, not React state.
      // eslint-disable-next-line react-hooks/immutability
      deck.element.playbackRate = 1;
      if (deck.element !== audio.current) deck.element.pause();
      if (deck.gain) {
        const now = context.current.currentTime;
        deck.gain.gain.cancelScheduledValues(now);
        deck.gain.gain.setValueAtTime(deck.element === audio.current ? current.current.volume / 100 : 0, now);
        deck.filter.frequency.cancelScheduledValues(now);
        deck.filter.frequency.setValueAtTime(20, now);
      }
    }
    player.current?.setVolume?.(current.current.volume);
    if (mounted.current) setDjState({ phase: 'idle', label: 'Ready for your next track', mode: source.current === 'local' ? 'local' : 'online' });
  }, []);

  const ensureAudioGraph = useCallback(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!context.current) context.current = new AudioContext();
    for (const deck of decks.current) {
      if (deck.gain) continue;
      const input = context.current.createMediaElementSource(deck.element);
      const filter = context.current.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 20;
      const gain = context.current.createGain(); gain.gain.value = deck.element === audio.current ? current.current.volume / 100 : 0;
      input.connect(filter).connect(gain).connect(context.current.destination);
      const element = deck.element;
      // Audio elements are imperative resources held in refs, not React state.
      // eslint-disable-next-line react-hooks/immutability
      element.volume = 1;
      Object.assign(deck, { input, filter, gain });
    }
    void context.current.resume().catch(() => {});
    return context.current;
  }, []);

  const setDjEnabled = useCallback(value => { preferences.current.djEnabled = Boolean(value); updateDjEnabled(Boolean(value)); savePreference('aurora-dj', Boolean(value)); cancelMix(); }, [cancelMix]);
  const setLiveDjChanges = useCallback(value => { preferences.current.liveDjChanges = Boolean(value); updateLiveDjChanges(Boolean(value)); savePreference('aurora-live-dj', Boolean(value)); cancelMix(); }, [cancelMix]);
  const setAutoplay = useCallback(value => {
    preferences.current.autoplay = Boolean(value); updateAutoplay(Boolean(value));
    savePreference('aurora-autoplay', Boolean(value));
    if (!value) { recommendationRequest.current?.abort(); setRecommendationsLoading(false); }
    else recommendedFor.current = null;
  }, []);

  const ensurePlayer = useCallback(async (videoId) => {
    if (player.current) return player.current;
    if (!ready.current) ready.current = loadYoutubeApi().then(YT => new Promise((resolve, reject) => {
      const host = document.getElementById('youtube-player');
      if (!host) { reject(new Error('The video player is not mounted.')); return; }
      const mount = document.createElement('div');
      host.replaceChildren(mount);
      let expired = false;
      const timeout = setTimeout(() => { expired = true; instance.destroy(); ready.current = null; reject(new Error('The video player did not respond. Please retry.')); }, 15000);
      const instance = new YT.Player(mount, {
        videoId, width: '100%', height: '100%',
        playerVars: { playsinline: 1, controls: 1, origin: window.location.origin, rel: 0 },
        events: {
          onReady: event => { clearTimeout(timeout); if (expired || !mounted.current) { event.target.destroy(); reject(new Error('Player closed.')); return; } player.current = event.target; event.target.setVolume(current.current.volume); resolve(event.target); },
          onStateChange: event => {
            if (source.current !== 'youtube' || !activeVideo.current || event.target.getVideoData?.().video_id !== activeVideo.current) return;
            setPlaying(event.data === 1);
            setLoading(event.data === 3);
            if (event.data === 1) setError('');
            if (event.data === 0 && event.target.getDuration() > 0 && event.target.getCurrentTime() >= event.target.getDuration() - 1) actions.current.ended?.();
          },
          onError: () => { if (source.current === 'youtube') { setLoading(false); setPlaying(false); setError('This video cannot play here. Try another track or open an audio file.'); } },
        },
      });
    })).catch(err => { ready.current = null; throw err; });
    return ready.current;
  }, []);

  const flushListening = useCallback(() => {
    const heard = listening.current.seconds;
    listening.current.seconds = 0; listening.current.last = performance.now();
    const selected = current.current.track;
    if (selected && heard >= 5) {
      const length = source.current === 'local' ? audio.current?.duration : player.current?.getDuration?.();
      recordListening(selected, heard, Number.isFinite(length) ? length : selected.duration);
    }
  }, []);

  const loadTrack = useCallback(async (selected, list, fadeIn = false) => {
    if (!selected) return;
    flushListening();
    cancelMix();
    attemptedMix.current = '';
    waitingForRadio.current = false;
    recommendationRequest.current?.abort();
    setRecommendationsLoading(false);
    const token = ++generation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    activeVideo.current = null;
    audio.current?.pause(); player.current?.stopVideo?.();
    source.current = selected.localUrl ? 'local' : 'youtube';
    current.current.track = selected;
    const nextQueue = list?.length ? list : current.current.queue.some(item => item.id === selected.id) ? current.current.queue : [...current.current.queue, selected];
    current.current.queue = nextQueue;
    updateQueue(nextQueue); setQueueIndex(nextQueue.findIndex(item => item.id === selected.id));
    setDjWindow(null);
    setTrack(selected); setTime(0); setDuration(selected.duration || 0); setPlaying(false); setLoading(true); setError(''); setLyrics(null); setLyricsOffset(0);
    setLyricsLoading(!selected.localUrl);
    const fetchLyrics = videoId => fetch(buildApiUrl('/api/lyrics/structured', { artist: selected.artist, title: selected.title, album: selected.album, duration: selected.duration, videoId }), { signal: controller.signal })
        .then(response => response.ok ? response.json() : null)
        .catch(() => null); // Lyrics are optional and never block playback.
    const cached = prepared.current.get(selected.id);
    const lyricsRequest = selected.localUrl ? Promise.resolve(null) : cached?.lyrics ? Promise.resolve(cached.lyrics) : fetchLyrics(selected.videoId);
    if (!selected.localUrl) {
      lyricsRequest
        .then(result => { if (mounted.current && token === generation.current) setLyrics(result); })
        .finally(() => { if (mounted.current && token === generation.current) setLyricsLoading(false); });
    }
    try {
      if (selected.localUrl) {
        if (!audio.current) throw new Error('Audio is not ready. Please retry.');
        audio.current.src = selected.localUrl;
        const graph = ensureAudioGraph();
        audio.current.volume = graph ? 1 : current.current.volume / 100;
        await audio.current.play();
      } else {
        let videoId = selected.videoId || cached?.videoId;
        if (!videoId) {
          const response = await fetch(buildApiUrl('/api/video/search', { artist: selected.artist, title: selected.title, duration: selected.duration }), { signal: controller.signal });
          if (!response.ok) throw new Error('The music source could not connect. Please retry.');
          const data = await response.json(); videoId = data.videoId;
        }
        if (!mounted.current || token !== generation.current) return;
        if (!videoId) throw new Error('No playable video found for this track. Try another song.');
        if (!selected.videoId) {
          // SimpMusic needs the resolved YouTube ID; preserve a stronger initial result.
          void lyricsRequest.then(async initial => {
            if (!mounted.current || token !== generation.current || initial?.sync === 'word') return;
            setLyricsLoading(true);
            const fallback = await fetchLyrics(videoId);
            if (!mounted.current || token !== generation.current) return;
            const rank = { plain: 1, line: 2, word: 3 };
            if (fallback && (rank[fallback.sync] || 0) > (rank[initial?.sync] || 0)) setLyrics(fallback);
            setLyricsLoading(false);
          });
        }
        const instance = await ensurePlayer(videoId);
        if (!mounted.current || token !== generation.current) return;
        activeVideo.current = videoId;
        if (fadeIn && preferences.current.djEnabled) {
          mix.current = { kind: 'online-in', started: null };
          instance.setVolume(0);
          setDjState({ phase: 'mixing', label: 'Gentle fade in', mode: 'online', progress: 0 });
        }
        instance.loadVideoById(videoId);
      }
    } catch (err) {
      if (mounted.current && token === generation.current && err.name !== 'AbortError') { setError(err instanceof TypeError ? 'Could not reach the music service. Check your connection and retry.' : err.message || 'Playback failed.'); setPlaying(false); }
    } finally { if (mounted.current && token === generation.current) setLoading(false); }
  }, [ensurePlayer, cancelMix, ensureAudioGraph, flushListening]);

  const seek = useCallback(value => {
    cancelMix();
    const seconds = Math.max(0, Number(value) || 0);
    if (source.current === 'local' && audio.current) audio.current.currentTime = seconds;
    else player.current?.seekTo?.(seconds, true);
    setTime(seconds);
  }, [cancelMix]);
  const togglePlay = useCallback(async () => {
    cancelMix();
    setError('');
    try {
      if (source.current === 'local') { if (audio.current?.paused) await audio.current.play(); else audio.current?.pause(); }
      else if (player.current && activeVideo.current) { if (player.current.getPlayerState() === 1) player.current.pauseVideo(); else player.current.playVideo(); }
      else if (current.current.track) await loadTrack(current.current.track);
    } catch (err) { setError(err.message || 'Playback was blocked. Press play to retry.'); }
  }, [loadTrack, cancelMix]);
  const next = useCallback((ended = false) => {
    const state = current.current;
    if (ended === true) flushListening();
    if (!state.queue.length) return;
    if (ended === true && state.repeat === 'one') { seek(0); if (source.current === 'local') audio.current?.play().catch(err => setError(err.message)); else player.current?.playVideo(); return; }
    const index = state.queue.findIndex(item => item.id === (pendingNext.current ?? state.track?.id));
    let nextIndex = index + 1;
    if (state.shuffle && state.queue.length > 1) nextIndex = (index + 1 + Math.floor(Math.random() * (state.queue.length - 1))) % state.queue.length;
    if (nextIndex >= state.queue.length) {
      if (state.repeat === 'all' || ended !== true) nextIndex = 0;
      else { if (mix.current) cancelMix(); setPlaying(false); if (preferences.current.autoplay && !state.track?.localUrl) { waitingForRadio.current = true; recommendedFor.current = null; setRadioRetry(value => value + 1); } return; }
    }
    const selected = state.queue[nextIndex];
    const isPlaying = source.current === 'local' ? !audio.current?.paused : player.current?.getPlayerState?.() === 1;
    if (ended !== true && preferences.current.djEnabled && preferences.current.liveDjChanges && isPlaying && selected.id !== state.track?.id) {
      cancelMix();
      if (source.current === 'local' && selected.localUrl && context.current?.state === 'running') {
        void actions.current.manualMix?.(selected, Math.max(.1, audio.current.duration - audio.current.currentTime), 3);
        return;
      }
      if (source.current === 'youtube') {
        pendingNext.current = selected.id;
        const started = performance.now();
        manualChange.current = setInterval(() => {
          const progress = Math.min(1, (performance.now() - started) / 350);
          player.current?.setVolume?.(state.volume * Math.cos(progress * Math.PI / 2));
          if (progress >= 1) { clearInterval(manualChange.current); manualChange.current = null; void loadTrack(selected, state.queue, true); }
        }, 25);
        return;
      }
    }
    loadTrack(selected, state.queue, ended === true && preferences.current.djEnabled);
  }, [loadTrack, seek, cancelMix, flushListening]);
  const previous = useCallback(() => {
    const seconds = source.current === 'local' ? audio.current?.currentTime : player.current?.getCurrentTime?.();
    if (seconds > 3) { seek(0); return; }
    const state = current.current;
    if (!state.queue.length) return;
    const index = state.queue.findIndex(item => item.id === state.track?.id);
    loadTrack(state.queue[(index - 1 + state.queue.length) % state.queue.length], state.queue);
  }, [loadTrack, seek]);
  const setVolume = useCallback(value => {
    cancelMix();
    const amount = Math.min(100, Math.max(0, Number(value) || 0));
    current.current.volume = amount; updateVolume(amount);
    const deck = decks.current.find(item => item.element === audio.current);
    if (deck?.gain) deck.gain.gain.setValueAtTime(amount / 100, context.current.currentTime);
    else if (audio.current) audio.current.volume = amount / 100;
    player.current?.setVolume?.(amount);
  }, [cancelMix]);
  const setQueue = useCallback(value => {
    if (mix.current || manualChange.current) cancelMix();
    const result = typeof value === 'function' ? value(current.current.queue) : value;
    current.current.queue = result; updateQueue(result); setQueueIndex(result.findIndex(item => item.id === current.current.track?.id));
  }, [cancelMix]);
  const addToQueue = useCallback(item => { setQueue(items => items.some(entry => entry.id === item.id) ? items : [...items, item]); }, [setQueue]);
  const loadLocalFiles = useCallback(files => {
    const valid = Array.from(files || []).filter(file => file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(file.name));
    if (!valid.length) { setError('Choose an audio file.'); return; }
    const tracks = valid.map(file => {
      const url = URL.createObjectURL(file); localUrls.current.add(url);
      return { id: `local-${crypto.randomUUID()}`, title: file.name.replace(/\.[^.]+$/, ''), artist: 'On this device', album: 'Local audio', artwork: '', duration: 0, localUrl: url };
    });
    void loadTrack(tracks[0], tracks);
    const graph = ensureAudioGraph();
    if (graph) void (async () => {
      for (let i = 0; i < valid.length && mounted.current; i++) {
        try { const result = await analyzeLocalTempo(valid[i], graph); if (mounted.current) analysis.current.set(tracks[i].id, result); } catch { /* Unsupported or ambiguous audio keeps a plain crossfade. */ }
      }
    })();
  }, [loadTrack, ensureAudioGraph]);
  const loadLocalFile = useCallback(file => loadLocalFiles(file ? [file] : []), [loadLocalFiles]);

  useEffect(() => {
    if (!autoplay || !track || track.localUrl || queue.length - queueIndex > 3 || recommendedFor.current === track.id) return;
    const controller = new AbortController(); recommendationRequest.current = controller;
    recommendedFor.current = track.id;
    Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setRecommendationsLoading(true); setRecommendationError('');
      try {
        let suggestions = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          try { suggestions = await getSimilarTracks(track, controller.signal); if (suggestions.length) break; }
          catch (err) { if (controller.signal.aborted || attempt === 2) throw err; }
          if (attempt < 2) await new Promise(resolve => {
            const timer = setTimeout(done, (attempt + 1) * 1500);
            function done() { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); }
            controller.signal.addEventListener('abort', done, { once: true });
          });
          if (controller.signal.aborted) return;
        }
        if (controller.signal.aborted || !mounted.current || current.current.track?.id !== track.id) return;
        const identity = item => `${item.artist}|${item.title}`.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const items = current.current.queue;
        const seen = new Set(items.map(identity));
        const additions = suggestions.filter(candidate => {
          const key = identity(candidate);
          if (seen.has(key) || items.some(item => item.id === candidate.id)) return false;
          seen.add(key); return true;
        });
        if (!additions.length) { setRecommendationError('No new similar songs found. Try another track.'); return; }
        // Retain recent history and every future/manual selection without an unbounded radio queue.
        const index = items.findIndex(item => item.id === track.id);
        const updated = [...items.slice(Math.max(0, index - 30)), ...additions];
        setQueue(updated);
        if (waitingForRadio.current) { waitingForRadio.current = false; void loadTrack(additions[0], updated, preferences.current.djEnabled); }
      } catch (err) {
        if (!controller.signal.aborted && mounted.current) setRecommendationError(err.message || 'Similar tracks are temporarily unavailable.');
      } finally { if (!controller.signal.aborted && mounted.current) setRecommendationsLoading(false); }
    });
  }, [autoplay, track, queue.length, queueIndex, radioRetry, setQueue, loadTrack]);

  // Warm the next local decoder, or resolve the online source and lyrics early.
  // A source cache reduces network work; the iframe still controls its own buffering.
  useEffect(() => {
    if (!track || shuffle || repeat === 'one') return;
    const selected = queue[queueIndex + 1] || (repeat === 'all' ? queue[0] : null);
    if (!selected || selected.id === track.id) return;
    const controller = new AbortController();
    if (selected.localUrl) {
      const inactive = decks.current.find(deck => deck.element !== audio.current);
      if (inactive && !mix.current && inactive.element.src !== selected.localUrl) {
        inactive.element.preload = 'auto'; inactive.element.src = selected.localUrl; inactive.element.load();
      }
    } else if (!prepared.current.has(selected.id)) {
      void (async () => {
        try {
          let videoId = selected.videoId;
          if (!videoId) {
            const response = await fetch(buildApiUrl('/api/video/search', { artist: selected.artist, title: selected.title, duration: selected.duration }), { signal: controller.signal });
            if (!response.ok) return;
            videoId = (await response.json()).videoId;
          }
          if (!videoId || controller.signal.aborted) return;
          const entry = { videoId }; prepared.current.set(selected.id, entry);
          while (prepared.current.size > 3) prepared.current.delete(prepared.current.keys().next().value);
          const response = await fetch(buildApiUrl('/api/lyrics/structured', { artist: selected.artist, title: selected.title, album: selected.album, duration: selected.duration, videoId }), { signal: controller.signal });
          if (response.ok && !controller.signal.aborted) entry.lyrics = await response.json();
        } catch { /* Normal playback resolves again if speculative preparation fails. */ }
      })();
    }
    return () => controller.abort();
  }, [track, queue, queueIndex, shuffle, repeat]);

  const startLocalMix = useCallback(async (selected, remaining, overrideSeconds) => {
    const graph = ensureAudioGraph();
    if (!graph || graph.state !== 'running') return;
    const outgoing = decks.current.find(deck => deck.element === audio.current);
    const incoming = decks.current.find(deck => deck !== outgoing);
    if (!outgoing || !incoming) return;
    const token = { kind: 'local', incoming, outgoing, starting: true };
    attemptedMix.current = `${current.current.track?.id}:${selected.id}`;
    mix.current = token;
    const outroTempo = analysis.current.get(current.current.track?.id)?.outro;
    const plan = planTransition(outroTempo, analysis.current.get(selected.id)?.intro);
    try {
      if (incoming.element.src !== selected.localUrl) incoming.element.src = selected.localUrl;
      incoming.element.currentTime = analysis.current.get(selected.id)?.introStart || 0; incoming.element.playbackRate = 1;
      incoming.gain.gain.setValueAtTime(0, graph.currentTime);
      await incoming.element.play();
      if (mix.current !== token) { incoming.element.pause(); return; }
      const seconds = Math.min(overrideSeconds || plan.seconds, remaining / Math.max(1, plan.rate));
      const now = graph.currentTime;
      const outCurve = new Float32Array(65), inCurve = new Float32Array(65);
      for (let i = 0; i < outCurve.length; i++) {
        const [out, input] = equalPower(i / 64);
        outCurve[i] = out * current.current.volume / 100; inCurve[i] = input * current.current.volume / 100;
      }
      outgoing.gain.gain.setValueCurveAtTime(outCurve, now, seconds);
      incoming.gain.gain.setValueCurveAtTime(inCurve, now, seconds);
      outgoing.filter.frequency.setValueAtTime(20, now);
      outgoing.filter.frequency.exponentialRampToValueAtTime(900, now + seconds);
      incoming.filter.frequency.setValueAtTime(900, now);
      incoming.filter.frequency.exponentialRampToValueAtTime(20, now + seconds);
      Object.assign(token, { starting: false, started: now, seconds, plan });
      // Metadata and lyrics follow the incoming audible track from its first beat.
      flushListening();
      setDjWindow(null);
      audio.current = incoming.element;
      current.current.track = selected;
      setTrack(selected); setTime(incoming.element.currentTime); setDuration(Number.isFinite(incoming.element.duration) ? incoming.element.duration : 0);
      setQueueIndex(current.current.queue.findIndex(item => item.id === selected.id));
      setLyrics(null); setLyricsOffset(0); setLyricsLoading(false); setPlaying(true);
      setDjState({ phase: 'mixing', label: plan.matched ? 'Tempo blend · local audio' : 'Hollow crossfade · local audio', mode: 'local', progress: 0, fromBpm: plan.matched ? outroTempo.bpm : undefined, toBpm: plan.targetBpm });
    } catch {
      if (mix.current === token) { cancelMix(); if (overrideSeconds) void loadTrack(selected, current.current.queue); }
      // The original track continues; normal advance retries the next file.
    }
  }, [ensureAudioGraph, cancelMix, loadTrack, flushListening]);

  const tickMix = useCallback(() => {
    if (!preferences.current.djEnabled) { setDjWindow(previous => previous === null ? previous : null); return; }
    const state = current.current;
    const activeMix = mix.current;
    if (activeMix?.kind === 'local') {
      if (activeMix.starting) return;
      const progress = Math.min(1, (context.current.currentTime - activeMix.started) / activeMix.seconds);
      activeMix.outgoing.element.playbackRate = 1 + (activeMix.plan.rate - 1) * progress;
      setDjState(previous => ({ ...previous, progress }));
      if (progress >= 1) {
        cancelMix();
        setDjState(previous => ({ ...previous, phase: 'idle', label: activeMix.plan.matched ? 'Tempo blend complete' : 'Crossfade complete', mode: 'local' }));
      }
      return;
    }
    if (activeMix?.kind === 'online-in') {
      if (player.current?.getPlayerState?.() !== 1) return;
      activeMix.started ??= performance.now();
      const progress = Math.min(1, (performance.now() - activeMix.started) / 2500);
      player.current.setVolume(state.volume * Math.sin(progress * Math.PI / 2));
      setDjState(previous => ({ ...previous, progress }));
      if (progress >= 1) cancelMix();
      return;
    }
    if (state.repeat === 'one' || state.shuffle) {
      setDjWindow(previous => previous === null ? previous : null);
      if (activeMix?.kind === 'online-out') cancelMix();
      return;
    }
    const index = state.queue.findIndex(item => item.id === state.track?.id);
    const selected = state.queue[index + 1] || (state.repeat === 'all' ? state.queue[0] : null);
    if (!selected || selected.id === state.track?.id) {
      setDjWindow(previous => previous === null ? previous : null);
      if (activeMix?.kind === 'online-out') cancelMix();
      return;
    }
    if (source.current === 'local') {
      const element = audio.current;
      if (!element || element.paused || !selected.localUrl || !Number.isFinite(element.duration)) return;
      const remaining = element.duration - element.currentTime;
      const plan = planTransition(analysis.current.get(state.track?.id)?.outro, analysis.current.get(selected.id)?.intro);
      const start = Math.min(element.duration - plan.seconds, analysis.current.get(state.track?.id)?.mixStart ?? element.duration - plan.seconds);
      const standby = decks.current.find(deck => deck.element !== element);
      if (standby && standby.element.src !== selected.localUrl) { standby.element.preload = 'auto'; standby.element.src = selected.localUrl; standby.element.load(); }
      const ready = Boolean(standby?.element.readyState >= 3);
      const window = { start: Math.max(0, start), end: Math.min(element.duration, start + plan.seconds), seconds: plan.seconds, mode: 'local', ready };
      setDjWindow(previous => JSON.stringify(previous) === JSON.stringify(window) ? previous : window);
      if (remaining > 0 && element.currentTime >= start && element.duration > 12 && attemptedMix.current !== `${state.track?.id}:${selected.id}`) void startLocalMix(selected, remaining);
    } else if (player.current?.getPlayerState?.() === 1) {
      const length = player.current.getDuration();
      const lastWordEnd = state.lyrics?.lines?.at(-1)?.words?.at(-1)?.end;
      const ready = Boolean(prepared.current.get(selected.id)?.videoId);
      // Only genuine word timing can identify a lyric-free outro online.
      const start = ready && Number.isFinite(lastWordEnd) && lastWordEnd >= length - 30 && lastWordEnd < length - 6
        ? lastWordEnd + 1 : Math.max(0, length - 3);
      const end = Math.min(length, start + 3);
      const window = { start, end, seconds: 3, mode: 'online', ready };
      setDjWindow(previous => JSON.stringify(previous) === JSON.stringify(window) ? previous : window);
      const remaining = end - player.current.getCurrentTime();
      if (remaining <= 0 && activeMix?.kind === 'online-out') { actions.current.ended?.(); return; }
      if (remaining > 0 && remaining <= 3 && player.current.getDuration() > 12) {
        mix.current = { kind: 'online-out' };
        const progress = 1 - remaining / 3;
        player.current.setVolume(state.volume * Math.cos(progress * Math.PI / 2));
        setDjState({ phase: 'mixing', label: 'Gentle fade out', mode: 'online', progress });
      }
    }
  }, [cancelMix, startLocalMix]);

  useEffect(() => { actions.current.manualMix = startLocalMix; }, [startLocalMix]);
  useEffect(() => { actions.current.ended = () => next(true); }, [next]);
  useEffect(() => { actions.current.tickMix = tickMix; }, [tickMix]);
  useEffect(() => {
    mounted.current = true;
    const elements = [new Audio(), new Audio()];
    decks.current = elements.map(element => ({ element })); audio.current = elements[0];
    const cleanups = elements.map(element => {
      const active = () => source.current === 'local' && audio.current === element;
      const onPlay = () => { if (active()) { setPlaying(true); setLoading(false); } };
      const onPause = () => { if (active()) setPlaying(false); };
      const onMetadata = () => { if (active() && Number.isFinite(element.duration)) setDuration(element.duration); };
      const onEnded = () => { if (active()) actions.current.ended?.(); };
      const onError = () => { if (active()) { setError('This audio file could not be decoded by your browser.'); setLoading(false); setPlaying(false); } };
      const events = { play: onPlay, pause: onPause, loadedmetadata: onMetadata, ended: onEnded, error: onError };
      for (const [name, handler] of Object.entries(events)) element.addEventListener(name, handler);
      return () => { for (const [name, handler] of Object.entries(events)) element.removeEventListener(name, handler); element.pause(); element.removeAttribute('src'); element.load(); };
    });
    listening.current.last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const audible = source.current === 'local' ? audio.current && !audio.current.paused && !audio.current.ended : player.current?.getPlayerState?.() === 1;
      if (audible) listening.current.seconds += Math.min(1, Math.max(0, (now - listening.current.last) / 1000));
      listening.current.last = now;
      if (source.current === 'local') { if (audio.current && !audio.current.paused) setTime(audio.current.currentTime); }
      else if (!document.hidden && player.current?.getPlayerState?.() === 1 && player.current?.getCurrentTime) { setTime(player.current.getCurrentTime() || 0); const length = player.current.getDuration(); if (length > 0) setDuration(length); }
    }, 250);
    const mixTimer = setInterval(() => actions.current.tickMix?.(), 100);
    const urls = localUrls.current;
    return () => {
      flushListening();
      mounted.current = false; if (manualChange.current) clearInterval(manualChange.current); request.current?.abort(); recommendationRequest.current?.abort(); clearInterval(timer); clearInterval(mixTimer);
      cleanups.forEach(cleanup => cleanup()); audio.current = null; decks.current = []; mix.current = null;
      void context.current?.close().catch(() => {}); context.current = null;
      player.current?.destroy?.(); player.current = null; ready.current = null;
      urls.forEach(url => URL.revokeObjectURL(url)); urls.clear();
    };
  }, [flushListening]);
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album, artwork: track.artwork ? [{ src: track.artwork }] : [] });
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    const handlers = { play: () => { if (!playing) togglePlay(); }, pause: () => { if (playing) togglePlay(); }, previoustrack: previous, nexttrack: () => next(), seekto: details => seek(details.seekTime) };
    for (const [action, handler] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Browser support varies by action. */ } }
    return () => { for (const action of Object.keys(handlers)) { try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Unsupported action. */ } } };
  }, [track, playing, togglePlay, next, previous, seek]);

  const getPlaybackTime = useCallback(() => {
    const value = source.current === 'local' ? audio.current?.currentTime : player.current?.getCurrentTime?.();
    return Number.isFinite(value) ? value : 0;
  }, []);

  return { track, playing, loading, error, time, duration, volume, queue, queueIndex, shuffle, repeat, lyrics, lyricsLoading, loadTrack, togglePlay, seek, setVolume, next, previous, setShuffle, setRepeat, setQueue, addToQueue, lyricsOffset, setLyricsOffset, loadLocalFile, loadLocalFiles, djEnabled, setDjEnabled, djState, djWindow, liveDjChanges, setLiveDjChanges, autoplay, setAutoplay, recommendationsLoading, recommendationError, getPlaybackTime };
}
export default usePlayer;


