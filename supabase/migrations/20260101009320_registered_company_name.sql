-- =========================================================================
-- The company is registered: Synergy Swift Technology Limited, RC 9979873
-- (CAC, 2 November 2026). Invoices and billing emails take the company name from
-- the platform's billing setting, which was seeded with a placeholder spelling
-- ("Technologies"). Corrected here only while it still holds that placeholder, so a
-- name the owner typed in Platform → Plans is never overwritten. Idempotent.
-- =========================================================================

update public.platform_settings
   set value = jsonb_set(value, '{company}', '"Synergy Swift Technology Limited"'::jsonb)
 where key = 'billing'
   and value ->> 'company' = 'Synergy Swift Technologies Limited';
