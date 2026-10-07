import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion as Motion,
  useMotionValue,
  useSpring,
  useTransform,
  useMotionTemplate,
  useIsPresent,
  useReducedMotion,
  usePresence,
  useInView,
} from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Focus,
  Disc3,
  AudioLines,
  Headphones,
  Heart,
  House,
  Library,
  ListMusic,
  Minimize2,
  Minus,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  Sparkles,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Upload,
  UserRound,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { usePlayer } from "./hooks/usePlayer";
import { useStore } from "./hooks/useStore";
import { atRest, beatPhase, BREATH_KEYS, breath, linePhase, lyricBeat, peakWindow, pulsePeriod, pulsePhase } from "./lib/pulse";
import { useNavigation } from "./hooks/useNavigation";
import { getCollection, getFeaturedTracks, getMoodTracks, getSimilarTracks, searchCatalog } from "./lib/catalog";
import { MOODS } from "../shared/moods.js";
import { detectLanguage } from "../shared/language.js";
import { artworkLuma, extractColors } from "../shared/palette";
import { requestedVariant } from "../shared/audio-variants.js";
import { artworkAt, artworkSrcSet } from "./lib/artwork";
import { qualityLabel } from "./lib/audio-format";
import { jumpTo, startSmoothScroll } from "./lib/smooth-scroll";
import { homeSeeds, onRepeat, recordLike, rotateForDay, tasteFilter, topArtists } from "./lib/listening";
import { lineSpan, peakMoments, splitBackingVocals } from "./lib/lyrics";
import { bestMoments } from "./lib/best-part";
import { litArtwork } from "./lib/lit-artwork";
import Welcome from "./components/Welcome";
import { shouldWelcome } from "./lib/welcome";
import FluidText from "./components/FluidText";
import {
  EASE,
  EASE_EXIT,
  EASE_IN_OUT,
  PILL_SPRING,
  SHEET_SPRING,
  coverChange,
  backdropChange,
  lyricsChange,
  nameBlend,
  textSwap,
  unfold,
  pop,
  glyphSwap,
  HEART_SPRING,
  MAGNET_SPRING,
  iconSwap,
  revealCard,
  revealSection,
  listItem,
  page as pageMotion,
  player as playerMotion,
  section as sectionMotion,
} from "./lib/motion";
import "./App.css";

const formatTime = (value) => {
  const n = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
function readSaved(key, valid = (t) => t && t.id && t.title) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter(valid)
      : [];
  } catch {
    return [];
  }
}
function IconButton({ label, children, active, className = "", ...props }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`icon-button ${active ? "active" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
function Cover({ track, className = "", eager = false }) {
  return (
    <div className={`cover ${className}`}>
      {track?.artwork ? (
        <img
          src={track.artwork}
          srcSet={artworkSrcSet(track.artwork)}
          sizes={className === "" ? "(max-width:760px) 45vw, 300px" : "300px"}
          alt={`${track.title} artwork`}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      ) : (
        <Music2 aria-hidden="true" />
      )}
    </div>
  );
}
// Artwork that crossfades when the track changes instead of swapping abruptly.
function FadingCover({ track, className = "", eager = false, size = 600, direction = null, blend = false }) {
  // A direction turns the crossfade into a travelling swap (the now-playing cover);
  // a DJ blend dissolves instead of sliding.
  const change = { direction, blend };
  const motion = { variants: coverChange, custom: change, initial: "initial", animate: "animate", exit: "exit" };
  return (
    <div className={`cover fading-cover ${className}`}>
      <AnimatePresence initial={false} custom={change}>
        {track?.artwork ? (
          <Motion.img
            key={track.artwork}
            src={artworkAt(track.artwork, size)}
            alt={`${track.title} artwork`}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            {...motion}
          />
        ) : (
          <Music2 key="placeholder" aria-hidden="true" />
        )}
      </AnimatePresence>
    </div>
  );
}
const foldText = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
// The catalogue lists one recording per single, album and compilation; keep the first.
function uniqueTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    const key = `${foldText(track.artist)}|${foldText(track.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const EMPTY_SEARCH = { top: null, songs: [], videos: [], albums: [], artists: [], playlists: [] };
const SEARCH_TABS = [
  ["all", "All"],
  ["songs", "Songs"],
  ["videos", "Videos"],
  ["albums", "Albums"],
  ["artists", "Artists"],
  ["playlists", "Playlists"],
];
const formatCount = (value) =>
  value >= 1e6 ? `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M` : value >= 1e3 ? `${Math.round(value / 1e3)}K` : String(value || 0);
const daypart = () => {
  const hour = new Date().getHours();
  return hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
};
// A name is optional, kept on this device, and only used to greet the listener.
const greeting = (name) => {
  const part = daypart();
  const hello = part === "night" ? "Late night listening" : `Good ${part}`;
  return `${hello}${name ? `, ${name}` : ""}.`;
};
const readName = () => {
  try {
    return (localStorage.getItem("aurora-name") || "").slice(0, 24);
  } catch {
    return "";
  }
};
const SEARCH_IDEAS = ["Greek pop", "Late night R&B", "Synthwave", "Acoustic", "Reggaeton", "Lo-fi"];

function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="brand-word">
        aurora<span className="brand-period">.</span>
      </span>
    </span>
  );
}
function PlayButton({ player, large = false }) {
  const button = (
    <IconButton
      label={player.playing ? "Pause" : "Play"}
      // Never disabled while loading: an embed stuck buffering (a refused autoplay)
      // must still yield to a press, which starts it inside the tap.
      className={`play-button ${large ? "large" : ""} ${player.needsTap ? "needs-tap" : ""}`}
      disabled={!player.track}
      onClick={player.togglePlay}
    >
      <span className="play-glyph">
        <AnimatePresence mode="popLayout" initial={false}>
          <Motion.span key={player.loading ? "loading" : player.playing ? "pause" : "play"} {...iconSwap}>
            {player.loading ? (
              <LoaderCircle className="spin" />
            ) : player.playing ? (
              <Pause fill="currentColor" />
            ) : (
              <Play fill="currentColor" />
            )}
          </Motion.span>
        </AnimatePresence>
      </span>
    </IconButton>
  );
  return large ? <Magnetic strength={0.3}>{button}</Magnetic> : button;
}

// Its own presence boundary: the page switcher skips entrance states on first
// load (initial={false}), which would leave nothing for the scroll reveal to play.
// The reveal is driven by state rather than whileInView: cards that arrive after
// the section has come into view (recommendations load late) then inherit "shown"
// and cascade in, instead of staying hidden.
function RevealSection(props) {
  const ref = useRef(null);
  const inView = useInView(ref, revealSection.viewport);
  return (
    <AnimatePresence>
      <Motion.section ref={ref} variants={revealSection.variants} initial="hidden" animate={inView ? "shown" : "hidden"} {...props} />
    </AnimatePresence>
  );
}

// A small waveform loader: five bars rise and fall in sequence (transform only).
function Waveform() {
  return (
    <span className="waveform-loader" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

// The now-playing cover follows the finger: sideways to change song (it tilts and
// a "Next"/"Previous" hint fades in), down to close the player. Direction lock
// keeps the two gestures apart; release springs it home.
function SwipeCover({ player, onClose, children }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-7, 7]);
  const scale = useTransform(y, [0, 240], [1, 0.92]);
  const nextHint = useTransform(x, [-150, -45], [1, 0]);
  const previousHint = useTransform(x, [45, 150], [0, 1]);
  return (
    <Motion.div
      className="now-playing-art"
      layout="position"
      transition={{ layout: LYRICS_GLIDE }}
      drag
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={{ left: 0.45, right: 0.45, top: 0.04, bottom: 0.5 }}
      dragTransition={{ bounceStiffness: 320, bounceDamping: 26 }}
      style={{ x, y, rotate, scale }}
      onDragEnd={(_, info) => {
        if (info.offset.x < -80 || info.velocity.x < -650) player.next();
        else if (info.offset.x > 80 || info.velocity.x > 650) player.previous();
        else if (info.offset.y > 110 || info.velocity.y > 750) onClose();
      }}
    >
      {children}
      <Motion.span className="swipe-hint is-next" style={{ opacity: nextHint }} aria-hidden="true">
        Next <ArrowRight size={15} />
      </Motion.span>
      <Motion.span className="swipe-hint is-previous" style={{ opacity: previousHint }} aria-hidden="true">
        <ArrowLeft size={15} /> Previous
      </Motion.span>
    </Motion.div>
  );
}

// The now-playing cover leans toward a fine pointer on a spring and catches the
// light: a sheen follows the pointer across it. Motion values write styles
// directly (no React render); off on touch, on phones' layout and under reduced
// motion, and never while the cover is being dragged.
const TILT_SPRING = { stiffness: 170, damping: 18, mass: 0.6 };
function TiltCover({ children }) {
  const rx = useSpring(0, TILT_SPRING), ry = useSpring(0, TILT_SPRING), glow = useSpring(0, TILT_SPRING);
  const gx = useMotionValue(50), gy = useMotionValue(30);
  const sheen = useMotionTemplate`radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.22), rgba(255,255,255,0) 58%)`;
  const move = (event) => {
    if (event.pointerType !== "mouse" || event.buttons || !window.matchMedia?.("(min-width: 761px)").matches || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width, py = (event.clientY - box.top) / box.height;
    ry.set((px - 0.5) * 14); rx.set((0.5 - py) * 14);
    gx.set(px * 100); gy.set(py * 100); glow.set(1);
  };
  const leave = () => { rx.set(0); ry.set(0); glow.set(0); };
  return (
    <Motion.div className="tilt-cover" style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }} onPointerMove={move} onPointerLeave={leave} onPointerDown={leave}>
      {children}
      <Motion.span className="tilt-sheen" aria-hidden="true" style={{ backgroundImage: sheen, opacity: glow }} />
    </Motion.div>
  );
}

// Magnetic: leans toward a fine pointer on a spring and settles back when it leaves.
function Magnetic({ children, strength = 0.22, limit = 10 }) {
  const x = useSpring(0, MAGNET_SPRING);
  const y = useSpring(0, MAGNET_SPRING);
  const move = (event) => {
    // Only on the wide layout: on the phone layout the button inside is absolutely
    // placed, and a transform here would re-anchor it to this zero-size wrapper.
    if (event.pointerType !== "mouse" || !window.matchMedia?.("(min-width: 761px)").matches || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    const clamp = (value) => Math.max(-limit, Math.min(limit, value));
    x.set(clamp((event.clientX - box.left - box.width / 2) * strength));
    y.set(clamp((event.clientY - box.top - box.height / 2) * strength));
  };
  const leave = () => {
    x.set(0);
    y.set(0);
  };
  return (
    <Motion.span className="magnetic" style={{ x, y }} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </Motion.span>
  );
}

// Text generate: each word rises out of a soft blur, one after another. Its own
// presence boundary lets it play on first load and whenever the words change.
function RevealWords({ text }) {
  const words = text.split(" ");
  return (
    <AnimatePresence mode="wait">
      <Motion.span key={text} className="reveal-words" aria-hidden="true">
        {words.map((word, i) => [
          i > 0 ? " " : null,
          <Motion.span
            key={`${word}-${i}`}
            className="reveal-word"
            initial={{ opacity: 0, y: "0.35em", filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.25 } }}
            transition={{ duration: 0.85, ease: EASE, delay: 0.08 + i * 0.07 }}
          >
            {word}
          </Motion.span>,
        ])}
      </Motion.span>
    </AnimatePresence>
  );
}

// A like pops the heart past full size and sends out a soft ring; unliking settles quietly.
function LikeHeart({ liked, size = 24 }) {
  const [previous, setPrevious] = useState(liked);
  const [burst, setBurst] = useState(0);
  if (previous !== liked) {
    setPrevious(liked);
    if (liked) setBurst((value) => value + 1);
  }
  return (
    <span className="like-heart">
      <Motion.span
        key={burst}
        className="like-glyph"
        initial={burst ? { scale: 0.55 } : false}
        animate={{ scale: 1 }}
        transition={HEART_SPRING}
      >
        <Heart size={size} fill={liked ? "currentColor" : "none"} />
      </Motion.span>
      {burst > 0 && (
        <Motion.span
          key={`ring-${burst}`}
          className="like-ring"
          aria-hidden="true"
          initial={{ scale: 0.4, opacity: 0.7 }}
          animate={{ scale: 1.9, opacity: 0 }}
          transition={{ duration: 0.65, ease: EASE }}
        />
      )}
    </span>
  );
}
// Keyed by the song: a new song starts with a fresh slider, so a drag in progress,
// a pending seek or the bar's transition never carry over from the previous one.
// The queue reads like a set list: the song playing, what comes next (with its
// length and a way to clear it), and what already played, folded away.
function QueueSections({ player, trackRows }) {
  const index = Math.max(0, player.queueIndex ?? 0);
  const queue = player.queue || [];
  const upNext = queue.slice(index + 1);
  const played = queue.slice(0, index);
  const minutes = Math.round(upNext.reduce((sum, track) => sum + (Number(track.duration) || 0), 0) / 60);
  return (
    <>
      <section className="queue-section" aria-label="Now playing">
        <h3 className="queue-heading">Now playing</h3>
        {trackRows(queue.slice(index, index + 1), true, undefined, index)}
      </section>
      <section className="queue-section" aria-label="Up next">
        <div className="queue-heading-row">
          <h3 className="queue-heading">
            Up next
            <small>{upNext.length ? `${upNext.length} ${upNext.length === 1 ? "song" : "songs"} · ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`}` : "Nothing yet"}</small>
          </h3>
          <AnimatePresence initial={false}>
            {upNext.length > 0 && (
              <Motion.button key="clear" {...pop} className="text-button" onClick={() => player.setQueue(queue.slice(0, index + 1))}>
                Clear
              </Motion.button>
            )}
          </AnimatePresence>
        </div>
        {upNext.length > 0 ? trackRows(upNext, true, undefined, index + 1) : <p className="queue-empty">{player.autoplay ? "More like this arrives as you listen." : "Add songs with + to play them next."}</p>}
      </section>
      <AnimatePresence initial={false}>
        {played.length > 0 && (
          <Motion.details key="played" {...unfold} className="queue-section queue-played">
            <summary className="queue-heading">
              Recently played <small>{played.length}</small>
            </summary>
            {trackRows(played, true, undefined, 0)}
          </Motion.details>
        )}
      </AnimatePresence>
    </>
  );
}

function Seek({ player }) {
  // Dragging previews locally and seeks once on release; seeking YouTube on every
  // input event stutters playback and cancels DJ preparation repeatedly.
  const [drag, setDrag] = useState(null);
  const duration = Math.max(player.duration || player.track?.duration || 0, 1);
  // Whole seconds are enough for the bar; the CSS transition interpolates between them.
  const time = useStore(player.clock, (value) => Math.round(value * 4) / 4);
  const value = drag ?? Math.min(time || 0, duration);
  const zone = player.djEnabled ? player.djWindow : null;
  const peaks = usePeaks(player);
  const zoneLabel = zone
    ? `DJ transition from ${formatTime(zone.start)} to ${formatTime(zone.end)}${zone.ready ? ", next track ready" : ""}`
    : undefined;
  // Only a held pointer previews; a tap, click or key seeks at once. Touch can
  // deliver pointerup before the value changes, and a drag can end off the rail,
  // so the release is also caught on the window.
  const held = useRef(false);
  const pending = useRef(null);
  const commit = useCallback(() => {
    held.current = false;
    if (pending.current === null) return;
    const value = pending.current;
    pending.current = null;
    player.seek(value);
    setDrag(null);
  }, [player]);
  useEffect(() => {
    if (drag === null) return undefined;
    window.addEventListener("pointerup", commit);
    window.addEventListener("pointercancel", commit);
    return () => {
      window.removeEventListener("pointerup", commit);
      window.removeEventListener("pointercancel", commit);
    };
  }, [drag, commit]);
  const change = (next) => {
    pending.current = next;
    if (held.current) setDrag(next);
    else commit();
  };
  return (
    <div className="seek-control">
      <div className="seek-track">
        {peaks.map((range) => (
          <span
            key={range.start}
            className="peak-mark"
            aria-hidden="true"
            title="Refrain"
            style={{
              left: `${Math.min(100, (range.start / duration) * 100)}%`,
              width: `${Math.max(0.6, ((Math.min(duration, range.end) - range.start) / duration) * 100)}%`,
            }}
          />
        ))}
        <AnimatePresence>
          {zone && (
            <Motion.span
              key="zone"
              className={`dj-seek-zone ${zone.ready ? "ready" : ""} ${zone.glide ? "glide" : ""}`}
              role="img"
              aria-label={zoneLabel}
              title={zoneLabel}
              initial={{ opacity: 0, scaleX: 0.6 }}
              animate={{ opacity: 1, scaleX: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: EASE }}
              style={{
                left: `${Math.max(0, (zone.start / duration) * 100)}%`,
                width: `${Math.max(0, ((Math.min(duration, zone.end) - Math.max(0, zone.start)) / duration) * 100)}%`,
              }}
            />
          )}
        </AnimatePresence>
        <input
          aria-label="Seek in track"
          aria-valuetext={`${formatTime(value)} of ${formatTime(duration)}`}
          type="range"
          min="0"
          max={duration}
          step="0.1"
          value={value}
          className={drag !== null ? "dragging" : ""}
          onChange={(e) => change(Number(e.target.value))}
          onPointerDown={() => { held.current = true; }}
          onPointerUp={commit}
          onBlur={commit}
          style={{ "--progress": `${Math.min(100, (value / duration) * 100)}%` }}
        />
      </div>
      <div className="timestamps">
        <span>{formatTime(value)}</span>
        <span>{formatTime(player.duration || player.track?.duration)}</span>
      </div>
    </div>
  );
}
function Transport({ player, large = false }) {
  return (
    <div className={`transport ${large ? "transport-large" : ""}`}>
      <IconButton
        label="Shuffle"
        active={player.shuffle}
        aria-pressed={player.shuffle}
        onClick={() => player.setShuffle(!player.shuffle)}
      >
        <Shuffle />
      </IconButton>
      <IconButton
        label="Previous track"
        disabled={!player.track}
        onClick={player.previous}
      >
        <SkipBack fill="currentColor" />
      </IconButton>
      <PlayButton player={player} large={large} />
      <IconButton
        label="Next track"
        disabled={!player.track}
        onClick={player.next}
      >
        <SkipForward fill="currentColor" />
      </IconButton>
      <IconButton
        label={`Repeat: ${player.repeat}`}
        active={player.repeat !== "off"}
        onClick={() =>
          player.setRepeat(
            player.repeat === "off"
              ? "all"
              : player.repeat === "all"
                ? "one"
                : "off",
          )
        }
      >
        {player.repeat === "one" ? <Repeat1 /> : <Repeat />}
      </IconButton>
    </div>
  );
}

// Lines are emphasised slightly before they are sung so the long transition
// settles as the voice arrives; the word fill itself stays on genuine timing.
const LINE_LEAD = 0.5;
// Words held at least this long glow as they fill.
const HELD_WORD = 1;
const lineEnd = (line) => line?.words?.at(-1)?.end ?? line?.end;

function Interlude({ clock, offset, start, end }) {
  const progress = useStore(clock, (value) =>
    Math.round(Math.max(0, Math.min(1, (value + offset - start) / (end - start))) * 60) / 60,
  );
  return (
    <Motion.div
      className="lyric-interlude"
      aria-label="Instrumental break"
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: 58, marginTop: 6 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.8, ease: EASE }}
    >
      {[0, 1, 2].map((dot) => (
        <i
          key={dot}
          style={{ "--dot": Math.max(0, Math.min(1, progress * 3 - dot)) }}
        />
      ))}
    </Motion.div>
  );
}

// Peaks (refrain, held notes) come from genuinely timed lyrics only.
// Best parts: refrains and held notes from timed lyrics, weighed against what the
// music itself says (listener replays, measured energy) and landed on the beat.
// Audio evidence runs on playback time; results are in lyric time like the lines.
function useMoments(player) {
  const lines = player.lyrics?.sync && player.lyrics.sync !== "plain" ? player.lyrics.lines : null;
  const insight = player.songInsight;
  const offset = player.lyricsOffset || 0;
  const duration = player.duration;
  return useMemo(() => {
    const lyricPeaks = lines ? peakMoments(lines) : [];
    // Replays describe one upload: trusted only when it is as long as what is playing.
    const replays = insight?.replays?.length && Math.abs(insight.replays.at(-1).end - duration) <= 8 ? insight.replays : null;
    // Device audio carries a measured grid. Online songs know at most a catalogue
    // tempo, so the beat phase comes from the sung words (or, for line-timed lyrics,
    // from where the lines start); with no catalogue tempo at all, word-timed vocals
    // still show the beat. Everything is in playback time.
    let grid = insight?.grid || null;
    const words = lines ? lines.flatMap((line) => line.words || []).map((word) => ({ start: word.start - offset, end: word.end - offset })) : [];
    if (grid?.period && !Number.isFinite(grid.origin) && lines) {
      const phase = beatPhase(words, grid.period) || linePhase(lines.map((line) => ({ time: line.time - offset })), grid.period);
      if (phase) grid = { ...grid, origin: phase.origin };
    } else if (!grid?.period && words.length) {
      const measured = lyricBeat(words);
      if (measured) grid = { period: measured.period, origin: measured.origin, source: "lyrics" };
    }
    const { peaks, best, intensity } = bestMoments({
      lyricPeaks: lyricPeaks.map((range) => ({ start: range.start - offset, end: range.end - offset })),
      replays,
      energy: insight?.energy,
      grid,
      duration,
    });
    const toLyricTime = (range) => range && { ...range, start: range.start + offset, end: range.end + offset };
    // The beat grid in lyric time, for the pulse (null when its phase is unknown).
    const beat = Number.isFinite(grid?.origin) ? { period: grid.period, origin: grid.origin + offset } : null;
    return { peaks: peaks.map(toLyricTime), best: toLyricTime(best), beat, intensity };
  }, [lines, insight, offset, duration]);
}
function usePeaks(player) {
  return useMoments(player).peaks;
}

// Jumps to the song's best part (its longest refrain) and hides while it plays.
function BestPartChip({ player }) {
  const { best } = useMoments(player);
  const offset = player.lyricsOffset || 0;
  const inside = useStore(player.clock, (value) => !!best && value + offset >= best.start - 1 && value + offset < best.end);
  return (
    <AnimatePresence>
      {best && !inside && (
        <Motion.button
          key="best"
          type="button"
          className="best-part-chip"
          onClick={() => player.seek(Math.max(0, best.start - offset - 0.35))}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.5, ease: EASE }}
          aria-label={`Jump to the best part at ${formatTime(best.start)}`}
        >
          <Sparkles size={13} /> Best part
        </Motion.button>
      )}
    </AnimatePresence>
  );
}

const PULSE_DELAY = 1.6;
// Seconds before a peak's end that its glow starts to close (its fade is ~1.8 s).
const PEAK_CLOSE = 0.9;
// Showing or hiding lyrics is one movement: the cover and the song's name glide to
// their new places on the same curve and duration as the lyrics emerge beside them
// (or fold away), so the layout never jumps and the two never feel separate.
const LYRICS_GLIDE = { duration: 0.8, ease: EASE };
// The song's name gliding between the player and its place under the cover in focus.
const TITLE_GLIDE = { type: "spring", stiffness: 140, damping: 22, mass: 0.9 };

// Which peak the glow is in, flipped on time: re-checked on every clock tick, and
// near a boundary a timer lands the flip exactly (the clock ticks only 4× a second).
function usePeakWindow(player, peaks, offset, options) {
  const [index, setIndex] = useState(-1);
  const { lead, close } = options;
  useEffect(() => {
    let timer = 0;
    const update = () => {
      clearTimeout(timer);
      const { index: now, until } = peakWindow(player.getPlaybackTime() + offset, peaks, { lead, close });
      setIndex(now);
      if (until < 1.2) timer = setTimeout(update, Math.max(16, until * 1000 + 10));
    };
    update();
    const stop = player.clock.subscribe(update);
    return () => { clearTimeout(timer); stop(); };
  }, [player, peaks, offset, lead, close]);
  return index;
}

// The artwork backdrop opens up (a slow zoom and lift) through the song's peaks:
// its refrain and long held notes, read from genuinely timed lyrics only.
function ArtBackdrop({ player }) {
  const { peaks, beat, intensity } = useMoments(player);
  const offset = player.lyricsOffset || 0;
  // The catalogue or measured tempo; failing that, the beat the sung words show.
  const period = pulsePeriod(player.bpm) || (beat ? pulsePeriod(60 / beat.period) : null);
  // The glow opens about half a beat early, so its lift lands on the downbeat, and
  // starts closing just before the section ends, so it is gone as the section is.
  const lead = period ? Math.min(0.4, Math.max(0.15, period / 2)) : 0.25;
  const windowIndex = usePeakWindow(player, peaks, offset, { lead, close: PEAK_CLOSE });
  // On a song change the window still names the old song's peak for one render,
  // until its effect re-checks: a peak the new song does not have is no peak.
  const glowRange = windowIndex >= 0 ? peaks[windowIndex] : undefined;
  const glowIndex = glowRange ? windowIndex : -1;
  const peak = !!glowRange;
  const peakBase = glowRange ? glowRange.strength ?? 0.85 : 0;
  // The pulse joins once the opening zoom has mostly settled, so the two never
  // compete for frames; it leaves with the glow.
  const settled = useStore(player.clock, (value) => !!glowRange && value + offset >= glowRange.start + PULSE_DELAY);
  const peakIndex = settled ? glowIndex : -1;
  // How strong this moment is (0.45 light … 1 strong): from the evidence, and with
  // audio evidence it follows the music second by second (in 0.05 steps, eased by
  // the CSS transitions); with lyrics alone a peak swells gently toward its end.
  const strength = useStore(player.clock, (value) => {
    const range = glowRange;
    if (!range) return 0;
    const base = range.strength ?? 0.85;
    const live = intensity ? 0.45 + 0.55 * intensity(value) : base * (0.88 + 0.12 * Math.min(1, Math.max(0, (value + offset - range.start) / Math.max(1, range.end - range.start))));
    return Math.round(Math.min(1, Math.max(0.45, intensity ? (base + live) / 2 : live)) * 20) / 20;
  });
  const reduce = useReducedMotion();
  const artwork = player.track?.artwork;
  const blend = player.changeKind === "blend";
  // Every artwork sits at the same perceived brightness: bright covers are eased
  // down and dark ones lifted, from the cover's measured mean luminance.
  const [exposure, setExposure] = useState({ artwork: null, value: 1 });
  // The pulse is light from the cover itself: its dominant colour, lifted halfway
  // to white, so a kick reads as the artwork glowing rather than a white flash.
  const [tint, setTint] = useState({ artwork: null, value: null });
  useEffect(() => {
    if (!artwork) return undefined;
    let live = true;
    extractColors(artwork).then((colors) => {
      const light = artworkLuma(artwork);
      if (live && light !== null) setExposure({ artwork, value: Math.min(1.45, Math.max(0.72, 0.36 / Math.max(light, 0.05))) });
      const rgb = String(colors?.[0] || "").split(",").map(Number);
      if (live && rgb.length === 3 && rgb.every(Number.isFinite)) setTint({ artwork, value: rgb.map((channel) => Math.round(channel + (255 - channel) * 0.55)).join(" ") });
    });
    return () => { live = false; };
  }, [artwork]);
  const level = exposure.artwork === artwork ? exposure.value : 1;
  const [lit, setLit] = useState({ key: null, url: null });
  const litKey = artwork ? `${artwork}|${level}` : null;
  useEffect(() => {
    if (!artwork) return undefined;
    let live = true;
    litArtwork(artworkAt(artwork, 300), { brightness: 1.22 * level, saturate: 1.38, contrast: 1.16 }).then((url) => {
      if (live) setLit({ key: `${artwork}|${level}`, url });
    });
    return () => { live = false; };
  }, [artwork, level]);
  const litUrl = lit.key === litKey ? lit.url : null;
  const artRef = useRef(null);
  const glowRef = useRef(null);
  // The depth is the peak's own strength, fixed for the peak, so it never changes mid-section.
  const depth = breath({ peak, strength: peakBase });
  useBeatBreath(player, {
    active: player.playing && !reduce && !!period,
    // With no beat phase known, a best part still has one: its first sung word,
    // as the peak's own pulse uses; elsewhere nothing moves.
    origin: beat?.origin ?? glowRange?.start,
    period,
    zoom: depth.zoom,
    glow: depth.glow,
    offset,
  }, artRef, glowRef);
  return (
    <>
      {/* The zoom follows the peak's own strength (fixed for the peak: rescaling a
          large blurred layer is costly); only the light layers follow it live. */}
      <div ref={artRef} className={`player-art-background ${peak ? "is-peak" : ""}`} style={{ "--art-exposure": level.toFixed(3), "--peak-base": peakBase, "--peak-strength": strength || 0 }}>
        <AnimatePresence initial={false} custom={blend}>
          {artwork && (
            <Motion.div
              key={artwork}
              className="art-bg-layer"
              style={{ backgroundImage: `url("${artworkAt(artwork, 1000)}")` }}
              variants={backdropChange}
              custom={blend}
              initial="initial"
              animate="animate"
              exit="exit"
            />
          )}
        </AnimatePresence>
      </div>
      {/* The cover pre-lit (brighter, richer, more contrast) fades in through a peak:
          drawn once, soft and small, so the fade never redraws a blur. */}
      <div
        className={`player-art-boost ${peak ? "is-peak" : ""}`}
        aria-hidden="true"
        style={{
          "--lit-soft": litUrl ? `url("${litUrl}")` : "none",
          "--lit-sharp": artwork ? `url("${artworkAt(artwork, 1000)}")` : "none",
          "--art-exposure": level.toFixed(3),
          "--peak-base": peakBase,
          "--peak-strength": strength || 0,
        }}
      />
      <div className={`player-veil ${peak ? "is-peak" : ""}`} style={{ "--peak-base": peakBase }} />
      <div ref={glowRef} className="beat-breath" aria-hidden="true" data-period={period || undefined} data-beat-origin={beat?.origin ?? glowRange?.start} style={tint.artwork === artwork && tint.value ? { "--breath-tint": tint.value } : undefined} />
      <AnimatePresence>
        {peakIndex >= 0 && period && player.playing && !reduce && (
          <BeatPulse key={`${player.track?.id}:${peakIndex}`} player={player} anchor={peaks[peakIndex].start} beatOrigin={beat?.origin ?? peaks[peakIndex].start} period={period} strength={strength} tint={tint.artwork === artwork ? tint.value : null} />
        )}
      </AnimatePresence>
    </>
  );
}

// All song long the whole background breathes on the beat: it zooms in a hair and
// back, and a soft light from the cover swells with it. The artwork or the video,
// whichever is the background, both move. Web Animations on transform and opacity
// only (compositor work); the playhead re-aligns them every frame, and they start,
// stop and change depth only while the background is at rest between beats, so
// nothing ever jumps. With no known beat (tempo and phase) nothing moves.
// Off by more than this, the breath re-enters on the beat rather than jumping.
const LOST_BEAT = 0.06;
function useBeatBreath(player, wanted, art, glow) {
  const want = useRef(wanted);
  useEffect(() => { want.current = wanted; });
  const { getPlaybackTime } = player;
  useEffect(() => {
    let running = null;
    const stop = () => { running?.animations.forEach((animation) => animation.cancel()); running = null; };
    // Pinned to the page's timeline (as of this frame) at the song's phase: it holds
    // from the very first frame, with no start-up lag to read as drift.
    const align = (animations, phase) => {
      const now = document.timeline.currentTime;
      for (const animation of animations) animation.startTime = now - phase * 1000;
    };
    const start = ({ period, zoom, glow: light }, phase) => {
      const duration = period * 1000;
      const keys = (frame) => BREATH_KEYS.map(({ offset, level, easing }) => ({ offset, ...(easing ? { easing } : {}), ...frame(level) }));
      const scale = keys((level) => ({ transform: `scale(${(1 + zoom * level).toFixed(5)})` }));
      const video = document.querySelector(".video-surface.is-visible");
      const animations = [art.current, video]
        .filter(Boolean)
        .map((element) => element.animate(scale, { duration, iterations: Infinity }));
      if (glow.current) animations.push(glow.current.animate(keys((level) => ({ opacity: (light * level).toFixed(3) })), { duration, iterations: Infinity }));
      align(animations, phase);
      running = { animations, period, zoom, light, video };
    };
    let frame = requestAnimationFrame(function breathe() {
      frame = requestAnimationFrame(breathe);
      const { active, origin, period, zoom, glow: light, offset } = want.current;
      // Where the running breath is, by its own clock (it keeps time while paused).
      const own = running && (((document.timeline.currentTime - Number(running.animations[0]?.startTime)) / 1000) % running.period || 0);
      if (!active || !period || !Number.isFinite(origin)) {
        if (running && atRest(own, running.period)) stop();
        return;
      }
      const phase = pulsePhase(getPlaybackTime() + offset, origin, period);
      if (!running) {
        if (atRest(phase, period)) start(want.current, phase);
        return;
      }
      const video = document.querySelector(".video-surface.is-visible");
      const drift = Math.abs(phase - own) % period;
      const off = Math.min(drift, period - drift);
      // A new depth or tempo, a new background, or a jump in the song (a seek):
      // the breath finishes its beat and rests, then starts again on the beat.
      if (running.period !== period || running.zoom !== zoom || running.light !== light || running.video !== video || off > LOST_BEAT) {
        if (atRest(own, running.period)) stop();
        return;
      }
      // Small drift is trimmed in place (a shift too small to see).
      if (off > 0.02) align(running.animations, phase);
    });
    return () => { cancelAnimationFrame(frame); stop(); };
  }, [getPlaybackTime, art, glow]);
}

// Through a peak the backdrop breathes with the music: a glow that kicks on each
// beat (fast attack, slow decay) and a soft ring that travels out once a bar. The
// kick is locked to the song's beat grid (measured for device audio, read from the
// sung words online) on the smooth playhead, checked every frame; drift over 20 ms is
// corrected by setting
// the running animation's time, so a correction never restarts it. Opacity and
// scale only, so it stays on the compositor.
function BeatPulse({ player, anchor, beatOrigin, period, strength = 0.8, tint = null }) {
  const wave = useRef(null);
  const ring = useRef(null);
  const offset = player.lyricsOffset || 0;
  const { getPlaybackTime } = player;
  useEffect(() => {
    // The two running animations, looked up once they exist (not every frame).
    const tracks = [[wave, period, beatOrigin], [ring, period * 4, anchor]].map(([ref, cycle, from]) => ({ ref, cycle, from, animation: null }));
    const align = () => {
      const time = getPlaybackTime() + offset;
      for (const track of tracks) {
        track.animation ||= track.ref.current?.getAnimations?.()[0] || null;
        const { animation, cycle, from } = track;
        if (!animation) continue;
        const want = pulsePhase(time, from, cycle) * 1000;
        const have = ((Number(animation.currentTime) % (cycle * 1000)) + cycle * 1000) % (cycle * 1000);
        const drift = Math.abs(want - have);
        if (Math.min(drift, cycle * 1000 - drift) > 20) animation.currentTime = want;
      }
    };
    // Checked every frame (a few subtractions): a busy moment never lets it drift.
    let frame = requestAnimationFrame(function lock() { align(); frame = requestAnimationFrame(lock); });
    return () => cancelAnimationFrame(frame);
  }, [getPlaybackTime, offset, anchor, beatOrigin, period]);
  return (
    <Motion.div
      className="beat-pulse"
      aria-hidden="true"
      // How strong the moment is sets how bright the light is, from a faint shimmer
      // in a light passage to a full kick in the song's peak. It is baked into the
      // light's own colour (a repaint only when it changes): an opacity below 1 here
      // would cost an offscreen pass every frame.
      style={{ "--pulse-gain": (0.28 + 0.72 * strength).toFixed(2), ...(tint ? { "--pulse-tint": tint } : {}) }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 2.4, ease: EASE } }}
      exit={{ opacity: 0, transition: { duration: 1.6, ease: EASE_IN_OUT } }}
    >
      <div ref={wave} className="beat-pulse-wave" style={{ "--pulse-period": `${period}s` }} data-beat-origin={beatOrigin} data-period={period} />
      <div ref={ring} className="beat-pulse-ring" style={{ "--pulse-bar": `${period * 4}s` }} />
    </Motion.div>
  );
}

// One lyric line. Memoized on its own data and state, so a song change or a new
// active line re-renders only the lines whose state actually changed, never every
// word of the song; the word wipe itself is painted outside React.
const LyricLine = memo(function LyricLine({ line, index, state, timed, backing, lineRef, onSeek, gap }) {
  return (
    <div className="lyric-block" data-index={index}>
      <button
        ref={lineRef}
        className={`lyric-line ${state} ${!timed ? "plain" : ""} ${line.words?.length ? "has-words" : ""}`}
        disabled={!timed}
        onClick={() => onSeek(line.time)}
        aria-label={timed ? `Seek to ${formatTime(line.time)}: ${line.text}` : undefined}
      >
        {line.words?.length
          ? line.words.map((word, wi) => (
              <span
                key={wi}
                className={`lyric-word${backing?.[wi] ? " backing" : ""}${word.end - word.start >= HELD_WORD ? " held" : ""}`}
              >
                <span>{word.text}</span>
                <span aria-hidden="true" className="word-fill">
                  {word.text}
                </span>
              </span>
            ))
          : line.text}
      </button>
      {gap && (
        <AnimatePresence initial={false}>
          {gap.open && <Interlude key="gap" clock={gap.clock} offset={gap.offset} start={gap.start} end={gap.end} />}
        </AnimatePresence>
      )}
    </div>
  );
}, (before, after) => {
  // The gap is a fresh object each render; compare what it carries.
  const { gap: a, ...restBefore } = before, { gap: b, ...restAfter } = after;
  const sameGap = a === b || (!!a && !!b && a.open === b.open && a.clock === b.clock && a.offset === b.offset && a.start === b.start && a.end === b.end);
  return sameGap && Object.keys(restAfter).every((key) => restBefore[key] === restAfter[key]) && Object.keys(restBefore).length === Object.keys(restAfter).length;
});

function Lyrics({ player }) {
  const reduce = useReducedMotion();
  // While a song's lyrics fade out after a hand-over, the shared clock already
  // belongs to the next song: the outgoing words hold their last state.
  const present = useIsPresent();
  const held = useRef(null);
  // State, not a ref: the list mounts after the loading state finishes exiting,
  // and the painter must start once the node actually exists.
  const container = useRef(null);
  const [mountedList, setMountedList] = useState(null);
  const activeRef = useRef(null);
  const scrolling = useRef(null);
  const [following, setFollowing] = useState(true);
  const lines = useMemo(() => player.lyrics?.lines?.length
    ? player.lyrics.lines
    : (player.lyrics?.plainLyrics || "")
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((text) => ({ text })), [player.lyrics]);
  const backing = useMemo(() => lines.map((line) => line.words?.length ? splitBackingVocals(line.words.map((word) => word.text)) : null), [lines]);
  const offset = player.lyricsOffset || 0;
  const timed = player.lyrics?.sync !== "plain";
  const lead = reduce ? 0 : LINE_LEAD;
  // Re-render only when the active line or interlude state changes, not every clock tick.
  const position = useStore(player.clock, (value) => {
    if (!present && held.current) return held.current;
    const adjusted = value + offset;
    let current = -1;
    if (timed)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].time <= adjusted + lead) current = i;
        else break;
      }
    const start = current >= 0 ? lineEnd(lines[current]) : 0;
    const end = lines[current + 1]?.time;
    const gap =
      timed &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end - start > 4 &&
      adjusted >= start + 0.4 &&
      adjusted < end - 0.5;
    held.current = `${current}:${gap ? 1 : 0}`;
    return held.current;
  });
  const active = Number(position.split(":")[0]);
  const inGap = position.endsWith(":1");
  const gapStart = active >= 0 ? lineEnd(lines[active]) : 0;
  const gapEnd = lines[active + 1]?.time;
  const interlude = { clock: player.clock, offset, start: gapStart, end: gapEnd };
  const stopScroll = () => scrolling.current?.stop();
  const { seek } = player;
  const seekToLine = useCallback((time) => {
    seek(Math.max(0, time - offset));
    setFollowing(true);
  }, [seek, offset]);
  useEffect(() => {
    const box = container.current;
    const target = activeRef.current;
    if (!following || !box || !target || !present) return;
    const top = Math.max(0, target.offsetTop + target.offsetHeight / 2 - box.clientHeight * 0.4);
    stopScroll();
    if (reduce) {
      box.scrollTop = top;
      return;
    }
    // A long, eased glide replaces the browser's short smooth-scroll jump.
    scrolling.current = animate(box.scrollTop, top, {
      duration: 1.6,
      ease: [0.45, 0.05, 0.1, 1],
      onUpdate: (value) => {
        box.scrollTop = value;
      },
    });
    return stopScroll;
  }, [mountedList, active, following, reduce, inGap, present]);
  // Edge fading via visibility classes: a mask on the scrolling list forced the
  // whole list to re-rasterise on every painted word.
  useEffect(() => {
    if (!mountedList || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.target.classList.toggle("at-edge", entry.intersectionRatio < 0.99)),
      { root: mountedList, rootMargin: "-14% 0px -14% 0px", threshold: [0, 0.99] },
    );
    mountedList.querySelectorAll(".lyric-line").forEach((line) => observer.observe(line));
    return () => observer.disconnect();
  }, [mountedList, lines]);
  const { getPlaybackTime, lyricsOffset = 0, lyricsLoading } = player;
  useEffect(() => {
    if (!mountedList || !timed || lyricsLoading || !present) return;
    const nodes = Array.from(mountedList.querySelectorAll(".lyric-line"));
    const words = nodes.map((line) => Array.from(line.querySelectorAll(".word-fill")));
    // Each line is painted for as long as any of its words is sung: backing
    // vocals often run on after the next line has started.
    const spans = lines.map(lineSpan);
    let frame;
    let previousTime = null;
    const paint = () => {
      const time = getPlaybackTime() + lyricsOffset;
      if (time !== previousTime) {
        const reset = previousTime === null || time < previousTime || time - previousTime > 0.5;
        for (let i = 0; i < lines.length; i++) {
          const span = spans[i];
          if (!words[i]?.length) continue;
          if (!reset && (time < span.start - 0.25 || previousTime > span.end + 0.15)) continue;
          const singing = time >= span.start - 0.1 && time <= span.end + 0.1;
          if (nodes[i].classList.contains("is-singing") !== singing) nodes[i].classList.toggle("is-singing", singing);
          words[i].forEach((fill, index) => {
            const word = lines[i].words[index];
            // A feathered wipe leads the onset by at most 90ms and finishes on the word's end.
            const lead = reduce ? 0 : Math.min(0.09, (word.end - word.start) * 0.2);
            const progress = reduce
              ? Number(time >= word.start)
              : Math.min(1, Math.max(0, (time - word.start + lead) / Math.max(0.001, word.end - word.start + lead)));
            // Write only on change: every style write invalidates paint for that word.
            const value = progress.toFixed(3);
            if (fill.dataset.fill !== value) {
              fill.dataset.fill = value;
              fill.style.setProperty("--fill", value);
            }
            const state = time >= word.end ? "sung" : time >= word.start - lead ? "singing" : "";
            const holder = fill.parentElement;
            if (holder.dataset.state !== state) {
              holder.dataset.state = state;
              holder.classList.toggle("singing", state === "singing");
              holder.classList.toggle("sung", state === "sung");
            }
          });
        }
        previousTime = time;
      }
      frame = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(frame);
  }, [mountedList, getPlaybackTime, lines, lyricsOffset, lyricsLoading, timed, reduce, present]);
  const releaseFollow = () => {
    stopScroll();
    setFollowing(false);
  };
  let content;
  if (player.lyricsLoading)
    content = (
      <Motion.div key="loading" className="lyric-empty" {...fade}>
        <span className="lyric-loading">
          <i />
          <i />
          <i />
        </span>
        <p>Finding the words…</p>
      </Motion.div>
    );
  else if (!lines.length)
    content = (
      <Motion.div key="empty" className="lyric-empty" {...fade}>
        <Music2 size={36} />
        <h2>
          {player.lyrics?.instrumental
            ? "Just the music."
            : "Let the music speak."}
        </h2>
        <p>
          {player.lyrics?.instrumental
            ? "This track is instrumental."
            : "Lyrics aren’t available for this track yet."}
        </p>
      </Motion.div>
    );
  else
    content = (
      <Motion.div key="lyrics" className="lyrics-layout" {...fade}>
        <div
          className="lyrics-scroll"
          ref={(node) => {
            container.current = node;
            setMountedList(node);
          }}
          onWheel={releaseFollow}
          onTouchStart={releaseFollow}
          onKeyDown={(e) => {
            if (["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(e.key))
              releaseFollow();
          }}
          tabIndex="0"
          aria-label="Song lyrics"
        >
          <div className="lyrics-spacer" />
          <AnimatePresence initial={false}>
            {inGap && active === -1 && <Interlude key="intro" {...interlude} />}
          </AnimatePresence>
          {lines.map((line, i) => (
            <LyricLine
              key={`${i}-${line.time}`}
              line={line}
              index={i}
              state={i === active ? "current" : i < active ? "past" : i === active + 1 ? "upcoming" : ""}
              timed={timed}
              backing={backing[i]}
              lineRef={i === active ? activeRef : null}
              onSeek={seekToLine}
              gap={i === active ? { open: inGap, clock: player.clock, offset, start: gapStart, end: gapEnd } : null}
            />
          ))}
          <div className="lyrics-spacer" />
        </div>
        <div className="lyric-footer">
          <span>
            {player.lyrics?.source || "Lyrics"} ·{" "}
            {player.lyrics?.sync === "word"
              ? "Word sync"
              : timed
                ? "Line sync"
                : "Unsynced"}
            {/* Timing for another edit of the song: said plainly, never guessed at. */}
            {timed && player.lyricsTiming === "captions"
              ? ` · synced to this video (${player.lyricsOffset > 0 ? "+" : ""}${player.lyricsOffset.toFixed(1)} s)`
              : ""}
            {timed && player.lyricsTiming === "published" && player.lyrics?.versionGap
              ? ` · timed for a ${Math.abs(player.lyrics.versionGap).toFixed(1)} s ${player.lyrics.versionGap > 0 ? "shorter" : "longer"} edit`
              : ""}
          </span>
          <AnimatePresence>
            {!following && timed && (
              <Motion.button
                key="follow"
                className="small-pill"
                onClick={() => setFollowing(true)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                Follow lyrics <ArrowDown size={14} />
              </Motion.button>
            )}
          </AnimatePresence>
        </div>
      </Motion.div>
    );
  return <AnimatePresence mode="wait" initial={false}>{content}</AnimatePresence>;
}

const fade = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.35, ease: EASE_IN_OUT } },
};

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

// The playing song's name. Its letters morph between songs only where it is on
// screen (each letter's move is a layout measurement, so the hidden layout's copy
// stays plain); the artist line fades in, compositor only.
function TrackName({ track, live, blend = false }) {
  return (
    <>
      {live ? (
        // One presence for the name: a skip keeps the same element, which morphs
        // letter by letter; a DJ blend keys it by title, so the old name drifts out
        // as the new one fades in (a morph mid-blend passes through half-words).
        <span className="name-swap">
          <AnimatePresence initial={false} mode="popLayout">
            <Motion.span key={blend ? `blend:${track.title}` : "name"} className="name-swap-item" {...nameBlend}>
              <FluidText as="h1">{track.title}</FluidText>
            </Motion.span>
          </AnimatePresence>
        </span>
      ) : <h1>{track.title}</h1>}
      <p key={track.artist} className="swap-in">{track.artist}</p>
    </>
  );
}

function Sheet({ title, close, back, children }) {
  const ref = useRef(null);
  const [isPresent, safeToRemove] = usePresence();
  const reduce = useReducedMotion();
  const mobile = useMediaQuery("(max-width: 760px)");
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    // The page behind a sheet stays put: wheel and touch scrolling no longer
    // chain through the dialog to the document. Counted, so stacked sheets work.
    const root = document.documentElement;
    root.dataset.sheets = String(Number(root.dataset.sheets || 0) + 1);
    root.classList.add("scroll-locked");
    return () => {
      if (dialog.open) dialog.close();
      const left = Math.max(0, Number(root.dataset.sheets || 1) - 1);
      root.dataset.sheets = String(left);
      if (!left) root.classList.remove("scroll-locked");
    };
  }, []);
  // Mobile sheets rise from the bottom edge; desktop dialogs settle in from slightly below.
  const hidden = mobile ? { y: "100%", opacity: 1, scale: 1 } : { y: 18, opacity: 0, scale: 0.965 };
  return (
    <Motion.dialog
      initial={hidden}
      animate={isPresent ? { y: 0, opacity: 1, scale: 1 } : hidden}
      transition={
        reduce
          ? { duration: 0 }
          : isPresent
            ? { ...SHEET_SPRING, opacity: { duration: 0.35, ease: EASE } }
            : { duration: mobile ? 0.38 : 0.28, ease: EASE_EXIT }
      }
      onAnimationComplete={() => {
        if (!isPresent) {
          ref.current?.close();
          safeToRemove?.();
        }
      }}
      ref={ref}
      className={`sheet ${isPresent ? "" : "is-closing"}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-label={title}
    >
      <Motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: EASE, delay: reduce ? 0 : 0.08 }}
        className="sheet-inner"
      >
        <Motion.button
          type="button"
          className="sheet-handle"
          aria-label={`Dismiss ${title}`}
          onClick={close}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.y > 45 || info.velocity.y > 500) close();
          }}
        />
        <header>
          {/* Going deeper brings a way back: it arrives with the nested sheet. */}
          <AnimatePresence initial={false}>
            {back && (
              <Motion.span key="back" {...pop} className="sheet-back">
                <IconButton label="Back to preferences" onClick={back}>
                  <ArrowLeft />
                </IconButton>
              </Motion.span>
            )}
          </AnimatePresence>
          <h2>{title}</h2>
          <IconButton label={`Close ${title}`} onClick={close}>
            <X />
          </IconButton>
        </header>
        {children}
      </Motion.div>
    </Motion.dialog>
  );
}

function sourceLabel(player) {
  const info = player.sourceInfo;
  if (!info) return "";
  if (info.kind === "local") return info.format ? qualityLabel(info.format) : "Local file";
  if (info.video) return "YouTube video";
  return info.official ? "Official audio" : "YouTube audio";
}

function QualityChip({ player, onClick }) {
  const label = sourceLabel(player);
  if (!label) return null;
  const lossless = player.sourceInfo?.format?.lossless;
  return (
    <button className={`quality-chip ${lossless ? "lossless" : ""}`} onClick={onClick} aria-label={`Audio quality: ${label}`}>
      <AnimatePresence mode="wait" initial={false}>
        <Motion.span key={label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.35, ease: EASE }}>
          {label}
        </Motion.span>
      </AnimatePresence>
    </button>
  );
}

function AudioQuality({ player }) {
  const info = player.sourceInfo;
  const output = player.audioOutput();
  const rows = [
    ["Now playing", sourceLabel(player) || "Nothing yet"],
    info?.kind === "youtube" && ["Source", info.official ? `Official audio upload${info.channel ? ` · ${info.channel}` : ""}` : info.video ? "The video you chose" : "Best matching upload (altered versions excluded)"],
    info?.kind === "local" && ["Decoding", "Your browser decodes the file directly; nothing is uploaded."],
    output && ["Output", `${output.sampleRate / 1000} kHz · 32-bit float · ${output.channels > 2 ? `${output.channels} channels` : "stereo"}`],
    ["Signal path", "Direct. Filters and effects join only during DJ blends."],
  ].filter(Boolean);
  return (
    <>
      <dl className="audio-facts">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="setting-row">
        <div>
          <strong>Surround for multichannel files</strong>
          <p>5.1 and 7.1 files reach every speaker your output offers. Stereo stays stereo.</p>
        </div>
        <button role="switch" aria-label="Surround for multichannel files" aria-checked={!!player.surround} className="setting-switch" onClick={() => player.setSurround(!player.surround)}>
          <span />
        </button>
      </div>
      <p className="provider-note">
        Online songs play YouTube’s own stream, and YouTube chooses its quality; Aurora always prefers official audio uploads and never
        picks 8D, slowed or sped-up versions unless you search for them. Lossless and Dolby Atmos streaming require licensed services, so
        Aurora does not claim them. For lossless and hi-res, open your own FLAC, ALAC, WAV or AIFF files: their real format is shown above.
      </p>
    </>
  );
}

function djPhaseLabel(player) {
  if (!player.djEnabled) return "Off";
  return {
    priming: "Preparing",
    gliding: "Matching tempo",
    mixing: "Blending",
  }[player.djState?.phase] || "On";
}

function DjPill({ player, onClick, label }) {
  const active = player.djEnabled && player.djState?.phase !== "idle";
  const progress = useStore(player.mixProgress, (value) => Math.round(value * 50) / 50);
  return (
    <button
      className={`dj-pill ${player.djEnabled ? "enabled" : ""} ${active ? "is-active" : ""}`}
      onClick={onClick}
      aria-label={label}
      style={{ "--dj-progress": active ? progress : 0 }}
    >
      <AudioLines size={16} />
      <span>DJ transition</span>
      <AnimatePresence mode="wait" initial={false}>
        <Motion.small
          key={djPhaseLabel(player)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 0.85, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          {djPhaseLabel(player)}
        </Motion.small>
      </AnimatePresence>
    </button>
  );
}

function DjStatus({ player }) {
  const state = player.djState || {};
  const busy = player.djEnabled && state.phase && state.phase !== "idle";
  const effects = state.effects || [];
  const progress = useStore(player.mixProgress, (value) => Math.round(value * 100) / 100);
  return (
    <div className={`dj-now ${busy ? "is-busy" : ""}`} role="status">
      <span className="dj-orbit">
        <i />
        <i />
        <i />
      </span>
      <div>
        <strong>{player.djEnabled ? state.label || "Ready when you are" : "DJ transition is off"}</strong>
        <AnimatePresence initial={false}>
          {busy && state.entryAt > 0.5 && (
            <Motion.p key="entry" {...unfold} className="dj-entry">Next song enters at {formatTime(state.entryAt)}</Motion.p>
          )}
        </AnimatePresence>
        <p>
          {state.fromBpm && state.toBpm
            ? `${Math.round(state.fromBpm)} → ${Math.round(state.toBpm)} BPM · tempo glide`
            : player.track?.localUrl
              ? "Local audio · tempo glide, warm bass swap and echo"
              : "Online playback · two-deck volume blend"}
        </p>
        <AnimatePresence initial={false}>
          {effects.length > 0 && (
            <Motion.span key="effects" {...unfold} className="dj-effects">
              {effects.map((effect) => (
                <em key={effect}>{effect}</em>
              ))}
            </Motion.span>
          )}
        </AnimatePresence>
        <span className="dj-progress" aria-hidden="true">
          <i style={{ transform: `scaleX(${busy ? progress : 0})` }} />
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const player = usePlayer();
  const reduce = useReducedMotion();
  // Cursor spotlight: a soft light follows a fine pointer across the card or row it
  // is over. One listener; only the hovered element repaints, and only while hovered.
  useEffect(() => {
    const move = (event) => {
      if (event.pointerType !== "mouse") return;
      const card = event.target.closest?.(".track-row, .album-card, .video-card, .artist-card, .mood-card");
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - box.left}px`);
      card.style.setProperty("--my", `${event.clientY - box.top}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
  // Which of the player's two layouts is on screen (phone below 761 px).
  const phoneLayout = useMediaQuery("(max-width: 760px)");
  const [notice, setNotice] = useState("");
  const nav = useNavigation({ onLeaveHint: useCallback(() => setNotice("Press back again to leave Aurora"), []) });
  const { page, immersive, sheet, collection } = nav.view;
  const setImmersive = (open) => (open ? nav.openPlayer() : nav.closePlayer());
  const setSheet = (next) => (next ? nav.openSheet(next) : nav.closeSheet());
  const [starterPicks, setStarterPicks] = useState([]);
  const [mood, setMood] = useState(null);
  const [moodResult, setMoodResult] = useState({ mood: null, tracks: [] });
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [forYouRows, setForYou] = useState([]);
  const [revealed, setRevealed] = useState(() => !shouldWelcome());
  const [listenerName, setListenerName] = useState(readName);
  const [motionArt, setMotionArt] = useState(() => {
    try {
      return localStorage.getItem("aurora-motion-art") === "true";
    } catch {
      return false;
    }
  });
  const reveal = useCallback(() => setRevealed(true), []);
  // Smooth wheel scrolling joins once the app is on screen.
  useEffect(() => { if (revealed) startSmoothScroll(); }, [revealed]);
  const [searchType, setSearchType] = useState("all");
  const [searchData, setSearchData] = useState(EMPTY_SEARCH);
  const results = searchData.songs;
  const [collectionState, setCollectionState] = useState({ key: "", data: null, error: "" });
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchRetry, setSearchRetry] = useState(0);
  const [recentSearches, setRecentSearches] = useState(() =>
    readSaved("aurora-searches", (item) => typeof item === "string"),
  );
  const [showLyrics, setShowLyrics] = useState(false);
  // The background: the artwork or the song's video. A remembered choice that
  // only swaps what is behind the player; device audio has no video, so it
  // shows its artwork.
  const [videoChoice, setVideo] = useState(false);
  const video = videoChoice && !player.track?.localUrl;
  // Lyrics focus: only the cover, the song's name and its lyrics stay on screen.
  const [focusMode, setFocusMode] = useState(false);
  const ambientVideo = motionArt && !video && immersive && !!player.track && !player.track.localUrl;
  const sheetParent = nav.view.sheetDepth > 1 ? "settings" : null;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [favorites, setFavorites] = useState(() =>
    readSaved("aurora-favorites"),
  );
  const [recent, setRecent] = useState(() => readSaved("aurora-recent"));
  const [color, setColor] = useState("153, 93, 62");
  const [featureIndex, setFeatureIndex] = useState(0);
  const carouselSwiped = useRef(false);
  const searchRef = useRef(null);
  // The search page animates in after the previous page leaves, so focus is
  // requested here and applied when the field actually mounts.
  const focusSearchOnMount = useRef(false);
  const focusSearch = () => {
    if (searchRef.current) searchRef.current.focus();
    else focusSearchOnMount.current = true;
  };
  const fileRef = useRef(null);
  const currentFavorite = favorites.some((t) => t.id === player.track?.id);

  useEffect(() => {
    const controller = new AbortController();
    getFeaturedTracks(controller.signal)
      .then(setStarterPicks)
      .catch((e) => {
        if (e.name !== "AbortError")
          setCatalogError(
            "The music catalogue is taking a moment. Try searching for an artist.",
          );
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setSearchData(EMPTY_SEARCH);
        setSearching(false);
        setSearchError("");
        return;
      }
      setSearching(true);
      setSearchError("");
      searchCatalog(query, searchType, controller.signal)
        .then((data) => setSearchData({ ...data, songs: uniqueTracks(data.songs), videos: uniqueTracks(data.videos) }))
        .catch((e) => {
          if (e.name !== "AbortError")
            setSearchError("Search couldn’t connect. Please try again.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 260);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchRetry, searchType]);
  // Spotlight: a soft light follows a fine pointer across cards (one delegated,
  // frame-throttled listener that only writes two custom properties).
  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    let latest = null;
    const paint = () => {
      frame = 0;
      const target = latest?.target?.closest?.(".spotlight");
      if (!target) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty("--spot-x", `${latest.clientX - box.left}px`);
      target.style.setProperty("--spot-y", `${latest.clientY - box.top}px`);
    };
    const move = (event) => {
      latest = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => {
      document.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, []);
  // Mood songs follow the language of the lyrics playing now, when it is known.
  const listeningLang = useMemo(() => detectLanguage((player.lyrics?.lines || []).map((line) => line.text).join(" "))?.lang || null, [player.lyrics]);
  useEffect(() => {
    if (!mood) return;
    const controller = new AbortController();
    getMoodTracks(mood, controller.signal, { lang: listeningLang })
      .then((tracks) => setMoodResult({ mood, tracks }))
      .catch((error) => {
        if (error.name === "AbortError") return;
        setMoodResult({ mood, tracks: [] });
        setNotice("That mood is unavailable right now.");
      });
    return () => controller.abort();
  }, [mood, listeningLang]);
  // Each screen starts at its top: a page never inherits scroll, and the player opens
  // at its top and gives the page back where it was. The position is tracked from
  // scroll events, so opening and closing force no layout when nothing is scrolled.
  const scrollY = useRef(0);
  const pageScroll = useRef(0);
  useEffect(() => {
    const track = () => { scrollY.current = window.scrollY; };
    window.addEventListener("scroll", track, { passive: true });
    return () => window.removeEventListener("scroll", track);
  }, []);
  useEffect(() => {
    pageScroll.current = 0;
    if (scrollY.current) jumpTo(0);
  }, [page, collection]);
  useEffect(() => {
    if (immersive) {
      pageScroll.current = scrollY.current;
      if (scrollY.current) jumpTo(0);
      return undefined;
    }
    const back = pageScroll.current;
    if (!back) return undefined;
    const frame = requestAnimationFrame(() => jumpTo(back));
    return () => cancelAnimationFrame(frame);
  }, [immersive]);
  // Home adapts to what this listener plays, finishes and likes (all on-device).
  // Seeds come from listening history, then liked and recently played songs.
  const tasteList = useMemo(() => [...favorites, ...recent], [favorites, recent]);
  // The song playing now (or last played) leads: "More like …" is the first row.
  const nowSeed = player.track && !player.track.localUrl ? player.track : null;
  const homeSeedList = useMemo(() => {
    const seeds = homeSeeds(3, tasteList);
    return nowSeed ? [nowSeed, ...seeds.filter((seed) => seed.id !== nowSeed.id && seed.artist !== nowSeed.artist)].slice(0, 3) : seeds;
  }, [tasteList, nowSeed]);
  const seedKey = useMemo(() => homeSeedList.map((seed) => seed.id).join("|"), [homeSeedList]);
  const rowCache = useRef(new Map());
  useEffect(() => {
    if (page !== "home") return;
    const seeds = homeSeedList;
    if (!seeds.length) return;
    const controller = new AbortController();
    Promise.allSettled(
      seeds.map((seed) => {
        const cached = rowCache.current.get(seed.id);
        if (cached) return Promise.resolve({ seed, tracks: tasteFilter(cached) });
        return getSimilarTracks(seed, controller.signal).then((tracks) => {
          rowCache.current.set(seed.id, tracks);
          return { seed, tracks: tasteFilter(tracks) };
        });
      }),
    ).then((rows) => {
      if (!controller.signal.aborted) setForYou(rows.filter((row) => row.status === "fulfilled" && row.value.tracks.length >= 3).map((row) => ({ ...row.value, tracks: row.value.tracks.slice(0, 12) })));
    });
    return () => controller.abort();
  }, [page, seedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Rows only exist while there is something to seed them.
  const forYou = useMemo(() => (seedKey ? forYouRows : []), [seedKey, forYouRows]);
  // One interleaved mix across the listener's seeds: the spotlight and "Made for you".
  const personalMix = useMemo(() => {
    const seen = new Set();
    const mix = [];
    for (let i = 0; i < 10; i++)
      for (const row of forYou) {
        const track = row.tracks[i];
        if (track && !seen.has(track.id)) {
          seen.add(track.id);
          mix.push(track);
        }
      }
    // A fresh starting point each day, stable within the day.
    return rotateForDay(mix);
  }, [forYou]);
  // Songs this listener keeps finishing, and the artists they come back to.
  const repeatSongs = useMemo(() => onRepeat(10), [recent, player.track?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const yourArtists = useMemo(() => {
    const seen = new Set();
    return homeSeeds(8, tasteList).filter((track) => {
      const key = track.artist?.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [tasteList]);
  const personalized = personalMix.length >= 5;
  const headline = personalized ? `Your frequency, ${daypart() === "night" || daypart() === "evening" ? "tonight" : "today"}` : "Find your frequency";
  // Mood chips: one mood at a time re-shapes the suggestions; choosing it again clears it.
  const activeMood = MOODS.find((item) => item.id === mood) || null;
  const moodTracks = useMemo(() => (mood && moodResult.mood === mood ? tasteFilter(moodResult.tracks) : []), [mood, moodResult]);
  const moodLoading = Boolean(mood) && moodResult.mood !== mood;
  const moodMode = Boolean(activeMood) && moodTracks.length >= 5;
  const featured = moodMode ? moodTracks.slice(0, 6) : personalized ? personalMix.slice(0, 6) : starterPicks;
  const heroTrack =
    (immersive ? player.track : null) || featured[featureIndex] || featured[0];
  // A full grid or none of the leftovers: a short mix reuses the spotlight picks.
  const madeForYou = moodMode
    ? moodTracks.slice(6, 12).length >= 4 ? moodTracks.slice(6, 12) : moodTracks.slice(0, 6)
    : personalized && personalMix.length >= 10 ? personalMix.slice(6, 12) : featured.slice(0, 6);
  const moreForMood = moodMode ? moodTracks.slice(12, 24) : [];
  const favouriteArtists = forYou.map((row) => row.seed.artist).filter((name, i, all) => all.indexOf(name) === i);
  // Albums, artists and playlists open as pages with their own history entry.
  const collectionKey = collection ? `${collection.type}:${collection.id}` : "";
  useEffect(() => {
    if (!collection) return;
    const controller = new AbortController();
    const key = `${collection.type}:${collection.id}`;
    getCollection(collection.type, collection.id, controller.signal)
      .then((data) => setCollectionState({ key, data, error: "" }))
      .catch((e) => {
        if (e.name !== "AbortError") setCollectionState({ key, data: null, error: e.message });
      });
    return () => controller.abort();
  }, [collection]);
  useEffect(() => {
    let live = true;
    if (heroTrack?.artwork)
      extractColors(heroTrack.artwork).then((colors) => {
        if (live && colors?.[0]) setColor(colors[0]);
      });
    return () => {
      live = false;
    };
  }, [heroTrack?.artwork]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    document.title = player.track
      ? `${player.track.title} · Aurora`
      : "Aurora — Your music, closer";
  }, [player.track]);

  const persist = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      setNotice("Storage is full. Changes will last for this session.");
    }
  };
  const rememberSearch = () => {
    const term = query.trim();
    if (page !== "search" || term.length < 2) return;
    const updated = [term, ...recentSearches.filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 8);
    setRecentSearches(updated);
    persist("aurora-searches", updated);
  };
  // Starting a new song keeps songs the listener queued by hand; radio picks made
  // for the previous song are replaced by fresh ones for this one.
  const play = (selected, list) => {
    rememberSearch();
    // Altered versions (8D, slowed…) only when the listener searched for one.
    const variant = page === "search" ? requestedVariant(query) : "";
    const track =
      variant && !requestedVariant(selected.title) && !selected.variant
        ? { ...selected, id: `${selected.id}~${variant}`, variant }
        : selected;
    player.loadTrack(
      track,
      list ?? [
        track,
        ...player.queue
          .slice(player.queueIndex + 1)
          .filter((item) => !item.recommended && item.id !== track.id),
      ],
    );
    const updated = [track, ...recent.filter((t) => t.id !== track.id)].slice(
      0,
      30,
    );
    setRecent(updated);
    persist(
      "aurora-recent",
      updated.filter((t) => !t.localUrl),
    );
    setImmersive(true);
  };
  const toggleFavorite = (track) => {
    if (!track) return;
    const exists = favorites.some((t) => t.id === track.id);
    if (!exists) recordLike(track);
    const updated = exists
      ? favorites.filter((t) => t.id !== track.id)
      : [track, ...favorites];
    setFavorites(updated);
    persist(
      "aurora-favorites",
      updated.filter((t) => !t.localUrl),
    );
    setNotice(
      exists ? "Removed from your favorites" : "Saved to your favorites",
    );
  };
  const navigate = (next) => {
    nav.goPage(next);
    if (next === "search") focusSearch();
  };
  // Hover (after a short rest) or touch warms a song's source, so play starts sooner.
  const intentTimer = useRef(0);
  const intent = (track) => ({
    onPointerEnter: (event) => {
      if (event.pointerType !== "mouse") return;
      clearTimeout(intentTimer.current);
      intentTimer.current = setTimeout(() => player.warm(track), 150);
    },
    onPointerLeave: () => clearTimeout(intentTimer.current),
    onTouchStart: () => player.warm(track),
  });
  const mutedVolume = useRef(80);
  const swiped = useRef(false);
  const toggleMute = () => {
    if (player.volume > 0) {
      mutedVolume.current = player.volume;
      player.setVolume(0);
      setNotice("Muted");
    } else player.setVolume(mutedVolume.current || 80);
  };
  // Leaving the player also leaves focus, so it never reopens in it.
  if (focusMode && !immersive) setFocusMode(false);
  const focused = focusMode && immersive && !!player.track;
  const toggleFocus = () => {
    if (focused) return setFocusMode(false);
    setShowLyrics(true);
    setImmersive(true);
    setFocusMode(true);
  };
  // Always reads the latest player and handlers without re-binding the listener.
  const onShortcut = useEffectEvent((e) => {
    if (!player.track && e.key !== "/") return;
    const handled = {
      " ": () => player.togglePlay(),
      ArrowRight: () => (e.shiftKey ? player.next() : player.seek(player.getPlaybackTime() + 5)),
      ArrowLeft: () => (e.shiftKey ? player.previous() : player.seek(Math.max(0, player.getPlaybackTime() - 5))),
      m: () => toggleMute(),
      l: () => { setShowLyrics((value) => !value); setImmersive(true); },
      f: () => toggleFavorite(player.track),
      i: () => toggleFocus(),
      "/": () => navigate("search"),
    }[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!handled) return;
    e.preventDefault();
    handled();
  });
  const onKey = useEffectEvent((e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        navigate("search");
        focusSearch();
      }
      // Escape steps back one level: out of lyrics focus first, then the player.
      if (e.key === "Escape" && !sheet && !e.target.closest?.("input, textarea, select")) {
        if (focused) setFocusMode(false);
        else setImmersive(false);
      }
      // Media shortcuts never steal keys from fields, controls or open dialogs.
      // Fields keep every key; sliders keep their arrows; buttons keep Space.
      if (sheet || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('textarea, select, [contenteditable], input:not([type="range"])')) return;
      // The timeline's native arrow step is 0.1 s; ← → always jump 5 s instead.
      // Other sliders (volume) keep their own arrows.
      const onTimeline = e.target.matches?.('input[aria-label="Seek in track"]') && (e.key === "ArrowLeft" || e.key === "ArrowRight");
      if (!onTimeline && e.target.matches?.('input[type="range"]') && /^(Arrow|Home|End|Page)/.test(e.key)) return;
      if (e.key === " " && e.target.closest?.("button, a")) return;
      onShortcut(e);
  });
  useEffect(() => {
    const key = (e) => onKey(e);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const addQueue = (track) => {
    rememberSearch();
    player.addToQueue(track);
    setNotice("Added to your queue");
  };
  const playNext = (track) => {
    rememberSearch();
    player.playNext(track);
    setNotice("Plays next");
  };
  // In the queue, rows render a slice of it: `offset` is the slice's start in the
  // full queue, so removing or playing a row always acts on the whole queue.
  const trackRows = (tracks, queueMode = false, context, offset = 0) => {
    const occurrences = new Map();
    const rows = tracks.map((track, i) => {
      const occurrence = occurrences.get(track.id) || 0;
      occurrences.set(track.id, occurrence + 1);
      const selected = player.track?.id === track.id;
      return (
        <Motion.div
          layout={queueMode ? "position" : false}
          {...listItem(i)}
          // Queue rows: swipe left to remove. A swipe never counts as a tap.
          drag={queueMode ? "x" : false}
          dragDirectionLock
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={{ left: 0.55, right: 0.04 }}
          onDragStart={() => { swiped.current = true; }}
          onDragEnd={(_, info) => {
            if (info.offset.x < -110 || info.velocity.x < -700)
              player.setQueue(player.queue.filter((_, index) => index !== i + offset));
            setTimeout(() => { swiped.current = false; }, 0);
          }}
          className={`track-row ${selected ? "selected" : ""} ${player.unavailable?.has(track.id) ? "is-unavailable" : ""}`}
          title={player.unavailable?.has(track.id) ? "Not available to play here" : undefined}
          key={`${track.id}#${occurrence}`}
        >
          <button
            {...intent(track)}
            className="track-main"
            onClick={() => {
              if (swiped.current) return;
              play(track, queueMode ? player.queue : context);
            }}
          >
            <span className="track-number">
              <AnimatePresence initial={false} mode="popLayout">
                {selected && player.playing ? (
                  <Motion.span key="playing" {...glyphSwap} className="equalizer">
                    <i />
                    <i />
                    <i />
                  </Motion.span>
                ) : (
                  <Motion.span key="number" {...glyphSwap}>{String(i + 1).padStart(2, "0")}</Motion.span>
                )}
              </AnimatePresence>
            </span>
            <Cover track={track} />
            <span className="track-description">
              <strong>{track.title}</strong>
              <span>{track.artist}</span>
              {queueMode && track.recommended && (
                <small className="recommendation-reason">
                  {track.recommendationReason || "Picked for this session"}
                </small>
              )}
            </span>
          </button>
          <span className="row-duration">{formatTime(track.duration)}</span>
          <IconButton
            label={
              queueMode
                ? `Remove ${track.title} from queue`
                : `Add ${track.title} to queue`
            }
            onClick={() =>
              queueMode
                ? player.setQueue(
                    player.queue.filter((_, index) => index !== i + offset),
                  )
                : addQueue(track)
            }
          >
            {queueMode ? <X size={18} /> : <Plus size={18} />}
          </IconButton>
        </Motion.div>
      );
    });
    return (
      <div className="track-list">
        {queueMode ? (
          <AnimatePresence initial={false} mode="popLayout">
            {rows}
          </AnimatePresence>
        ) : (
          rows
        )}
      </div>
    );
  };
  const currentPosition = featured.findIndex((t) => t.id === heroTrack?.id);
  const carouselIndex = currentPosition >= 0 ? currentPosition : featureIndex;
  const carousel = featured.length
    ? [-2, -1, 0, 1, 2].map((offset) => ({
        track:
          featured[
            (carouselIndex + offset + featured.length) % featured.length
          ],
        offset,
      }))
    : [];

  // ── Search, library and collection pages ────────────────────────────────
  const openCollection = (type, item) =>
    nav.goPage("collection", { type, id: String(item.id), title: item.title || item.name || "", artwork: item.artwork || "", subtitle: item.artist || item.owner || "" });
  const categoryItems = {
    songs: searchData.songs,
    videos: searchData.videos,
    albums: searchData.albums,
    artists: searchData.artists,
    playlists: searchData.playlists,
  };
  const top = searchData.top;
  const topItem =
    top?.kind === "artist"
      ? searchData.artists.find((item) => item.id === top.id)
      : top?.kind === "video"
        ? searchData.videos.find((item) => item.videoId === top.id)
        : top?.kind === "song"
          ? searchData.songs.find((item) => item.id === String(top.id))
          : searchData.songs[0] || searchData.videos[0];
  const topKind = topItem ? (top?.kind === "artist" ? "artist" : topItem.source === "video" ? "video" : "song") : null;
  const activateTop = () => {
    if (!topItem) return;
    if (topKind === "artist") openCollection("artist", topItem);
    else play(topItem, topKind === "video" ? searchData.videos : undefined);
  };
  const hasResults = searchType === "all" ? Object.values(categoryItems).some((items) => items.length) : categoryItems[searchType].length > 0;
  const sectionHead = (title, kind, hint) => (
    <div className="results-heading">
      <h2>
        {title}
        {hint && <small>{hint}</small>}
      </h2>
      {searchType === "all" && kind && categoryItems[kind].length > 4 && (
        <Motion.button {...pop} className="text-button" onClick={() => setSearchType(kind)}>
          See all <ArrowRight size={15} />
        </Motion.button>
      )}
    </div>
  );
  const videoCard = (track, i, list) => (
    <Motion.button key={track.id} {...listItem(i)} className="video-card" onClick={() => play(track, list)} aria-label={`Play ${track.title} by ${track.artist}`}>
      <span className="video-thumb">
        {track.artwork ? <img src={track.artwork} alt="" loading="lazy" decoding="async" /> : <Video aria-hidden="true" />}
        <em>{formatTime(track.duration)}</em>
        <span className="video-play" aria-hidden="true">
          <Play size={18} fill="currentColor" />
        </span>
      </span>
      <strong>{track.title}</strong>
      <small>
        {track.artist}
        {track.views ? ` · ${track.views.replace(/ views?$/i, "")} views` : ""}
      </small>
    </Motion.button>
  );
  const collectionCard = (type) => (item, i) => (
    <Motion.button key={`${type}-${item.id}`} {...listItem(i)} className="collection-card" onClick={() => openCollection(type, item)} aria-label={`Open ${item.title}`}>
      <span className="collection-cover">
        {item.artwork ? <img src={type === "album" ? artworkAt(item.artwork, 320) : item.artwork} alt="" loading="lazy" decoding="async" /> : <Disc3 aria-hidden="true" />}
        {type === "playlist" && item.count > 0 && <em>{item.count}</em>}
      </span>
      <strong>{item.title}</strong>
      <small>{type === "album" ? [item.artist, item.year].filter(Boolean).join(" · ") : item.owner || "Playlist"}</small>
    </Motion.button>
  );
  const artistCard = (item, i) => (
    <Motion.button key={`artist-${item.id}`} {...listItem(i)} className="artist-card" onClick={() => openCollection("artist", item)} aria-label={`Open ${item.name}`}>
      <span className="artist-avatar">{item.artwork ? <img src={item.artwork} alt="" loading="lazy" decoding="async" /> : <UserRound aria-hidden="true" />}</span>
      <strong>{item.name}</strong>
      <small>{item.fans ? `${formatCount(item.fans)} fans` : "Artist"}</small>
    </Motion.button>
  );
  const topResultCard = () => (
    <div className={`top-result ${topKind}`}>
      {topKind === "artist" ? (
        <span className="artist-avatar large">{topItem.artwork ? <img src={topItem.artwork} alt="" /> : <UserRound aria-hidden="true" />}</span>
      ) : topKind === "video" ? (
        <span className="video-thumb large">
          <img src={topItem.artwork} alt="" />
        </span>
      ) : (
        <FadingCover track={topItem} eager />
      )}
      <div>
        <span className="feature-label">
          <span /> Top result · {topKind === "artist" ? "Artist" : topKind === "video" ? "Video" : "Song"}
        </span>
        <FluidText as="h2">{topKind === "artist" ? topItem.name : topItem.title}</FluidText>
        <p>
          {topKind === "artist"
            ? `${formatCount(topItem.fans)} fans`
            : `${topItem.artist}${topItem.album ? ` · ${topItem.album}` : ""}`}
        </p>
        <div className="top-result-actions">
          <button className="primary-button top-result-play" onClick={activateTop}>
            {topKind === "artist" ? <UserRound size={16} /> : <Play size={16} fill="currentColor" />}
            {topKind === "artist" ? "Open artist" : "Play"}
          </button>
          {topKind !== "artist" && (
            <button className="small-pill" onClick={() => playNext(topItem)} disabled={!player.track}>
              <ListMusic size={15} />
              Play next
            </button>
          )}
        </div>
      </div>
    </div>
  );
  const renderCategory = (kind, limit = Infinity) => {
    const items = categoryItems[kind].slice(0, limit);
    if (!items.length) return null;
    if (kind === "songs") return trackRows(items, false, undefined);
    if (kind === "videos") return <div className="media-grid video-grid">{items.map((track, i) => videoCard(track, i, categoryItems.videos))}</div>;
    if (kind === "artists") return <div className="artist-row">{items.map(artistCard)}</div>;
    return <div className="media-grid">{items.map(collectionCard(kind === "albums" ? "album" : "playlist"))}</div>;
  };
  const renderSearch = () => (
    <>
      <div className="page-heading">
        <div>
          <p>There’s a song for that.</p>
          <h1>
            What’s on your mind?<span>.</span>
          </h1>
        </div>
      </div>
        <Motion.label variants={sectionMotion} className={`search-field ${searching ? "is-searching" : ""}`}>
          <Search size={22} />
          <input
            ref={(node) => {
              searchRef.current = node;
              if (node && focusSearchOnMount.current) {
                focusSearchOnMount.current = false;
                node.focus({ preventScroll: true });
              }
            }}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Search songs or artists"
            placeholder="Search songs, artists, a feeling…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && topItem) {
                e.preventDefault();
                activateTop();
              } else if (e.key === "Escape") {
                e.preventDefault();
                if (query) setQuery("");
                else e.currentTarget.blur();
              } else if (e.key === "ArrowDown" && results.length) {
                e.preventDefault();
                document.querySelector(".search-results .track-main, .top-result-play")?.focus();
              }
            }}
          />
          <AnimatePresence>
            {query && (
              <Motion.span
                key="clear"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                <IconButton
                  label="Clear search"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  <X size={18} />
                </IconButton>
              </Motion.span>
            )}
          </AnimatePresence>
          <span className="search-progress" aria-hidden="true" />
        </Motion.label>
      <AnimatePresence initial={false}>
      {query.trim().length >= 2 && (
        <Motion.div
          key="tabs"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.2, ease: EASE_EXIT } }}
          className="search-tabs"
          role="tablist"
          aria-label="Search categories"
        >
          {SEARCH_TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={searchType === id} className={searchType === id ? "selected" : ""} onClick={() => setSearchType(id)}>
              {searchType === id && <Motion.span layoutId="search-tab" className="nav-pill" transition={PILL_SPRING} />}
              {label}
            </button>
          ))}
        </Motion.div>
      )}
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        {searching && !hasResults ? (
          <Motion.div key="skeleton" className="search-skeleton" role="status" aria-label="Searching the catalogue" {...fade}>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} style={{ "--i": i }}>
                <i />
                <b />
              </span>
            ))}
          </Motion.div>
        ) : searchError ? (
          <Motion.div key="error" className="empty-state" role="alert" {...fade}>
            <p>{searchError}</p>
            <button className="small-pill" onClick={() => setSearchRetry((value) => value + 1)}>
              Try again
            </button>
          </Motion.div>
        ) : query.trim().length >= 2 && hasResults ? (
          <Motion.div key={`results-${searchType}`} className={`search-results ${searching ? "is-refreshing" : ""}`} {...fade}>
            {searchType === "all" ? (
              <>
                {topItem && topResultCard()}
                {searchData.songs.length > 0 && (
                  <section className="result-section">
                    {sectionHead("Songs", "songs")}
                    {renderCategory("songs", 5)}
                  </section>
                )}
                {searchData.videos.length > 0 && (
                  <section className="result-section">
                    {sectionHead("Videos", "videos", "Remixes, edits and live")}
                    {renderCategory("videos", 6)}
                  </section>
                )}
                {searchData.artists.length > 0 && (
                  <section className="result-section">
                    {sectionHead("Artists", "artists")}
                    {renderCategory("artists", 6)}
                  </section>
                )}
                {searchData.albums.length > 0 && (
                  <section className="result-section">
                    {sectionHead("Albums", "albums")}
                    {renderCategory("albums", 6)}
                  </section>
                )}
                {searchData.playlists.length > 0 && (
                  <section className="result-section">
                    {sectionHead("Playlists", "playlists")}
                    {renderCategory("playlists", 6)}
                  </section>
                )}
              </>
            ) : (
              <section className="result-section">
                {sectionHead(SEARCH_TABS.find(([id]) => id === searchType)[1], null, `${categoryItems[searchType].length} results`)}
                {renderCategory(searchType)}
              </section>
            )}
          </Motion.div>
        ) : (
          <Motion.div key={`empty-${query.trim().length > 1}`} className="empty-state" {...fade}>
            <Search size={38} />
            <h2>{query.trim().length > 1 ? "Nothing here just yet." : "Follow your curiosity."}</h2>
            <p>{query.trim().length > 1 ? "Try another title, an artist, or a different category." : "Songs, remixes, slowed edits, albums, artists and playlists."}</p>
            {query.trim().length < 2 && (
              <div className="search-suggestions">
                {recentSearches.length > 0 && (
                  <div className="chip-group" aria-label="Recent searches">
                    <span>Recent</span>
                    {recentSearches.map((term) => (
                      <button key={term} className="chip" onClick={() => setQuery(term)}>
                        {term}
                      </button>
                    ))}
                    <button
                      className="chip chip-quiet"
                      onClick={() => {
                        setRecentSearches([]);
                        persist("aurora-searches", []);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                )}
                <div className="chip-group" aria-label="Search ideas">
                  <span>Try</span>
                  {SEARCH_IDEAS.map((term) => (
                    <button key={term} className="chip" onClick={() => setQuery(term)}>
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Motion.div>
        )}
      </AnimatePresence>
    </>
  );
  const renderLibrary = () => (
    <>
      <div className="page-heading">
        <div>
          <p>The music you keep close.</p>
          <h1>
            Your library<span>.</span>
          </h1>
        </div>
        <Heart size={32} />
      </div>
      {favorites.length ? (
        <div className="search-results">
          <div className="results-heading">
            <h2>Liked songs</h2>
            <span>{favorites.length} tracks</span>
          </div>
          {trackRows(favorites, false, favorites)}
        </div>
      ) : (
        <div className="empty-state">
          <Heart size={38} />
          <h2>Keep the ones you love.</h2>
          <p>Tap the heart on any playing track. Your favorites stay on this device.</p>
          <button className="primary-button" onClick={() => navigate("search")}>
            Find a song <ArrowRight size={16} />
          </button>
        </div>
      )}
      {recent.length > 0 && (
        <section className="result-section">
          <div className="results-heading">
            <h2>Recently played</h2>
            <span>{recent.length} tracks</span>
          </div>
          {trackRows(recent.slice(0, 12), false, recent.slice(0, 12))}
        </section>
      )}
    </>
  );
  const renderCollection = () => {
    const ready = collectionState.key === collectionKey ? collectionState : { data: null, error: "" };
    const tracks = ready.data?.tracks || [];
    const title = ready.data?.title || collection?.title || "";
    const artwork = ready.data?.artwork || collection?.artwork || "";
    const typeLabel = { album: "Album", artist: "Artist", playlist: "Playlist" }[collection?.type] || "Collection";
    return (
      <>
        <div className={`collection-head ${collection?.type}`}>
          <IconButton label="Back" className="collection-back" onClick={() => window.history.back()}>
            <ArrowLeft />
          </IconButton>
          <span className={collection?.type === "artist" ? "artist-avatar large" : "collection-cover large"}>
            {artwork ? <img src={collection?.type === "album" ? artworkAt(artwork, 600) : artwork} alt="" /> : <Disc3 aria-hidden="true" />}
          </span>
          <div>
            <span className="feature-label">
              <span /> {typeLabel}
            </span>
            <FluidText as="h1">{title}</FluidText>
            <p>{ready.data?.subtitle || collection?.subtitle}</p>
            <div className="top-result-actions">
              <button className="primary-button" disabled={!tracks.length} onClick={() => play(tracks[0], tracks)}>
                <Play size={16} fill="currentColor" />
                Play
              </button>
              <button
                className="small-pill"
                disabled={tracks.length < 2}
                onClick={() => {
                  const shuffled = [...tracks].sort(() => Math.random() - 0.5);
                  play(shuffled[0], shuffled);
                }}
              >
                <Shuffle size={15} />
                Shuffle
              </button>
            </div>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {ready.error ? (
            <Motion.div key="error" className="empty-state" role="alert" {...fade}>
              <p>{ready.error}</p>
              <button className="small-pill" onClick={() => nav.goPage("collection", { ...collection })}>
                Try again
              </button>
            </Motion.div>
          ) : !ready.data ? (
            <Motion.div key="loading" className="search-skeleton" role="status" aria-label="Opening" {...fade}>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} style={{ "--i": i }}>
                  <i />
                  <b />
                </span>
              ))}
            </Motion.div>
          ) : (
            <Motion.div key="tracks" className="search-results" {...fade}>
              <div className="results-heading">
                <h2>{collection?.type === "artist" ? "Top songs" : "Songs"}</h2>
                <span>{tracks.length} tracks</span>
              </div>
              {trackRows(tracks, false, tracks)}
            </Motion.div>
          )}
        </AnimatePresence>
      </>
    );
  };

  return (
    <MotionConfig reducedMotion="user">
      <Welcome onLeave={reveal} />
      <div
        className={`aurora-app ${revealed ? "" : "is-veiled"} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${immersive ? "is-immersive" : ""} ${video && immersive ? "has-video" : ""} ${video && showLyrics ? "video-with-lyrics" : ""} ${ambientVideo ? "motion-art" : ""} ${focused ? "is-focus" : ""}`}
        style={{ "--art-color": color }}
      >
        <div
          aria-hidden="true"
          className={`video-surface ${(video || ambientVideo) && immersive ? "is-visible" : ""}`}
        >
          <div id="youtube-player" />
        </div>
        <aside className="sidebar">
          <IconButton
            className="sidebar-toggle"
            label={sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <ListMusic size={18} />
          </IconButton>
          <button
            className="brand-button"
            onClick={() => navigate("home")}
            aria-label="Aurora home"
          >
            <Brand />
          </button>
          <nav aria-label="Main navigation">
            {[
              ["home", House, "Listen now"],
              ["search", Search, "Search"],
              ["library", Library, "Your library"],
            ].map(([id, Icon, label]) => (
              <button
                key={id}
                aria-label={label}
                title={label}
                className={page === id && !immersive ? "selected" : ""}
                onClick={() => navigate(id)}
              >
                {/* Stays mounted while the player is open (hidden by CSS): opening the
                    player then never triggers a shared-layout measurement. */}
                {page === id && (
                  <Motion.span layoutId="sidebar-pill" className="nav-pill" transition={PILL_SPRING} />
                )}
                <Icon size={21} />
                <span>{label}</span>
                {id === "search" && <kbd>⌘ K</kbd>}
              </button>
            ))}
          </nav>
          <div className="sidebar-divider" />
          <span className="sidebar-label">Your collection</span>
          <button
            className="collection-link"
            aria-label="Liked songs"
            onClick={() => navigate("library")}
          >
            <span className="favorite-tile">
              <Heart fill="currentColor" size={18} />
            </span>
            <span>
              Liked songs<small>{favorites.length} tracks</small>
            </span>
          </button>
          <button
            className="collection-link"
            aria-label="Play queue"
            onClick={() => {
              setSheet("queue");
            }}
          >
            <span className="queue-tile">
              <ListMusic size={19} />
            </span>
            <span>
              Play queue<small>{player.queue?.length || 0} tracks</small>
            </span>
          </button>
          <div className="sidebar-bottom">
            <button
              aria-label="Open audio file"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={18} />
              <span>Open audio file</span>
            </button>
            <button
              aria-label="Preferences"
              onClick={() => setSheet("settings")}
            >
              <SlidersHorizontal size={18} />
              <span>Preferences</span>
            </button>
            <span>Just you and the music.</span>
          </div>
        </aside>
        <Motion.main
          layout="position"
          layoutDependency={`${sidebarCollapsed}:${focused}`}
          transition={{ layout: { duration: 0.6, ease: EASE } }}
          className="main-content"
        >
          <AnimatePresence mode="wait" initial={false}>
          {!(immersive && player.track) ? (
            <Motion.div
              key="browse"
              className="browse-shell"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } }}
              exit={{ opacity: 0, y: -12, transition: { duration: 0.3, ease: EASE_EXIT } }}
            >
              <header className="topbar">
                <span className="mobile-brand">
                  <Brand />
                </span>
                <div className="breadcrumb">
                  Your space <ChevronRight size={14} />{" "}
                  <span>
                    {page === "home"
                      ? "Listen now"
                      : page === "search"
                        ? "Search"
                        : page === "collection"
                          ? collection?.title || "Collection"
                          : "Your library"}
                  </span>
                </div>
                <div className="topbar-right">
                  <span className="local-label">
                    <span />
                    No account needed
                  </span>
                  <IconButton
                    label="Preferences"
                    onClick={() => setSheet("settings")}
                  >
                    <Settings2 size={19} />
                  </IconButton>
                </div>
              </header>
              <AnimatePresence mode="wait" initial={false}>
              {page === "home" ? (
                <Motion.div
                  key="home"
                  variants={pageMotion}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="browse-content"
                >
                  <div className="page-heading">
                    <div>
                      <p>{greeting(listenerName.trim())} {personalized ? "Here’s what your ears have been asking for." : "A little less noise, a little more music."}</p>
                      <h1 aria-label={`${headline}.`}>
                        <RevealWords text={headline} />
                        <span aria-hidden="true">.</span>
                      </h1>
                    </div>
                    <button
                      className="round-search"
                      aria-label="Search music"
                      onClick={() => navigate("search")}
                    >
                      <Search />
                    </button>
                  </div>
                  <div className="mood-chips" role="group" aria-label="Moods">
                    {MOODS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`mood-chip ${mood === item.id ? "selected" : ""}`}
                        aria-pressed={mood === item.id}
                        onClick={() => setMood((value) => (value === item.id ? null : item.id))}
                      >
                        {mood === item.id && <Motion.span layoutId="mood-pill" className="nav-pill" transition={PILL_SPRING} />}
                        {item.label}
                        {mood === item.id && moodLoading && <Waveform />}
                      </button>
                    ))}
                  </div>
                  <Motion.section
                    variants={sectionMotion}
                    className="discovery-stage spotlight"
                    aria-label="Featured music"
                  >
                    <div className="stage-aura" />
                    {heroTrack ? (
                      <>
                        <div
                          className="stage-copy"
                          // A long single-word name scales down to stay on one line on phones.
                          style={{ "--title-fit": Math.min(1, Math.max(0.6, 10 / Math.max(1, ...String(heroTrack.artist || "").split(/\s+/).map((word) => word.length)))).toFixed(3) }}
                        >
                          <span className="feature-label">
                            <span /> {moodMode ? `${activeMood.label} · picked for you` : personalized ? "Picked for you" : "In the spotlight"}
                          </span>
                          <FluidText as="h2">{heroTrack.artist}</FluidText>
                          <FluidText as="p">{heroTrack.title}</FluidText>
                          <Magnetic>
                          <button
                            className="primary-button"
                            onClick={() => play(heroTrack)}
                          >
                            <Play size={16} fill="currentColor" />
                            Press play
                          </button>
                          </Magnetic>
                          <span className="stage-caption">
                            An entirely different kind of listening.
                          </span>
                        </div>
                        {/* Swipe sideways to browse (a long fling skips two); the tap
                            that ends a swipe never plays a song. */}
                        <Motion.div
                          className="cover-carousel"
                          drag={reduce ? false : "x"}
                          dragConstraints={{ left: 0, right: 0 }}
                          dragElastic={0.22}
                          dragDirectionLock
                          dragMomentum={false}
                          onDragStart={() => { carouselSwiped.current = true; }}
                          onDragEnd={(_, info) => {
                            const distance = info.offset.x, speed = info.velocity.x;
                            if (Math.abs(distance) > 46 || Math.abs(speed) > 420) {
                              const step = (Math.abs(distance) > 190 || Math.abs(speed) > 1500 ? 2 : 1) * (distance < 0 ? 1 : -1);
                              setFeatureIndex((carouselIndex + step + featured.length * 2) % featured.length);
                            }
                            setTimeout(() => { carouselSwiped.current = false; }, 0);
                          }}
                        >
                          {carousel.map(({ track, offset }) => (
                            <Motion.button
                              key={track.id}
                              initial={false}
                              animate={{
                                transform: `translate(${-50 + offset * (Math.abs(offset) === 2 ? 44.5 : 49)}%,-50%) scale(${offset === 0 ? 1 : Math.abs(offset) === 1 ? 0.83 : 0.69}) rotateY(${-Math.sign(offset) * (Math.abs(offset) === 2 ? 24 : offset === 0 ? 0 : 17)}deg)`,
                              }}
                              transition={
                                reduce
                                  ? { duration: 0 }
                                  : {
                                      type: "spring",
                                      stiffness: 230,
                                      damping: 29,
                                    }
                              }
                              className={`carousel-card offset-${offset < 0 ? `minus${Math.abs(offset)}` : offset}`}
                              style={{ "--offset": offset }}
                              onClick={() => {
                                if (carouselSwiped.current) return;
                                if (offset === 0) play(track);
                                else setFeatureIndex((carouselIndex + offset + featured.length) % featured.length);
                              }}
                              draggable={false}
                              aria-label={`${offset === 0 ? "Play" : "Discover"} ${track.title} by ${track.artist}`}
                            >
                              <Cover track={track} eager />
                              <span>
                                <strong>{track.artist}</strong>
                                <small>{track.title}</small>
                              </span>
                            </Motion.button>
                          ))}
                        </Motion.div>
                        <div className="stage-navigation">
                          <span>
                            {String(carouselIndex + 1).padStart(2, "0")}
                            <i />
                            {String(featured.length).padStart(2, "0")}
                          </span>
                          <IconButton
                            label="Previous featured track"
                            onClick={() =>
                              setFeatureIndex(
                                (carouselIndex - 1 + featured.length) %
                                  featured.length,
                              )
                            }
                          >
                            <ArrowLeft size={18} />
                          </IconButton>
                          <IconButton
                            label="Next featured track"
                            onClick={() =>
                              setFeatureIndex(
                                (carouselIndex + 1) % featured.length,
                              )
                            }
                          >
                            <ArrowRight size={18} />
                          </IconButton>
                        </div>
                      </>
                    ) : (
                      <div className="catalog-loading">
                        <Disc3 size={40} className="spin" />
                        <p>{catalogError || "Finding your next favorite…"}</p>
                        <button
                          className="text-button"
                          onClick={() => navigate("search")}
                        >
                          Search music <ArrowRight size={16} />
                        </button>
                      </div>
                    )}
                  </Motion.section>
                  <Motion.section variants={sectionMotion} className="mood-section" aria-label="Browse by mood">
                    {[
                      [
                        "Daily rotation",
                        "The tracks you come back to",
                        topArtists(2, tasteList).join(" ") || "The Weeknd Dua Lipa",
                        Disc3,
                      ],
                      daypart() === "morning"
                        ? ["Easy morning", "Soft starts and warm coffee", "acoustic morning", Headphones]
                        : ["After hours", "For the quieter side of you", "Joji Frank Ocean", Headphones],
                      [
                        "A little energy",
                        "Turn the everyday up",
                        "Daft Punk dance",
                        Shuffle,
                      ],
                    ].map(([title, subtitle, term, Icon], i) => (
                      <button
                        key={title}
                        className={`mood-card mood-${i} spotlight`}
                        onClick={() => {
                          setQuery(term);
                          navigate("search");
                        }}
                      >
                        <span className="mood-icon">
                          <Icon size={23} />
                        </span>
                        <span>
                          <strong>{title}</strong>
                          <small>{subtitle}</small>
                        </span>
                        <ArrowRight size={18} />
                      </button>
                    ))}
                  </Motion.section>
                  {!moodMode && forYou.map(({ seed, tracks }) => (
                    <RevealSection key={seed.id} className="music-section for-you">
                      <div className="section-heading">
                        <div>
                          <h2>{seed.id === nowSeed?.id ? `More like ${seed.title}` : `Because you listened to ${seed.title}`}</h2>
                          <p>{seed.id === nowSeed?.id ? `Same language and vibe as ${seed.artist}.` : "Picked on this device from what you finish and love."}</p>
                        </div>
                        <button className="text-button" onClick={() => play(tracks[0], tracks)}>
                          Play all <Play size={14} fill="currentColor" />
                        </button>
                      </div>
                      <div className="shelf">
                        {tracks.map((track, i) => (
                          <Motion.button key={track.id} variants={revealCard} className="album-card" {...intent(track)} onClick={() => play(track, tracks.slice(i))}>
                            <div className="album-image spotlight">
                              <Cover track={track} />
                              <span className="album-play">
                                <Play size={21} fill="currentColor" />
                              </span>
                            </div>
                            <strong>{track.title}</strong>
                            <span>{track.artist}</span>
                          </Motion.button>
                        ))}
                      </div>
                    </RevealSection>
                  ))}
                  <RevealSection className="music-section">
                    <div className="section-heading">
                      <div>
                        <h2>{moodMode ? activeMood.label : personalized ? "Made for you" : "Made for a good listen"}</h2>
                        <p>
                          {moodMode
                            ? "Chosen for the mood, ordered by what you love."
                            : personalized
                              ? `Shaped by what you play${favouriteArtists.length ? `, around ${favouriteArtists.slice(0, 2).join(" and ")}` : ""}.`
                              : "A few favorites to get you started."}
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("search")}
                      >
                        Explore music <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="album-grid">
                      {madeForYou.map((track) => (
                        <Motion.button
                          variants={revealCard}
                          className="album-card" {...intent(track)}
                          key={track.id}
                          onClick={() => play(track)}
                        >
                          <div className="album-image spotlight">
                            <Cover track={track} />
                            <span className="album-play">
                              <Play size={21} fill="currentColor" />
                            </span>
                          </div>
                          <strong>{track.title}</strong>
                          <span>{track.artist}</span>
                        </Motion.button>
                      ))}
                    </div>
                  </RevealSection>
                  {moreForMood.length >= 4 && (
                    <RevealSection key={`more-${mood}`} className="music-section mood-more">
                      <div className="section-heading">
                        <div>
                          <h2>More {activeMood.label.toLowerCase()}</h2>
                          <p>Keep the feeling going.</p>
                        </div>
                        <button className="text-button" onClick={() => play(moreForMood[0], moreForMood)}>
                          Play all <Play size={14} fill="currentColor" />
                        </button>
                      </div>
                      <div className="shelf">
                        {moreForMood.map((track, i) => (
                          <Motion.button key={track.id} variants={revealCard} className="album-card" {...intent(track)} onClick={() => play(track, moreForMood.slice(i))}>
                            <div className="album-image spotlight">
                              <Cover track={track} />
                              <span className="album-play">
                                <Play size={21} fill="currentColor" />
                              </span>
                            </div>
                            <strong>{track.title}</strong>
                            <span>{track.artist}</span>
                          </Motion.button>
                        ))}
                      </div>
                    </RevealSection>
                  )}
                  {repeatSongs.length > 0 && (
                    <RevealSection className="music-section on-repeat">
                      <div className="section-heading">
                        <div>
                          <h2>On repeat</h2>
                          <p>The songs you keep finishing.</p>
                        </div>
                        <button className="text-button" onClick={() => play(repeatSongs[0], repeatSongs)}>
                          Play all <Play size={14} fill="currentColor" />
                        </button>
                      </div>
                      <div className="shelf">
                        {repeatSongs.map((track, i) => (
                          <Motion.button key={track.id} variants={revealCard} className="album-card" {...intent(track)} onClick={() => play(track, repeatSongs.slice(i))}>
                            <div className="album-image spotlight">
                              <Cover track={track} />
                              <span className="album-play">
                                <Play size={21} fill="currentColor" />
                              </span>
                            </div>
                            <strong>{track.title}</strong>
                            <span>{track.artist}</span>
                          </Motion.button>
                        ))}
                      </div>
                    </RevealSection>
                  )}
                  {yourArtists.length >= 2 && (
                    <RevealSection className="music-section your-artists">
                      <div className="section-heading">
                        <div>
                          <h2>Your artists</h2>
                          <p>The voices you come back to.</p>
                        </div>
                      </div>
                      <div className="artist-row">
                        {yourArtists.map((track) => (
                          <Motion.button
                            key={track.artist}
                            variants={revealCard}
                            className="artist-card"
                            aria-label={`Music by ${track.artist}`}
                            onClick={() => {
                              setQuery(track.artist);
                              navigate("search");
                            }}
                          >
                            <span className="artist-avatar">
                              {track.artwork ? <img src={artworkAt(track.artwork, 300)} alt="" loading="lazy" decoding="async" /> : <UserRound aria-hidden="true" />}
                            </span>
                            <strong>{track.artist}</strong>
                            <small>{track.title}</small>
                          </Motion.button>
                        ))}
                      </div>
                    </RevealSection>
                  )}
                  {recent.length > 0 && (
                    <RevealSection className="music-section">
                      <div className="section-heading">
                        <h2>Back to your favorites</h2>
                        <span className="muted">Recently played</span>
                      </div>
                      {trackRows(recent.slice(0, 5))}
                    </RevealSection>
                  )}
                  <footer className="browse-footer">
                    <Brand />
                    <span>Stay a little longer.</span>
                    <span>Music is the whole point.</span>
                  </footer>
                </Motion.div>
              ) : (
                <Motion.div
                  key={page === "collection" ? `collection-${collectionKey}` : page}
                  variants={pageMotion}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="browse-content search-page"
                >
                  {page === "collection" ? renderCollection() : page === "search" ? renderSearch() : renderLibrary()}
                </Motion.div>
              )}
              </AnimatePresence>
            </Motion.div>
          ) : (
              <Motion.section
                key="immersive-player"
                variants={playerMotion}
                initial="initial"
                animate="animate"
                exit="exit"
                className={`immersive-player ${showLyrics ? "with-lyrics" : ""} ${video ? "with-video" : ""}`}
                aria-label="Now playing"
              >
                <ArtBackdrop player={player} />
                <header className="player-topbar">
                  <IconButton
                    label="Back to music"
                    onClick={() => setImmersive(false)}
                  >
                    <ChevronDown />
                  </IconButton>
                  <div className="listening-label">
                    <span>Now playing</span>
                    <strong>{player.track.album || "Your music"}</strong>
                  </div>
                  <div className="player-top-actions">
                    <div className="mode-switch">
                      <IconButton
                        label="Artwork mode"
                        active={!video}
                        aria-pressed={!video}
                        onClick={() => setVideo(false)}
                      >
                        {!video && <Motion.span layoutId="mode-pill" className="nav-pill" transition={PILL_SPRING} />}
                        <Headphones size={19} />
                      </IconButton>
                      <IconButton
                        label="Video mode"
                        active={video}
                        aria-pressed={video}
                        disabled={!!player.track?.localUrl}
                        // Only the background changes: the cover, lyrics, focus and every
                        // best-part and beat effect carry on over the video.
                        onClick={() => setVideo(!video)}
                      >
                        {video && <Motion.span layoutId="mode-pill" className="nav-pill" transition={PILL_SPRING} />}
                        <Video size={19} />
                      </IconButton>
                    </div>
                    {/* The focus button becomes the way out of focus, in the same place. */}
                    <AnimatePresence initial={false} mode="popLayout">
                      {focused ? (
                        <Motion.button
                          key="focus-exit"
                          type="button"
                          className="focus-exit"
                          aria-label="Exit focus"
                          onClick={() => setFocusMode(false)}
                          {...pop}
                        >
                          <Minimize2 size={15} /> <span>Exit focus</span>
                        </Motion.button>
                      ) : (
                        <Motion.span key="focus-enter" className="focus-enter" {...pop}>
                          <IconButton label="Lyrics focus" onClick={toggleFocus}>
                            <Focus size={19} />
                          </IconButton>
                        </Motion.span>
                      )}
                    </AnimatePresence>
                    <IconButton
                      label="Player settings"
                      onClick={() => setSheet("settings")}
                    >
                      <SlidersHorizontal size={20} />
                    </IconButton>
                  </div>
                </header>
                <div className="now-playing-body">
                  <SwipeCover player={player} onClose={() => setImmersive(false)}>
                    <TiltCover>
                      <FadingCover track={player.track} eager size={1200} direction={player.direction} blend={player.changeKind === "blend"} />
                    </TiltCover>
                    <span className="art-caption">
                      <span
                        className={
                          player.playing ? "equalizer" : "equalizer paused"
                        }
                      >
                        <i />
                        <i />
                        <i />
                      </span>
                      {player.playing ? "In the moment" : "Take a moment"}
                    </span>
                    {/* In lyrics focus the song's name travels here, under the cover: the same
                        element glides over from its place in the player (a shared layout). */}
                    {focused && !phoneLayout && (
                      <Motion.div layoutId="now-title" className="now-title focus-title" transition={{ layout: TITLE_GLIDE }}>
                        <TrackName track={player.track} live blend={player.changeKind === "blend"} />
                      </Motion.div>
                    )}
                  </SwipeCover>
                  {/* popLayout takes closing lyrics out of the layout at once, so the cover
                      glides back while they fade instead of after them. */}
                  <AnimatePresence mode="popLayout">
                    {showLyrics && (
                      <Motion.div
                        key="lyrics"
                        initial={phoneLayout ? { opacity: 0, y: 28, filter: "blur(8px)" } : { opacity: 0, x: -56, scale: 0.97, filter: "blur(8px)" }}
                        animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)", transition: { ...LYRICS_GLIDE, delay: 0.06 } }}
                        exit={{ ...(phoneLayout ? { y: 18 } : { x: -40, scale: 0.97 }), opacity: 0, filter: "blur(6px)", transition: { duration: 0.42, ease: EASE_EXIT } }}
                        layout="position"
                        transition={{ layout: LYRICS_GLIDE }}
                        className="desktop-lyrics"
                      >
                        {/* Song changes crossfade the lyrics; a DJ blend hands over slower. */}
                        <AnimatePresence initial={false} mode="popLayout" custom={player.changeKind === "blend"}>
                          <Motion.div
                            key={player.track.id}
                            className="lyrics-handover"
                            variants={lyricsChange}
                            custom={player.changeKind === "blend"}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                          >
                            <Lyrics player={player} />
                          </Motion.div>
                        </AnimatePresence>
                      </Motion.div>
                    )}
                  </AnimatePresence>
                  <Motion.div className="mobile-player-info" layout="position" transition={{ layout: LYRICS_GLIDE }}>
                    {/* Phones show the artwork as the backdrop; focus adds a small cover beside the name. */}
                    <AnimatePresence>
                      {focused && (
                        <Motion.span key="focus-thumb" className="focus-thumb" aria-hidden="true" {...pop}>
                          <AnimatePresence initial={false}>
                            <Motion.img
                              key={player.track.artwork || player.track.id}
                              src={player.track.artwork ? artworkAt(player.track.artwork, 200) : undefined}
                              alt=""
                              initial={{ opacity: 0, scale: 1.06 }}
                              animate={{ opacity: 1, scale: 1, transition: { duration: 0.7, ease: EASE } }}
                              exit={{ opacity: 0, transition: { duration: 0.5, ease: EASE_IN_OUT } }}
                            />
                        </AnimatePresence>
                      </Motion.span>
                    )}
                    </AnimatePresence>
                    <TrackName track={player.track} live={phoneLayout} blend={player.changeKind === "blend"} />
                    <div className="meta-chips">
                      <QualityChip player={player} onClick={() => setSheet("audio")} />
                      <BestPartChip player={player} />
                    </div>
                    <div className="player-pills">
                      <button
                        className={currentFavorite ? "is-liked" : ""}
                        onClick={() => toggleFavorite(player.track)}
                      >
                        <LikeHeart size={20} liked={!!currentFavorite} />
                        {currentFavorite ? "Liked" : "Like"}
                      </button>
                      <button
                        className={showLyrics ? "selected" : ""}
                        onClick={() => setShowLyrics(!showLyrics)}
                      >
                        <span className="quote-mark">❞</span>Lyrics
                      </button>
                      <button onClick={() => setSheet("queue")}>
                        <ListMusic size={21} />
                        Queue
                      </button>
                    </div>
                    <DjPill player={player} onClick={() => setSheet("dj")} label="DJ transition settings" />
                    <Seek key={player.track?.id || "idle"} player={player} />
                    <Transport player={player} large />
                    <Motion.button
                      drag="y"
                      dragConstraints={{ top: 0, bottom: 0 }}
                      dragElastic={0.2}
                      onDragEnd={(_, info) => {
                        if (info.offset.y < -40) setSheet("queue");
                        else if (info.offset.y > 55) setImmersive(false);
                      }}
                      className="queue-pull"
                      onClick={() => setSheet("queue")}
                    >
                      <span />
                      Your queue <ChevronRight size={15} />
                    </Motion.button>
                  </Motion.div>
                </div>
                <Motion.div className="immersive-track-meta" layout="position" transition={{ layout: LYRICS_GLIDE }}>
                  <div>
                    {!(focused && !phoneLayout) && (
                      <Motion.div layoutId="now-title" className="now-title" transition={{ layout: TITLE_GLIDE }}>
                        <TrackName track={player.track} live={!phoneLayout} blend={player.changeKind === "blend"} />
                      </Motion.div>
                    )}
                    <div className="meta-chips">
                      <QualityChip player={player} onClick={() => setSheet("audio")} />
                      <BestPartChip player={player} />
                    </div>
                  </div>
                  <IconButton
                    label={currentFavorite ? "Unlike track" : "Like track"}
                    active={currentFavorite}
                    onClick={() => toggleFavorite(player.track)}
                  >
                    <LikeHeart liked={!!currentFavorite} />
                  </IconButton>
                </Motion.div>
              </Motion.section>
          )}
          </AnimatePresence>
        </Motion.main>
        <AnimatePresence>
        {player.track && <Motion.div
          key="dock"
          className="player-dock"
          initial={{ y: 110, opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { type: "spring", stiffness: 140, damping: 22, opacity: { duration: 0.5 } } }}
          exit={{ y: 110, opacity: 0, transition: { duration: 0.4, ease: EASE_EXIT } }}
        >
          <div className="dock-transport">
            <Transport player={player} />
          </div>
          <Motion.button
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.12}
            onDragEnd={(_, info) => {
              if (info.offset.x < -60) player.next();
              else if (info.offset.x > 60) player.previous();
            }}
            className="dock-track"
            onClick={() =>
              player.track ? setImmersive(true) : navigate("search")
            }
          >
            <FadingCover track={player.track} size={160} />
            {/* The name travels with the cover: in from the side the listener is heading, the old one drifting out. */}
            <span className="dock-text">
              <AnimatePresence initial={false} mode="popLayout" custom={player.direction || 1}>
                <Motion.span
                  key={player.track?.id || "idle"}
                  custom={player.direction || 1}
                  variants={textSwap}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <strong>{player.track?.title || "Make yourself at home"}</strong>
                  <small>
                    {player.track?.artist || "Find something you love. Press play."}
                  </small>
                </Motion.span>
              </AnimatePresence>
            </span>
            <AnimatePresence initial={false}>
              {player.playing && (
                <Motion.span key="equalizer" className="equalizer" {...pop}>
                  <i />
                  <i />
                  <i />
                </Motion.span>
              )}
            </AnimatePresence>
          </Motion.button>
          <div className="dock-seek">
            <Seek key={player.track?.id || "idle"} player={player} />
          </div>
          <div className="dock-actions">
            <IconButton
              label="DJ transition settings"
              active={player.djEnabled}
              onClick={() => setSheet("dj")}
            >
              <AudioLines size={20} />
            </IconButton>
            <IconButton
              label="Show lyrics"
              active={showLyrics && immersive}
              disabled={!player.track}
              onClick={() => {
                setShowLyrics(!showLyrics);
                setImmersive(true);
              }}
            >
              <span className="quote-mark">❞</span>
            </IconButton>
            <IconButton label="Open queue" onClick={() => setSheet("queue")}>
              <ListMusic size={20} />
            </IconButton>
            <div className="volume-control">
              <Volume2 size={18} />
              <input
                type="range"
                min="0"
                max="100"
                value={player.volume ?? 80}
                onChange={(e) => player.setVolume(Number(e.target.value))}
                aria-label="Volume"
              />
            </div>
          </div>
          <div className="mobile-dock-play">
            <IconButton
              label="Previous track"
              disabled={!player.track}
              onClick={player.previous}
            >
              <SkipBack fill="currentColor" />
            </IconButton>
            <PlayButton player={player} />
            <IconButton
              label="Next track"
              disabled={!player.track}
              onClick={player.next}
            >
              <SkipForward fill="currentColor" />
            </IconButton>
          </div>
        </Motion.div>
        }
        </AnimatePresence>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {[
            ["home", House, "Listen"],
            ["search", Search, "Search"],
            ["library", Library, "Library"],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              className={page === id ? "selected" : ""}
              onClick={() => navigate(id)}
            >
              {page === id && (
                <Motion.span layoutId="mobile-nav-pill" className="nav-pill" transition={PILL_SPRING} />
              )}
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <AnimatePresence mode="wait">
          {sheet === "queue" && (
            <Sheet key="queue" title="Your queue" close={() => setSheet(null)}>
              {player.queue?.length ? (
                <>
                  <div className="queue-intro">
                    <p className="sheet-description">
                      {player.autoplay
                        ? "A continuous mix, shaped around this song."
                        : "Your songs, in your order."}
                    </p>
                    <DjPill player={player} onClick={() => setSheet("dj")} />
                  </div>
                  {player.recommendationsLoading && (
                    <p className="queue-status is-loading" role="status">
                      <Waveform />
                      Finding the next good listen…
                    </p>
                  )}
                  {player.recommendationError && (
                    <p className="queue-status" role="status">
                      {player.recommendationError}
                    </p>
                  )}
                  <QueueSections player={player} trackRows={trackRows} />
                </>
              ) : (
                <div className="empty-state">
                  <ListMusic size={35} />
                  <h3>Room for your next favorite.</h3>
                  <p>Add songs with the + button in search.</p>
                  <button
                    className="primary-button"
                    onClick={() => {
                      setSheet(null);
                      navigate("search");
                    }}
                  >
                    Find music
                  </button>
                </div>
              )}
            </Sheet>
          )}
          {sheet === "dj" && (
            <Sheet
              key="dj"
              title="DJ transition"
              back={sheetParent === "settings" ? nav.backSheet : undefined}
              close={() => setSheet(null)}
            >
              <div className="dj-intro">
                <span className="dj-symbol">
                  <AudioLines size={34} />
                </span>
                <h3>Let one song become the next.</h3>
                <p>
                  A softer landing. A natural lift. Keep your listening in flow.
                </p>
              </div>
              <div className="setting-row">
                <div>
                  <strong>DJ transition</strong>
                  <p>Blend the ending into the next beginning.</p>
                </div>
                <button
                  role="switch"
                  aria-label="Enable DJ transition"
                  aria-checked={!!player.djEnabled}
                  className="setting-switch"
                  onClick={() => player.setDjEnabled(!player.djEnabled)}
                >
                  <span />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Keep the feeling</strong>
                  <p>Queue similar music as you listen.</p>
                </div>
                <button
                  role="switch"
                  aria-label="Autoplay similar songs"
                  aria-checked={!!player.autoplay}
                  className="setting-switch"
                  onClick={() => player.setAutoplay(!player.autoplay)}
                >
                  <span />
                </button>
              </div>
              <div className={`setting-row ${player.djEnabled ? "" : "is-dormant"}`}>
                <div>
                  <strong>Live DJ changes</strong>
                  <p>Blend when you choose the next track.</p>
                </div>
                <button
                  role="switch"
                  aria-label="Live DJ changes"
                  aria-checked={!!player.liveDjChanges}
                  className="setting-switch"
                  onClick={() =>
                    player.setLiveDjChanges?.(!player.liveDjChanges)
                  }
                >
                  <span />
                </button>
              </div>
              <div className={`setting-row ${player.djEnabled ? "" : "is-dormant"}`}>
                <div>
                  <strong>Deep sweep</strong>
                  <p>A low, warm swell with a sub drop under online blends, whose audio YouTube keeps unfiltered.</p>
                </div>
                <button
                  role="switch"
                  aria-label="Deep sweep"
                  aria-checked={!!player.transitionFx}
                  className="setting-switch"
                  onClick={() => player.setTransitionFx?.(!player.transitionFx)}
                >
                  <span />
                </button>
              </div>
              <div className={`setting-row ${player.djEnabled ? "" : "is-dormant"}`}>
                <div>
                  <strong>Blend length</strong>
                  <p>Auto picks the longest whole phrase the music leaves room for, up to 16 bars. Online songs blend up to 16 s.</p>
                </div>
                <div className="segmented" role="radiogroup" aria-label="Blend length">
                  {[
                    ["auto", "Auto", "Longest fit"],
                    [8, "Short", "8s"],
                    [16, "Club", "16s"],
                    [32, "Extended", "32s"],
                  ].map(([seconds, label, hint]) => (
                    <button
                      key={seconds}
                      role="radio"
                      aria-checked={player.blendLength === seconds}
                      className={player.blendLength === seconds ? "selected" : ""}
                      onClick={() => player.setBlendLength(seconds)}
                    >
                      {player.blendLength === seconds && <Motion.span layoutId="blend-pill" className="nav-pill" transition={PILL_SPRING} />}
                      {label}
                      <small>{hint}</small>
                    </button>
                  ))}
                </div>
              </div>
              <DjStatus player={player} />
              <ul className="dj-capabilities">
                {player.track?.localUrl ? (
                  <>
                    <li>Finds a quiet phrase in the last 30 seconds and the first beat of the next song.</li>
                    <li>Glides the ending song up to ±8% into the next song’s measured tempo, pitch preserved.</li>
                    <li>A phrase-long blend: the bass swaps on a bar line, the next song arrives warm and full, the last one echoes out softly.</li>
                  </>
                ) : (
                  <>
                    <li>Starts the blend after the last timed vocal line, or near the natural ending.</li>
                    <li>Pre-loads the next song on a second deck for a real five-second overlap.</li>
                    <li>Glides tempo only when catalogue BPM is known and this player accepts fine speeds.</li>
                  </>
                )}
              </ul>
              <p className="provider-note">
                YouTube does not share its audio with the page, so the filters,
                warmth, echo and measured beat matching work with your own audio
                files. Online songs blend with volume, a deep sweep and, when the
                player allows, tempo.
              </p>
              <button
                className="primary-button"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={17} />
                Open audio files
              </button>
            </Sheet>
          )}
          {sheet === "audio" && (
            <Sheet key="audio" title="Audio quality" back={sheetParent ? nav.backSheet : undefined} close={() => setSheet(null)}>
              <AudioQuality player={player} />
            </Sheet>
          )}
          {sheet === "settings" && (
            <Sheet
              key="settings"
              title="Make it yours"
              close={() => setSheet(null)}
            >
              <label className="setting-row name-row">
                <div>
                  <strong>What should we call you?</strong>
                  <p>Only used to greet you. It stays on this device.</p>
                </div>
                <input
                  type="text"
                  aria-label="Your name"
                  placeholder="Your name"
                  maxLength={24}
                  autoComplete="given-name"
                  value={listenerName}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\s+/g, " ").slice(0, 24);
                    setListenerName(value);
                    try {
                      localStorage.setItem("aurora-name", value.trim());
                    } catch {
                      /* The greeting lasts this session. */
                    }
                  }}
                />
              </label>
              <button
                className="dj-settings-link"
                onClick={() => setSheet("dj")}
              >
                <AudioLines />
                <span>
                  <strong>DJ transition</strong>
                  <small>Keep your music in flow</small>
                </span>
                <ChevronRight size={18} />
              </button>
              <button className="dj-settings-link" onClick={() => setSheet("audio")}>
                <Headphones />
                <span>
                  <strong>Audio quality</strong>
                  <small>What you hear, and how it gets to you</small>
                </span>
                <ChevronRight size={18} />
              </button>
              <div className="setting-row">
                <div>
                  <strong>Loudness</strong>
                  <p>Normal keeps a little headroom. Loud plays at full level and gently compresses your own files.</p>
                </div>
                <div className="segmented" role="radiogroup" aria-label="Loudness">
                  {[
                    ["quiet", "Quiet", "Softer"],
                    ["normal", "Normal", "Balanced"],
                    ["loud", "Loud", "Full"],
                  ].map(([level, label, hint]) => (
                    <button
                      key={level}
                      role="radio"
                      aria-checked={player.loudness === level}
                      className={player.loudness === level ? "selected" : ""}
                      onClick={() => player.setLoudness(level)}
                    >
                      {player.loudness === level && <Motion.span layoutId="loudness-pill" className="nav-pill" transition={PILL_SPRING} />}
                      {label}
                      <small>{hint}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Motion backdrop</strong>
                  <p>The song’s own video, softly blurred behind the artwork.</p>
                </div>
                <button
                  role="switch"
                  aria-label="Motion backdrop"
                  aria-checked={motionArt}
                  className="setting-switch"
                  onClick={() => {
                    const next = !motionArt;
                    setMotionArt(next);
                    persist("aurora-motion-art", next);
                  }}
                >
                  <span />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Lyrics timing</strong>
                  <p>
                    {player.lyricsTiming === "captions"
                      ? "Matched to this video’s captions. Nudge it if it still feels off."
                      : player.lyricsTiming === "manual"
                        ? "Your timing, remembered for this song."
                        : "As published. Nudge words earlier or later; it is remembered."}
                  </p>
                </div>
                <div className="offset-stepper" role="group" aria-label="Lyrics timing offset">
                  <IconButton
                    label="Show lyrics later"
                    onClick={() => player.setLyricsOffset(Math.round((player.lyricsOffset - 0.1) * 10) / 10)}
                    disabled={player.lyricsOffset <= -10}
                  >
                    <Minus size={16} />
                  </IconButton>
                  <output aria-live="polite" aria-label="Current lyrics offset">
                    {player.lyricsOffset > 0 ? "+" : ""}
                    {player.lyricsOffset.toFixed(1)} s
                  </output>
                  <IconButton
                    label="Show lyrics earlier"
                    onClick={() => player.setLyricsOffset(Math.round((player.lyricsOffset + 0.1) * 10) / 10)}
                    disabled={player.lyricsOffset >= 10}
                  >
                    <Plus size={16} />
                  </IconButton>
                  <AnimatePresence initial={false}>
                    {player.lyricsTiming === "manual" && (
                      <Motion.button
                        key="auto"
                        type="button"
                        className="small-pill"
                        onClick={player.autoLyricsOffset}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.3, ease: EASE }}
                      >
                        Auto
                      </Motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Play your own music</strong>
                  <p>Open an audio file from this device.</p>
                </div>
                <IconButton
                  label="Open audio file"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload />
                </IconButton>
              </div>
              <div className="shortcut-list" aria-label="Keyboard shortcuts">
                {[
                  ["Space", "Play or pause"],
                  ["← →", "Seek 5 seconds"],
                  ["⇧ ← →", "Previous or next"],
                  ["L", "Lyrics"],
                  ["M", "Mute"],
                  ["F", "Like"],
                  ["/", "Search"],
                ].map(([keys, label]) => (
                  <span key={keys}>
                    <kbd>{keys}</kbd>
                    {label}
                  </span>
                ))}
              </div>
              <div className="settings-note">
                <Headphones size={23} />
                <p>
                  Your library stays on this device. No account, no feed, just
                  music.
                </p>
              </div>
              <p className="provider-note">
                Online playback is provided by YouTube and subject to its
                availability and ads. Local audio plays directly, without ads.
                Audio quality depends on the source.
              </p>
            </Sheet>
          )}
        </AnimatePresence>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length && player.loadLocalFiles) {
              player.loadLocalFiles(files);
              setImmersive(true);
              setSheet(null);
            }
            e.target.value = "";
          }}
        />
        <AnimatePresence>
          {(notice || player.notice || player.error) && (
            <Motion.div
              role={player.error ? "alert" : "status"}
              className={`toast ${player.error ? "error-toast" : ""}`}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 260, damping: 24 } }}
              exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.35, ease: EASE_EXIT } }}
            >
              <span>{player.error || player.notice || notice}</span>
              {player.error && (
                <button
                  onClick={() =>
                    player.track && player.loadTrack(player.track, player.queue)
                  }
                >
                  Retry
                </button>
              )}
            </Motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
