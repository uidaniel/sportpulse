// Provider-agnostic tweet shape. Everything downstream (filters, formatting,
// fan-out) operates on this, so only x/client.ts is coupled to RapidAPI.
export interface NormalizedTweet {
  id: string;
  text: string;
  createdAt?: string;
  isRetweet: boolean;
  isReply: boolean;
  /** photo URLs (only the first is ever forwarded) */
  mediaUrls: string[];
  /** best playable video URL (mp4), if the tweet has a video/gif */
  videoUrl: string | null;
  /** true if the tweet contains an external link (excludes media t.co links) */
  hasLinks: boolean;
  url: string;
}
