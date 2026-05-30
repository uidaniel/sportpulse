"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Spinner } from "@/components/ui-kit";

export interface Channel {
  id: string;
  channel_jid: string;
  channel_name: string;
}

interface Props {
  initialChannels: Channel[];
  maxChannels: number;
  tier: string;
}

export function ChannelsManager({ initialChannels, maxChannels, tier }: Props) {
  const [supabase] = useState(() => createClient());
  const [channels, setChannels] = useState<Channel[]>(initialChannels);
  const [invite, setInvite] = useState("");
  const [adding, setAdding] = useState(false);
  const [testingJid, setTestingJid] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const atLimit = channels.length >= maxChannels;

  const saveEdit = async (ch: Channel) => {
    const name = editName.trim();
    setEditingId(null);
    if (!name || name === ch.channel_name) return;
    setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, channel_name: name } : c)));
    const { error } = await supabase.from("whatsapp_channels").update({ channel_name: name }).eq("id", ch.id);
    if (error) {
      toast.error("Couldn't rename channel.");
      setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, channel_name: ch.channel_name } : c)));
    } else {
      toast.success("Channel renamed.");
    }
  };

  const addChannel = async () => {
    if (!invite.trim()) return;
    setAdding(true);
    try {
      // 1) resolve + verify ownership via the gateway
      const res = await fetch("/api/whatsapp/resolve-channel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't resolve that channel");
      const ch = body.channel as { id: string; name: string };

      // 2) save it
      const { data, error } = await supabase.rpc("add_whatsapp_channel", {
        p_channel_jid: ch.id,
        p_channel_name: ch.name,
      });
      if (error) throw new Error(error.message);
      if (data) {
        setChannels((prev) =>
          prev.some((c) => c.id === data.id)
            ? prev.map((c) => (c.id === data.id ? data : c))
            : [...prev, data],
        );
        setInvite("");
        toast.success(`Added ${ch.name}.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add channel");
    } finally {
      setAdding(false);
    }
  };

  const removeChannel = async (ch: Channel) => {
    const prev = channels;
    setChannels((c) => c.filter((x) => x.id !== ch.id));
    const { error } = await supabase.from("whatsapp_channels").delete().eq("id", ch.id);
    if (error) {
      toast.error("Couldn't remove channel.");
      setChannels(prev);
    } else {
      toast.success(`Removed ${ch.channel_name}.`);
    }
  };

  const testChannel = async (ch: Channel) => {
    setTestingJid(ch.channel_jid);
    try {
      const res = await fetch("/api/whatsapp/test-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelJid: ch.channel_jid, text: "✅ SportPulse test — this channel is connected." }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Test failed");
      toast.success(`Test sent to ${ch.channel_name}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTestingJid(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-line p-6">
        <div>
          <h2 className="text-lg font-semibold">Channels</h2>
          <p className="mt-1 text-sm text-muted">
            Channels you post to. Route each handle to one of these on the Feeds page.
          </p>
        </div>
        <span className="shrink-0 text-sm text-muted">
          {channels.length} / {maxChannels}
        </span>
      </div>

      <div className="space-y-5 p-6">
        {channels.length === 0 ? (
          <p className="text-sm text-muted">No channels yet. Add one below.</p>
        ) : (
          <ul className="divide-y divide-line">
            {channels.map((ch) => (
              <li key={ch.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
                    {ch.channel_name.charAt(0).toUpperCase()}
                  </span>
                  {editingId === ch.id ? (
                    <Input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => saveEdit(ch)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveEdit(ch);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-9 max-w-xs"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(ch.id);
                        setEditName(ch.channel_name);
                      }}
                      className="truncate text-left font-medium hover:text-brand"
                      title="Click to rename"
                    >
                      {ch.channel_name}
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => testChannel(ch)} disabled={testingJid === ch.channel_jid}>
                    {testingJid === ch.channel_jid ? <Spinner /> : null} Test
                  </Button>
                  <button
                    onClick={() => removeChannel(ch)}
                    className="text-sm font-medium text-danger transition-colors hover:text-danger/80"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {atLimit ? (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            {tier === "pro"
              ? `You've reached your channel limit (${maxChannels}).`
              : "Multiple channels is a Pro feature. Upgrade to route different handles to different channels."}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="https://whatsapp.com/channel/…"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addChannel();
                }}
              />
              <Button onClick={addChannel} disabled={adding}>
                {adding ? <Spinner /> : null} Add
              </Button>
            </div>
            <p className="text-xs text-faint">
              Open your Channel in WhatsApp → tap its name → <strong className="text-muted">Copy link</strong>. You must be an admin/owner.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
