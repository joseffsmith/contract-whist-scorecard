import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { alpha, t } from "../theme/tokens";
import { Shell } from "./chrome/Shell";

// The privacy policy the App Store and Google Play link to
// (https://joseffsmith.uk/contract-whist/privacy). Keep it true to what the
// server and app actually do; see docs/backend/SPEC.md.
export const CONTACT_EMAIL = "CONTACT_EMAIL_TODO";
const UPDATED = "11 October 2026";

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section style={{ marginTop: 22 }}>
    <h2
      style={{
        fontFamily: t.display,
        fontSize: 18,
        fontWeight: 600,
        color: t.cream,
        margin: "0 0 6px",
      }}
    >
      {title}
    </h2>
    {children}
  </section>
);

export const Privacy = () => (
  <Shell scroll>
    <div
      style={{
        maxWidth: 640,
        width: "100%",
        margin: "0 auto",
        padding: "28px 20px 40px",
        boxSizing: "border-box",
        fontSize: 14,
        lineHeight: 1.6,
        color: alpha(t.cream, 0.85),
      }}
    >
      <Link to="/" style={{ color: t.gold, fontSize: 13 }}>
        ‹ Whist
      </Link>
      <div
        style={{
          marginTop: 18,
          fontSize: 10,
          color: t.gold,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        Contract Whist
      </div>
      <h1
        style={{
          fontFamily: t.display,
          fontSize: 30,
          fontWeight: 600,
          color: t.cream,
          margin: "4px 0 2px",
        }}
      >
        Privacy
      </h1>
      <div style={{ fontSize: 12, opacity: 0.6 }}>Last updated {UPDATED}</div>

      <p>
        Whist is a scorecard for games of contract whist among friends, run
        as a hobby. It has no ads, no analytics and no tracking, and nothing is
        sold or shared with anyone.
      </p>

      <Section title="What's stored">
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            <b>Games:</b> player names, seating, bids and scores, and when each
            game was played.
          </li>
          <li>
            <b>Your account, if you make one:</b> your email address (optional),
            a scrambled form of your password (never the password itself), and
            for each passkey its public key and a label such as "iPhone". Your
            face or fingerprint never leaves your device.
          </li>
          <li>
            <b>If you sign in with Apple:</b> the code Apple uses for you with
            this app. Apple doesn't share your name or email with us.
          </li>
          <li>
            <b>Sign-in sessions:</b> a scrambled copy of each device's sign-in
            token, so you stay signed in.
          </li>
          <li>
            <b>Server logs:</b> the web server records IP addresses and the
            pages asked for, kept for up to two weeks to keep the service
            working and safe.
          </li>
        </ul>
      </Section>

      <Section title="Who can see it">
        <p style={{ margin: 0 }}>
          Games, player names and scores are shared: anyone using the app can
          see them, as on a scoreboard. Your email address, password and
          passkeys are never shown to anyone.
        </p>
      </Section>

      <Section title="Where it's kept">
        <p style={{ margin: 0 }}>
          On a server rented from Hetzner in Germany, with daily backups kept
          for two weeks. Your phone or browser also keeps a copy of the games
          and your sign-in, so the app works without signal.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p style={{ margin: 0 }}>
          You can delete your account at any time from the <b>You</b> page:
          your email, password, passkeys, Apple sign-in and sign-ins are
          removed straight away
          (and from backups within two weeks). Games and scores stay, because
          they belong to everyone who played; to have your name taken off them,
          email us.
        </p>
      </Section>

      <Section title="Children">
        <p style={{ margin: 0 }}>
          Whist isn't aimed at children and doesn't knowingly collect data
          about them.
        </p>
      </Section>

      <Section title="Contact">
        <p style={{ margin: 0 }}>
          Questions or requests:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: t.gold }}>
            {CONTACT_EMAIL}
          </a>
          . If this policy changes, the date at the top changes with it.
        </p>
      </Section>
    </div>
  </Shell>
);
