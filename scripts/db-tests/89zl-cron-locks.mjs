// 20,000-user report, finding 5: one scheduled run at a time, and a crashed run never blocks for long.
export default async function ({ db, q, expectError, check, U }) {
  console.log("\nScheduler: one run at a time");
  const first = await q(`select public.take_cron_lock('test-job', 60) run`);
  check("the first run takes the lock", Boolean(first[0]?.run), first);
  const second = await q(`select public.take_cron_lock('test-job', 60) run`);
  check("a second run while the first is going steps aside", second[0]?.run === null, second);
  const other = await q(`select public.take_cron_lock('other-job', 60) run`);
  check("…other jobs have their own lock", Boolean(other[0]?.run), other);
  await q(`select public.release_cron_lock('test-job', '00000000-0000-0000-0000-000000000000')`);
  const still = await q(`select public.take_cron_lock('test-job', 60) run`);
  check("only the run holding the lock can free it", still[0]?.run === null, still);
  await q(`select public.release_cron_lock('test-job', '${first[0].run}')`);
  const next = await q(`select public.take_cron_lock('test-job', 60) run`);
  check("when the run finishes, the next one starts", Boolean(next[0]?.run) && next[0].run !== first[0].run, next);
  await db.exec(`update cron_locks set locked_until = now() - interval '1 second' where key = 'test-job'`);
  const after = await q(`select public.take_cron_lock('test-job', 60) run`);
  check("a lock left by a crashed run expires by itself", Boolean(after[0]?.run), after);
  const done = await q(`select last_started is not null s from cron_locks where key = 'test-job'`);
  check("…and the start time is kept for the health panel", done[0]?.s === true, done);
  await expectError("schools can't take the scheduler's locks", U.adminA, `select public.take_cron_lock('dispatch', 60)`, /permission denied/);
  await expectError("…or read them", U.adminA, `select count(*) from cron_locks`, /permission denied/);
  await db.exec(`delete from cron_locks where key in ('test-job', 'other-job')`);
}
