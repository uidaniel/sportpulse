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
        const body = (await res.json()) as { status: Status; qr: string | null; pairingCode?: string | null };
        if (!active) return;
        setQr(body.qr ?? null);
        setPairingCode(body.pairingCode ?? null);
        if (body.status !== statusRef.current) {
          statusRef.current = body.status;
          setStatus(body.status);
          if (body.status === "logged_out") {
            setQr(null);
            setPairingCode(null);
            toast.error("WhatsApp was disconnected. Please reconnect.");
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

  const handleConnect = async () => {
    if (mode === "phone" && phone.replace(/[^0-9]/g, "").length < 7) {
      toast.error("Enter your full phone number with country code (digits only).");
      return;
    }
    setBusy(true);
    setStatus("connecting");
    setQr(null);
    setPairingCode(null);
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

            {/* Phone mode: code shown once issued */}
            {mode === "phone" && pairingCode ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface-2/50 py-8">
                <p className="text-sm font-medium">Enter this code on your phone</p>
                <div className="rounded-xl bg-white px-6 py-3 font-mono text-3xl font-bold tracking-[0.3em] text-on-brand">
                  {pairingCode}
                </div>
                <p className="max-w-xs text-center text-xs text-muted">
                  WhatsApp → Linked devices → Link a device → <strong className="text-foreground">Link with phone number instead</strong> → enter the code.
                </p>
              </div>
            ) : null}

            {/* Phone input (before code) */}
            {mode === "phone" && !pairingCode ? (
              <div className="space-y-2">
                <Input
                  type="tel"
                  placeholder="Phone with country code, e.g. 2348012345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={connecting}
                />
                <p className="text-xs text-faint">Digits only, no “+”. Use the number on the WhatsApp account.</p>
              </div>
            ) : null}

            {connecting && !qr && !pairingCode ? (
              <div className="flex items-center justify-center gap-3 rounded-2xl border border-line bg-surface-2/50 py-8 text-muted">
                <Spinner className="text-brand" /> {mode === "phone" ? "Generating code…" : "Waiting for QR code…"}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button onClick={handleConnect} disabled={busy || (connecting && (Boolean(qr) || Boolean(pairingCode)))}>
                {busy || connecting ? <Spinner /> : null}
                {mode === "phone" ? "Get pairing code" : "Connect WhatsApp"}
              </Button>
            </div>
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
