import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { sync } from "../sync";
import { alpha, t } from "../theme/tokens";
import { Shell } from "./chrome/Shell";
import { Field, LoginFrame, Submit } from "./UserLogin";

// Landing page for a password reset link an admin handed out:
// /reset#<token> (the token is in the fragment so it never reaches server
// logs), or /reset/<token>.
export const ResetPassword = () => {
  const params = useParams<{ token: string }>();
  const { hash } = useLocation();
  const nav = useNavigate();
  const token = params.token ?? hash.replace(/^#/, "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await sync.resetPassword(token, password);
      // Don't leave the (now used) token in the address bar.
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search
      );
      nav("/user", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Shell scroll>
      <LoginFrame
        title="New password"
        subtitle="Choose a password for your account."
      >
        {token ? (
          <form onSubmit={submit}>
            <Field
              label="New password"
              value={password}
              onChange={setPassword}
              type={show ? "text" : "password"}
              autoComplete="new-password"
              passwordManager
              right={
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: t.gold,
                    fontSize: 12,
                    padding: 0,
                  }}
                >
                  {show ? "Hide" : "Show"}
                </button>
              }
            />
            <div
              style={{
                fontSize: 12,
                color: t.cream,
                opacity: 0.6,
                marginTop: 8,
              }}
            >
              At least 8 characters.
            </div>
            {error && <ErrorBox>{error}</ErrorBox>}
            <Submit disabled={busy || password.length < 8}>
              {busy ? "…" : "Set password"}
            </Submit>
          </form>
        ) : (
          <ErrorBox>This reset link is incomplete. Ask for a new one.</ErrorBox>
        )}
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <Link to="/login" style={{ color: t.gold, fontSize: 13 }}>
            Back to log in
          </Link>
        </div>
      </LoginFrame>
    </Shell>
  );
};

const ErrorBox = ({ children }: { children: React.ReactNode }) => (
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
    {children}
  </div>
);
