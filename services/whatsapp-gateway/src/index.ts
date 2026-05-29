import { config } from "./config";
import { logger } from "./logger";
import { supabase } from "./supabase";
import { buildServer } from "./http/server";
import { startSenderWorker } from "./queue/sender";
import { connect } from "./wa/sessionManager";
import { redisConnection } from "./queue/connection";

const log = logger.child({ module: "main" });

// Baileys can surface transient errors (e.g. a socket closing mid-operation) as
// unhandled rejections/exceptions. For a long-running gateway we log and keep
// running rather than crash — the session manager's reconnect logic recovers.
process.on("unhandledRejection", (reason) =>
  log.error({ err: reason }, "unhandledRejection (continuing)"),
);
process.on("uncaughtException", (err) => log.error({ err }, "uncaughtException (continuing)"));

// After a restart, re-establish sockets for sessions that were connected.
// Stored credentials in whatsapp_auth_state let these resume without a new QR.
async function restoreSessions(): Promise<void> {
  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("user_id")
    .eq("status", "connected");
  if (error) {
    log.error({ err: error }, "failed to load sessions to restore");
    return;
  }
  log.info({ count: data.length }, "restoring previously-connected sessions");
  for (const row of data) {
    connect(row.user_id).catch((err) => log.error({ err, userId: row.user_id }, "restore failed"));
  }
}

async function main(): Promise<void> {
  const worker = startSenderWorker();
  log.info("sender worker started");

  const app = buildServer();
  const server = app.listen(config.PORT, () => log.info({ port: config.PORT }, "gateway listening"));

  await restoreSessions();

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    server.close();
    await worker.close();
    await redisConnection.quit();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error({ err }, "fatal startup error");
  process.exit(1);
});
