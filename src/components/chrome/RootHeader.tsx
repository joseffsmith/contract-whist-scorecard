import { Link } from "react-router-dom";
import { goldButton, t } from "../../theme/tokens";

const TABS = [
  { id: "home", label: "Home", to: "/" },
  { id: "games", label: "Games", to: "/games" },
  { id: "board", label: "Board", to: "/leaderboard" },
  { id: "you", label: "You", to: "/user" },
] as const;

export type RootTabId = (typeof TABS)[number]["id"];

export const RootHeader = ({
  activeTab,
  onDeal,
  connection,
}: {
  activeTab: RootTabId;
  onDeal: () => void;
  connection: "connected" | "authenticating" | "closed" | "errored" | "unexpected state";
}) => {
  const dotColor =
    connection === "connected"
      ? "#6fbf6a"
      : connection === "authenticating"
      ? t.gold
      : t.red;

  return (
    <div style={{ flexShrink: 0 }}>
      <div
        style={{
          padding: "12px 16px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              position: "relative",
              width: 30,
              height: 30,
              borderRadius: 8,
              background: t.feltDk,
              border: `1px solid ${t.gold}66`,
              color: t.gold,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontFamily: t.display,
              fontWeight: 700,
            }}
          >
            ♣
            <span
              title={connection}
              style={{
                position: "absolute",
                right: -2,
                bottom: -2,
                width: 8,
                height: 8,
                borderRadius: 4,
                background: dotColor,
                border: `1.5px solid ${t.feltDk}`,
              }}
            />
          </div>
          <div
            style={{
              fontFamily: t.display,
              fontSize: 16,
              color: t.cream,
              fontWeight: 600,
            }}
          >
            Whist
          </div>
        </div>
        <button
          onClick={onDeal}
          style={{
            ...goldButton,
            borderRadius: 20,
            padding: "8px 14px",
            fontSize: 13,
          }}
        >
          + Deal
        </button>
      </div>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "4px 12px 0",
          borderBottom: `1px solid ${t.gold}22`,
        }}
      >
        {TABS.map((tab) => {
          const is = tab.id === activeTab;
          return (
            <Link
              key={tab.id}
              to={tab.to}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "10px 0 12px",
                borderBottom: is
                  ? `2px solid ${t.gold}`
                  : "2px solid transparent",
                color: is ? t.gold : t.cream,
                opacity: is ? 1 : 0.55,
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: is ? 700 : 500,
                marginBottom: -1,
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
};
