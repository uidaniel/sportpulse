-- Wave 3a: each feed can route to MANY channels (Pro feature).
-- Free/Basic stay at one channel per feed; Pro can fan a single handle out to
-- as many of their channels as they want.

-- ---------------------------------------------------------------------------
-- Junction table: which channels each feed posts to
-- ---------------------------------------------------------------------------
create table public.feed_channel_routes (
  feed_configuration_id uuid not null references public.feed_configurations (id) on delete cascade,
  channel_id            uuid not null references public.whatsapp_channels    (id) on delete cascade,
  created_at            timestamptz not null default now(),
  primary key (feed_configuration_id, channel_id)
);

create index feed_channel_routes_channel_idx on public.feed_channel_routes (channel_id);

alter table public.feed_channel_routes enable row level security;

-- Owner is determined via the feed's user_id.
create policy "routes_select_own" on public.feed_channel_routes
  for select to authenticated using (
    exists (
      select 1 from public.feed_configurations fc
      where fc.id = feed_configuration_id and fc.user_id = auth.uid()
    )
  );
create policy "routes_insert_own" on public.feed_channel_routes
  for insert to authenticated with check (
    exists (
      select 1 from public.feed_configurations fc
      where fc.id = feed_configuration_id and fc.user_id = auth.uid()
    )
  );
create policy "routes_delete_own" on public.feed_channel_routes
  for delete to authenticated using (
    exists (
      select 1 from public.feed_configurations fc
      where fc.id = feed_configuration_id and fc.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Migrate existing single-channel routing into the junction table.
-- ---------------------------------------------------------------------------
insert into public.feed_channel_routes (feed_configuration_id, channel_id)
select id, channel_id from public.feed_configurations
where channel_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Enforce: only Pro tier may route a single feed to multiple channels.
-- Free/Basic capped at 1 route per feed.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_routes_per_feed_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_tier    public.subscription_tier;
  v_count   integer;
begin
  select fc.user_id into v_user_id
  from public.feed_configurations fc
  where fc.id = new.feed_configuration_id;

  select tier into v_tier from public.subscriptions where user_id = v_user_id;
  v_tier := coalesce(v_tier, 'free');

  if v_tier <> 'pro' then
    select count(*) into v_count
    from public.feed_channel_routes
    where feed_configuration_id = new.feed_configuration_id;
    if v_count >= 1 then
      raise exception 'Routing one handle to multiple channels is a Pro feature. Upgrade to enable it.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger feed_channel_routes_enforce_limit
  before insert on public.feed_channel_routes
  for each row execute function public.enforce_routes_per_feed_limit();

-- ---------------------------------------------------------------------------
-- published_messages: track per-channel dedup so the SAME tweet on the SAME
-- feed can be delivered to multiple distinct channels (no false dedup).
-- ---------------------------------------------------------------------------
alter table public.published_messages
  add column channel_id uuid references public.whatsapp_channels (id) on delete cascade;

-- backfill: existing rows were single-channel via feed.channel_id
update public.published_messages pm
set channel_id = fc.channel_id
from public.feed_configurations fc
where pm.feed_configuration_id = fc.id
  and pm.channel_id is null
  and fc.channel_id is not null;

-- any orphan rows whose feed never had a channel are unrecoverable -> drop
delete from public.published_messages where channel_id is null;

alter table public.published_messages alter column channel_id set not null;

-- replace the old (feed, tweet) uniqueness with (feed, tweet, channel)
alter table public.published_messages
  drop constraint if exists published_messages_feed_configuration_id_tweet_id_key;

alter table public.published_messages
  add constraint published_messages_unique_per_channel
  unique (feed_configuration_id, tweet_id, channel_id);

-- ---------------------------------------------------------------------------
-- Update add_feed_configuration to accept an array of channels.
-- (Single-channel callers can pass an array of one.)
-- ---------------------------------------------------------------------------
drop function if exists public.add_feed_configuration(text, uuid, boolean, boolean, boolean, boolean, boolean);

create or replace function public.add_feed_configuration(
  p_screen_name      text,
  p_channel_ids      uuid[] default '{}'::uuid[],
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
  v_ch        uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  v_handle_id := public.add_tracked_handle(p_screen_name);

  -- legacy channel_id column kept for backward compat — populated with first id
  insert into public.feed_configurations
    (user_id, tracked_handle_id, channel_id, include_retweets, include_replies, forward_media, include_videos, exclude_links)
  values
    (auth.uid(), v_handle_id, p_channel_ids[1], p_include_retweets, p_include_replies, p_forward_media, p_include_videos, p_exclude_links)
  returning * into v_row;

  -- insert each route; the limit trigger enforces tier rules
  foreach v_ch in array p_channel_ids loop
    insert into public.feed_channel_routes (feed_configuration_id, channel_id)
    values (v_row.id, v_ch)
    on conflict do nothing;
  end loop;

  return v_row;
end;
$$;

revoke execute on function public.add_feed_configuration(text, uuid[], boolean, boolean, boolean, boolean, boolean) from public, anon;
grant  execute on function public.add_feed_configuration(text, uuid[], boolean, boolean, boolean, boolean, boolean) to authenticated;
