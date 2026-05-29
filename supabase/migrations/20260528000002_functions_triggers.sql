-- SportPulse :: functions, triggers, and RPCs
-- All SECURITY DEFINER functions pin search_path to avoid hijacking.

-- ---------------------------------------------------------------------------
-- Generic updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create trigger whatsapp_sessions_set_updated_at
  before update on public.whatsapp_sessions
  for each row execute function public.set_updated_at();

create trigger feed_configurations_set_updated_at
  before update on public.feed_configurations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- On signup: provision profile + free subscription + empty WhatsApp session
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );

  insert into public.subscriptions (user_id, tier, status)
  values (new.id, 'free', 'active');

  insert into public.whatsapp_sessions (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Enforce per-tier handle limit (FR-3.1)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_handle_limit()
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

  select max_handles into v_limit from public.plan_limits where tier = v_tier;

  select count(*) into v_count
  from public.feed_configurations
  where user_id = new.user_id;

  if v_count >= v_limit then
    raise exception
      'Handle limit reached for % tier (max %). Upgrade your plan to track more handles.',
      v_tier, v_limit
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger feed_configurations_enforce_limit
  before insert on public.feed_configurations
  for each row execute function public.enforce_handle_limit();

-- ---------------------------------------------------------------------------
-- RPC: add (or fetch) a shared tracked handle. Validates + normalises the
-- screen name so clients never write tracked_x_handles directly.
-- ---------------------------------------------------------------------------
create or replace function public.add_tracked_handle(p_screen_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean text;
  v_id    uuid;
begin
  v_clean := lower(regexp_replace(trim(p_screen_name), '^@', ''));

  if v_clean !~ '^[a-z0-9_]{1,15}$' then
    raise exception 'Invalid X handle: %', p_screen_name using errcode = 'check_violation';
  end if;

  insert into public.tracked_x_handles (screen_name)
  values (v_clean)
  on conflict (lower(screen_name)) do update
    set screen_name = excluded.screen_name
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: follow a handle in one call (upsert handle + create feed config).
-- The handle-limit trigger fires on the insert below.
-- ---------------------------------------------------------------------------
create or replace function public.add_feed_configuration(
  p_screen_name      text,
  p_include_retweets boolean default false,
  p_include_replies  boolean default false,
  p_forward_media    boolean default true
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
    (user_id, tracked_handle_id, include_retweets, include_replies, forward_media)
  values
    (auth.uid(), v_handle_id, p_include_retweets, p_include_replies, p_forward_media)
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: set the target WhatsApp channel. Lets a user update only the channel
-- selection (status/credentials remain owned by the gateway worker).
-- ---------------------------------------------------------------------------
create or replace function public.set_whatsapp_channel(
  p_channel_id   text,
  p_channel_name text default null
)
returns public.whatsapp_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.whatsapp_sessions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update public.whatsapp_sessions
     set whatsapp_channel_id   = p_channel_id,
         whatsapp_channel_name = p_channel_name
   where user_id = auth.uid()
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- View: handles with at least one active subscriber. The scraper worker
-- (service_role) polls only these, so dormant handles cost no API calls.
-- ---------------------------------------------------------------------------
create view public.active_tracked_handles
with (security_invoker = true)
as
select h.*
from public.tracked_x_handles h
where exists (
  select 1
  from public.feed_configurations fc
  where fc.tracked_handle_id = h.id
    and fc.is_active
);
