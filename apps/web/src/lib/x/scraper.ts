import { Scraper } from "@the-convocation/twitter-scraper";

const scraper = new Scraper();

let authPromise: Promise<boolean> | null = null;

/**
 * Optional cookie auth for hostile cloud egress IPs.
 * Set X_AUTH_TOKEN + X_CT0 in server env if guest mode gets blocked.
 */
async function ensureAuth(): Promise<boolean> {
  if (authPromise) return authPromise;

  const authToken = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (!authToken || !ct0) {
    authPromise = Promise.resolve(false);
    return authPromise;
  }

  authPromise = (async () => {
    await scraper.setCookies([
      `auth_token=${authToken}; Domain=.x.com; Path=/; Secure; HttpOnly`,
      `ct0=${ct0}; Domain=.x.com; Path=/; Secure`,
    ]);
    return scraper.isLoggedIn();
  })();

  return authPromise;
}

export class ScrapeError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(message: string, options: { code?: string; status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "ScrapeError";
    this.code = options.code ?? "SCRAPE_ERROR";
    this.status = options.status ?? 500;
    this.details = options.details ?? null;
  }
}

export class RateLimitError extends ScrapeError {
  constructor(message: string, details: unknown = null) {
    super(message, {
      code: "RATE_LIMIT",
      status: 429,
      details,
    });
    this.name = "RateLimitError";
  }
}

function toBoolean(value: unknown, defaultValue = false): boolean {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function sanitizeHandle(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/^@/, "");
}

function normalizeMedia(tweet: any): Array<{ type: "photo" | "video"; url: string | null; preview?: string | null }> {
  const photos = Array.isArray(tweet.photos) ? tweet.photos : [];
  const videos = Array.isArray(tweet.videos) ? tweet.videos : [];

  const normalizedPhotos = photos.map((item: any) => ({
    type: "photo" as const,
    url: item.url ?? item.expanded_url ?? null,
    expandedUrl: item.expanded_url ?? null,
  }));

  const normalizedVideos = videos.map((item: any) => ({
    type: "video" as const,
    url: item.url ?? null,
    preview: item.preview ?? null,
    duration: item.duration ?? null,
  }));

  return [...normalizedPhotos, ...normalizedVideos];
}

const TCO_RE = /https?:\/\/t\.co\/\S+/gi;

function deriveHasLinks(tweet: any, mediaCount: number): boolean {
  if (Array.isArray(tweet.urls) && tweet.urls.length > 0) return true;
  const tcoCount = (tweet.text || "").match(TCO_RE)?.length ?? 0;
  return tcoCount > mediaCount;
}

function normalizeQuoted(quoted: any) {
  if (!quoted) return null;
  const media = normalizeMedia(quoted);
  return {
    id: quoted.id ?? null,
    authorScreenName: quoted.username ?? null,
    text: quoted.text ?? "",
    url: quoted.permanentUrl ?? null,
    media,
  };
}

function normalizeTweet(tweet: any) {
  const media = normalizeMedia(tweet);
  return {
    id: tweet.id ?? null,
    text: tweet.text ?? "",
    createdAt: tweet.timeParsed ? new Date(tweet.timeParsed).toISOString() : null,
    timestamp: tweet.timestamp ?? null,
    url: tweet.permanentUrl ?? null,
    lang: null,
    source: null,
    stats: {
      likes: tweet.likes ?? 0,
      retweets: tweet.retweets ?? 0,
      replies: tweet.replies ?? 0,
      quotes: tweet.quotedStatusId ? 1 : 0,
      views: tweet.views ?? null,
      bookmarks: tweet.bookmarkCount ?? null,
    },
    flags: {
      isReply: Boolean(tweet.isReply),
      isRetweet: Boolean(tweet.isRetweet),
      isQuoted: Boolean(tweet.isQuoted),
      isSensitive: Boolean(tweet.sensitiveContent),
      isPinned: Boolean(tweet.isPin),
      isEdited: Boolean(tweet.isEdited),
    },
    hasLinks: deriveHasLinks(tweet, media.length),
    hashtags: Array.isArray(tweet.hashtags) ? tweet.hashtags : [],
    mentions: Array.isArray(tweet.mentions) ? tweet.mentions : [],
    media,
    quoted: normalizeQuoted(tweet.quotedStatus),
    user: {
      id: tweet.userId ?? null,
      screenName: tweet.username ?? null,
      name: tweet.name ?? null,
      verified: null,
      isBlueVerified: null,
      profileImageUrl: null,
      followersCount: null,
      followingCount: null,
      statusesCount: null,
    },
  };
}

function mapLibraryError(error: any, handle: string): ScrapeError {
  const message = error?.message || "Unknown scraping error";
  const lower = message.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
    return new RateLimitError(`Rate limit hit while scraping @${handle}`, { upstreamMessage: message });
  }

  if (lower.includes("not found") || lower.includes("does not exist") || lower.includes("404")) {
    return new ScrapeError(`Profile @${handle} not found`, {
      code: "NOT_FOUND",
      status: 404,
      details: { upstreamMessage: message },
    });
  }

  if (lower.includes("forbidden") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("401")) {
    return new ScrapeError(`Upstream denied the request for @${handle}`, {
      code: "UPSTREAM_DENIED",
      status: 502,
      details: { upstreamMessage: message },
    });
  }

  return new ScrapeError(`Failed to scrape @${handle}`, {
    code: "UPSTREAM_ERROR",
    status: 502,
    details: { upstreamMessage: message },
  });
}

export async function scrapeProfilePosts(options: {
  handle?: string;
  screenName?: string;
  limit?: number | string;
  includeReplies?: boolean | string;
  includeRetweets?: boolean | string;
}) {
  const handle = sanitizeHandle(options.handle ?? options.screenName);
  if (!handle) {
    throw new ScrapeError("You must provide a valid handle", {
      code: "INVALID_INPUT",
      status: 400,
    });
  }

  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const includeReplies = toBoolean(options.includeReplies, false);
  const includeRetweets = toBoolean(options.includeRetweets, false);

  // Over-fetch because replies/retweets may be filtered out.
  const fetchCount = Math.max(limit * 4, 40);

  try {
    await ensureAuth();
    const posts: any[] = [];

    for await (const tweet of scraper.getTweets(handle, fetchCount)) {
      if (!includeReplies && tweet.isReply) continue;
      if (!includeRetweets && tweet.isRetweet) continue;

      posts.push(normalizeTweet(tweet));
      if (posts.length >= limit) break;
    }

    return {
      ok: true,
      method: "next-server:@the-convocation/twitter-scraper",
      query: {
        screenName: handle,
        userId: null,
        limit,
        includeReplies,
        includeRetweets,
        lang: null,
      },
      profile: posts[0]?.user ?? null,
      count: posts.length,
      posts,
    };
  } catch (error) {
    throw mapLibraryError(error, handle);
  }
}
