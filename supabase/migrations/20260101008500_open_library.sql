-- =========================================================================
-- Synergy Swift: the free library collection (phase 14q).
--  Library books can carry a download link, their licence, the levels and
--  curricula they suit, and the key of the free collection item they came
--  from, so adding the collection twice never makes duplicates.
-- Idempotent. Apply after 20260101008400.
-- =========================================================================

alter table public.library_books add column if not exists download_url text check (download_url is null or download_url ~ '^https://');
alter table public.library_books add column if not exists licence text check (licence is null or length(licence) <= 80);
alter table public.library_books add column if not exists levels text check (levels is null or length(levels) <= 120);
alter table public.library_books add column if not exists curricula text[] not null default '{}';
alter table public.library_books add column if not exists source_key text check (source_key is null or length(source_key) <= 80);
create unique index if not exists library_books_source_key on public.library_books(tenant_id, source_key) where source_key is not null;
