import { Scraper } from "@the-convocation/twitter-scraper";

const X_WEB_BASE = "https://x.com";
const DEFAULT_LIMIT = 20;
const DEFAULT_FETCH_MULTIPLIER = 2;
const DEFAULT_FETCH_FLOOR = 15;
const DEFAULT_FETCH_CEILING = 25;
const FRESH_CACHE_MS = Number(process.env.FRESH_CACHE_MS) || 15_000;
const STALE_ON_ERROR_MS = Number(process.env.STALE_ON_ERROR_MS) || 45 * 60_000;
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS) || 1_500;
const SCRAPER_TIMEOUT_MS = Number(process.env.SCRAPER_TIMEOUT_MS) || 20_000;

type NormalizedMedia = { type: "photo" | "video"; url: string | null; preview?: string | null; expandedUrl?: string | null; duration?: number | null };
type NormalizedPost = ReturnType<typeof normalizeTweet>;
type ScrapeData = {
  ok: true;
  method: string;
  query: {
    screenName: string;
    userId: null;
    limit: number;
    includeReplies: boolean;
    includeRetweets: boolean;
    includePinned: boolean;
    lang: null;
  };
  profile: NormalizedPost["user"] | null;
  count: number;
  posts: NormalizedPost[];
};

let scraperState = createScraperState();
const timelineCache = new Map<string, { data: ScrapeData; fetchedAtMs: number }>();

function createScraperState() {
  return {
    instance: new Scraper(),
    authPromise: null as Promise<boolean> | null,
  };
}

function resetScraperState() {
  scraperState = createScraperState();
}

/**
 * Optional cookie auth for hostile cloud egress IPs.
 * Set X_AUTH_TOKEN + X_CT0 in server env if guest mode gets blocked.
 */
async function ensureAuth(): Promise<boolean> {
  if (scraperState.authPromise) return scraperState.authPromise;

  const authToken = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (!authToken || !ct0) {
    scraperState.authPromise = Promise.resolve(false);
    return scraperState.authPromise;
  }

  scraperState.authPromise = (async () => {
    await scraperState.instance.setCookies([
      `auth_token=${authToken}; Domain=.x.com; Path=/; Secure; HttpOnly`,
      `ct0=${ct0}; Domain=.x.com; Path=/; Secure`,
    ]);
    return scraperState.instance.isLoggedIn();
  })();

  return scraperState.authPromise;
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

function normalizeUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url);
    parsed.protocol = "https:";
    if (parsed.hostname === "twitter.com" || parsed.hostname === "www.twitter.com") {
      parsed.hostname = "x.com";
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildTweetUrl(tweet: any, fallbackHandle: string): string | null {
  const direct = normalizeUrl(tweet.permanentUrl);
  if (direct) return direct;

  const id = tweet.id ?? null;
  const screenName = tweet.username ?? fallbackHandle ?? null;
  if (!id || !screenName) return null;

  return `${X_WEB_BASE}/${screenName}/status/${id}`;
}

function normalizeMedia(tweet: any): NormalizedMedia[] {
  const photos = Array.isArray(tweet.photos) ? tweet.photos : [];
  const videos = Array.isArray(tweet.videos) ? tweet.videos : [];

  const normalizedPhotos = photos.map((item: any) => ({
    type: "photo" as const,
    url: normalizeUrl(item.url ?? item.expanded_url ?? null),
    expandedUrl: normalizeUrl(item.expanded_url ?? null),
  }));

  const normalizedVideos = videos.map((item: any) => ({
    type: "video" as const,
    url: normalizeUrl(item.url ?? null),
    preview: normalizeUrl(item.preview ?? null),
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
    url: buildTweetUrl(quoted, quoted.username ?? "unknown"),
    media,
  };
}

function normalizeTweet(tweet: any, fallbackHandle: string) {
  const media = normalizeMedia(tweet);
  return {
    id: tweet.id ?? null,
    text: tweet.text ?? "",
    createdAt: tweet.timeParsed ? new Date(tweet.timeParsed).toISOString() : null,
    timestamp: typeof tweet.timestamp === "number" ? tweet.timestamp : null,
    url: buildTweetUrl(tweet, fallbackHandle),
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
      screenName: tweet.username ?? fallbackHandle ?? null,
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

function toSafeBigInt(value: unknown): bigint {
  try {
    return value ? BigInt(String(value)) : BigInt(0);
  } catch {
    return BigInt(0);
  }
}

function sortTweetsNewestFirst(a: NormalizedPost, b: NormalizedPost): number {
  const timeDiff = (b.timestamp ?? 0) - (a.timestamp ?? 0);
  if (timeDiff !== 0) return timeDiff;

  const idDiff = toSafeBigInt(b.id) - toSafeBigInt(a.id);
  if (idDiff > BigInt(0)) return 1;
  if (idDiff < BigInt(0)) return -1;
  return 0;
}

function buildCacheKey(options: Record<string, unknown>): string {
  return JSON.stringify(options);
}

function cloneData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

function withMeta<T extends ScrapeData>(data: T, meta: Record<string, unknown>): T & { meta: Record<string, unknown> } {
  return {
    ...cloneData(data),
    meta,
  };
}

function getCacheEntry(cacheKey: string) {
  const entry = timelineCache.get(cacheKey);
  if (!entry) return null;
  return { ...entry, ageMs: Date.now() - entry.fetchedAtMs };
}

function cacheResponse(cacheKey: string, data: ScrapeData) {
  timelineCache.set(cacheKey, {
    data: cloneData(data),
    fetchedAtMs: Date.now(),
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isRetryableError(error: unknown): boolean {
  const message = String((error as Error | undefined)?.message ?? "").toLowerCase();
  return [
    "rate limit",
    "too many requests",
    "fetch failed",
    "timed out",
    "etimedout",
    "econnreset",
    "socket hang up",
    "page does not exist",
    "forbidden",
    "unauthorized",
    "sorry, that page does not exist",
  ].some((fragment) => message.includes(fragment));
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
  includePinned?: boolean | string;
  refresh?: boolean | string;
  forceRefresh?: boolean | string;
}) {
  const handle = sanitizeHandle(options.handle ?? options.screenName);
  if (!handle) {
    throw new ScrapeError("You must provide a valid handle", {
      code: "INVALID_INPUT",
      status: 400,
    });
  }

  const limit = Math.max(1, Math.min(100, Number(options.limit) || DEFAULT_LIMIT));
  const includeReplies = toBoolean(options.includeReplies, false);
  const includeRetweets = toBoolean(options.includeRetweets, false);
  const includePinned = toBoolean(options.includePinned, false);
  const forceRefresh = toBoolean(options.forceRefresh ?? options.refresh, false);

  const normalizedOptions = {
    handle,
    limit,
    includeReplies,
    includeRetweets,
    includePinned,
  };

  const cacheKey = buildCacheKey(normalizedOptions);
  const cached = getCacheEntry(cacheKey);
  if (!forceRefresh && cached && cached.ageMs <= FRESH_CACHE_MS) {
    return withMeta(cached.data, {
      cached: true,
      stale: false,
      cacheAgeMs: cached.ageMs,
      fetchedAt: new Date(cached.fetchedAtMs).toISOString(),
    });
  }

  const fetchCount = Math.min(
    DEFAULT_FETCH_CEILING,
    Math.max(limit * DEFAULT_FETCH_MULTIPLIER, DEFAULT_FETCH_FLOOR),
  );

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (attempt > 0) {
        resetScraperState();
        await sleep(RETRY_DELAY_MS);
      }

      await ensureAuth();
      const rawTweets: any[] = await withTimeout(
        (async () => {
          const tweets: any[] = [];
          for await (const tweet of scraperState.instance.getTweets(handle, fetchCount)) {
            tweets.push(tweet);
          }
          return tweets;
        })(),
        SCRAPER_TIMEOUT_MS,
        `timeline fetch for @${handle}`,
      );

      const seen = new Set<string>();
      const posts = rawTweets
        .map((tweet) => normalizeTweet(tweet, handle))
        .filter((tweet) => {
          if (!tweet.id || seen.has(String(tweet.id))) return false;
          seen.add(String(tweet.id));
          return true;
        })
        .filter((tweet) => (includeReplies ? true : !tweet.flags.isReply))
        .filter((tweet) => (includeRetweets ? true : !tweet.flags.isRetweet))
        .filter((tweet) => (includePinned ? true : !tweet.flags.isPinned))
        .sort(sortTweetsNewestFirst)
        .slice(0, limit);

      const data: ScrapeData = {
        ok: true,
        method: "next-server:@the-convocation/twitter-scraper",
        query: {
          screenName: handle,
          userId: null,
          limit,
          includeReplies,
          includeRetweets,
          includePinned,
          lang: null,
        },
        profile: posts[0]?.user ?? null,
        count: posts.length,
        posts,
      };

      cacheResponse(cacheKey, data);

      return withMeta(data, {
        cached: false,
        stale: false,
        cacheAgeMs: 0,
        fetchedAt: new Date().toISOString(),
        recoveredAfterRetry: attempt > 0,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === 1) break;
    }
  }

  const staleCache = getCacheEntry(cacheKey);
  if (staleCache && staleCache.ageMs <= STALE_ON_ERROR_MS) {
    return withMeta(staleCache.data, {
      cached: true,
      stale: true,
      cacheAgeMs: staleCache.ageMs,
      fetchedAt: new Date(staleCache.fetchedAtMs).toISOString(),
      fallbackReason: String((lastError as Error | undefined)?.message ?? "upstream error"),
    });
  }

  throw mapLibraryError(lastError, handle);
}
