import { supabase } from "../supabase";
import { logger } from "../logger";
import { config } from "../config";
import { redisConnection } from "../queue/connection";
import { fetchLatestTweets } from "../x/client";
import { fanOutTweet } from "./fanout";

const log = logger.child({ module: "poll" });

const cacheKey = (handleId: string) => `x:lasttweet:${handleId}`;

// Tweet IDs are snowflakes (monotonic). Compare numerically; fall back to string.
function isNewer(a: string, b: string): boolean {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return a > b;
  }
}

async function setCache(handleId: string, newestId: string): Promise<void> {
  await redisConnection.set(cacheKey(handleId), newestId);
  const { error } = await supabase
    .from("tracked_x_handles")
    .update({
      last_cached_tweet_id: newestId,
      last_polled_at: new Date().toISOString(),
      poll_error_count: 0,
    })
    .eq("id", handleId);
  if (error) log.error({ err: error, handleId }, "failed to persist cache");
}

async function markPolled(handleId: string): Promise<void> {
  await supabase
    .from("tracked_x_handles")
    .update({ last_polled_at: new Date().toISOString() })
    .eq("id", handleId);
}

async function bumpError(handleId: string): Promise<void> {
  const { data } = await supabase
    .from("tracked_x_handles")
    .select("poll_error_count")
    .eq("id", handleId)
    .maybeSingle();
  await supabase
    .from("tracked_x_handles")
    .update({
      poll_error_count: (data?.poll_error_count ?? 0) + 1,
      last_polled_at: new Date().toISOString(),
    })
    .eq("id", handleId);
}

/**
 * FR-4.2/4.3: poll one unique handle exactly once. Returns the number of
 * send jobs enqueued across all subscribers.
 */
export async function pollHandle(handleId: string, screenName: string): Promise<number> {
  // Last seen id: Redis cache first, DB as the durable fallback.
  let lastId = await redisConnection.get(cacheKey(handleId));
  if (lastId == null) {
    const { data } = await supabase
      .from("tracked_x_handles")
      .select("last_cached_tweet_id")
      .eq("id", handleId)
      .maybeSingle();
    lastId = data?.last_cached_tweet_id ?? null;
  }

  let tweets;
  try {
    tweets = await fetchLatestTweets(screenName);
  } catch (err) {
    await bumpError(handleId);
    throw err; // surface to BullMQ for retry/backoff
  }

  if (tweets.length === 0) {
    await markPolled(handleId);
    return 0;
  }

  const sorted = [...tweets].sort((a, b) => (isNewer(a.id, b.id) ? 1 : -1)); // oldest -> newest
  const newestId = sorted[sorted.length - 1].id;

  // First ever poll: set a baseline so we don't blast historical tweets.
  if (!lastId) {
    await setCache(handleId, newestId);
    log.info({ screenName, baseline: newestId }, "baseline set on first poll");
    return 0;
  }

  const newTweets = sorted
    .filter((t) => isNewer(t.id, lastId!))
    .slice(-config.SCRAPER_MAX_TWEETS_PER_CYCLE);

  let enqueued = 0;
  for (const tweet of newTweets) {
    enqueued += await fanOutTweet(screenName, handleId, tweet);
  }

  await setCache(handleId, newestId);
  log.debug({ screenName, newTweets: newTweets.length, enqueued }, "polled handle");
  return enqueued;
}
