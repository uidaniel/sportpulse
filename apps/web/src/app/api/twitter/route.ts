import { NextResponse } from "next/server";
import { authorizeInternalOrUser } from "@/lib/api-auth";
import { scrapeProfilePosts, RateLimitError, ScrapeError } from "@/lib/x/scraper";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const allowed = await authorizeInternalOrUser(request);
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const handle = url.searchParams.get("handle") || url.searchParams.get("screenName") || "";

  try {
    const data = await scrapeProfilePosts({
      handle,
      limit: url.searchParams.get("limit") ?? undefined,
      includeReplies: url.searchParams.get("includeReplies") ?? undefined,
      includeRetweets: url.searchParams.get("includeRetweets") ?? undefined,
    });

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof ScrapeError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details ?? null,
          },
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected server error",
        },
      },
      { status: 500 },
    );
  }
}
