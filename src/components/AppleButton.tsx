import { useTheme } from "../theme/theme";

// Apple's sign-in button: white on the dark felt, black on the light theme,
// as Apple's guidelines ask (same size as the other sign-in buttons).
export const AppleButton = ({
  onClick,
  busy,
  label = "Continue with Apple",
}: {
  onClick: () => void;
  busy?: boolean;
  label?: string;
}) => {
  const light = useTheme().resolved === "light";
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        width: "100%",
        padding: "15px 0",
        borderRadius: 12,
        border: "none",
        background: light ? "#000" : "#fff",
        color: light ? "#fff" : "#000",
        fontFamily: "-apple-system, system-ui, sans-serif",
        fontSize: 16,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        opacity: busy ? 0.5 : 1,
      }}
    >
      <svg
        width="17"
        height="20"
        viewBox="0 0 17 20"
        aria-hidden="true"
        fill="currentColor"
      >
        <path d="M14.06 10.62c-.02-2.1 1.72-3.12 1.8-3.17-.98-1.43-2.5-1.63-3.05-1.65-1.3-.13-2.53.76-3.19.76-.66 0-1.67-.74-2.75-.72-1.41.02-2.72.82-3.44 2.09-1.47 2.55-.38 6.32 1.05 8.39.7 1.01 1.53 2.15 2.62 2.11 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-1.03 2.54-2.05.8-1.17 1.13-2.3 1.15-2.36-.03-.01-2.2-.84-2.22-3.35zM11.98 4.46c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.53.62-1 1.61-.88 2.56.93.07 1.88-.47 2.46-1.16z" />
      </svg>
      {busy ? "…" : label}
    </button>
  );
};
