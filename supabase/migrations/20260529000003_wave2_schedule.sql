-- Wave 2: Pro quiet-hours / active-window scheduling.

-- Tier permission (Pro only).
alter table public.plan_limits add column allow_scheduling boolean not null default false;
update public.plan_limits set allow_scheduling = true where tier = 'pro';

-- Per-user active posting window. Outside the window, the scraper holds posts
-- (as delayed jobs) and releases them when the window reopens.
alter table public.profiles
  add column timezone         text    not null default 'UTC',
  add column schedule_enabled boolean not null default false,
  add column schedule_start   time    not null default '00:00',
  add column schedule_end     time    not null default '23:59';

comment on column public.profiles.schedule_enabled is
  'When true (Pro only), posts only deliver within [schedule_start, schedule_end] in the user timezone; off-hours posts are held until the window reopens.';
