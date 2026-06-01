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
  // Dedup key is (feed, tweet, target_jid). channelJid IS the destination JID
  // for both channel sends and group sends, so it's the right filter.
  const { error: dbErr } = await supabase
    .from("published_messages")
    .update({
      status,
      error: error ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .eq("feed_configuration_id", job.feedConfigurationId)
    .eq("tweet_id", job.tweetId)
    .eq("target_jid", job.channelJid);
  if (dbErr) log.error({ err: dbErr, job }, "failed to update published_messages");
}

/**
 * After a successful channel send, look up that channel's auto-share groups and
 * enqueue a send job for each. Group sends:
 *   - reserve their own published_messages row (per-target dedup), so retries
 *     are idempotent and the dashboard's send log shows each destination.
 *   - carry skipGroupFanout=true so they don't loop back into this function.
 *   - stagger by a couple of seconds each, so 5 groups don't fire at once.
 *
 * Failures here are swallowed and logged; the original channel send already
 * succeeded and shouldn't be marked failed because of a downstream issue.
 */
async function fanOutToGroups(parent: SendJobData): Promise<void> {
  if (!parent.channelId) return;

  const { data: routes, error: routesErr } = await supabase
    .from("channel_group_routes")
    .select("group_id")
    .eq("channel_id", parent.channelId);
  if (routesErr) {
    log.error({ err: routesErr, channelId: parent.channelId }, "failed to load group routes");
    return;
  }
  if (!routes || routes.length === 0) return;

  const groupIds = routes.map((r) => r.group_id);
  const { data: groups, error: groupsErr } = await supabase
    .from("whatsapp_groups")
    .select("id, group_jid")
    .in("id", groupIds);
  if (groupsErr) {
    log.error({ err: groupsErr, channelId: parent.channelId }, "failed to load group jids");
    return;
  }
  if (!groups || groups.length === 0) return;

  let enqueued = 0;
  for (let i = 0; i < groups.length; i++) {
    const groupJid = groups[i].group_jid;

    // Reserve the per-target send row. 23505 = already reserved (retry path) → skip.
    const { error: resErr } = await supabase.from("published_messages").insert({
      feed_configuration_id: parent.feedConfigurationId,
      tweet_id: parent.tweetId,
      channel_id: parent.channelId,
      target_jid: groupJid,
      status: "queued",
    });
    if (resErr && resErr.code !== "23505") {
      log.error({ err: resErr, groupJid }, "failed to reserve group delivery");
      continue;
    }
    if (resErr?.code === "23505") continue;

    // Stagger so 5 groups don't all fire in the same second.
    const delay = 3000 + i * 2000;
    await sendQueue.add(
      "send",
      { ...parent, channelJid: groupJid, skipGroupFanout: true },
      { delay, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    );
    enqueued += 1;
  }
  if (enqueued > 0) {
    log.info(
      { feedConfigurationId: parent.feedConfigurationId, tweetId: parent.tweetId, channelId: parent.channelId, enqueued },
      "fanned out to groups",
    );
  }
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
        // Group fan-out runs ONLY after the channel send succeeded. Its failure
        // must not bubble up — the primary send already went out.
        if (!data.skipGroupFanout) {
          await fanOutToGroups(data).catch((err) =>
            log.error({ err, jobData: data }, "group fan-out failed (channel send still delivered)"),
          );
        }
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
