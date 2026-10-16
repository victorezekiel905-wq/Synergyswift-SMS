// Stock with sizes, issuing and shop sales; asset services and faults; requisitions with a second approval; purchase orders received into stock and the asset register.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001";
  const ID = n => `ed000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const S10 = ID(1), S12 = ID(2), SHOP = ID(3), ASSET = ID(4), SUP = ID(5), BIG = ID(6), SMALL = ID(7), PO = ID(8), L1 = ID(9), L2 = ID(10);

  console.log("\nStock");
  await expectOk("the bursar stocks shirts in two sizes", U.bursarA, `insert into inventory_items (id, tenant_id, name, variant, quantity, unit_cost, sell_price) values ('${S10}', '${T.A}', 'School shirt', 'Age 9-10', 10, 1500, 2500), ('${S12}', '${T.A}', 'School shirt', 'Age 11-12', 4, 1600, 2600)`);
  await expectError("…but not the same size twice", U.bursarA, `insert into inventory_items (tenant_id, name, variant) values ('${T.A}', 'school shirt', 'age 9-10')`, /duplicate|unique/);
  await expectOk("the bursar issues two to a student", U.bursarA, `select public.inventory_issue('${S10}', 2, '${KID}', null, 'New starter')`);
  const s0 = await q(`select quantity from inventory_items where id = '${S10}'`);
  check("…and the stock goes down", Number(s0[0].quantity) === 8, s0[0]);
  await expectError("…not more than there is", U.bursarA, `select public.inventory_issue('${S12}', 5, '${KID}', null, null)`, /not enough stock/);
  await expectError("teachers cannot issue stock", U.teacherA, `select public.inventory_issue('${S10}', 1, '${KID}', null, null)`, /forbidden/);
  await expectOk("a shop item sells from that stock", U.bursarA, `insert into shop_items (id, tenant_id, name, price, inventory_item_id, barcode) values ('${SHOP}', '${T.A}', 'Shirt 9-10', 2500, '${S10}', 'SH910')`);
  await db.exec(`insert into wallets (student_id, tenant_id, balance) values ('${KID}', '${T.A}', 50000) on conflict (student_id) do update set balance = 50000, frozen = false, daily_limit = null`);
  await expectOk("a till sale…", U.bursarA, `select public.wallet_charge('${KID}', 2500, '[{"id":"${SHOP}","name":"Shirt 9-10","qty":1,"price":2500}]'::jsonb, 'Uniform', 'POS-TEST-1')`);
  const s1 = await q(`select quantity from inventory_items where id = '${S10}'`);
  check("…takes a shirt off the shelf", Number(s1[0].quantity) === 7, s1[0]);
  await expectError("the till cannot sell what is not there", U.bursarA, `select public.wallet_charge('${KID}', 25000, '[{"id":"${SHOP}","name":"Shirt 9-10","qty":10,"price":2500}]'::jsonb, 'Uniform', 'POS-TEST-2')`, /not enough/);
  const w0 = await q(`select balance from wallets where student_id = '${KID}'`);
  check("…and the child is not charged for it", Number(w0[0].balance) === 47500, w0[0]);

  console.log("\nAssets");
  await expectOk("an asset with a service schedule", U.bursarA, `insert into assets (id, tenant_id, tag, name, maintenance_every_days) values ('${ASSET}', '${T.A}', 'GEN-1', 'Generator', 90)`);
  await expectOk("a service is logged", U.bursarA, `insert into asset_maintenance (tenant_id, asset_id, kind, status, done_on) values ('${T.A}', '${ASSET}', 'service', 'done', '2026-10-01')`);
  const a0 = await q(`select last_maintenance_on::text l, next_maintenance_on::text n from assets where id = '${ASSET}'`);
  check("…moving the next service on", a0[0].l === "2026-10-01" && a0[0].n === "2026-12-30", a0[0]);
  await expectOk("any member of staff can report a fault", U.teacherA, `insert into asset_maintenance (tenant_id, asset_id, kind, status, description, reported_by) values ('${T.A}', '${ASSET}', 'fault', 'reported', 'Will not start', '${U.teacherA}')`);
  await expectError("…but not log work as done", U.teacherA, `insert into asset_maintenance (tenant_id, asset_id, kind, status) values ('${T.A}', '${ASSET}', 'service', 'done')`, /row-level security/);

  console.log("\nRequisitions and purchase orders");
  await expectOk("the bursar adds a supplier", U.bursarA, `insert into suppliers (id, tenant_id, name) values ('${SUP}', '${T.A}', 'Lagos Office Supplies')`);
  await expectRows("teachers do not see suppliers", U.teacherA, "select count(*) n from suppliers", 0);
  await expectOk("a teacher asks for laptops (above the limit)", U.teacherA, `insert into requisitions (id, tenant_id, requested_by, title, total_amount, status) values ('${BIG}', '${T.A}', '${U.teacherA}', 'Laptops for ICT', 600000, 'submitted')`);
  await expectOk("…and for chalk (below it)", U.teacherA, `insert into requisitions (id, tenant_id, requested_by, title, total_amount, status) values ('${SMALL}', '${T.A}', '${U.teacherA}', 'Chalk', 1000, 'submitted')`);
  await expectOk("a small request needs one approval", U.bursarA, `update requisitions set status = 'approved' where id = '${SMALL}'`);
  await expectError("a large one cannot be approved straight away", U.bursarA, `update requisitions set status = 'approved' where id = '${BIG}'`, /endorsing first/);
  await expectOk("the bursar endorses it", U.bursarA, `update requisitions set status = 'endorsed' where id = '${BIG}'`);
  await expectError("…but cannot give the second approval too", U.bursarA, `update requisitions set status = 'approved' where id = '${BIG}'`, /someone other than the endorser|principal/);
  await expectOk("the head approves it", U.adminA, `update requisitions set status = 'approved' where id = '${BIG}'`);
  await expectError("the amount cannot change once approval has started", U.adminA, `update requisitions set total_amount = 1 where id = '${BIG}'`, /cannot change/);
  await expectOk("the bursar raises an order", U.bursarA, `insert into purchase_orders (id, tenant_id, requisition_id, supplier_id, status, po_no) values ('${PO}', '${T.A}', '${BIG}', '${SUP}', 'received', 'FAKE')`);
  const p0 = await q(`select status, po_no from purchase_orders where id = '${PO}'`);
  check("…which starts as an unnumbered draft", p0[0].status === "draft" && p0[0].po_no === null, p0[0]);
  await expectOk("…with lines into stock and the asset register", U.bursarA, `insert into purchase_order_lines (id, tenant_id, po_id, description, quantity, unit_cost, inventory_item_id, is_asset) values
    ('${L1}', '${T.A}', '${PO}', 'Shirts 9-10', 5, 1000, '${S10}', false), ('${L2}', '${T.A}', '${PO}', 'Laptop', 2, 200000, null, true)`);
  const p1 = await q(`select total from purchase_orders where id = '${PO}'`);
  check("the total follows the lines", Number(p1[0].total) === 405000, p1[0]);
  await expectOk("the order is sent", U.bursarA, `update purchase_orders set status = 'sent' where id = '${PO}'`);
  const p2 = await q(`select po_no from purchase_orders where id = '${PO}'`);
  check("…and numbered", /^PO-\d{4}-\d{6}$/.test(p2[0].po_no ?? ""), p2[0]);
  await expectError("a sent order's lines are fixed", U.bursarA, `update purchase_order_lines set unit_cost = 1 where id = '${L1}'`, /cannot be changed/);
  await expectError("nobody marks an order received by hand", U.bursarA, `update purchase_orders set status = 'received' where id = '${PO}'`, /receiving the goods/);
  await expectOk("the shirts arrive", U.bursarA, `select public.po_receive('${L1}', 5, null)`);
  const s2 = await q(`select quantity from inventory_items where id = '${S10}'`);
  check("…into stock", Number(s2[0].quantity) === 12, s2[0]);
  await expectError("…no more than were ordered", U.bursarA, `select public.po_receive('${L1}', 1, null)`, /more were ordered/);
  await expectOk("the laptops arrive", U.bursarA, `select public.po_receive('${L2}', 2, array['ICT-01','ICT-02'])`);
  const a1 = await q(`select tag from assets where purchase_order_id = '${PO}' order by tag`);
  check("…into the asset register with their tags", a1.map(x => x.tag).join(",") === "ICT-01,ICT-02", a1);
  const p3 = await q(`select (select status from purchase_orders where id = '${PO}') po, (select status from requisitions where id = '${BIG}') req`);
  check("the order is received and the requisition fulfilled", p3[0].po === "received" && p3[0].req === "fulfilled", p3[0]);
  await expectRows("the teacher can follow the order for their request", U.teacherA, "select count(*) n from purchase_orders", 1);
  await expectError("teachers cannot receive goods", U.teacherA, `select public.po_receive('${L1}', 1, null)`, /forbidden/);

  await db.exec(`delete from assets where purchase_order_id = '${PO}' or id = '${ASSET}'; delete from purchase_orders where id = '${PO}'; delete from requisitions where id in ('${BIG}', '${SMALL}');
    delete from suppliers where id = '${SUP}'; delete from shop_items where id = '${SHOP}'; delete from wallet_transactions where reference like 'POS-TEST-%';
    delete from inventory_items where id in ('${S10}', '${S12}');`);
}
