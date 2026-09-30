import { useEffect, useState } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { SESSION_KEY, shouldWelcome } from "../lib/welcome";

const EASE = [0.22, 1, 0.36, 1];

// One continuous gesture: the wordmark writes itself, holds briefly, then the
// veil lifts while the app fades up underneath. Any tap or key skips ahead.
export default function Welcome({ onLeave }) {
  const [visible, setVisible] = useState(shouldWelcome);

  useEffect(() => {
    if (!visible) return;
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Storage can be disabled; the welcome still expires normally.
    }
    const leave = () => setVisible(false);
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreference = (event) => {
      if (event.matches) leave();
    };
    const timer = window.setTimeout(leave, 1750);
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
          exit={{ opacity: 0, transition: { duration: 0.8, ease: EASE, delay: 0.08 } }}
        >
          <Motion.span
            className="welcome-glow"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 1.6, ease: EASE } }}
            exit={{ opacity: 0, scale: 1.25, transition: { duration: 0.9, ease: EASE } }}
          />
          <Motion.img
            src="/aurora-welcome.svg"
            alt=""
            width="466"
            height="94"
            onError={() => setVisible(false)}
            initial={{ opacity: 0, y: 10, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { duration: 0.9, ease: EASE } }}
            exit={{ opacity: 0, y: -14, scale: 1.04, filter: "blur(8px)", transition: { duration: 0.7, ease: EASE } }}
          />
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
