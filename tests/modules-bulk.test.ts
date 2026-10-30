import { describe, it, expect } from "vitest";
import { setAllModes, dateForSwitched, type Draft } from "@/components/platform/ModulesEditor";

const start: Draft = {
  fees: { mode: "inherit", expires_at: "", note: "" },
  library: { mode: "off", expires_at: "2027-01-31", note: "unpaid" }
};
const keys = ["fees", "library", "hostel"];

describe("switching every module at once", () => {
  it("All on switches every module on, keeping notes and dates", () => {
    const d = setAllModes(start, keys, "on");
    expect(keys.map(k => d[k].mode)).toEqual(["on", "on", "on"]);
    expect(d.library).toEqual({ mode: "on", expires_at: "2027-01-31", note: "unpaid" });
  });
  it("All follow plan clears end dates", () => {
    const d = setAllModes(start, keys, "inherit");
    expect(keys.every(k => d[k].mode === "inherit" && d[k].expires_at === "")).toBe(true);
  });
  it("one date goes on every switched module, not those following the plan", () => {
    const d = dateForSwitched(setAllModes(start, ["fees"], "on"), keys, "2027-03-31");
    expect(d.fees.expires_at).toBe("2027-03-31");
    expect(d.library.expires_at).toBe("2027-03-31");
    expect(d.hostel).toBeUndefined();
  });
  it("an empty date removes the end dates", () => {
    expect(dateForSwitched(start, keys, "").library.expires_at).toBe("");
  });
  it("doesn't change the draft it was given", () => {
    setAllModes(start, keys, "off");
    expect(start.fees.mode).toBe("inherit");
  });
});
