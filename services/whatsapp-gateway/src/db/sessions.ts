import { supabase } from "../supabase";
import { logger } from "../logger";
import type { Database } from "../types/database.types";

export type WhatsAppStatus = Database["public"]["Enums"]["whatsapp_status"];
export type WhatsAppSession = Database["public"]["Tables"]["whatsapp_sessions"]["Row"];

const log = logger.child({ module: "db/sessions" });

/** Resolve the (signup-provisioned) session row for a user; create defensively. */
export async function getOrCreateSession(userId: string): Promise<WhatsAppSession> {
  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: insertErr } = await supabase
    .from("whatsapp_sessions")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (insertErr) throw insertErr;
  return created;
}

type StatusPatch = {
  phone_jid?: string | null;
  whatsapp_channel_id?: string | null;
  last_connect?: boolean;
  last_disconnect?: boolean;
  last_disconnect_reason?: string | null;
};

export async function updateStatus(
  sessionId: string,
  status: WhatsAppStatus,
  patch: StatusPatch = {},
): Promise<void> {
  const now = new Date().toISOString();
  const update: Database["public"]["Tables"]["whatsapp_sessions"]["Update"] = { status };

  if (patch.phone_jid !== undefined) update.phone_jid = patch.phone_jid;
  if (patch.whatsapp_channel_id !== undefined) update.whatsapp_channel_id = patch.whatsapp_channel_id;
  if (patch.last_connect) update.last_connected_at = now;
  if (patch.last_disconnect) update.last_disconnected_at = now;
  if (patch.last_disconnect_reason !== undefined) update.last_disconnect_reason = patch.last_disconnect_reason;

  const { error } = await supabase.from("whatsapp_sessions").update(update).eq("id", sessionId);
  if (error) log.error({ err: error, sessionId, status }, "failed to update session status");
}
