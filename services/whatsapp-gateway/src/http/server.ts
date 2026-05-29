import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config";
import { logger } from "../logger";
import { connect, logout, isConnected, getSessionState } from "../wa/sessionManager";
import { listChannels, resolveChannelByInvite, SessionNotConnectedError, ChannelAccessError } from "../wa/channels";
import { getOrCreateSession } from "../db/sessions";
import { sendQueue } from "../queue/sender";
import { randomUUID } from "node:crypto";

const log = logger.child({ module: "http" });

const userIdParam = z.object({ userId: z.string().uuid() });

const testSendBody = z.object({
  channelJid: z.string().min(1),
  text: z.string().default(""),
  mediaUrl: z.string().url().nullish(),
  feedConfigurationId: z.string().uuid().optional(),
  tweetId: z.string().optional(),
});

const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function buildServer() {
  const app = express();
  app.use(express.json());

  // Public health check (no auth) for load balancers / uptime probes.
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Server-to-server bearer token. The dashboard calls these endpoints from its
  // backend, never the browser.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token !== config.GATEWAY_API_TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  });

  // Begin (or resume) a session. Returns immediately; QR + status arrive over
  // Supabase Realtime (channel `wa-session:<userId>`).
  app.post(
    "/sessions/:userId/connect",
    asyncHandler(async (req, res) => {
      const { userId } = userIdParam.parse(req.params);
      await connect(userId);
      res.json({ ok: true, userId, connected: isConnected(userId) });
    }),
  );

  app.post(
    "/sessions/:userId/logout",
    asyncHandler(async (req, res) => {
      const { userId } = userIdParam.parse(req.params);
      await logout(userId);
      res.json({ ok: true, userId });
    }),
  );

  // Poll-friendly session state (QR + status). The dashboard polls this instead
  // of relying on the Supabase Realtime WebSocket, which is blocked on some networks.
  app.get(
    "/sessions/:userId/state",
    asyncHandler(async (req, res) => {
      const { userId } = userIdParam.parse(req.params);
      const live = getSessionState(userId);
      if (live) return res.json(live);
      // No live session in this process — fall back to the durable DB status.
      const session = await getOrCreateSession(userId);
      res.json({ status: session.status, qr: null });
    }),
  );

  // FR-2.3: list channels where the connected account is OWNER/ADMIN.
  app.get(
    "/sessions/:userId/channels",
    asyncHandler(async (req, res) => {
      const { userId } = userIdParam.parse(req.params);
      const channels = await listChannels(userId);
      res.json({ channels });
    }),
  );

  // Resolve a channel from its invite link/code -> { id, name } (FR-2.3 fallback).
  app.post(
    "/sessions/:userId/resolve-channel",
    asyncHandler(async (req, res) => {
      const { userId } = userIdParam.parse(req.params);
      const { invite } = z.object({ invite: z.string().min(4) }).parse(req.body);
      const channel = await resolveChannelByInvite(userId, invite);
      res.json({ channel });
    }),
  );

  // Smoke-test helper: enqueue a send so you can verify end-to-end delivery
  // (and the throttle) without the scraper.
  app.post(
    "/sessions/:userId/test-send",
    asyncHandler(async (req, res) => {
      const { userId } = userIdParam.parse(req.params);
      const body = testSendBody.parse(req.body);
      await sendQueue.add("send", {
        userId,
        channelJid: body.channelJid,
        text: body.text,
        mediaUrl: body.mediaUrl ?? null,
        feedConfigurationId: body.feedConfigurationId ?? randomUUID(),
        tweetId: body.tweetId ?? `test-${Date.now()}`,
      });
      res.json({ ok: true, queued: true });
    }),
  );

  // Central error handler -> JSON.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid request", issues: err.issues });
    }
    if (err instanceof SessionNotConnectedError) {
      return res.status(409).json({ error: err.message });
    }
    if (err instanceof ChannelAccessError) {
      return res.status(403).json({ error: err.message });
    }
    log.error({ err }, "unhandled request error");
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
