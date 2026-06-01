import IORedis from "ioredis";
import { Queue, type ConnectionOptions } from "bullmq";
import { config } from "../config";
import { logger } from "../logger";

// Queue the WhatsApp gateway consumes. The job shape MUST match the gateway's
// SendJobData (services/whatsapp-gateway/src/queue/connection.ts).
export const SEND_QUEUE = "wa-send";

export interface SendJobData {
  userId: string;
  /** Destination JID — channel for primary sends; the gateway may also enqueue group JIDs internally. */
  channelJid: string;
  /** Source channel UUID — used by the gateway for per-destination dedup and group fan-out lookup. */
  channelId: string;
  text: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
  feedConfigurationId: string;
  tweetId: string;
  /** Internal flag used by the gateway; the scraper never sets these. */
  skipGroupFanout?: boolean;
  forwardFromChannelJid?: string;
  forwardFromChannelName?: string;
}

export const redisConnection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
redisConnection.on("error", (err) => logger.error({ err, module: "redis" }, "redis connection error"));

// BullMQ bundles its own ioredis copy; the instance is runtime-compatible but the
// duplicated types don't unify, so present it as BullMQ's ConnectionOptions.
export const bullConnection = redisConnection as unknown as ConnectionOptions;

export const sendQueue = new Queue<SendJobData>(SEND_QUEUE, { connection: bullConnection });
