import { Worker } from "bullmq";
import { bullConnection } from "./queue/connection";
import { config } from "./config";
import { logger } from "./logger";
import { POLL_QUEUE, type PollJobData } from "./scheduler";
import { pollHandle } from "./pipeline/poll";

const log = logger.child({ module: "workers" });

// Per-handle poll worker. The limiter caps RapidAPI calls per window (§7 cost
// control); concurrency bounds parallelism. The scheduler "tick" that feeds this
// queue lives in index.ts as a plain interval (see note there).
export function startPollWorker(): Worker {
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
  return pollWorker;
}
