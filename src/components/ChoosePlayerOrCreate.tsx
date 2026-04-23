import { enqueueSnackbar } from "notistack";
import { useMemo, useState } from "react";
import { db } from "../db";
import { queryAllPlayers } from "../queries";
import { t } from "../theme/tokens";

export const ChoosePlayerOrCreate = ({
  createPlayer,
  choosePlayer,
  excludedPlayerIds,
}: {
  createPlayer: (name: string) => Promise<void>;
  choosePlayer: (id: string) => Promise<void>;
  excludedPlayerIds: (string | undefined)[];
}) => {
  const { data } = db.useQuery(queryAllPlayers);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => {
    const q = input.trim().toLowerCase();
    return (data?.players ?? [])
      .filter((p) => !excludedPlayerIds.includes(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [data?.players, input, excludedPlayerIds]);

  const exact = options.find(
    (o) => o.name.trim().toLowerCase() === input.trim().toLowerCase()
  );

  const submitNew = async () => {
    if (!input.trim()) {
      enqueueSnackbar("Name is required", { variant: "error" });
      return;
    }
    setBusy(true);
    try {
      await createPlayer(input.trim());
      setInput("");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (id: string) => {
    setBusy(true);
    try {
      await choosePlayer(id);
      setInput("");
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
          background: "rgba(0,0,0,0.25)",
          border: `1px solid ${t.gold}33`,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search or create player"
          data-1p-ignore
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: t.cream,
            fontSize: 14,
            padding: "4px 6px",
          }}
        />
        {input.trim() && !exact && (
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
            }}
          >
            Create
          </button>
        )}
      </div>
      {input && options.length > 0 && (
        <div
          style={{
            marginTop: 6,
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid ${t.gold}22`,
          }}
        >
          {options.map((o) => (
            <div
              key={o.id}
              onClick={() => pick(o.id)}
              style={{
                padding: "10px 12px",
                background: "rgba(0,0,0,0.3)",
                borderBottom: `1px solid ${t.gold}15`,
                cursor: "pointer",
                fontSize: 14,
                color: t.cream,
              }}
            >
              {o.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
