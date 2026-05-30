import { config } from "../config";
import { logger } from "../logger";
import { redisConnection } from "../queue/connection";
import type { NormalizedTweet } from "./types";

const log = logger.child({ module: "x/client" });

// ===========================================================================
// RapidAPI adapter for "Twttr API" (twitter241) by davethebeast.
//
// Two-step flow:
//   1. /user?username=<handle>   -> numeric rest_id  (cached in Redis; stable)
//   2. /user-tweets?user=<id>    -> GraphQL-style timeline -> NormalizedTweet[]
// ===========================================================================

const TWEETS_PER_FETCH = 20;
const UID_CACHE_PREFIX = "x:uid:";

const headers = () => ({
  "x-rapidapi-key": config.RAPIDAPI_KEY,
  "x-rapidapi-host": config.RAPIDAPI_HOST,
});

function apiUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, config.RAPIDAPI_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Resolve a screen name to its numeric user id (rest_id), cached in Redis. */
async function resolveUserId(screenName: string): Promise<string | null> {
  const cacheKey = UID_CACHE_PREFIX + screenName.toLowerCase();
  const cached = await redisConnection.get(cacheKey);
  if (cached) return cached;

  const res = await fetch(apiUrl("/user", { username: screenName }), { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RapidAPI /user ${res.status} for @${screenName}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const id = deepGet(json, ["result", "data", "user", "result", "rest_id"]);
  if (typeof id === "string" && id) {
    await redisConnection.set(cacheKey, id);
    return id;
  }
  log.warn({ screenName }, "could not resolve user id");
  return null;
}

export async function fetchLatestTweets(screenName: string): Promise<NormalizedTweet[]> {
  const userId = await resolveUserId(screenName);
  if (!userId) return [];

  const res = await fetch(
    apiUrl("/user-tweets", { user: userId, count: String(TWEETS_PER_FETCH) }),
    { headers: headers() },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RapidAPI /user-tweets ${res.status} for @${screenName}: ${body.slice(0, 160)}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const tweets = parseTimeline(json, screenName);
  log.debug({ screenName, count: tweets.length }, "parsed timeline");
  return tweets;
}

// ---- timeline parsing (twitter241 GraphQL shape) --------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
function parseTimeline(json: any, screenName: string): NormalizedTweet[] {
  const instructions: any[] = json?.result?.timeline?.instructions ?? [];
  const out: NormalizedTweet[] = [];

  for (const ins of instructions) {
    // Only the "add entries" instruction carries the timeline; skip pinned +
    // clear-cache so we don't treat an old pinned tweet as new.
    const entries: any[] = Array.isArray(ins?.entries) ? ins.entries : [];
    for (const entry of entries) collectEntry(entry, screenName, out);
  }
  return out;
}

function collectEntry(entry: any, screenName: string, out: NormalizedTweet[]): void {
  const entryId: string = entry?.entryId ?? "";
  if (entryId.startsWith("cursor-")) return;

  const content = entry?.content;
  const typename = content?.__typename;

  if (typename === "TimelineTimelineItem") {
    pushTweet(content?.itemContent?.tweet_results?.result, screenName, out);
  } else if (typename === "TimelineTimelineModule") {
    for (const it of content?.items ?? []) {
      pushTweet(it?.item?.itemContent?.tweet_results?.result, screenName, out);
    }
  }
}

function pushTweet(result: any, screenName: string, out: NormalizedTweet[]): void {
  if (!result) return;
  // Some tweets are wrapped for visibility/age gating.
  const tweet = result.__typename === "TweetWithVisibilityResults" ? result.tweet : result;
  const legacy = tweet?.legacy;
  if (!legacy) return;

  const id: string | undefined = tweet?.rest_id ?? legacy?.id_str;
  if (!id) return;

  const author: string | undefined =
    tweet?.core?.user_results?.result?.core?.screen_name ??
    tweet?.core?.user_results?.result?.legacy?.screen_name;

  // Only keep tweets authored by the tracked handle (a profile timeline can
  // surface replied-to / quoted tweets from other accounts inside modules).
  if (author && author.toLowerCase() !== screenName.toLowerCase()) return;

  // note_tweet holds the full text for long tweets; legacy.full_text is truncated.
  const text: string = tweet?.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || "";

  const isRetweet = Boolean(legacy.retweeted_status_result) || /^RT @\w+/.test(text);
  const isReply = Boolean(legacy.in_reply_to_status_id_str || legacy.in_reply_to_screen_name);
  const media = extractMedia(legacy);

  // External links live in entities.urls (media t.co links are in entities.media,
  // so a plain photo/video tweet is NOT treated as "has links").
  const urlEntities =
    legacy?.entities?.urls ?? tweet?.note_tweet?.note_tweet_results?.result?.entity_set?.urls ?? [];
  const hasLinks = Array.isArray(urlEntities) && urlEntities.length > 0;

  // Quote tweets put the referenced tweet on either the wrapper or the legacy
  // payload depending on the GraphQL slice; check both.
  const quotedRaw = tweet?.quoted_status_result?.result ?? legacy?.quoted_status_result?.result ?? null;
  const quoted = extractQuoted(quotedRaw);

  out.push({
    id: String(id),
    text,
    createdAt: legacy.created_at,
    isRetweet,
    isReply,
    mediaUrls: media.images,
    videoUrl: media.video,
    hasLinks,
    url: `https://x.com/${author ?? screenName}/status/${id}`,
    quoted,
  });
}

function extractQuoted(result: any): import("./types").QuotedTweet | null {
  if (!result) return null;
  const inner = result.__typename === "TweetWithVisibilityResults" ? result.tweet : result;
  const legacy = inner?.legacy;
  if (!legacy) return null;
  const author: string | undefined =
    inner?.core?.user_results?.result?.core?.screen_name ??
    inner?.core?.user_results?.result?.legacy?.screen_name;
  const text: string =
    inner?.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || "";
  const media = extractMedia(legacy);
  return {
    authorScreenName: author ?? "unknown",
    text,
    mediaUrl: media.images[0] ?? null,
    videoUrl: media.video,
  };
}

function extractMedia(legacy: any): { images: string[]; video: string | null } {
  const media: any[] = legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [];
  const images: string[] = [];
  let video: string | null = null;

  for (const m of media) {
    if (m?.type === "video" || m?.type === "animated_gif") {
      video = video ?? bestVideoVariant(m?.video_info?.variants);
    } else if (m?.type === "photo" && m?.media_url_https) {
      images.push(m.media_url_https);
    }
  }
  return { images, video };
}

function bestVideoVariant(variants: any[]): string | null {
  if (!Array.isArray(variants)) return null;
  const mp4 = variants.filter((v) => v?.content_type === "video/mp4" && v?.url);
  mp4.sort((a, b) => (b?.bitrate ?? 0) - (a?.bitrate ?? 0));
  return mp4[0]?.url ?? variants.find((v) => v?.url)?.url ?? null;
}

function deepGet(obj: any, path: string[]): unknown {
  return path.reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
