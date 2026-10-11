import { CSSProperties, ReactNode } from "react";
import { alpha, t } from "../theme/tokens";

// Small building blocks shared by the stats pages. Same look as the board and
// players pages: gold section labels, shaded rounded cards, theme tokens only.

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      fontSize: 10,
      color: t.gold,
      letterSpacing: "0.2em",
      textTransform: "uppercase",
      fontWeight: 700,
      margin: "18px 2px 8px",
    }}
  >
    {children}
  </div>
);

export const Card = ({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) => (
  <div
    style={{
      padding: "12px 14px",
      borderRadius: 12,
      background: alpha(t.shade, 0.22),
      border: `1px solid ${alpha(t.gold, 0.13)}`,
      ...style,
    }}
  >
    {children}
  </div>
);

// Label / big value / small caption, for two-column grids of numbers.
export const Tile = ({
  label,
  value,
  sub,
  hint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  // Sample size; shown (muted) only when it is small.
  hint?: number;
}) => (
  <div style={{ minWidth: 0 }}>
    <div
      style={{
        fontSize: 10,
        color: t.cream,
        opacity: 0.55,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontFamily: t.display,
        fontSize: 24,
        fontWeight: 600,
        color: t.cream,
        marginTop: 2,
        lineHeight: 1.15,
      }}
    >
      {value}
      {hint !== undefined && <SmallN n={hint} />}
    </div>
    {sub && (
      <div
        style={{ fontSize: 11, color: t.cream, opacity: 0.55, marginTop: 2 }}
      >
        {sub}
      </div>
    )}
  </div>
);

export const TileGrid = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "14px 12px",
    }}
  >
    {children}
  </div>
);

// Shows the sample size when it is too small to trust.
export const SMALL_SAMPLE = 10;
export const SmallN = ({ n }: { n: number }) =>
  n < SMALL_SAMPLE ? (
    <span
      style={{
        fontFamily: t.font,
        fontSize: 10,
        fontWeight: 400,
        color: t.cream,
        opacity: 0.5,
        marginLeft: 5,
      }}
    >
      n={n}
    </span>
  ) : null;

export const Bar = ({
  value,
  color,
  height = 6,
}: {
  // 0..1
  value: number;
  color?: string;
  height?: number;
}) => (
  <div
    style={{
      height,
      borderRadius: height / 2,
      background: alpha(t.shade, 0.3),
      overflow: "hidden",
    }}
  >
    <div
      style={{
        width: `${Math.max(0, Math.min(1, value)) * 100}%`,
        height: "100%",
        background: color ?? alpha(t.gold, 0.53),
      }}
    />
  </div>
);

export const Divider = () => (
  <div
    style={{
      height: 1,
      background: alpha(t.gold, 0.1),
      margin: "12px 0",
    }}
  />
);

export const pct = (x: number | null): string =>
  x === null ? "—" : `${Math.round(x * 100)}%`;

export const num = (x: number | null, digits = 1): string =>
  x === null ? "—" : x.toFixed(digits);

// "11 Oct", or "11 Oct ’25" when it isn't this year.
export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const year =
    d.getFullYear() === new Date().getFullYear()
      ? ""
      : ` ’${String(d.getFullYear()).slice(-2)}`;
  return `${d.getDate()} ${month}${year}`;
};

export const mutedText: CSSProperties = {
  fontSize: 13,
  color: t.cream,
  opacity: 0.6,
  lineHeight: 1.45,
};
