import { supabase } from "../supabase";
import { logger } from "../logger";
import { sendQueue } from "../queue/connection";
import { passesFilters, type FeedFilters } from "./filters";
import { formatMessage } from "./format";
import type { NormalizedTweet } from "../x/types";

const log = logger.child({ module: "fanout" });

interface Subscriber {
  feedConfigId: string;
  userId: string;
  filters: FeedFilters;
  channelJid: string;
  branded: boolean; // append the watermark? (true unless the tier removes branding)
}

// Active subscribers of a handle whose WhatsApp session is connected and has a
// target channel selected. (whatsapp_sessions has no FK to feed_configurations,
// so we resolve channels in a second query rather than an embedded join.)
async function getSubscribers(handleId: string): Promise<Subscriber[]> {
  const { data: configs, error } = await supabase
    .from("feed_configurations")
    .select("id, user_id, include_retweets, include_replies, forward_media, include_videos, exclude_links")
    .eq("tracked_handle_id", handleId)
    .eq("is_active", true);
  if (error) throw error;
  if (!configs || configs.length === 0) return [];

  const userIds = [...new Set(configs.map((c) => c.user_id))];

  const { data: sessions, error: sErr } = await supabase
    .from("whatsapp_sessions")
    .select("user_id, whatsapp_channel_id")
    .in("user_id", userIds)
    .eq("status", "connected")
    .not("whatsapp_channel_id", "is", null);
  if (sErr) throw sErr;
  const channelByUser = new Map((sessions ?? []).map((s) => [s.user_id, s.whatsapp_channel_id!]));

  // Resolve each user's tier -> whether branding is removed (watermark off).
  const { data: subs } = await supabase.from("subscriptions").select("user_id, tier").in("user_id", userIds);
  const { data: plans } = await supabase.from("plan_limits").select("tier, remove_branding");
  const removeBrandingByTier = new Map((plans ?? []).map((p) => [p.tier, p.remove_branding]));
  const brandedByUser = new Map(
    (subs ?? []).map((s) => [s.user_id, !(removeBrandingByTier.get(s.tier) ?? false)]),
  );

  return configs
    .filter((c) => channelByUser.has(c.user_id))
    .map((c) => ({
      feedConfigId: c.id,
      userId: c.user_id,
      filters: {
        include_retweets: c.include_retweets,
        include_replies: c.include_replies,
        forward_media: c.forward_media,
        include_videos: c.include_videos,
        exclude_links: c.exclude_links,
      },
      channelJid: channelByUser.get(c.user_id)!,
      branded: brandedByUser.get(c.user_id) ?? true, // default to branded (free) if unknown
    }));
}

// Durable idempotency: returns true only if THIS call created the row. The
// unique (feed_configuration_id, tweet_id) constraint makes a duplicate a no-op,
// so a tweet is enqueued at most once per channel even across restarts.
async function reserveDelivery(feedConfigId: string, tweetId: string): Promise<boolean> {
  const { error } = await supabase
    .from("published_messages")
    .insert({ feed_configuration_id: feedConfigId, tweet_id: tweetId, status: "queued" });
  if (!error) return true;
  if (error.code === "23505") return false; // already reserved by a previous cycle
  log.error({ err: error, feedConfigId, tweetId }, "failed to reserve delivery");
  return false;
}

/** FR-4.3: format per subscriber's rules and enqueue to the gateway. */
export async function fanOutTweet(
  screenName: string,
  handleId: string,
  tweet: NormalizedTweet,
): Promise<number> {
  const subscribers = await getSubscribers(handleId);
  let enqueued = 0;

  for (const sub of subscribers) {
    if (!passesFilters(tweet, sub.filters)) continue;
    if (!(await reserveDelivery(sub.feedConfigId, tweet.id))) continue;

    const { text, mediaUrl, mediaType } = formatMessage(screenName, tweet, sub.filters, sub.branded);
    await sendQueue.add(
      "send",
      {
        userId: sub.userId,
        channelJid: sub.channelJid,
        text,
        mediaUrl,
        mediaType,
        feedConfigurationId: sub.feedConfigId,
        tweetId: tweet.id,
      },
      { attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    );
    enqueued += 1;
  }

  if (enqueued > 0) log.info({ screenName, tweetId: tweet.id, enqueued }, "fanned out tweet");
  return enqueued;
}
