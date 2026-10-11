-- ────────────────────────────────────────────────────────────────────────────
--  add-device-link-meta.sql — provider-specific facts about a device link.
--
--  The COROS connection needs two things the Strava-shaped row has no home for:
--  which regional cluster the athlete's account lives on (EU / US — a COROS
--  account belongs to exactly one, and the token only works there), and the
--  OAuth client_id that COROS issued when TRAKR registered itself — the refresh
--  grant has to present it again.
--
--  A jsonb column rather than two new text ones: the next provider (Garmin,
--  Polar, Whoop) will have its own two or three such facts, and the table
--  shouldn't grow a column per provider's quirks.
--
--  Nothing secret goes in here. Tokens stay in their own columns.
--
--  The app_writer grant on app.device_links is table-wide already
--  (add-device-links.sql), so no new grant is needed.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

alter table app.device_links add column if not exists meta jsonb;

select
  (select count(*) from information_schema.columns
    where table_schema = 'app' and table_name = 'device_links'
      and column_name = 'meta') as meta_column_present;
