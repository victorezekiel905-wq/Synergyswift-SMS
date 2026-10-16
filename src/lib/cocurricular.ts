/** Clubs, competitions and trips. Pure. */

/** Can this student join (or ask to join) this group? */
export function joinCheck(g: { active: boolean; joining: string; capacity: number | null; open_to_class_ids: string[] }, p: { classId: string | null; activeMembers: number; status: string | null }) {
  if (!g.active || g.joining === "closed") return { ok: false as const, reason: "this group is not taking new members" };
  if (p.status === "active") return { ok: false as const, reason: "you are already a member" };
  if (p.status === "requested") return { ok: false as const, reason: "you have already asked to join" };
  if (g.open_to_class_ids.length && (!p.classId || !g.open_to_class_ids.includes(p.classId))) return { ok: false as const, reason: "this group is not open to your class" };
  if (g.capacity && p.activeMembers >= g.capacity) return { ok: false as const, reason: "this group is full" };
  return { ok: true as const, status: g.joining === "open" ? "active" as const : "requested" as const };
}

/** Share of sessions a member came to (late counts as there; excused sessions are left out). */
export function attendanceRate(marks: { status: string }[]) {
  const counted = marks.filter(m => m.status !== "excused");
  if (!counted.length) return null;
  return Math.round((counted.filter(m => m.status === "present" || m.status === "late").length / counted.length) * 100);
}

const ORD = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
/** Results worth recording as an achievement: a podium place or a named award. */
export function achievementFor(e: { position: number | null; award: string | null }) {
  if (e.award?.trim()) return e.award.trim();
  if (e.position && e.position <= 3) return `${ORD(e.position)} place`;
  return null;
}
export const ordinal = ORD;

/** Achievement levels from competition levels. */
export const ACHIEVEMENT_LEVEL: Record<string, string> = { house: "school", school: "school", local: "local", state: "state", national: "national", international: "international" };
export const ACHIEVEMENT_KIND: Record<string, string> = { sports: "sports", arts: "arts", academic: "academic", debate: "competition", quiz: "competition", other: "competition" };

/** Who is going on a trip: consent given, with whether the trip fee is paid. */
export function rosterFromResponses(responses: { student_id: string; consent: boolean; invoice_status: string | null }[], fee: number) {
  const going = responses.filter(r => r.consent);
  return going.map(r => ({ student_id: r.student_id, paid: fee <= 0 || r.invoice_status === "paid", part_paid: r.invoice_status === "part_paid" }));
}

/** Children still out after the planned return time (plus a grace period). */
export function tripLate(e: { returns_at: string | null; late_alerted_at: string | null }, roster: { status: string }[], now = new Date(), graceMinutes = 30) {
  if (!e.returns_at || e.late_alerted_at) return 0;
  if (now.getTime() < Date.parse(e.returns_at) + graceMinutes * 60_000) return 0;
  return roster.filter(r => r.status === "departed").length;
}

export function rosterSummary(roster: { status: string }[]) {
  const by = (s: string) => roster.filter(r => r.status === s).length;
  return { total: roster.length, going: by("going"), departed: by("departed"), returned: by("returned"), absent: by("absent") };
}
