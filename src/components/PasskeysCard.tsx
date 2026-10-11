import { enqueueSnackbar } from "notistack";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deviceName } from "../lib/deviceName";
import { passkeysSupported, sync, useAuth, usePreparedPasskeys } from "../sync";
import type { PasskeyInfo } from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { Sheet } from "./chrome/Sheet";

const showError = (e: Error) =>
  enqueueSnackbar(e.message, { variant: "error" });

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const outlineButton = {
  width: "100%",
  padding: "12px 0",
  borderRadius: 10,
  border: `1px solid ${alpha(t.gold, 0.4)}`,
  background: "transparent",
  color: t.cream,
  fontFamily: t.display,
  fontSize: 14,
  fontWeight: 600,
} as const;

// Adds a passkey for the signed-in user. A dismissed prompt does nothing.
// The options are fetched ahead and the tap calls straight in with nothing
// awaited first, because Safari only opens the prompt close to the tap.
function useAddPasskey() {
  const [busy, setBusy] = useState(false);
  usePreparedPasskeys(["register"]);
  const add = () => {
    setBusy(true);
    sync
      .registerPasskey(deviceName())
      .then((user) => {
        if (user) enqueueSnackbar("Passkey added", { variant: "success" });
      })
      .catch(showError)
      .finally(() => {
        setBusy(false);
        void sync.preparePasskey("register");
      });
  };
  return { busy, add };
}

// The account's passkeys: add another, or remove one.
export const PasskeysCard = () => {
  const { user } = useAuth();
  const [list, setList] = useState<PasskeyInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const count = user?.passkeyCount ?? 0;

  const load = useCallback(async () => {
    try {
      setList(await sync.listPasskeys());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  // Also when the count changes: a passkey was added or removed.
  useEffect(() => {
    void load();
  }, [load, count]);

  const { busy, add } = useAddPasskey();

  if (!user || user.isGuest) return null;
  // On a browser without passkeys there is nothing to add; still show (and let
  // people remove) the ones they have.
  if (!passkeysSupported() && !count) return null;

  // The last way to sign in can't go.
  const onlyWayIn = !user.hasPassword && count < 2;

  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await sync.deletePasskey(removing.id);
      setRemoving(null);
      await load();
    } catch (e) {
      showError(e as Error);
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        background: alpha(t.shade, 0.25),
        border: `1px solid ${alpha(t.gold, 0.13)}`,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: t.gold,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        Passkeys
      </div>
      <div style={{ fontSize: 12, color: t.cream, opacity: 0.6 }}>
        Sign in with Face ID, your fingerprint or your screen lock. No password
        to remember.
      </div>
      {failed && !list && (
        <div style={{ fontSize: 12, color: t.red, marginTop: 10 }}>
          Couldn't load your passkeys.{" "}
          <button
            onClick={load}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: t.gold,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      )}
      {list && list.length === 0 && (
        <div
          style={{ fontSize: 12, color: t.cream, opacity: 0.55, marginTop: 10 }}
        >
          No passkeys yet.
        </div>
      )}
      {list?.map((p, i) => (
        <div
          key={p.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "10px 0",
            marginTop: i === 0 ? 8 : 0,
            borderTop: `1px solid ${alpha(t.gold, 0.13)}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: t.display,
                fontSize: 14,
                color: t.cream,
                fontWeight: 600,
              }}
            >
              {p.name || "Passkey"}
            </div>
            <div
              style={{
                fontSize: 11,
                color: t.cream,
                opacity: 0.55,
                marginTop: 2,
              }}
            >
              Added {day(p.createdAt)} ·{" "}
              {p.lastUsedAt ? `Last used ${day(p.lastUsedAt)}` : "Not used yet"}
            </div>
          </div>
          {!onlyWayIn && (
            <button
              onClick={() => setRemoving(p)}
              style={{
                background: "transparent",
                border: "none",
                padding: 4,
                color: t.red,
                fontSize: 12,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {onlyWayIn && list && list.length > 0 && (
        <div
          style={{
            fontSize: 11,
            color: t.cream,
            opacity: 0.55,
            lineHeight: 1.4,
            paddingTop: 8,
            borderTop: `1px solid ${alpha(t.gold, 0.13)}`,
          }}
        >
          This is your only way to sign in. Add a second passkey, on another
          device if you can, before you remove it.
        </div>
      )}
      {passkeysSupported() && (
        <button
          onClick={add}
          disabled={busy}
          style={{ ...outlineButton, marginTop: 10, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "…" : "Add a passkey"}
        </button>
      )}
      {removing && (
        <Sheet onClose={() => setRemoving(null)}>
          <div
            style={{
              fontFamily: t.display,
              fontSize: 20,
              fontWeight: 600,
              color: t.cream,
              marginBottom: 6,
            }}
          >
            Remove this passkey?
          </div>
          <div style={{ fontSize: 13, color: t.cream, opacity: 0.8 }}>
            {removing.name || "This passkey"} will no longer sign you in, and
            anyone signed in with it is signed out (that may include this
            device). You can also delete it from your phone's passwords.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              onClick={() => setRemoving(null)}
              style={{ ...outlineButton, flex: 1, width: "auto" }}
            >
              Cancel
            </button>
            <button
              onClick={remove}
              disabled={removeBusy}
              style={{
                ...goldButton,
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                fontSize: 14,
                background: `linear-gradient(180deg, ${t.red}, #8a2a1e)`,
                color: t.cream,
                opacity: removeBusy ? 0.6 : 1,
              }}
            >
              {removeBusy ? "…" : "Remove"}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
};

// A gentle nudge for guests: a passkey keeps their stats on any phone.
export const GuestPasskeyPrompt = () => {
  const { busy, add } = useAddPasskey();
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${alpha(t.gold, 0.33)}`,
        marginBottom: 14,
        fontSize: 13,
        color: t.cream,
        lineHeight: 1.45,
      }}
    >
      This phone remembers you without an account. <b>Save your stats:</b>{" "}
      create a passkey and keep your games on any phone, with Face ID or your
      fingerprint instead of a password.
      <button
        onClick={add}
        disabled={busy}
        style={{
          ...goldButton,
          width: "100%",
          marginTop: 12,
          padding: "12px 0",
          borderRadius: 10,
          fontSize: 14,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "…" : "Create a passkey"}
      </button>
      <div style={{ marginTop: 10, fontSize: 12, textAlign: "center" }}>
        <Link to="/login?next=/user" style={{ color: t.gold, fontWeight: 600 }}>
          Add your email instead
        </Link>
      </div>
    </div>
  );
};
