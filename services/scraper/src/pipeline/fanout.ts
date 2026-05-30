import { supabase } from "../supabase";
import { logger } from "../logger";
import { sendQueue } from "../queue/connection";
import { passesFilters, type FeedFilters } from "./filters";
import { formatMessage } from "./format";
import { sendDelayMs, type ActiveWindow } from "./schedule";
import type { NormalizedTweet } from "../x/types";

const log = logger.child({ module: "fanout" });

interface Subscriber {
  feedConfigId: string;
  userId: string;
  filters: FeedFilters;
  channelJid: string;
  branded: boolean; // append the watermark? (true unless the tier removes branding)
  window: ActiveWindow | null; // Pro active-hours window; null = deliver immediately
}

// Active subscribers of a handle whose WhatsApp session is connected and has a
// target channel selected. (whatsapp_sessions has no FK to feed_configurations,
// so we resolve channels in a second query rather than an embedded join.)
async function getSubscribers(handleId: string): Promise<Subscriber[]> {
  const { data: configs, error } = await supabase
    .from("feed_configurations")
    .select("id, user_id, channel_id, include_retweets, include_replies, forward_media, include_videos, exclude_links")
    .eq("tracked_handle_id", handleId)
    .eq("is_active", true);
  if (error) throw error;
  if (!configs || configs.length === 0) return [];

  const userIds = [...new Set(configs.map((c) => c.user_id))];

  // The user's WhatsApp account must be connected (one session per user)...
  const { data: sessions, error: sErr } = await supabase
    .from("whatsapp_sessions")
    .select("user_id")
    .in("user_id", userIds)
    .eq("status", "connected");
  if (sErr) throw sErr;
  const connectedUsers = new Set((sessions ?? []).map((s) => s.user_id));

  // ...and each feed routes to a specific channel (Wave 3).
  const channelIds = [...new Set(configs.map((c) => c.channel_id).filter((id): id is string => Boolean(id)))];
  const jidByChannel = new Map<string, string>();
  if (channelIds.length) {
    const { data: channels } = await supabase
      .from("whatsapp_channels")
      .select("id, channel_jid")
      .in("id", channelIds);
    for (const ch of channels ?? []) jidByChannel.set(ch.id, ch.channel_jid);
  }

  // Resolve each user's tier -> branding + scheduling permission.
  const { data: subs } = await supabase.from("subscriptions").select("user_id, tier").in("user_id", userIds);
  const { data: plans } = await supabase.from("plan_limits").select("tier, remove_branding, allow_scheduling");
  const removeBrandingByTier = new Map((plans ?? []).map((p) => [p.tier, p.remove_branding]));
  const allowSchedulingByTier = new Map((plans ?? []).map((p) => [p.tier, p.allow_scheduling]));
  const tierByUser = new Map((subs ?? []).map((s) => [s.user_id, s.tier]));

  // Active-hours windows (Pro), keyed by user.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, timezone, schedule_enabled, schedule_start, schedule_end")
    .in("id", userIds);
  const windowByUser = new Map<string, ActiveWindow | null>();
  for (const p of profiles ?? []) {
    const tier = tierByUser.get(p.id);
    const applies = Boolean(p.schedule_enabled) && Boolean(tier && allowSchedulingByTier.get(tier));
    windowByUser.set(
      p.id,
      applies ? { timezone: p.timezone, start: p.schedule_start, end: p.schedule_end } : null,
    );
  }

  return configs
    .filter((c) => connectedUsers.has(c.user_id) && c.channel_id && jidByChannel.has(c.channel_id))
    .map((c) => {
      const tier = tierByUser.get(c.user_id);
      return {
        feedConfigId: c.id,
        userId: c.user_id,
        filters: {
          include_retweets: c.include_retweets,
          include_replies: c.include_replies,
          forward_media: c.forward_media,
          include_videos: c.include_videos,
          exclude_links: c.exclude_links,
        },
        channelJid: jidByChannel.get(c.channel_id!)!,
        branded: !(tier ? (removeBrandingByTier.get(tier) ?? false) : false),
        window: windowByUser.get(c.user_id) ?? null,
      };
    });
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
    // Active-hours: hold off-window posts as delayed jobs (released when it reopens).
    const delay = sub.window ? sendDelayMs(sub.window) : 0;
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
      { delay, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    );
    if (delay > 0) log.info({ userId: sub.userId, tweetId: tweet.id, delayMs: delay }, "post held until window opens");
    enqueued += 1;
  }

  if (enqueued > 0) log.info({ screenName, tweetId: tweet.id, enqueued }, "fanned out tweet");
  return enqueued;
}
