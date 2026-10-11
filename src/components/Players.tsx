import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  activePlayers,
  describePlayer,
  normName,
  PlayerInfo,
  possibleDuplicates,
  sharesGame,
  usePlayerDirectory,
} from "../players/directory";
import { mergePlayers, undoMerge } from "../players/merge";
import { sync, useAuth } from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { PlayerOption } from "./ChoosePlayerOrCreate";
import { Crumb } from "./chrome/Crumb";
import { Sheet } from "./chrome/Sheet";

const sectionLabel = {
  fontSize: 10,
  color: t.gold,
  letterSpacing: "0.2em",
  textTransform: "uppercase" as const,
  fontWeight: 700,
  margin: "18px 2px 8px",
};

const smallButton = {
  fontSize: 11,
  color: t.gold,
  border: `1px solid ${alpha(t.gold, 0.4)}`,
  background: "transparent",
  borderRadius: 14,
  padding: "5px 10px",
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  flexShrink: 0,
};

// Find and merge duplicate players. Merging moves games and scores onto one
// player; it can be undone from the "Merged" list.
export const Players = () => {
  const { user } = useAuth();
  const { directory, isLoading } = usePlayerDirectory();
  const [query, setQuery] = useState("");
  const [mergingFrom, setMergingFrom] = useState<PlayerInfo | null>(null);
  const [confirm, setConfirm] = useState<[PlayerInfo, PlayerInfo] | null>(null);
  const canEdit = !!user && !user.isGuest;

  if (isLoading) {
    return (
      <>
        <Crumb
          trail={[{ label: "Board", to: "/leaderboard" }, { label: "Players" }]}
        />
        <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>
      </>
    );
  }

  const dupes = possibleDuplicates(directory);
  const isSame = ([a, b]: [PlayerInfo, PlayerInfo]) =>
    normName(a.name) === normName(b.name);
  const sameName = dupes.filter(isSame);
  const similar = dupes.filter((pair) => !isSame(pair));
  const live = activePlayers(directory).sort((a, b) => b.games - a.games);
  const q = normName(query);
  const shown = q ? live.filter((p) => normName(p.name).includes(q)) : live;
  const merged = [...directory.values()]
    .filter((p) => p.mergedInto)
    .sort((a, b) => (b.mergedAt ?? "").localeCompare(a.mergedAt ?? ""));

  const doMerge = async ([keep, away]: [PlayerInfo, PlayerInfo]) => {
    try {
      await mergePlayers(away.id, keep.id);
      enqueueSnackbar(`Merged ${away.name} into ${keep.name}`, {
        variant: "success",
      });
    } catch (e) {
      enqueueSnackbar((e as Error).message, { variant: "error" });
    }
    setConfirm(null);
    setMergingFrom(null);
  };

  const doUndo = async (p: PlayerInfo) => {
    try {
      await undoMerge(p.id);
      enqueueSnackbar(`${p.name} is back as a separate player`, {
        variant: "success",
      });
    } catch (e) {
      enqueueSnackbar((e as Error).message, { variant: "error" });
    }
  };

  return (
    <>
      <Crumb
        trail={[{ label: "Board", to: "/leaderboard" }, { label: "Players" }]}
      />
      <div style={{ flex: 1, overflow: "auto", padding: "4px 16px 24px" }}>
        {!canEdit && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${alpha(t.gold, 0.25)}`,
              fontSize: 13,
              color: t.cream,
              opacity: 0.85,
            }}
          >
            <Link to="/login?next=/players" style={{ color: t.gold }}>
              Sign in with your email
            </Link>{" "}
            to merge duplicate players.
          </div>
        )}

        {[
          { title: "Same name", pairs: sameName },
          { title: "Similar names", pairs: similar },
        ].map(
          ({ title, pairs }) =>
            pairs.length > 0 && (
              <div key={title}>
                <div style={sectionLabel}>
                  {title} · {pairs.length}
                </div>
                {pairs.map(([keep, away]) => (
                  <div
                    key={keep.id + away.id}
                    style={{
                      borderRadius: 10,
                      overflow: "hidden",
                      border: `1px solid ${alpha(t.gold, 0.2)}`,
                      marginBottom: 8,
                    }}
                  >
                    <PlayerOption player={keep} />
                    <PlayerOption
                      player={away}
                      action={
                        canEdit && (
                          <button
                            style={smallButton}
                            onClick={() => setConfirm([keep, away])}
                          >
                            Merge
                          </button>
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            )
        )}

        <div style={sectionLabel}>All players · {live.length}</div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players"
          style={{
            width: "100%",
            padding: "10px 12px",
            marginBottom: 8,
            borderRadius: 10,
            border: `1px solid ${alpha(t.gold, 0.2)}`,
            background: alpha(t.shade, 0.25),
            color: t.cream,
            fontSize: 16,
            outline: "none",
          }}
        />
        <div
          style={{
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid ${alpha(t.gold, 0.13)}`,
          }}
        >
          {shown.map((p) => (
            <PlayerOption
              key={p.id}
              player={p}
              action={
                canEdit &&
                !p.claimedBy && (
                  <button style={smallButton} onClick={() => setMergingFrom(p)}>
                    Merge…
                  </button>
                )
              }
            />
          ))}
        </div>

        {merged.length > 0 && (
          <>
            <div style={sectionLabel}>Merged · {merged.length}</div>
            <div
              style={{
                borderRadius: 10,
                overflow: "hidden",
                border: `1px solid ${alpha(t.gold, 0.13)}`,
              }}
            >
              {merged.map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: "10px 12px",
                    background: alpha(t.shade, 0.3),
                    borderBottom: `1px solid ${alpha(t.gold, 0.08)}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1, fontSize: 14, color: t.cream }}>
                    {p.name}{" "}
                    <span style={{ opacity: 0.6 }}>
                      → {directory.get(p.mergedInto!)?.name ?? "?"}
                    </span>
                  </div>
                  {canEdit && (
                    <button style={smallButton} onClick={() => doUndo(p)}>
                      Undo
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {canEdit && <ResetLink />}
      </div>

      {mergingFrom && (
        <Sheet onClose={() => setMergingFrom(null)}>
          <div style={{ fontSize: 15, color: t.cream, marginBottom: 10 }}>
            Merge <b>{mergingFrom.name}</b> into…
          </div>
          <div
            style={{
              maxHeight: "50vh",
              overflow: "auto",
              borderRadius: 10,
              border: `1px solid ${alpha(t.gold, 0.13)}`,
            }}
          >
            {live
              .filter(
                (p) => p.id !== mergingFrom.id && !sharesGame(p, mergingFrom)
              )
              .map((p) => (
                <PlayerOption
                  key={p.id}
                  player={p}
                  onPick={() => setConfirm([p, mergingFrom])}
                />
              ))}
          </div>
          <div
            style={{ fontSize: 11, color: t.cream, opacity: 0.5, marginTop: 8 }}
          >
            Players who've been in a game together aren't listed. They must be
            different people.
          </div>
        </Sheet>
      )}

      {confirm && (
        <Sheet onClose={() => setConfirm(null)}>
          <ConfirmMerge
            pair={confirm}
            onSwap={() => setConfirm([confirm[1], confirm[0]])}
            onConfirm={() => doMerge(confirm)}
          />
        </Sheet>
      )}
    </>
  );
};

const ConfirmMerge = ({
  pair: [keep, away],
  onSwap,
  onConfirm,
}: {
  pair: [PlayerInfo, PlayerInfo];
  onSwap: () => void;
  onConfirm: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  // A player linked to an account has to be the one that's kept.
  const canSwap = !keep.claimedBy;
  return (
    <>
      <div
        style={{
          fontFamily: t.display,
          fontSize: 20,
          color: t.cream,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        Same person?
      </div>
      <div
        style={{ fontSize: 13, color: t.cream, opacity: 0.8, lineHeight: 1.45 }}
      >
        <b>{away.name}</b> ({describePlayer(away)}) will be merged into{" "}
        <b>{keep.name}</b> ({describePlayer(keep)}). Their games and scores move
        across and the leaderboard combines them. You can undo this later.
      </div>
      {canSwap && (
        <button
          onClick={onSwap}
          style={{
            ...smallButton,
            marginTop: 12,
            textTransform: "none",
            letterSpacing: 0,
            fontSize: 12,
          }}
        >
          ⇄ Keep “{away.name}” instead
        </button>
      )}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onConfirm();
        }}
        style={{
          ...goldButton,
          width: "100%",
          marginTop: 16,
          padding: 14,
          borderRadius: 12,
          fontSize: 15,
          opacity: busy ? 0.6 : 1,
        }}
      >
        Merge into {keep.name}
      </button>
    </>
  );
};

// Admins hand out a one-time link so someone who forgot their password can
// set a new one. Everyone else gets the server's "not allowed" message.
const ResetLink = () => {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setUrl("");
    try {
      setUrl(await sync.createResetLink(email.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Reset your password", url });
        return;
      } catch {
        // cancelled — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      enqueueSnackbar("Link copied", { variant: "success" });
    } catch {
      enqueueSnackbar(url);
    }
  };

  return (
    <>
      <div style={sectionLabel}>Password reset link</div>
      <form onSubmit={create} style={{ display: "flex", gap: 8 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Their account email"
          autoComplete="off"
          data-1p-ignore
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${alpha(t.gold, 0.2)}`,
            background: alpha(t.shade, 0.25),
            color: t.cream,
            fontSize: 16,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          style={{
            ...smallButton,
            opacity: busy || !email.trim() ? 0.5 : 1,
          }}
        >
          {busy ? "…" : "Create link"}
        </button>
      </form>
      {error && (
        <div style={{ color: t.red, fontSize: 13, marginTop: 8 }}>{error}</div>
      )}
      {url && (
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${alpha(t.gold, 0.2)}`,
            background: alpha(t.shade, 0.25),
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: t.cream,
              opacity: 0.8,
              wordBreak: "break-all",
            }}
          >
            {url}
          </div>
          <button style={smallButton} onClick={share}>
            {typeof navigator.share === "function" ? "Share" : "Copy"}
          </button>
        </div>
      )}
      <div style={{ fontSize: 11, color: t.cream, opacity: 0.5, marginTop: 8 }}>
        The link works once and lasts 7 days. Only admins can create them.
      </div>
    </>
  );
};
