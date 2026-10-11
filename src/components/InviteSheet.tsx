import { enqueueSnackbar } from "notistack";
import { alpha, t } from "../theme/tokens";
import { QrCode } from "./chrome/QrCode";
import { Sheet } from "./chrome/Sheet";

export const joinUrl = (gameId: string) =>
  `${window.location.origin}${import.meta.env.BASE_URL}join/${gameId}`;

// Shows a QR code that others at the table scan to join this game from their
// own phone — no sign-up needed.
export const InviteSheet = ({
  gameId,
  onClose,
}: {
  gameId: string;
  onClose: () => void;
}) => {
  const url = joinUrl(gameId);
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join our whist game", url });
        return;
      } catch {
        // cancelled — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      enqueueSnackbar("Link copied", { variant: "success" });
    } catch {
      enqueueSnackbar(url);
    }
  };
  return (
    <Sheet onClose={onClose}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: t.display,
            fontSize: 22,
            fontWeight: 600,
            color: t.cream,
          }}
        >
          Join from your phone
        </div>
        <div
          style={{
            fontSize: 13,
            color: t.cream,
            opacity: 0.7,
            margin: "6px 0 16px",
          }}
        >
          Point your camera at the code. No sign-up needed.
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <QrCode value={url} size={Math.min(260, window.innerWidth - 80)} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={share}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${alpha(t.gold, 0.4)}`,
              background: "transparent",
              color: t.gold,
              fontSize: 13,
            }}
          >
            Share link
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${alpha(t.gold, 0.2)}`,
              background: "transparent",
              color: t.cream,
              fontSize: 13,
            }}
          >
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
};
