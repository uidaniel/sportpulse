import express from "express";
import { scrapeProfilePosts, ScrapeError, RateLimitError } from "./scraper.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "twitter-scrape", uptime: process.uptime() });
});

app.get("/api/twitter/:handle", async (req, res) => {
  const { handle } = req.params;

  try {
    const data = await scrapeProfilePosts({
      handle,
      limit: req.query.limit,
      includeReplies: req.query.includeReplies,
      includeRetweets: req.query.includeRetweets,
      lang: req.query.lang
    });

    res.json(data);
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof ScrapeError) {
      return res.status(error.status).json({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null
        }
      });
    }

    return res.status(500).json({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error"
      }
    });
  }
});

app.get("/api/twitter", async (req, res) => {
  try {
    const data = await scrapeProfilePosts({
      screenName: req.query.handle || req.query.screenName,
      userId: req.query.userId,
      limit: req.query.limit,
      includeReplies: req.query.includeReplies,
      includeRetweets: req.query.includeRetweets,
      lang: req.query.lang
    });

    res.json(data);
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof ScrapeError) {
      return res.status(error.status).json({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null
        }
      });
    }

    return res.status(500).json({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error"
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`twitter-scrape listening on http://localhost:${PORT}`);
});
