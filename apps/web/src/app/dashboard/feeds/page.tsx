import { createClient } from "@/lib/supabase/server";
import { FeedsManager, type Feed } from "@/components/feeds-manager";

export default async function FeedsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: configs } = await supabase
    .from("feed_configurations")
    .select("id, tracked_handle_id, include_retweets, include_replies, forward_media, include_videos, exclude_links, include_quotes")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  // Resolve handle names (separate query to avoid the table/view FK ambiguity).
  const handleIds = [...new Set((configs ?? []).map((c) => c.tracked_handle_id))];
  const handleMap = new Map<string, string>();
  if (handleIds.length) {
    const { data: handles } = await supabase
      .from("tracked_x_handles")
      .select("id, screen_name")
      .in("id", handleIds);
    (handles ?? []).forEach((h) => handleMap.set(h.id, h.screen_name));
  }

  // Wave 3a: a feed can route to multiple channels — pull them all in one shot.
  const configIds = (configs ?? []).map((c) => c.id);
  const routesByFeed = new Map<string, string[]>();
  if (configIds.length) {
    const { data: routes } = await supabase
      .from("feed_channel_routes")
      .select("feed_configuration_id, channel_id")
      .in("feed_configuration_id", configIds);
    for (const r of routes ?? []) {
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

  const { data: channels } = await supabase
    .from("whatsapp_channels")
    .select("id, channel_name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("tier")
    .eq("user_id", userId)
    .maybeSingle();
  const tier = sub?.tier ?? "free";
  const { data: limit } = await supabase
    .from("plan_limits")
    .select("max_handles, allow_video, allow_link_filter")
    .eq("tier", tier)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Feeds</h1>
        <p className="text-sm text-muted">
          Choose which X accounts to mirror to your WhatsApp channels, and how.
        </p>
      </div>
      <FeedsManager
        initialFeeds={feeds}
        channels={channels ?? []}
        planLimit={limit?.max_handles ?? 1}
        tier={tier}
        allowVideo={limit?.allow_video ?? false}
        allowLinkFilter={limit?.allow_link_filter ?? false}
        isPro={tier === "pro"}
      />
    </div>
  );
}
