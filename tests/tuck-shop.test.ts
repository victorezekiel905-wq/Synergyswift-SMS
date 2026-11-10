import { describe, expect, it } from "vitest";
import { codeRefusal, sellRefusal, byCategory, receipt, pauseSale, spendingAnalysis, MAX_PAUSED, formatBuyCode, cleanBuyCode, isBuyCodeShape, inWindows, type PausedSale } from "@/lib/tuck-shop";

describe("tuck shop: 6-character buy codes", () => {
  it("puts the dash in by itself as the seller types", () => {
    expect(formatBuyCode("7")).toBe("7");
    expect(formatBuyCode("7K3")).toBe("7K3");
    expect(formatBuyCode("7k3p")).toBe("7K3-P");
    expect(formatBuyCode("7k3px9")).toBe("7K3-PX9");
    expect(formatBuyCode("7K3-PX9")).toBe("7K3-PX9");
    expect(formatBuyCode("7K3-PX9Z")).toBe("7K3-PX9");
  });
  it("reads the code with or without the dash", () => {
    expect(cleanBuyCode("7k3-px9")).toBe("7K3PX9");
    expect(isBuyCodeShape("7K3-PX9")).toBe(true);
    expect(isBuyCodeShape("7K3PX9")).toBe(true);
    expect(isBuyCodeShape("7K3-PX0")).toBe(false);   // zero is never used
    expect(isBuyCodeShape("7K3-PX")).toBe(false);
  });
});

describe("tuck shop: selling times", () => {
  const at = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00Z`);
  it("is open only inside the times set (school's time zone)", () => {
    expect(inWindows("10:00-10:30, 12:30-13:15", "UTC", at("10:15"))).toBe(true);
    expect(inWindows("10:00-10:30, 12:30-13:15", "UTC", at("11:00"))).toBe(false);
    expect(inWindows("10:00-10:30, 12:30-13:15", "UTC", at("13:15"))).toBe(true);
    expect(inWindows("10:00-10:30", "Africa/Lagos", at("09:15"))).toBe(true);   // 10:15 in Lagos
    expect(inWindows("", "UTC", at("03:00"))).toBe(true);
  });
  it("tells the seller when the shop is closed", () => {
    expect(sellRefusal({ error: "closed", windows: "10:00-10:30,12:30-13:15" }, { currency: "NGN" })).toBe("The shop is closed now. Selling times: 10:00-10:30, 12:30-13:15.");
  });
});

describe("tuck shop: what people are told", () => {
  it("tells a student why no code can be made", () => {
    expect(codeRefusal({ error: "bought_max", max: 1 }, { currency: "NGN" })).toBe("You have bought once today already. Wait till tomorrow.");
    expect(codeRefusal({ error: "bought_max", max: 3 }, { currency: "NGN" })).toMatch(/3 times today/);
    expect(codeRefusal({ error: "wait", next_at: "2026-11-10T10:05:00Z" }, { currency: "NGN", timeZone: "Africa/Lagos" })).toBe("You bought already. Wait till 11:05 for the next buy.");
    expect(codeRefusal({ error: "window", windows: "10:00-10:30,12:30-13:15" }, { currency: "NGN" })).toBe("Buy codes can be made only at these times: 10:00-10:30, 12:30-13:15.");
    expect(codeRefusal({ error: "empty" }, { currency: "NGN" })).toMatch(/Your wallet is empty/);
  });
  it("speaks of the child to a parent", () => {
    expect(codeRefusal({ error: "bought_max", max: 2 }, { currency: "NGN", forParent: true, name: "Tobi" })).toBe("Tobi has bought twice today already. Wait till tomorrow.");
    expect(codeRefusal({ error: "empty" }, { currency: "NGN", forParent: true, name: "Tobi" })).toMatch(/^Tobi's wallet is empty/);
  });
  it("tells the seller why a sale was refused, with amounts", () => {
    expect(sellRefusal({ error: "over_limit", cap: 500, cap_left: 150 }, { currency: "NGN" })).toMatch(/limit of ₦500\.00\. ₦150\.00 left today/);
    expect(sellRefusal({ error: "not_enough", balance: 80, amount: 200 }, { currency: "NGN" })).toMatch(/balance is ₦80.*₦200/);
    expect(sellRefusal({ error: "bad_code" }, { currency: "NGN" })).toMatch(/not right/);
    expect(sellRefusal({ error: "out_of_stock", item: "Digestive", left: 1 }, { currency: "NGN" })).toBe("Only 1 Digestive left.");
    expect(sellRefusal({ error: "bought_max", max: 1 }, { currency: "NGN", name: "Tobi Ade" })).toMatch(/^Tobi Ade has bought once today/);
  });
});

describe("tuck shop: the till", () => {
  const items = [
    { id: "a", name: "Zobo", price: 200, category: "Drinks" }, { id: "b", name: "Digestive", price: 100, category: "Biscuits" },
    { id: "c", name: "Meat pie", price: 350, category: "Pastry" }, { id: "d", name: "Pen", price: 50, category: null }, { id: "e", name: "Bourbon", price: 120, category: "Biscuits" }
  ];
  it("groups products by category, with no category last", () => {
    const g = byCategory(items);
    expect(g.map(x => x.category)).toEqual(["Biscuits", "Drinks", "Pastry", "Other"]);
    expect(g[0].items.map(i => i.name)).toEqual(["Bourbon", "Digestive"]);
  });
  it("adds up the receipt from the shop's prices", () => {
    const r = receipt({ b: 2, c: 1, a: 0 }, items);
    expect(r.lines.map(l => [l.name, l.qty, l.amount])).toEqual([["Digestive", 2, 200], ["Meat pie", 1, 350]]);
    expect(r.total).toBe(550);
    expect(receipt({ zzz: 3 }, items).total).toBe(0);
  });
  it("puts up to four sales on hold", () => {
    let paused: PausedSale[] = [];
    for (let i = 0; i < MAX_PAUSED; i++) {
      const r = pauseSale(paused, { label: `S${i}`, basket: { a: 1 } });
      expect(r.ok).toBe(true);
      if (r.ok) paused = r.paused;
    }
    const fifth = pauseSale(paused, { label: "S5", basket: { a: 1 } });
    expect(fifth).toMatchObject({ ok: false });
    expect(pauseSale([], { label: "x", basket: {} })).toMatchObject({ ok: false });
    expect(MAX_PAUSED).toBe(4);
  });
});

describe("tuck shop: spending for parents", () => {
  it("adds up by category and by day", () => {
    const a = spendingAnalysis([
      { created_at: "2026-11-09T10:00:00Z", amount: -300, items: [{ category: "Biscuits", qty: 2, price: 100 }, { category: "Drinks", qty: 1, price: 100 }] },
      { created_at: "2026-11-10T10:00:00Z", amount: -200, items: [{ category: "Drinks", qty: 1, price: 200 }] },
      { created_at: "2026-11-10T12:00:00Z", amount: -50, items: [] }
    ]);
    expect(a).toMatchObject({ total: 550, buys: 3 });
    expect(a.categories).toEqual([{ category: "Drinks", amount: 300 }, { category: "Biscuits", amount: 200 }, { category: "Other", amount: 50 }]);
    expect(a.days).toEqual([{ day: "2026-11-09", amount: 300 }, { day: "2026-11-10", amount: 250 }]);
  });
});
