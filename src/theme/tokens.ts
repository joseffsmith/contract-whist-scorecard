// Card Table palette — dark felt green with warm cream panels and gold accents,
// plus a light variant. Source: Contract Whist Redesign (Pattern B + Direction 3).

// Colours are CSS custom properties defined in index.css (dark by default,
// overridden under html[data-theme="light"]) so the theme switches without
// re-rendering. See theme.ts for how the preference is applied.
const colors = {
  felt: "var(--wh-felt)",
  feltDk: "var(--wh-felt-dk)",
  panel: "var(--wh-panel)",
  panelDk: "var(--wh-panel-dk)",
  ink: "var(--wh-ink)",
  ink2: "var(--wh-ink2)",
  cream: "var(--wh-cream)",
  red: "var(--wh-red)",
  gold: "var(--wh-gold)",
  goldDk: "var(--wh-gold-dk)",
  // Solid gold for filled buttons/badges — stays bright in both themes.
  goldFill: "var(--wh-gold-fill)",
  onGold: "var(--wh-on-gold)",
  pos: "var(--wh-pos)",
  // Base colour for shadows and dark overlays.
  shade: "var(--wh-shade)",
};

export const t = {
  ...colors,
  font: '"Inter Tight", -apple-system, system-ui, sans-serif',
  display: '"Fraunces", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

// Translucent version of a theme colour (opacity 0–1). Works with CSS variables,
// unlike appending a hex alpha suffix.
export const alpha = (color: string, opacity: number): string =>
  `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`;

export const feltBg = {
  background: `radial-gradient(ellipse at top, ${t.felt} 0%, ${t.feltDk} 100%)`,
};

export const goldButton = {
  background: `linear-gradient(180deg, ${t.goldFill}, ${t.goldDk})`,
  color: t.onGold,
  fontFamily: t.display,
  fontWeight: 600,
  boxShadow: `0 6px 16px ${alpha(
    t.shade,
    0.35
  )}, inset 0 1px 0 rgba(255,255,255,0.3)`,
  border: "none",
  cursor: "pointer",
};

export const creamPanel = {
  background: `linear-gradient(180deg, ${t.panel}, ${t.panelDk})`,
  color: t.ink,
  boxShadow: `0 10px 30px ${alpha(
    t.shade,
    0.35
  )}, inset 0 1px 0 rgba(255,255,255,0.5)`,
};

// Map the original DEAL suit to a palette colour.
export const suitColor = (suit: string): string => {
  if (suit === "♥" || suit === "♦") return t.red;
  if (suit === "🚫" || suit === "NT") return t.gold;
  return t.cream;
};
