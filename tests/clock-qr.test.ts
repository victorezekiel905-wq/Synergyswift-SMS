import { describe, it, expect } from "vitest";
import { clockToken, readClockToken, CLOCK_WINDOW_S } from "@/lib/clock-qr";

const KEY = Buffer.from("test-key-for-clock-codes");
const A = "a1000000-0000-0000-0000-000000000000", B = "b1000000-0000-0000-0000-000000000000";
const NOW = Date.UTC(2026, 10, 2, 6, 30);

describe("entrance clock-in code", () => {
  it("is accepted for the same school, with its campus", () => {
    expect(readClockToken(clockToken(A, null, KEY, NOW), A, KEY, NOW)).toEqual({ campus: null });
    expect(readClockToken(clockToken(A, "Annex", KEY, NOW), A, KEY, NOW + 5_000)).toEqual({ campus: "Annex" });
  });
  it("is refused for another school, so codes say nothing about which school they belong to", () => {
    expect(readClockToken(clockToken(A, null, KEY, NOW), B, KEY, NOW)).toBeNull();
    expect(clockToken(A, null, KEY, NOW)).not.toContain(A);
  });
  it("stops working after about a minute and a half", () => {
    const t = clockToken(A, null, KEY, NOW);
    expect(readClockToken(t, A, KEY, NOW + 2 * CLOCK_WINDOW_S * 1000)).not.toBeNull();
    expect(readClockToken(t, A, KEY, NOW + 4 * CLOCK_WINDOW_S * 1000)).toBeNull();
    expect(readClockToken(clockToken(A, null, KEY, NOW + 3 * CLOCK_WINDOW_S * 1000), A, KEY, NOW)).toBeNull();   // from the future
  });
  it("cannot be altered or forged", () => {
    const t = clockToken(A, "Main", KEY, NOW);
    const [w, , s] = t.split(".");
    expect(readClockToken(`${w}.${Buffer.from("Annex").toString("base64url")}.${s}`, A, KEY, NOW)).toBeNull();
    expect(readClockToken(clockToken(A, "Main", Buffer.from("other key"), NOW), A, KEY, NOW)).toBeNull();
    expect(readClockToken("nonsense", A, KEY, NOW)).toBeNull();
    expect(readClockToken("x".repeat(500), A, KEY, NOW)).toBeNull();
  });
});
