"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { Button, Card, Badge, Input, Spinner } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

type Status = "disconnected" | "connecting" | "connected" | "logged_out";
type Mode = "qr" | "phone";

const STATUS_META: Record<Status, { label: string; dot: string; badge: string }> = {
  connected: { label: "Connected", dot: "bg-brand", badge: "bg-brand-soft text-brand border border-brand/30" },
  connecting: { label: "Connecting", dot: "bg-warning", badge: "bg-warning/10 text-warning border border-warning/30" },
  disconnected: { label: "Disconnected", dot: "bg-faint", badge: "bg-surface-2 text-muted border border-line" },
  logged_out: { label: "Logged out", dot: "bg-danger", badge: "bg-danger/10 text-danger border border-danger/30" },
};

export function WhatsAppConnect({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());
  const [mode, setMode] = useState<Mode>("qr");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<Status>(initialStatus);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/whatsapp/state");
        if (!res.ok) return;
        const body = (await res.json()) as {
          status: Status;
          qr: string | null;
          pairingCode?: string | null;
          pairingCodeExpiresAt?: number;
        };
        if (!active) return;
        setQr(body.qr ?? null);
        setPairingCode(body.pairingCode ?? null);
        setPairingExpiresAt(body.pairingCodeExpiresAt ?? 0);
        if (body.status !== statusRef.current) {
          const prev = statusRef.current;
          statusRef.current = body.status;
          setStatus(body.status);
          if (body.status === "logged_out") {
            setQr(null);
            setPairingCode(null);
            setPairingExpiresAt(0);
            // Don't double-toast on first paint (page loaded already-logged-out).
            if (prev !== "logged_out") toast.error("WhatsApp was disconnected on your phone. Please pair again.");
          }
        }
      } catch {
        /* transient — retry next tick */
      }
    };
    void poll();
    const interval = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Tick once a second so the countdown renders smoothly.
  useEffect(() => {
    if (!pairingCode || !pairingExpiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairingCode, pairingExpiresAt]);

  const handleConnect = async () => {
    if (mode === "phone" && phone.replace(/[^0-9]/g, "").length < 7) {
      toast.error("Enter your full phone number with country code (digits only).");
      return;
    }
    setBusy(true);
    setStatus("connecting");
    setQr(null);
    setPairingCode(null);
    setPairingExpiresAt(0);
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "phone" ? { phoneNumber: phone } : {}),
      });
      if (!res.ok) throw new Error();
      toast.message(mode === "phone" ? "Generating your pairing code…" : "Starting session — scan the QR code.");
    } catch {
      toast.error("Couldn't reach the gateway. Is it running?");
      setStatus("disconnected");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await fetch("/api/whatsapp/logout", { method: "POST" });
      setStatus("logged_out");
      toast.success("Logged out of WhatsApp.");
    } catch {
      toast.error("Logout failed.");
    } finally {
      setBusy(false);
    }
  };

  const meta = STATUS_META[status];
  const isConnected = status === "connected";
  const connecting = status === "connecting";
  const isLoggedOut = status === "logged_out";

  // Pairing-code countdown: clear locally once expired so we don't show a stale
  // code, and prompt for a fresh one. The gateway also clears it server-side.
  const pairingMsLeft = pairingCode && pairingExpiresAt ? Math.max(0, pairingExpiresAt - now) : 0;
  const pairingExpired = pairingCode != null && pairingMsLeft === 0;
  const displayPairing = pairingCode && !pairingExpired ? pairingCode : null;
  const pairingMmSs = (() => {
    if (!displayPairing) return null;
    const s = Math.ceil(pairingMsLeft / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  })();

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-line p-6">
        <div>
          <h2 className="text-lg font-semibold">WhatsApp connection</h2>
          <p className="mt-1 text-sm text-muted">Link the WhatsApp account that admins your channels.</p>
        </div>
        <Badge className={meta.badge}>
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </Badge>
      </div>

      <div className="space-y-6 p-6">
        {isLoggedOut ? (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <p className="font-semibold">Your WhatsApp was disconnected.</p>
            <p className="mt-0.5 text-danger/80">
              The linked device was removed from your phone. Pair again to resume posting.
            </p>
          </div>
        ) : null}

        {!isConnected ? (
          <>
            {/* mode switch */}
            <div className="inline-flex rounded-xl border border-line bg-surface-2 p-1 text-sm">
              {(["qr", "phone"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 font-medium transition-colors",
                    mode === m ? "bg-brand text-on-brand" : "text-muted hover:text-foreground",
                  )}
                >
                  {m === "qr" ? "Scan QR" : "Phone number"}
                </button>
              ))}
            </div>

            {/* QR mode */}
            {mode === "qr" && qr ? (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface-2/50 py-8">
                <div className="rounded-2xl bg-white p-4 shadow-lg">
                  <QRCode value={qr} size={208} />
                </div>
                <p className="text-center text-xs text-muted">WhatsApp → Linked devices → Link a device</p>
              </div>
            ) : null}

            {/* Phone mode: live pairing code with countdown */}
            {mode === "phone" && displayPairing ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface-2/50 py-8">
                <p className="text-sm font-medium">Enter this code on your phone</p>
                <div className="rounded-xl bg-white px-6 py-3 font-mono text-3xl font-bold tracking-[0.3em] text-on-brand">
                  {displayPairing}
                </div>
                <p className="text-xs text-muted">
                  Expires in <span className="font-mono font-semibold text-foreground">{pairingMmSs}</span>
                </p>
                <p className="max-w-xs text-center text-xs text-muted">
                  WhatsApp → Linked devices → Link a device → <strong className="text-foreground">Link with phone number instead</strong> → enter the code.
                </p>
              </div>
            ) : null}

            {/* Phone mode: code expired — prompt to regenerate */}
            {mode === "phone" && pairingExpired ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 py-8 text-center">
                <p className="text-sm font-medium text-warning">Your pairing code expired.</p>
                <p className="max-w-xs text-xs text-warning/80">Get a new one to continue linking your device.</p>
                <Button onClick={handleConnect} disabled={busy}>
                  {busy ? <Spinner /> : null} Get new code
                </Button>
              </div>
            ) : null}

            {/* Phone input (before code) */}
            {mode === "phone" && !pairingCode && !pairingExpired ? (
              <div className="space-y-2">
                <Input
                  type="tel"
                  placeholder="Phone with country code, e.g. 2348012345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={connecting}
                />
                <p className="text-xs text-faint">Digits only, no &ldquo;+&rdquo;. Use the number on the WhatsApp account.</p>
              </div>
            ) : null}

            {connecting && !qr && !displayPairing && !pairingExpired ? (
              <div className="flex items-center justify-center gap-3 rounded-2xl border border-line bg-surface-2/50 py-8 text-muted">
                <Spinner className="text-brand" /> {mode === "phone" ? "Generating code…" : "Waiting for QR code…"}
              </div>
            ) : null}

            {!pairingExpired ? (
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleConnect} disabled={busy || (connecting && (Boolean(qr) || Boolean(displayPairing)))}>
                  {busy || connecting ? <Spinner /> : null}
                  {mode === "phone" ? (isLoggedOut ? "Pair again" : "Get pairing code") : isLoggedOut ? "Pair again" : "Connect WhatsApp"}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Your WhatsApp account is linked and ready.</p>
            <Button variant="danger" onClick={handleLogout} disabled={busy}>
              {busy ? <Spinner /> : null} Disconnect
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
