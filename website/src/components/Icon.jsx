import { T } from "../lib/theme.js";

/** Inline SVG icon set.
 *
 *  Inline rather than an icon package: the bundle stays small, strokes match
 *  the type weight, and every icon inherits currentColor so it picks up the
 *  surrounding text colour without extra props.
 *
 *  All paths are drawn on a 24×24 grid with round caps and joins, so they sit
 *  together at any size. Add new icons here rather than inlining one-offs in
 *  a component — a duplicated <svg> drifts out of step with the rest.
 */
const PATHS = {
  /* analysis + product */
  target:   ["M12 3v3M12 18v3M3 12h3M18 12h3",
             "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
             "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z"],
  compass:  ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
             "M15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5Z"],
  trend:    ["M3 17l5.5-5.5 3.5 3.5L21 6", "M15 6h6v6"],
  chart:    ["M4 20V10M10 20V4M16 20v-7M22 20H2"],
  radar:    ["M12 2 21 8v8l-9 6-9-6V8l9-6Z", "M12 7l5 3.5v5L12 19l-5-3.5v-5L12 7Z"],
  layers:   ["M12 3 3 8l9 5 9-5-9-5Z", "M3 14l9 5 9-5", "M3 11l9 5 9-5"],

  /* people */
  users:    ["M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
             "M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
             "M22 20v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  user:     ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",
             "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],

  /* state */
  check:    ["M20 6 9 17l-5-5"],
  checkCircle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.5 2.5 4.5-4.7"],
  cross:    ["M18 6 6 18M6 6l12 12"],
  lock:     ["M4 11h16v10H4z", "M8 11V7a4 4 0 1 1 8 0v4"],
  unlock:   ["M4 11h16v10H4z", "M8 11V7a4 4 0 0 1 7.5-2"],
  clock:    ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  alert:    ["M12 3 1.8 21h20.4L12 3Z", "M12 9v5M12 18h.01"],
  sparkle:  ["M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3Z"],
  bolt:     ["M13 2 4 14h7l-1 8 9-12h-7l1-8Z"],
  gift:     ["M20 12v9H4v-9", "M2 8h20v4H2z", "M12 21V8",
             "M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5h4Z",
             "M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5h-4Z"],
  tag:      ["M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z", "M7.5 7.5h.01"],
  refresh:  ["M21 12a9 9 0 0 1-15.3 6.4L3 16", "M3 12a9 9 0 0 1 15.3-6.4L21 8",
             "M3 21v-5h5", "M21 3v5h-5"],
  calendar: ["M4 6h16v15H4z", "M4 10h16", "M8 3v4M16 3v4"],
  search:   ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "M21 21l-4.3-4.3"],
  filter:   ["M3 5h18l-7 8v6l-4 2v-8L3 5Z"],
  sort:     ["M7 4v16M7 20l-3-3M7 4l3 3", "M17 20V4M17 4l3 3M17 20l-3-3"],
  arrowUp:  ["M12 19V5", "M5 12l7-7 7 7"],
  arrowRight: ["M5 12h14", "M12 5l7 7-7 7"],
  external: ["M15 3h6v6", "M10 14 21 3", "M21 14v7H3V3h7"],
  chevron:  ["M6 9l6 6 6-6"],
  shield:   ["M12 2 4 5.5V11c0 5 3.4 9.3 8 10.5 4.6-1.2 8-5.5 8-10.5V5.5L12 2Z",
             "M9 12l2 2 4-4"],
  flame:    ["M12 22c4 0 6.5-2.6 6.5-6 0-4-3.5-5.5-3-10-3 1.5-5 4-5 6.5 0 1 .3 1.8.8 2.5-1-.4-1.8-1.3-2.3-2.4-1.2 1.3-2 3-2 4.9 0 3.4 2.5 4.5 5 4.5Z"],
};

export default function Icon({
  name, size = 20, color = "currentColor", strokeWidth = 1.7, style,
}) {
  const paths = PATHS[name];
  if (!paths) return null;          // an unknown name renders nothing, not a box
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color === "currentColor" ? "currentColor" : color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden focusable="false"
      style={{ flexShrink: 0, display: "block", ...style }}
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** Icon in a tinted rounded tile — used for feature and step headers. */
export function IconTile({ name, color = T.accent, size = 38, iconSize = 18 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: size * 0.3,
      display: "grid", placeItems: "center", flexShrink: 0,
      background: `${color}14`, border: `1px solid ${color}33`,
      color,
    }}>
      <Icon name={name} size={iconSize} strokeWidth={1.8} />
    </span>
  );
}

export const ICON_NAMES = Object.keys(PATHS);
