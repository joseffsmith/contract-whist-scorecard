import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { sync, useAuth } from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { Sheet } from "./chrome/Sheet";

// Lets a signed-in email account change its password.
export const SetPasswordSheet = ({ onClose }: { onClose: () => void }) => {
  const { user } = useAuth();
  const [password, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await sync.setPassword(password);
      enqueueSnackbar("Password saved", { variant: "success" });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <form onSubmit={save}>
        <div
          style={{
            fontFamily: t.display,
            fontSize: 20,
            fontWeight: 600,
            color: t.cream,
          }}
        >
          Change password
        </div>
        <div
          style={{
            fontSize: 13,
            color: t.cream,
            opacity: 0.7,
            margin: "4px 0 14px",
          }}
        >
          Log in with {user?.email} and this password next time.
        </div>
        {/* Hidden username so password managers save the pair. */}
        <input
          type="email"
          autoComplete="username"
          value={user?.email ?? ""}
          readOnly
          hidden
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: 14,
            borderRadius: 10,
            background: alpha(t.shade, 0.3),
            border: `1px solid ${alpha(t.gold, 0.27)}`,
          }}
        >
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setValue(e.target.value)}
            placeholder="At least 8 characters"
            autoFocus
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: t.cream,
              fontSize: 16,
            }}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              color: t.gold,
              fontSize: 12,
            }}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
        {error && (
          <div style={{ color: t.red, fontSize: 13, marginTop: 8 }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || password.length < 8}
          style={{
            ...goldButton,
            width: "100%",
            marginTop: 14,
            padding: 14,
            borderRadius: 12,
            fontSize: 15,
            opacity: busy || password.length < 8 ? 0.5 : 1,
          }}
        >
          {busy ? "…" : "Save password"}
        </button>
      </form>
    </Sheet>
  );
};
