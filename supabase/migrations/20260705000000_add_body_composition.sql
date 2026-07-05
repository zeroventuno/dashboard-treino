-- Bioimpedance / body-composition measurements over time

create table body_composition (
  date date primary key,
  weight_kg numeric,
  muscle_mass_kg numeric,
  body_fat_pct numeric,
  lean_mass_kg numeric,
  visceral_fat numeric,
  metabolic_age int,
  notes text
);

alter table body_composition enable row level security;
