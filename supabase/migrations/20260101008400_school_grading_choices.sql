-- =========================================================================
-- Synergy Swift: each school decides how it rates the whole child, and how
-- its head's dashboard looks.
--  - Rating areas are the school's own (Character, Skills, Effort,
--    Co-curricular, Sports, Clubs…), not just affective and psychomotor.
--  - The rating scale is the school's own: 1–5 with words, A–E, 1–10, or its
--    own labels (tenant_settings.trait_scale), up to 10 points.
--  - tenant_settings.dashboard_layout: which panels the school overview shows,
--    in what order.
-- Idempotent. Apply after 20260101008300.
-- =========================================================================

alter table public.trait_definitions drop constraint if exists trait_definitions_domain_check;
alter table public.trait_definitions drop constraint if exists trait_definitions_domain_len;
alter table public.trait_definitions add constraint trait_definitions_domain_len check (length(btrim(domain)) between 2 and 40);

alter table public.trait_ratings drop constraint if exists trait_ratings_rating_check;
alter table public.trait_ratings drop constraint if exists trait_ratings_rating_range;
alter table public.trait_ratings add constraint trait_ratings_rating_range check (rating between 1 and 10);

-- [{ "value": 5, "short": "5", "label": "Excellent" }, …] from the best rating down.
alter table public.tenant_settings add column if not exists trait_scale jsonb not null default
  '[{"value":5,"short":"5","label":"Excellent"},{"value":4,"short":"4","label":"Very good"},{"value":3,"short":"3","label":"Good"},{"value":2,"short":"2","label":"Fair"},{"value":1,"short":"1","label":"Needs improvement"}]'::jsonb;
alter table public.tenant_settings drop constraint if exists tenant_settings_trait_scale_shape;
alter table public.tenant_settings add constraint tenant_settings_trait_scale_shape check (jsonb_typeof(trait_scale) = 'array' and jsonb_array_length(trait_scale) between 2 and 10);

alter table public.tenant_settings add column if not exists dashboard_layout jsonb;
