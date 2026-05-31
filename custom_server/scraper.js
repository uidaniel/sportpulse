import { Scraper } from "@the-convocation/twitter-scraper";

const scraper = new Scraper();

/**
 * Cloud egress IPs (Railway/Fly/etc) get hostile guest sessions from X — every
 * profile lookup returns "Sorry, that page does not exist" (error code 34).
 * Authenticated cookies bypass that. Set X_AUTH_TOKEN + X_CT0 from a logged-in
 * X session (use a burner account, not your main).
 */
let authPromise = null;
async function ensureAuth() {
  if (authPromise) return authPromise;
  const authToken = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (!authToken || !ct0) {
    authPromise = Promise.resolve(false);
    console.log("twitter-scrape: no auth cookies — running guest mode (likely to fail from cloud IPs)");
    return authPromise;
  }
  authPromise = (async () => {
    await scraper.setCookies([
      `auth_token=${authToken}; Domain=.x.com; Path=/; Secure; HttpOnly`,
      `ct0=${ct0}; Domain=.x.com; Path=/; Secure`
    ]);
    const ok = await scraper.isLoggedIn();
    console.log(`twitter-scrape: auth cookies applied, isLoggedIn=${ok}`);
    return ok;
  })();
  return authPromise;
}

class ScrapeError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ScrapeError";
    this.code = options.code ?? "SCRAPE_ERROR";
    this.status = options.status ?? 500;
    this.details = options.details ?? null;
  }
}

class RateLimitError extends ScrapeError {
  constructor(message, details = null) {
    super(message, {
      code: "RATE_LIMIT",
      status: 429,
      details
    });
    this.name = "RateLimitError";
  }
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function sanitizeHandle(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/^@/, "");
}

function normalizeMedia(tweet) {
  const photos = Array.isArray(tweet.photos) ? tweet.photos : [];
  const videos = Array.isArray(tweet.videos) ? tweet.videos : [];

  const normalizedPhotos = photos.map((item) => ({
    type: "photo",
    url: item.url ?? item.expanded_url ?? null,
    expandedUrl: item.expanded_url ?? null
  }));

  const normalizedVideos = videos.map((item) => ({
    type: "video",
    url: item.url ?? null,
    preview: item.preview ?? null,
    duration: item.duration ?? null
  }));

  return [...normalizedPhotos, ...normalizedVideos];
}

const TCO_RE = /https?:\/\/t\.co\/\S+/gi;

// A tweet's text contains one t.co token per media item AND one per external
// URL. Subtracting the media count tells us whether any non-media link survives.
function deriveHasLinks(tweet, mediaCount) {
  if (Array.isArray(tweet.urls) && tweet.urls.length > 0) return true;
  const tcoCount = (tweet.text || "").match(TCO_RE)?.length ?? 0;
  return tcoCount > mediaCount;
}

function normalizeQuoted(quoted) {
  if (!quoted) return null;
  const media = normalizeMedia(quoted);
  return {
    id: quoted.id ?? null,
    authorScreenName: quoted.username ?? null,
    text: quoted.text ?? "",
    url: quoted.permanentUrl ?? null,
    media
  };
}

function normalizeTweet(tweet) {
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
      bookmarks: tweet.bookmarkCount ?? null
    },
    flags: {
      isReply: Boolean(tweet.isReply),
      isRetweet: Boolean(tweet.isRetweet),
      isQuoted: Boolean(tweet.isQuoted),
      isSensitive: Boolean(tweet.sensitiveContent),
      isPinned: Boolean(tweet.isPin),
      isEdited: Boolean(tweet.isEdited)
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
      statusesCount: null
    }
  };
}

function mapLibraryError(error, handle) {
  const message = error?.message || "Unknown scraping error";
  const lower = message.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
    return new RateLimitError(`Rate limit hit while scraping @${handle}`, { upstreamMessage: message });
  }

  if (lower.includes("not found") || lower.includes("does not exist") || lower.includes("404")) {
    return new ScrapeError(`Profile @${handle} not found`, {
      code: "NOT_FOUND",
      status: 404,
      details: { upstreamMessage: message }
    });
  }

  if (lower.includes("forbidden") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("401")) {
    return new ScrapeError(`Upstream denied the request for @${handle}`, {
      code: "UPSTREAM_DENIED",
      status: 502,
      details: { upstreamMessage: message }
    });
  }

  return new ScrapeError(`Failed to scrape @${handle}`, {
    code: "UPSTREAM_ERROR",
    status: 502,
    details: { upstreamMessage: message }
  });
}

export async function scrapeProfilePosts(options = {}) {
  const handle = sanitizeHandle(options.handle ?? options.screenName);
  if (!handle) {
    throw new ScrapeError("You must provide a valid handle", {
      code: "INVALID_INPUT",
      status: 400
    });
  }

  if (options.userId && !handle) {
    throw new ScrapeError("This no-auth method currently supports handle-based scraping only", {
      code: "INVALID_INPUT",
      status: 400
    });
  }

  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const includeReplies = toBoolean(options.includeReplies, false);
  const includeRetweets = toBoolean(options.includeRetweets, false);

  // We over-fetch because replies/retweets may be filtered out.
  const fetchCount = Math.max(limit * 4, 40);

  try {
    await ensureAuth();
    const posts = [];

    for await (const tweet of scraper.getTweets(handle, fetchCount)) {
      if (!includeReplies && tweet.isReply) continue;
      if (!includeRetweets && tweet.isRetweet) continue;

      posts.push(normalizeTweet(tweet));
      if (posts.length >= limit) break;
    }

    return {
      ok: true,
      method: "@the-convocation/twitter-scraper (no-auth)",
      query: {
        screenName: handle,
        userId: null,
        limit,
        includeReplies,
        includeRetweets,
        lang: null
      },
      profile: posts[0]?.user ?? null,
      count: posts.length,
      posts
    };
  } catch (error) {
    throw mapLibraryError(error, handle);
  }
}

export { ScrapeError, RateLimitError };
