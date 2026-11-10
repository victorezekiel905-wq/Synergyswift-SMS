// Tuck shop (migration 9700): one-time 4-character buy codes made within the school's rules,
// fingerprint scans from a machine in shop mode, prices and stock from the shop, the wallet
// locked while it pays, and every refusal recorded.
export default async function ({ q, expectError, check, U, T }) {
  console.log("\nTuck shop: codes, fingerprints, limits and stock");
  const one = async sql => (await q(sql))[0];
  const ST = "a8200000-0000-0000-0000-000000000001", B1 = "a8300000-0000-0000-0000-000000000001", D1 = "a8300000-0000-0000-0000-000000000002";
  const DEV = "a8400000-0000-0000-0000-000000000001", OP = U.adminA;
  const set = sql => q(`update tenant_settings set ${sql} where tenant_id = '${T.A}'`);
  await q(`insert into tenant_settings (tenant_id) values ('${T.A}') on conflict (tenant_id) do nothing`);
  await set(`shop_purchases_per_day = 2, shop_gap_minutes = 60, shop_code_windows = '', shop_daily_cap = null, shop_require_code = true`);
  await q(`insert into students (id, tenant_id, admission_no, first_name, last_name) values ('${ST}', '${T.A}', 'TS-1', 'Tobi', 'Ade')`);
  await q(`insert into shop_items (id, tenant_id, name, price, category, stock, stock_alert) values ('${B1}', '${T.A}', 'Digestive', 100, 'Biscuits', 5, 2), ('${D1}', '${T.A}', 'Zobo', 200, 'Drinks', null, null)`);
  const make = async (as = "student") => (await q(`select shop_make_code('${T.A}', '${ST}', null, '${as}') r`))[0].r;
  const sell = async (method, extra, items = `[{"id":"${B1}","qty":2}]`) => (await q(`select shop_sell('${T.A}', '${OP}', '${items}'::jsonb, null, '${method}', ${extra}) r`))[0].r;

  check("no money, no code", (await make()).error === "empty");
  await q(`insert into wallets (student_id, tenant_id, balance) values ('${ST}', '${T.A}', 1000)`);
  const c1 = await make();
  check("a student makes a 4-character code with no look-alikes", /^[A-HJ-NP-Z2-9]{4}$/.test(c1.code ?? "") && c1.reused === false, c1);
  check("making it again gives the same code (one live code at a time)", (await make()).code === c1.code);

  const s1 = await sell("code", `'${c1.code.toLowerCase()}'`);
  check("the seller types the code and the money leaves the wallet at once", s1.ok === true && Number(s1.total) === 200 && Number(s1.balance) === 800, s1);
  check("…priced by the shop, with the receipt lines", s1.lines?.[0]?.name === "Digestive" && Number(s1.lines[0].qty) === 2);
  check("…the stock goes down", Number((await one(`select stock from shop_items where id = '${B1}'`)).stock) === 3);
  check("…the code is spent", Boolean((await one(`select used_at from shop_codes where code = '${c1.code}' and student_id = '${ST}'`)).used_at));
  check("a used code can't pay again", (await sell("code", `'${c1.code}'`)).error === "bad_code");
  const w1 = await make();
  check("after a buy, the next code waits for the gap", w1.error === "wait" && Boolean(w1.next_at), w1);

  // The gap has passed (an hour later): a second buy.
  await q(`update wallet_transactions set created_at = created_at - interval '61 minutes' where student_id = '${ST}'`);
  const c2 = await make();
  check("after the gap, a new code", Boolean(c2.code) && c2.code !== c1.code, c2);
  check("a parent can make the code too", (await make("parent")).code === c2.code);
  const s2 = await sell("code", `'${c2.code}'`, `[{"id":"${D1}","qty":1}]`);
  check("second buy of the day", s2.ok === true && Number(s2.balance) === 600 && s2.left_today === 0, s2);
  await set(`shop_gap_minutes = 0`);
  check("two buys a day: no third code", (await make()).error === "bought_max");

  // Limits, windows and stock.
  await set(`shop_purchases_per_day = 10, shop_daily_cap = 500`);
  const c3 = await make();
  const s3 = await sell("code", `'${c3.code}'`, `[{"id":"${D1}","qty":1}]`);
  check("the school's daily cap stops a buy over it", s3.error === "over_limit" && Number(s3.cap) === 500, s3);
  check("…recorded for the student, parents and admins", Boolean(await one(`select 1 x from shop_events where student_id = '${ST}' and kind = 'refused' and detail->>'reason' = 'over_limit'`)));
  check("…and the code still works for a smaller buy", (await sell("code", `'${c3.code}'`, `[{"id":"${B1}","qty":1}]`)).ok === true);
  await set(`shop_daily_cap = null`);
  const c4 = await make();
  check("not enough stock is refused", (await sell("code", `'${c4.code}'`, `[{"id":"${B1}","qty":5}]`)).error === "out_of_stock");
  // A window three hours from now (school time): closed now. A window around now: open.
  const tz = (await one(`select coalesce(timezone, 'Africa/Lagos') tz from tenants where id = '${T.A}'`)).tz;
  const hm = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Date.now() + ms));
  await q(`update shop_codes set revoked_at = now() where student_id = '${ST}' and used_at is null`);
  await set(`shop_code_windows = '${hm(3 * 3600_000)}-${hm(3 * 3600_000 + 60_000)}'`);
  const win = await make();
  check("codes can only be made in the school's times", win.error === "window", win);
  await set(`shop_code_windows = '${hm(-60_000)}-${hm(120_000)}, 23:58-23:59'`);
  const open = await make();
  check("…and inside them they can", Boolean(open.code) || open.error !== "window", open);
  await q(`update shop_codes set revoked_at = now() where student_id = '${ST}' and used_at is null`);
  await set(`shop_code_windows = ''`);
  await q(`update wallets set frozen = true where student_id = '${ST}'`);
  check("a frozen wallet makes no code", (await make()).error === "frozen");
  await q(`update wallets set frozen = false where student_id = '${ST}'`);

  // The ID card alone is refused while the school requires a code.
  check("card alone is refused when a code is required", (await sell("card", `null, null, '${ST}'`)).error === "code_required");

  // Fingerprint: a machine in tuck shop mode reads the finger; the till uses the scan once.
  await q(`insert into attendance_devices (id, tenant_id, name, kind, serial, mode) values ('${DEV}', '${T.A}', 'Shop reader', 'zkteco', 'SHOP-1', 'shop')`);
  const scan = (await one(`select shop_record_scan('${DEV}', '${ST}') id`)).id;
  const f1 = await sell("fingerprint", `null, '${scan}'`, `[{"id":"${B1}","qty":1}]`);
  check("a fingerprint pays", f1.ok === true && f1.student_id === ST, f1);
  check("…once", (await sell("fingerprint", `null, '${scan}'`, `[{"id":"${B1}","qty":1}]`)).error === "scan_expired");
  check("a gate machine's scans don't count for the shop", !(await one(`select shop_record_scan('${DEV.replace(/1$/, "2")}', '${ST}') id`)).id);

  // Spending to nothing tells everyone.
  const bal = Number((await one(`select balance from wallets where student_id = '${ST}'`)).balance);
  await q(`update shop_items set price = ${bal} where id = '${D1}'`);
  const c5 = await make();
  const s5 = await sell("code", `'${c5.code}'`, `[{"id":"${D1}","qty":1}]`);
  check("spending the last of the money is flagged", s5.ok === true && s5.exhausted === true && Boolean(await one(`select 1 x from shop_events where student_id = '${ST}' and kind = 'exhausted'`)), s5);
  check("an empty wallet makes no code", (await make()).error === "empty");

  // A seller guessing codes is stopped.
  for (let i = 0; i < 10; i++) await sell("code", `'ZZZ${"23456789AB"[i]}'`);
  check("ten wrong codes in 15 minutes stop the seller", (await sell("code", `'ABCD'`)).error === "too_many_tries");

  await expectError("staff can't read codes", U.adminA, "select * from shop_codes", /permission denied/);
  await expectError("staff can't sell directly", U.adminA, `select shop_sell('${T.A}', '${OP}', '[]'::jsonb, 100, 'card', null, null, '${ST}')`, /permission denied/);
  await expectError("students can't make codes directly", U.studentA, `select shop_make_code('${T.A}', '${ST}', null, 'student')`, /permission denied/);

  // Leave the school as later tests expect it.
  await q(`delete from shop_events where tenant_id = '${T.A}'`);
  await q(`delete from attendance_devices where id = '${DEV}'`);
  await q(`delete from students where id = '${ST}'`);
  await q(`delete from shop_items where id in ('${B1}', '${D1}')`);
  await q(`delete from recycle_bin where tenant_id = '${T.A}' and row_id in ('${ST}', '${B1}', '${D1}', '${DEV}')`).catch(() => {});
  await set(`shop_purchases_per_day = 1, shop_gap_minutes = 60, shop_daily_cap = null`);
}
