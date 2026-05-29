import type { NormalizedTweet } from "../x/types";

export interface FeedFilters {
  include_retweets: boolean;
  include_replies: boolean;
  forward_media: boolean;
  include_videos: boolean;
  exclude_links: boolean;
}

// FR-3.2: per-feed ingestion filters. Media is handled at format time, not here.
export function passesFilters(tweet: NormalizedTweet, f: FeedFilters): boolean {
  if (tweet.isRetweet && !f.include_retweets) return false;
  if (tweet.isReply && !f.include_replies) return false;
  if (f.exclude_links && tweet.hasLinks) return false;
  return true;
}
