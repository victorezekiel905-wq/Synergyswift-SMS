import { z } from "zod";
import { LANGUAGES } from "./languages";

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
  notify_sms: z.boolean().default(false),
  language: z.string().max(5).regex(/^[a-z]{2}$/).nullish()
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

/** School settings, edited by the school's admins and by platform admins. */
const settingsTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
export const TenantSettingsInput = z.object({
  school_name: z.string().trim().max(160).nullish(),
  motto: z.string().trim().max(200).nullish(),
  address: z.string().trim().max(300).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().or(z.literal("")).nullish(),
  logo_url: z.string().trim().url().or(z.literal("")).nullish(),
  principal_name: z.string().trim().max(120).nullish(),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sender_name: z.string().trim().max(80).nullish(),
  reply_to_email: z.string().trim().email().or(z.literal("")).nullish(),
  notify_gate_events: z.boolean().optional(),
  notify_results: z.boolean().optional(),
  staff_start_time: settingsTime.optional(),
  student_start_time: settingsTime.optional(),
  geofence_lat: z.number().min(-90).max(90).nullish(),
  geofence_lng: z.number().min(-180).max(180).nullish(),
  geofence_radius_m: z.number().int().min(20).max(20000).nullish(),
  library_loan_days: z.number().int().min(1).max(365).optional(),
  library_fine_per_day: z.number().min(0).optional(),
  currency: z.string().trim().max(8).optional(),
  pickup_code_ttl_min: z.number().int().min(10).max(1440).optional(),
  exam_violation_limit: z.number().int().min(1).max(50).optional(),
  sms_mode: z.enum(["off", "fallback", "always"]).optional(),
  require_mfa: z.enum(["off", "admins", "staff"]).optional(),
  default_language: z.string().refine(l => l in LANGUAGES, "unsupported language").optional(),
  payment_provider: z.enum(["paystack", "flutterwave"]).nullish(),
  payment_subaccount: z.string().trim().max(60).nullish(),
  bank_details: z.string().trim().max(400).nullish(),
  withhold_results_for_debtors: z.boolean().optional(),
  admissions_open: z.boolean().optional(),
  application_fee: z.number().min(0).max(1e9).optional(),
  admissions_intro: z.string().trim().max(3000).nullish()
});
