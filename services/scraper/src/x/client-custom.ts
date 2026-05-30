import { config } from "../config";
import { logger } from "../logger";
import type { NormalizedTweet, QuotedTweet } from "./types";

const log = logger.child({ module: "x/client-custom" });

// ===========================================================================
// Custom no-auth adapter. Talks to the @the-convocation/twitter-scraper-based
// HTTP service in /custom_server (configured via CUSTOM_SCRAPER_URL).
//
// Request : GET {CUSTOM_SCRAPER_URL}/api/twitter/<handle>?limit=N
// Response: { ok, posts: CustomPost[] } — see custom_server/scraper.js
// ===========================================================================

const TWEETS_PER_FETCH = 20;

interface CustomMedia {
  type: "photo" | "video";
  url: string | null;
  preview?: string | null;
}

interface CustomQuoted {
  authorScreenName: string | null;
  text: string;
  media: CustomMedia[];
}

interface CustomPost {
  id: string;
  text: string;
  createdAt: string | null;
  url: string | null;
  flags: { isReply: boolean; isRetweet: boolean; isQuoted: boolean };
  hasLinks: boolean;
  media: CustomMedia[];
  quoted: CustomQuoted | null;
  user: { screenName: string | null } | null;
}

function splitMedia(media: CustomMedia[]): { photos: string[]; video: string | null } {
  const photos: string[] = [];
  let video: string | null = null;
  for (const m of media) {
    if (m.type === "photo" && m.url) photos.push(m.url);
    else if (m.type === "video" && m.url && !video) video = m.url;
  }
  return { photos, video };
}

function toQuoted(q: CustomQuoted | null): QuotedTweet | null {
  if (!q) return null;
  const { photos, video } = splitMedia(q.media);
  return {
    authorScreenName: q.authorScreenName ?? "unknown",
    text: q.text ?? "",
    mediaUrl: photos[0] ?? null,
    videoUrl: video,
  };
}

function toNormalized(post: CustomPost, screenName: string): NormalizedTweet {
  const { photos, video } = splitMedia(post.media);
  return {
    id: String(post.id),
    text: post.text ?? "",
    createdAt: post.createdAt ?? undefined,
    isRetweet: Boolean(post.flags?.isRetweet),
    isReply: Boolean(post.flags?.isReply),
    mediaUrls: photos,
    videoUrl: video,
    hasLinks: Boolean(post.hasLinks),
    url: post.url ?? `https://x.com/${post.user?.screenName ?? screenName}/status/${post.id}`,
    quoted: toQuoted(post.quoted),
  };
}

export async function fetchLatestTweets(screenName: string): Promise<NormalizedTweet[]> {
  const base = config.CUSTOM_SCRAPER_URL!.replace(/\/+$/, "");
  const url = `${base}/api/twitter/${encodeURIComponent(screenName)}?limit=${TWEETS_PER_FETCH}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`custom scraper ${res.status} for @${screenName}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as { ok: boolean; posts?: CustomPost[] };
  const posts = Array.isArray(json.posts) ? json.posts : [];
  const tweets = posts.map((p) => toNormalized(p, screenName));
  log.debug({ screenName, count: tweets.length }, "fetched timeline (custom)");
  return tweets;
}
