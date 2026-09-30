import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion as Motion,
  useReducedMotion,
  usePresence,
} from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Disc3,
  AudioLines,
  Headphones,
  Heart,
  House,
  Library,
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings2,
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
import { useNavigation } from "./hooks/useNavigation";
import { getCollection, getFeaturedTracks, getSimilarTracks, searchCatalog } from "./lib/catalog";
import { extractColors } from "../shared/palette";
import { requestedVariant } from "../shared/audio-variants.js";
import { artworkAt, artworkSrcSet } from "./lib/artwork";
import { qualityLabel } from "./lib/audio-format";
import { homeSeeds, recordLike, tasteFilter } from "./lib/listening";
import Welcome from "./components/Welcome";
import { shouldWelcome } from "./lib/welcome";
import FluidText from "./components/FluidText";
import {
  EASE,
  EASE_EXIT,
  EASE_IN_OUT,
  PILL_SPRING,
  SHEET_SPRING,
  crossfade,
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
function FadingCover({ track, className = "", eager = false, size = 600 }) {
  return (
    <div className={`cover fading-cover ${className}`}>
      <AnimatePresence initial={false}>
        {track?.artwork ? (
          <Motion.img
            key={track.artwork}
            src={artworkAt(track.artwork, size)}
            alt={`${track.title} artwork`}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            {...crossfade}
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
const greeting = () => {
  const hour = new Date().getHours();
  return hour < 5 ? "Late night listening." : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
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
      aurora<span className="brand-period">.</span>
    </span>
  );
}
function PlayButton({ player, large = false }) {
  return (
    <IconButton
      label={player.playing ? "Pause" : "Play"}
      className={`play-button ${large ? "large" : ""}`}
      disabled={!player.track || player.loading}
      onClick={player.togglePlay}
    >
      {player.loading ? (
        <LoaderCircle className="spin" />
      ) : player.playing ? (
        <Pause fill="currentColor" />
      ) : (
        <Play fill="currentColor" />
      )}
    </IconButton>
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
  const zoneLabel = zone
    ? `DJ transition from ${formatTime(zone.start)} to ${formatTime(zone.end)}${zone.ready ? ", next track ready" : ""}`
    : undefined;
  const commit = () => {
    if (drag === null) return;
    player.seek(drag);
    setDrag(null);
  };
  return (
    <div className="seek-control">
      <div className="seek-track">
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
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
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
const LINE_LEAD = 0.35;
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

function Lyrics({ player }) {
  const reduce = useReducedMotion();
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
  const offset = player.lyricsOffset || 0;
  const timed = player.lyrics?.sync !== "plain";
  const lead = reduce ? 0 : LINE_LEAD;
  // Re-render only when the active line or interlude state changes, not every clock tick.
  const position = useStore(player.clock, (value) => {
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
    return `${current}:${gap ? 1 : 0}`;
  });
  const active = Number(position.split(":")[0]);
  const inGap = position.endsWith(":1");
  const gapStart = active >= 0 ? lineEnd(lines[active]) : 0;
  const gapEnd = lines[active + 1]?.time;
  const interlude = { clock: player.clock, offset, start: gapStart, end: gapEnd };
  const stopScroll = () => scrolling.current?.stop();
  useEffect(() => {
    const box = container.current;
    const target = activeRef.current;
    if (!following || !box || !target) return;
    const top = Math.max(0, target.offsetTop + target.offsetHeight / 2 - box.clientHeight * 0.4);
    stopScroll();
    if (reduce) {
      box.scrollTop = top;
      return;
    }
    // A long, eased glide replaces the browser's short smooth-scroll jump.
    scrolling.current = animate(box.scrollTop, top, {
      duration: 1.15,
      ease: [0.33, 0, 0.15, 1],
      onUpdate: (value) => {
        box.scrollTop = value;
      },
    });
    return stopScroll;
  }, [mountedList, active, following, reduce, inGap]);
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
    if (!mountedList || !timed || lyricsLoading) return;
    const words = Array.from(mountedList.querySelectorAll(".lyric-line"),
      (line) => Array.from(line.querySelectorAll(".word-fill")));
    let frame;
    let previousTime = null;
    let previousLine = -1;
    const paint = () => {
      const time = getPlaybackTime() + lyricsOffset;
      if (time !== previousTime) {
        let currentLine = -1;
        for (let i = 0; i < lines.length && lines[i].time <= time; i++) currentLine = i;
        const reset = previousTime === null || time < previousTime || time - previousTime > 0.5;
        const start = reset ? 0 : Math.max(0, Math.min(previousLine, currentLine));
        const end = reset ? lines.length - 1 : Math.min(lines.length - 1, currentLine + 1);
        for (let i = start; i <= end; i++) {
          words[i]?.forEach((fill, index) => {
            const word = lines[i].words[index];
            // A feathered wipe leads the onset by at most 80ms and finishes on the word's end.
            const lead = reduce ? 0 : Math.min(0.08, (word.end - word.start) * 0.2);
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
        previousLine = currentLine;
      }
      frame = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(frame);
  }, [mountedList, getPlaybackTime, lines, lyricsOffset, lyricsLoading, timed, reduce]);
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
            <div key={`${i}-${line.time}`} className="lyric-block">
              <button
                ref={i === active ? activeRef : null}
                className={`lyric-line ${i === active ? "current" : ""} ${i < active ? "past" : ""} ${i === active + 1 ? "upcoming" : ""} ${!timed ? "plain" : ""} ${line.words?.length ? "has-words" : ""}`}
                disabled={!timed}
                onClick={() => {
                  player.seek(Math.max(0, line.time - (player.lyricsOffset || 0)));
                  setFollowing(true);
                }}
                aria-label={
                  timed
                    ? `Seek to ${formatTime(line.time)}: ${line.text}`
                    : undefined
                }
              >
                {line.words?.length
                  ? line.words.map((word, wi) => (
                      <span key={wi} className="lyric-word">
                        <span>{word.text}</span>
                        <span aria-hidden="true" className="word-fill">
                          {word.text}
                        </span>
                      </span>
                    ))
                  : line.text}
              </button>
              <AnimatePresence initial={false}>
                {inGap && i === active && <Interlude key="gap" {...interlude} />}
              </AnimatePresence>
            </div>
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

function Sheet({ title, close, back, children }) {
  const ref = useRef(null);
  const [isPresent, safeToRemove] = usePresence();
  const reduce = useReducedMotion();
  const mobile = useMediaQuery("(max-width: 760px)");
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
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
          {back && (
            <IconButton label="Back to preferences" onClick={back}>
              <ArrowLeft />
            </IconButton>
          )}
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
        <p>
          {state.fromBpm && state.toBpm
            ? `${Math.round(state.fromBpm)} → ${Math.round(state.toBpm)} BPM · tempo glide`
            : player.track?.localUrl
              ? "Local audio · tempo glide, hollow filter and echo"
              : "Online playback · two-deck volume blend"}
        </p>
        {effects.length > 0 && (
          <span className="dj-effects">
            {effects.map((effect) => (
              <em key={effect}>{effect}</em>
            ))}
          </span>
        )}
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
  const [notice, setNotice] = useState("");
  const nav = useNavigation({ onLeaveHint: useCallback(() => setNotice("Press back again to leave Aurora"), []) });
  const { page, immersive, sheet, collection } = nav.view;
  const setImmersive = (open) => (open ? nav.openPlayer() : nav.closePlayer());
  const setSheet = (next) => (next ? nav.openSheet(next) : nav.closeSheet());
  const [featured, setFeatured] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [forYou, setForYou] = useState([]);
  const [revealed, setRevealed] = useState(() => !shouldWelcome());
  const [motionArt, setMotionArt] = useState(() => {
    try {
      return localStorage.getItem("aurora-motion-art") === "true";
    } catch {
      return false;
    }
  });
  const reveal = useCallback(() => setRevealed(true), []);
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
  const [video, setVideo] = useState(false);
  const ambientVideo = motionArt && !video && immersive && !!player.track && !player.track.localUrl;
  const sheetParent = nav.view.sheetDepth > 1 ? "settings" : null;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [favorites, setFavorites] = useState(() =>
    readSaved("aurora-favorites"),
  );
  const [recent, setRecent] = useState(() => readSaved("aurora-recent"));
  const [color, setColor] = useState("153, 93, 62");
  const [featureIndex, setFeatureIndex] = useState(0);
  const searchRef = useRef(null);
  // The search page animates in after the previous page leaves, so focus is
  // requested here and applied when the field actually mounts.
  const focusSearchOnMount = useRef(false);
  const focusSearch = () => {
    if (searchRef.current) searchRef.current.focus();
    else focusSearchOnMount.current = true;
  };
  const fileRef = useRef(null);
  const heroTrack =
    (immersive ? player.track : null) || featured[featureIndex] || featured[0];
  const currentFavorite = favorites.some((t) => t.id === player.track?.id);

  useEffect(() => {
    const controller = new AbortController();
    getFeaturedTracks(controller.signal)
      .then(setFeatured)
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
  // Each screen starts at its top: opening the player or a page never inherits scroll.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [immersive, page, collection]);
  // Home adapts to on-device listening: rows seeded by the artists enjoyed most.
  useEffect(() => {
    if (page !== "home") return;
    const seeds = homeSeeds(2);
    if (!seeds.length) return;
    const controller = new AbortController();
    Promise.allSettled(seeds.map((seed) => getSimilarTracks(seed, controller.signal).then((tracks) => ({ seed, tracks: tasteFilter(tracks).slice(0, 10) }))))
      .then((rows) => {
        if (!controller.signal.aborted) setForYou(rows.filter((row) => row.status === "fulfilled" && row.value.tracks.length >= 3).map((row) => row.value));
      });
    return () => controller.abort();
  }, [page]);
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
    setVideo(false);
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
  const mutedVolume = useRef(80);
  const toggleMute = () => {
    if (player.volume > 0) {
      mutedVolume.current = player.volume;
      player.setVolume(0);
      setNotice("Muted");
    } else player.setVolume(mutedVolume.current || 80);
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
      if (e.key === "Escape" && !sheet && !e.target.closest?.("input, textarea, select"))
        setImmersive(false);
      // Media shortcuts never steal keys from fields, controls or open dialogs.
      // Fields keep every key; sliders keep their arrows; buttons keep Space.
      if (sheet || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('textarea, select, [contenteditable], input:not([type="range"])')) return;
      if (e.target.matches?.('input[type="range"]') && /^(Arrow|Home|End|Page)/.test(e.key)) return;
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
  const trackRows = (tracks, queueMode = false, context) => {
    const occurrences = new Map();
    const rows = tracks.map((track, i) => {
      const occurrence = occurrences.get(track.id) || 0;
      occurrences.set(track.id, occurrence + 1);
      const selected = player.track?.id === track.id;
      return (
        <Motion.div
          layout={queueMode ? "position" : false}
          {...listItem(i)}
          className={`track-row ${selected ? "selected" : ""}`}
          key={`${track.id}#${occurrence}`}
        >
          <button
            className="track-main"
            onClick={() => play(track, queueMode ? tracks : context)}
          >
            <span className="track-number">
              {selected && player.playing ? (
                <span className="equalizer">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                String(i + 1).padStart(2, "0")
              )}
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
                    player.queue.filter((_, index) => index !== i),
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
        <button className="text-button" onClick={() => setSearchType(kind)}>
          See all <ArrowRight size={15} />
        </button>
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
      {query.trim().length >= 2 && (
        <div className="search-tabs" role="tablist" aria-label="Search categories">
          {SEARCH_TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={searchType === id} className={searchType === id ? "selected" : ""} onClick={() => setSearchType(id)}>
              {searchType === id && <Motion.span layoutId="search-tab" className="nav-pill" transition={PILL_SPRING} />}
              {label}
            </button>
          ))}
        </div>
      )}
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
        className={`aurora-app ${revealed ? "" : "is-veiled"} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${immersive ? "is-immersive" : ""} ${video && immersive ? "has-video" : ""} ${video && showLyrics ? "video-with-lyrics" : ""} ${ambientVideo ? "motion-art" : ""}`}
        style={{ "--art-color": color }}
      >
        <div
          aria-hidden="true"
          className={`video-surface ${(video || ambientVideo) && immersive ? "is-visible" : ""}`}
        >
          <div id="youtube-player" />
        </div>
        <Motion.aside layout layoutDependency={sidebarCollapsed} className="sidebar">
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
                {page === id && !immersive && (
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
        </Motion.aside>
        <Motion.main layout layoutDependency={sidebarCollapsed} className="main-content">
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
                      <p>{greeting()} A little less noise, a little more music.</p>
                      <h1>
                        Find your frequency<span>.</span>
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
                  <Motion.section
                    variants={sectionMotion}
                    className="discovery-stage"
                    aria-label="Featured music"
                  >
                    <div className="stage-aura" />
                    {heroTrack ? (
                      <>
                        <div className="stage-copy">
                          <span className="feature-label">
                            <span /> In the spotlight
                          </span>
                          <FluidText as="h2">{heroTrack.artist}</FluidText>
                          <FluidText as="p">{heroTrack.title}</FluidText>
                          <button
                            className="primary-button"
                            onClick={() => play(heroTrack)}
                          >
                            <Play size={16} fill="currentColor" />
                            Press play
                          </button>
                          <span className="stage-caption">
                            An entirely different kind of listening.
                          </span>
                        </div>
                        <div className="cover-carousel">
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
                              onClick={() =>
                                offset === 0
                                  ? play(track)
                                  : setFeatureIndex(
                                      (carouselIndex +
                                        offset +
                                        featured.length) %
                                        featured.length,
                                    )
                              }
                              aria-label={`${offset === 0 ? "Play" : "Discover"} ${track.title} by ${track.artist}`}
                            >
                              <Cover track={track} eager />
                              <span>
                                <strong>{track.artist}</strong>
                                <small>{track.title}</small>
                              </span>
                            </Motion.button>
                          ))}
                        </div>
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
                                (featureIndex - 1 + featured.length) %
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
                                (featureIndex + 1) % featured.length,
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
                        "The Weeknd Dua Lipa",
                        Disc3,
                      ],
                      [
                        "After hours",
                        "For the quieter side of you",
                        "Joji Frank Ocean",
                        Headphones,
                      ],
                      [
                        "A little energy",
                        "Turn the everyday up",
                        "Daft Punk dance",
                        Shuffle,
                      ],
                    ].map(([title, subtitle, term, Icon], i) => (
                      <button
                        key={title}
                        className={`mood-card mood-${i}`}
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
                  {forYou.map(({ seed, tracks }) => (
                    <Motion.section key={seed.id} variants={sectionMotion} className="music-section for-you">
                      <div className="section-heading">
                        <div>
                          <h2>Because you listened to {seed.title}</h2>
                          <p>Picked on this device from what you finish and love.</p>
                        </div>
                        <button className="text-button" onClick={() => play(tracks[0], tracks)}>
                          Play all <Play size={14} fill="currentColor" />
                        </button>
                      </div>
                      <div className="shelf">
                        {tracks.map((track, i) => (
                          <Motion.button key={track.id} {...listItem(i)} className="album-card" onClick={() => play(track, tracks.slice(i))}>
                            <div className="album-image">
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
                    </Motion.section>
                  ))}
                  <Motion.section variants={sectionMotion} className="music-section">
                    <div className="section-heading">
                      <div>
                        <h2>Made for a good listen</h2>
                        <p>A few favorites to get you started.</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("search")}
                      >
                        Explore music <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="album-grid">
                      {featured.slice(0, 6).map((track) => (
                        <button
                          className="album-card"
                          key={track.id}
                          onClick={() => play(track)}
                        >
                          <div className="album-image">
                            <Cover track={track} />
                            <span className="album-play">
                              <Play size={21} fill="currentColor" />
                            </span>
                          </div>
                          <strong>{track.title}</strong>
                          <span>{track.artist}</span>
                        </button>
                      ))}
                    </div>
                  </Motion.section>
                  {recent.length > 0 && (
                    <Motion.section variants={sectionMotion} className="music-section">
                      <div className="section-heading">
                        <h2>Back to your favorites</h2>
                        <span className="muted">Recently played</span>
                      </div>
                      {trackRows(recent.slice(0, 5))}
                    </Motion.section>
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
                <div className="player-art-background">
                  <AnimatePresence initial={false}>
                    {player.track.artwork && (
                      <Motion.div
                        key={player.track.artwork}
                        className="art-bg-layer"
                        style={{ backgroundImage: `url("${artworkAt(player.track.artwork, 1000)}")` }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 1.4, ease: EASE } }}
                        exit={{ opacity: 0, transition: { duration: 1.2, ease: EASE_IN_OUT } }}
                      />
                    )}
                  </AnimatePresence>
                </div>
                <div className="player-veil" />
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
                        onClick={() => {
                          setVideo(!video);
                        }}
                      >
                        {video && <Motion.span layoutId="mode-pill" className="nav-pill" transition={PILL_SPRING} />}
                        <Video size={19} />
                      </IconButton>
                    </div>
                    <IconButton
                      label="Player settings"
                      onClick={() => setSheet("settings")}
                    >
                      <SlidersHorizontal size={20} />
                    </IconButton>
                  </div>
                </header>
                <div className="now-playing-body">
                  <Motion.div
                    className="now-playing-art"
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.12}
                    onDragEnd={(_, info) => {
                      if (info.offset.x < -65) player.next();
                      else if (info.offset.x > 65) player.previous();
                    }}
                  >
                    <FadingCover track={player.track} eager size={1200} />
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
                  </Motion.div>
                  <AnimatePresence>
                    {showLyrics && (
                      <Motion.div
                        key="lyrics"
                        exit={{
                          opacity: 0,
                          x: 24,
                          filter: "blur(6px)",
                          transition: { duration: 0.4, ease: EASE_EXIT },
                        }}
                        initial={{ opacity: 0, x: 40, filter: "blur(8px)" }}
                        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                        transition={{ duration: 0.8, ease: EASE }}
                        className="desktop-lyrics"
                      >
                        <Lyrics key={player.track.id} player={player} />
                      </Motion.div>
                    )}
                  </AnimatePresence>
                  <div className="mobile-player-info">
                    <FluidText as="h1">{player.track.title}</FluidText>
                    <p>{player.track.artist}</p>
                    <QualityChip player={player} onClick={() => setSheet("audio")} />
                    <div className="player-pills">
                      <button
                        className={currentFavorite ? "is-liked" : ""}
                        onClick={() => toggleFavorite(player.track)}
                      >
                        <Heart
                          size={20}
                          fill={currentFavorite ? "currentColor" : "none"}
                        />
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
                    <Seek player={player} />
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
                  </div>
                </div>
                <div className="immersive-track-meta">
                  <div>
                    <FluidText as="h1">{player.track.title}</FluidText>
                    <p>{player.track.artist}</p>
                    <QualityChip player={player} onClick={() => setSheet("audio")} />
                  </div>
                  <IconButton
                    label={currentFavorite ? "Unlike track" : "Like track"}
                    active={currentFavorite}
                    onClick={() => toggleFavorite(player.track)}
                  >
                    <Heart fill={currentFavorite ? "currentColor" : "none"} />
                  </IconButton>
                </div>
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
            <span>
              <strong>{player.track?.title || "Make yourself at home"}</strong>
              <small>
                {player.track?.artist || "Find something you love. Press play."}
              </small>
            </span>
            {player.playing && (
              <span className="equalizer">
                <i />
                <i />
                <i />
              </span>
            )}
          </Motion.button>
          <div className="dock-seek">
            <Seek player={player} />
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
                    <p className="queue-status" role="status">
                      Finding the next good listen…
                    </p>
                  )}
                  {player.recommendationError && (
                    <p className="queue-status" role="status">
                      {player.recommendationError}
                    </p>
                  )}
                  {trackRows(player.queue, true)}
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
              <div className="setting-row">
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
              <div className="setting-row">
                <div>
                  <strong>Blend length</strong>
                  <p>Rounded to whole bars when the beat is known.</p>
                </div>
                <div className="segmented" role="radiogroup" aria-label="Blend length">
                  {[
                    [3, "Quick"],
                    [5, "Natural"],
                    [8, "Long"],
                  ].map(([seconds, label]) => (
                    <button
                      key={seconds}
                      role="radio"
                      aria-checked={player.blendLength === seconds}
                      className={player.blendLength === seconds ? "selected" : ""}
                      onClick={() => player.setBlendLength(seconds)}
                    >
                      {player.blendLength === seconds && <Motion.span layoutId="blend-pill" className="nav-pill" transition={PILL_SPRING} />}
                      {label}
                      <small>{seconds}s</small>
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
                    <li>A five-second, bar-length blend with a hollow filter sweep and echo tail.</li>
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
                YouTube does not share its audio with the page, so the hollow
                filter, echo and measured beat matching work with your own
                audio files. Online songs blend with volume and, when possible,
                tempo.
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
                  <p>Fine-tune words to your audio.</p>
                </div>
                <select
                  aria-label="Lyrics timing offset"
                  value={player.lyricsOffset || 0}
                  onChange={(e) =>
                    player.setLyricsOffset(Number(e.target.value))
                  }
                >
                  {[-2, -1, -0.5, 0, 0.5, 1, 2].map((value) => (
                    <option key={value} value={value}>
                      {value > 0 ? "+" : ""}
                      {value}s
                    </option>
                  ))}
                </select>
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
              setVideo(false);
            }
            e.target.value = "";
          }}
        />
        <AnimatePresence>
          {(notice || player.error) && (
            <Motion.div
              role={player.error ? "alert" : "status"}
              className={`toast ${player.error ? "error-toast" : ""}`}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 260, damping: 24 } }}
              exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.35, ease: EASE_EXIT } }}
            >
              <span>{player.error || notice}</span>
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
