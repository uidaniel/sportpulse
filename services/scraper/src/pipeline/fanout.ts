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
  channelId: string;       // whatsapp_channels.id — used for per-channel dedup
  channelJid: string;      // newsletter JID the gateway sends to
  branded: boolean;
  window: ActiveWindow | null;
}

/**
 * Build one Subscriber per (active feed × routed channel) where the user is
 * connected. With Wave 3a, a feed can route to MANY channels (Pro), so a single
 * tweet may fan out to multiple destinations for the same user.
 */
async function getSubscribers(handleId: string): Promise<Subscriber[]> {
  const { data: configs, error } = await supabase
    .from("feed_configurations")
    .select("id, user_id, include_retweets, include_replies, forward_media, include_videos, exclude_links")
    .eq("tracked_handle_id", handleId)
    .eq("is_active", true);
  if (error) throw error;
  if (!configs || configs.length === 0) return [];

  const configIds = configs.map((c) => c.id);
  const userIds = [...new Set(configs.map((c) => c.user_id))];

  // Each feed's routed channels (Wave 3a: may be 1..N for Pro, 1 for others).
  const { data: routes } = await supabase
    .from("feed_channel_routes")
    .select("feed_configuration_id, channel_id")
    .in("feed_configuration_id", configIds);

  const channelIds = [...new Set((routes ?? []).map((r) => r.channel_id))];
  const jidByChannel = new Map<string, string>();
  if (channelIds.length) {
    const { data: channels } = await supabase
      .from("whatsapp_channels")
      .select("id, channel_jid")
      .in("id", channelIds);
    for (const ch of channels ?? []) jidByChannel.set(ch.id, ch.channel_jid);
  }

  // feedConfigId -> [{channelId, channelJid}]
  const routesByFeed = new Map<string, { channelId: string; channelJid: string }[]>();
  for (const r of routes ?? []) {
    const jid = jidByChannel.get(r.channel_id);
    if (!jid) continue;
    const arr = routesByFeed.get(r.feed_configuration_id) ?? [];
    arr.push({ channelId: r.channel_id, channelJid: jid });
    routesByFeed.set(r.feed_configuration_id, arr);
  }

  // Connected sessions (one WhatsApp account per user).
  const { data: sessions } = await supabase
    .from("whatsapp_sessions")
    .select("user_id")
    .in("user_id", userIds)
    .eq("status", "connected");
  const connectedUsers = new Set((sessions ?? []).map((s) => s.user_id));

  // Tier-derived flags.
  const { data: subs } = await supabase.from("subscriptions").select("user_id, tier").in("user_id", userIds);
  const { data: plans } = await supabase.from("plan_limits").select("tier, remove_branding, allow_scheduling");
  const removeBrandingByTier = new Map((plans ?? []).map((p) => [p.tier, p.remove_branding]));
  const allowSchedulingByTier = new Map((plans ?? []).map((p) => [p.tier, p.allow_scheduling]));
  const tierByUser = new Map((subs ?? []).map((s) => [s.user_id, s.tier]));

  // Active-hours window per user (Pro only).
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

  // Flatten: one Subscriber per (feed × channel) the user is connected for.
  const out: Subscriber[] = [];
  for (const c of configs) {
    if (!connectedUsers.has(c.user_id)) continue;
    const channels = routesByFeed.get(c.id);
    if (!channels?.length) continue;
    const tier = tierByUser.get(c.user_id);
    const branded = !(tier ? (removeBrandingByTier.get(tier) ?? false) : false);
    const window = windowByUser.get(c.user_id) ?? null;
    const filters: FeedFilters = {
      include_retweets: c.include_retweets,
      include_replies: c.include_replies,
      forward_media: c.forward_media,
      include_videos: c.include_videos,
      exclude_links: c.exclude_links,
    };
    for (const ch of channels) {
      out.push({ feedConfigId: c.id, userId: c.user_id, filters, channelId: ch.channelId, channelJid: ch.channelJid, branded, window });
    }
  }
  return out;
}

/**
 * Durable per-channel idempotency. The unique (feed_configuration_id, tweet_id,
 * channel_id) constraint makes a duplicate a no-op, so a tweet is enqueued at
 * most once per channel even across restarts.
 */
async function reserveDelivery(
  feedConfigId: string,
  tweetId: string,
  channelId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("published_messages")
    .insert({ feed_configuration_id: feedConfigId, tweet_id: tweetId, channel_id: channelId, status: "queued" });
  if (!error) return true;
  if (error.code === "23505") return false; // already reserved by a previous cycle
  log.error({ err: error, feedConfigId, tweetId, channelId }, "failed to reserve delivery");
  return false;
}

/** Format per subscriber's rules and enqueue to the gateway, per routed channel. */
export async function fanOutTweet(
  screenName: string,
  handleId: string,
  tweet: NormalizedTweet,
): Promise<number> {
  const subscribers = await getSubscribers(handleId);
  let enqueued = 0;

  for (const sub of subscribers) {
    if (!passesFilters(tweet, sub.filters)) continue;
    if (!(await reserveDelivery(sub.feedConfigId, tweet.id, sub.channelId))) continue;

    const { text, mediaUrl, mediaType } = formatMessage(screenName, tweet, sub.filters, sub.branded);
    const delay = sub.window ? sendDelayMs(sub.window) : 0;
    await sendQueue.add(
      "send",
      {
        userId: sub.userId,
        channelJid: sub.channelJid,
        channelId: sub.channelId,
        text,
        mediaUrl,
        mediaType,
        feedConfigurationId: sub.feedConfigId,
        tweetId: tweet.id,
      },
      { delay, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    );
    if (delay > 0) log.info({ userId: sub.userId, tweetId: tweet.id, channelId: sub.channelId, delayMs: delay }, "post held until window opens");
    enqueued += 1;
  }

  if (enqueued > 0) log.info({ screenName, tweetId: tweet.id, enqueued }, "fanned out tweet");
  return enqueued;
}
