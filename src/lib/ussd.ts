/**
 * USSD menus for parents on basic phones (phase 14q), the menu part. Africa's
 * Talking sends every key press so far as `text` ("1*2*48213907"); we answer
 * "CON …" to show a menu and wait, or "END …" to finish. The data comes through
 * UssdData so the menus can be tested on their own (lib/ussd-server.ts has the
 * real one). Screens stay short: basic phones show about 160 characters.
 */
export type UssdChild = { tenantId: string; guardianId: string; studentId: string; firstName: string; lastName: string; className: string | null; timezone: string; school: string };
export type ResultReply = { kind: "need_pin" } | { kind: "done"; text: string } | { kind: "error"; text: string };
/** A waiting exeat to answer, or a plain message. */
export type ExeatReply = { kind: "ask"; text: string; id: string } | { kind: "none"; text: string };
export const ABSENCE_REASONS = [["sick", "Illness"], ["medical", "Medical appointment"], ["family", "Family matter"], ["other", "Other"]] as const;

export type UssdData = {
  children(phone: string): Promise<UssdChild[]>;
  result(child: UssdChild, pin: string | null, phone: string): Promise<ResultReply>;
  fees(child: UssdChild, phone: string): Promise<string>;
  attendance(child: UssdChild): Promise<string>;
  bus(child: UssdChild): Promise<string>;
  /** A one-time pickup code for this parent (only if the school lets them collect the child). */
  pickup(child: UssdChild): Promise<string>;
  /** Report the child away today. */
  absence(child: UssdChild, reason: (typeof ABSENCE_REASONS)[number][0]): Promise<string>;
  /** The exeat waiting for this parent's answer, and answering it. */
  exeat(child: UssdChild): Promise<ExeatReply>;
  answerExeat(child: UssdChild, id: string, approve: boolean): Promise<string>;
};

const MAX = 180;
const con = (s: string) => `CON ${s}`.slice(0, MAX + 4);
const end = (s: string) => `END ${s}`.slice(0, MAX + 4);
const MENU = ["Results", "Fees balance", "Attendance today", "School bus", "Pickup code", "Report absence", "Exeat"];

export async function ussdReply(text: string, phone: string, data: UssdData): Promise<string> {
  const parts = text ? text.split("*").map(p => p.trim()) : [];
  while (parts.length && parts[parts.length - 1] === "") parts.pop();   // an empty answer is no answer yet
  const kids = await data.children(phone);
  if (!kids.length) return end("This phone number is not on a school record. Ask your child's school to add it, then dial again.");
  const schools = [...new Set(kids.map(k => k.school))];
  if (!parts.length) return con(`${schools.length === 1 ? schools[0] : "Synergy Swift"}\n${MENU.map((m, i) => `${i + 1}. ${m}`).join("\n")}`);

  const choice = Number(parts[0]);
  if (!(choice >= 1 && choice <= MENU.length)) return end(`Please choose 1 to ${MENU.length}. Dial again to start over.`);
  let rest = parts.slice(1);
  let child: UssdChild;
  if (kids.length === 1) child = kids[0];
  else {
    if (!rest.length) return con(`Which child?\n${kids.slice(0, 8).map((k, i) => `${i + 1}. ${k.firstName}${k.className ? ` (${k.className})` : ""}`).join("\n")}`);
    const pick = kids[Number(rest[0]) - 1];
    if (!pick) return end("That child number isn't on the list. Dial again to start over.");
    child = pick;
    rest = rest.slice(1);
  }

  if (choice === 1) {
    const pin = rest[0] ?? null;
    const r = await data.result(child, pin, phone);
    if (r.kind === "need_pin") return pin ? end("That PIN didn't work. Dial again to try once more.") : con(`Enter the result PIN from ${child.firstName}'s scratch card:`);
    return end(r.text);
  }
  if (choice === 2) return end(await data.fees(child, phone));
  if (choice === 3) return end(await data.attendance(child));
  if (choice === 4) return end(await data.bus(child));
  if (choice === 5) return end(await data.pickup(child));
  if (choice === 6) {
    if (!rest.length) return con(`Why is ${child.firstName} away today?\n${ABSENCE_REASONS.map(([, l], i) => `${i + 1}. ${l}`).join("\n")}`);
    const r = ABSENCE_REASONS[Number(rest[0]) - 1];
    if (!r) return end("That choice isn't on the list. Dial again to start over.");
    return end(await data.absence(child, r[0]));
  }
  // 7: exeat
  const e = await data.exeat(child);
  if (e.kind === "none") return end(e.text);
  if (!rest.length) return con(`${e.text}\n1. Approve\n2. Decline`);
  if (rest[0] !== "1" && rest[0] !== "2") return end("Please choose 1 or 2. Dial again to start over.");
  return end(await data.answerExeat(child, e.id, rest[0] === "1"));
}
