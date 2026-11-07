// Lockdown in live lessons follows the school's modules (migration 9300): schools with
// Live lessons have it, as they did in SwiftCipher, and the platform can switch it off.
export default async function ({ db, q, check, T }) {
  console.log("\nLive lesson lockdown follows the school's modules");
  const mon = async () => (await q(`select monitoring_enabled from live.tenant_settings where tenant_id = '${T.A}'`))[0]?.monitoring_enabled;
  const before = (await q(`select modules from tenants where id = '${T.A}'`))[0].modules;

  check("a school with Live lessons has lockdown", (await mon()) === true);

  await db.exec(`update tenants set modules = coalesce(modules, '{}'::jsonb) || '{"live_monitoring": false}' where id = '${T.A}'`);
  check("the platform can switch lockdown off for one school", (await mon()) === false);
  check("…and that school keeps Live lessons", (await q(`select status from live.tenants where id = '${T.A}'`))[0].status === "active");

  await db.exec(`update tenants set modules = coalesce(modules, '{}'::jsonb) - 'live_monitoring' where id = '${T.A}'`);
  check("left unset again, it follows Live lessons (on)", (await mon()) === true);

  await db.exec(`update tenants set modules = coalesce(modules, '{}'::jsonb) || '{"live": false}' where id = '${T.A}'`);
  check("without Live lessons there is no lockdown either", (await mon()) === false);

  check("another school is not affected", (await q(`select monitoring_enabled from live.tenant_settings where tenant_id = '${T.B}'`))[0]?.monitoring_enabled === true);

  await db.exec(`update tenants set modules = '${JSON.stringify(before ?? {})}'::jsonb where id = '${T.A}'`);
  check("restored, the school has lockdown again", (await mon()) === true);
}
