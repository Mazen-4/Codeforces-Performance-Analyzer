import { m } from "framer-motion";
import { T } from "../lib/theme.js";

/** Slow drifting gradient field used behind heroes. Pure CSS/transform, so it
 *  stays cheap; disabled for users who ask for reduced motion. */
export default function Aurora({ intensity = 1.9 }) {
  const reduce = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Two blobs, not three: each one is a large blurred surface and the cost is
  // per-pixel, so the third was the most expensive decoration in the app.
  const blobs = [
    { c: T.accent, size: 620, x: "12%", y: "8%", dur: 30 },
    { c: T.violet, size: 540, x: "64%", y: "2%", dur: 38 },
  ];

  return (
    <div aria-hidden style={{
      position: "absolute", inset: 0, overflow: "hidden",
      pointerEvents: "none", zIndex: 0,
    }}>
      {blobs.map((b, i) => (
        <m.div
          key={i}
          // Translate only. Animating scale re-rasterises the blurred layer on
          // every frame; translation can be handled by the compositor.
          animate={reduce ? undefined : { x: [0, 38, -22, 0], y: [0, -26, 18, 0] }}
          transition={reduce ? undefined : {
            duration: b.dur, repeat: Infinity, ease: "easeInOut",
          }}
          style={{
            position: "absolute", left: b.x, top: b.y,
            width: b.size, height: b.size, borderRadius: "50%",
            background: `radial-gradient(circle, ${b.c}${Math.round(30 * intensity).toString(16).padStart(2,"0")} 0%, transparent 68%)`,
            filter: "blur(64px)",
            // Promote to its own compositor layer so the blur is rasterised
            // once rather than on every frame of the drift.
            willChange: "transform",
          }}
        />
      ))}
      {/* Grain removed: an SVG turbulence filter stretched across the viewport
          costs real paint time for a texture that is barely perceptible. */}
    </div>
  );
}
