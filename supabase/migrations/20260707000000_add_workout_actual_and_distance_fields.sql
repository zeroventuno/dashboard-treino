-- A "done" workout must update the SAME row as the originally planned session,
-- not create a second row (that caused duplicate calendar entries for the
-- same day/discipline — one "planned" card from the weekly plan, one "done"
-- card from activity import). These columns let one row hold both:
-- planned_duration_min/planned_distance_km/planned_tss (the plan) alongside
-- actual_duration_min/actual_distance_km/actual_tss (what really happened).

alter table workouts
  add column planned_distance_km numeric,
  add column actual_distance_km numeric,
  add column actual_duration_min integer;
