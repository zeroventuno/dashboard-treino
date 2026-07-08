-- Store pace as authoritative text (from Garmin) instead of deriving it from
-- elapsed duration ÷ distance, which lies for interval swims (rest included):
-- 2000m in 47:31 elapsed derives 2:23/100m while Garmin's swim pace is 1:53/100m.
-- planned_pace holds the session target (e.g. '5:50-6:10/km').

alter table workouts
  add column planned_pace text,
  add column actual_pace text,
  alter column actual_duration_min type numeric;
