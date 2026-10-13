import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { act } from "../lib/dispatch";
import { accountLabel, useMyPlayer } from "../players/account";
import {
  appleSupported,
  passkeysSupported,
  selectHomeGames,
  sync,
  useAuth,
  usePendingCount,
  useSyncView,
} from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { summarizeGame } from "../utils/gameStatus";
import { Sheet } from "./chrome/Sheet";
import { ThemePicker } from "./chrome/ThemeToggle";
import { AccountMovedBanner } from "./chrome/AccountMovedBanner";
import { AlsoYou } from "./AlsoYou";
import { enqueueSnackbar } from "notistack";
import { AddEmailSheet } from "./AddEmailSheet";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import { GuestPasskeyPrompt, PasskeysCard } from "./PasskeysCard";
import { SetPasswordSheet } from "./SetPasswordSheet";
import { LinkPlayerToMe } from "./UserLogin";

export const UserManager = () => {
  const { isLoading: isLoadingUser, user } = useAuth();
  const nav = useNavigate();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const pending = usePendingCount();

  const { player: linkedPlayer, isLoading: isLoadingPlayer } = useMyPlayer();
  const { view } = useSyncView();

  if (isLoadingUser) {
    return <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (isLoadingPlayer) {
    return <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>;
  }

  if (!linkedPlayer) {
    return (
      <>
        <AccountMovedBanner signedIn={!user.isGuest} />
        <LinkPlayerToMe />
      </>
    );
  }

  // Stats for this player
  let games = 0,
    finished = 0,
    wins = 0,
    total = 0;
  for (const g of selectHomeGames(view).games) {
    if (g.deletedAt) continue;
    const s = summarizeGame(g.playersOrders, g.rounds);
    const idx = s.totals.findIndex((p) => p.id === linkedPlayer.id);
    if (idx === -1) continue;
    games += 1;
    if (s.isFinished) {
      finished += 1;
      total += s.totals[idx].score;
      if (idx === s.winnerIdx) wins += 1;
    }
  }
  const avg = finished ? (total / finished).toFixed(1) : "—";
  const initial =
    (linkedPlayer.name ?? "")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  const unlink = async () => {
    await act("unclaimPlayer", { playerId: linkedPlayer.id });
  };

  // Signing out drops changes that haven't reached the server yet.
  const logout = () => (pending > 0 ? setConfirmSignOut(true) : sync.logOut());

  return (
    <>
      <AccountMovedBanner signedIn={!user.isGuest} />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              background: t.goldFill,
              color: t.onGold,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: t.display,
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            {initial}
          </div>
          <div>
            <div
              style={{
                fontFamily: t.display,
                fontSize: 20,
                color: t.cream,
                fontWeight: 600,
              }}
            >
              {linkedPlayer.name}
            </div>
            <div style={{ fontSize: 12, color: t.cream, opacity: 0.55 }}>
              {user.isGuest ? "Guest · this phone only" : accountLabel(user)}
            </div>
          </div>
        </div>

        {user.isGuest &&
          (passkeysSupported() ? (
            <GuestPasskeyPrompt />
          ) : (
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
              This phone remembers you without an account.{" "}
              <Link
                to="/login?next=/user"
                style={{ color: t.gold, fontWeight: 600 }}
              >
                Add your email
              </Link>{" "}
              to keep your games on any phone.
            </div>
          ))}

        <AlsoYou playerId={linkedPlayer.id} />

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
              marginBottom: 10,
            }}
          >
            Your stats
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
            }}
          >
            <Stat label="Games" value={String(games)} />
            <Stat label="Wins" value={String(wins)} />
            <Stat label="Avg" value={avg} />
          </div>
        </div>

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
              marginBottom: 10,
            }}
          >
            Appearance
          </div>
          <ThemePicker />
        </div>

        <PasskeysCard />

        {!user.isGuest &&
          (user.hasApple ? (
            <Row
              label="Remove Sign in with Apple"
              sub="Your Apple ID signs you in"
              onClick={() => {
                if (
                  window.confirm(
                    "Remove Sign in with Apple? Other phones signed in with it will be signed out."
                  )
                )
                  sync
                    .removeApple()
                    .then(() =>
                      enqueueSnackbar("Sign in with Apple removed", {
                        variant: "success",
                      })
                    )
                    .catch((e: Error) =>
                      enqueueSnackbar(e.message, { variant: "error" })
                    );
              }}
            />
          ) : (
            appleSupported() && (
              <Row
                label="Add Sign in with Apple"
                sub="Another way in, with your Apple ID"
                onClick={() =>
                  !appleBusy &&
                  (setAppleBusy(true),
                  sync
                    .signInWithApple()
                    .then(
                      (done) =>
                        done &&
                        enqueueSnackbar("Sign in with Apple added", {
                          variant: "success",
                        })
                    )
                    .catch((e: Error) =>
                      enqueueSnackbar(e.message, { variant: "error" })
                    )
                    .finally(() => setAppleBusy(false)))
                }
              />
            )
          ))}

        {/* A password only works together with an email. */}
        {!user.isGuest && user.email && (
          <Row
            label={user.hasPassword ? "Change password" : "Set a password"}
            sub="Used to log in on other phones"
            onClick={() => setPasswordOpen(true)}
          />
        )}
        {!user.isGuest && !user.email && (
          <Row
            label="Add email and password (backup sign-in)"
            sub="In case you lose your passkey"
            onClick={() => setEmailOpen(true)}
          />
        )}
        {emailOpen && <AddEmailSheet onClose={() => setEmailOpen(false)} />}
        {!user.isGuest && (
          <Row
            label="Sign out other devices"
            sub="Ends every other session on your account"
            onClick={() =>
              sync
                .signOutOthers()
                .then(() =>
                  enqueueSnackbar("Signed out on your other devices", {
                    variant: "success",
                  })
                )
                .catch((e: Error) =>
                  enqueueSnackbar(e.message, { variant: "error" })
                )
            }
          />
        )}
        {passwordOpen && (
          <SetPasswordSheet onClose={() => setPasswordOpen(false)} />
        )}
        {confirmSignOut && (
          <Sheet onClose={() => setConfirmSignOut(false)}>
            <div
              style={{
                fontFamily: t.display,
                fontSize: 20,
                fontWeight: 600,
                color: t.cream,
                marginBottom: 6,
              }}
            >
              Sign out?
            </div>
            <div style={{ fontSize: 13, color: t.cream, opacity: 0.8 }}>
              You have {pending} change{pending === 1 ? "" : "s"} that{" "}
              {pending === 1 ? "hasn't" : "haven't"} synced yet. Signing out
              will lose them.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setConfirmSignOut(false)}
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
                onClick={() => sync.logOut()}
                style={{
                  ...goldButton,
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 10,
                  fontSize: 14,
                  background: `linear-gradient(180deg, ${t.red}, #8a2a1e)`,
                  color: t.cream,
                }}
              >
                Sign out anyway
              </button>
            </div>
          </Sheet>
        )}
        <Row
          label="Players & duplicates"
          sub="Find and merge players who are the same person"
          onClick={() => nav("/players")}
        />
        <Row
          label={user.isGuest ? `Not ${linkedPlayer.name}?` : "Unlink player"}
          sub={
            user.isGuest
              ? "Switch which player this phone is"
              : linkedPlayer.name
          }
          onClick={unlink}
        />
        <Row
          label="Sign out"
          sub={
            user.isGuest
              ? `This phone will forget it's ${linkedPlayer.name}`
              : undefined
          }
          onClick={logout}
          danger
        />
        {!user.isGuest && (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 12,
              border: `1px solid ${alpha(t.red, 0.5)}`,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: t.red,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              Danger zone
            </div>
            <div
              style={{
                fontSize: 12,
                color: t.cream,
                opacity: 0.65,
                lineHeight: 1.4,
              }}
            >
              Delete your account and sign out everywhere. Your games and scores
              stay for the people you played with.
            </div>
            <button
              onClick={() => setDeleteOpen(true)}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "12px 0",
                borderRadius: 10,
                border: `1px solid ${alpha(t.red, 0.6)}`,
                background: "transparent",
                color: t.red,
                fontFamily: t.display,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Delete account
            </button>
          </div>
        )}
        {deleteOpen && (
          <DeleteAccountSheet onClose={() => setDeleteOpen(false)} />
        )}
        <Link
          to="/privacy"
          style={{
            display: "block",
            textAlign: "center",
            padding: "16px 0 4px",
            fontSize: 12,
            color: t.gold,
            opacity: 0.85,
          }}
        >
          Privacy
        </Link>
      </div>
    </>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div
      style={{
        fontFamily: t.mono,
        fontSize: 22,
        color: t.cream,
        fontWeight: 700,
      }}
    >
      {value}
    </div>
    <div
      style={{
        fontSize: 10,
        color: t.cream,
        opacity: 0.55,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginTop: 2,
      }}
    >
      {label}
    </div>
  </div>
);

const Row = ({
  label,
  sub,
  onClick,
  danger,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  danger?: boolean;
}) => (
  <div
    onClick={onClick}
    role="button"
    tabIndex={0}
    style={{
      padding: "14px",
      borderRadius: 10,
      marginBottom: 6,
      background: alpha(t.shade, 0.22),
      border: `1px solid ${alpha(t.gold, 0.13)}`,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      cursor: "pointer",
    }}
  >
    <div>
      <div
        style={{
          fontFamily: t.display,
          fontSize: 14,
          color: danger ? t.red : t.cream,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color: t.cream,
            opacity: 0.55,
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
    <div style={{ color: t.gold, opacity: 0.5, fontSize: 14 }}>›</div>
  </div>
);
