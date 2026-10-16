import { describe, it, expect } from "vitest";
import { approvalPath, nextRequisitionSteps, reorderSuggestions, stockValue, assetsDue, bestQuote, orderProgress, addToBasket } from "@/lib/procurement";

describe("approvals", () => {
  it("needs a second approver above the limit", () => {
    expect(approvalPath(400_000, 500_000)).toEqual(["approve"]);
    expect(approvalPath(600_000, 500_000)).toEqual(["endorse", "approve"]);
  });
  it("offers the right next step", () => {
    const r = { status: "submitted", total_amount: 600_000, requested_by: "req", endorsed_by: null };
    expect(nextRequisitionSteps(r, "req", false, 500_000)).toEqual(["cancel"]);
    expect(nextRequisitionSteps(r, "bursar", false, 500_000)).toEqual(["endorse", "reject"]);
    expect(nextRequisitionSteps({ ...r, total_amount: 1000 }, "bursar", false, 500_000)).toEqual(["approve", "reject"]);
    const e = { ...r, status: "endorsed", endorsed_by: "bursar" };
    expect(nextRequisitionSteps(e, "bursar", true, 500_000)).toEqual([]);
    expect(nextRequisitionSteps(e, "head", true, 500_000)).toEqual(["approve", "reject"]);
    expect(nextRequisitionSteps(e, "other", false, 500_000)).toEqual(["reject"]);
    expect(nextRequisitionSteps({ ...r, status: "approved" }, "bursar", false, 500_000)).toEqual(["order", "fulfil"]);
  });
});

describe("stock and assets", () => {
  it("suggests what to reorder, emptiest first", () => {
    const s = reorderSuggestions([
      { id: "a", name: "Chalk", quantity: 5, reorder_level: 10, unit_cost: 100 }, { id: "b", name: "Shirt", variant: "10", quantity: 0, reorder_level: 4, unit_cost: 2500 },
      { id: "c", name: "Paper", quantity: 50, reorder_level: 10, unit_cost: 10 }, { id: "d", name: "Pens", quantity: 0, reorder_level: 0, unit_cost: 1 }]);
    expect(s.map(x => [x.id, x.suggest, x.cost])).toEqual([["b", 8, 20000], ["a", 15, 1500]]);
    expect(stockValue([{ quantity: 5, unit_cost: 100 }, { quantity: -2, unit_cost: 50 }])).toBe(500);
  });
  it("lists services due and warranties ending", () => {
    const d = assetsDue([
      { id: "1", tag: "A1", name: "Projector", status: "in_use", next_maintenance_on: "2026-10-01", warranty_expires: null },
      { id: "2", tag: "A2", name: "Generator", status: "in_use", next_maintenance_on: "2026-10-25", warranty_expires: "2026-11-30" },
      { id: "3", tag: "A3", name: "Old PC", status: "retired", next_maintenance_on: "2026-10-01", warranty_expires: null },
      { id: "4", tag: "A4", name: "Laptop", status: "in_use", next_maintenance_on: "2027-01-01", warranty_expires: "2027-06-01" }], "2026-10-16");
    expect(d.service.map(a => [a.tag, a.overdue])).toEqual([["A1", true], ["A2", false]]);
    expect(d.warranty.map(a => a.tag)).toEqual(["A2"]);
  });
});

describe("buying", () => {
  it("picks the cheapest quote, then the quickest", () => {
    expect(bestQuote([{ s: "x", amount: 100, delivery_days: 9 }, { s: "y", amount: 100, delivery_days: 3 }, { s: "z", amount: 120, delivery_days: 1 }])?.s).toBe("y");
    expect(bestQuote([])).toBeNull();
  });
  it("tracks what has arrived", () => {
    expect(orderProgress([{ quantity: 10, received_qty: 10, unit_cost: 5 }, { quantity: 4, received_qty: 1, unit_cost: 100 }])).toEqual({ ordered: 14, received: 11, value_received: 150, complete: false });
    expect(orderProgress([{ quantity: 1, received_qty: 1, unit_cost: 1 }]).complete).toBe(true);
  });
  it("adds scanned items to the till basket", () => {
    expect(addToBasket(addToBasket([], "a"), "a")).toEqual([{ id: "a", qty: 2 }]);
  });
});
