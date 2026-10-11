import { useState } from "react";
import { useGuestGames } from "../../guest/useGuestGame";
import { useAuth } from "../../sync";
import { alpha, t } from "../../theme/tokens";
import { GuestMigrationDialog } from "../GuestMigrationDialog";

// Games stored only on this phone (the old local guest mode) can be uploaded
// once someone is signed in, guest or account, so everyone can see them.
export const LocalGamesBanner = () => {
  const { user } = useAuth();
  const games = useGuestGames();
  const [open, setOpen] = useState(false);

  if (!user || games.length === 0) return null;

  return (
    <>
      <div
        role="status"
        style={{
          margin: "12px 16px 0",
          padding: "12px 14px",
          borderRadius: 12,
          border: `1px solid ${alpha(t.gold, 0.45)}`,
          background: alpha(t.gold, 0.08),
          color: t.cream,
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        {games.length} game{games.length === 1 ? "" : "s"} saved only on this
        phone. Save {games.length === 1 ? "it" : "them"} so everyone can see{" "}
        {games.length === 1 ? "it" : "them"}.
        <button
          onClick={() => setOpen(true)}
          style={{
            display: "block",
            marginTop: 10,
            padding: "8px 14px",
            borderRadius: 18,
            border: "none",
            background: t.goldFill,
            color: t.onGold,
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          Save {games.length === 1 ? "game" : "games"}
        </button>
      </div>
      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
          <GuestMigrationDialog
            userId={user.id}
            games={games}
            onDone={() => setOpen(false)}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
};
