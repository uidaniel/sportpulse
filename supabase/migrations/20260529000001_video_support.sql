-- Video forwarding support, gated by plan tier (Pro only by default).

-- 1. Per-feed toggle.
alter table public.feed_configurations
  add column include_videos boolean not null default false;

-- 2. Tier permission. Videos are a Pro-tier feature.
alter table public.plan_limits
  add column allow_video boolean not null default false;
update public.plan_limits set allow_video = true where tier = 'pro';

-- 3. Enforce: a feed can only enable include_videos if the owner's tier allows it.
--    Defense-in-depth alongside the dashboard UI gating.
create or replace function public.enforce_video_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allow boolean;
begin
  if new.include_videos then
    select pl.allow_video into v_allow
    from public.subscriptions s
    join public.plan_limits pl on pl.tier = s.tier
    where s.user_id = new.user_id;

    if not coalesce(v_allow, false) then
      raise exception 'Video forwarding is not available on your plan. Upgrade to enable it.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger feed_configurations_enforce_video
  before insert or update on public.feed_configurations
  for each row execute function public.enforce_video_permission();

-- 4. Update the "follow handle" RPC to accept the new flag.
drop function if exists public.add_feed_configuration(text, boolean, boolean, boolean);

create or replace function public.add_feed_configuration(
  p_screen_name      text,
  p_include_retweets boolean default false,
  p_include_replies  boolean default false,
  p_forward_media    boolean default true,
  p_include_videos   boolean default false
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
    (user_id, tracked_handle_id, include_retweets, include_replies, forward_media, include_videos)
  values
    (auth.uid(), v_handle_id, p_include_retweets, p_include_replies, p_forward_media, p_include_videos)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.add_feed_configuration(text, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.add_feed_configuration(text, boolean, boolean, boolean, boolean) to authenticated;
