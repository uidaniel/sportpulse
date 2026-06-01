-- The scraper inserts (feed, tweet, channel_id, status) and relies on the
-- trigger to backfill target_jid from channel_id. Generated TS types, though,
-- mark target_jid as required for INSERT since it's NOT NULL with no default.
-- Adding an empty-string default keeps the column non-null AND lets supabase-js
-- generated types treat it as optional. The trigger now also overwrites empty
-- strings so this stays a no-op for any insert path that omits the field.

alter table public.published_messages alter column target_jid set default '';

create or replace function public.set_published_messages_target_jid()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.target_jid is null or new.target_jid = '') and new.channel_id is not null then
    select channel_jid into new.target_jid
    from public.whatsapp_channels
    where id = new.channel_id;
  end if;
  return new;
end;
$$;
