-- IRONMAN 70.3 Costa Navarino — training dashboard schema

create table training_load (
  date date primary key,
  tss numeric,
  ctl numeric,
  atl numeric,
  tsb numeric,
  source text
);

create table workouts (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  discipline text not null,
  title text not null,
  description text,
  garmin_instructions text,
  zwo_content text,
  status text default 'planned',
  planned_duration_min int,
  planned_tss numeric,
  actual_tss numeric,
  notes text,
  created_at timestamptz default now()
);
create index workouts_date_idx on workouts (date);

create table phases (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  focus text,
  color text
);

create table performance_milestones (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  metric text not null,
  value numeric,
  unit text,
  notes text
);

create table performance_indicators (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz default now(),
  ftp_watts numeric,
  bike_zones jsonb,
  run_pace_zones jsonb,
  swim_pace_per_100m text,
  run_threshold_pace text,
  cadence_run_target int,
  hr_zones jsonb
);

create table strength_sessions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  muscle_groups text[] not null,
  exercises jsonb,
  notes text
);

create table checkins (
  date date primary key,
  hrv numeric,
  sleep_hours numeric,
  readiness_score int,
  body_battery int,
  resting_hr int,
  recommendation text,
  notes text
);

create table injury_log (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  area text not null,
  severity int,
  notes text
);

-- Lock down: app + chat use the service-role key (bypasses RLS); no public access.
alter table training_load enable row level security;
alter table workouts enable row level security;
alter table phases enable row level security;
alter table performance_milestones enable row level security;
alter table performance_indicators enable row level security;
alter table strength_sessions enable row level security;
alter table checkins enable row level security;
alter table injury_log enable row level security;
