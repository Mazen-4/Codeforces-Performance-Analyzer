import { motion } from "framer-motion";
import { T } from "../lib/theme.js";

/** Slow drifting gradient field used behind heroes. Pure CSS/transform, so it
 *  stays cheap; disabled for users who ask for reduced motion. */
export default function Aurora({ intensity = 1.9 }) {
  const reduce = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const blobs = [
    { c: T.accent, size: 620, x: "12%",  y: "8%",  dur: 26 },
    { c: T.violet, size: 540, x: "68%",  y: "2%",  dur: 32 },
    { c: T.cyan,   size: 420, x: "42%",  y: "46%", dur: 38 },
  ];

  return (
    <div aria-hidden style={{
      position: "absolute", inset: 0, overflow: "hidden",
      pointerEvents: "none", zIndex: 0,
    }}>
      {blobs.map((b, i) => (
        <motion.div
          key={i}
          animate={reduce ? undefined : {
            x: [0, 40, -25, 0], y: [0, -30, 20, 0], scale: [1, 1.08, 0.96, 1],
          }}
          transition={reduce ? undefined : {
            duration: b.dur, repeat: Infinity, ease: "easeInOut",
          }}
          style={{
            position: "absolute", left: b.x, top: b.y,
            width: b.size, height: b.size, borderRadius: "50%",
            background: `radial-gradient(circle, ${b.c}${Math.round(30 * intensity).toString(16).padStart(2,"0")} 0%, transparent 68%)`,
            filter: "blur(80px)",
          }}
        />
      ))}
      {/* Fine grain keeps large flat areas from banding. */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.35,
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E\")",
        mixBlendMode: "overlay",
      }} />
    </div>
  );
}
