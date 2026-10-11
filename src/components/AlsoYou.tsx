import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import {
  activePlayers,
  namesLookAlike,
  sharesGame,
  usePlayerDirectory,
} from "../players/directory";
import { mergePlayers } from "../players/merge";
import { alpha, t } from "../theme/tokens";
import { PlayerOption } from "./ChoosePlayerOrCreate";

const DISMISSED_KEY = "whist-not-me";
const readDismissed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
  } catch {
    return [];
  }
};

// "Are any of these also you?" — unclaimed players with a similar name that
// could be the same person (never in a game together). Tapping "That's me"
// merges them into your player.
export const AlsoYou = ({ playerId }: { playerId: string }) => {
  const { directory } = usePlayerDirectory();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [busy, setBusy] = useState<string | null>(null);
  const me = directory.get(playerId);
  if (!me) return null;

  const candidates = activePlayers(directory).filter(
    (p) =>
      p.id !== me.id &&
      !p.claimedBy &&
      !dismissed.includes(p.id) &&
      namesLookAlike(p.name, me.name) &&
      !sharesGame(p, me)
  );
  if (!candidates.length) return null;

  const dismiss = (pid: string) => {
    const next = [...dismissed, pid];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {}
  };

  const claim = async (pid: string, name: string) => {
    setBusy(pid);
    try {
      await mergePlayers(pid, me.id);
      enqueueSnackbar(`Merged ${name}'s games into yours`, {
        variant: "success",
      });
    } catch (e) {
      enqueueSnackbar((e as Error).message, { variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  const button = {
    fontSize: 11,
    borderRadius: 14,
    padding: "5px 10px",
    background: "transparent",
    flexShrink: 0,
  };

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${alpha(t.gold, 0.4)}`,
        background: alpha(t.gold, 0.06),
        marginBottom: 14,
      }}
    >
      <div
        style={{
          fontFamily: t.display,
          fontSize: 17,
          fontWeight: 600,
          color: t.cream,
        }}
      >
        Are any of these also you?
      </div>
      <div
        style={{
          fontSize: 12,
          color: t.cream,
          opacity: 0.65,
          margin: "4px 0 10px",
        }}
      >
        Tap “That's me” to move their games onto your player.
      </div>
      <div
        style={{
          borderRadius: 10,
          overflow: "hidden",
          border: `1px solid ${alpha(t.gold, 0.13)}`,
        }}
      >
        {candidates.map((p) => (
          <PlayerOption
            key={p.id}
            player={p}
            action={
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  disabled={!!busy}
                  onClick={() => dismiss(p.id)}
                  style={{
                    ...button,
                    color: t.cream,
                    opacity: 0.6,
                    border: `1px solid ${alpha(t.cream, 0.25)}`,
                  }}
                >
                  No
                </button>
                <button
                  disabled={!!busy}
                  onClick={() => claim(p.id, p.name)}
                  style={{
                    ...button,
                    color: t.onGold,
                    background: t.goldFill,
                    border: "none",
                    fontWeight: 700,
                    opacity: busy === p.id ? 0.6 : 1,
                  }}
                >
                  That's me
                </button>
              </div>
            }
          />
        ))}
      </div>
    </div>
  );
};
