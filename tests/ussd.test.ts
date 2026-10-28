import { describe, it, expect, vi } from "vitest";
import { ussdReply, type UssdChild, type UssdData } from "@/lib/ussd";

const ada: UssdChild = { tenantId: "t1", guardianId: "g1", studentId: "s1", firstName: "Ada", lastName: "Okonkwo", className: "JSS2 Blue", timezone: "Africa/Lagos", school: "Greenfield College" };
const tobi: UssdChild = { ...ada, studentId: "s2", firstName: "Tobi", className: "JSS1 Gold" };

function data(kids: UssdChild[], o: Partial<UssdData> = {}): UssdData {
  return {
    children: vi.fn(async () => kids),
    result: vi.fn(async (_c, pin) => (pin ? { kind: "done", text: "Ada, First term: average 78.4." } : { kind: "need_pin" })),
    fees: vi.fn(async c => `${c.firstName}: fees balance ₦85,000.`),
    attendance: vi.fn(async c => `${c.firstName} today: arrived 7:42am. Register: present.`),
    bus: vi.fn(async c => `${c.firstName} boarded the bus at 7:05am.`),
    ...o
  } as UssdData;
}

describe("USSD menus for parents", () => {
  it("greets with the school's name and the four choices", async () => {
    const r = await ussdReply("", "+2348031234567", data([ada]));
    expect(r).toBe("CON Greenfield College\n1. Results\n2. Fees balance\n3. Attendance today\n4. School bus");
  });
  it("tells an unknown number what to do", async () => {
    expect(await ussdReply("", "+2348000000000", data([]))).toMatch(/^END This phone number is not on a school record/);
  });
  it("goes straight to the one child, or asks which child", async () => {
    expect(await ussdReply("2", "+234", data([ada]))).toBe("END Ada: fees balance ₦85,000.");
    expect(await ussdReply("3", "+234", data([ada, tobi]))).toBe("CON Which child?\n1. Ada (JSS2 Blue)\n2. Tobi (JSS1 Gold)");
    expect(await ussdReply("3*2", "+234", data([ada, tobi]))).toBe("END Tobi today: arrived 7:42am. Register: present.");
    expect(await ussdReply("4*9", "+234", data([ada, tobi]))).toMatch(/isn't on the list/);
  });
  it("asks for the result PIN when the school uses them, then shows the result", async () => {
    expect(await ussdReply("1", "+234", data([ada]))).toBe("CON Enter the result PIN from Ada's scratch card:");
    expect(await ussdReply("1*48213907", "+234", data([ada]))).toBe("END Ada, First term: average 78.4.");
    expect(await ussdReply("1*2*48213907", "+234", data([ada, tobi]))).toBe("END Ada, First term: average 78.4.");
  });
  it("treats an empty answer as no answer yet, and a wrong menu number plainly", async () => {
    expect(await ussdReply("1*", "+234", data([ada]))).toBe("CON Enter the result PIN from Ada's scratch card:");
    expect(await ussdReply("7", "+234", data([ada]))).toBe("END Please choose 1 to 4. Dial again to start over.");
  });
  it("keeps every screen short enough for a basic phone", async () => {
    const long = data([ada], { fees: async () => "x".repeat(400) });
    expect((await ussdReply("2", "+234", long)).length).toBeLessThanOrEqual(184);
  });
});
