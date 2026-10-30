import { describe, it, expect } from "vitest";
import { noticeFor } from "@/components/Toaster";
import { tabbedNav } from "@/components/SideNav";
import { NAV, PLATFORM_NAV, visibleNav } from "@/lib/nav";

describe("every button says whether it worked", () => {
  it("saving says Saved, or Not saved", () => {
    for (const [m, b] of [["POST", { action: "save" }], ["POST", { action: "save_plan" }], ["PATCH", { status: "paused" }], ["POST", { name: "JSS1" }], ["PUT", undefined]] as const)
      expect(noticeFor(m, b)).toMatchObject({ done: "Saved", failed: "Not saved", quietWhenOk: false });
  });
  it("deleting, cancelling and sending say so", () => {
    expect(noticeFor("DELETE", undefined).done).toBe("Deleted");
    expect(noticeFor("POST", { action: "delete_template" }).done).toBe("Deleted");
    expect(noticeFor("POST", { action: "revoke" }).done).toBe("Cancelled");
    expect(noticeFor("POST", { action: "send_email" }).done).toBe("Sent");
    expect(noticeFor("POST", { action: "remind" }).failed).toBe("Not sent");
  });
  it("previews and AI drafts stay quiet unless they fail", () => {
    for (const a of ["preview", "ai_brief", "generate", "check"]) expect(noticeFor("POST", { action: a }).quietWhenOk).toBe(true);
  });
});

describe("main modules across the top", () => {
  const R = (...r: string[]) => new Set(r);
  it("staff with many pages get module tabs", () => {
    expect(tabbedNav(visibleNav(R("school_admin"), {}, NAV))).toBe(true);
    expect(tabbedNav(visibleNav(R("teacher"), {}, NAV))).toBe(true);
  });
  it("short menus (a parent, the platform console) stay one list", () => {
    expect(tabbedNav(visibleNav(R("parent"), {}, NAV))).toBe(false);
    expect(tabbedNav(PLATFORM_NAV)).toBe(false);
  });
});
