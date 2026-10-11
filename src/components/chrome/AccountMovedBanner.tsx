import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { findLegacyAccount, LegacyAccount } from "../../lib/legacyAccount";
import { alpha, t } from "../../theme/tokens";

const DISMISSED_KEY = "whist-account-moved-dismissed";

// Shown to people whose browser was signed in under the old (InstantDB)
// system: logins didn't carry over, so they need to create their account
// again and claim their player. Hidden once they're signed in with an email
// on the new system, or when dismissed.
export const AccountMovedBanner = ({ signedIn }: { signedIn: boolean }) => {
  const [legacy, setLegacy] = useState<LegacyAccount | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (signedIn || dismissed) return;
    let live = true;
    findLegacyAccount().then((a) => live && setLegacy(a));
    return () => {
      live = false;
    };
  }, [signedIn, dismissed]);

  if (signedIn || dismissed || !legacy) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {}
  };

  return (
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
        position: "relative",
      }}
    >
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          background: "transparent",
          border: "none",
          color: t.cream,
          opacity: 0.6,
          fontSize: 18,
          lineHeight: 1,
          padding: 4,
        }}
      >
        ×
      </button>
      <div
        style={{
          fontFamily: t.display,
          fontWeight: 600,
          fontSize: 15,
          marginBottom: 4,
          paddingRight: 20,
        }}
      >
        We've moved to a new system
      </div>
      Old logins didn't carry over
      {legacy.email ? (
        <>
          {" "}
          (you used to sign in as <b>{legacy.email}</b>)
        </>
      ) : null}
      . Create your account again, then tap your name. All your games and scores
      are still here.
      <Link
        to="/login?mode=signup&next=/user"
        style={{
          display: "inline-block",
          marginTop: 10,
          padding: "8px 14px",
          borderRadius: 18,
          background: t.goldFill,
          color: t.onGold,
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        Create account
      </Link>
    </div>
  );
};
