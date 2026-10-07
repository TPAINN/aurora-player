import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { SESSION_KEY, shouldWelcome } from "../lib/welcome";

const EASE = [0.22, 1, 0.36, 1];
const GLIDE = [0.65, 0, 0.35, 1];
// The wordmark's letters span this share of the image's width (the rest is margin).
const INK = 0.96;

// Where the wordmark should fly to: the app's own brand mark, wherever it shows
// (the sidebar on large screens, the header on phones). Null when none is visible.
function brandTarget(image) {
  if (!image) return null;
  const from = image.getBoundingClientRect();
  const brand = [...document.querySelectorAll(".brand-button .brand, .mobile-brand .brand")].find((node) => {
    const box = node.getBoundingClientRect();
    return box.width > 20 && box.height > 8 && getComputedStyle(node).visibility !== "hidden";
  });
  if (!brand || !from.width) return null;
  const to = brand.getBoundingClientRect();
  return {
    x: to.left + to.width / 2 - (from.left + from.width / 2),
    y: to.top + to.height / 2 - (from.top + from.height / 2),
    scale: to.width / (from.width * INK),
  };
}

// One continuous gesture: the wordmark writes itself, holds briefly, then glides
// into the app's own brand mark while the veil lifts and the app fades up
// underneath. Any tap or key skips ahead.
export default function Welcome({ onLeave }) {
  const [visible, setVisible] = useState(shouldWelcome);
  const [flight, setFlight] = useState(null);
  const image = useRef(null);

  useEffect(() => {
    if (!visible) return;
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Storage can be disabled; the welcome still expires normally.
    }
    // The flight is measured first (its exit needs it), then the welcome leaves on
    // the next frame.
    let leaving = false;
    const leave = () => {
      if (leaving) return;
      leaving = true;
      setFlight(brandTarget(image.current));
      requestAnimationFrame(() => setVisible(false));
    };
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreference = (event) => {
      if (event.matches) leave();
    };
    // The writing ends at about 1.6 s; the word holds a moment before it leaves.
    const timer = window.setTimeout(leave, 2000);
    window.addEventListener("pointerdown", leave, { passive: true });
    window.addEventListener("keydown", leave);
    preference.addEventListener("change", onPreference);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", leave);
      window.removeEventListener("keydown", leave);
      preference.removeEventListener("change", onPreference);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) onLeave?.();
  }, [visible, onLeave]);

  return (
    <AnimatePresence>
      {visible && (
        <Motion.div
          key="welcome"
          aria-hidden="true"
          className="aurora-welcome"
          initial={{ opacity: 1 }}
          // With a flight only the veil's colour fades, so the flying wordmark stays
          // crisp while the app shows through; otherwise the whole veil fades.
          exit={flight ? { backgroundColor: "rgba(17, 19, 20, 0)", transition: { duration: 0.85, ease: EASE, delay: 0.05 } } : { opacity: 0, transition: { duration: 0.8, ease: EASE, delay: 0.08 } }}
        >
          <Motion.span
            className="welcome-glow"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 1.6, ease: EASE } }}
            exit={{ opacity: 0, scale: 1.25, transition: { duration: 0.9, ease: EASE } }}
          />
          <Motion.img
            ref={image}
            src="/aurora-welcome.svg"
            alt=""
            width="466"
            height="94"
            onError={() => setVisible(false)}
            initial={{ opacity: 0, y: 10, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { duration: 0.9, ease: EASE } }}
            exit={
              flight
                ? // Glides into the brand mark and hands over to it as it lands.
                  { x: flight.x, y: flight.y, scale: flight.scale, opacity: [1, 1, 0], transition: { duration: 0.95, ease: GLIDE, opacity: { duration: 0.95, times: [0, 0.78, 1] } } }
                : { opacity: 0, y: -14, scale: 1.04, filter: "blur(8px)", transition: { duration: 0.7, ease: EASE } }
            }
          />
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
