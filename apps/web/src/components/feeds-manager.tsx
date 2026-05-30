"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Label, Toggle, Spinner } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

export interface Feed {
  id: string;
  screen_name: string;
  channel_ids: string[]; // Wave 3a: many-channel routes per feed
  include_retweets: boolean;
  include_replies: boolean;
  forward_media: boolean;
  include_videos: boolean;
  exclude_links: boolean;
  include_quotes: boolean;
}

export interface ChannelOption {
  id: string;
  channel_name: string;
}

type FilterKey =
  | "include_retweets"
  | "include_replies"
  | "forward_media"
  | "include_videos"
  | "exclude_links"
  | "include_quotes";

const HANDLE_RE = /^@?[A-Za-z0-9_]{1,15}$/;

export function FeedsManager({
  initialFeeds,
  channels,
  planLimit,
  tier,
  allowVideo,
  allowLinkFilter,
  isPro,
}: {
  initialFeeds: Feed[];
  channels: ChannelOption[];
  planLimit: number;
  tier: string;
  allowVideo: boolean;
  allowLinkFilter: boolean;
  isPro: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const [feeds, setFeeds] = useState<Feed[]>(initialFeeds);
  const [handle, setHandle] = useState("");
  // Free/Basic stay single-pick; Pro can stage multiple before creating.
  const [newChannelIds, setNewChannelIds] = useState<string[]>(channels[0]?.id ? [channels[0].id] : []);
  const [includeRetweets, setIncludeRetweets] = useState(false);
  const [includeReplies, setIncludeReplies] = useState(false);
  const [forwardMedia, setForwardMedia] = useState(true);
  const [includeVideos, setIncludeVideos] = useState(false);
  const [excludeLinks, setExcludeLinks] = useState(false);
  const [includeQuotes, setIncludeQuotes] = useState(true);
  const [adding, setAdding] = useState(false);

  const channelById = new Map(channels.map((c) => [c.id, c]));
  const atLimit = feeds.length >= planLimit;

  const addFeed = async () => {
    const clean = handle.trim().replace(/^@/, "").toLowerCase();
    if (!HANDLE_RE.test(handle.trim())) {
      toast.error("Enter a valid X handle (letters, numbers, underscore; max 15).");
      return;
    }
    if (feeds.some((f) => f.screen_name === clean)) {
      toast.error("You're already tracking that handle.");
      return;
    }
    if (newChannelIds.length === 0) {
      toast.error("Pick at least one channel for this handle. Add one on the WhatsApp page if you have none.");
      return;
    }

    setAdding(true);
    const { data, error } = await supabase.rpc("add_feed_configuration", {
      p_screen_name: clean,
      p_channel_ids: newChannelIds,
      p_include_retweets: includeRetweets,
      p_include_replies: includeReplies,
      p_forward_media: forwardMedia,
      p_include_videos: allowVideo ? includeVideos : false,
      p_exclude_links: allowLinkFilter ? excludeLinks : false,
      p_include_quotes: includeQuotes,
    });
    setAdding(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    if (data) {
      setFeeds((prev) => [
        ...prev,
        {
          id: data.id,
          screen_name: clean,
          channel_ids: [...newChannelIds],
          include_retweets: data.include_retweets,
          include_replies: data.include_replies,
          forward_media: data.forward_media,
          include_videos: data.include_videos,
          exclude_links: data.exclude_links,
          include_quotes: data.include_quotes,
        },
      ]);
      setHandle("");
      setNewChannelIds(channels[0]?.id ? [channels[0].id] : []);
      setIncludeRetweets(false);
      setIncludeReplies(false);
      setForwardMedia(true);
      setIncludeVideos(false);
      setExcludeLinks(false);
      setIncludeQuotes(true);
      toast.success(`Now tracking @${clean}.`);
    }
  };

  const toggle = async (feed: Feed, key: FilterKey, value: boolean) => {
    setFeeds((prev) => prev.map((f) => (f.id === feed.id ? { ...f, [key]: value } : f)));
    const patch =
      key === "include_retweets"
        ? { include_retweets: value }
        : key === "include_replies"
          ? { include_replies: value }
          : key === "forward_media"
            ? { forward_media: value }
            : key === "include_videos"
              ? { include_videos: value }
              : key === "exclude_links"
                ? { exclude_links: value }
                : { include_quotes: value };
    const { error } = await supabase.from("feed_configurations").update(patch).eq("id", feed.id);
    if (error) {
      toast.error("Couldn't update filter.");
      setFeeds((prev) => prev.map((f) => (f.id === feed.id ? { ...f, [key]: !value } : f)));
    }
  };

  const remove = async (feed: Feed) => {
    const prev = feeds;
    setFeeds((f) => f.filter((x) => x.id !== feed.id));
    const { error } = await supabase.from("feed_configurations").delete().eq("id", feed.id);
    if (error) {
      toast.error("Couldn't remove handle.");
      setFeeds(prev);
    } else {
      toast.success(`Stopped tracking @${feed.screen_name}.`);
    }
  };

  /**
   * Add a route. For Pro, this is purely additive. For Free/Basic, we replace
   * the single existing route (DB trigger enforces the 1-route cap regardless).
   */
  const addRoute = async (feed: Feed, channelId: string) => {
    if (feed.channel_ids.includes(channelId)) return;
    const prev = feeds;
    if (!isPro && feed.channel_ids.length > 0) {
      // single-channel replace: delete old, insert new
      const oldId = feed.channel_ids[0];
      setFeeds((p) => p.map((f) => (f.id === feed.id ? { ...f, channel_ids: [channelId] } : f)));
      const { error: delErr } = await supabase
        .from("feed_channel_routes")
        .delete()
        .eq("feed_configuration_id", feed.id)
        .eq("channel_id", oldId);
      if (delErr) {
        toast.error("Couldn't change channel.");
        setFeeds(prev);
        return;
      }
    } else {
      setFeeds((p) => p.map((f) => (f.id === feed.id ? { ...f, channel_ids: [...f.channel_ids, channelId] } : f)));
    }
    const { error } = await supabase
      .from("feed_channel_routes")
      .insert({ feed_configuration_id: feed.id, channel_id: channelId });
    if (error) {
      toast.error(error.message);
      setFeeds(prev);
    }
  };

  const removeRoute = async (feed: Feed, channelId: string) => {
    if (!feed.channel_ids.includes(channelId)) return;
    const prev = feeds;
    setFeeds((p) =>
      p.map((f) => (f.id === feed.id ? { ...f, channel_ids: f.channel_ids.filter((c) => c !== channelId) } : f)),
    );
    const { error } = await supabase
      .from("feed_channel_routes")
      .delete()
      .eq("feed_configuration_id", feed.id)
      .eq("channel_id", channelId);
    if (error) {
      toast.error("Couldn't remove channel.");
      setFeeds(prev);
    }
  };

  const pct = Math.min(100, (feeds.length / Math.max(1, planLimit)) * 100);

  return (
    <div className="space-y-6">
      {/* Add handle */}
      <Card className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Add an X handle</h2>
            <p className="mt-1 text-sm text-muted">
              {isPro
                ? "We'll mirror its posts to every channel you pick."
                : "We'll mirror its posts to your channel."}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted">
              <span className="font-semibold text-foreground">{feeds.length}</span> / {planLimit} used
            </p>
            <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs capitalize text-faint">{tier} plan</p>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">@</span>
            <Input
              placeholder="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={atLimit}
              className="pl-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") void addFeed();
              }}
            />
          </div>
          <Button onClick={addFeed} disabled={adding || atLimit}>
            {adding ? <Spinner /> : null} Add
          </Button>
        </div>

        {atLimit ? (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            You&apos;ve reached your {tier} plan limit. Upgrade to track more handles.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">
                Post to {isPro ? <span className="text-xs text-faint">(pick one or more)</span> : null}
              </Label>
              {channels.length === 0 ? (
                <p className="text-xs text-faint">Add a channel on the WhatsApp page first.</p>
              ) : (
                <ChannelPicker
                  selected={newChannelIds}
                  onChange={setNewChannelIds}
                  channels={channels}
                  isPro={isPro}
                />
              )}
            </div>
            <div className="flex flex-wrap gap-6">
              <ToggleRow id="new-rt" label="Retweets" checked={includeRetweets} onChange={setIncludeRetweets} />
              <ToggleRow id="new-rp" label="Replies" checked={includeReplies} onChange={setIncludeReplies} />
              <ToggleRow id="new-md" label="Photos" checked={forwardMedia} onChange={setForwardMedia} />
              <ToggleRow
                id="new-vd"
                label="Videos"
                checked={allowVideo && includeVideos}
                onChange={setIncludeVideos}
                disabled={!allowVideo}
                badge={!allowVideo ? "Pro" : undefined}
              />
              <ToggleRow
                id="new-nl"
                label="Exclude links"
                checked={allowLinkFilter && excludeLinks}
                onChange={setExcludeLinks}
                disabled={!allowLinkFilter}
                badge={!allowLinkFilter ? "Basic+" : undefined}
              />
              <ToggleRow id="new-qt" label="Quoted tweets" checked={includeQuotes} onChange={setIncludeQuotes} />
            </div>
          </div>
        )}
      </Card>

      {/* List */}
      <Card>
        <div className="border-b border-line p-6">
          <h2 className="text-lg font-semibold">Tracked handles</h2>
          <p className="mt-1 text-sm text-muted">Per-handle channels and filters.</p>
        </div>

        {feeds.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm text-muted">No handles yet.</p>
            <p className="mt-1 text-xs text-faint">Add one above to start mirroring posts.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {feeds.map((feed) => {
              const unselected = channels.filter((c) => !feed.channel_ids.includes(c.id));
              const canAddMore = isPro ? unselected.length > 0 : feed.channel_ids.length === 0;
              return (
                <li key={feed.id} className="flex flex-col gap-4 px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
                        {feed.screen_name.charAt(0).toUpperCase()}
                      </span>
                      <span className="font-medium">@{feed.screen_name}</span>
                    </div>
                    <button
                      onClick={() => remove(feed)}
                      className="text-sm font-medium text-danger transition-colors hover:text-danger/80"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-xs uppercase tracking-wide text-faint">Channels</Label>
                    {feed.channel_ids.length === 0 ? (
                      <span className="text-xs text-faint">No channel selected — posts won&apos;t be sent.</span>
                    ) : (
                      feed.channel_ids.map((id) => (
                        <ChannelChip
                          key={id}
                          name={channelById.get(id)?.channel_name ?? "Unknown channel"}
                          onRemove={() => removeRoute(feed, id)}
                        />
                      ))
                    )}
                    {canAddMore ? (
                      <AddChannelButton
                        options={unselected}
                        onPick={(id) => addRoute(feed, id)}
                        label={isPro && feed.channel_ids.length > 0 ? "+ Add channel" : "+ Pick channel"}
                      />
                    ) : !isPro ? (
                      <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">
                        Pro: multi-channel
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-3">
                    <ToggleRow id={`${feed.id}-rt`} label="Retweets" checked={feed.include_retweets} onChange={(v) => toggle(feed, "include_retweets", v)} />
                    <ToggleRow id={`${feed.id}-rp`} label="Replies" checked={feed.include_replies} onChange={(v) => toggle(feed, "include_replies", v)} />
                    <ToggleRow id={`${feed.id}-md`} label="Photos" checked={feed.forward_media} onChange={(v) => toggle(feed, "forward_media", v)} />
                    <ToggleRow id={`${feed.id}-vd`} label="Videos" checked={feed.include_videos} onChange={(v) => toggle(feed, "include_videos", v)} disabled={!allowVideo} badge={!allowVideo ? "Pro" : undefined} />
                    <ToggleRow id={`${feed.id}-nl`} label="Exclude links" checked={feed.exclude_links} onChange={(v) => toggle(feed, "exclude_links", v)} disabled={!allowLinkFilter} badge={!allowLinkFilter ? "Basic+" : undefined} />
                    <ToggleRow id={`${feed.id}-qt`} label="Quoted tweets" checked={feed.include_quotes} onChange={(v) => toggle(feed, "include_quotes", v)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ChannelChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
      {name}
      <button
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="rounded-full text-brand/70 transition-colors hover:text-brand"
      >
        ×
      </button>
    </span>
  );
}

function AddChannelButton({
  options,
  onPick,
  label,
}: {
  options: ChannelOption[];
  onPick: (id: string) => void;
  label: string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="relative">
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) onPick(v);
          e.currentTarget.value = "";
        }}
        className="h-7 cursor-pointer appearance-none rounded-full border border-dashed border-line bg-surface-2 pl-2.5 pr-2.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-foreground focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/25"
      >
        <option value="">{label}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.channel_name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ChannelPicker({
  selected,
  onChange,
  channels,
  isPro,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  channels: ChannelOption[];
  isPro: boolean;
}) {
  const channelById = new Map(channels.map((c) => [c.id, c]));
  const unselected = channels.filter((c) => !selected.includes(c.id));
  const canAddMore = isPro ? unselected.length > 0 : selected.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selected.map((id) => (
        <ChannelChip
          key={id}
          name={channelById.get(id)?.channel_name ?? "Unknown"}
          onRemove={() => onChange(selected.filter((x) => x !== id))}
        />
      ))}
      {canAddMore ? (
        <AddChannelButton
          options={unselected}
          onPick={(id) => onChange(isPro ? [...selected, id] : [id])}
          label={isPro && selected.length > 0 ? "+ Add channel" : "+ Pick channel"}
        />
      ) : !isPro ? (
        <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">
          Pro: multi-channel
        </span>
      ) : null}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
  disabled,
  badge,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Toggle id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <Label htmlFor={id} className={cn("cursor-pointer select-none", disabled && "opacity-60")}>
        {label}
      </Label>
      {badge ? (
        <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand">
          {badge}
        </span>
      ) : null}
    </div>
  );
}
