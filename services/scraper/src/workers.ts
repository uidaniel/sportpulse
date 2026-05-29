import { Worker, Queue } from "bullmq";
import { bullConnection } from "./queue/connection";
import { config } from "./config";
import { logger } from "./logger";
import { POLL_QUEUE, type PollJobData, enqueueDueHandles } from "./scheduler";
import { pollHandle } from "./pipeline/poll";

const log = logger.child({ module: "workers" });

const CRON_QUEUE = "x-cron";

export function startWorkers(): { pollWorker: Worker; cronWorker: Worker } {
  // Per-handle poll worker. The limiter caps RapidAPI calls per window (§7 cost
  // control); concurrency bounds parallelism.
  const pollWorker = new Worker<PollJobData>(
    POLL_QUEUE,
    (job) => pollHandle(job.data.handleId, job.data.screenName),
    {
      connection: bullConnection,
      concurrency: config.SCRAPER_POLL_CONCURRENCY,
      limiter: { max: config.SCRAPER_RATE_MAX, duration: config.SCRAPER_RATE_DURATION_MS },
    },
  );
  pollWorker.on("failed", (job, err) =>
    log.error({ screenName: job?.data.screenName, err }, "poll job failed"),
  );
  pollWorker.on("error", (err) => log.error({ err }, "poll worker error"));

  // Cron tick worker: fans the active-handle list into per-handle poll jobs.
  const cronWorker = new Worker(
    CRON_QUEUE,
    async () => {
      const count = await enqueueDueHandles();
      if (count > 0) log.info({ handles: count }, "cron tick: enqueued due handle polls");
    },
    { connection: bullConnection },
  );
  cronWorker.on("error", (err) => log.error({ err }, "cron worker error"));

  return { pollWorker, cronWorker };
}

/**
 * Register the repeatable cron tick. BullMQ dedups repeatables by their repeat
 * config, so calling this on every boot is idempotent (no duplicate schedules).
 */
export async function scheduleCron(): Promise<Queue> {
  const cronQueue = new Queue(CRON_QUEUE, { connection: bullConnection });
  await cronQueue.add(
    "tick",
    {},
    { repeat: { every: config.SCRAPER_TICK_INTERVAL_MS }, removeOnComplete: true, removeOnFail: 100 },
  );
  log.info({ everyMs: config.SCRAPER_TICK_INTERVAL_MS }, "cron schedule registered");
  return cronQueue;
}
