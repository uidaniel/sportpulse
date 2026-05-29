-- SportPulse :: core schema
-- Enums, tables, indexes, and reference data.
-- Multi-tenant isolation is enforced via RLS (see 20260528000003_rls.sql).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.subscription_tier as enum ('free', 'basic', 'pro');

-- Mirrors Stripe subscription.status values plus the local 'free' default flow.
create type public.subscription_status as enum (
  'active', 'trialing', 'past_due', 'canceled',
  'incomplete', 'incomplete_expired', 'unpaid', 'paused'
);

create type public.whatsapp_status as enum (
  'disconnected', 'connecting', 'connected', 'logged_out'
);

create type public.delivery_status as enum ('queued', 'sent', 'failed', 'skipped');

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users, created by trigger on signup)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- plan_limits  (reference data; tunable per tier)
-- ---------------------------------------------------------------------------
create table public.plan_limits (
  tier           public.subscription_tier primary key,
  max_handles    integer not null,
  min_send_delay_ms integer not null default 3000,
  max_send_delay_ms integer not null default 5000
);

-- Anti-ban throttle window (§7) lives here so it is configurable per tier.
insert into public.plan_limits (tier, max_handles) values
  ('free', 1),
  ('basic', 5),
  ('pro', 25);

-- ---------------------------------------------------------------------------
-- subscriptions  (1:1 with user; Stripe-managed via service_role webhook)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null unique references auth.users (id) on delete cascade,
  tier                   public.subscription_tier not null default 'free',
  status                 public.subscription_status not null default 'active',
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- whatsapp_sessions  (1:1 with user; client-readable status + channel choice)
-- Live Baileys credentials are deliberately NOT stored here -> whatsapp_auth_state.
-- ---------------------------------------------------------------------------
create table public.whatsapp_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references auth.users (id) on delete cascade,
  status                public.whatsapp_status not null default 'disconnected',
  phone_jid             text,
  whatsapp_channel_id   text,
  whatsapp_channel_name text,
  last_connected_at     timestamptz,
  last_disconnected_at  timestamptz,
  last_disconnect_reason text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- whatsapp_auth_state  (SERVICE-ROLE ONLY: Baileys creds + signal keys)
-- Key/value store matching Baileys' auth-state contract. RLS is enabled with
-- zero policies so authenticated clients can never read WhatsApp credentials;
-- only the gateway worker (service_role) touches this table.
-- ---------------------------------------------------------------------------
create table public.whatsapp_auth_state (
  session_id uuid not null references public.whatsapp_sessions (id) on delete cascade,
  key        text not null,          -- e.g. 'creds', 'pre-key-42', 'session-<jid>'
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (session_id, key)
);

-- ---------------------------------------------------------------------------
-- tracked_x_handles  (GLOBAL / SHARED across all tenants — cost-control §7)
-- One row per unique X handle. Users reference these via feed_configurations;
-- they never write this table directly (see add_tracked_handle RPC).
-- ---------------------------------------------------------------------------
create table public.tracked_x_handles (
  id                   uuid primary key default gen_random_uuid(),
  screen_name          text not null,
  last_cached_tweet_id text,
  last_polled_at       timestamptz,
  poll_error_count     integer not null default 0,
  created_at           timestamptz not null default now(),
  -- handles are always stored normalised (lowercase, no leading @)
  constraint tracked_x_handles_screen_name_normalised check (screen_name = lower(screen_name))
);

-- Case-insensitive uniqueness guard (writes are pre-lowercased by the RPC).
create unique index tracked_x_handles_screen_name_key
  on public.tracked_x_handles (lower(screen_name));

-- Scraper picks the least-recently-polled handles first.
create index tracked_x_handles_last_polled_idx
  on public.tracked_x_handles (last_polled_at nulls first);

-- ---------------------------------------------------------------------------
-- feed_configurations  (N per user; join to a handle + per-user filters FR-3.2)
-- ---------------------------------------------------------------------------
create table public.feed_configurations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  tracked_handle_id uuid not null references public.tracked_x_handles (id) on delete cascade,
  include_retweets boolean not null default false,
  include_replies  boolean not null default false,
  forward_media    boolean not null default true,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, tracked_handle_id)
);

-- Fan-out lookup: given a handle with a new tweet, find every subscriber.
create index feed_configurations_handle_idx
  on public.feed_configurations (tracked_handle_id)
  where is_active;

create index feed_configurations_user_idx
  on public.feed_configurations (user_id);

-- ---------------------------------------------------------------------------
-- published_messages  (durable send idempotency + delivery audit)
-- The unique (feed_configuration_id, tweet_id) constraint guarantees a tweet
-- is enqueued at most once per channel even if the Redis dedup cache is lost.
-- ---------------------------------------------------------------------------
create table public.published_messages (
  id                    uuid primary key default gen_random_uuid(),
  feed_configuration_id uuid not null references public.feed_configurations (id) on delete cascade,
  tweet_id              text not null,
  status                public.delivery_status not null default 'queued',
  error                 text,
  created_at            timestamptz not null default now(),
  sent_at               timestamptz,
  unique (feed_configuration_id, tweet_id)
);

create index published_messages_feed_idx
  on public.published_messages (feed_configuration_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Documentation for the non-obvious design choices
-- ---------------------------------------------------------------------------
comment on table public.tracked_x_handles is
  'Global pool of X handles shared across all tenants. Aggregating here keeps the third-party scraper to one API call per unique handle (PRD §7 cost control).';
comment on table public.whatsapp_auth_state is
  'Service-role-only Baileys auth store. Never exposed to clients: holds live WhatsApp session credentials.';
comment on table public.published_messages is
  'Durable per-channel send log providing idempotency that survives Redis cache loss.';
