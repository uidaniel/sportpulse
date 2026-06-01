import { createClient } from "@/lib/supabase/server";
import { WhatsAppConnect } from "@/components/whatsapp-connect";
import { ChannelsManager } from "@/components/channels-manager";
import { GroupsManager, type Group } from "@/components/groups-manager";
import { FeedsManager, type Feed } from "@/components/feeds-manager";

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

  const { data: configs } = await supabase
    .from("feed_configurations")
    .select("id, tracked_handle_id, include_retweets, include_replies, forward_media, include_videos, exclude_links, include_quotes")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  // Resolve handle names separately to avoid FK ambiguity between the table/view.
  const handleIds = [...new Set((configs ?? []).map((c) => c.tracked_handle_id))];
  const handleMap = new Map<string, string>();
  if (handleIds.length) {
    const { data: handles } = await supabase
      .from("tracked_x_handles")
      .select("id, screen_name")
      .in("id", handleIds);
    (handles ?? []).forEach((h) => handleMap.set(h.id, h.screen_name));
  }

  // Feed -> [channel_id, ...] routes for multi-channel fanout.
  const configIds = (configs ?? []).map((c) => c.id);
  const routesByFeed = new Map<string, string[]>();
  if (configIds.length) {
    const { data: feedRoutes } = await supabase
      .from("feed_channel_routes")
      .select("feed_configuration_id, channel_id")
      .in("feed_configuration_id", configIds);
    for (const r of feedRoutes ?? []) {
      const arr = routesByFeed.get(r.feed_configuration_id) ?? [];
      arr.push(r.channel_id);
      routesByFeed.set(r.feed_configuration_id, arr);
    }
  }

  const feeds: Feed[] = (configs ?? []).map((c) => ({
    id: c.id,
    screen_name: handleMap.get(c.tracked_handle_id) ?? "unknown",
    channel_ids: routesByFeed.get(c.id) ?? [],
    include_retweets: c.include_retweets,
    include_replies: c.include_replies,
    forward_media: c.forward_media,
    include_videos: c.include_videos,
    exclude_links: c.exclude_links,
    include_quotes: c.include_quotes,
  }));

  const { data: limit } = await supabase
    .from("plan_limits")
    .select("max_channels, max_groups_per_channel, max_handles, allow_video, allow_link_filter")
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
      <FeedsManager
        initialFeeds={feeds}
        channels={(channels ?? []).map((c) => ({ id: c.id, channel_name: c.channel_name }))}
        planLimit={limit?.max_handles ?? 1}
        tier={tier}
        allowVideo={limit?.allow_video ?? false}
        allowLinkFilter={limit?.allow_link_filter ?? false}
        isPro={tier === "pro"}
      />
    </div>
  );
}
