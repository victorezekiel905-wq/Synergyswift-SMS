-- 9500: typed answers in live lessons are compared the way exams compare them.
--
-- A fill-in-the-blank answer of "Paris." or ‘Paris’ was marked wrong against "Paris":
-- only spaces and capitals were ignored. Now curly quotes count as straight ones, and
-- quotes around the answer and punctuation at the end (. , ; : ! ?) are ignored too,
-- the same as short answers and blanks in exams (lib/exams/engine.ts normAnswer).
-- Safe to run more than once.

create or replace function live_app.normalize_text(p text, p_case_sensitive boolean default false) returns text
language sql immutable set search_path = '' as $$
  with a as (
    select regexp_replace(btrim(translate(coalesce(p, ''), '‘’`´“”' || chr(160), repeat(chr(39), 4) || '""' || ' ')), '\s+', ' ', 'g') as x
  ), b as (
    select case when p_case_sensitive then x else lower(x) end as x from a
  ), c as (
    select regexp_replace(x, '^["'']+|["'']+$', '', 'g') as x from b
  ), d as (
    select regexp_replace(x, '\s*[.,;:!?]+$', '') as x from c
  )
  select btrim(regexp_replace(x, '^["'']+|["'']+$', '', 'g')) from d
$$;
