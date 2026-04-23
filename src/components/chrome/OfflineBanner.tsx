import { useEffect, useState } from "react";
import { t } from "../../theme/tokens";

type Connection =
  | "connected"
  | "authenticating"
  | "closed"
  | "errored"
  | "unexpected state";

// Show after the connection has been down for a moment — avoids flickering
// during the transient "connecting" states at startup and brief blips.
const SHOW_AFTER_MS = 1000;

export const OfflineBanner = ({ connection }: { connection: Connection }) => {
  const isOffline =
    connection === "closed" ||
    connection === "errored" ||
    connection === "unexpected state";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isOffline) {
      setVisible(false);
      return;
    }
    const tmr = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(tmr);
  }, [isOffline]);

  return (
    <div
      aria-hidden={!visible}
      style={{
        maxHeight: visible ? 28 : 0,
        overflow: "hidden",
        transition: "max-height 220ms ease-out",
        flexShrink: 0,
      }}
    >
      <div
        role="status"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "5px 12px",
          background: "rgba(0,0,0,0.45)",
          borderBottom: `1px solid ${t.gold}22`,
          fontSize: 11,
          color: t.cream,
          opacity: 0.75,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontFamily: t.font,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: t.red,
            opacity: 0.85,
          }}
        />
        <span style={{ fontWeight: 500 }}>Offline</span>
        <span style={{ opacity: 0.55, textTransform: "none", letterSpacing: 0 }}>
          — changes will sync when you reconnect
        </span>
      </div>
    </div>
  );
};
