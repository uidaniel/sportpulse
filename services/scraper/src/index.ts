import { createServer } from "node:http";
import { config } from "./config";
import { logger } from "./logger";
import { redisConnection } from "./queue/connection";
import { startWorkers, scheduleCron } from "./workers";
import { enqueueDueHandles, pollQueue } from "./scheduler";

const log = logger.child({ module: "main" });

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
  server.listen(config.HEALTH_PORT, () => log.info({ port: config.HEALTH_PORT }, "health server listening"));
  return server;
}

async function main(): Promise<void> {
  // Bind the health port first so platforms see the service as up even while
  // Redis/Supabase connections are still settling.
  const server = startHealthServer();
  const { pollWorker, cronWorker } = startWorkers();
  await scheduleCron();

  // Run one cycle immediately so we don't wait a full interval after boot.
  enqueueDueHandles()
    .then((n) => log.info({ handles: n }, "initial poll cycle enqueued"))
    .catch((err) => log.error({ err }, "initial enqueue failed"));

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    server.close();
    await pollWorker.close();
    await cronWorker.close();
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
