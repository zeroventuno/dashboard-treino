-- Bike power (free text — e.g. "150-158W", "254W avg / 290W max").
-- Created via the coach MCP session; recorded here so the repo mirrors the
-- live schema. Shown as a "Power" row in the workout modal's planned/actual
-- comparison table (naturally bike-only, since the row hides when both null).
alter table workouts
  add column if not exists planned_power_watts text,
  add column if not exists actual_power_watts text;
