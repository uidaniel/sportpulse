import { createServer } from "node:http";
import { config } from "./config";
import { logger } from "./logger";
import { redisConnection } from "./queue/connection";
import { startPollWorker } from "./workers";
import { enqueueDueHandles, pollQueue } from "./scheduler";

const log = logger.child({ module: "main" });

// Keep the worker alive through transient Redis/Supabase blips.
process.on("unhandledRejection", (reason) => log.error({ err: reason }, "unhandledRejection (continuing)"));
process.on("uncaughtException", (err) => log.error({ err }, "uncaughtException (continuing)"));

function startHealthServer() {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.on("error", (err) => log.error({ err }, "health server error (non-fatal)"));
  server.listen(config.HEALTH_PORT, () => log.info({ port: config.HEALTH_PORT }, "health server listening"));
  return server;
}

async function main(): Promise<void> {
  const server = startHealthServer();
  const pollWorker = startPollWorker();

  // Scheduler tick: a plain interval (NOT a BullMQ repeatable). The repeatable
  // job hit "Missing lock" errors under restarts/duplicate workers; a single
  // owned interval is simpler and robust. Per-handle poll jobs still go through
  // BullMQ (for rate-limiting + retries).
  const tick = () =>
    enqueueDueHandles()
      .then((n) => {
        if (n > 0) log.info({ handles: n }, "tick: enqueued due handle polls");
      })
      .catch((err) => log.error({ err }, "tick failed"));

  await tick(); // run one cycle immediately
  const tickTimer = setInterval(() => void tick(), config.SCRAPER_TICK_INTERVAL_MS);
  log.info({ everyMs: config.SCRAPER_TICK_INTERVAL_MS }, "scheduler tick running");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    clearInterval(tickTimer);
    server.close();
    await pollWorker.close();
    await pollQueue.close();
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
