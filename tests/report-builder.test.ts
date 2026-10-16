import { describe, it, expect } from "vitest";
import { DATASETS, datasetById, canUse, validateSpec, runSpec, matches, outputRows, nextRun, aggKey } from "@/lib/report-builder";

const inv = datasetById("invoices")!;
const rows = [
  { invoice_no: "INV-1", name: "Ada", class: "JSS1", total: 100000, paid: 100000, balance: 0, status: "paid", due_date: "2026-09-30" },
  { invoice_no: "INV-2", name: "Bayo", class: "JSS1", total: 100000, paid: 40000, balance: 60000, status: "part_paid", due_date: "2026-09-30" },
  { invoice_no: "INV-10", name: "Chi", class: "JSS2", total: 120000, paid: 0, balance: 120000, status: "issued", due_date: null }
];

describe("datasets", () => {
  it("have unique ids, defaults that exist, and role limits", () => {
    expect(new Set(DATASETS.map(d => d.id)).size).toBe(DATASETS.length);
    for (const d of DATASETS) for (const k of d.defaults) expect(d.columns.some(c => c.key === k)).toBe(true);
    expect(canUse(inv, ["bursar"])).toBe(true);
    expect(canUse(inv, ["teacher"])).toBe(false);
    expect(canUse(datasetById("results")!, ["teacher"])).toBe(true);
    expect(datasetById("nope")).toBeNull();
  });
});

describe("validateSpec", () => {
  it("accepts a sensible report and explains problems", () => {
    expect(validateSpec(inv, { columns: ["name", "balance"], filters: [{ column: "balance", op: "gt", value: 0 }], sort: { column: "balance", dir: "desc" } })).toEqual([]);
    const errs = validateSpec(inv, { columns: [], filters: [{ column: "secret", op: "eq", value: 1 }, { column: "name", op: "contains", value: "" }], aggregates: [{ column: "name", fn: "sum" }], limit: 0 });
    expect(errs).toEqual(expect.arrayContaining(["choose at least one column", "unknown filter column secret", "give a value for the name filter", "Student cannot be added up", "limit must be between 1 and 20000"]));
  });
  it("allows sorting by a total when grouped", () => {
    expect(validateSpec(inv, { columns: ["class"], group_by: "class", aggregates: [{ column: "balance", fn: "sum" }], sort: { column: "sum_balance", dir: "desc" } })).toEqual([]);
  });
});

describe("filters", () => {
  it("compare numbers, text and blanks", () => {
    expect(matches(rows[1], { column: "balance", op: "gt", value: "50000" })).toBe(true);
    expect(matches(rows[0], { column: "balance", op: "gt", value: 0 })).toBe(false);
    expect(matches(rows[2], { column: "name", op: "contains", value: "ch" })).toBe(true);
    expect(matches(rows[2], { column: "due_date", op: "empty" })).toBe(true);
    expect(matches(rows[2], { column: "due_date", op: "lt", value: "2026-10-01" })).toBe(false);
    expect(matches(rows[0], { column: "status", op: "neq", value: "PAID" })).toBe(false);
    expect(matches({ fee_paid: true }, { column: "fee_paid", op: "eq", value: "yes" })).toBe(true);
  });
});

describe("runSpec", () => {
  it("picks columns, filters, sorts naturally and limits", () => {
    const o = runSpec(inv, { columns: ["invoice_no", "balance"], filters: [{ column: "status", op: "neq", value: "void" }], sort: { column: "invoice_no", dir: "asc" }, limit: 2 }, rows);
    expect(o.columns.map(c => c.label)).toEqual(["Invoice no.", "Balance"]);
    expect(o.rows).toEqual([["INV-1", 0], ["INV-2", 60000]]);
    expect(o).toMatchObject({ total_rows: 3, truncated: true });
  });
  it("groups with totals", () => {
    const o = runSpec(inv, { columns: ["class"], group_by: "class", aggregates: [{ column: "", fn: "count" }, { column: "balance", fn: "sum" }, { column: "paid", fn: "avg" }],
      sort: { column: "sum_balance", dir: "desc" } }, rows);
    expect(o.columns.map(c => c.label)).toEqual(["Class", "Number", "Total balance", "Average paid"]);
    expect(o.rows).toEqual([["JSS2", 1, 120000, 0], ["JSS1", 2, 60000, 70000]]);
    expect(o.columns[2].type).toBe("money");
    expect(aggKey({ column: "x", fn: "count" })).toBe("count");
  });
  it("counts when no totals are chosen, and names blanks", () => {
    const o = runSpec(inv, { columns: ["due_date"], group_by: "due_date" }, rows);
    expect(o.rows).toContainEqual(["(blank)", 1]);
  });
  it("puts blanks last whichever way it sorts", () => {
    const o = runSpec(inv, { columns: ["due_date"], sort: { column: "due_date", dir: "desc" } }, rows);
    expect(o.rows[2]).toEqual([null]);
  });
  it("makes spreadsheet rows", () => {
    expect(outputRows({ columns: [{ key: "a", label: "A", type: "bool" }], rows: [[true], [null]], total_rows: 2, truncated: false })).toEqual([["A"], ["yes"], [""]]);
  });
});

describe("nextRun", () => {
  const tz = "Africa/Lagos";
  it("daily at the chosen hour", () => {
    expect(nextRun({ schedule: "daily", schedule_hour: 7 }, new Date("2026-10-16T05:00:00Z"), tz)?.toISOString()).toBe("2026-10-16T06:00:00.000Z");
    expect(nextRun({ schedule: "daily", schedule_hour: 7 }, new Date("2026-10-16T06:00:00Z"), tz)?.toISOString()).toBe("2026-10-17T06:00:00.000Z");
  });
  it("weekly on a weekday (16 Oct 2026 is a Friday)", () => {
    expect(nextRun({ schedule: "weekly", schedule_day: 1, schedule_hour: 8 }, new Date("2026-10-16T12:00:00Z"), tz)?.toISOString()).toBe("2026-10-19T07:00:00.000Z");
    expect(nextRun({ schedule: "weekly", schedule_day: 5, schedule_hour: 18 }, new Date("2026-10-16T12:00:00Z"), tz)?.toISOString()).toBe("2026-10-16T17:00:00.000Z");
  });
  it("monthly on a day of the month", () => {
    expect(nextRun({ schedule: "monthly", schedule_day: 1, schedule_hour: 6 }, new Date("2026-10-16T12:00:00Z"), tz)?.toISOString()).toBe("2026-11-01T05:00:00.000Z");
  });
  it("not at all when unscheduled", () => {
    expect(nextRun({ schedule: "none", schedule_hour: 7 }, new Date(), tz)).toBeNull();
  });
});
