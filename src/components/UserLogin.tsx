import { id } from "@instantdb/react";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../db";
import { goldButton, t } from "../theme/tokens";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";
import { Shell } from "./chrome/Shell";

export const UserLogin = () => {
  const { user } = db.useAuth();
  const [sentEmail, setSentEmail] = useState("");

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
    // signed in + linked — redirect out of /login
    return <RedirectHome />;
  }

  return (
    <Shell>
      <LoginFrame>
        {!sentEmail ? (
          <EmailStep onSent={setSentEmail} />
        ) : (
          <MagicCodeStep sentEmail={sentEmail} />
        )}
      </LoginFrame>
    </Shell>
  );
};

const RedirectHome = () => {
  const nav = useNavigate();
  nav("/");
  return null;
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
