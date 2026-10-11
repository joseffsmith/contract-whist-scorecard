import { enqueueSnackbar } from "notistack";
import { useMemo, useState } from "react";
import {
  activePlayers,
  describePlayer,
  normName,
  PlayerInfo,
  usePlayerDirectory,
} from "../players/directory";
import { alpha, t } from "../theme/tokens";

export const ChoosePlayerOrCreate = ({
  createPlayer,
  choosePlayer,
  excludedPlayerIds,
  contextPlayerIds = [],
  hideClaimed = false,
}: {
  createPlayer: (name: string) => Promise<void>;
  choosePlayer: (id: string) => Promise<void>;
  excludedPlayerIds: (string | undefined)[];
  // Players already at the table (or you) — people they play with rank first.
  contextPlayerIds?: (string | undefined)[];
  // Hide players that belong to someone's account (when picking yourself).
  hideClaimed?: boolean;
}) => {
  const { directory } = usePlayerDirectory();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDupe, setConfirmDupe] = useState(false);

  const candidates = useMemo(() => {
    const context = new Set(contextPlayerIds.filter(Boolean));
    const relevance = (p: PlayerInfo) =>
      p.coPlayers.reduce((n, c) => n + (context.has(c.id) ? c.count : 0), 0);
    return activePlayers(directory)
      .filter((p) => !excludedPlayerIds.includes(p.id))
      .filter((p) => !(hideClaimed && p.claimedBy))
      .sort(
        (a, b) =>
          relevance(b) - relevance(a) ||
          (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "") ||
          b.games - a.games
      );
  }, [directory, excludedPlayerIds, contextPlayerIds, hideClaimed]);

  const q = normName(input);
  const options = q
    ? candidates.filter((p) => normName(p.name).includes(q)).slice(0, 8)
    : candidates.slice(0, 6);
  const sameName = q
    ? activePlayers(directory).filter((p) => normName(p.name) === q)
    : [];

  const submitNew = async () => {
    if (!input.trim()) {
      enqueueSnackbar("Name is required", { variant: "error" });
      return;
    }
    if (sameName.length && !confirmDupe) {
      setConfirmDupe(true);
      return;
    }
    setBusy(true);
    try {
      await createPlayer(input.trim());
      setInput("");
      setConfirmDupe(false);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (id: string) => {
    setBusy(true);
    try {
      await choosePlayer(id);
      setInput("");
      setConfirmDupe(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 10,
          borderRadius: 10,
          background: alpha(t.shade, 0.25),
          border: `1px solid ${alpha(t.gold, 0.2)}`,
        }}
      >
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setConfirmDupe(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && submitNew()}
          placeholder="Search or add a name"
          data-1p-ignore
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            color: t.cream,
            fontSize: 16,
            padding: "4px 6px",
          }}
        />
        {input.trim() && (
          <button
            onClick={submitNew}
            disabled={busy}
            style={{
              border: `1px solid ${t.gold}`,
              color: t.gold,
              background: "transparent",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 12,
              fontFamily: t.display,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            {confirmDupe ? "Add anyway" : "New"}
          </button>
        )}
      </div>

      {confirmDupe && (
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${alpha(t.gold, 0.4)}`,
            background: alpha(t.gold, 0.08),
            fontSize: 13,
            color: t.cream,
            lineHeight: 1.4,
          }}
        >
          There's already {sameName.length === 1 ? "a" : sameName.length}{" "}
          <b>{input.trim()}</b> ({describePlayer(sameName[0])}). If that's who
          you mean, tap them below. If it's someone different, add an initial
          (e.g. <b>{input.trim()} B</b>) so you can tell them apart.
        </div>
      )}

      {options.length > 0 && (
        <>
          {!q && (
            <div
              style={{
                fontSize: 10,
                color: t.gold,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                fontWeight: 700,
                margin: "12px 2px 6px",
                opacity: 0.8,
              }}
            >
              Suggested
            </div>
          )}
          <div
            style={{
              marginTop: q ? 6 : 0,
              borderRadius: 10,
              overflow: "hidden",
              border: `1px solid ${alpha(t.gold, 0.13)}`,
            }}
          >
            {options.map((o) => (
              <PlayerOption key={o.id} player={o} onPick={() => pick(o.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const PlayerOption = ({
  player,
  onPick,
  action,
}: {
  player: PlayerInfo;
  onPick?: () => void;
  action?: React.ReactNode;
}) => (
  <div
    onClick={onPick}
    role={onPick ? "button" : undefined}
    style={{
      padding: "10px 12px",
      background: alpha(t.shade, 0.3),
      borderBottom: `1px solid ${alpha(t.gold, 0.08)}`,
      cursor: onPick ? "pointer" : "default",
      display: "flex",
      alignItems: "center",
      gap: 10,
    }}
  >
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 15, color: t.cream, fontWeight: 600 }}>
        {player.name}
        {player.claimedBy && (
          <span
            title="Linked to someone's phone or account"
            style={{ color: t.pos, fontSize: 12, marginLeft: 6 }}
          >
            ✓
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 12,
          color: t.cream,
          opacity: 0.6,
          marginTop: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {describePlayer(player)}
      </div>
    </div>
    {action}
  </div>
);
