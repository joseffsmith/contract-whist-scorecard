import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { sync } from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { Sheet } from "./chrome/Sheet";

// Gives a passkey-only account an email and password, as a backup way to sign
// in if the passkey is ever lost.
export const AddEmailSheet = ({ onClose }: { onClose: () => void }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = !!email.trim() && password.length >= 8;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await sync.addEmail(email, password);
      enqueueSnackbar("Backup sign-in saved", { variant: "success" });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const box = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 10,
    background: alpha(t.shade, 0.3),
    border: `1px solid ${alpha(t.gold, 0.27)}`,
  } as const;
  const input = {
    flex: 1,
    minWidth: 0,
    background: "transparent",
    border: "none",
    outline: "none",
    color: t.cream,
    fontSize: 16,
  } as const;

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
          Add email and password
        </div>
        <div
          style={{
            fontSize: 13,
            color: t.cream,
            opacity: 0.7,
            margin: "4px 0 14px",
          }}
        >
          A backup way to sign in if you lose your passkey. Nothing is sent to
          this address.
        </div>
        <div style={box}>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoFocus
            style={input}
          />
        </div>
        <div style={{ ...box, marginTop: 8 }}>
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password, at least 8 characters"
            style={input}
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
          disabled={busy || !ready}
          style={{
            ...goldButton,
            width: "100%",
            marginTop: 14,
            padding: 14,
            borderRadius: 12,
            fontSize: 15,
            opacity: busy || !ready ? 0.5 : 1,
          }}
        >
          {busy ? "…" : "Save"}
        </button>
      </form>
    </Sheet>
  );
};
