-- Wave 1: branding watermark, tiered poll cadence, and link-post filtering.

-- ---------------------------------------------------------------------------
-- plan_limits: new tier capabilities
-- ---------------------------------------------------------------------------
alter table public.plan_limits add column remove_branding      boolean not null default false;
alter table public.plan_limits add column poll_interval_seconds integer not null default 1800;
alter table public.plan_limits add column allow_link_filter    boolean not null default false;

-- Free  : watermark forced, slow polling (30m), no link filter
-- Basic : no watermark, medium polling (10m), link filter
-- Pro   : no watermark, fast polling (3m), link filter
update public.plan_limits set remove_branding = false, poll_interval_seconds = 1800, allow_link_filter = false where tier = 'free';
update public.plan_limits set remove_branding = true,  poll_interval_seconds = 600,  allow_link_filter = true  where tier = 'basic';
update public.plan_limits set remove_branding = true,  poll_interval_seconds = 180,  allow_link_filter = true  where tier = 'pro';

-- ---------------------------------------------------------------------------
-- feed_configurations: exclude posts that contain links (Basic+)
-- ---------------------------------------------------------------------------
alter table public.feed_configurations add column exclude_links boolean not null default false;

-- ---------------------------------------------------------------------------
-- Combined tier-feature enforcement (replaces the video-only trigger)
-- ---------------------------------------------------------------------------
drop trigger if exists feed_configurations_enforce_video on public.feed_configurations;
drop function if exists public.enforce_video_permission();

create or replace function public.enforce_feed_tier_features()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allow_video       boolean;
  v_allow_link_filter boolean;
begin
  select pl.allow_video, pl.allow_link_filter
    into v_allow_video, v_allow_link_filter
  from public.subscriptions s
  join public.plan_limits pl on pl.tier = s.tier
  where s.user_id = new.user_id;

  if new.include_videos and not coalesce(v_allow_video, false) then
    raise exception 'Video forwarding is not available on your plan. Upgrade to enable it.'
      using errcode = 'check_violation';
  end if;

  if new.exclude_links and not coalesce(v_allow_link_filter, false) then
    raise exception 'Filtering out link posts is not available on your plan. Upgrade to enable it.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger feed_configurations_enforce_tier_features
  before insert or update on public.feed_configurations
  for each row execute function public.enforce_feed_tier_features();

-- ---------------------------------------------------------------------------
-- due_handles(): handles due for polling now, where each handle's cadence is
-- the FASTEST tier among its active subscribers (aggregation + tiering).
-- ---------------------------------------------------------------------------
create or replace function public.due_handles()
returns table (id uuid, screen_name text, poll_interval_seconds integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.id, h.screen_name, min(pl.poll_interval_seconds)::int
  from public.tracked_x_handles h
  join public.feed_configurations fc on fc.tracked_handle_id = h.id and fc.is_active
  join public.subscriptions s on s.user_id = fc.user_id
  join public.plan_limits pl on pl.tier = s.tier
  group by h.id
  having h.last_polled_at is null
      or h.last_polled_at <= now() - make_interval(secs => min(pl.poll_interval_seconds));
$$;

revoke execute on function public.due_handles() from public, anon, authenticated;
grant execute on function public.due_handles() to service_role;

-- ---------------------------------------------------------------------------
-- add_feed_configuration: accept the exclude_links flag
-- ---------------------------------------------------------------------------
drop function if exists public.add_feed_configuration(text, boolean, boolean, boolean, boolean);

create or replace function public.add_feed_configuration(
  p_screen_name      text,
  p_include_retweets boolean default false,
  p_include_replies  boolean default false,
  p_forward_media    boolean default true,
  p_include_videos   boolean default false,
  p_exclude_links    boolean default false
)
returns public.feed_configurations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_handle_id uuid;
  v_row       public.feed_configurations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  v_handle_id := public.add_tracked_handle(p_screen_name);

  insert into public.feed_configurations
    (user_id, tracked_handle_id, include_retweets, include_replies, forward_media, include_videos, exclude_links)
  values
    (auth.uid(), v_handle_id, p_include_retweets, p_include_replies, p_forward_media, p_include_videos, p_exclude_links)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.add_feed_configuration(text, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.add_feed_configuration(text, boolean, boolean, boolean, boolean, boolean) to authenticated;
