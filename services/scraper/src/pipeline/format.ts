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

  let text = body;

  // Quote tweet: render the quoted post as a WhatsApp blockquote underneath
  // the main text, and if the host tweet had no media of its own, fall back to
  // the quoted tweet's media so readers see the visual context (e.g. the
  // infographic that the original poster was reacting to).
  if (tweet.quoted) {
    const qText = cleanText(tweet.quoted.text);
    if (qText) {
      const quoteLines = qText
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      const sep = text ? "\n\n" : "";
      text += `${sep}> *@${tweet.quoted.authorScreenName}:*\n${quoteLines}`;
    }
    if (!mediaUrl) {
      if (filters.include_videos && tweet.quoted.videoUrl) {
        mediaUrl = tweet.quoted.videoUrl;
        mediaType = "video";
      } else if (filters.forward_media && tweet.quoted.mediaUrl) {
        mediaUrl = tweet.quoted.mediaUrl;
        mediaType = "image";
      }
    }
  }

  if (branded) text += WATERMARK;

  return { text, mediaUrl, mediaType };
}
