import { jidNormalizedUser, type AnyMessageContent } from "baileys";
import { logger } from "../logger";
import { getEntry } from "./sessionManager";

const log = logger.child({ module: "channels" });

// The channel name is sometimes a plain string and sometimes the raw WhatsApp
// object { id, text, update_time } (especially for invite lookups). Normalise to
// a string, falling back through the known fields.
function channelName(meta: { name?: unknown; thread_metadata?: { name?: unknown } }): string {
  const pick = (v: unknown): string | undefined => {
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object" && "text" in v) {
      const t = (v as { text?: unknown }).text;
      if (typeof t === "string" && t.trim()) return t;
    }
    return undefined;
  };
  return pick(meta.name) ?? pick(meta.thread_metadata?.name) ?? "WhatsApp Channel";
}

export interface ChannelInfo {
  id: string; // newsletter JID, e.g. 1203630xxxxxxxxx@newsletter
  name: string;
  owned: boolean;
  subscribers?: number;
}

export class SessionNotConnectedError extends Error {
  constructor(userId: string) {
    super(`WhatsApp session for user ${userId} is not connected`);
    this.name = "SessionNotConnectedError";
  }
}

export class ChannelAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelAccessError";
  }
}

// You can only post to a channel you own or administer.
function canPostTo(role: string | undefined, owned: boolean): boolean {
  return owned || role === "OWNER" || role === "ADMIN";
}

/**
 * FR-2.3: channels the connected account can post to.
 *
 * Baileys (6.7) has no "list my newsletters" call and newsletterMetadata() does
 * not expose the viewer's ADMIN role — only an optional `owner`. So we resolve
 * metadata for the @newsletter chats seen during history sync and flag the ones
 * this account OWNS (the primary case: a creator posting to their own channel).
 * Non-owner admins can't be detected here; the dashboard also lets users paste a
 * channel JID directly (set_whatsapp_channel RPC) as a fallback.
 */
export async function listChannels(userId: string): Promise<ChannelInfo[]> {
  const entry = getEntry(userId);
  const me = entry?.sock.user;
  if (!me) throw new SessionNotConnectedError(userId);

  const selfIds = [me.id, me.lid].filter(Boolean).map((j) => jidNormalizedUser(j as string));

  const results: ChannelInfo[] = [];
  for (const jid of entry!.newsletterJids) {
    try {
      const meta = await entry!.sock.newsletterMetadata("jid", jid);
      if (!meta) continue;
      const owned = Boolean(meta.owner && selfIds.includes(jidNormalizedUser(meta.owner)));
      results.push({ id: meta.id, name: channelName(meta), owned, subscribers: meta.subscribers });
    } catch (err) {
      log.warn({ err, userId, jid }, "failed to fetch newsletter metadata");
    }
  }
  return results;
}

/**
 * Resolve a channel from its public invite link (or raw invite code) to a JID +
 * name. This is the reliable way to target a channel, since Baileys 6.7 doesn't
 * surface the account's owned/admin newsletters as listable chats.
 */
export async function resolveChannelByInvite(
  userId: string,
  invite: string,
): Promise<ChannelInfo> {
  const entry = getEntry(userId);
  if (!entry?.sock.user) throw new SessionNotConnectedError(userId);

  // Accept a full URL (https://whatsapp.com/channel/<code>) or a bare code.
  const match = invite.trim().match(/(?:channel\/)?([A-Za-z0-9_-]{8,})\/?$/);
  const code = match ? match[1] : invite.trim();

  const inviteMeta = await entry.sock.newsletterMetadata("invite", code);
  if (!inviteMeta) throw new ChannelAccessError("No channel found for that link.");

  // The invite lookup is an anonymous preview (no viewer role/owner). A second
  // lookup BY JID returns the metadata from *this account's* perspective, which
  // includes viewer_metadata.role and a matchable owner.
  let jidMeta: Awaited<ReturnType<typeof entry.sock.newsletterMetadata>> | null = null;
  try {
    jidMeta = await entry.sock.newsletterMetadata("jid", inviteMeta.id);
  } catch {
    /* fall back to invite metadata */
  }
  const meta = jidMeta ?? inviteMeta;

  const me = entry.sock.user;
  const selfIds = [me.id, me.lid].filter(Boolean).map((j) => jidNormalizedUser(j as string));
  const owner = (meta as { owner?: string }).owner;
  const owned = Boolean(owner && selfIds.includes(jidNormalizedUser(owner)));
  const role =
    (jidMeta as { viewer_metadata?: { role?: string } } | null)?.viewer_metadata?.role ??
    (inviteMeta as { viewer_metadata?: { role?: string } }).viewer_metadata?.role;

  log.info({ userId, jid: inviteMeta.id, role, owner, owned, selfIds }, "resolved channel by invite");

  if (!canPostTo(role, owned)) {
    throw new ChannelAccessError(
      "You're not an admin of that channel. Only channels you own or administer can be selected.",
    );
  }

  return {
    id: inviteMeta.id,
    name: channelName(meta),
    owned: owned || role === "OWNER",
    subscribers: (meta as { subscribers?: number }).subscribers,
  };
}

export interface SendOptions {
  text: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
}

export interface GroupInfo {
  id: string;     // group JID, e.g. 1203630xxxxxxxxx@g.us
  name: string;
  isAdmin: boolean;
}

/**
 * List WhatsApp groups the connected account is a member of, with an `isAdmin`
 * flag for each. Baileys ships `groupFetchAllParticipating()` which returns a
 * map of jid -> GroupMetadata in one shot — no per-group round-trip.
 */
export async function listGroups(userId: string): Promise<GroupInfo[]> {
  const entry = getEntry(userId);
  const me = entry?.sock.user;
  if (!me) throw new SessionNotConnectedError(userId);

  const selfIds = [me.id, me.lid].filter(Boolean).map((j) => jidNormalizedUser(j as string));
  const all = await entry!.sock.groupFetchAllParticipating();

  const out: GroupInfo[] = [];
  for (const meta of Object.values(all)) {
    if (!meta?.id?.endsWith("@g.us")) continue;
    const myEntry = meta.participants.find((p) => {
      const pid = jidNormalizedUser(p.id);
      return selfIds.includes(pid);
    });
    const isAdmin = Boolean(myEntry?.admin); // 'admin' | 'superadmin' | null
    out.push({ id: meta.id, name: meta.subject || "WhatsApp Group", isAdmin });
  }
  return out;
}

/** Send a formatted update to a WhatsApp channel. Throttling is the caller's job. */
export async function sendToChannel(
  userId: string,
  channelJid: string,
  { text, mediaUrl, mediaType }: SendOptions,
): Promise<void> {
  const entry = getEntry(userId);
  if (!entry?.sock.user) throw new SessionNotConnectedError(userId);

  let content: AnyMessageContent;
  if (mediaUrl && mediaType === "video") {
    content = { video: { url: mediaUrl }, caption: text || undefined };
  } else if (mediaUrl) {
    content = { image: { url: mediaUrl }, caption: text || undefined };
  } else {
    content = { text };
  }

  await entry.sock.sendMessage(channelJid, content);
  log.info({ userId, channelJid, mediaType: mediaType ?? "none" }, "message sent to channel");
}
