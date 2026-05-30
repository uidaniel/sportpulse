import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type ConnectionState,
} from "baileys";
import { Boom } from "@hapi/boom";
import qrcodeTerminal from "qrcode-terminal";
import { config } from "../config";
import { logger } from "../logger";
import { useSupabaseAuthState, type SupabaseAuthState } from "../db/authState";
import { getOrCreateSession, updateStatus, type WhatsAppStatus } from "../db/sessions";
import { realtime } from "../realtime";

const log = logger.child({ module: "sessionManager" });

interface SessionEntry {
  userId: string;
  sessionId: string;
  sock: WASocket;
  auth: SupabaseAuthState;
  /** newsletter (channel) JIDs seen during history sync — basis for listChannels */
  newsletterJids: Set<string>;
  intentionalClose: boolean;
  reconnectAttempts: number;
  reconnectTimer?: NodeJS.Timeout;
  /** in-memory state for HTTP polling (Realtime is unreliable on some networks) */
  status: WhatsAppStatus;
  lastQr: string | null;
  /** phone-number pairing: when set, link via code instead of QR */
  usePairing: boolean;
  pairingCode: string | null;
}

/** Current state for HTTP polling; null if no live session in this process. */
export function getSessionState(
  userId: string,
): { status: WhatsAppStatus; qr: string | null; pairingCode: string | null } | null {
  const entry = sessions.get(userId);
  if (!entry) return null;
  return { status: entry.status, qr: entry.lastQr, pairingCode: entry.pairingCode };
}

const sessions = new Map<string, SessionEntry>();

const MAX_RECONNECT_ATTEMPTS = 5;

// Baileys wants a pino-like ILogger; our pino instance satisfies it structurally.
const waLogger = logger.child({ module: "baileys" }) as never;

export function getEntry(userId: string): SessionEntry | undefined {
  return sessions.get(userId);
}

export function isConnected(userId: string): boolean {
  return Boolean(sessions.get(userId)?.sock.user);
}

/**
 * Start (or restart) a WhatsApp socket for a user. Idempotent: calling it while
 * a live socket exists is a no-op so the dashboard can safely retry.
 */
export async function connect(userId: string, phoneNumber?: string): Promise<void> {
  if (sessions.get(userId)?.sock.user) {
    log.info({ userId }, "connect requested but session already open");
    return;
  }

  const session = await getOrCreateSession(userId);
  const auth = await useSupabaseAuthState(session.id);
  const { version } = await fetchLatestBaileysVersion();
  const usePairing = Boolean(phoneNumber) && !auth.state.creds.registered;

  const sock = makeWASocket({
    version,
    logger: waLogger,
    auth: {
      creds: auth.state.creds,
      keys: makeCacheableSignalKeyStore(auth.state.keys, waLogger),
    },
    browser: ["SportPulse", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  const entry: SessionEntry = {
    userId,
    sessionId: session.id,
    sock,
    auth,
    newsletterJids: new Set(),
    intentionalClose: false,
    reconnectAttempts: sessions.get(userId)?.reconnectAttempts ?? 0,
    status: "connecting",
    lastQr: null,
    usePairing,
    pairingCode: null,
  };
  sessions.set(userId, entry);

  sock.ev.on("creds.update", auth.saveCreds);

  // Phone-number linking: request an 8-char pairing code instead of a QR.
  // A brief delay lets the socket reach WhatsApp before requesting.
  if (usePairing && phoneNumber) {
    const number = phoneNumber.replace(/[^0-9]/g, "");
    setTimeout(() => {
      sock
        .requestPairingCode(number)
        .then((code) => {
          entry.pairingCode = code;
          entry.status = "connecting";
          log.info({ userId }, "pairing code issued");
        })
        .catch((err) => log.error({ err, userId }, "requestPairingCode failed"));
    }, 3000);
  }

  // Channels the account follows/owns surface as @newsletter chats during sync.
  sock.ev.on("messaging-history.set", ({ chats }) => {
    for (const chat of chats) {
      if (chat.id?.endsWith("@newsletter")) entry.newsletterJids.add(chat.id);
    }
  });

  sock.ev.on("connection.update", (update) => {
    handleConnectionUpdate(entry, update).catch((err) =>
      log.error({ err, userId }, "connection.update handler error"),
    );
  });
}

async function handleConnectionUpdate(entry: SessionEntry, update: Partial<ConnectionState>): Promise<void> {
  const { connection, lastDisconnect, qr } = update;
  const { userId, sessionId } = entry;

  // In pairing-code mode we link via the code, so ignore QR events.
  if (qr && !entry.usePairing) {
    log.info({ userId }, "new QR issued");
    entry.status = "connecting";
    entry.lastQr = qr;
    await updateStatus(sessionId, "connecting");
    void realtime.publishStatus(userId, "connecting");
    void realtime.publishQr(userId, qr);
    if (config.WA_PRINT_QR_TERMINAL) qrcodeTerminal.generate(qr, { small: true });
  }

  if (connection === "connecting") {
    entry.status = "connecting";
    await updateStatus(sessionId, "connecting");
    void realtime.publishStatus(userId, "connecting");
  }

  if (connection === "open") {
    entry.reconnectAttempts = 0;
    entry.status = "connected";
    entry.lastQr = null;
    entry.pairingCode = null;
    const phoneJid = entry.sock.user?.id ?? null;
    log.info({ userId, phoneJid }, "connection open");
    await updateStatus(sessionId, "connected", { phone_jid: phoneJid, last_connect: true });
    void realtime.publishStatus(userId, "connected", { phoneJid });
  }

  if (connection === "close") {
    await handleClose(entry, lastDisconnect?.error);
  }
}

async function handleClose(entry: SessionEntry, error?: Error): Promise<void> {
  const { userId, sessionId } = entry;
  const statusCode = (error as Boom | undefined)?.output?.statusCode;
  const reason = DisconnectReason[statusCode as number] ?? error?.message ?? "unknown";

  // §7 "Device offline": user unlinked the device, or session was revoked/forbidden.
  // Capture it, persist disconnected/logged_out, and flag that re-auth is needed.
  const needsReauth =
    statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.forbidden;

  if (needsReauth) {
    log.warn({ userId, reason, statusCode }, "session needs re-authentication (device offline/logged out)");
    await entry.auth.clear();
    await updateStatus(sessionId, "logged_out", { last_disconnect: true, last_disconnect_reason: reason });
    void realtime.publishStatus(userId, "logged_out", { reason });
    notifyReauthRequired(userId, reason);
    cleanup(userId);
    return;
  }

  await updateStatus(sessionId, "disconnected", { last_disconnect: true, last_disconnect_reason: reason });
  void realtime.publishStatus(userId, "disconnected", { reason });

  if (entry.intentionalClose) {
    cleanup(userId);
    return;
  }

  // Transient drop (connectionLost, restartRequired, timedOut, ...) -> reconnect.
  if (entry.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    log.error({ userId, reason }, "max reconnect attempts reached; giving up");
    cleanup(userId);
    return;
  }

  entry.reconnectAttempts += 1;
  const delay = Math.min(30_000, 2_000 * 2 ** (entry.reconnectAttempts - 1));
  log.info({ userId, reason, attempt: entry.reconnectAttempts, delay }, "scheduling reconnect");
  entry.reconnectTimer = setTimeout(() => {
    sessions.delete(userId);
    connect(userId).catch((err) => log.error({ err, userId }, "reconnect failed"));
  }, delay);
}

/** Explicit logout: tears down the socket and wipes stored credentials. */
export async function logout(userId: string): Promise<void> {
  const entry = sessions.get(userId);
  if (entry) {
    entry.intentionalClose = true;
    try {
      await entry.sock.logout();
    } catch (err) {
      log.warn({ err, userId }, "logout() threw (continuing teardown)");
    }
    await entry.auth.clear();
    await updateStatus(entry.sessionId, "logged_out");
    void realtime.publishStatus(userId, "logged_out");
    cleanup(userId);
  } else {
    const session = await getOrCreateSession(userId);
    const auth = await useSupabaseAuthState(session.id);
    await auth.clear();
    await updateStatus(session.id, "logged_out");
  }
}

function cleanup(userId: string): void {
  const entry = sessions.get(userId);
  if (entry?.reconnectTimer) clearTimeout(entry.reconnectTimer);
  try {
    entry?.sock.ev.removeAllListeners("connection.update");
    entry?.sock.end(undefined);
  } catch {
    /* socket may already be dead */
  }
  sessions.delete(userId);
  void realtime.close(userId);
}

// Integration seam for the §7 transactional re-auth alert (email/push).
// Wire to a real provider later; for now it is observable in logs + Realtime + DB.
function notifyReauthRequired(userId: string, reason: string): void {
  log.warn({ userId, reason }, "TODO: send transactional re-auth alert to user");
}
