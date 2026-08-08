-- Alerto — Computer Vision Fatigue Monitor
-- Run this in Supabase's SQL Editor (Project → SQL Editor → New query → Run).
-- Safe to re-run: every statement is idempotent.
-- Mirrors the current localStorage data model in src/lib/types.ts exactly,
-- so the app-side migration is a lift-and-shift, not a redesign.

create extension if not exists pgcrypto;

-- Each row is one agent's *current* session/presence state — same shape as
-- the AgentSession the app already keeps in localStorage today.
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  station_id text not null,
  password text not null default 'password123',
  login_time timestamptz not null default now(),
  status text not null default 'offline'
    check (status in ('standby', 'on_call', 'drowsy', 'fatigue_alert', 'offline', 'logged_out')),
  call_session_id text,
  ear real not null default 0,
  blink_freq real not null default 0,
  head_pos real not null default 0,
  fatigue_score real not null default 0,
  total_calls int not null default 0,
  total_incidents int not null default 0,
  updated_at timestamptz not null default now()
);

-- Ensure existing database instances get the password column, updated check constraint, and default offline status
alter table agents add column if not exists password text not null default 'password123';
alter table agents drop constraint if exists agents_status_check;
alter table agents drop constraint if exists agents_status_check1;
alter table agents drop constraint if exists agents_status_check2;

-- Re-create clean check constraint allowing offline and logged_out
alter table agents add constraint agents_status_check 
  check (status in ('standby', 'on_call', 'drowsy', 'fatigue_alert', 'offline', 'logged_out'));

-- Set default column value to 'offline'
alter table agents alter column status set default 'offline';

-- Seed initial authorized agents as offline by default
insert into agents (id, name, station_id, password, status)
values
  ('11111111-1111-1111-1111-111111111111', 'Jeoffrey', 'Station-50', 'password123', 'offline'),
  ('22222222-2222-2222-2222-222222222222', 'gegeg', 'Station-32', 'password123', 'offline'),
  ('33333333-3333-3333-3333-333333333333', 'Agent Smith', 'Station-01', 'password123', 'offline')
on conflict (id) do update set status = excluded.status, password = excluded.password;

-- One row per fatigue alert — matches the flowchart's "Trigger Alert & Log
-- Incident → Save to Database" step.
create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  agent_name text not null,
  station_id text not null,
  occurred_at timestamptz not null default now(),
  alert_details text not null,
  call_session_id text not null,
  ear real not null,
  blink_freq real not null,
  head_pos real not null
);

-- Rolling fatigue-score samples, feeding the supervisor Fatigue Trend chart.
create table if not exists score_samples (
  id bigint generated always as identity primary key,
  agent_id uuid not null references agents(id) on delete cascade,
  sampled_at timestamptz not null default now(),
  score real not null
);

-- Single-row counter for "Total Monitored Calls" on the Shift Summary panel.
create table if not exists shift_stats (
  id int primary key default 1,
  calls_started int not null default 0,
  constraint shift_stats_single_row check (id = 1)
);
insert into shift_stats (id, calls_started)
  values (1, 0)
  on conflict (id) do nothing;

-- Authorized supervisor accounts table.
create table if not exists supervisors (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password text not null default 'admin123',
  name text not null,
  created_at timestamptz not null default now()
);

-- Seed initial default supervisor account
insert into supervisors (username, password, name)
values ('admin', 'admin123', 'Supervisor Admin')
on conflict (username) do nothing;

create index if not exists incidents_agent_id_idx on incidents (agent_id);
create index if not exists score_samples_agent_id_sampled_at_idx on score_samples (agent_id, sampled_at);

-- Atomic counter bump — avoids a read-modify-write race if two agents start
-- calls at the same instant.
create or replace function increment_calls_started()
returns void
language sql
set search_path = public, pg_temp
as $$
  update shift_stats set calls_started = calls_started + 1 where id = 1;
$$;

-- Row Level Security. This is a thesis prototype without per-account auth
-- boundaries yet (any Agent ID / password is accepted, matching the current
-- app), so policies are permissive for the anon key rather than scoped to
-- auth.uid(). Tightening this to real per-agent auth is future work, not a
-- blocker for the pilot.
alter table agents enable row level security;
alter table incidents enable row level security;
alter table score_samples enable row level security;
alter table shift_stats enable row level security;
alter table supervisors enable row level security;

drop policy if exists "agents_all" on agents;
create policy "agents_all" on agents for all using (true) with check (true);

drop policy if exists "incidents_all" on incidents;
create policy "incidents_all" on incidents for all using (true) with check (true);

drop policy if exists "score_samples_all" on score_samples;
create policy "score_samples_all" on score_samples for all using (true) with check (true);

drop policy if exists "shift_stats_all" on shift_stats;
create policy "shift_stats_all" on shift_stats for all using (true) with check (true);

drop policy if exists "supervisors_all" on supervisors;
create policy "supervisors_all" on supervisors for all using (true) with check (true);

-- Realtime: broadcast row changes so the agent + supervisor pages can
-- subscribe instead of polling (replaces the current BroadcastChannel hack,
-- which only ever worked within one browser).
do $$
begin
  alter publication supabase_realtime add table agents;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table incidents;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table score_samples;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table shift_stats;
exception when duplicate_object then null;
end $$;
