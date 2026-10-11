import { id } from "@instantdb/react";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../db";
import {
  createGame as createGuestGame,
  listGames as listGuestGames,
} from "../guest/guestStore";
import { useGuestGames } from "../guest/useGuestGame";
import { alpha, goldButton, t } from "../theme/tokens";
import {
  claimPlayer,
  useAccountReconcile,
  useMyPlayer,
} from "../players/account";
import {
  AuthError,
  passwordLogIn,
  passwordSignUp,
  usePasswordsAvailable,
} from "../lib/passwordAuth";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";
import { GuestMigrationDialog } from "./GuestMigrationDialog";
import { Shell } from "./chrome/Shell";

// Where to go after signing in, e.g. /login?next=/join/abc.
const useNext = () => {
  const [params] = useSearchParams();
  const next = params.get("next");
  return next && next.startsWith("/") ? next : "/";
};

export const UserLogin = () => {
  const { user } = db.useAuth();
  const [sentEmail, setSentEmail] = useState("");
  const guestGames = useGuestGames();
  const next = useNext();
  const reconciling = useAccountReconcile();
  const passwordsOn = usePasswordsAvailable();
  const [method, setMethod] = useState<"password" | "code">("password");
  const [codeEmail, setCodeEmail] = useState("");
  const usePassword = !!passwordsOn && method === "password";

  const { player: myPlayer, isLoading } = useMyPlayer();

  // Guests (joined by QR) see the email form so they can add an account.
  if (user && !user.isGuest) {
    if (isLoading || reconciling) {
      return (
        <Shell>
          <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>
        </Shell>
      );
    }
    if (!myPlayer) {
      return <LinkPlayerToMe />;
    }
    if (guestGames.length > 0) {
      return (
        <GuestMigrationDialog
          userId={user.id}
          games={guestGames}
          onDone={() => {
            /* subscribe will re-render with empty list → falls through to RedirectHome */
          }}
        />
      );
    }
    // signed in + linked + no guest games — redirect out of /login
    return <Navigate to={next} replace />;
  }

  return (
    <Shell>
      <LoginFrame
        title={user?.isGuest ? "Keep your games" : "Welcome back"}
        subtitle={
          user?.isGuest
            ? "Add an email to keep your player on any phone."
            : "Log in, or create an account in seconds."
        }
      >
        {sentEmail ? (
          <MagicCodeStep sentEmail={sentEmail} />
        ) : (
          <>
            {usePassword ? (
              <PasswordStep
                onUseCode={(email) => {
                  setCodeEmail(email);
                  setMethod("code");
                }}
              />
            ) : (
              <EmailStep onSent={setSentEmail} initialEmail={codeEmail} />
            )}
            {passwordsOn && (
              <button
                onClick={() =>
                  setMethod(method === "code" ? "password" : "code")
                }
                style={{
                  display: "block",
                  margin: "14px auto 0",
                  background: "transparent",
                  border: "none",
                  color: t.gold,
                  fontSize: 13,
                }}
              >
                {usePassword
                  ? "Email me a code instead"
                  : "Use a password instead"}
              </button>
            )}
            <GuestEntry />
          </>
        )}
      </LoginFrame>
    </Shell>
  );
};

const GuestEntry = () => {
  const nav = useNavigate();
  // Resume the most recent unfinished game, if any — otherwise start fresh.
  const resume = () => {
    const games = listGuestGames().filter((g) => !g.deletedAt);
    const active = games.find((g) => {
      if (g.players.length < 2) return true; // still in setup
      return g.rounds.some(
        (r) =>
          r.turns.length !== g.players.length ||
          r.turns.some((t) => t.score === null)
      );
    });
    if (active) {
      const inSetup =
        active.players.length < 2 || active.initialDealerId === null;
      nav(
        inSetup
          ? `/games/guest/${active.id}/manage`
          : `/games/guest/${active.id}`
      );
      return;
    }
    const g = createGuestGame();
    nav(`/games/guest/${g.id}/manage`);
  };
  const games = listGuestGames().filter((g) => !g.deletedAt);
  const hasActive = games.some((g) => {
    if (g.players.length < 2) return true;
    return g.rounds.some(
      (r) =>
        r.turns.length !== g.players.length ||
        r.turns.some((t) => t.score === null)
    );
  });
  return (
    <div style={{ marginTop: 18, textAlign: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: t.cream,
          opacity: 0.35,
          fontSize: 10,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1, height: 1, background: alpha(t.gold, 0.13) }} />
        <span>or</span>
        <div style={{ flex: 1, height: 1, background: alpha(t.gold, 0.13) }} />
      </div>
      <button
        onClick={resume}
        style={{
          width: "100%",
          padding: "14px 0",
          borderRadius: 12,
          border: `1px solid ${alpha(t.gold, 0.4)}`,
          background: "transparent",
          color: t.cream,
          fontFamily: t.display,
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        {hasActive ? "Resume guest game" : "Play as guest"}
      </button>
      <div
        style={{
          fontSize: 11,
          color: t.cream,
          opacity: 0.45,
          marginTop: 8,
        }}
      >
        No account — saved on this device only
      </div>
    </div>
  );
};

const LoginFrame = ({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}) => (
  <div
    style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      padding: "0 32px",
    }}
  >
    {/* Card stack mark */}
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        marginBottom: 28,
      }}
    >
      <div style={{ position: "relative", width: 72, height: 96 }}>
        <div
          style={{
            position: "absolute",
            left: 10,
            top: 6,
            width: 56,
            height: 80,
            background: t.panel,
            borderRadius: 6,
            transform: "rotate(6deg)",
            boxShadow: `0 4px 10px ${alpha(t.shade, 0.3)}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 8,
            top: 8,
            width: 56,
            height: 80,
            background: t.cream,
            borderRadius: 6,
            transform: "rotate(-4deg)",
            boxShadow: `0 4px 10px ${alpha(t.shade, 0.3)}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            color: t.red,
            fontWeight: 700,
          }}
        >
          ♥
        </div>
      </div>
    </div>
    <div
      style={{
        fontSize: 10,
        color: t.gold,
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        textAlign: "center",
        fontWeight: 600,
      }}
    >
      Contract Whist
    </div>
    <div
      style={{
        fontFamily: t.display,
        fontSize: 36,
        fontWeight: 600,
        color: t.cream,
        textAlign: "center",
        marginTop: 6,
        letterSpacing: "-0.02em",
        lineHeight: 1,
      }}
    >
      {title}
    </div>
    <div
      style={{
        fontSize: 13,
        color: t.cream,
        opacity: 0.7,
        textAlign: "center",
        marginTop: 10,
      }}
    >
      {subtitle}
    </div>
    <div style={{ marginTop: 28 }}>{children}</div>
  </div>
);

const Field = ({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  pattern,
  autoFocus = true,
  passwordManager = false,
  right,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "text";
  pattern?: string;
  autoFocus?: boolean;
  // Let password managers fill this field (they're told to ignore the rest).
  passwordManager?: boolean;
  right?: React.ReactNode;
}) => (
  <div
    style={{
      padding: 14,
      borderRadius: 10,
      background: alpha(t.shade, 0.3),
      border: `1px solid ${alpha(t.gold, 0.27)}`,
    }}
  >
    <div
      style={{
        fontSize: 10,
        color: t.gold,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        marginBottom: 6,
      }}
    >
      {label}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        pattern={pattern}
        data-1p-ignore={passwordManager ? undefined : true}
        autoFocus={autoFocus}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: t.cream,
          fontSize: 16,
          padding: 0,
        }}
      />
      {right}
    </div>
  </div>
);

const Submit = ({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) => (
  <button
    type="submit"
    disabled={disabled}
    style={{
      ...goldButton,
      width: "100%",
      marginTop: 14,
      padding: "16px 0",
      borderRadius: 12,
      fontSize: 16,
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {children}
  </button>
);

const PasswordStep = ({
  onUseCode,
}: {
  onUseCode: (email: string) => void;
}) => {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const signup = mode === "signup";

  // On success UserLogin re-renders with the user and takes it from there.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (signup) await passwordSignUp(email, password);
      else await passwordLogIn(email, password);
    } catch (err) {
      const ae =
        err instanceof AuthError ? err : new AuthError((err as Error).message);
      setError(ae);
      if (ae.code === "has_password") setMode("login");
    } finally {
      setBusy(false);
    }
  };

  const tab = (m: "login" | "signup", label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        setError(null);
      }}
      style={{
        flex: 1,
        padding: "8px 0",
        borderRadius: 8,
        border: "none",
        background: mode === m ? t.goldFill : "transparent",
        color: mode === m ? t.onGold : t.cream,
        opacity: mode === m ? 1 : 0.7,
        fontWeight: mode === m ? 700 : 500,
        fontSize: 13,
      }}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit}>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 3,
          marginBottom: 12,
          borderRadius: 10,
          background: alpha(t.shade, 0.22),
          border: `1px solid ${alpha(t.gold, 0.13)}`,
        }}
      >
        {tab("login", "Log in")}
        {tab("signup", "Create account")}
      </div>
      <Field
        label="Email"
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="username"
        passwordManager
      />
      <div style={{ height: 8 }} />
      <Field
        label="Password"
        value={password}
        onChange={setPasswordValue}
        type={show ? "text" : "password"}
        autoComplete={signup ? "new-password" : "current-password"}
        autoFocus={false}
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
      {signup && (
        <div
          style={{ fontSize: 12, color: t.cream, opacity: 0.6, marginTop: 8 }}
        >
          At least 8 characters. No email confirmation needed.
        </div>
      )}
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
          {error.message}
          {(error.code === "has_account" ||
            error.code === "bad_credentials") && (
            <button
              type="button"
              onClick={() => onUseCode(email)}
              style={{
                display: "block",
                marginTop: 6,
                padding: 0,
                background: "transparent",
                border: "none",
                color: t.gold,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Email me a code instead →
            </button>
          )}
        </div>
      )}
      <Submit disabled={busy || !email || !password}>
        {busy ? "…" : signup ? "Create account" : "Log in"}
      </Submit>
    </form>
  );
};

const EmailStep = ({
  onSent,
  initialEmail = "",
}: {
  onSent: (email: string) => void;
  initialEmail?: string;
}) => {
  const [email, setEmail] = useState(initialEmail);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    onSent(email);
    db.auth.sendMagicCode({ email }).catch((err) => {
      enqueueSnackbar("Uh oh: " + (err?.body?.message ?? err), {
        variant: "error",
      });
      onSent("");
    });
  };
  return (
    <form onSubmit={submit}>
      <Field
        label="Email"
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="email"
      />
      <Submit disabled={!email}>Send code</Submit>
    </form>
  );
};

const MagicCodeStep = ({ sentEmail }: { sentEmail: string }) => {
  const [code, setCode] = useState("");
  // Once signed in, UserLogin re-renders and takes it from there (linking a
  // player, carrying over a guest player, then redirecting to ?next).
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    db.auth.signInWithMagicCode({ email: sentEmail, code }).catch((err) => {
      enqueueSnackbar("Uh oh: " + (err?.body?.message ?? err), {
        variant: "error",
      });
      setCode("");
    });
  };
  return (
    <form onSubmit={submit}>
      <div
        style={{
          fontSize: 12,
          color: t.cream,
          opacity: 0.6,
          marginBottom: 8,
          textAlign: "center",
        }}
      >
        Check {sentEmail}
      </div>
      <Field
        label="Verification code"
        value={code}
        onChange={setCode}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
      />
      <Submit disabled={!code}>Verify</Submit>
    </form>
  );
};

export const LinkPlayerToMe = () => {
  const { user } = db.useAuth();

  const createPlayer = async (name: string) => {
    if (!user) throw new Error("No user");
    if (!name) {
      enqueueSnackbar("Name is required", { variant: "error" });
      return;
    }
    const playerId = id();
    await db.transact([db.tx.players[playerId].update({ name })]);
    await claimPlayer(playerId, user.id);
  };
  const choosePlayer = async (player: { id: string }) => {
    if (!user) throw new Error("No user");
    await claimPlayer(player.id, user.id);
  };

  return (
    <Shell>
      <div style={{ flex: 1, padding: "60px 24px 24px" }}>
        <div
          style={{
            fontSize: 10,
            color: t.gold,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            textAlign: "center",
            fontWeight: 600,
          }}
        >
          One more thing
        </div>
        <div
          style={{
            fontFamily: t.display,
            fontSize: 30,
            fontWeight: 600,
            color: t.cream,
            textAlign: "center",
            marginTop: 8,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          Which player is you?
        </div>
        <div
          style={{
            fontSize: 13,
            color: t.cream,
            opacity: 0.7,
            textAlign: "center",
            marginTop: 10,
            marginBottom: 20,
          }}
        >
          Pick an existing player or create a new one.
        </div>
        <ChoosePlayerOrCreate
          createPlayer={createPlayer}
          choosePlayer={choosePlayer}
          excludedPlayerIds={[]}
          hideClaimed
        />
      </div>
    </Shell>
  );
};
