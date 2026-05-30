-- Wave 3: multiple target channels, routed per feed (Pro can have many).

-- ---------------------------------------------------------------------------
-- whatsapp_channels: the channels a user's connected account targets.
-- ---------------------------------------------------------------------------
create table public.whatsapp_channels (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  channel_jid  text not null,
  channel_name text not null default 'WhatsApp Channel',
  created_at   timestamptz not null default now(),
  unique (user_id, channel_jid)
);
create index whatsapp_channels_user_idx on public.whatsapp_channels (user_id);

alter table public.whatsapp_channels enable row level security;
create policy "channels_select_own" on public.whatsapp_channels
  for select to authenticated using (user_id = auth.uid());
create policy "channels_insert_own" on public.whatsapp_channels
  for insert to authenticated with check (user_id = auth.uid());
create policy "channels_update_own" on public.whatsapp_channels
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "channels_delete_own" on public.whatsapp_channels
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Per-feed routing + tier channel limit
-- ---------------------------------------------------------------------------
alter table public.feed_configurations
  add column channel_id uuid references public.whatsapp_channels (id) on delete set null;
create index feed_configurations_channel_idx on public.feed_configurations (channel_id);

alter table public.plan_limits add column max_channels integer not null default 1;
update public.plan_limits set max_channels = 1  where tier in ('free', 'basic');
update public.plan_limits set max_channels = 10 where tier = 'pro';

-- ---------------------------------------------------------------------------
-- Migrate the existing single channel into the new model
-- ---------------------------------------------------------------------------
insert into public.whatsapp_channels (user_id, channel_jid, channel_name)
select user_id, whatsapp_channel_id, coalesce(whatsapp_channel_name, 'WhatsApp Channel')
from public.whatsapp_sessions
where whatsapp_channel_id is not null
on conflict (user_id, channel_jid) do nothing;

update public.feed_configurations fc
set channel_id = wc.id
from public.whatsapp_channels wc
where wc.user_id = fc.user_id and fc.channel_id is null;

-- ---------------------------------------------------------------------------
-- Enforce per-tier channel limit
-- ---------------------------------------------------------------------------
create or replace function public.enforce_channel_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tier  public.subscription_tier;
  v_limit integer;
  v_count integer;
begin
  select tier into v_tier from public.subscriptions where user_id = new.user_id;
  v_tier := coalesce(v_tier, 'free');
  select max_channels into v_limit from public.plan_limits where tier = v_tier;
  select count(*) into v_count from public.whatsapp_channels where user_id = new.user_id;
  if v_count >= v_limit then
    raise exception 'Channel limit reached for % tier (max %). Upgrade to add more channels.', v_tier, v_limit
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger whatsapp_channels_enforce_limit
  before insert on public.whatsapp_channels
  for each row execute function public.enforce_channel_limit();

-- ---------------------------------------------------------------------------
-- RPC: add a (gateway-verified) channel. Re-adding an existing one just renames
-- it (no insert -> the limit trigger isn't tripped).
-- ---------------------------------------------------------------------------
create or replace function public.add_whatsapp_channel(
  p_channel_jid  text,
  p_channel_name text default 'WhatsApp Channel'
)
returns public.whatsapp_channels
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.whatsapp_channels;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update public.whatsapp_channels
     set channel_name = coalesce(p_channel_name, channel_name)
   where user_id = auth.uid() and channel_jid = p_channel_jid
  returning * into v_row;

  if not found then
    insert into public.whatsapp_channels (user_id, channel_jid, channel_name)
    values (auth.uid(), p_channel_jid, coalesce(p_channel_name, 'WhatsApp Channel'))
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.add_whatsapp_channel(text, text) from public, anon;
grant execute on function public.add_whatsapp_channel(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_feed_configuration now takes a target channel
-- ---------------------------------------------------------------------------
drop function if exists public.add_feed_configuration(text, boolean, boolean, boolean, boolean, boolean);

create or replace function public.add_feed_configuration(
  p_screen_name      text,
  p_channel_id       uuid    default null,
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
    (user_id, tracked_handle_id, channel_id, include_retweets, include_replies, forward_media, include_videos, exclude_links)
  values
    (auth.uid(), v_handle_id, p_channel_id, p_include_retweets, p_include_replies, p_forward_media, p_include_videos, p_exclude_links)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.add_feed_configuration(text, uuid, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.add_feed_configuration(text, uuid, boolean, boolean, boolean, boolean, boolean) to authenticated;
