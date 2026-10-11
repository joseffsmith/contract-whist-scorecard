import { alpha, t } from "../../theme/tokens";
import { ThemePref, useTheme } from "../../theme/theme";

// Round sun/moon button that flips between light and dark.
export const ThemeToggle = ({ size = 28 }: { size?: number }) => {
  const { resolved, toggle } = useTheme();
  const next = resolved === "light" ? "dark" : "light";
  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        border: `1px solid ${alpha(t.gold, 0.33)}`,
        color: t.gold,
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        lineHeight: 1,
        padding: 0,
        flexShrink: 0,
      }}
    >
      {resolved === "light" ? "☾" : "☀"}
    </button>
  );
};

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

// Segmented Dark / Light / System control for the account page.
export const ThemePicker = () => {
  const { pref, setPref } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${OPTIONS.length}, 1fr)`,
        gap: 4,
        padding: 3,
        borderRadius: 10,
        background: alpha(t.shade, 0.22),
        border: `1px solid ${alpha(t.gold, 0.13)}`,
      }}
    >
      {OPTIONS.map((o) => {
        const is = o.value === pref;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={is}
            onClick={() => setPref(o.value)}
            style={{
              padding: "8px 0",
              borderRadius: 8,
              border: "none",
              background: is ? t.goldFill : "transparent",
              color: is ? t.onGold : t.cream,
              opacity: is ? 1 : 0.7,
              fontSize: 13,
              fontWeight: is ? 700 : 500,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};
