import { startServer } from "./app";

// A failure to start (bad DATA_DIR, port in use, old Node) crashes with a
// clear error. Once listening, request-scoped surprises are logged instead.
const server = await startServer({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST || "127.0.0.1",
  dataDir: process.env.DATA_DIR ?? "/data",
  publicUrl: process.env.PUBLIC_URL,
  adminBootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN,
  importToken: process.env.IMPORT_TOKEN,
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
