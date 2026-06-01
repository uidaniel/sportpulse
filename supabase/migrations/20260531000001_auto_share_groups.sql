-- Auto-share to groups: when a channel post goes out, optionally forward the
-- same content to up to N WhatsApp groups the user is in. Free=0, Basic=1, Pro=5.

-- ---------------------------------------------------------------------------
-- Plan limits: per-tier cap for groups-per-channel
-- ---------------------------------------------------------------------------
alter table public.plan_limits
  add column max_groups_per_channel integer not null default 0;

update public.plan_limits set max_groups_per_channel = 0 where tier = 'free';
update public.plan_limits set max_groups_per_channel = 1 where tier = 'basic';
update public.plan_limits set max_groups_per_channel = 5 where tier = 'pro';

-- ---------------------------------------------------------------------------
-- whatsapp_groups: cached list of WhatsApp groups the user is a member of.
-- Synced from the gateway via groupFetchAllParticipating().
-- ---------------------------------------------------------------------------
create table public.whatsapp_groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  group_jid   text not null,
  group_name  text not null,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, group_jid)
);

create index whatsapp_groups_user_idx on public.whatsapp_groups (user_id);

create trigger whatsapp_groups_set_updated_at
  before update on public.whatsapp_groups
  for each row execute function public.set_updated_at();

alter table public.whatsapp_groups enable row level security;

create policy "wa_groups_select_own" on public.whatsapp_groups
  for select to authenticated using (user_id = auth.uid());
create policy "wa_groups_insert_own" on public.whatsapp_groups
  for insert to authenticated with check (user_id = auth.uid());
create policy "wa_groups_update_own" on public.whatsapp_groups
  for update to authenticated using (user_id = auth.uid());
create policy "wa_groups_delete_own" on public.whatsapp_groups
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- channel_group_routes: each channel can auto-share to N groups
-- ---------------------------------------------------------------------------
create table public.channel_group_routes (
  channel_id  uuid not null references public.whatsapp_channels (id) on delete cascade,
  group_id    uuid not null references public.whatsapp_groups   (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (channel_id, group_id)
);

create index channel_group_routes_group_idx on public.channel_group_routes (group_id);

alter table public.channel_group_routes enable row level security;

-- Ownership cascades through the channel (channel.user_id IS the owner).
create policy "channel_group_routes_select_own" on public.channel_group_routes
  for select to authenticated using (
    exists (
      select 1 from public.whatsapp_channels c
      where c.id = channel_id and c.user_id = auth.uid()
    )
  );
create policy "channel_group_routes_insert_own" on public.channel_group_routes
  for insert to authenticated with check (
    exists (
      select 1 from public.whatsapp_channels c
      where c.id = channel_id and c.user_id = auth.uid()
    )
  );
create policy "channel_group_routes_delete_own" on public.channel_group_routes
  for delete to authenticated using (
    exists (
      select 1 from public.whatsapp_channels c
      where c.id = channel_id and c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Enforce per-tier cap on routes-per-channel.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_groups_per_channel_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_tier    public.subscription_tier;
  v_max     integer;
  v_count   integer;
begin
  select c.user_id into v_user_id
  from public.whatsapp_channels c
  where c.id = new.channel_id;

  select tier into v_tier from public.subscriptions where user_id = v_user_id;
  v_tier := coalesce(v_tier, 'free');

  select max_groups_per_channel into v_max
  from public.plan_limits where tier = v_tier;
  v_max := coalesce(v_max, 0);

  select count(*) into v_count
  from public.channel_group_routes
  where channel_id = new.channel_id;

  if v_count >= v_max then
    raise exception 'Auto-share to groups: % plan allows % groups per channel. Upgrade to enable more.', v_tier, v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger channel_group_routes_enforce_limit
  before insert on public.channel_group_routes
  for each row execute function public.enforce_groups_per_channel_limit();

-- ---------------------------------------------------------------------------
-- published_messages: add target_jid so the same (feed, tweet) can be
-- delivered to multiple distinct destinations (channels OR groups).
-- The scraper still inserts only channel_id; an INSERT trigger auto-fills
-- target_jid from the channel — so the scraper code stays untouched.
-- ---------------------------------------------------------------------------
alter table public.published_messages
  add column target_jid text;

-- backfill: every existing row was a channel send
update public.published_messages pm
set target_jid = c.channel_jid
from public.whatsapp_channels c
where pm.channel_id = c.id
  and pm.target_jid is null;

-- defensive: kill any orphan rows so we can mark NOT NULL safely
delete from public.published_messages where target_jid is null;

alter table public.published_messages alter column target_jid set not null;

-- Replace (feed, tweet, channel_id) uniqueness with (feed, tweet, target_jid)
-- so groups dedup independently of channels.
alter table public.published_messages
  drop constraint if exists published_messages_unique_per_channel;

alter table public.published_messages
  add constraint published_messages_unique_per_target
  unique (feed_configuration_id, tweet_id, target_jid);

-- Auto-fill target_jid from channel_id on insert when not provided.
-- Lets the scraper keep inserting only (feed, tweet, channel_id, status).
create or replace function public.set_published_messages_target_jid()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.target_jid is null and new.channel_id is not null then
    select channel_jid into new.target_jid
    from public.whatsapp_channels
    where id = new.channel_id;
  end if;
  return new;
end;
$$;

create trigger published_messages_set_target_jid
  before insert on public.published_messages
  for each row execute function public.set_published_messages_target_jid();
