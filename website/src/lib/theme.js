// Design tokens. Dark, high-contrast, restrained accent use — the palette is
// built so that colour always carries meaning (strength, risk, progress) rather
// than decoration.

export const T = {
  bg:        "#07080B",
  bgAlt:     "#0B0D12",
  surface:   "#101318",
  surfaceHi: "#161A21",
  border:    "#1E232C",
  borderHi:  "#2A313C",

  text:      "#F2F5F9",
  textDim:   "#98A2B3",
  textFaint: "#5A6474",

  accent:    "#6E8BFF",   // primary actions, focus
  accentDim: "#3A4BA0",
  violet:    "#A97BFF",
  cyan:      "#4ED8E6",

  good:      "#3FD68C",   // strong skill
  warn:      "#FFC24B",   // developing
  risk:      "#FF6B6B",   // needs work

  radius:    14,
  radiusSm:  10,
};

/** Score → colour + human label. One place, so the whole app agrees. */
export function band(score) {
  if (score >= 75) return { color: T.good,  label: "Strong",     tone: "strong" };
  if (score >= 55) return { color: T.cyan,  label: "Solid",      tone: "solid" };
  if (score >= 35) return { color: T.warn,  label: "Developing", tone: "developing" };
  return               { color: T.risk,  label: "Needs work", tone: "weak" };
}

export const font = {
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
};
