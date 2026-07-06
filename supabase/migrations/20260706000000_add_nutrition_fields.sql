-- Nutrition tracking: hydration/protein check-in fields, per-workout nutrition
-- notes, and a daily meal plan + duration-based nutrition rule matrix.

alter table checkins
  add column hydration_liters numeric,
  add column whey_shakes integer,
  add column protein_grams_estimate numeric;

alter table workouts
  add column nutrition_notes text;

create table daily_meal_plan (
  id uuid primary key default gen_random_uuid(),
  meal_order integer not null,
  meal_name text not null,
  time_suggestion text,
  foods text,
  protein_g numeric,
  carbs_g numeric,
  notes text
);

create table nutrition_plan (
  id uuid primary key default gen_random_uuid(),
  duration_category text not null, -- 'curto' | 'medio' | 'longo' | 'muito_longo'
  duration_range text,
  discipline_context text,
  before_training text,
  during_training text,
  after_training text,
  supplements_used text[],
  notes text
);

alter table daily_meal_plan enable row level security;
alter table nutrition_plan enable row level security;
