import { createClient } from "@/lib/supabase/server";
import { WhatsAppConnect } from "@/components/whatsapp-connect";
import { ChannelsManager } from "@/components/channels-manager";
import { GroupsManager, type Group } from "@/components/groups-manager";

type Status = "disconnected" | "connecting" | "connected" | "logged_out";

export default async function WhatsAppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: session } = await supabase
    .from("whatsapp_sessions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: channels } = await supabase
    .from("whatsapp_channels")
    .select("id, channel_jid, channel_name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const { data: groups } = await supabase
    .from("whatsapp_groups")
    .select("id, group_jid, group_name, is_admin")
    .eq("user_id", userId)
    .order("group_name", { ascending: true });

  // Channel -> [group_id, ...] routes, used to render the per-channel chips.
  const channelIds = (channels ?? []).map((c) => c.id);
  const routesByChannel: Record<string, string[]> = {};
  if (channelIds.length) {
    const { data: routes } = await supabase
      .from("channel_group_routes")
      .select("channel_id, group_id")
      .in("channel_id", channelIds);
    for (const r of routes ?? []) {
      (routesByChannel[r.channel_id] ??= []).push(r.group_id);
    }
  }

  const { data: sub } = await supabase.from("subscriptions").select("tier").eq("user_id", userId).maybeSingle();
  const tier = sub?.tier ?? "free";
  const { data: limit } = await supabase
    .from("plan_limits")
    .select("max_channels, max_groups_per_channel")
    .eq("tier", tier)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted">Connect your account, manage channels, and auto-share posts to groups.</p>
      </div>
      <WhatsAppConnect initialStatus={(session?.status as Status) ?? "disconnected"} />
      <ChannelsManager
        initialChannels={channels ?? []}
        maxChannels={limit?.max_channels ?? 1}
        tier={tier}
        groups={(groups ?? []) as Group[]}
        routesByChannel={routesByChannel}
        maxGroupsPerChannel={limit?.max_groups_per_channel ?? 0}
      />
      <GroupsManager
        initialGroups={(groups ?? []) as Group[]}
        maxGroupsPerChannel={limit?.max_groups_per_channel ?? 0}
        tier={tier}
      />
    </div>
  );
}
