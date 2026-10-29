-- =========================================================================
-- An index behind every link between tables (Supabase advisor: 813 unindexed
-- foreign keys). Without one, Postgres reads the whole linked table:
--  * whenever a row it points at is deleted or changed (removing one account
--    read about 245 tables in full; one student, about 50), and
--  * on 202 tables, whenever a screen asks for "this school's rows only",
--    because their school column had no index of its own.
-- Generated from the catalogue, so links added later are covered by re-running
-- it. A link already led by an existing index is left alone. Names end in a
-- short hash of the link's name so long table names can't collide.
-- Idempotent. Apply after 20260101008700.
-- =========================================================================
do $$
declare r record; n int := 0;
begin
  for r in
    select n.nspname as sch, t.relname as tbl, c.conname,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
           (select string_agg(a.attname, '_' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as col_names
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid and t.relkind = 'r'
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname in ('public', 'live')
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indpred is null
          and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
          and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey)
  loop
    execute format('create index if not exists %I on %I.%I (%s)',
      left(r.tbl || '_' || r.col_names, 50) || '_fk' || substr(md5(r.conname), 1, 6), r.sch, r.tbl, r.cols);
    n := n + 1;
  end loop;
  raise notice 'indexes added behind % links between tables', n;
end $$;
