/**
 * Bus exceptions (phase 14i-2). Pure rules, unit tested.
 *  - boarded_not_in_school: boarded a bus in the morning, an hour has passed, and the
 *    school has evidence for today (the child's register was taken, or the gate is in
 *    use) but none of it shows the child in school.
 *  - not_dropped_off: boarded a bus in the afternoon and was never scanned off, and the
 *    trip has ended (or three hours have passed).
 */
import { localParts } from "./attendance";

export type BusEvent = { student_id: string; route_id: string; kind: "boarded" | "alighted"; at: string };
export type Presence = {
  /** Signed in at the gate, or marked present or late in a register today. */
  inSchool: Set<string>;
  /** Has any register mark today (present, late, absent or excused). */
  marked: Set<string>;
  /** The school's gate recorded children coming in today. */
  gateUsed: boolean;
};
export type BusException = { student_id: string; route_id: string; kind: "boarded_not_in_school" | "not_dropped_off"; boarded_at: string };

export const ARRIVE_WITHIN_MIN = 60;
export const DROP_OFF_WITHIN_MIN = 180;
const NOON = 12 * 60;

export function busExceptions(p: { events: BusEvent[]; presence: Presence; tripEnded: Map<string, string>; timeZone: string; now: Date }): BusException[] {
  const today = localParts(p.now, p.timeZone).date;
  const byStudent = new Map<string, BusEvent[]>();
  for (const e of p.events) {
    if (localParts(new Date(e.at), p.timeZone).date !== today) continue;
    const list = byStudent.get(e.student_id);
    if (list) list.push(e); else byStudent.set(e.student_id, [e]);
  }
  const out: BusException[] = [];
  const now = p.now.getTime();
  for (const [sid, list] of byStudent) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    const morning = list.find(e => e.kind === "boarded" && localParts(new Date(e.at), p.timeZone).minutes < NOON);
    if (morning && now - Date.parse(morning.at) >= ARRIVE_WITHIN_MIN * 60_000 && !p.presence.inSchool.has(sid)
        && (p.presence.marked.has(sid) || p.presence.gateUsed)) {
      out.push({ student_id: sid, route_id: morning.route_id, kind: "boarded_not_in_school", boarded_at: morning.at });
    }
    const afternoon = [...list].reverse().find(e => e.kind === "boarded" && localParts(new Date(e.at), p.timeZone).minutes >= NOON);
    if (afternoon) {
      const off = list.some(e => e.kind === "alighted" && e.at > afternoon.at);
      const ended = p.tripEnded.get(afternoon.route_id);
      const over = (ended && ended > afternoon.at) || now - Date.parse(afternoon.at) >= DROP_OFF_WITHIN_MIN * 60_000;
      if (!off && over) out.push({ student_id: sid, route_id: afternoon.route_id, kind: "not_dropped_off", boarded_at: afternoon.at });
    }
  }
  return out;
}

/** Has an open exception been settled by what has happened since? */
export function settled(x: { student_id: string; kind: BusException["kind"]; boarded_at: string | null }, events: BusEvent[], presence: Presence): string | null {
  if (x.kind === "boarded_not_in_school") return presence.inSchool.has(x.student_id) ? "In school (signed in or marked present)" : null;
  const off = events.find(e => e.student_id === x.student_id && e.kind === "alighted" && (!x.boarded_at || e.at > x.boarded_at));
  return off ? "Scanned off the bus" : null;
}

export const EXCEPTION_WORDS: Record<BusException["kind"], string> = {
  boarded_not_in_school: "boarded the morning bus but is not in school",
  not_dropped_off: "boarded the afternoon bus but was not scanned off"
};
