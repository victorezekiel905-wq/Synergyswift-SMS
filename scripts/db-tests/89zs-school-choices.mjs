// Each school's own rating areas and scale, and its dashboard layout (migration 8400).
export default async function ({ db, q, check, T }) {
  console.log("\nThe school's own ratings and dashboard");
  const tr = "a2400000-0000-0000-0000-000000000001";
  await db.exec(`insert into tenant_settings (tenant_id) values ('${T.A}') on conflict (tenant_id) do nothing;
    insert into trait_definitions (id, tenant_id, domain, name) values ('${tr}', '${T.A}', 'Co-curricular', 'Football');`);
  check("a school can rate its own areas, like Co-curricular", (await q(`select count(*)::int n from trait_definitions where id = '${tr}'`))[0].n === 1);
  await q(`insert into trait_ratings (tenant_id, term_id, student_id, trait_id, rating) values ('${T.A}', 'a5000000-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', '${tr}', 9)`);
  check("…on a scale up to 10", true);
  let bad = false;
  try { await q(`update trait_ratings set rating = 11 where trait_id = '${tr}'`); } catch { bad = true; }
  check("…but not beyond it", bad);
  bad = false;
  try { await q(`insert into trait_definitions (tenant_id, domain, name) values ('${T.A}', 'x', 'Too short')`); } catch { bad = true; }
  check("an area needs a real name", bad);
  const scale = await q(`select jsonb_array_length(trait_scale) n from tenant_settings where tenant_id = '${T.A}'`);
  check("schools start on 1 to 5 in words", scale[0].n === 5, scale);
  bad = false;
  try { await q(`update tenant_settings set trait_scale = '[{"value":1,"short":"1","label":"Only one"}]' where tenant_id = '${T.A}'`); } catch { bad = true; }
  check("a scale needs at least two points", bad);
  await q(`update tenant_settings set dashboard_layout = '{"sections":["now","kpis"],"hidden_stats":[],"hidden_links":[]}' where tenant_id = '${T.A}'`);
  check("the dashboard layout is kept for the school", (await q(`select dashboard_layout->'sections'->>0 s from tenant_settings where tenant_id = '${T.A}'`))[0].s === "now");
  await db.exec(`delete from trait_ratings where trait_id = '${tr}'; delete from trait_definitions where id = '${tr}'; update tenant_settings set dashboard_layout = null where tenant_id = '${T.A}';`);
}
