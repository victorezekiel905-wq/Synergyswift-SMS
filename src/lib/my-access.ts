/**
 * What a member of staff can do, for their dashboard: their roles in words, and the areas and pages
 * those roles open (worked out from the same menu rules the app uses, so it always matches).
 */
import { NAV, visibleNav, type NavGroup } from "./nav";

export const ROLE_LABELS: Record<string, string> = {
  school_admin: "School admin", principal: "Principal", teacher: "Teacher", it_admin: "IT admin", bursar: "Bursar", librarian: "Librarian",
  hr_manager: "HR manager", qa_officer: "QA officer", gate_officer: "Gate officer", transport_officer: "Transport officer",
  hostel_warden: "Hostel warden", nurse: "Nurse", admissions_officer: "Admissions officer", cashier: "Cashier", counsellor: "Counsellor",
  exam_officer: "Exam officer", platform_admin: "Platform admin"
};

export const roleLabel = (r: string) => ROLE_LABELS[r] ?? r.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

/** Class team privileges (class_staff), in words. */
export const TEAM_PRIVILEGES: [string, string][] = [
  ["can_teach_live", "Live lessons"], ["can_give_points", "Classroom points"], ["can_post_story", "Class story"],
  ["can_message_parents", "Message parents"], ["can_see_results", "See results"]
];

export function teamPrivileges(row: Record<string, unknown>): string[] {
  return TEAM_PRIVILEGES.filter(([k]) => row[k] === true).map(([, label]) => label);
}

/** Pages everyone has, left out of the list of what a role opens. */
const EVERYONE = new Set(["/dashboard", "/account/security", "/calendar"]);

/**
 * The areas this person's roles open, with their pages. Modules the school does not have, and
 * modules the school took away from this person's custom role, are left out.
 */
export function accessAreas(roles: Set<string>, modules: Record<string, boolean>, deniedModules: string[] = [], nav: NavGroup[] = NAV): NavGroup[] {
  const denied = new Set(deniedModules);
  return visibleNav(roles, modules, nav)
    .map(g => ({ ...g, links: g.links.filter(l => !EVERYONE.has(l.href) && !(l.module && denied.has(l.module))) }))
    .filter(g => g.links.length);
}

export type MyClass = { class_group_id: string; name: string; form: boolean; subjects: string[]; team: { role: string; subject: string | null; privileges: string[] }[] };

/** One entry per class: form teacher, the subjects taught there, and any class team place with its privileges. */
export function classesFrom(p: {
  forms: { id: string; name: string }[];
  offerings: { class_group_id: string; class_name: string; subject: string }[];
  team: { class_group_id: string; class_name: string; role: string; subject: string | null; row: Record<string, unknown> }[];
}): MyClass[] {
  const out = new Map<string, MyClass>();
  const get = (id: string, name: string) => out.get(id) ?? out.set(id, { class_group_id: id, name, form: false, subjects: [], team: [] }).get(id)!;
  for (const f of p.forms) get(f.id, f.name).form = true;
  for (const o of p.offerings) { const c = get(o.class_group_id, o.class_name); if (!c.subjects.includes(o.subject)) c.subjects.push(o.subject); }
  for (const t of p.team) get(t.class_group_id, t.class_name).team.push({ role: t.role, subject: t.subject, privileges: teamPrivileges(t.row) });
  for (const c of out.values()) c.subjects.sort();
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
