import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { logger } from "./logger";
import type { WhatsAppStatus } from "./db/sessions";

// Streams ephemeral session events (rotating QR codes, status changes) to the
// dashboard over Supabase Realtime broadcast. The durable status also lives in
// whatsapp_sessions; this channel is just for low-latency UI updates.
//
// Dashboard subscribes to channel `wa-session:<userId>` and listens for the
// 'qr' and 'status' broadcast events.

const log = logger.child({ module: "realtime" });
const channels = new Map<string, RealtimeChannel>();

function channelName(userId: string) {
  return `wa-session:${userId}`;
}

async function getChannel(userId: string): Promise<RealtimeChannel> {
  const existing = channels.get(userId);
  if (existing) return existing;

  const channel = supabase.channel(channelName(userId), { config: { broadcast: { ack: false } } });
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        log.warn({ userId, status }, "realtime channel subscribe issue");
        resolve(); // don't block session flow on realtime hiccups
      }
    });
  });
  channels.set(userId, channel);
  return channel;
}

async function send(userId: string, event: string, payload: Record<string, unknown>) {
  try {
    const channel = await getChannel(userId);
    await channel.send({ type: "broadcast", event, payload });
  } catch (err) {
    log.warn({ err, userId, event }, "realtime broadcast failed (non-fatal)");
  }
}

export const realtime = {
  publishQr: (userId: string, qr: string) => send(userId, "qr", { qr, at: Date.now() }),

  publishStatus: (userId: string, status: WhatsAppStatus, detail?: Record<string, unknown>) =>
    send(userId, "status", { status, ...detail, at: Date.now() }),

  close: async (userId: string) => {
    const channel = channels.get(userId);
    if (!channel) return;
    channels.delete(userId);
    await supabase.removeChannel(channel);
  },
};
