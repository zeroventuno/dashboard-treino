-- ────────────────────────────────────────────────────────────────────────────
--  remeasure-zones.sql — re-read imported sessions in the unit they were
--  prescribed in.
--
--  Sessions imported before the metric guard were measured in whatever channel
--  the recording offered richest, not in the unit the coach wrote. A brick run
--  asked for at 6:20-6:40/km was scored by heart rate — 152bpm off a long ride,
--  three zones too hard, 4 out of 100 — when by pace the athlete had done
--  exactly as told.
--
--  Clearing actual_zones costs nothing: they are derived, never typed. The next
--  sync recomputes them, now stamped with the unit they were read in, and
--  nothing else about the session is touched — title, structure, blocks,
--  actual_duration and the coach's own adherence all stay.
--
--  Run in the product project's SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. What is about to be recomputed, and how it was measured. Rows showing
--    metric = null are the ones from before the unit was recorded.
select date, discipline, title,
       actual_zones->>'metric' as measured_in,
       actual_zones
  from workouts
 where external_id like 'strava:%' and actual_zones is not null
 order by date desc;

-- 2. Drop the derived numbers. Only rows the importer wrote are touched: a zone
--    breakdown attached by hand or by the coach's AI has no external_id.
update workouts
   set actual_zones = null
 where external_id like 'strava:%';

-- 3. Rewind the sync window so the next run re-walks the full 45 days instead
--    of the 3-day overlap, and re-fetches the streams it needs.
update app.device_links
   set last_sync_at = null
 where provider = 'strava';

-- 4. Confirm: expect zero rows still carrying zones from the import.
select count(*) as still_scored
  from workouts
 where external_id like 'strava:%' and actual_zones is not null;

-- ────────────────────────────────────────────────────────────────────────────
--  Then press Sincronizar on /app. Streams are capped at 10 per sync to protect
--  the shared Strava allowance, so a deep history takes a few passes — press it
--  again after a minute until `scored` stops rising.
-- ────────────────────────────────────────────────────────────────────────────
