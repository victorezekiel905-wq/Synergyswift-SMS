-- =========================================================================
-- The free library every school has from the start: books that are free and
-- legal to read (public domain or open licences), shared by all schools.
--  * open_books: one row per book from Project Gutenberg (classics, children's
--    books, poetry, history, science, self-help), StoryWeaver (illustrated
--    storybooks), the Open Textbook Library and OpenStax (textbooks).
--    Chosen for schools: only suitable categories, unsuitable words excluded.
--  * It holds no school's data, so every signed-in person may read it; only the
--    platform (service role) loads it, from the owner console.
-- Idempotent. Apply after 20260101009000.
-- =========================================================================
-- The words a book is found by. array_to_string isn't marked immutable, so a generated column can't call it
-- directly; this wrapper only ever depends on its arguments.
create or replace function public.open_books_search_text(p_title text, p_authors text, p_subjects text[])
returns text language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p_title, '') || ' ' || coalesce(p_authors, '') || ' ' || coalesce(array_to_string(p_subjects, ' '), '')
$$;

create table if not exists public.open_books (
  id           text primary key,                       -- 'gutenberg:1342', 'storyweaver:369', 'otl:4', 'openstax:873'
  source       text not null check (source in ('gutenberg', 'storyweaver', 'open_textbook_library', 'openstax')),
  section      text not null check (section in ('textbooks', 'storybooks', 'children', 'fiction', 'poetry', 'history', 'science', 'self_help', 'education', 'arts')),
  title        text not null check (length(title) between 1 and 500),
  authors      text,
  description  text,
  subjects     text[] not null default '{}',
  level        text not null default 'all' check (level in ('early_years', 'primary', 'secondary', 'tertiary', 'all')),
  read_url     text not null check (read_url ~ '^https://'),
  download_url text check (download_url is null or download_url ~ '^https://'),
  cover_url    text check (cover_url is null or cover_url ~ '^https://'),
  licence      text,
  search       tsvector generated always as (to_tsvector('simple'::regconfig, public.open_books_search_text(title, authors, subjects))) stored,
  updated_at   timestamptz not null default now()
);
create index if not exists open_books_search on public.open_books using gin (search);
create index if not exists open_books_section_level on public.open_books (section, level);
create index if not exists open_books_subjects on public.open_books using gin (subjects);

alter table public.open_books enable row level security;
revoke all on public.open_books from anon, authenticated;
grant select on public.open_books to authenticated;
drop policy if exists open_books_read on public.open_books;
create policy open_books_read on public.open_books for select to authenticated using (true);
