import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { accountLabel, useMyPlayer } from "../players/account";
import { sync, useAuth } from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { Shell } from "./chrome/Shell";
import { LoginFrame } from "./UserLogin";

// One-time page for the person who runs the app: /admin#<token> makes the
// signed-in account the admin (who can create password reset links). The
// token travels in the URL fragment; it's kept in sessionStorage while the
// person signs in first, and dropped from the address bar straight away.
const TOKEN_KEY = "whist-admin-token";

const readStored = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};
const store = (token: string | null) => {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
};

export const AdminSetup = () => {
  const { hash } = useLocation();
  const { user, isLoading } = useAuth();
  const { player } = useMyPlayer();
  const [token, setToken] = useState(
    () => hash.replace(/^#/, "") || readStored()
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const fromHash = hash.replace(/^#/, "");
    if (!fromHash) return;
    store(fromHash);
    setToken(fromHash);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search
    );
  }, [hash]);

  const claim = async () => {
    setBusy(true);
    setError("");
    try {
      await sync.claimAdmin(token);
      store(null);
      setToken("");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (done) {
    body = (
      <Note>
        You're the admin. You can create password reset links from the Players
        page.
        <LinkButton to="/players">Go to Players</LinkButton>
      </Note>
    );
  } else if (!token) {
    body = <Note>This admin link is incomplete.</Note>;
  } else if (isLoading) {
    body = <Note>Loading…</Note>;
  } else if (!user || user.isGuest) {
    body = (
      <Note>
        Sign in with your account first.
        <LinkButton to="/login?next=/admin">Sign in</LinkButton>
      </Note>
    );
  } else {
    body = (
      <>
        <Note>
          Signed in as <b>{accountLabel(user, player?.name)}</b>.
        </Note>
        <button
          onClick={claim}
          disabled={busy}
          style={{
            ...goldButton,
            width: "100%",
            marginTop: 14,
            padding: "16px 0",
            borderRadius: 12,
            fontSize: 16,
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "…" : "Make me the admin"}
        </button>
        {error && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${alpha(t.red, 0.5)}`,
              color: t.cream,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}
      </>
    );
  }

  return (
    <Shell scroll>
      <LoginFrame title="Admin setup" subtitle="For whoever runs this app.">
        {body}
      </LoginFrame>
    </Shell>
  );
};

const Note = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      fontSize: 14,
      color: t.cream,
      opacity: 0.85,
      textAlign: "center",
      lineHeight: 1.45,
    }}
  >
    {children}
  </div>
);

const LinkButton = ({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) => (
  <Link
    to={to}
    style={{
      ...goldButton,
      display: "block",
      textAlign: "center",
      marginTop: 14,
      padding: "14px 0",
      borderRadius: 12,
      fontSize: 15,
    }}
  >
    {children}
  </Link>
);
