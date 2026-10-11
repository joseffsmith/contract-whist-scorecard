import { enqueueSnackbar } from "notistack";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { deviceName } from "../lib/deviceName";
import { newId } from "../lib/dispatch";
import { alpha, goldButton, t } from "../theme/tokens";
import { useGuestGames } from "../guest/useGuestGame";
import { claimPlayer, useMyPlayer } from "../players/account";
import { passkeysSupported, sync, useAuth, usePreparedPasskeys } from "../sync";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";
import { AccountMovedBanner } from "./chrome/AccountMovedBanner";
import { Shell } from "./chrome/Shell";

// Where to go after signing in, e.g. /login?next=/join/abc.
const useNext = () => {
  const [params] = useSearchParams();
  const next = params.get("next");
  return next && next.startsWith("/") ? next : "/";
};

// After logging in, the server may move a guest's player onto the account.
// Give that change a moment to arrive before asking "which player is you?".
const HANDOFF_GRACE_MS = 1500;

export const UserLogin = () => {
  const { user } = useAuth();
  const next = useNext();
  const localGames = useGuestGames();
  const [settling, setSettling] = useState(false);
  // Set once "Play as guest" has been tapped: the guest then picks who they
  // are and goes on, instead of seeing the "add an email" form.
  const [playingAsGuest, setPlayingAsGuest] = useState(false);

  const { player: myPlayer, isLoading } = useMyPlayer();

  useEffect(() => {
    if (!settling) return;
    const tmr = setTimeout(() => setSettling(false), HANDOFF_GRACE_MS);
    return () => clearTimeout(tmr);
  }, [settling]);

  // A guest with a player has games to keep; one made only so a passkey can be
  // registered (see PasskeyEntry) has nothing, and sees the signed-out page.
  const keeping = !!user?.isGuest && !!myPlayer;

  // Guests (joined by QR) see the email form so they can add an account.
  if (user && (!user.isGuest || playingAsGuest)) {
    if (isLoading || (settling && !myPlayer)) {
      return (
        <Shell>
          <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>
        </Shell>
      );
    }
    if (!myPlayer) {
      return <LinkPlayerToMe />;
    }
    // signed in + linked — redirect out of /login
    return <Navigate to={next} replace />;
  }

  return (
    <Shell>
      <AccountMovedBanner signedIn={false} />
      <LoginFrame
        title={keeping ? "Keep your games" : "Welcome back"}
        subtitle={
          keeping
            ? passkeysSupported()
              ? "Create a passkey to keep your player on any phone."
              : "Add an email to keep your player on any phone."
            : "Log in, or create an account in seconds."
        }
      >
        {passkeysSupported() ? (
          <>
            <PasskeyEntry onSignedIn={() => setSettling(true)} />
            <EmailEntry onSignedIn={() => setSettling(true)} />
          </>
        ) : (
          <PasswordStep onSignedIn={() => setSettling(true)} />
        )}
        {!keeping && <GuestEntry onStart={() => setPlayingAsGuest(true)} />}
        {!keeping && localGames.length > 0 && (
          <div
            style={{
              marginTop: 14,
              fontSize: 12,
              color: t.cream,
              opacity: 0.6,
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            You have {localGames.length} game
            {localGames.length === 1 ? "" : "s"} saved only on this phone — Play
            as guest or sign in to save{" "}
            {localGames.length === 1 ? "it" : "them"}.
          </div>
        )}
      </LoginFrame>
    </Shell>
  );
};

const showError = (e: Error) =>
  enqueueSnackbar(e.message, { variant: "error" });

// Sign in with a passkey, or make an account with one. Dismissing the
// browser's prompt just leaves things as they were.
//
// Safari only opens a passkey prompt close to the user's tap, so the prompts'
// options are fetched before it (usePreparedPasskeys) and the tap handlers
// below call straight into sync with nothing awaited first. Registering needs
// a session to ask as, so a signed-out visitor gets a guest on arrival; the
// passkey then upgrades that guest.
const PasskeyEntry = ({ onSignedIn }: { onSignedIn: () => void }) => {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  usePreparedPasskeys(["login", "register"]);
  useEffect(() => {
    if (!user) sync.signInAsGuest().catch(() => {});
  }, [user]);

  // Each attempt spends its options: get new ones ready.
  const attempt = (run: Promise<unknown | null>) => {
    setBusy(true);
    run
      .then((done) => {
        if (done) onSignedIn();
      })
      .catch(showError)
      .finally(() => {
        setBusy(false);
        void sync.preparePasskey("login");
        void sync.preparePasskey("register");
      });
  };
  const signIn = () => attempt(sync.logInWithPasskey());
  const create = () => attempt(sync.registerPasskey(deviceName()));

  return (
    <div>
      <button
        onClick={signIn}
        disabled={busy}
        style={{
          ...goldButton,
          width: "100%",
          padding: "16px 0",
          borderRadius: 12,
          fontSize: 16,
          opacity: busy ? 0.5 : 1,
        }}
      >
        {busy ? "…" : "Continue with a passkey"}
      </button>
      <button
        onClick={create}
        disabled={busy || !user}
        style={{
          width: "100%",
          marginTop: 8,
          padding: "13px 0",
          borderRadius: 12,
          border: `1px solid ${alpha(t.gold, 0.4)}`,
          background: "transparent",
          color: t.cream,
          fontFamily: t.display,
          fontSize: 15,
          fontWeight: 600,
          opacity: busy || !user ? 0.6 : 1,
        }}
      >
        Create an account with a passkey
      </button>
      <div
        style={{
          fontSize: 12,
          color: t.cream,
          opacity: 0.55,
          marginTop: 10,
          textAlign: "center",
          lineHeight: 1.4,
        }}
      >
        Uses Face ID, your fingerprint or your screen lock. No password to
        remember.
      </div>
    </div>
  );
};

// Email and password, a step down from passkeys: tucked behind a button
// unless a link asked for the form (/login?mode=signup).
const EmailEntry = ({ onSignedIn }: { onSignedIn: () => void }) => {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.has("mode"));
  return (
    <div style={{ marginTop: 18 }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            display: "block",
            margin: "0 auto",
            padding: "6px 8px",
            background: "transparent",
            border: "none",
            color: t.gold,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Use email and password instead
        </button>
      ) : (
        <PasswordStep onSignedIn={onSignedIn} />
      )}
    </div>
  );
};

const GuestEntry = ({ onStart }: { onStart: () => void }) => {
  const [busy, setBusy] = useState(false);
  // A guest is a real (anonymous) account, so their games sync like anyone's.
  const start = async () => {
    setBusy(true);
    try {
      await sync.signInAsGuest();
      onStart();
    } catch (e) {
      enqueueSnackbar((e as Error).message, { variant: "error" });
      setBusy(false);
    }
  };
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
        onClick={start}
        disabled={busy}
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
          opacity: busy ? 0.6 : 1,
        }}
      >
        Play as guest
      </button>
      <div
        style={{
          fontSize: 11,
          color: t.cream,
          opacity: 0.45,
          marginTop: 8,
        }}
      >
        No account needed — games still sync
      </div>
    </div>
  );
};

export const LoginFrame = ({
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

export const Field = ({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  autoFocus = true,
  passwordManager = false,
  right,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
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

export const Submit = ({
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

const PasswordStep = ({ onSignedIn }: { onSignedIn: () => void }) => {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">(
    params.get("mode") === "signup" ? "signup" : "login"
  );
  const [email, setEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(
    null
  );
  const signup = mode === "signup";

  // On success UserLogin re-renders with the user and takes it from there.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (signup) await sync.signUp(email, password);
      else await sync.logIn(email, password);
      onSignedIn();
    } catch (err) {
      const e = err as Error & { code?: string };
      setError({ message: e.message, code: e.code });
      if (e.code === "has_account") setMode("login");
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
        </div>
      )}
      <Submit disabled={busy || !email || !password}>
        {busy ? "…" : signup ? "Create account" : "Log in"}
      </Submit>
      <div
        style={{
          fontSize: 12,
          color: t.cream,
          opacity: 0.5,
          marginTop: 12,
          textAlign: "center",
        }}
      >
        Forgot your password? Ask whoever runs the app for a reset link.
      </div>
    </form>
  );
};

export const LinkPlayerToMe = () => {
  const createPlayer = async (name: string) => {
    if (!name) {
      enqueueSnackbar("Name is required", { variant: "error" });
      return;
    }
    await sync
      .dispatch("createPlayer", { playerId: newId(), name, claim: true })
      .catch(showError);
  };
  const choosePlayer = async (player: { id: string }) => {
    await claimPlayer(player.id).catch(showError);
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
