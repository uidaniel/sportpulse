import { config } from "../config";
import { fetchLatestTweets as fetchRapidApi } from "./client";
import { fetchLatestTweets as fetchCustom } from "./client-custom";
import type { NormalizedTweet } from "./types";

// Single entry point for the rest of the service; picks the active provider
// based on X_SOURCE so callers don't care which adapter is in play.
export async function fetchLatestTweets(screenName: string): Promise<NormalizedTweet[]> {
  return config.X_SOURCE === "custom" ? fetchCustom(screenName) : fetchRapidApi(screenName);
}

export type { NormalizedTweet, QuotedTweet } from "./types";
