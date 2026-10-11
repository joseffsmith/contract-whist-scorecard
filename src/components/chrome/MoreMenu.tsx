import { useState } from "react";
import { alpha, t } from "../../theme/tokens";

// Round "⋯" button that opens a small dropdown of actions.
export const MoreMenu = ({
  items,
}: {
  items: { label: string; onClick: () => void }[];
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More"
        aria-expanded={open}
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          border: `1px solid ${alpha(t.gold, 0.33)}`,
          color: t.gold,
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          padding: 0,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 32,
            right: 0,
            padding: 4,
            borderRadius: 8,
            background: t.feltDk,
            border: `1px solid ${alpha(t.gold, 0.33)}`,
            boxShadow: `0 10px 20px ${alpha(t.shade, 0.5)}`,
            minWidth: 140,
            zIndex: 10,
          }}
        >
          {items.map((item) => (
            <div
              key={item.label}
              role="button"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                color: t.cream,
                cursor: "pointer",
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
