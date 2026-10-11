import { alpha, t } from "../../theme/tokens";

// Persistent strip shown when the app can't save to this device.
export const StorageWarning = () => (
  <div
    role="alert"
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: "6px 12px",
      background: alpha(t.red, 0.25),
      borderBottom: `1px solid ${alpha(t.red, 0.5)}`,
      fontSize: 12,
      color: t.cream,
      textAlign: "center",
      fontFamily: t.font,
      flexShrink: 0,
    }}
  >
    Not saving on this device — keep this tab open until you're back online.
  </div>
);
