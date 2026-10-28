# Synergy Swift at 20,000 users: test results and an honest verdict

Phase 14m, 28 October 2026. Branch `full-spec`.

## Verdict

**Not ready for 20,000 users today. Ready after four fixes, one of which is already done.**

Before this test, a parent opening their child's attendance in a group of ten 2,000-account
schools would have waited **about 33 seconds**, and the head's 30-day attendance dashboard
**about 26 seconds**. The database checked every school's rows one by one against the
permission rules. That is fixed (migration `20260101007400`): the same pages now answer in
**4–60 ms**. The other three blockers are configuration and hosting, not code:

1. Supabase returns at most **1,000 rows** per request by default, and 68 places in the code
   ask for more. Reports for big schools are silently cut short.
2. The app runs on **one Render Starter instance (half a CPU, 512 MB)**. It will not carry a
   results-day rush for 20,000 accounts.
3. Nothing has yet been run against a real copy of the system under load (no staging project
   exists). The numbers below come from the database alone.

## What was tested, and what was not

| Tested | How |
|---|---|
| The whole database (all 77 migrations) with **20,000 accounts**: 10 schools, each 1,400 students, 500 parents, 100 staff, 30 classes, 20 days of attendance (280,000 rows), 140,000 gate sign-ins, report cards, invoices, 50,000 change-history entries | `scripts/load/scale-bench.mjs`: in-memory Postgres (PGlite), each query run 7 times as a real signed-in parent, student, teacher or admin with row-level security on |
| Who can see what, after the speed-up | the full database test suite: **1,717 permission and behaviour checks pass** |
| The code, for patterns that break at scale | review of every server route and the scheduler |

| **Not** tested (and why) | What it needs |
|---|---|
| 20,000 people using the real app at once (network, Next.js server, Supabase Auth, Realtime) | a staging Supabase project and a staging Render service; the k6 script is ready (`scripts/load/k6-school-day.js`) |
| Browser journeys per role (Playwright) | the same staging accounts; not written yet |
| The live database | deliberately not touched: load tests on the live project would slow real schools |

PGlite is single-threaded WebAssembly, so its times are slower than Supabase's. The **ratios**
and the **query plans** carry over; the absolute milliseconds will be lower in production.

## Finding 1 — Critical, fixed: permission checks ran once per row

Every table's rule said "this row's school is `my_tenant_id()`", and Postgres called that
function, and checks like "is this my child?", for **every row of every school**, before
filtering. Fine with test data; catastrophic at scale.

| Query (20,000 accounts) | Before | After |
|---|---:|---:|
| Parent: my children's attendance this month | 32,589 ms | **38 ms** |
| Admin: 30-day attendance dashboard | 25,861 ms | **17 ms** |
| Teacher: my classes' attendance this week | 10,773 ms | **59 ms** |
| Admin: change history (latest 50) | 5,635 ms | **3 ms** |
| Parent: my children's report cards | 1,428 ms | **6 ms** |
| Student: my report card | 1,339 ms | **6 ms** |
| Admin: today's attendance summary | 1,317 ms | **2 ms** |
| Admin: count one school's attendance (rules on) vs a plain filter | 25,756 vs 34 ms | **10 vs 7 ms** |
| Super admin: customer health across all schools | 552 ms | 304 ms |

The fix (migration `20260101007400_rls_performance.sql`) rewrites every policy so each check
runs **once per query**, turns "is this my child / my own record / a student I teach" into a
list worked out once, and adds indexes for the busiest reads. Same rules, same answers: the
permission suite passes unchanged.

## Finding 2 — Critical, configuration: reports silently cut at 1,000 rows

Supabase's API returns at most 1,000 rows per request unless the project says otherwise. **68
files** ask for up to 50,000 (group console attendance, staff attendance, payroll time, exports,
the super admin centre). For a 1,400-student school these quietly use the first 1,000 rows:
wrong percentages, short CSVs, nobody warned.

**Fix today (2 minutes):** Supabase → Project Settings → API → **Max rows: 50000**. Then, over
time, move the big exports to the paging helper (`fetchAll`) the results module already uses.

## Finding 3 — Critical, hosting: one small server

`render.yaml` runs the web app on **Starter (0.5 CPU, 512 MB), one instance**. Every page and API
call, every scheduler run and every PDF goes through it. A results day (thousands of parents in
an hour) or a CBT paper for 1,500 students saving every 20 seconds will queue requests and time
out. Starter is fine for a pilot of one or two schools.

**Fix:** Render **Standard (1 CPU, 2 GB) with 2 instances** at minimum for 20,000 accounts, and
autoscaling (Pro) before the first big results day. Supabase **Pro** with the compute add-on
sized from the staging test (start at Small or Medium).

## Finding 4 — High: every request asks Supabase Auth who you are

Each API call verifies the session by calling Supabase Auth over the network, then loads the
user, the school and any custom role: 3–4 round trips (about 100–250 ms in production) before any
work. At 20,000 users this doubles response times and leans on Auth's rate limits.

**Fix:** verify the session token locally (Supabase JWT signing keys and `getClaims`), and cache
the user/school lookup for a few seconds per instance.

## Finding 5 — High: the every-minute scheduler does 19 jobs in one request

Messages, bus checks, billing, entrance automation, support expiry and more all run in one call
every minute, with no lock. With many schools a run will take longer than a minute and the next
one starts on top of it (most jobs tolerate this, but it wastes the server and can double some
alerts).

**Fix:** a database advisory lock around the run, and split the slow jobs (billing, entrance,
account automation) into their own every-5-minutes endpoint.

## Finding 6 — High: live lessons and Realtime

Live lessons and games use Supabase Realtime. Supabase plans include a limited number of
concurrent Realtime connections (Pro includes 500 peak; more is billed). A school group running
50 lessons at once is 1,500+ connections.

**Fix:** set the Realtime quota for expected peak lessons, and show teachers a "live lessons are
busy" message rather than a frozen screen.

## Finding 7 — Medium

- **Super admin "customer health"** recounts every school's history each time (300–550 ms for
  10 schools; seconds for hundreds). Store it nightly.
- **Rate limits and caches live in each server's memory** (sign-in device checks, slow-call
  recording). With several instances they are per instance. Acceptable now; move to the
  database or Redis when scaling out.
- **Some alerts send one message at a time** in a loop (bus approaching, trip parents). Fine at
  this size; batch them before 100+ schools.
- **Photos and files** are served from Supabase Storage with short signed links: watch egress on
  results and portfolio days.

## What to do, in order

| # | Action | Who | Effort |
|---|---|---|---|
| 1 | Run `supabase/updates/RUN_THIS_UPDATE.sql` on the live database (includes the speed-up) | you, or me once Supabase is reconnected | 10 minutes |
| 2 | Supabase → API → Max rows: 50000 | you | 2 minutes |
| 3 | Render: Standard plan, 2 instances; Supabase Pro + compute add-on | you | 15 minutes, monthly cost |
| 4 | Make a staging Supabase project + Render service, seed with `seed-staging.mjs`, run k6 | me, with the staging keys | half a day |
| 5 | Local session verification + short cache (Finding 4) | me | half a day |
| 6 | Scheduler lock and split (Finding 5) | me | 2 hours |
| 7 | Playwright journeys per role on staging | me | 1–2 days |
| 8 | Nightly customer-health snapshot (Finding 7) | me | 1 hour |

Until 1–3 are done, sell to pilot schools (up to about 2,000 accounts in total), not to a
20,000-account group.

## Update, 28 October 2026: 50,000 accounts

Same test with **25 schools of 2,000 accounts** (35,000 students, 700,000 register entries,
350,000 gate sign-ins, 125,000 change-history entries), after migrations 7400–7800:

| Query (50,000 accounts) | 20,000 | 50,000 |
|---|---:|---:|
| Parent: my children (portal home) | 4 ms | 5 ms |
| Parent: my children's report cards | 6 ms | 10 ms |
| Parent: my children's attendance this month | 38 ms | 71 ms |
| Student: my report card | 6 ms | 10 ms |
| Teacher: a class register for today | 27 ms | 59 ms |
| Teacher: my classes' attendance this week | 59 ms | 87 ms |
| Admin: today's attendance summary | 2 ms | 3 ms |
| Admin: 30-day attendance dashboard | 17 ms | 17 ms |
| Admin: fees outstanding | 45 ms | 44 ms |
| Admin: change history (latest 50) | 3 ms | 3 ms |
| Super admin: customer health (all schools) | 304 ms | 1,659 ms → 1,255 ms, now counted at most every 6 hours |

**Outcome:** every page a teacher, parent, student or school admin opens stays under 0.1 s in
the database at 50,000 accounts; growth from 20,000 to 50,000 is well under linear. The test found
two problems, both fixed:

- **users and guardians had no index by school** (migration 7800): every "staff of this school"
  lookup read all accounts on the platform.
- **Customer health recounted every school's history on each view**: the figures are now kept for
  up to 6 hours, with "Count again now" for the super admin.

What this does **not** change: the hosting findings above (one Render Starter instance, Supabase
plan size, Realtime quota) decide whether 50,000 people can be served at once. Database speed is no
longer the limit; the web server and the Supabase plan are.

## Reproduce

See `scripts/load/README.md`. Raw results: `node scripts/load/scale-bench.mjs` (after; add `--schools=25` for 50,000 accounts) and
`--before` (without migration 7400) write `scripts/load/out/scale-bench*.json`.
