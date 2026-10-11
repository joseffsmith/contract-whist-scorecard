import { startServer } from "./app";

// A failure to start (bad DATA_DIR, port in use, old Node) crashes with a
// clear error. Once listening, request-scoped surprises are logged instead.
const hops = process.env.TRUST_PROXY_HOPS || undefined;
if (hops !== undefined && !/^\d+$/.test(hops)) {
  throw new Error("TRUST_PROXY_HOPS must be a whole number (default 1).");
}

const backupDays = process.env.BACKUP_DAYS || undefined;
if (backupDays !== undefined && !/^\d+$/.test(backupDays)) {
  throw new Error("BACKUP_DAYS must be a whole number (default 14, 0 = off).");
}

// A comma-separated list of origins, e.g. https://joseffsmith.uk,https://whist.joseffsmith.uk
const passkeyOrigins = process.env.PASSKEY_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
for (const origin of passkeyOrigins ?? []) {
  let valid = false;
  try {
    valid = new URL(origin).origin === origin;
  } catch {
    /* not a URL */
  }
  if (!valid) {
    throw new Error(
      `PASSKEY_ORIGINS must list origins like https://example.com (got "${origin}").`
    );
  }
}

const server = await startServer({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST || "127.0.0.1",
  dataDir: process.env.DATA_DIR ?? "/data",
  publicUrl: process.env.PUBLIC_URL,
  corsOrigins: process.env.CORS_ORIGINS,
  adminBootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN,
  passkeyRpId: process.env.PASSKEY_RP_ID || undefined,
  passkeyOrigins,
  importToken: process.env.IMPORT_TOKEN,
  backupDays: backupDays === undefined ? undefined : Number(backupDays),
  trustProxyHops: hops === undefined ? undefined : Number(hops),
});
console.log(`whist server listening on ${server.url}`);

process.on("uncaughtException", (e) => console.error("Uncaught exception:", e));
process.on("unhandledRejection", (e) =>
  console.error("Unhandled rejection:", e)
);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close().finally(() => process.exit(0));
  });
}
