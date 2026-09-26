import { z } from "zod";

export const GuardianInput = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().or(z.literal("")).nullish(),
  phone: z.string().trim().max(30).nullish(),
  whatsapp_phone: z.string().trim().max(30).nullish(),
  relation: z.string().trim().max(30).default("parent"),
  is_primary: z.boolean().default(false),
  can_pickup: z.boolean().default(true),
  notify_email: z.boolean().default(true),
  notify_whatsapp: z.boolean().default(true),
  notify_sms: z.boolean().default(false)
});

export const StudentInput = z.object({
  admission_no: z.string().trim().min(1).max(40),
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
  other_names: z.string().trim().max(80).nullish(),
  gender: z.enum(["male", "female", "other"]).nullish(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  class_group_id: z.string().uuid().nullish().or(z.literal("")),
  photo_url: z.string().trim().url().nullish().or(z.literal("")),
  address: z.string().trim().max(300).nullish(),
  medical_notes: z.string().trim().max(1000).nullish(),
  status: z.enum(["active", "graduated", "withdrawn", "suspended"]).optional()
});

export function cleanStudent(s: Partial<z.infer<typeof StudentInput>>) {
  const out: Record<string, unknown> = { ...s };
  for (const k of ["date_of_birth", "class_group_id", "photo_url"]) if (out[k] === "") out[k] = null;
  return out;
}
