-- 11000: an index behind every link between tables added since 8800. Migration 8800 created them for the
-- links that existed then; tables added later (shop codes, account codes, early-years items, stock moves
-- and others) were left without, so looking them up, or deleting what they point at, read whole tables.
-- Found when the whole database was built from one file with every part run once, as on the live
-- database. This re-runs 8800's generator, which skips links that already have one. Safe to run again.
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
