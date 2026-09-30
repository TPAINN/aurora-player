import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { buildApiUrl } from '../lib/api';
import { getSimilarTracks, getTrackTempo } from '../lib/catalog';
import { pickSeed, recordListening, tasteFilter } from '../lib/listening';
import { adaptiveBlend, analyzeLocalTempo, beatAlignedEntry, blendCurve, vocalSpans, chooseEntry, equalPower, glideRate, phaseNudge, planOnlineCue, planOnlineEntry, planTransition, quantizeRate, recoverRate, smoothstep } from '../lib/dj';
import { playSweep } from '../lib/sweep';
import { nextPlayable } from '../lib/queue';
import { detectLanguage } from '../../shared/language.js';
import { artworkAt } from '../lib/artwork';
import { probeFile } from '../lib/audio-format';

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
// Each online deck owns one wrapper so the visible video can crossfade between decks.
function deckHost(index) {
  const host = document.getElementById('youtube-player');
  if (!host) return null;
  let wrap = host.querySelector(`[data-deck="${index}"]`);
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'yt-deck'; wrap.dataset.deck = String(index); host.append(wrap); }
  return wrap;
}
function showDeck(index) {
  for (const deck of [0, 1]) deckHost(deck)?.classList.toggle('is-active', deck === index);
}
// What actually plays: an official audio upload (Topic channel or "Official Audio") or another upload.
const describeSource = (data, fallbackChannel = '') => ({ kind: 'youtube', official: /-\s*topic$/i.test(data?.channel || '') || /official audio/i.test(data?.title || ''), channel: String(data?.channel || fallbackChannel).replace(/\s*-\s*Topic$/i, '') });
const lyricsText = lyrics => (lyrics?.lines?.length ? lyrics.lines.map(line => line.text).join('\n') : lyrics?.plainLyrics) || '';
const IDLE = { phase: 'idle', label: 'Ready for your next track' };
// High-frequency values live outside React state so a clock tick re-renders only
// the components that display it, never the whole application.
function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set: next => { if (next === value) return; value = next; listeners.forEach(listener => listener()); },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
// Buffer the next song well ahead so the blend never waits on the network.
const PRIME_LEAD = 90;
// YouTube needs a few hundred milliseconds to become audible after playVideo().
const START_LEAD = .35;
const START_TIMEOUT = 3000;
// Blend lengths offered: 5–10 s, the range a DJ would ride two songs together.
const BLENDS = ['auto', 5, 8, 10];
const readBlend = value => (value === 'auto' ? 'auto' : BLENDS.includes(Number(value)) ? Number(value) : 'auto');
// Some embeds only play whole 0.05 speed steps; tempo plans then use that grid.
const RATE_STEP = .05;
const snapRate = (value, quantum) => Number((Math.round(value / quantum) * quantum).toFixed(3));

export function usePlayer() {
  const [track, setTrack] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clock] = useState(() => createStore(0));
  const [mixProgress] = useState(() => createStore(0));
  const [duration, setDuration] = useState(0);
  const [volume, updateVolume] = useState(80);
  const [queue, updateQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [lyrics, setLyrics] = useState(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsOffset, setLyricsOffset] = useState(0);
  // 1 when the listener moves forward (next, blend, pick), -1 for Previous: drives the change animation.
  const [direction, setDirection] = useState(1);
  // How the current song arrived: 'blend' (a DJ transition) or 'skip' (a direct change).
  const [changeKind, setChangeKind] = useState('skip');
  const travel = useRef(1);
  const [djEnabled, updateDjEnabled] = useState(() => readPreference('aurora-dj', false));
  const [liveDjChanges, updateLiveDjChanges] = useState(() => readPreference('aurora-live-dj', false));
  const [autoplay, updateAutoplay] = useState(() => readPreference('aurora-autoplay', true));
  const [transitionFx, updateTransitionFx] = useState(() => readPreference('aurora-dj-fx', true));
  // Whether this YouTube embed honours fine playback rates: learnt once, by asking and reading back.
  const rateSupport = useRef('unknown');
  const [surround, updateSurround] = useState(() => readPreference('aurora-surround', true));
  const [blendLength, updateBlendLength] = useState(() => { try { return readBlend(localStorage.getItem('aurora-blend')); } catch { return 'auto'; } });
  const [sourceInfo, setSourceInfo] = useState(null);
  const [djState, setDjState] = useState({ ...IDLE, mode: 'online' });
  const announced = useRef({ ...IDLE, mode: 'online' });
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState('');
  const [djWindow, setDjWindow] = useState(null);
  const [radioRetry, setRadioRetry] = useState(0);
  const prepared = useRef(new Map());
  const tempos = useRef(new Map());
  const waitingForRadio = useRef(false);
  const recommendationRequest = useRef(null);
  const recommendedFor = useRef(null);
  const decks = useRef([]);
  const context = useRef(null);
  const mix = useRef(null);
  const analysis = useRef(new Map());
  const attemptedMix = useRef('');
  const preferences = useRef({ djEnabled, autoplay, liveDjChanges, surround, blendLength, transitionFx });
  const manualChange = useRef(null);
  const pendingNext = useRef(null);
  const player = useRef(null);
  const yt = useRef([{ player: null, ready: null }, { player: null, ready: null }]);
  const ytActive = useRef(0);
  const mounted = useRef(false);
  const audio = useRef(null);
  const request = useRef(null);
  const generation = useRef(0);
  const source = useRef('youtube');
  const activeVideo = useRef(null);
  const localUrls = useRef(new Set());
  const listening = useRef({ seconds: 0, last: 0 });
  const actions = useRef({});
  const current = useRef({ track: null, queue: [], shuffle: false, repeat: 'off', volume: 80 });
  // Songs with no playable upload are skipped instead of stopping the music.
  const unplayable = useRef(new Set());
  const [unavailable, setUnavailable] = useState(() => new Set());
  const shufflePick = useRef(null);
  // Other uploads the resolver found, tried in turn when YouTube refuses one.
  const alternates = useRef(new Map());
  const resolving = useRef(new Map());
  const autoSkips = useRef(0);
  const [notice, setNotice] = useState('');
  // Notices (a song skipped) show for a few seconds, then clear themselves.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

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

  const standbyIndex = () => 1 - ytActive.current;
  // Status text re-renders only when it changes; progress streams through its store.
  const announce = useCallback(update => {
    const next = typeof update === 'function' ? update(announced.current) : update;
    const { progress, ...state } = next;
    if (Number.isFinite(progress)) mixProgress.set(Math.max(0, Math.min(1, progress)));
    if (JSON.stringify(state) === JSON.stringify(announced.current)) return;
    announced.current = state;
    setDjState(state);
  }, [mixProgress]);
  // The song that plays after `afterId`, skipping unplayable songs; shuffle picks ahead.
  const upcoming = useCallback((state = current.current, afterId = state.track?.id, wrap = state.repeat === 'all') => {
    const result = nextPlayable(state.queue, afterId, { shuffle: state.shuffle, wrap, unplayable: unplayable.current, pick: shufflePick.current });
    shufflePick.current = result.pick;
    return result.item;
  }, []);
  const markUnplayable = useCallback(item => {
    if (!item?.id || unplayable.current.has(item.id)) return;
    unplayable.current.add(item.id);
    setUnavailable(new Set(unplayable.current));
    if (item.id !== current.current.track?.id) setNotice(`“${item.title}” isn’t available to play here, so it will be skipped.`);
  }, []);
  // One resolver for playback and preparation: shared in-flight requests, and the
  // runner-up uploads kept as alternates.
  // `search` looks up other uploads even for a song that arrived with its own video.
  const resolveSource = useCallback((selected, signal, { search = false } = {}) => {
    const cached = prepared.current.get(selected.id);
    if (cached?.videoId && !search) return Promise.resolve(cached);
    if (selected.videoId && !search) return Promise.resolve({ videoId: selected.videoId, source: { kind: 'youtube', official: false, video: true, channel: selected.artist } });
    if (resolving.current.has(selected.id)) return resolving.current.get(selected.id);
    const request = (async () => {
      const response = await fetch(buildApiUrl('/api/video/search', { artist: selected.artist, title: selected.title, duration: selected.duration, variant: selected.variant }), { signal });
      if (!response.ok) throw new Error('The music source could not connect. Please retry.');
      const data = await response.json();
      if (!data.videoId) { markUnplayable(selected); return { videoId: null }; }
      const entry = { ...(prepared.current.get(selected.id) || {}), videoId: data.videoId, source: describeSource(data) };
      alternates.current.set(selected.id, (data.candidates || []).map(candidate => candidate.videoId).filter(id => id && id !== data.videoId).slice(0, 4));
      prepared.current.set(selected.id, entry);
      while (prepared.current.size > 12) prepared.current.delete(prepared.current.keys().next().value);
      return entry;
    })().finally(() => resolving.current.delete(selected.id));
    resolving.current.set(selected.id, request);
    return request;
  }, [markUnplayable]);
  // A song that arrived with its own video has no runner-ups until YouTube refuses
  // that video: then, once, the resolver is asked for other uploads of it.
  const searched = useRef(new Set());
  const searchAlternates = useCallback(async (selected, refused) => {
    if (!selected?.videoId || searched.current.has(selected.id)) return false;
    searched.current.add(selected.id);
    try {
      const found = await resolveSource(selected, undefined, { search: true });
      const spare = [found.videoId, ...(alternates.current.get(selected.id) || [])].filter(id => id && id !== refused && id !== selected.videoId);
      alternates.current.set(selected.id, [...new Set(spare)]);
      return spare.length > 0;
    } catch { return false; }
  }, [resolveSource]);
  // Intent prefetch: a song the listener is about to choose resolves ahead of the tap.
  const warm = useCallback(track => {
    if (!track || track.localUrl || track.videoId || prepared.current.get(track.id)?.videoId || unplayable.current.has(track.id)) return;
    void resolveSource(track).catch(() => {});
  }, [resolveSource]);
  // The YouTube player script loads while the app is idle, not on the first tap.
  useEffect(() => {
    const idle = window.requestIdleCallback || (callback => setTimeout(callback, 1200));
    const handle = idle(() => { void loadYoutubeApi().catch(() => {}); });
    return () => (window.cancelIdleCallback || clearTimeout)(handle);
  }, []);
  // The blend length to aim for: a fixed choice, or Auto — the longest the music
  // leaves room for (5–10 s), measured from the songs themselves.
  const blendTarget = useCallback(spans => {
    const choice = preferences.current.blendLength;
    return choice === 'auto' ? adaptiveBlend(spans) : choice;
  }, []);
  const setIdle = useCallback((label = IDLE.label) => {
    if (mounted.current) announce({ ...IDLE, label, mode: source.current === 'local' ? 'local' : 'online', progress: 0 });
  }, [announce]);

  // Restores every deck to a single, full-volume, native-tempo source.
  const cancelMix = useCallback(() => {
    pendingNext.current = null;
    if (manualChange.current) { clearInterval(manualChange.current); manualChange.current = null; }
    const activeMix = mix.current;
    mix.current = null;
    activeMix?.stopSweep?.();
    if (activeMix?.frame) cancelAnimationFrame(activeMix.frame);
    for (const deck of decks.current) {
      // Media elements in refs are imperative resources, not React state.
      // eslint-disable-next-line react-hooks/immutability
      deck.element.playbackRate = 1;
      if (deck.element !== audio.current) deck.element.pause();
      if (deck.gain) {
        const now = context.current.currentTime;
        const active = deck.element === audio.current;
        for (const [param, value] of [[deck.gain.gain, active ? current.current.volume / 100 : 0], [deck.highpass.frequency, 20], [deck.lowpass.frequency, 20000], [deck.lowpass.Q, .8], [deck.echoSend.gain, 0]]) {
          param.cancelScheduledValues(now); param.setValueAtTime(value, now);
        }
        // Back to the direct route with a short, click-free handover.
        for (const [param, value] of [[deck.dry.gain, 1], [deck.wet.gain, 0]]) {
          param.cancelScheduledValues(now); param.setTargetAtTime(value, now, .02);
        }
      }
    }
    const standby = yt.current[standbyIndex()].player;
    if (activeMix?.kind === 'online-blend') {
      if (activeMix.stage === 'mixing' || activeMix.stage === 'recover') activeMix.outgoing?.pauseVideo?.();
      else { standby?.pauseVideo?.(); standby?.mute?.(); }
    }
    player.current?.setPlaybackRate?.(1);
    player.current?.setVolume?.(current.current.volume);
    player.current?.unMute?.();
    showDeck(ytActive.current);
    setIdle();
  }, [setIdle]);

  const ensureAudioGraph = useCallback(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!context.current) context.current = new AudioContext({ latencyHint: 'playback' });
    const graph = context.current;
    // Multichannel files reach every speaker the output offers; stereo stays stereo.
    const channels = preferences.current.surround ? graph.destination.maxChannelCount : 2;
    if (graph.destination.channelCount !== channels) {
      graph.destination.channelCount = Math.max(2, channels);
      graph.destination.channelInterpretation = 'speakers';
    }
    for (const deck of decks.current) {
      if (deck.gain) continue;
      // input → high-pass → low-pass → gain → out, with a tempo-synced echo send
      // that keeps ringing after the outgoing deck fades: the hollow tail.
      const input = graph.createMediaElementSource(deck.element);
      const highpass = graph.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 20; highpass.Q.value = 1.1;
      const lowpass = graph.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 20000; lowpass.Q.value = .8;
      const gain = graph.createGain(); gain.gain.value = deck.element === audio.current ? current.current.volume / 100 : 0;
      const echoSend = graph.createGain(); echoSend.gain.value = 0;
      const delay = graph.createDelay(2); delay.delayTime.value = .375;
      const feedback = graph.createGain(); feedback.gain.value = .42;
      const tone = graph.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2400;
      // Two routes into the deck gain: a direct one that is bit-transparent apart
      // from volume, and the filter route that exists only for DJ blends.
      const dry = graph.createGain(); dry.gain.value = 1;
      const wet = graph.createGain(); wet.gain.value = 0;
      input.connect(dry).connect(gain);
      input.connect(highpass).connect(lowpass).connect(wet).connect(gain);
      gain.connect(graph.destination);
      lowpass.connect(echoSend).connect(delay).connect(tone).connect(feedback).connect(delay);
      tone.connect(graph.destination);
      const element = deck.element;
      // Audio elements are imperative resources held in refs, not React state.
      // eslint-disable-next-line react-hooks/immutability
      element.volume = 1;
      element.preservesPitch = true;
      Object.assign(deck, { input, highpass, lowpass, gain, echoSend, delay, dry, wet });
    }
    void graph.resume().catch(() => {});
    return graph;
  }, []);

  // The shared context alone (online blends only need it for the synthesized sweep).
  const audioContext = useCallback(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!context.current) context.current = new AudioContext({ latencyHint: 'playback' });
    if (context.current.state !== 'running') void context.current.resume().catch(() => {});
    return context.current;
  }, []);
  const setDjEnabled = useCallback(value => { preferences.current.djEnabled = Boolean(value); updateDjEnabled(Boolean(value)); savePreference('aurora-dj', Boolean(value)); cancelMix(); attemptedMix.current = ''; }, [cancelMix]);
  const setTransitionFx = useCallback(value => { preferences.current.transitionFx = Boolean(value); updateTransitionFx(Boolean(value)); savePreference('aurora-dj-fx', Boolean(value)); }, []);
  const setLiveDjChanges = useCallback(value => { preferences.current.liveDjChanges = Boolean(value); updateLiveDjChanges(Boolean(value)); savePreference('aurora-live-dj', Boolean(value)); cancelMix(); }, [cancelMix]);
  const setBlendLength = useCallback(value => {
    const seconds = readBlend(value);
    preferences.current.blendLength = seconds; updateBlendLength(seconds);
    try { localStorage.setItem('aurora-blend', String(seconds)); } catch { /* Preference lasts this session. */ }
    cancelMix(); attemptedMix.current = '';
  }, [cancelMix]);
  const setSurround = useCallback(value => {
    preferences.current.surround = Boolean(value); updateSurround(Boolean(value)); savePreference('aurora-surround', Boolean(value));
    if (context.current) {
      const destination = context.current.destination;
      destination.channelCount = value ? Math.max(2, destination.maxChannelCount) : 2;
    }
  }, []);
  const audioOutput = useCallback(() => context.current ? { sampleRate: context.current.sampleRate, channels: context.current.destination.channelCount, maxChannels: context.current.destination.maxChannelCount } : null, []);
  const setAutoplay = useCallback(value => {
    preferences.current.autoplay = Boolean(value); updateAutoplay(Boolean(value));
    savePreference('aurora-autoplay', Boolean(value));
    if (!value) { recommendationRequest.current?.abort(); setRecommendationsLoading(false); }
    else recommendedFor.current = null;
  }, []);

  const ensurePlayer = useCallback(async (videoId, index = ytActive.current) => {
    const deck = yt.current[index];
    if (deck.player) return deck.player;
    if (!deck.ready) deck.ready = loadYoutubeApi().then(YT => new Promise((resolve, reject) => {
      const host = deckHost(index);
      if (!host) { reject(new Error('The video player is not mounted.')); return; }
      const mount = document.createElement('div');
      host.replaceChildren(mount);
      showDeck(ytActive.current);
      let expired = false;
      const timeout = setTimeout(() => { expired = true; instance.destroy(); deck.ready = null; reject(new Error('The video player did not respond. Please retry.')); }, 15000);
      const instance = new YT.Player(mount, {
        videoId, width: '100%', height: '100%',
        playerVars: { playsinline: 1, controls: 1, origin: window.location.origin, rel: 0 },
        events: {
          onReady: event => { clearTimeout(timeout); if (expired || !mounted.current) { event.target.destroy(); reject(new Error('Player closed.')); return; } deck.player = event.target; event.target.setVolume(current.current.volume); resolve(event.target); },
          onStateChange: event => {
            // Only the audible deck drives UI state; the standby deck is observed by the mixer.
            if (event.target !== player.current || source.current !== 'youtube' || !activeVideo.current || event.target.getVideoData?.().video_id !== activeVideo.current) return;
            setPlaying(event.data === 1);
            setLoading(event.data === 3);
            if (event.data === 1) setError('');
            if (event.data === 0 && event.target.getDuration() > 0 && event.target.getCurrentTime() >= event.target.getDuration() - 1) actions.current.ended?.();
          },
          // YouTube refuses some uploads (removed, private, embedding disabled): try the
          // runner-up uploads before giving up on the song.
          onError: event => {
            if (event.target !== player.current) { actions.current.standbyError?.(); return; }
            if (source.current === 'youtube') actions.current.activeError?.();
          },
        },
      });
    })).catch(err => { deck.ready = null; throw err; });
    return deck.ready;
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

  // Lyrics are optional and never block playback; stale generations are ignored.
  const fetchLyrics = useCallback((selected, videoId, signal) => fetch(buildApiUrl('/api/lyrics/structured', { artist: selected.artist, title: selected.title, album: selected.album, duration: selected.duration, videoId }), { signal })
    .then(response => response.ok ? response.json() : null)
    .catch(() => null), []);
  const showLyricsFor = useCallback((selected, token, controller, videoId) => {
    const cached = prepared.current.get(selected.id);
    const lyricsRequest = selected.localUrl ? Promise.resolve(null) : cached?.lyrics ? Promise.resolve(cached.lyrics) : fetchLyrics(selected, videoId || selected.videoId, controller.signal);
    if (!selected.localUrl) {
      lyricsRequest
        .then(result => { if (mounted.current && token === generation.current) setLyrics(result); })
        .finally(() => { if (mounted.current && token === generation.current) setLyricsLoading(false); });
    }
    return lyricsRequest;
  }, [fetchLyrics]);

  const loadTrack = useCallback(async (selected, list, fadeIn = false, auto = false) => {
    if (!selected) return;
    // A song chosen by hand (or retried) gets a fresh chance to resolve.
    if (!auto && unplayable.current.delete(selected.id)) setUnavailable(new Set(unplayable.current));
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
    setDirection(travel.current); travel.current = 1; setChangeKind('skip');
    setTrack(selected); clock.set(0); setDuration(selected.duration || 0); setPlaying(false); setLoading(true); setError(''); setLyrics(null); setLyricsOffset(0);
    setLyricsLoading(!selected.localUrl);
    const cached = prepared.current.get(selected.id);
    const lyricsRequest = showLyricsFor(selected, token, controller);
    try {
      if (selected.localUrl) {
        setSourceInfo({ kind: 'local', format: selected.format || null });
        if (!audio.current) throw new Error('Audio is not ready. Please retry.');
        audio.current.src = selected.localUrl;
        const graph = ensureAudioGraph();
        audio.current.volume = graph ? 1 : current.current.volume / 100;
        await audio.current.play();
      } else {
        const { videoId, source } = await resolveSource(selected, controller.signal);
        if (mounted.current && token === generation.current) setSourceInfo(source || { kind: 'youtube', official: false });
        if (!mounted.current || token !== generation.current) return;
        if (!videoId) {
          markUnplayable(selected);
          // Moving through the queue never stops on a song without a playable upload.
          if (auto && autoSkips.current < 5) {
            autoSkips.current++;
            setNotice(`“${selected.title}” isn’t available to play, so Aurora moved on.`);
            const following = upcoming(current.current, selected.id, true);
            if (following && following.id !== selected.id) { setLoading(false); void actions.current.load?.(following, current.current.queue, fadeIn, true); return; }
          }
          throw new Error(`“${selected.title}” isn’t available to play here. Try another song.`);
        }
        autoSkips.current = 0;
        if (!selected.videoId && !cached?.lyrics) {
          // SimpMusic needs the resolved YouTube ID; preserve a stronger initial result.
          void lyricsRequest.then(async initial => {
            if (!mounted.current || token !== generation.current || initial?.sync === 'word') return;
            setLyricsLoading(true);
            const fallback = await fetchLyrics(selected, videoId, controller.signal);
            if (!mounted.current || token !== generation.current) return;
            const rank = { plain: 1, line: 2, word: 3 };
            if (fallback && (rank[fallback.sync] || 0) > (rank[initial?.sync] || 0)) setLyrics(fallback);
            setLyricsLoading(false);
          });
        }
        const instance = await ensurePlayer(videoId);
        if (!mounted.current || token !== generation.current) return;
        player.current = instance;
        activeVideo.current = videoId;
        instance.unMute?.();
        instance.setPlaybackRate?.(1);
        if (fadeIn && preferences.current.djEnabled) {
          mix.current = { kind: 'online-in', started: null };
          instance.setVolume(0);
          announce({ phase: 'mixing', label: 'Gentle fade in', mode: 'online', progress: 0 });
        } else instance.setVolume(current.current.volume);
        instance.loadVideoById(videoId);
      }
    } catch (err) {
      if (mounted.current && token === generation.current && err.name !== 'AbortError') { setError(err instanceof TypeError ? 'Could not reach the music service. Check your connection and retry.' : err.message || 'Playback failed.'); setPlaying(false); }
    } finally { if (mounted.current && token === generation.current) setLoading(false); }
  }, [ensurePlayer, cancelMix, ensureAudioGraph, flushListening, showLyricsFor, fetchLyrics, announce, clock, resolveSource, markUnplayable, upcoming]);
  useEffect(() => { actions.current.load = loadTrack; }, [loadTrack]);
  const activeError = useCallback(() => {
    const selected = current.current.track;
    if (selected?.videoId && !searched.current.has(selected.id) && !alternates.current.get(selected.id)?.length) {
      void searchAlternates(selected, activeVideo.current).then(() => { if (current.current.track?.id === selected.id) actions.current.activeError?.(); });
      return;
    }
    const spare = selected && alternates.current.get(selected.id);
    if (spare?.length && player.current) {
      const videoId = spare.shift();
      prepared.current.set(selected.id, { ...(prepared.current.get(selected.id) || {}), videoId });
      activeVideo.current = videoId;
      player.current.loadVideoById(videoId);
      return;
    }
    markUnplayable(selected);
    setLoading(false); setPlaying(false);
    const following = upcoming(current.current, selected?.id, true);
    if (following && autoSkips.current < 5) {
      autoSkips.current++;
      setNotice(`“${selected?.title}” can’t play here, so Aurora moved on.`);
      void loadTrack(following, current.current.queue, false, true);
      return;
    }
    setError('This song can’t play here. Try another track or open an audio file.');
  }, [markUnplayable, upcoming, loadTrack, searchAlternates]);
  const standbyError = useCallback(() => {
    const blend = mix.current;
    if (blend?.kind !== 'online-blend' || blend.stage === 'mixing' || blend.stage === 'recover') return;
    if (blend.selected.videoId && !searched.current.has(blend.selected.id) && !alternates.current.get(blend.selected.id)?.length) {
      void searchAlternates(blend.selected, blend.videoId).then(() => { if (mix.current === blend) actions.current.standbyError?.(); });
      return;
    }
    const spare = alternates.current.get(blend.selected.id);
    const standby = yt.current[blend.index].player;
    if (spare?.length && standby && blend.stage !== 'starting') {
      // Prepare the same song from another upload; the blend keeps its cue.
      const videoId = spare.shift();
      prepared.current.set(blend.selected.id, { ...(prepared.current.get(blend.selected.id) || {}), videoId });
      Object.assign(blend, { videoId, stage: 'priming' });
      standby.mute(); standby.setVolume(0); standby.loadVideoById(videoId, blend.entry || 0);
      return;
    }
    // No upload of this song plays: drop it, and the next tick prepares the song after it.
    markUnplayable(blend.selected);
    cancelMix();
    attemptedMix.current = '';
  }, [markUnplayable, cancelMix, searchAlternates]);
  useEffect(() => { actions.current.activeError = activeError; actions.current.standbyError = standbyError; }, [activeError, standbyError]);

  // Metadata, lyrics and queue position follow the incoming audible track from its first beat.
  const commitIncoming = useCallback((selected, { duration: length = selected.duration || 0, position = 0, videoId } = {}) => {
    flushListening();
    const token = ++generation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    current.current.track = selected;
    clock.set(position);
    const ready = prepared.current.get(selected.id);
    // The hand-over re-renders title, lyrics and queue while both songs play: as a
    // transition it yields to the browser instead of blocking a frame of the blend.
    startTransition(() => {
      setDjWindow(null); setDirection(1); setChangeKind('blend');
      setTrack(selected); setDuration(length);
      setQueueIndex(current.current.queue.findIndex(item => item.id === selected.id));
      // Pre-loaded lyrics appear at once; no "finding the words" flash mid-blend.
      setLyrics(ready?.lyrics || null); setLyricsOffset(0); setLyricsLoading(!selected.localUrl && !ready?.lyrics); setPlaying(true); setError('');
      setSourceInfo(selected.localUrl ? { kind: 'local', format: selected.format || null } : ready?.source || { kind: 'youtube', official: false });
    });
    if (!selected.localUrl && !ready?.lyrics) showLyricsFor(selected, token, controller, videoId);
  }, [flushListening, showLyricsFor, clock]);

  const seek = useCallback(value => {
    cancelMix();
    // A user seek re-arms the transition for this pair of songs.
    attemptedMix.current = '';
    const seconds = Math.max(0, Number(value) || 0);
    if (source.current === 'local' && audio.current) audio.current.currentTime = seconds;
    else player.current?.seekTo?.(seconds, true);
    clock.set(seconds);
  }, [cancelMix, clock]);
  const togglePlay = useCallback(async () => {
    cancelMix();
    attemptedMix.current = '';
    setError('');
    try {
      if (source.current === 'local') { if (audio.current?.paused) await audio.current.play(); else audio.current?.pause(); }
      else if (player.current && activeVideo.current) { if (player.current.getPlayerState() === 1) player.current.pauseVideo(); else player.current.playVideo(); }
      else if (current.current.track) await loadTrack(current.current.track);
    } catch (err) { setError(err.message || 'Playback was blocked. Press play to retry.'); }
  }, [loadTrack, cancelMix]);

  const beginOnlineBlend = useCallback((blend, seconds) => {
    const incoming = yt.current[blend.index].player;
    if (!incoming) return false;
    incoming.setVolume(0); incoming.unMute?.();
    // Song B starts at the shared tempo when the tempos meet in the middle.
    blend.inRate = blend.verified && blend.plan?.inRate ? blend.plan.inRate : 1;
    incoming.setPlaybackRate?.(blend.inRate);
    incoming.playVideo();
    if (preferences.current.djEnabled && preferences.current.transitionFx) audioContext();
    Object.assign(blend, { stage: 'starting', requested: performance.now(), seconds: seconds || blend.seconds });
    if (preferences.current.djEnabled) announce(previous => ({ ...previous, phase: 'mixing', label: 'Starting the next song', mode: 'online', progress: 0, fromBpm: blend.verified ? previous.fromBpm : undefined, toBpm: blend.verified ? previous.toBpm : undefined }));
    return true;
  }, [announce, audioContext]);

  const next = useCallback((ended = false) => {
    const state = current.current;
    if (ended === true) flushListening();
    if (!state.queue.length) return;
    if (ended === true && state.repeat === 'one') { seek(0); if (source.current === 'local') audio.current?.play().catch(err => setError(err.message)); else player.current?.playVideo(); return; }
    // Automatic advances stop at the end (radio tops up); a manual Next wraps around.
    const selected = upcoming(state, pendingNext.current ?? state.track?.id, state.repeat === 'all' || ended !== true);
    if (!selected) {
      if (mix.current) cancelMix();
      setPlaying(false);
      if (ended === true && preferences.current.autoplay && !state.track?.localUrl) { waitingForRadio.current = true; recommendedFor.current = null; setRadioRetry(value => value + 1); }
      return;
    }
    const isPlaying = source.current === 'local' ? !audio.current?.paused : player.current?.getPlayerState?.() === 1;
    if (ended !== true && preferences.current.djEnabled && preferences.current.liveDjChanges && isPlaying && selected.id !== state.track?.id) {
      const blend = mix.current;
      // A primed standby deck lets a manual skip overlap instead of fading through silence.
      if (blend?.kind === 'online-blend' && blend.stage === 'primed' && blend.selected.id === selected.id) { attemptedMix.current = blend.key; beginOnlineBlend(blend, 3); return; }
      cancelMix();
      if (source.current === 'local' && selected.localUrl && context.current?.state === 'running') {
        void actions.current.manualMix?.(selected, Math.max(.1, audio.current.duration - audio.current.currentTime), 3);
        return;
      }
      if (source.current === 'youtube') {
        pendingNext.current = selected.id;
        const started = performance.now();
        manualChange.current = setInterval(() => {
          const progress = Math.min(1, (performance.now() - started) / 700);
          player.current?.setVolume?.(state.volume * Math.cos(progress * Math.PI / 2));
          if (progress >= 1) { clearInterval(manualChange.current); manualChange.current = null; void loadTrack(selected, state.queue, true, true); }
        }, 25);
        return;
      }
    }
    loadTrack(selected, state.queue, ended === true && preferences.current.djEnabled, true);
  }, [loadTrack, seek, cancelMix, flushListening, beginOnlineBlend, upcoming]);
  const previous = useCallback(() => {
    const seconds = source.current === 'local' ? audio.current?.currentTime : player.current?.getCurrentTime?.();
    if (seconds > 3) { seek(0); return; }
    const state = current.current;
    if (!state.queue.length) return;
    const index = state.queue.findIndex(item => item.id === state.track?.id);
    travel.current = -1;
    loadTrack(state.queue[(index - 1 + state.queue.length) % state.queue.length], state.queue);
  }, [loadTrack, seek]);
  const setVolume = useCallback(value => {
    const amount = Math.min(100, Math.max(0, Number(value) || 0));
    current.current.volume = amount; updateVolume(amount);
    // Online mixes read the live volume on every tick; local curves are pre-scheduled.
    if (mix.current?.kind === 'local') cancelMix();
    const deck = decks.current.find(item => item.element === audio.current);
    if (deck?.gain) deck.gain.gain.setValueAtTime(amount / 100, context.current.currentTime);
    else if (audio.current) audio.current.volume = amount / 100;
    if (!mix.current?.kind?.startsWith('online')) player.current?.setVolume?.(amount);
  }, [cancelMix]);
  const setQueue = useCallback(value => {
    const before = current.current.queue;
    const result = typeof value === 'function' ? value(before) : value;
    const upcoming = list => list[list.findIndex(item => item.id === current.current.track?.id) + 1]?.id;
    // Appending radio songs must not disturb a transition that is already prepared.
    if (upcoming(before) !== upcoming(result)) {
      const committed = mix.current?.kind === 'local' || mix.current?.stage === 'mixing';
      if ((mix.current && !committed) || manualChange.current) cancelMix();
      attemptedMix.current = '';
    }
    current.current.queue = result; updateQueue(result); setQueueIndex(result.findIndex(item => item.id === current.current.track?.id));
  }, [cancelMix]);
  const addToQueue = useCallback(item => { setQueue(items => items.some(entry => entry.id === item.id) ? items : [...items, item]); }, [setQueue]);
  const playNext = useCallback(item => {
    setQueue(items => {
      const rest = items.filter(entry => entry.id !== item.id);
      const index = rest.findIndex(entry => entry.id === current.current.track?.id);
      return [...rest.slice(0, index + 1), item, ...rest.slice(index + 1)];
    });
  }, [setQueue]);
  const loadLocalFiles = useCallback(async files => {
    const valid = Array.from(files || []).filter(file => file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|aif|aiff|webm|caf)$/i.test(file.name));
    if (!valid.length) { setError('Choose an audio file.'); return; }
    // Header probes are tiny reads; they let the player state the real format.
    const formats = await Promise.all(valid.map(file => probeFile(file).catch(() => null)));
    if (!mounted.current) return;
    const tracks = valid.map((file, index) => {
      const url = URL.createObjectURL(file); localUrls.current.add(url);
      return { id: `local-${crypto.randomUUID()}`, title: file.name.replace(/\.[^.]+$/, ''), artist: 'On this device', album: 'Local audio', artwork: '', duration: 0, localUrl: url, format: formats[index] };
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
    // The queue never runs dry, but grows progressively: a small batch whenever
    // two or fewer songs remain, shaped by what the listener finishes and skips.
    if (!autoplay || !track || track.localUrl || queue.length - queueIndex - 1 > 2 || recommendedFor.current === track.id) return;
    // Wait briefly for lyrics: their language keeps the radio in the same language.
    if (lyricsLoading && !waitingForRadio.current) return;
    const controller = new AbortController(); recommendationRequest.current = controller;
    recommendedFor.current = track.id;
    Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setRecommendationsLoading(true); setRecommendationError('');
      try {
        const seed = pickSeed(track);
        const lang = seed.track === track ? detectLanguage(lyricsText(current.current.lyrics))?.lang : undefined;
        let suggestions = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          try { suggestions = tasteFilter(await getSimilarTracks(seed.track, controller.signal, { lang })).map(item => seed.reason ? { ...item, recommendationReason: seed.reason } : item); if (suggestions.length) break; }
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
        }).slice(0, 5);
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
  }, [autoplay, track, queue.length, queueIndex, radioRetry, setQueue, loadTrack, lyricsLoading]);

  // Warm the next local decoder, or resolve the online source, lyrics and catalogue tempo early.
  // A source cache reduces network work; the iframe still controls its own buffering.
  useEffect(() => {
    if (!track || repeat === 'one') return;
    const selected = upcoming({ track, queue, shuffle, repeat });
    if (!selected || selected.id === track.id) return;
    const controller = new AbortController();
    const learnTempo = async item => {
      if (item.localUrl || tempos.current.has(item.id)) return;
      try {
        const bpm = await getTrackTempo(item, controller.signal);
        tempos.current.set(item.id, bpm);
        while (tempos.current.size > 12) tempos.current.delete(tempos.current.keys().next().value);
      } catch { /* Unknown tempo keeps a volume blend. */ }
    };
    if (djEnabled) { void learnTempo(track); void learnTempo(selected); }
    // Warm everything the hand-over needs: artwork, and the standby deck itself.
    if (selected.artwork) new Image().src = artworkAt(selected.artwork, 1200);
    if (!selected.localUrl && !track.localUrl) void ensurePlayer(undefined, 1 - ytActive.current).catch(() => {});
    if (selected.localUrl) {
      const inactive = decks.current.find(deck => deck.element !== audio.current);
      if (inactive && !mix.current && inactive.element.src !== selected.localUrl) {
        inactive.element.preload = 'auto'; inactive.element.src = selected.localUrl; inactive.element.load();
      }
    } else if (!prepared.current.get(selected.id)?.lyrics) {
      void (async () => {
        try {
          const entry = await resolveSource(selected, controller.signal);
          if (!entry?.videoId || controller.signal.aborted) return;
          const response = await fetch(buildApiUrl('/api/lyrics/structured', { artist: selected.artist, title: selected.title, album: selected.album, duration: selected.duration, videoId: entry.videoId }), { signal: controller.signal });
          if (response.ok && !controller.signal.aborted) prepared.current.set(selected.id, { ...(prepared.current.get(selected.id) || entry), lyrics: await response.json() });
        } catch { /* Normal playback resolves again if speculative preparation fails. */ }
      })();
    }
    return () => controller.abort();
  }, [track, queue, queueIndex, shuffle, repeat, djEnabled, ensurePlayer, upcoming, resolveSource, unavailable]);

  const startLocalMix = useCallback(async (selected, remaining, overrideSeconds) => {
    const graph = ensureAudioGraph();
    if (!graph || graph.state !== 'running') return;
    const outgoing = decks.current.find(deck => deck.element === audio.current);
    const incoming = decks.current.find(deck => deck !== outgoing);
    if (!outgoing || !incoming) return;
    const token = { kind: 'local', incoming, outgoing, starting: true };
    attemptedMix.current = `${current.current.track?.id}:${selected.id}`;
    mix.current = token;
    const from = analysis.current.get(current.current.track?.id);
    const to = analysis.current.get(selected.id);
    const plan = planTransition(from?.outro, to?.intro, blendTarget({ outroSpan: from ? from.duration - from.mixStart : Infinity }));
    try {
      if (incoming.element.src !== selected.localUrl) incoming.element.src = selected.localUrl;
      incoming.element.playbackRate = plan.inRate; incoming.element.preservesPitch = true;
      incoming.gain.gain.setValueAtTime(0, graph.currentTime);
      // Land the incoming first beat on the outgoing grid; a later nudge absorbs play() latency.
      // Song B enters at the section that best continues song A's exit energy, on its beat grid.
      const entry = chooseEntry({ levels: to?.levels, introStart: to?.introStart || 0, grid: to?.intro?.grid, targetLevel: from?.exitLevel });
      incoming.element.currentTime = beatAlignedEntry({ introStart: entry, inGrid: to?.intro?.grid, outPosition: outgoing.element.currentTime, outGrid: from?.outro?.grid, rate: outgoing.element.playbackRate, inRate: plan.inRate });
      await incoming.element.play();
      if (mix.current !== token) { incoming.element.pause(); return; }
      const seconds = Math.min(overrideSeconds || plan.seconds, Math.max(.5, remaining / Math.max(1, plan.rate)));
      const now = graph.currentTime;
      const volume = current.current.volume / 100;
      const outCurve = new Float32Array(65), inCurve = new Float32Array(65);
      for (let i = 0; i < outCurve.length; i++) {
        // Song B rises under a held song A, then song A gives way: no loudness hole.
        const [out, input] = blendCurve(i / 64);
        outCurve[i] = out * volume; inCurve[i] = input * volume;
      }
      outgoing.gain.gain.cancelScheduledValues(now); incoming.gain.gain.cancelScheduledValues(now);
      outgoing.gain.gain.setValueCurveAtTime(outCurve, now, seconds);
      incoming.gain.gain.setValueCurveAtTime(inCurve, now, seconds);
      // Both decks move onto the filter route (filters start neutral, so this is silent).
      for (const deck of [outgoing, incoming]) {
        deck.dry.gain.cancelScheduledValues(now); deck.dry.gain.setTargetAtTime(0, now, .015);
        deck.wet.gain.cancelScheduledValues(now); deck.wet.gain.setTargetAtTime(1, now, .015);
      }
      // Hollow and deep: the outgoing band narrows toward a resonant mid band and
      // echoes out. Bass swap: song B enters without its low end, and on the beat
      // at the middle of the blend the low end moves from song A to song B, so the
      // two kick drums and bass lines never stack.
      const mid = now + seconds / 2, swap = Math.max(.12, Math.min(.6, plan.beatSeconds || .25));
      outgoing.delay.delayTime.setValueAtTime(Math.min(1.5, (plan.beatSeconds || .5) * .75), now);
      // Song A keeps its full range (and the only bass) until the swap, so the mix
      // never thins out; after it, song A narrows into the hollow band and echoes out.
      outgoing.highpass.frequency.setValueAtTime(20, now);
      outgoing.highpass.frequency.setValueAtTime(20, mid);
      outgoing.highpass.frequency.exponentialRampToValueAtTime(380, mid + swap);
      outgoing.highpass.frequency.exponentialRampToValueAtTime(850, now + seconds);
      outgoing.lowpass.frequency.setValueAtTime(20000, now);
      outgoing.lowpass.frequency.setValueAtTime(20000, mid);
      outgoing.lowpass.frequency.exponentialRampToValueAtTime(1200, now + seconds);
      outgoing.lowpass.Q.setValueAtTime(.8, mid);
      outgoing.lowpass.Q.linearRampToValueAtTime(4, now + seconds);
      outgoing.echoSend.gain.setValueAtTime(0, now);
      outgoing.echoSend.gain.linearRampToValueAtTime(.5 * volume, now + seconds * .65);
      outgoing.echoSend.gain.linearRampToValueAtTime(0, now + seconds * 1.1);
      incoming.highpass.frequency.setValueAtTime(320, now);
      incoming.highpass.frequency.setValueAtTime(320, mid);
      incoming.highpass.frequency.exponentialRampToValueAtTime(20, mid + swap);
      incoming.lowpass.frequency.setValueAtTime(9000, now);
      incoming.lowpass.frequency.exponentialRampToValueAtTime(20000, now + seconds);
      Object.assign(token, { starting: false, started: now, seconds, plan, from, to, startRate: outgoing.element.playbackRate });
      audio.current = incoming.element;
      commitIncoming(selected, { duration: Number.isFinite(incoming.element.duration) ? incoming.element.duration : 0, position: incoming.element.currentTime });
      announce({ phase: 'mixing', label: plan.matched ? 'Tempo matched · hollow blend' : 'Hollow blend', mode: 'local', progress: 0, entryAt: incoming.element.currentTime, fromBpm: plan.matched ? from.outro.bpm : undefined, toBpm: plan.targetBpm ?? undefined, effects: ['hollow', 'echo', 'bass swap', ...(plan.matched ? ['tempo'] : [])] });
    } catch {
      if (mix.current === token) { cancelMix(); if (overrideSeconds) void loadTrack(selected, current.current.queue); }
      // The original track continues; normal advance retries the next file.
    }
  }, [ensureAudioGraph, cancelMix, loadTrack, commitIncoming, announce, blendTarget]);

  const tickLocalMix = useCallback(activeMix => {
    if (activeMix.starting) return;
    const elapsed = context.current.currentTime - activeMix.started;
    const progress = Math.min(1, elapsed / activeMix.seconds);
    const { outgoing, incoming, plan, from, to } = activeMix;
    mixProgress.set(progress);
    if (progress >= 1) {
      // Song A has faded out; song B eases from the shared tempo back to its own.
      activeMix.finished ??= context.current.currentTime;
      if (!outgoing.element.paused) outgoing.element.pause();
      const after = context.current.currentTime - activeMix.finished;
      if (plan.recoverSeconds > 0 && after < plan.recoverSeconds) {
        incoming.element.playbackRate = recoverRate(after, plan.recoverSeconds, plan.inRate);
        return;
      }
      cancelMix();
      setIdle(plan.matched ? 'Tempo blend complete' : 'Blend complete');
      return;
    }
    // Finish any glide the pre-roll could not complete (for example after a late seek).
    outgoing.element.playbackRate = activeMix.startRate + (plan.rate - activeMix.startRate) * smoothstep(progress * 2);
    incoming.element.playbackRate = plan.inRate * (elapsed < 2.5 && plan.matched
      ? phaseNudge({ inPosition: incoming.element.currentTime, inGrid: to?.intro?.grid, outPosition: outgoing.element.currentTime, outGrid: from?.outro?.grid, outRate: outgoing.element.playbackRate, inRate: plan.inRate })
      : 1);
  }, [cancelMix, setIdle, mixProgress]);

  const tickOnlineBlend = useCallback(blend => {
    const incoming = yt.current[blend.index].player;
    const volume = current.current.volume;
    if (blend.stage === 'failed') { cancelMix(); attemptedMix.current = blend.key; return; }
    // The standby deck may still be constructing; the cue-time guard handles a deck that never arrives.
    if (!incoming) return;
    if (blend.stage === 'priming') {
      const loaded = incoming.getVideoData?.().video_id === blend.videoId;
      if (loaded && incoming.getPlayerState?.() === 1 && incoming.getCurrentTime?.() > (blend.entry || 0) + .15) {
        incoming.pauseVideo(); incoming.seekTo(blend.entry || 0, true);
        if (blend.probe) {
          // First read-back: does the embed take a 0.05 step at all?
          if (Math.abs((incoming.getPlaybackRate?.() ?? 1) - 1.05) < .005) {
            rateSupport.current = 'step';
            // Second: does it also take an off-grid rate? Read back while primed.
            incoming.setPlaybackRate?.(1.04); blend.probe = { asked: performance.now() };
          } else { rateSupport.current = 'coarse'; blend.probe = null; incoming.setPlaybackRate?.(1); }
        }
        blend.stage = 'primed';
      }
      return;
    }
    if (blend.stage === 'primed' && blend.probe?.asked && performance.now() - blend.probe.asked > 400) {
      if (Math.abs((incoming.getPlaybackRate?.() ?? 1) - 1.04) < .005) rateSupport.current = 'fine';
      blend.probe = null; incoming.setPlaybackRate?.(1);
    }
    if (blend.stage === 'starting') {
      if (incoming.getPlayerState?.() === 1 && incoming.getVideoData?.().video_id === blend.videoId) {
        blend.stage = 'mixing'; blend.started = performance.now(); blend.outgoing = player.current;
        // YouTube audio cannot be filtered, so the hollow is a synthesized sweep laid over the blend.
        const graph = preferences.current.djEnabled && preferences.current.transitionFx ? context.current : null;
        if (graph?.state === 'running') blend.stopSweep = playSweep(graph, { seconds: blend.seconds, volume: volume / 100, beatSeconds: blend.plan?.beatSeconds });
        ytActive.current = blend.index; player.current = incoming; activeVideo.current = blend.videoId;
        showDeck(blend.index);
        commitIncoming(blend.selected, { videoId: blend.videoId, position: incoming.getCurrentTime?.() || 0 });
        if (preferences.current.djEnabled) announce(previous => ({ ...previous, label: `${blend.verified ? 'Tempo matched' : 'Blending'}${blend.stopSweep ? ' · hollow sweep' : ''}`, progress: 0, effects: [...(blend.stopSweep ? ['hollow sweep'] : []), ...(blend.verified ? ['tempo'] : [])] }));
      } else if (performance.now() - blend.requested > START_TIMEOUT) {
        // The standby deck could not start in time: keep the current song and fade normally.
        cancelMix(); attemptedMix.current = blend.key;
      }
      return;
    }
    if (blend.stage === 'mixing') {
      const progress = Math.min(1, (performance.now() - blend.started) / (blend.seconds * 1000));
      const [out, input] = preferences.current.djEnabled ? blendCurve(progress) : equalPower(progress);
      // YouTube volume is whole percent: send only real changes, at display rate.
      const outLevel = Math.round(volume * out), inLevel = Math.round(volume * input);
      if (outLevel !== blend.outLevel) { blend.outLevel = outLevel; blend.outgoing?.setVolume?.(outLevel); }
      if (inLevel !== blend.inLevel) { blend.inLevel = inLevel; incoming.setVolume(inLevel); }
      mixProgress.set(progress);
      if (progress >= 1) {
        const outgoing = blend.outgoing;
        outgoing?.pauseVideo?.(); outgoing?.mute?.(); outgoing?.setPlaybackRate?.(1);
        incoming.setVolume(volume);
        if (blend.inRate !== 1) { blend.stage = 'recover'; blend.finished = performance.now(); if (preferences.current.djEnabled) announce(previous => ({ ...previous, label: 'Settling into its own tempo', progress: 1 })); return; }
        mix.current = null;
        setIdle(blend.verified ? 'Tempo blend complete' : 'Blend complete');
        return;
      }
      if (!blend.frame) blend.frame = requestAnimationFrame(() => { blend.frame = 0; if (mix.current === blend) actions.current.tickMix?.(); });
      return;
    }
    if (blend.stage === 'recover') {
      const after = (performance.now() - blend.finished) / 1000;
      const seconds = blend.plan.recoverSeconds;
      if (after >= seconds) {
        incoming.setPlaybackRate?.(1);
        mix.current = null;
        setIdle('Tempo blend complete');
        return;
      }
      const rate = snapRate(recoverRate(after, seconds, blend.inRate), blend.quantum || .005);
      if (rate !== blend.rate) { blend.rate = rate; incoming.setPlaybackRate?.(rate); }
    }
  }, [cancelMix, commitIncoming, setIdle, announce, mixProgress]);

  const tickMix = useCallback(() => {
    const dj = preferences.current.djEnabled;
    // Without DJ, online songs still hand over seamlessly through the standby deck.
    if (!dj) setDjWindow(previous => previous === null ? previous : null);
    if (!dj && source.current === 'local') return;
    const state = current.current;
    if (mix.current?.kind === 'local') { tickLocalMix(mix.current); return; }
    if (mix.current?.kind === 'online-blend') {
      const running = mix.current.stage === 'starting' || mix.current.stage === 'mixing' || mix.current.stage === 'recover';
      // Priming promotion and failure recovery run here; the cue logic below still applies.
      tickOnlineBlend(mix.current);
      if (running) return;
    }
    const activeMix = mix.current;
    if (activeMix?.kind === 'online-in') {
      if (player.current?.getPlayerState?.() !== 1) return;
      activeMix.started ??= performance.now();
      const progress = Math.min(1, (performance.now() - activeMix.started) / 2500);
      player.current.setVolume(state.volume * Math.sin(progress * Math.PI / 2));
      mixProgress.set(progress);
      if (progress >= 1) cancelMix();
      return;
    }
    if (state.repeat === 'one') {
      setDjWindow(previous => previous === null ? previous : null);
      if (activeMix) cancelMix();
      return;
    }
    // The next playable song (shuffle picks it ahead), prepared and blended the same way.
    const selected = upcoming(state);
    if (!selected || selected.id === state.track?.id) {
      setDjWindow(previous => previous === null ? previous : null);
      if (activeMix) cancelMix();
      return;
    }
    const key = `${state.track?.id}:${selected.id}`;
    if (source.current === 'local' && dj) {
      const element = audio.current;
      if (!element || element.paused || !selected.localUrl || !Number.isFinite(element.duration)) return;
      const remaining = element.duration - element.currentTime;
      const from = analysis.current.get(state.track?.id);
      const plan = planTransition(from?.outro, analysis.current.get(selected.id)?.intro, blendTarget({ outroSpan: from ? from.duration - from.mixStart : Infinity }));
      const start = Math.min(element.duration - plan.seconds, from?.mixStart ?? element.duration - plan.seconds);
      const rampStart = start - plan.rampSeconds;
      const standby = decks.current.find(deck => deck.element !== element);
      if (standby && standby.element.src !== selected.localUrl) { standby.element.preload = 'auto'; standby.element.src = selected.localUrl; standby.element.load(); }
      const ready = Boolean(standby?.element.readyState >= 3);
      const window = { start: Math.max(0, plan.rampSeconds ? rampStart : start), end: Math.min(element.duration, start + plan.seconds), seconds: plan.seconds, mode: 'local', ready, glide: plan.rampSeconds > 0 };
      setDjWindow(previous => JSON.stringify(previous) === JSON.stringify(window) ? previous : window);
      if (attemptedMix.current === key || element.duration <= 12) return;
      // Song A glides into song B's tempo before the overlap, so the blend starts beat-matched.
      if (plan.matched && element.currentTime >= rampStart && element.currentTime < start) {
        element.playbackRate = glideRate(element.currentTime, rampStart, plan.rampSeconds, plan.rate);
        announce({ phase: 'gliding', label: 'Matching the next tempo', mode: 'local', progress: (element.currentTime - rampStart) / plan.rampSeconds, fromBpm: from.outro.bpm, toBpm: plan.targetBpm });
      } else if (element.playbackRate !== 1) element.playbackRate = 1;
      if (remaining > 0 && element.currentTime >= start) void startLocalMix(selected, remaining);
      return;
    }
    const active = player.current;
    if (active?.getPlayerState?.() !== 1) return;
    const length = active.getDuration();
    const position = active.getCurrentTime();
    const videoId = prepared.current.get(selected.id)?.videoId || selected.videoId;
    // A source that failed to resolve earlier (for example offline) is retried in time.
    if (!videoId && !selected.localUrl && !resolving.current.has(selected.id)) void resolveSource(selected).catch(() => {});
    const tempoA = dj ? tempos.current.get(state.track?.id) : null, tempoB = dj ? tempos.current.get(selected.id) : null;
    // Auto: fit the blend between song A's last sung word and song B's first.
    const timed = lyricsData => (lyricsData?.sync && lyricsData.sync !== 'plain' ? lyricsData.lines : []);
    const spans = vocalSpans({ duration: length, outLines: timed(state.lyrics), inLines: timed(prepared.current.get(selected.id)?.lyrics), entry: 0 });
    const target = blendTarget({ outroSpan: spans.outroSpan - 2.5, introSpan: spans.introSpan });
    const tempoPlan = options => planTransition(tempoA ? { bpm: tempoA, confidence: 1 } : null, tempoB ? { bpm: tempoB, confidence: 1 } : null, target, options);
    let plan = tempoPlan();
    const rates = active.getAvailablePlaybackRates?.();
    // Only glide when this embed actually plays the rates we need: it lists them,
    // or a requested rate read back correctly while priming. Embeds that only take
    // 0.05 steps get the best pair of rates on that grid.
    const listed = plan.matched && Math.abs(quantizeRate(rates, plan.rate) - plan.rate) <= .01;
    const stepped = !listed && rateSupport.current === 'step';
    if (stepped) plan = tempoPlan({ step: RATE_STEP });
    else if (plan.matched && !listed && rateSupport.current !== 'fine') plan = { ...plan, rate: 1, inRate: 1, matched: false, rampSeconds: 0, recoverSeconds: 0, targetBpm: null };
    const quantum = stepped ? RATE_STEP : .005;
    const blend = activeMix?.kind === 'online-blend' ? activeMix : null;
    // A prepared blend keeps the cue it was primed for.
    const seamless = { start: Math.max(0, length - .45), end: length, seconds: .35, source: 'seamless' };
    let cue = blend?.cue ?? (dj ? planOnlineCue(length, state.lyrics?.sync !== 'plain' ? state.lyrics?.lines : [], plan.seconds) : seamless);
    // Seeking past the post-vocal cue still leaves the natural ending to blend on.
    if (!blend && cue.source === 'lyrics' && position >= cue.start - 1) cue = planOnlineCue(length, [], plan.seconds);
    const rampStart = cue.start - plan.rampSeconds;
    const window = { start: plan.rampSeconds ? rampStart : cue.start, end: cue.end, seconds: cue.seconds, mode: 'online', ready: blend?.stage === 'primed', glide: plan.rampSeconds > 0 };
    if (dj) setDjWindow(previous => JSON.stringify(previous) === JSON.stringify(window) ? previous : window);
    if (length <= 20) return;
    const fallbackEnd = length - .5;
    if (attemptedMix.current !== key && videoId && !blend && position >= Math.min(cue.start - 2, Math.max(6, cue.start - PRIME_LEAD)) && position < cue.start - 1) {
      // Pre-buffer the next song silently on the standby deck.
      const index = standbyIndex();
      // Song B's entry: past a long instrumental intro when its timed lyrics show one.
      const nextLyrics = prepared.current.get(selected.id)?.lyrics;
      const entry = dj ? planOnlineEntry(nextLyrics?.sync !== 'plain' ? nextLyrics?.lines : [], cue.seconds) : 0;
      // Learn once which rates this embed really plays, by asking the muted standby.
      const probe = dj && tempoA > 0 && tempoB > 0 && rateSupport.current === 'unknown';
      const primed = { kind: 'online-blend', stage: 'priming', key, selected, videoId, index, cue, entry, seconds: cue.seconds, plan, probe, quantum, verified: false };
      mix.current = primed;
      if (dj) announce({ phase: 'priming', label: 'Getting the next song ready', mode: 'online', entryAt: entry });
      if (dj && preferences.current.transitionFx) audioContext();
      void ensurePlayer(videoId, index).then(standby => {
        if (mix.current !== primed) return;
        standby.mute(); standby.setVolume(0); standby.setPlaybackRate?.(1);
        standby.loadVideoById(videoId, primed.entry);
        if (primed.probe) standby.setPlaybackRate?.(1.05);
      }).catch(() => { if (mix.current === primed) primed.stage = 'failed'; });
      return;
    }
    if (blend?.stage === 'priming' && position >= cue.start) { cancelMix(); attemptedMix.current = key; return; }
    if (blend?.stage === 'primed') {
      if (plan.matched && position >= rampStart) {
        const target = glideRate(position, rampStart, plan.rampSeconds, plan.rate);
        const rate = listed ? quantizeRate(rates, target) : snapRate(target, quantum);
        if (active.getPlaybackRate?.() !== rate) active.setPlaybackRate(rate);
        // The mixer owns this imperative state; only the confirmed rate may be claimed in the UI.
        // eslint-disable-next-line react-hooks/immutability
        blend.verified = Math.abs((active.getPlaybackRate?.() ?? 1) - plan.rate) <= .01;
        if (position < cue.start) announce({ phase: 'gliding', label: 'Matching the next tempo', mode: 'online', progress: (position - rampStart) / Math.max(1, plan.rampSeconds), fromBpm: tempoA, toBpm: plan.targetBpm });
      }
      blend.plan = plan; blend.quantum = quantum;
      if (position >= cue.start - START_LEAD) { attemptedMix.current = key; beginOnlineBlend(blend); }
      return;
    }
    if (blend || !dj) return;
    // Fallback without a ready standby: a gentle fade into the natural ending.
    const remaining = fallbackEnd - position;
    if (remaining <= 0 && activeMix?.kind === 'online-out') { actions.current.ended?.(); return; }
    if (remaining > 0 && remaining <= 3) {
      mix.current = { kind: 'online-out' };
      const progress = 1 - remaining / 3;
      active.setVolume(state.volume * Math.cos(progress * Math.PI / 2));
      announce({ phase: 'mixing', label: 'Gentle fade out', mode: 'online', progress });
    }
  }, [cancelMix, startLocalMix, tickLocalMix, tickOnlineBlend, ensurePlayer, beginOnlineBlend, announce, mixProgress, audioContext, upcoming, resolveSource, blendTarget]);

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
      if (source.current === 'local') { if (audio.current && !audio.current.paused) clock.set(audio.current.currentTime); }
      else if (!document.hidden && player.current?.getPlayerState?.() === 1 && player.current?.getCurrentTime) { clock.set(player.current.getCurrentTime() || 0); const length = player.current.getDuration(); if (length > 0) setDuration(length); }
    }, 250);
    const mixTimer = setInterval(() => actions.current.tickMix?.(), 100);
    const urls = localUrls.current;
    const onlineDecks = yt.current;
    return () => {
      flushListening();
      mounted.current = false; if (manualChange.current) clearInterval(manualChange.current); request.current?.abort(); recommendationRequest.current?.abort(); clearInterval(timer); clearInterval(mixTimer);
      cleanups.forEach(cleanup => cleanup()); audio.current = null; decks.current = []; mix.current = null;
      void context.current?.close().catch(() => {}); context.current = null;
      for (const deck of onlineDecks) { deck.player?.destroy?.(); deck.player = null; deck.ready = null; }
      player.current = null;
      urls.forEach(url => URL.revokeObjectURL(url)); urls.clear();
    };
  }, [flushListening, clock]);
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

  return { warm, notice, unavailable, changeKind, direction, transitionFx, setTransitionFx, blendLength, setBlendLength, sourceInfo, surround, setSurround, audioOutput, track, playing, loading, error, clock, mixProgress, duration, volume, queue, queueIndex, shuffle, repeat, lyrics, lyricsLoading, loadTrack, togglePlay, seek, setVolume, next, previous, setShuffle, setRepeat, setQueue, addToQueue, playNext, lyricsOffset, setLyricsOffset, loadLocalFile, loadLocalFiles, djEnabled, setDjEnabled, djState, djWindow, liveDjChanges, setLiveDjChanges, autoplay, setAutoplay, recommendationsLoading, recommendationError, getPlaybackTime };
}
export default usePlayer;
