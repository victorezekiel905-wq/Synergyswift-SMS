import { describe, expect, it } from "vitest";
import { reminderDue, digestText, STAFF_RULE, PARENT_RULE } from "@/lib/sign-up-reminders";

const d = (daysAgo: number, now: Date) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();

describe("sign-up reminders", () => {
  const now = new Date("2026-11-11T06:00:00Z");
  it("staff: a first reminder after 3 days, then every 4, three sends in all", () => {
    expect(reminderDue(d(1, now), [d(1, now)], now, STAFF_RULE)).toBe(false);          // too soon
    expect(reminderDue(d(3, now), [d(3, now)], now, STAFF_RULE)).toBe(true);           // first reminder
    expect(reminderDue(d(5, now), [d(5, now), d(2, now)], now, STAFF_RULE)).toBe(false); // reminded 2 days ago
    expect(reminderDue(d(9, now), [d(9, now), d(5, now)], now, STAFF_RULE)).toBe(true);  // 4 days since
    expect(reminderDue(d(20, now), [d(20, now), d(12, now), d(6, now)], now, STAFF_RULE)).toBe(false); // three sends already
    expect(reminderDue(d(10, now), [], now, STAFF_RULE)).toBe(true);                   // never sent at all: send
    expect(reminderDue("not a date", [], now, STAFF_RULE)).toBe(false);
  });
  it("parents: weekly, from a week after the first link", () => {
    expect(reminderDue(d(6, now), [d(6, now)], now, PARENT_RULE)).toBe(false);
    expect(reminderDue(d(7, now), [d(7, now)], now, PARENT_RULE)).toBe(true);
  });
  it("the Monday line says who is still waiting", () => {
    expect(digestText({ staffWaiting: 0, parentsWaiting: 0 })).toBeNull();
    expect(digestText({ staffWaiting: 1, parentsWaiting: 0 })).toMatch(/^1 member of staff has not signed in yet/);
    expect(digestText({ staffWaiting: 4, parentsWaiting: 31 })).toMatch(/^4 members of staff and 31 parents have not signed in yet/);
    // Parents nothing could be sent to are said separately; parents using their private link are not counted at all.
    expect(digestText({ staffWaiting: 0, parentsWaiting: 0, parentsNoContact: 2 })).toMatch(/^2 parents have no working email or phone/);
    expect(digestText({ staffWaiting: 1, parentsWaiting: 0, parentsNoContact: 1 })).toMatch(/not signed in yet\..* 1 parent has no working email or phone/);
  });
});
