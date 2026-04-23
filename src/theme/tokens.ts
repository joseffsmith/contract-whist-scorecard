// Card Table palette — dark felt green with warm cream panels and gold accents.
// Source: Contract Whist Redesign (Pattern B + Direction 3).

export const t = {
  felt: "#0f3a2e",
  feltDk: "#0a2a21",
  panel: "#f4ecd9",
  panelDk: "#e5d9bc",
  ink: "#151310",
  ink2: "#4a4238",
  cream: "#f6ebcf",
  red: "#c83a2a",
  gold: "#c8a24a",
  goldDk: "#8a6a24",
  pos: "#6fbf6a",
  font: '"Inter Tight", -apple-system, system-ui, sans-serif',
  display: '"Fraunces", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const feltBg = {
  background: `radial-gradient(ellipse at top, ${t.felt} 0%, ${t.feltDk} 100%)`,
};

export const goldButton = {
  background: `linear-gradient(180deg, ${t.gold}, ${t.goldDk})`,
  color: t.feltDk,
  fontFamily: t.display,
  fontWeight: 600,
  boxShadow:
    "0 6px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.3)",
  border: "none",
  cursor: "pointer",
};

export const creamPanel = {
  background: `linear-gradient(180deg, ${t.panel}, ${t.panelDk})`,
  color: t.ink,
  boxShadow:
    "0 10px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.5)",
};

// Map the original DEAL suit to a palette colour.
export const suitColor = (suit: string): string => {
  if (suit === "♥" || suit === "♦") return t.red;
  if (suit === "🚫" || suit === "NT") return t.gold;
  return t.cream;
};
