import { id } from "@instantdb/react";
import { enqueueSnackbar } from "notistack";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { db } from "../db";
import { claimPlayer, useMyPlayer } from "../players/account";
import { mergePlayers } from "../players/merge";
import { queryGameData } from "../queries";
import { alpha, goldButton, t } from "../theme/tokens";
import { addExistingPlayerToGame } from "../utils/addExistingPlayerToGame";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";
import { Crumb } from "./chrome/Crumb";

// Landing page for the invite QR code. Gets the person onto a seat in the
// game, signing them in as an anonymous guest if needed.
export const JoinGame = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const nav = useNavigate();
  const { user, player: me, isLoading: meLoading } = useMyPlayer();
  const { data, isLoading } = db.useQuery(
    gameId ? queryGameData(gameId) : null
  );
  const [busy, setBusy] = useState(false);
  const [notListed, setNotListed] = useState(false);

  const game = data?.games[0];
  const seats = [...(game?.playersOrders ?? [])]
    .sort((a, b) => a.orderNumber - b.orderNumber)
    .map((po) => po.player)
    .filter((p): p is NonNullable<typeof p> => !!p);
  const started = (game?.rounds ?? []).some((r) => r.turns.length > 0);
  const host = seats.find(
    (p) => p.claimedBy && p.claimedBy === game?.createdBy
  );
  const iAmSeated = !!me && seats.some((p) => p.id === me.id);
  const openSeats = seats.filter((p) => !p.claimedBy && p.id !== me?.id);
  const goToGame = () => nav(`/games/${gameId}`, { replace: true });

  useEffect(() => {
    if (iAmSeated) goToGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iAmSeated]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      enqueueSnackbar((e as Error).message, { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (!gameId) return <Navigate to="/" replace />;
  if (isLoading || meLoading) return <Frame>Loading…</Frame>;
  if (!game || game.deletedAt) {
    return (
      <Frame title="Game not found">
        <Muted>This invite link doesn't point at a game any more.</Muted>
        <Link to="/" style={{ color: t.gold, fontSize: 14 }}>
          Go to the app →
        </Link>
      </Frame>
    );
  }

  const title = host ? `Join ${host.name}'s game` : "Join the game";
  const seatList = seats.length ? seats.map((p) => p.name).join(", ") : "";

  // 1. Not signed in at all: one tap to join as a guest.
  if (!user) {
    return (
      <Frame title={title}>
        {seatList && <Muted>At the table: {seatList}</Muted>}
        <PrimaryButton
          busy={busy}
          onClick={() => run(async () => void (await db.auth.signInAsGuest()))}
        >
          Join game
        </PrimaryButton>
        <Muted small>
          No sign-up needed. This phone will remember you.{" "}
          <Link
            to={`/login?next=${encodeURIComponent(`/join/${gameId}`)}`}
            style={{ color: t.gold }}
          >
            Sign in with email
          </Link>{" "}
          instead.
        </Muted>
      </Frame>
    );
  }

  if (iAmSeated) return <Frame>Taking you to the game…</Frame>;

  const seatPicker = (onPick: (seatId: string) => void, label: string) =>
    openSeats.length > 0 && (
      <>
        <SectionLabel>{label}</SectionLabel>
        <div style={{ display: "grid", gap: 8 }}>
          {openSeats.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => onPick(p.id)}
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                border: `1px solid ${alpha(t.gold, 0.33)}`,
                background: alpha(t.shade, 0.22),
                color: t.cream,
                fontFamily: t.display,
                fontSize: 17,
                fontWeight: 600,
                textAlign: "left",
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </>
    );

  // 2. This phone/account already has a player: take a seat as them, or say
  //    which name the host typed for them (which merges that seat into them).
  if (me) {
    return (
      <Frame title={`Welcome back, ${me.name}`}>
        {!started ? (
          <PrimaryButton
            busy={busy}
            onClick={() =>
              run(async () => {
                await addExistingPlayerToGame(gameId, me.id, seats.length);
                goToGame();
              })
            }
          >
            Take a seat
          </PrimaryButton>
        ) : (
          openSeats.length === 0 && (
            <Muted>
              This game has already started, so you can't join it now. Ask the
              host to add you next game.
            </Muted>
          )
        )}
        {seatPicker(
          (seatId) =>
            run(async () => {
              await mergePlayers(seatId, me.id);
              goToGame();
            }),
          started ? "Which seat is you?" : "Or did the host already add you?"
        )}
        {user.isGuest && (
          <button
            onClick={() =>
              run(async () => {
                await db.transact([
                  db.tx.players[me.id]
                    .unlink({ $user: user.id })
                    .update({ claimedBy: null }),
                ]);
              })
            }
            style={linkButton}
          >
            Not {me.name}?
          </button>
        )}
      </Frame>
    );
  }

  // 3. Signed in (usually as a fresh guest) with no player yet.
  return (
    <Frame title={title}>
      {seatPicker(
        (seatId) =>
          run(async () => {
            await claimPlayer(seatId, user.id);
            goToGame();
          }),
        "Which one are you?"
      )}
      {!notListed ? (
        <button
          onClick={() => setNotListed(true)}
          style={
            openSeats.length ? linkButton : { ...linkButton, fontSize: 15 }
          }
        >
          {openSeats.length ? "I'm not listed" : "Add my name"}
        </button>
      ) : started ? (
        <Muted>
          This game has already started, so you can't be added now. Ask the host
          to add you next game.
        </Muted>
      ) : (
        <>
          <SectionLabel>Your name</SectionLabel>
          <ChoosePlayerOrCreate
            hideClaimed
            excludedPlayerIds={seats.map((p) => p.id)}
            contextPlayerIds={seats.map((p) => p.id)}
            choosePlayer={(pid) =>
              run(async () => {
                await claimPlayer(pid, user.id);
                await addExistingPlayerToGame(gameId, pid, seats.length);
                goToGame();
              })
            }
            createPlayer={(name) =>
              run(async () => {
                const pid = id();
                await db.transact([db.tx.players[pid].update({ name })]);
                await claimPlayer(pid, user.id);
                await addExistingPlayerToGame(gameId, pid, seats.length);
                goToGame();
              })
            }
          />
        </>
      )}
    </Frame>
  );
};

const linkButton = {
  marginTop: 16,
  background: "transparent",
  border: "none",
  color: t.gold,
  fontSize: 13,
  padding: 4,
  alignSelf: "center" as const,
};

const Frame = ({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) => (
  <>
    <Crumb trail={[{ label: "Home", to: "/" }, { label: "Join" }]} />
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: "28px 20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 480,
        width: "100%",
        margin: "0 auto",
        color: t.cream,
      }}
    >
      {title && (
        <div
          style={{
            fontFamily: t.display,
            fontSize: 30,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  </>
);

const Muted = ({
  children,
  small,
}: {
  children: React.ReactNode;
  small?: boolean;
}) => (
  <div style={{ fontSize: small ? 12 : 14, opacity: 0.7, lineHeight: 1.45 }}>
    {children}
  </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      fontSize: 10,
      color: t.gold,
      letterSpacing: "0.2em",
      textTransform: "uppercase",
      fontWeight: 700,
      marginTop: 10,
    }}
  >
    {children}
  </div>
);

const PrimaryButton = ({
  children,
  onClick,
  busy,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={busy}
    style={{
      ...goldButton,
      width: "100%",
      padding: 15,
      borderRadius: 12,
      fontSize: 17,
      marginTop: 8,
      opacity: busy ? 0.6 : 1,
    }}
  >
    {children}
  </button>
);
