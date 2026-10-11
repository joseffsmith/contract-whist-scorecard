import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { sync, usePendingCount } from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { Sheet } from "./chrome/Sheet";

// Deletes the signed-in account for good. Games and scores stay for the
// people who played in them.
export const DeleteAccountSheet = ({ onClose }: { onClose: () => void }) => {
  const nav = useNavigate();
  const pending = usePendingCount();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = typed === "DELETE";

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await sync.deleteAccount();
      enqueueSnackbar("Your account was deleted", { variant: "success" });
      nav("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <form onSubmit={remove}>
        <div
          style={{
            fontFamily: t.display,
            fontSize: 20,
            fontWeight: 600,
            color: t.cream,
          }}
        >
          Delete your account?
        </div>
        <div
          style={{
            fontSize: 13,
            color: t.cream,
            opacity: 0.8,
            margin: "6px 0 14px",
            lineHeight: 1.45,
          }}
        >
          This can't be undone. You'll be signed out everywhere and your
          passkeys and password stop working. Games and scores stay for the
          people you played with, but your player is no longer yours.
          {pending > 0 &&
            ` You also have ${pending} change${pending === 1 ? "" : "s"} that ${
              pending === 1 ? "hasn't" : "haven't"
            } synced yet, which will be lost.`}
        </div>
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: alpha(t.shade, 0.3),
            border: `1px solid ${alpha(t.red, 0.5)}`,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: t.red,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Type DELETE to confirm
          </div>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            aria-label="Type DELETE to confirm"
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: t.cream,
              fontSize: 16,
              padding: 0,
            }}
          />
        </div>
        {error && (
          <div style={{ color: t.red, fontSize: 13, marginTop: 8 }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: "12px 0",
              borderRadius: 10,
              border: `1px solid ${alpha(t.gold, 0.4)}`,
              background: "transparent",
              color: t.cream,
              fontFamily: t.display,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            style={{
              ...goldButton,
              flex: 1,
              padding: "12px 0",
              borderRadius: 10,
              fontSize: 14,
              background: `linear-gradient(180deg, ${t.red}, #8a2a1e)`,
              color: t.cream,
              opacity: !ready || busy ? 0.5 : 1,
            }}
          >
            {busy ? "…" : "Delete account"}
          </button>
        </div>
      </form>
    </Sheet>
  );
};
