-- ────────────────────────────────────────────────────────────────────────────
--  add-workout-adherence.sql — a 0-100 "how close to the plan was it actually
--  done" score per workout. The coach can set it (their judgment — e.g. an
--  athlete who did 60 min of something completely different scores low even if
--  the duration matched); if left null, the dashboard estimates it from actual
--  vs planned duration/TSS/distance. Shown as a donut in the workout modal and
--  averaged in the weekly box.
--
--  Run once in the product project's SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

alter table workouts add column if not exists adherence int;

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'workouts' and column_name = 'adherence';
