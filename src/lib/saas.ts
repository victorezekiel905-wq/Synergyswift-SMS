/**
 * Synergy Swift as a SaaS: the module catalogue, plans, per-school module
 * overrides (inherit / on / off, with expiry), pricing by school size, and
 * the subscription billing cycle. Pure functions, unit tested.
 *
 * Entitlement: plan modules → school overrides → effective on/off. The
 * effective map is written to tenants.modules and every API checks it
 * (requireCtx). Permissions inside a module are separate (roles).
 */

export type ModuleGroup = "core" | "learning" | "exams" | "money" | "safety" | "engagement";

export const MODULE_GROUPS: { key: ModuleGroup; label: string; hint: string }[] = [
  { key: "core", label: "Core", hint: "Students, classes, results, attendance, timetable and the parent portal" },
  { key: "learning", label: "Learning", hint: "Homework, online learning, live lessons and games, classroom management, library" },
  { key: "exams", label: "Exams", hint: "Secure CBT exams, question bank, subject tools, entrance exams" },
  { key: "money", label: "Money", hint: "Fees and online payment, wallet, accounts, HR and payroll" },
  { key: "safety", label: "Safety", hint: "Gate, pickup codes, buses, visitors, boarding and health" },
  { key: "engagement", label: "Engagement", hint: "Admissions CRM, broadcasts, elections, SEN, quality and AI" }
];

export const MODULE_CATALOGUE = [
  { key: "sims", label: "Student information", group: "core" },
  { key: "results", label: "Results & report cards", group: "core" },
  { key: "attendance", label: "Class register", group: "core" },
  { key: "timetable", label: "Timetable", group: "core" },
  { key: "events", label: "Events & consent", group: "core" },
  { key: "inbox", label: "Parent-staff messaging", group: "core" },
  { key: "community", label: "Families & community", group: "core" },
  { key: "meetings", label: "Parent meetings", group: "core" },
  { key: "behaviour", label: "Behaviour & houses", group: "core" },
  { key: "cover", label: "Staff cover", group: "core" },
  { key: "qa", label: "Quality assurance", group: "core" },
  { key: "lms", label: "Online learning (lessons, live class)", group: "learning" },
  { key: "homework", label: "Homework", group: "learning" },
  { key: "lesson_notes", label: "Lesson notes", group: "learning" },
  { key: "live", label: "SwiftCipher live lessons & games", group: "learning" },
  { key: "classroom", label: "Classroom management (points)", group: "learning" },
  { key: "library", label: "Library", group: "learning" },
  { key: "analytics", label: "Early warning & analytics", group: "learning" },
  { key: "exams", label: "Secure exams & question bank", group: "exams" },
  { key: "fees", label: "Fees & online payments", group: "money" },
  { key: "wallet", label: "Cashless wallet & tuck shop", group: "money" },
  { key: "inventory", label: "Accounts, stock & assets", group: "money" },
  { key: "requisitions", label: "Requisitions & buying", group: "money" },
  { key: "hr", label: "HR & leave", group: "money" },
  { key: "payroll", label: "Payroll", group: "money" },
  { key: "gate", label: "Sign in / out", group: "safety" },
  { key: "pickup", label: "Pickup codes", group: "safety" },
  { key: "transport", label: "School buses & live tracking", group: "safety" },
  { key: "visitors", label: "Visitors", group: "safety" },
  { key: "hostel", label: "Boarding & exeat", group: "safety" },
  { key: "health", label: "Health & sick bay", group: "safety" },
  { key: "admissions", label: "Admissions & entrance", group: "engagement" },
  { key: "messaging", label: "Email, WhatsApp & SMS broadcasts", group: "engagement" },
  { key: "elections", label: "Elections & voting", group: "engagement" },
  { key: "sen", label: "SEN engagement", group: "engagement" },
  { key: "ai", label: "AI assistant", group: "engagement" }
] as const satisfies readonly { key: string; label: string; group: ModuleGroup }[];

export type ModuleKey = (typeof MODULE_CATALOGUE)[number]["key"];
export const MODULE_KEYS = MODULE_CATALOGUE.map(m => m.key) as ModuleKey[];

export const moduleLabel = (k: string) => MODULE_CATALOGUE.find(m => m.key === k)?.label ?? k;
export const modulesInGroups = (groups: readonly string[]) => MODULE_CATALOGUE.filter(m => groups.includes(m.group)).map(m => m.key) as ModuleKey[];

/** Size bands (most students) and the yearly price of each group per band, in naira. Above the last band is priced by hand. */
export const BANDS = [100, 250, 500, 1000, 2000] as const;

export const DEFAULT_GROUP_PRICES: Record<ModuleGroup, number[]> = {
  core: [250_000, 530_000, 950_000, 1_680_000, 2_800_000],
  learning: [300_000, 630_000, 1_130_000, 2_000_000, 3_300_000],
  exams: [250_000, 530_000, 950_000, 1_680_000, 2_800_000],
  money: [125_000, 265_000, 475_000, 840_000, 1_400_000],
  safety: [125_000, 265_000, 475_000, 840_000, 1_400_000],
  engagement: [100_000, 210_000, 375_000, 660_000, 1_100_000]
};

export type PlanDef = { code: string; name: string; groups: ModuleGroup[]; prices: number[] | null; blurb: string };

export const DEFAULT_PLANS: PlanDef[] = [
  { code: "essentials", name: "Essentials", groups: ["core"], prices: DEFAULT_GROUP_PRICES.core, blurb: "Run the school: students, classes, results, attendance and the parent portal." },
  { code: "growth", name: "Growth", groups: ["core", "learning", "exams", "money"], prices: [800_000, 1_680_000, 3_040_000, 5_360_000, 8_800_000], blurb: "Everything in Essentials, plus learning, secure exams and fees." },
  { code: "complete", name: "Complete", groups: ["core", "learning", "exams", "money", "safety", "engagement"], prices: [1_000_000, 2_100_000, 3_800_000, 6_700_000, 11_000_000], blurb: "The whole platform, including safety, admissions, elections and SEN." },
  { code: "custom", name: "Custom", groups: ["core"], prices: null, blurb: "Agreed modules and price for large schools and groups." }
];

/** Index of the size band for a number of students, or null above the largest band. */
export function bandFor(students: number): number | null {
  const i = BANDS.findIndex(b => students <= b);
  return i < 0 ? null : i;
}

export const bandLabel = (i: number | null) => (i === null ? `More than ${BANDS[BANDS.length - 1].toLocaleString("en-NG")} students` : `Up to ${BANDS[i].toLocaleString("en-NG")} students`);

/* ---------------- Entitlement ---------------- */

export type OverrideMode = "inherit" | "on" | "off";
export type Override = { module: string; mode: OverrideMode; expires_at?: string | null; note?: string | null };
export type ModuleRow = { key: ModuleKey; label: string; group: ModuleGroup; fromPlan: boolean; mode: OverrideMode; expires_at: string | null; expired: boolean; effective: boolean };

/**
 * Effective modules for a school. `planModules` null means the school has no
 * plan yet (older schools): every module is on unless overridden. Overrides
 * past their expiry date fall back to the plan.
 */
export function resolveModules(planModules: readonly string[] | null, overrides: Override[], now = new Date()): { effective: Record<ModuleKey, boolean>; rows: ModuleRow[] } {
  const byKey = new Map(overrides.map(o => [o.module, o]));
  const rows = MODULE_CATALOGUE.map(m => {
    const fromPlan = planModules === null ? true : planModules.includes(m.key);
    const o = byKey.get(m.key);
    const expired = Boolean(o?.expires_at && new Date(o.expires_at).getTime() <= now.getTime());
    const mode: OverrideMode = o && !expired ? o.mode : "inherit";
    const effective = mode === "on" ? true : mode === "off" ? false : fromPlan;
    return { key: m.key as ModuleKey, label: m.label, group: m.group as ModuleGroup, fromPlan, mode: o?.mode ?? "inherit", expires_at: o?.expires_at ?? null, expired, effective };
  });
  return { effective: Object.fromEntries(rows.map(r => [r.key, r.effective])) as Record<ModuleKey, boolean>, rows };
}

/** Modules a plan includes, plus any add-on groups the school pays for. */
export function planModules(planGroups: readonly string[] | null, addOnGroups: readonly string[] = []): ModuleKey[] | null {
  if (planGroups === null) return null;
  return modulesInGroups([...planGroups, ...addOnGroups]);
}

/** What changes if overrides are saved: for the "check before saving" view. */
export function diffEffective(before: Record<string, boolean>, after: Record<string, boolean>) {
  const turnedOn: string[] = [], turnedOff: string[] = [];
  for (const k of MODULE_KEYS) {
    const b = before[k] !== false, a = after[k] !== false;
    if (!b && a) turnedOn.push(k);
    if (b && !a) turnedOff.push(k);
  }
  return { turnedOn, turnedOff };
}

/* ---------------- Pricing ---------------- */

export type Cycle = "annual" | "termly";
export type QuoteLine = { label: string; amount: number };

/**
 * Price for a school: the plan at its size band, plus add-on groups not in the
 * plan. Termly billing is a third of the year plus 10%. Schools above the top
 * band, and custom plans, use `customAnnual`.
 */
export function quote(input: {
  plan: Pick<PlanDef, "name" | "groups" | "prices">; band: number | null; addOns?: ModuleGroup[]; cycle?: Cycle;
  groupPrices?: Record<string, number[]>; customAnnual?: number | null; discountPct?: number;
}): { lines: QuoteLine[]; annual: number | null; perInvoice: number | null; cycle: Cycle } {
  const cycle = input.cycle ?? "annual";
  const gp = input.groupPrices ?? DEFAULT_GROUP_PRICES;
  const lines: QuoteLine[] = [];
  let annual: number | null = 0;
  if (input.customAnnual != null && input.customAnnual >= 0) {
    lines.push({ label: `${input.plan.name} (agreed price)`, amount: input.customAnnual });
    annual = input.customAnnual;
  } else if (input.band === null || !input.plan.prices) {
    return { lines: [], annual: null, perInvoice: null, cycle };
  } else {
    lines.push({ label: `${input.plan.name}, ${bandLabel(input.band).toLowerCase()}`, amount: input.plan.prices[input.band] });
    annual += input.plan.prices[input.band];
    for (const g of input.addOns ?? []) {
      if (input.plan.groups.includes(g)) continue;
      const price = gp[g]?.[input.band];
      if (price === undefined) continue;
      lines.push({ label: `Add-on: ${MODULE_GROUPS.find(x => x.key === g)?.label ?? g}`, amount: price });
      annual += price;
    }
  }
  const disc = Math.max(0, Math.min(100, input.discountPct ?? 0));
  if (disc && annual) {
    const d = Math.round((annual * disc) / 100);
    lines.push({ label: `Discount (${disc}%)`, amount: -d });
    annual -= d;
  }
  const perInvoice = cycle === "annual" ? annual : Math.round(((annual ?? 0) / 3) * 1.1);
  return { lines, annual, perInvoice, cycle };
}

export const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

/* ---------------- Billing cycle ---------------- */

export type SubState = { status: "trial" | "active" | "past_due" | "suspended" | "cancelled"; period_end: string | null; grace_days: number; cancel_at_period_end: boolean };
export type BillingAction = "none" | "issue_renewal" | "mark_past_due" | "suspend" | "cancel";

/** Days before the period ends that the renewal invoice is sent. */
export const RENEWAL_NOTICE_DAYS = 14;

/**
 * What the billing job should do now. `renewalOpen` = a renewal invoice for
 * the next period exists and is unpaid; `renewalPaid` = it has been paid.
 */
export function billingAction(sub: SubState, opts: { renewalOpen: boolean; renewalPaid: boolean }, now = new Date()): BillingAction {
  if (sub.status === "cancelled" || !sub.period_end) return "none";
  const end = new Date(sub.period_end).getTime(), t = now.getTime(), day = 86_400_000;
  if (sub.cancel_at_period_end) return t >= end ? "cancel" : "none";
  if (opts.renewalPaid) return "none";
  if (t < end - RENEWAL_NOTICE_DAYS * day) return "none";
  if (!opts.renewalOpen) return "issue_renewal";
  if (t < end) return "none";
  if (t >= end + sub.grace_days * day) return sub.status === "suspended" ? "none" : "suspend";
  return sub.status === "past_due" ? "none" : "mark_past_due";
}

/** The next billing period after one ends. */
export function nextPeriod(periodEnd: string, cycle: Cycle): { start: string; end: string } {
  const s = new Date(periodEnd);
  const e = new Date(s);
  if (cycle === "annual") e.setUTCFullYear(e.getUTCFullYear() + 1);
  else e.setUTCMonth(e.getUTCMonth() + 4);
  return { start: s.toISOString(), end: e.toISOString() };
}

/* ---------------- Roles and permissions inside a school ---------------- */

/** Actions a school admin can take away from a custom role (on top of the module and role checks). */
export const PERMISSIONS = [
  { key: "results.publish", label: "Publish results and report cards" },
  { key: "exams.publish", label: "Publish exams and release exam results" },
  { key: "fees.discount", label: "Approve discounts, scholarships and waivers" },
  { key: "fees.void", label: "Void or refund payments" },
  { key: "payroll.run", label: "Run and approve payroll" },
  { key: "students.remove", label: "Withdraw or delete students" },
  { key: "staff.roles", label: "Add staff and change their roles" },
  { key: "messaging.broadcast", label: "Send broadcasts to classes or the whole school" },
  { key: "admissions.offer", label: "Send admission offers" }
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export type CustomRole = { id: string; name: string; grants: string[]; deny_modules: string[]; deny_permissions: string[] };

/** Roles that a school's own admins always keep, whatever the platform allows. */
export const ALWAYS_ALLOWED_ROLES = ["school_admin", "principal", "teacher", "student", "parent"];

/**
 * A user's working roles: their own role and extra roles, plus what a custom
 * role grants, limited to the roles the platform allows the school.
 */
export function effectiveRoles(base: string[], custom: CustomRole | null, allowed: string[] | null): Set<string> {
  const all = [...base, ...(custom?.grants ?? [])];
  return new Set(all.filter(r => !allowed || ALWAYS_ALLOWED_ROLES.includes(r) || allowed.includes(r) || r === "platform_admin"));
}

export function permitted(custom: CustomRole | null, perm: Permission): boolean {
  return !custom || !custom.deny_permissions.includes(perm);
}

export function moduleBlockedForUser(custom: CustomRole | null, module: string): boolean {
  return Boolean(custom?.deny_modules.includes(module));
}

/* ---------------- Platform admins ---------------- */

export type PlatformRole = "owner" | "admin" | "support";
const RANK: Record<PlatformRole, number> = { support: 1, admin: 2, owner: 3 };
export const platformAtLeast = (role: string | null | undefined, need: PlatformRole) => Boolean(role && RANK[role as PlatformRole] >= RANK[need]);
