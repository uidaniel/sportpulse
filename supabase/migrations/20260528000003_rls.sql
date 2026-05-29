-- SportPulse :: Row-Level Security
-- Tenant isolation model:
--   * authenticated users see/write ONLY rows where user_id = auth.uid()
--   * billing + WhatsApp status + handle polling are written by service_role
--     workers (which bypass RLS), never by clients
--   * whatsapp_auth_state has RLS enabled with NO policies -> clients get nothing

alter table public.profiles            enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.plan_limits         enable row level security;
alter table public.whatsapp_sessions   enable row level security;
alter table public.whatsapp_auth_state enable row level security;
alter table public.tracked_x_handles   enable row level security;
alter table public.feed_configurations enable row level security;
alter table public.published_messages  enable row level security;

-- ---------------------------------------------------------------------------
-- profiles : owner read + update
-- ---------------------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- subscriptions : owner read-only (writes are Stripe-webhook/service_role)
-- ---------------------------------------------------------------------------
create policy "subscriptions_select_own" on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- plan_limits : public reference data, read-only for any signed-in user
-- ---------------------------------------------------------------------------
create policy "plan_limits_select_all" on public.plan_limits
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- whatsapp_sessions : owner read-only (channel set via set_whatsapp_channel
-- RPC; status/creds written by the gateway worker via service_role)
-- ---------------------------------------------------------------------------
create policy "whatsapp_sessions_select_own" on public.whatsapp_sessions
  for select to authenticated using (user_id = auth.uid());

-- whatsapp_auth_state : intentionally NO policies (service_role only).

-- ---------------------------------------------------------------------------
-- tracked_x_handles : read-only reference for clients; writes via RPC/worker
-- ---------------------------------------------------------------------------
create policy "tracked_handles_select_all" on public.tracked_x_handles
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- feed_configurations : full owner CRUD
-- ---------------------------------------------------------------------------
create policy "feed_configs_select_own" on public.feed_configurations
  for select to authenticated using (user_id = auth.uid());

create policy "feed_configs_insert_own" on public.feed_configurations
  for insert to authenticated with check (user_id = auth.uid());

create policy "feed_configs_update_own" on public.feed_configurations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "feed_configs_delete_own" on public.feed_configurations
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- published_messages : owner read-only (writes by the fan-out worker)
-- ---------------------------------------------------------------------------
create policy "published_messages_select_own" on public.published_messages
  for select to authenticated using (
    exists (
      select 1 from public.feed_configurations fc
      where fc.id = published_messages.feed_configuration_id
        and fc.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Function execute grants: lock down RPCs to signed-in users only
-- ---------------------------------------------------------------------------
revoke execute on function public.add_tracked_handle(text)              from public, anon;
revoke execute on function public.add_feed_configuration(text, boolean, boolean, boolean) from public, anon;
revoke execute on function public.set_whatsapp_channel(text, text)      from public, anon;

grant execute on function public.add_tracked_handle(text)               to authenticated;
grant execute on function public.add_feed_configuration(text, boolean, boolean, boolean)  to authenticated;
grant execute on function public.set_whatsapp_channel(text, text)       to authenticated;

-- ---------------------------------------------------------------------------
-- active_tracked_handles view : scraper-only (service_role); hide from clients
-- ---------------------------------------------------------------------------
revoke all on public.active_tracked_handles from anon, authenticated;
