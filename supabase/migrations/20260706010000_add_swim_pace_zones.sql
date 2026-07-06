-- Dedicated swim pace-zone table (Z1-Z5 pace ranges), analogous to bike_zones /
-- run_pace_zones. Previously swim_pace_per_100m (a single text value) was the
-- only swim field, which led to zone ranges being crammed into it as free text.

alter table performance_indicators add column swim_pace_zones jsonb;
