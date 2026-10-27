import { z } from "zod";
import { MODULE_GROUPS, MODULE_KEYS } from "./saas";

const GROUPS = MODULE_GROUPS.map(g => g.key) as [string, ...string[]];

/** A school's subscription as the platform sets it (onboarding and the school's plan tab). */
export const SubscriptionBody = z.object({
  plan_code: z.string().trim().min(2).max(40),
  band: z.number().int().min(0).max(4).nullable(),
  cycle: z.enum(["annual", "termly"]).default("annual"),
  add_on_groups: z.array(z.enum(GROUPS)).max(6).default([]),
  custom_annual: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
  discount_pct: z.number().min(0).max(100).default(0),
  grace_days: z.number().int().min(0).max(90).default(14),
  status: z.enum(["trial", "active"]).optional(),
  period_start: z.string().datetime({ offset: true }).nullish(),
  period_end: z.string().datetime({ offset: true }).nullish(),
  cancel_at_period_end: z.boolean().default(false),
  notes: z.string().trim().max(1000).nullish(),
  issue_invoice: z.boolean().default(false)
});

export const OverrideBody = z.object({
  module: z.enum(MODULE_KEYS as [string, ...string[]]),
  mode: z.enum(["inherit", "on", "off"]),
  expires_at: z.string().datetime({ offset: true }).nullish(),
  note: z.string().trim().max(300).nullish()
});
