import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  MotionConfig,
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
  Video,
  Volume2,
  X,
} from "lucide-react";
import { usePlayer } from "./hooks/usePlayer";
import { getFeaturedTracks, searchTracks } from "./lib/catalog";
import { extractColors } from "../shared/palette";
import Welcome from "./components/Welcome";
import FluidText from "./components/FluidText";
import "./App.css";

const formatTime = (value) => {
  const n = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
function readSaved(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter((t) => t && t.id && t.title)
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
          srcSet={
            track.artwork.includes("mzstatic.com")
              ? [160, 320, 600]
                  .map(
                    (size) =>
                      `${track.artwork.replace(/600x600bb/, `${size}x${size}bb`)} ${size}w`,
                  )
                  .join(", ")
              : undefined
          }
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
  const duration = Math.max(player.duration || player.track?.duration || 0, 1);
  const zone = player.djEnabled ? player.djWindow : null;
  const zoneLabel = zone
    ? `DJ transition from ${formatTime(zone.start)} to ${formatTime(zone.end)}${zone.ready ? ", next track ready" : ""}`
    : undefined;
  return (
    <div className="seek-control">
      <div className="seek-track">
        {zone && (
          <span
            className={`dj-seek-zone ${zone.ready ? "ready" : ""}`}
            role="img"
            aria-label={zoneLabel}
            title={zoneLabel}
            style={{
              left: `${Math.max(0, (zone.start / duration) * 100)}%`,
              width: `${Math.max(0, ((Math.min(duration, zone.end) - Math.max(0, zone.start)) / duration) * 100)}%`,
            }}
          />
        )}
        <input
          aria-label="Seek in track"
          type="range"
          min="0"
          max={Math.max(player.duration || player.track?.duration || 0, 1)}
          step="0.1"
          value={Math.min(
            player.time || 0,
            player.duration || player.track?.duration || 1,
          )}
          onChange={(e) => player.seek(Number(e.target.value))}
          style={{
            "--progress": `${Math.min(100, ((player.time || 0) / (player.duration || player.track?.duration || 1)) * 100)}%`,
          }}
        />
      </div>
      <div className="timestamps">
        <span>{formatTime(player.time)}</span>
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

function Lyrics({ player }) {
  const reduce = useReducedMotion();
  const container = useRef(null);
  const activeRef = useRef(null);
  const [following, setFollowing] = useState(true);
  const lines = useMemo(() => player.lyrics?.lines?.length
    ? player.lyrics.lines
    : (player.lyrics?.plainLyrics || "")
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((text) => ({ text })), [player.lyrics]);
  const adjusted = (player.time || 0) + (player.lyricsOffset || 0);
  const timed = player.lyrics?.sync !== "plain";
  let active = -1;
  if (timed)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= adjusted) active = i;
      else break;
    }
  const previousEnd = active >= 0 ? lines[active].words?.at(-1)?.end : 0;
  const nextStart = lines[active + 1]?.time;
  const inGap =
    timed &&
    Number.isFinite(previousEnd) &&
    Number.isFinite(nextStart) &&
    nextStart - previousEnd > 4 &&
    adjusted >= previousEnd &&
    adjusted < nextStart;
  useEffect(() => {
    if (!following || !activeRef.current || !container.current) return;
    const target = activeRef.current;
    container.current.scrollTo({
      top:
        target.offsetTop -
        container.current.offsetTop -
        container.current.clientHeight * 0.35,
      behavior: reduce ? "instant" : "smooth",
    });
  }, [active, following, reduce]);
  const { getPlaybackTime, lyricsOffset = 0, lyricsLoading } = player;
  useEffect(() => {
    if (!container.current || !timed || lyricsLoading) return;
    const words = Array.from(container.current.querySelectorAll(".lyric-line"),
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
            // Lead the onset by at most 60ms, but finish exactly at the word's end.
            const lead = reduce ? 0 : Math.min(0.06, (word.end - word.start) * 0.15);
            const progress = reduce
              ? Number(time >= word.start)
              : Math.min(1, Math.max(0, (time - word.start + lead) / Math.max(0.001, word.end - word.start + lead)));
            fill.style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`;
            fill.parentElement.classList.toggle("singing", time >= word.start && time < word.end);
          });
        }
        previousTime = time;
        previousLine = currentLine;
      }
      frame = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(frame);
  }, [getPlaybackTime, lines, lyricsOffset, lyricsLoading, timed, reduce]);
  if (player.lyricsLoading)
    return (
      <div className="lyric-empty">
        <span className="lyric-loading">
          <i />
          <i />
          <i />
        </span>
        <p>Finding the words…</p>
      </div>
    );
  if (!lines.length)
    return (
      <div className="lyric-empty">
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
      </div>
    );
  return (
    <div className="lyrics-layout">
      <div
        className="lyrics-scroll"
        ref={container}
        onWheel={() => setFollowing(false)}
        onTouchStart={() => setFollowing(false)}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(e.key))
            setFollowing(false);
        }}
        tabIndex="0"
        aria-label="Song lyrics"
      >
        <div className="lyrics-spacer" />
        {lines.map((line, i) => (
          <button
            key={`${i}-${line.time}`}
            ref={i === active ? activeRef : null}
            className={`lyric-line ${i === active ? "current" : ""} ${i < active ? "past" : ""} ${!timed ? "plain" : ""}`}
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
                  <span
                    key={wi}
                    className="lyric-word"
                  >
                    <span>{word.text}</span>
                    <span
                      aria-hidden="true"
                      className="word-fill"
                    >
                      {word.text}
                    </span>
                  </span>
                ))
              : line.text}
          </button>
        ))}
        <div className="lyrics-spacer" />
      </div>
      <AnimatePresence>
        {inGap && (
          <Motion.div
            key="interlude"
            className="lyric-interlude"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-label="Instrumental break"
          >
            <Music2 size={18} />
            <span>Feel the music</span>
          </Motion.div>
        )}
      </AnimatePresence>
      <div className="lyric-footer">
        <span>
          {player.lyrics?.source || "Lyrics"} ·{" "}
          {player.lyrics?.sync === "word"
            ? "Word sync"
            : timed
              ? "Line sync"
              : "Unsynced"}
        </span>
        {!following && timed && (
          <button className="small-pill" onClick={() => setFollowing(true)}>
            Follow lyrics <ArrowDown size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Sheet({ title, close, back, children }) {
  const ref = useRef(null);
  const [isPresent, safeToRemove] = usePresence();
  const reduce = useReducedMotion();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <Motion.dialog
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: isPresent ? 1 : 0, y: isPresent ? 0 : 10 }}
      transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={() => {
        if (!isPresent) {
          ref.current?.close();
          safeToRemove?.();
        }
      }}
      ref={ref}
      className="sheet"
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
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
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
            if (info.offset.y > 45) close();
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

export default function App() {
  const player = usePlayer();
  const reduce = useReducedMotion();
  const [page, setPage] = useState("home");
  const [featured, setFeatured] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [immersive, setImmersive] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [video, setVideo] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [sheetParent, setSheetParent] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [favorites, setFavorites] = useState(() =>
    readSaved("aurora-favorites"),
  );
  const [recent, setRecent] = useState(() => readSaved("aurora-recent"));
  const [color, setColor] = useState("153, 93, 62");
  const [notice, setNotice] = useState("");
  const [featureIndex, setFeatureIndex] = useState(0);
  const searchRef = useRef(null);
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
        setResults([]);
        setSearching(false);
        setSearchError("");
        return;
      }
      setSearching(true);
      setSearchError("");
      searchTracks(query, controller.signal)
        .then(setResults)
        .catch((e) => {
          if (e.name !== "AbortError")
            setSearchError("Search couldn’t connect. Please try again.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
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
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setImmersive(false);
        setPage("search");
        setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (e.key === "Escape" && !sheet) setImmersive(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [sheet]);

  const persist = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      setNotice("Storage is full. Changes will last for this session.");
    }
  };
  const play = (track, list = [track]) => {
    player.loadTrack(track, list);
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
    setPage(next);
    setImmersive(false);
    if (next === "search") setTimeout(() => searchRef.current?.focus(), 0);
  };
  const addQueue = (track) => {
    player.addToQueue(track);
    setNotice("Added to your queue");
  };
  const trackRows = (tracks, queueMode = false) => (
    <div className="track-list">
      {tracks.map((track, i) => (
        <div
          className={`track-row ${player.track?.id === track.id ? "selected" : ""}`}
          key={`${track.id}-${i}`}
        >
          <button
            className="track-main"
            onClick={() => play(track, queueMode ? tracks : [track])}
          >
            <span className="track-number">
              {player.track?.id === track.id && player.playing ? (
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
        </div>
      ))}
    </div>
  );
  const browseTracks = page === "library" ? favorites : results;
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

  return (
    <MotionConfig reducedMotion="user">
      <Welcome />
      <div
        className={`aurora-app ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${immersive ? "is-immersive" : ""} ${video && immersive ? "has-video" : ""} ${video && showLyrics ? "video-with-lyrics" : ""}`}
        style={{ "--art-color": color }}
      >
        <div
          aria-hidden="true"
          className={`video-surface ${video && immersive ? "is-visible" : ""}`}
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
          {!immersive && (
            <>
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
              {page === "home" ? (
                <Motion.div
                  key="home"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="browse-content"
                >
                  <div className="page-heading">
                    <div>
                      <p>A little less noise. A little more music.</p>
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
                  <section
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
                  </section>
                  <section className="mood-section" aria-label="Browse by mood">
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
                  </section>
                  <section className="music-section">
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
                  </section>
                  {recent.length > 0 && (
                    <section className="music-section">
                      <div className="section-heading">
                        <h2>Back to your favorites</h2>
                        <span className="muted">Recently played</span>
                      </div>
                      {trackRows(recent.slice(0, 5))}
                    </section>
                  )}
                  <footer className="browse-footer">
                    <Brand />
                    <span>Stay a little longer.</span>
                    <span>Music is the whole point.</span>
                  </footer>
                </Motion.div>
              ) : (
                <Motion.div
                  key={page}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="browse-content search-page"
                >
                  <div className="page-heading">
                    <div>
                      <p>
                        {page === "search"
                          ? "There’s a song for that."
                          : "The music you keep close."}
                      </p>
                      <h1>
                        {page === "search"
                          ? "What’s on your mind?"
                          : "Your library"}
                        <span>.</span>
                      </h1>
                    </div>
                    {page === "library" && <Heart size={32} />}
                  </div>
                  {page === "search" && (
                    <label className="search-field">
                      <Search size={22} />
                      <input
                        ref={searchRef}
                        aria-label="Search songs or artists"
                        placeholder="Search songs, artists, a feeling…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <IconButton
                          label="Clear search"
                          onClick={() => setQuery("")}
                        >
                          <X size={18} />
                        </IconButton>
                      )}
                    </label>
                  )}
                  {searching && page === "search" ? (
                    <div className="empty-state">
                      <LoaderCircle className="spin" />
                      <p>Searching the catalogue…</p>
                    </div>
                  ) : searchError && page === "search" ? (
                    <div className="empty-state" role="alert">
                      <p>{searchError}</p>
                      <button
                        className="small-pill"
                        onClick={() => setQuery(`${query} `)}
                      >
                        Try again
                      </button>
                    </div>
                  ) : browseTracks.length ? (
                    <>
                      <div className="results-heading">
                        <h2>{page === "library" ? "Liked songs" : "Songs"}</h2>
                        <span>{browseTracks.length} tracks</span>
                      </div>
                      {trackRows(browseTracks)}
                    </>
                  ) : (
                    <div className="empty-state">
                      {page === "library" ? (
                        <Heart size={38} />
                      ) : (
                        <Search size={38} />
                      )}
                      <h2>
                        {page === "library"
                          ? "Keep the ones you love."
                          : query.trim().length > 1
                            ? "Nothing here just yet."
                            : "Follow your curiosity."}
                      </h2>
                      <p>
                        {page === "library"
                          ? "Tap the heart on any playing track. Your favorites stay on this device."
                          : query.trim().length > 1
                            ? "Try another song title or artist name."
                            : "Find an old favorite. Discover a new one."}
                      </p>
                      {page === "library" && (
                        <button
                          className="primary-button"
                          onClick={() => navigate("search")}
                        >
                          Find a song <ArrowRight size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </Motion.div>
              )}
            </>
          )}
          <AnimatePresence>
            {immersive && player.track && (
              <Motion.section
                key="immersive-player"
                exit={{ opacity: 0, y: 10, transition: { duration: 0.2 } }}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 220, damping: 28 }}
                className={`immersive-player ${showLyrics ? "with-lyrics" : ""} ${video ? "with-video" : ""}`}
                aria-label="Now playing"
              >
                <div
                  className="player-art-background"
                  style={{
                    backgroundImage: player.track.artwork
                      ? `url("${player.track.artwork}")`
                      : undefined,
                  }}
                />
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
                        onClick={() => setVideo(false)}
                      >
                        <Headphones size={19} />
                      </IconButton>
                      <IconButton
                        label="Video mode"
                        active={video}
                        disabled={!!player.track?.localUrl}
                        onClick={() => {
                          setVideo(!video);
                        }}
                      >
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
                    <Cover track={player.track} eager />
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
                          x: 8,
                          transition: { duration: 0.18 },
                        }}
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                        className="desktop-lyrics"
                      >
                        <Lyrics key={player.track.id} player={player} />
                      </Motion.div>
                    )}
                  </AnimatePresence>
                  <div className="mobile-player-info">
                    <FluidText as="h1">{player.track.title}</FluidText>
                    <p>{player.track.artist}</p>
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
                    <button
                      className={`dj-pill ${player.djEnabled ? "enabled" : ""}`}
                      onClick={() => setSheet("dj")}
                      aria-label="DJ transition settings"
                    >
                      <AudioLines size={16} />
                      <span>DJ transition</span>
                      <small>
                        {player.djEnabled
                          ? player.djState?.phase === "mixing"
                            ? "Mixing"
                            : "On"
                          : "Off"}
                      </small>
                    </button>
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
        {player.track && <div className="player-dock">
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
            <Cover track={player.track} />
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
        </div>
        }
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
                    <button
                      className={`dj-pill ${player.djEnabled ? "enabled" : ""}`}
                      onClick={() => setSheet("dj")}
                    >
                      <AudioLines size={16} />
                      DJ transition
                      <small>{player.djEnabled ? "On" : "Off"}</small>
                    </button>
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
              back={
                sheetParent === "settings"
                  ? () => {
                      setSheet("settings");
                      setSheetParent(null);
                    }
                  : undefined
              }
              close={() => {
                setSheet(null);
                setSheetParent(null);
              }}
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
              <div className="dj-now" role="status">
                <span className="dj-orbit">
                  <i />
                  <i />
                  <i />
                </span>
                <div>
                  <strong>
                    {player.djState?.label || "Ready when you are"}
                  </strong>
                  <p>
                    {player.djState?.fromBpm && player.djState?.toBpm
                      ? `${player.djState.fromBpm} → ${player.djState.toBpm} BPM · tempo blend`
                      : player.track?.localUrl
                        ? "Local audio · crossfade + filter sweep"
                        : "Online playback · gentle volume fade"}
                  </p>
                </div>
              </div>
              <p className="provider-note">
                Local files support a soft, hollow filter sweep and tempo
                adjustment when a steady beat can be measured. YouTube supports
                volume fading; it does not provide the audio access needed for
                these effects or precise tempo matching.
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
          {sheet === "settings" && (
            <Sheet
              key="settings"
              title="Make it yours"
              close={() => setSheet(null)}
            >
              <button
                className="dj-settings-link"
                onClick={() => {
                  setSheetParent("settings");
                  setSheet("dj");
                }}
              >
                <AudioLines />
                <span>
                  <strong>DJ transition</strong>
                  <small>Keep your music in flow</small>
                </span>
                <ChevronRight size={18} />
              </button>
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
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
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
