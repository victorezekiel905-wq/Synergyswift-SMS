-- =========================================================================
-- More textbooks in the free library: LibreTexts (open textbooks across every
-- subject, including its K-12 library) and finished Wikibooks.
-- Idempotent. Apply after 20260101009100.
-- =========================================================================
alter table public.open_books drop constraint if exists open_books_source_check;
alter table public.open_books add constraint open_books_source_check
  check (source in ('gutenberg', 'storyweaver', 'open_textbook_library', 'openstax', 'libretexts', 'wikibooks'));
