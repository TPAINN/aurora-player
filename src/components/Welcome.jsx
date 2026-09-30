import { useEffect, useState } from "react";
import { motion as Motion } from "framer-motion";

const SESSION_KEY = "aurora:welcome-seen";

function shouldWelcome() {
  if (
    typeof window === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return false;
  try {
    return sessionStorage.getItem(SESSION_KEY) !== "1";
  } catch {
    return true;
  }
}

export default function Welcome() {
  const [visible, setVisible] = useState(shouldWelcome);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Storage can be disabled; the welcome still expires normally.
    }
    const dismiss = () => setVisible(false);
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreference = (event) => {
      if (event.matches) dismiss();
    };
    const fade = window.setTimeout(() => setLeaving(true), 1500);
    const finish = window.setTimeout(dismiss, 1800);
    window.addEventListener("pointerdown", dismiss, { passive: true });
    window.addEventListener("keydown", dismiss);
    preference.addEventListener("change", onPreference);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(finish);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismiss);
      preference.removeEventListener("change", onPreference);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <Motion.div
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.28 }}
      aria-hidden="true"
      className="aurora-welcome"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        pointerEvents: "none",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(ellipse at center, #292b2d, #111314)",
      }}
    >
      <img
        src="/aurora-welcome.svg"
        alt=""
        width="466"
        height="94"
        onError={() => setVisible(false)}
        style={{ width: "min(72vw, 365px)", height: "auto" }}
      />
    </Motion.div>
  );
}
