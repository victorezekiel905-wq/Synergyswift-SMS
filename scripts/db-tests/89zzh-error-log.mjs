// The platform error log (migration 11100): one row per kind with a count, an alert the first time
// (and again after a quiet day), and nobody but the server can read or write it.
export default async function ({ q, expectError, expectRows, check, U }) {
  console.log("\nError log for the platform team");
  const rec = async () => (await q(`select record_error('fp-test-1', 'server', 'boom', 'GET /api/x', 'stack') a`))[0].a;
  check("the first time a kind appears, an alert is due", (await rec()) === true);
  check("…not the second time", (await rec()) === false);
  const row = (await q(`select count, source, location from error_events where fingerprint = 'fp-test-1'`))[0];
  check("it is counted once per kind", Number(row.count) === 2 && row.source === "server" && row.location === "GET /api/x", row);
  await q(`update error_events set alerted_at = now() - interval '2 days' where fingerprint = 'fp-test-1'`);
  check("it alerts again if it comes back after a quiet day", (await rec()) === true);
  await expectError("school staff cannot write to it", U.adminA, `select record_error('fp-x', 'server', 'x', null, null)`, /permission denied/);
  await expectError("…or read it", U.adminA, `select count(*) n from error_events`, /permission denied/);
  await q(`delete from error_events where fingerprint = 'fp-test-1'`);
}
