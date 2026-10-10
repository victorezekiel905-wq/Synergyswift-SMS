/** Request schemas shared by the community API routes. */
import { z } from "zod";

export const SegmentRulesSchema = z.object({
  class_group_ids: z.array(z.string().uuid()).max(200).optional(), levels: z.array(z.string().max(40)).max(50).optional(), languages: z.array(z.string().max(10)).max(20).optional(),
  min_balance: z.number().min(0).nullish(), overdue: z.boolean().optional(),
  nps: z.array(z.enum(["promoter", "passive", "detractor", "none"])).optional(), risk: z.array(z.enum(["low", "medium", "high"])).optional(),
  reenrolment: z.array(z.enum(["returning", "not_returning", "undecided", "no_response"])).optional(),
  open_ticket: z.boolean().optional(), min_children: z.number().int().min(1).max(20).nullish(), referrers: z.boolean().optional(),
  channel: z.enum(["email", "whatsapp", "sms"]).nullish()
}).strict();

export const AudienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("parents"), class_group_ids: z.array(z.string().uuid()).max(200).optional(), segment_id: z.string().uuid().nullish(), rules: SegmentRulesSchema.nullish() }),
  z.object({ type: z.literal("alumni"), years: z.array(z.number().int().min(1900).max(2200)).max(100).optional(), mentors_only: z.boolean().optional() }),
  z.object({ type: z.literal("partners"), kinds: z.array(z.enum(["vendor", "supplier", "partner", "sponsor", "ngo", "government", "media", "other"])).optional() })
]);
