import { startServer } from "./app";

// A failure to start (bad DATA_DIR, port in use, old Node) crashes with a
// clear error. Once listening, request-scoped surprises are logged instead.
const hops = process.env.TRUST_PROXY_HOPS;
if (hops !== undefined && !/^\d+$/.test(hops)) {
  throw new Error("TRUST_PROXY_HOPS must be a whole number (default 1).");
}

const backupDays = process.env.BACKUP_DAYS;
if (backupDays !== undefined && !/^\d+$/.test(backupDays)) {
  throw new Error("BACKUP_DAYS must be a whole number (default 14, 0 = off).");
}

const server = await startServer({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST || "127.0.0.1",
  dataDir: process.env.DATA_DIR ?? "/data",
  publicUrl: process.env.PUBLIC_URL,
  adminBootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN,
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
