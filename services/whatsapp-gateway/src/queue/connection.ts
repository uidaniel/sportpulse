import IORedis from "ioredis";
import type { ConnectionOptions } from "bullmq";
import { config } from "../config";
import { logger } from "../logger";

export const SEND_QUEUE = "wa-send";

export interface SendJobData {
  userId: string;
  channelJid: string;
  text: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
  feedConfigurationId: string;
  tweetId: string;
}

// BullMQ requires maxRetriesPerRequest = null on the shared connection.
// rediss:// URLs (e.g. Upstash) enable TLS automatically in ioredis.
export const redisConnection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Without a listener, ioredis 'error' events become unhandled exceptions and
// crash the process on transient Redis blips. Log and let ioredis reconnect.
redisConnection.on("error", (err) => logger.error({ err, module: "redis" }, "redis connection error"));

// BullMQ ships its own nested ioredis copy; the instance is runtime-compatible
// but the duplicated types don't unify, so present it as BullMQ's ConnectionOptions.
export const bullConnection = redisConnection as unknown as ConnectionOptions;
