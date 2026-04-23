import { id } from "@instantdb/react";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { db } from "../db";
import { createGame as createGuestGame, listGames as listGuestGames } from "../guest/guestStore";
import { useGuestGames } from "../guest/useGuestGame";
import { goldButton, t } from "../theme/tokens";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";
import { GuestMigrationDialog } from "./GuestMigrationDialog";
import { Shell } from "./chrome/Shell";

export const UserLogin = () => {
  const { user } = db.useAuth();
  const [sentEmail, setSentEmail] = useState("");
  const guestGames = useGuestGames();

  const { isLoading, data: playerUser } = db.useQuery(
    user
      ? { players: { $: { where: { $user: user.id } } } }
      : null
  );

  if (user) {
    if (isLoading) {
      return (
        <Shell>
          <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>
        </Shell>
      );
    }
    if (!playerUser?.players?.length) {
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
    return <Navigate to="/" replace />;
  }

  return (
    <Shell>
      <LoginFrame>
        {!sentEmail ? (
          <>
            <EmailStep onSent={setSentEmail} />
            <GuestEntry />
          </>
        ) : (
          <MagicCodeStep sentEmail={sentEmail} />
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
      return g.rounds.some((r) =>
        r.turns.length !== g.players.length ||
        r.turns.some((t) => t.score === null)
      );
    });
    if (active) {
      const inSetup = active.players.length < 2 || active.initialDealerId === null;
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
    return g.rounds.some((r) =>
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
        <div style={{ flex: 1, height: 1, background: `${t.gold}22` }} />
        <span>or</span>
        <div style={{ flex: 1, height: 1, background: `${t.gold}22` }} />
      </div>
      <button
        onClick={resume}
        style={{
          width: "100%",
          padding: "14px 0",
          borderRadius: 12,
          border: `1px solid ${t.gold}66`,
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

const LoginFrame = ({ children }: { children: React.ReactNode }) => (
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
            boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
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
            boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
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
      Welcome back
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
      Magic-code sign in. No password needed.
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "text";
  pattern?: string;
}) => (
  <div
    style={{
      padding: 14,
      borderRadius: 10,
      background: "rgba(0,0,0,0.3)",
      border: `1px solid ${t.gold}44`,
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
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      inputMode={inputMode}
      pattern={pattern}
      data-1p-ignore
      autoFocus
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

const EmailStep = ({ onSent }: { onSent: (email: string) => void }) => {
  const [email, setEmail] = useState("");
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
  const nav = useNavigate();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    db.auth
      .signInWithMagicCode({ email: sentEmail, code })
      .catch((err) => {
        enqueueSnackbar("Uh oh: " + (err?.body?.message ?? err), {
          variant: "error",
        });
        setCode("");
      })
      .then(() => {
        nav("/");
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
  const { data } = db.useQuery({ players: { $user: {} } });
  const excludedPlayerIds = data?.players.map((p) => p.id) ?? [];

  const createPlayer = async (name: string) => {
    if (!user) throw new Error("No user");
    if (!name) {
      enqueueSnackbar("Name is required", { variant: "error" });
      return;
    }
    const playerId = id();
    await db.transact([
      db.tx.players[playerId].update({ name }).link({ $user: user.id }),
    ]);
  };
  const choosePlayer = async (pid: string) => {
    if (!user) throw new Error("No user");
    await db.transact([db.tx.players[pid].link({ $user: user.id })]);
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
          excludedPlayerIds={excludedPlayerIds}
        />
      </div>
    </Shell>
  );
};
