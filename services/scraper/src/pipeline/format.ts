import type { NormalizedTweet } from "../x/types";
import type { FeedFilters } from "./filters";

const TCO_URL = /https?:\/\/t\.co\/\S+/gi;

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

// FR-3.3: strip raw X short URLs (t.co) while preserving the structured text.
export function cleanText(text: string): string {
  return text
    .replace(TCO_URL, "")
    .replace(/&(amp|lt|gt|quot|#39|apos);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, "\n") // trailing spaces before newlines
    .replace(/\n{3,}/g, "\n\n") // collapse excess blank lines
    .trim();
}

export interface FormattedMessage {
  text: string;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
}

// Branding watermark appended for tiers that don't have remove_branding (free).
const WATERMARK = "\n\n> _› SportPulse Automated_";

export function formatMessage(
  screenName: string,
  tweet: NormalizedTweet,
  filters: FeedFilters,
  branded: boolean,
): FormattedMessage {
  const body = cleanText(tweet.text);

  // Attach at most ONE piece of media: a video (Pro feature, if enabled) takes
  // precedence; otherwise the first photo. Never a multi-photo gallery.
  let mediaUrl: string | null = null;
  let mediaType: "image" | "video" | null = null;
  if (filters.include_videos && tweet.videoUrl) {
    mediaUrl = tweet.videoUrl;
    mediaType = "video";
  } else if (filters.forward_media && tweet.mediaUrls.length > 0) {
    mediaUrl = tweet.mediaUrls[0];
    mediaType = "image";
  }

  // Just the cleaned post text + media — no handle header, no permalink.
  let text = body;
  if (branded) text += WATERMARK;

  return { text, mediaUrl, mediaType };
}
