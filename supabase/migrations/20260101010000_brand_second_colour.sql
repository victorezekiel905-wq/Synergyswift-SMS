-- 10000: a school's second colour (small details: the rule and label above page titles,
-- small markers), next to its main colour (brand_color). Empty means Synergy Swift's brass.
-- Safe to run again.
alter table public.tenant_settings add column if not exists brand_color_2 text;
do $$ begin
  alter table public.tenant_settings add constraint brand_color_2_hex check (brand_color_2 is null or brand_color_2 ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;
