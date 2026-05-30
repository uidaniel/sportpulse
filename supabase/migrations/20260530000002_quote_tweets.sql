-- Quote-tweet support: per-feed toggle for including quote tweets, plus pull-
-- through of the quoted tweet's text + media into the message body.

alter table public.feed_configurations
  add column include_quotes boolean not null default true;

-- Update add_feed_configuration to accept the new flag.
drop function if exists public.add_feed_configuration(text, uuid[], boolean, boolean, boolean, boolean, boolean);

create or replace function public.add_feed_configuration(
  p_screen_name      text,
  p_channel_ids      uuid[] default '{}'::uuid[],
  p_include_retweets boolean default false,
  p_include_replies  boolean default false,
  p_forward_media    boolean default true,
  p_include_videos   boolean default false,
  p_exclude_links    boolean default false,
  p_include_quotes   boolean default true
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

  insert into public.feed_configurations
    (user_id, tracked_handle_id, channel_id,
     include_retweets, include_replies, forward_media, include_videos, exclude_links, include_quotes)
  values
    (auth.uid(), v_handle_id, p_channel_ids[1],
     p_include_retweets, p_include_replies, p_forward_media, p_include_videos, p_exclude_links, p_include_quotes)
  returning * into v_row;

  foreach v_ch in array p_channel_ids loop
    insert into public.feed_channel_routes (feed_configuration_id, channel_id)
    values (v_row.id, v_ch)
    on conflict do nothing;
  end loop;

  return v_row;
end;
$$;

revoke execute on function public.add_feed_configuration(text, uuid[], boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant  execute on function public.add_feed_configuration(text, uuid[], boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
