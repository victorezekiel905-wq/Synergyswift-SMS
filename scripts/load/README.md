# Load testing Synergy Swift (phase 14m)

Three tools, from cheapest to most realistic. **Never point the second and third at the live project.**

## 1. Database at 20,000 users (runs anywhere, no accounts needed)

```
node scripts/load/scale-bench.mjs            # 10 schools x 2,000 accounts, about 10 minutes
node scripts/load/scale-bench.mjs --quick    # 2 schools, about 1 minute
node scripts/load/scale-bench.mjs --before   # without the row-level security speed-up (migration 7400)
```

Builds the full schema in an in-memory Postgres, seeds students, parents, staff, a month of
attendance, gate sign-ins, report cards, invoices and change history, then times the busiest
queries as real signed-in users with row-level security on. Results go to `scripts/load/out/`.
PGlite is single-threaded: absolute times are slower than Supabase; compare ratios and plans.

## 2. A full test on a staging copy (phase 14q)

Everything below runs against a **separate Supabase project** (Pro plan, same region as production) and a
**separate Render web service** pointing at it. The scripts refuse the live project.

1. **Build the database** (all migrations in order, no demo data). Copy the staging project's *session
   pooler* connection string from Supabase → Connect:

   ```
   STAGING=yes STAGING_DB_URL='postgresql://postgres.<staging-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres'      node scripts/load/setup-staging.mjs
   ```

   Then in that project: Settings → API → add `live` to Exposed schemas, and set Max rows to 50000.

2. **Fill it with people**: 10 schools of 2,000 accounts = 20,000; `SCHOOLS=25` makes 50,000.

   ```
   STAGING=yes SCHOOLS=25 NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<staging service key>      LOAD_PASSWORD='<a long password>' node scripts/load/seed-staging.mjs
   ```

   Writes `scripts/load/out/users.csv` (for k6) and `scripts/load/out/e2e.env` (one account per role for the
   browser tests, including a test platform owner). All accounts use LOAD_PASSWORD.

3. **Deploy the staging app** on Render from the same branch, with the staging project's URL and keys.

4. **Browser tests as every role**:

   ```
   E2E_BASE_URL=https://<staging app> E2E_PASSWORD='<LOAD_PASSWORD>' <the lines from out/e2e.env> npm run test:e2e
   ```

5. **The school day with k6** (install k6 from https://k6.io). `SCALE=1` is the 20,000-account day,
   `SCALE=2.5` the 50,000 one:

   ```
   k6 run --summary-export scripts/load/out/k6-summary.json -e SCALE=2.5      -e BASE_URL=https://<staging app> -e SUPABASE_URL=https://<staging-ref>.supabase.co      -e ANON_KEY=<staging anon key> -e PASSWORD='<LOAD_PASSWORD>'      [-e EXAM_ID=<published paper id> -e EXAM_CODE=<its code>] scripts/load/k6-school-day.js
   ```

   Four scenarios over 26 minutes: the 07:30 register and gate rush (600 teachers at scale 1), results day
   (80 parents a second), a CBT paper (1,500 students saving every 20 seconds) and general browsing (300
   people). It fails if more than 1% of requests fail or the 95th percentile is over 800 ms. Watch
   Supabase → Reports and Render → Metrics while it runs.

6. **The report in plain words**:

   ```
   node scripts/load/report.mjs scripts/load/out/k6-summary.json --scale=2.5
   ```

   Writes `scripts/load/out/LOAD_RESULT.md`: passed or not yet, the numbers against the targets, and what to change
   (more Render instances, a bigger Supabase compute size).
