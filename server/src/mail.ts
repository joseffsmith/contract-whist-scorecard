// Outgoing email through Resend (https://resend.com). Without an API key the
// link is logged instead, which is handy in development.

export type SendResetEmail = (to: string, url: string) => Promise<void>;

export type MailerOptions = {
  apiKey?: string;
  from?: string;
  apiUrl?: string;
};

const DEFAULT_FROM = "Whist <whist@joseffsmith.uk>";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createMailer(opts: MailerOptions): SendResetEmail {
  return async (to, url) => {
    if (!opts.apiKey) {
      console.log(`[mail] password reset link for ${to}: ${url}`);
      return;
    }
    const res = await fetch(opts.apiUrl ?? "https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: opts.from || DEFAULT_FROM,
        to: [to],
        subject: "Reset your Whist password",
        text: `Use this link to set a new password (it works once, for 7 days):\n\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
        html: `<p>Use this link to set a new password (it works once, for 7 days):</p><p><a href="${escapeHtml(
          url
        )}">Set a new password</a></p><p>If you didn't ask for this, you can ignore this email.</p>`,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
    }
  };
}
