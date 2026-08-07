-- ────────────────────────────────────────────────────────────────────────────
--  add-athlete-preferences.sql — where an athlete's training constraints live.
--
--  "Build next week for everyone in Build, respecting each athlete's
--  preferences" was impossible to honour: the profile stored devices, metrics,
--  mode, language, units and body figure — nothing about which days they can
--  actually train, how much time they have, or what equipment they reach.
--
--  Without a home for it, the coach has to repeat those constraints in every
--  chat. That works at thirty athletes and collapses at two hundred, which is
--  precisely the scale this product exists to unlock. A stateless AI can infer
--  training days from history, but it can never infer "no Tuesdays, I have
--  class" or "pool is 25m" — those are facts only the athlete knows.
--
--  jsonb rather than columns so the shape can grow (a coach will invent
--  constraints we haven't thought of) without a migration each time.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

alter table profiles add column if not exists preferences jsonb not null default '{}';

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name = 'preferences';
