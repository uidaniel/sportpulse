import { Worker, Queue, type Job } from "bullmq";
import { config } from "../config";
import { logger } from "../logger";
import { supabase } from "../supabase";
import { sendToChannel, SessionNotConnectedError } from "../wa/channels";
import { SEND_QUEUE, bullConnection, type SendJobData } from "./connection";

const log = logger.child({ module: "sender" });

// Producer handle (used by the test endpoint now; the scraper service will have
// its own Queue pointed at the same Redis/queue name).
export const sendQueue = new Queue<SendJobData>(SEND_QUEUE, { connection: bullConnection });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function throttleDelay(): number {
  const { WA_SEND_MIN_DELAY_MS: min, WA_SEND_MAX_DELAY_MS: max } = config;
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

async function markDelivery(
  job: SendJobData,
  status: "sent" | "failed" | "skipped",
  error?: string,
): Promise<void> {
  // No-op if the scraper hasn't created the row (e.g. manual test sends).
  const { error: dbErr } = await supabase
    .from("published_messages")
    .update({
      status,
      error: error ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .eq("feed_configuration_id", job.feedConfigurationId)
    .eq("tweet_id", job.tweetId)
    .eq("channel_id", job.channelId);
  if (dbErr) log.error({ err: dbErr, job }, "failed to update published_messages");
}

export function startSenderWorker(): Worker<SendJobData> {
  // Concurrency 1 + a post-send 3-5s delay serialises sends and enforces the
  // §7 anti-ban throttle. (Shard per-session later if throughput demands it.)
  const worker = new Worker<SendJobData>(
    SEND_QUEUE,
    async (job: Job<SendJobData>) => {
      const data = job.data;
      try {
        await sendToChannel(data.userId, data.channelJid, {
          text: data.text,
          mediaUrl: data.mediaUrl,
          mediaType: data.mediaType,
        });
        await markDelivery(data, "sent");
      } catch (err) {
        if (err instanceof SessionNotConnectedError) {
          // Retrying won't help until the user reconnects; drop without retry.
          log.warn({ userId: data.userId }, "session not connected; skipping send");
          await markDelivery(data, "skipped", "session not connected");
          return;
        }
        await markDelivery(data, "failed", err instanceof Error ? err.message : String(err));
        throw err; // let BullMQ retry transient send failures
      } finally {
        await sleep(throttleDelay());
      }
    },
    { connection: bullConnection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => log.error({ jobId: job?.id, err }, "send job failed"));
  worker.on("completed", (job) => log.debug({ jobId: job.id }, "send job completed"));
  // Redis-level errors arrive here; without a handler they crash the process.
  worker.on("error", (err) => log.error({ err }, "sender worker error"));
  return worker;
}
