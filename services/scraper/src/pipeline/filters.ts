import type { NormalizedTweet } from "../x/types";

export interface FeedFilters {
  include_retweets: boolean;
  include_replies: boolean;
  forward_media: boolean;
  include_videos: boolean;
  exclude_links: boolean;
  include_quotes: boolean;
}

// FR-3.2: per-feed ingestion filters. Media is handled at format time, not here.
export function passesFilters(tweet: NormalizedTweet, f: FeedFilters): boolean {
  if (tweet.isRetweet && !f.include_retweets) return false;
  if (tweet.isReply && !f.include_replies) return false;
  // A quote tweet always has tweet.quoted; gate the whole post on the toggle.
  if (tweet.quoted && !f.include_quotes) return false;
  // exclude_links: ignore the link to the quoted tweet itself when quotes are
  // allowed — otherwise every quote would be filtered out as "has a link".
  if (f.exclude_links && tweet.hasLinks && !tweet.quoted) return false;
  return true;
}
