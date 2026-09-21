import { T } from "../lib/theme.js";

/** Brand mark: angle brackets framing three ascending bars with a trend line
 *  rising out of them — code, growth, analysis.
 *
 *  Drawn as SVG rather than shipped as a raster so it stays crisp at every
 *  size, needs no extra request, and can recolour for dark or light contexts.
 */
export function LogoMark({ size = 30, bracketColor, id = "cfa" }) {
  // Unique gradient ids: two marks on one page would otherwise share, and the
  // second would inherit the first's colours.
  const gBar = `${id}-bar`;
  const gLine = `${id}-line`;
  const bracket = bracketColor || T.text;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none"
         aria-hidden focusable="false" style={{ flexShrink: 0, display: "block" }}>
      <defs>
        <linearGradient id={gBar} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%"   stopColor="#2E9BFF" />
          <stop offset="55%"  stopColor="#3B5BFF" />
          <stop offset="100%" stopColor="#7A3BFF" />
        </linearGradient>
        <linearGradient id={gLine} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%"   stopColor="#2E9BFF" />
          <stop offset="100%" stopColor="#7A3BFF" />
        </linearGradient>
      </defs>

      {/* Angle brackets, pushed to the edges and thinned so the bars inside
          stay legible at 28px in the header. */}
      <path d="M18 17 L7 32 L18 47" stroke={bracket} strokeWidth="6"
            strokeLinecap="round" strokeLinejoin="round" />
      <path d="M46 17 L57 32 L46 47" stroke={bracket} strokeWidth="6"
            strokeLinecap="round" strokeLinejoin="round" />

      {/* ascending bars */}
      <rect x="23"   y="39" width="6.4" height="11" rx="2.1" fill={`url(#${gBar})`} />
      <rect x="31.3" y="33" width="6.4" height="17" rx="2.1" fill={`url(#${gBar})`} />
      <rect x="39.6" y="27" width="6.4" height="23" rx="2.1" fill={`url(#${gBar})`} />

      {/* trend line rising out of the bars */}
      <path d="M23.5 34 L34.5 28 L44 19" stroke={`url(#${gLine})`} strokeWidth="2.6"
            strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34.5" cy="28" r="3" fill="#3B5BFF" />
      <circle cx="44.5" cy="19" r="3.5" fill="#7A3BFF" />
    </svg>
  );
}

/** Mark plus wordmark, as the logo is drawn: "CF" in blue, "Analyzer" in ink. */
export default function Logo({ size = 27, showText = true, textSize }) {
  const fs = textSize || size * 0.62;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <LogoMark size={size} />
      {showText && (
        <span style={{ fontWeight: 800, fontSize: fs, letterSpacing: -0.5,
                       whiteSpace: "nowrap", lineHeight: 1 }}>
          <span style={{ color: "#2E6BFF" }}>CF</span>
          <span style={{ color: T.text }}>Analyzer</span>
        </span>
      )}
    </span>
  );
}
