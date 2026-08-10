-- ────────────────────────────────────────────────────────────────────────────
--  undo-strava-import.sql — remove the duplicate sessions a Strava sync added.
--
--  Why they exist: the importer only claimed workouts still sitting at
--  `planned` or `skipped`. On a real account almost nothing is — the athlete or
--  their AI marks each session done as it happens — so every imported activity
--  landed BESIDE the session it was, flagged `extra`, and the week showed
--  everything twice. Fixed in importWorkouts, which now also claims `done`.
--
--  This only deletes rows that Strava itself created: external_id starting
--  'strava:' AND extra = true. Anything the athlete or the coach wrote has no
--  external_id and is never touched. Sessions the importer correctly claimed —
--  a planned workout that was ticked off — carry an external_id but are NOT
--  `extra`, so they survive too, keeping their title, structure and blocks.
--
--  Re-syncing afterwards is safe and is the point: the fixed matcher lands the
--  same activities onto the sessions already on the calendar.
--
--  Run in the product project's SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Look before deleting. Expect these to be sessions you already had.
select date, discipline, title, status, extra, external_id, actual_duration_min
  from workouts
 where external_id like 'strava:%' and extra is true
 order by date desc, discipline;

-- 2. How many, and over what range.
select count(*) as duplicates, min(date) as from_date, max(date) as to_date
  from workouts
 where external_id like 'strava:%' and extra is true;

-- 3. Delete them. Nothing here was written by hand: every one of these rows was
--    created by the import as a session nobody had planned.
delete from workouts
 where external_id like 'strava:%' and extra is true;

-- 4. What the import legitimately claimed — these stay, and should look like
--    your own workouts with real numbers attached.
select date, discipline, title, status, actual_duration_min, actual_zones is not null as has_zones
  from workouts
 where external_id like 'strava:%'
 order by date desc;

-- 5. Optional — start the next sync from scratch instead of the 3-day overlap,
--    so it re-walks the full 45 days and re-claims everything properly.
update app.device_links set last_sync_at = null where provider = 'strava';
