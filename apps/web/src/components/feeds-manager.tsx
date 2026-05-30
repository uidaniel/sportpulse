"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Label, Toggle, Spinner } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

export interface Feed {
  id: string;
  screen_name: string;
  channel_id: string | null;
  include_retweets: boolean;
  include_replies: boolean;
  forward_media: boolean;
  include_videos: boolean;
  exclude_links: boolean;
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
  | "exclude_links";

const HANDLE_RE = /^@?[A-Za-z0-9_]{1,15}$/;

export function FeedsManager({
  initialFeeds,
  channels,
  planLimit,
  tier,
  allowVideo,
  allowLinkFilter,
}: {
  initialFeeds: Feed[];
  channels: ChannelOption[];
  planLimit: number;
  tier: string;
  allowVideo: boolean;
  allowLinkFilter: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const [feeds, setFeeds] = useState<Feed[]>(initialFeeds);
  const [handle, setHandle] = useState("");
  const [channelId, setChannelId] = useState<string>(channels[0]?.id ?? "");
  const [includeRetweets, setIncludeRetweets] = useState(false);
  const [includeReplies, setIncludeReplies] = useState(false);
  const [forwardMedia, setForwardMedia] = useState(true);
  const [includeVideos, setIncludeVideos] = useState(false);
  const [excludeLinks, setExcludeLinks] = useState(false);
  const [adding, setAdding] = useState(false);

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
    if (!channelId) {
      toast.error("Pick a channel for this handle. Add one on the WhatsApp page if you have none.");
      return;
    }

    setAdding(true);
    const { data, error } = await supabase.rpc("add_feed_configuration", {
      p_screen_name: clean,
      p_channel_id: channelId,
      p_include_retweets: includeRetweets,
      p_include_replies: includeReplies,
      p_forward_media: forwardMedia,
      p_include_videos: allowVideo ? includeVideos : false,
      p_exclude_links: allowLinkFilter ? excludeLinks : false,
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
          channel_id: data.channel_id,
          include_retweets: data.include_retweets,
          include_replies: data.include_replies,
          forward_media: data.forward_media,
          include_videos: data.include_videos,
          exclude_links: data.exclude_links,
        },
      ]);
      setHandle("");
      setIncludeRetweets(false);
      setIncludeReplies(false);
      setForwardMedia(true);
      setIncludeVideos(false);
      setExcludeLinks(false);
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
              : { exclude_links: value };
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

  const changeChannel = async (feed: Feed, newChannelId: string | null) => {
    const prevId = feed.channel_id;
    setFeeds((prev) => prev.map((f) => (f.id === feed.id ? { ...f, channel_id: newChannelId } : f)));
    const { error } = await supabase
      .from("feed_configurations")
      .update({ channel_id: newChannelId })
      .eq("id", feed.id);
    if (error) {
      toast.error("Couldn't change channel.");
      setFeeds((prev) => prev.map((f) => (f.id === feed.id ? { ...f, channel_id: prevId } : f)));
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
            <p className="mt-1 text-sm text-muted">We&apos;ll mirror its posts to your channel.</p>
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
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-sm">Post to</Label>
              <ChannelSelect value={channelId || null} onChange={(v) => setChannelId(v ?? "")} channels={channels} />
              {channels.length === 0 ? (
                <span className="text-xs text-faint">Add a channel on the WhatsApp page first.</span>
              ) : null}
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
            </div>
          </div>
        )}
      </Card>

      {/* List */}
      <Card>
        <div className="border-b border-line p-6">
          <h2 className="text-lg font-semibold">Tracked handles</h2>
          <p className="mt-1 text-sm text-muted">Per-handle ingestion filters.</p>
        </div>

        {feeds.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm text-muted">No handles yet.</p>
            <p className="mt-1 text-xs text-faint">Add one above to start mirroring posts.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {feeds.map((feed) => (
              <li
                key={feed.id}
                className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
                    {feed.screen_name.charAt(0).toUpperCase()}
                  </span>
                  <span className="font-medium">@{feed.screen_name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <ChannelSelect value={feed.channel_id} onChange={(v) => changeChannel(feed, v)} channels={channels} />
                  <ToggleRow id={`${feed.id}-rt`} label="Retweets" checked={feed.include_retweets} onChange={(v) => toggle(feed, "include_retweets", v)} />
                  <ToggleRow id={`${feed.id}-rp`} label="Replies" checked={feed.include_replies} onChange={(v) => toggle(feed, "include_replies", v)} />
                  <ToggleRow id={`${feed.id}-md`} label="Photos" checked={feed.forward_media} onChange={(v) => toggle(feed, "forward_media", v)} />
                  <ToggleRow id={`${feed.id}-vd`} label="Videos" checked={feed.include_videos} onChange={(v) => toggle(feed, "include_videos", v)} disabled={!allowVideo} badge={!allowVideo ? "Pro" : undefined} />
                  <ToggleRow id={`${feed.id}-nl`} label="Exclude links" checked={feed.exclude_links} onChange={(v) => toggle(feed, "exclude_links", v)} disabled={!allowLinkFilter} badge={!allowLinkFilter ? "Basic+" : undefined} />
                  <button
                    onClick={() => remove(feed)}
                    className="text-sm font-medium text-danger transition-colors hover:text-danger/80"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ChannelSelect({
  value,
  onChange,
  channels,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  channels: ChannelOption[];
}) {
  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 appearance-none rounded-lg border border-line bg-surface-2 pl-3 pr-8 text-sm text-foreground focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/25"
      >
        <option value="">No channel</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.channel_name}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
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
