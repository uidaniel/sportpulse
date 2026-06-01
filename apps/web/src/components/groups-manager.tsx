"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, Spinner } from "@/components/ui-kit";

export interface Group {
  id: string;
  group_jid: string;
  group_name: string;
  is_admin: boolean;
}

interface Props {
  initialGroups: Group[];
  maxGroupsPerChannel: number;
  tier: string;
  onGroupsChanged?: (groups: Group[]) => void;
}

/**
 * Cached list of WhatsApp groups the connected account is in. The list lives in
 * whatsapp_groups (synced on demand from the gateway) and is what the channel
 * auto-share picker draws its options from.
 */
export function GroupsManager({ initialGroups, maxGroupsPerChannel, tier, onGroupsChanged }: Props) {
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/whatsapp/groups");
      const body = (await res.json().catch(() => ({}))) as { groups?: Group[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Sync failed");
      const next = body.groups ?? [];
      setGroups(next);
      onGroupsChanged?.(next);
      toast.success(`Synced ${next.length} group${next.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const cap = maxGroupsPerChannel;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-6">
        <div>
          <h2 className="text-lg font-semibold">Groups</h2>
          <p className="mt-1 text-sm text-muted">
            WhatsApp groups your account is in. Channel posts can auto-share to
            up to <span className="font-semibold text-foreground">{cap}</span> {cap === 1 ? "group" : "groups"} per channel
            on your <span className="capitalize">{tier}</span> plan.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={sync} disabled={syncing}>
          {syncing ? <Spinner /> : null} {groups.length === 0 ? "Sync from WhatsApp" : "Refresh"}
        </Button>
      </div>

      <div className="p-6">
        {groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface-2/50 p-6 text-center">
            <p className="text-sm text-muted">No groups synced yet.</p>
            <p className="mt-1 text-xs text-faint">
              Make sure your WhatsApp is connected, then click <strong>Sync from WhatsApp</strong> above.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
                    {g.group_name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{g.group_name}</p>
                  </div>
                </div>
                {g.is_admin ? (
                  <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">
                    Admin
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
