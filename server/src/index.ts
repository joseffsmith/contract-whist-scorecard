import { startServer } from "./app";

const server = await startServer({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST || "127.0.0.1",
  dataDir: process.env.DATA_DIR ?? "/data",
  adminEmails: (process.env.ADMIN_EMAILS ?? "").split(","),
  publicUrl: process.env.PUBLIC_URL,
});
console.log(`whist server listening on ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close().then(() => process.exit(0));
  });
}
