import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../theme/tokens";

export type CrumbPart = { label: ReactNode; to?: string };

export const Crumb = ({
  trail,
  right,
  onBack,
}: {
  trail: CrumbPart[];
  right?: ReactNode;
  onBack?: () => void;
}) => {
  const nav = useNavigate();
  const handleBack = onBack ?? (() => nav(-1));
  return (
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        borderBottom: `1px solid ${t.gold}33`,
        flexShrink: 0,
      }}
    >
      <button
        onClick={handleBack}
        aria-label="Back"
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          border: `1px solid ${t.gold}55`,
          color: t.gold,
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          padding: 0,
        }}
      >
        ‹
      </button>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        {trail.map((part, i) => {
          const last = i === trail.length - 1;
          if (last) {
            return (
              <span
                key={i}
                style={{
                  fontFamily: t.display,
                  fontSize: 15,
                  color: t.cream,
                  fontWeight: 600,
                  minWidth: 0,
                }}
              >
                {part.label}
              </span>
            );
          }
          const item = (
            <span
              style={{
                fontSize: 11,
                color: t.gold,
                opacity: 0.7,
                cursor: part.to ? "pointer" : "default",
              }}
            >
              {part.label}
            </span>
          );
          return (
            <span
              key={i}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {part.to ? (
                <span onClick={() => nav(part.to!)}>{item}</span>
              ) : (
                item
              )}
              <span style={{ fontSize: 10, color: t.gold, opacity: 0.4 }}>
                ›
              </span>
            </span>
          );
        })}
      </div>
      {right}
    </div>
  );
};
