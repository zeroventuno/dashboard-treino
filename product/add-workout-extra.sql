-- ────────────────────────────────────────────────────────────────────────────
--  add-workout-extra.sql — flag for unscheduled sessions. A workout marked
--  `extra` counts in the week's DONE volume (time/distance/TSS) but not in the
--  plan's x/y adherence — so an athlete's spontaneous extra ride shows up in the
--  totals without inflating "how much of the plan did you complete".
--
--  (The new statuses cancelled/moved need no migration — `status` is already
--  free text.) Run once in the product project's SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

alter table workouts add column if not exists extra boolean not null default false;

select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'workouts' and column_name = 'extra';
