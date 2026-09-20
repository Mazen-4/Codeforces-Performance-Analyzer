import { T } from "../lib/theme.js";

/** Small inline SVG set. Inline rather than an icon package so the bundle
 *  stays small and the strokes match the type weight. */
const PATHS = {
  target: [
    "M12 3v3M12 18v3M3 12h3M18 12h3",
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z",
  ],
  compass: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    "M15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5Z",
  ],
  trend: [
    "M3 17l5.5-5.5 3.5 3.5L21 6",
    "M15 6h6v6",
  ],
};

export default function Icon({ name, size = 20, color = T.text, strokeWidth = 1.7 }) {
  const paths = PATHS[name] || [];
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
