-- ────────────────────────────────────────────────────────────────────────────
--  Workout modal v2 — the fields the redesigned modal needs.
--  Run in the PRODUCT project's SQL Editor. Additive: existing rows get NULLs
--  and the UI hides any section that's empty, so nothing breaks meanwhile.
-- ────────────────────────────────────────────────────────────────────────────

alter table workouts
  -- Structured interval blocks — what powers the block list + chart.
  -- [{ "label": "Aquecimento", "duration_min": 10, "intensity": 55,
  --    "target": "102-136W", "note": "progressivo" }, …]
  --   intensity = 0-100+ (% of threshold) → only used to scale the chart bars.
  --   target    = free text shown to the athlete (watts, pace, HR, RPE…).
  add column if not exists structure        jsonb,

  -- Pre-workout
  add column if not exists activation       text,   -- drills, mobility, warm-up routine
  add column if not exists nutrition_pre    text,

  -- Post-workout
  add column if not exists mobility         text,   -- stretching / cool-down
  add column if not exists nutrition_post   text,

  -- The week's priority sessions — highlighted in the calendar so the athlete
  -- can see at a glance which ones must not be skipped.
  add column if not exists key_workout      boolean not null default false;

comment on column workouts.structure is
  'Interval blocks: [{label, duration_min, intensity(0-100+, %threshold), target(text), note}]';

-- Note: the existing `nutrition_notes` stays as-is (general fueling guidance).
-- nutrition_pre / nutrition_post are the split, more actionable versions; the
-- modal shows whichever exist.
