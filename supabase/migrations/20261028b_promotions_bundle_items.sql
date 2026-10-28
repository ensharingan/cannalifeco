-- Per-item pricing for Bundle Deal promotions.
--
-- bundle_items is a jsonb array of per-product rules, e.g.
--   [{"product_id":"<uuid>","mode":"percent","value":10},
--    {"product_id":"<uuid>","mode":"price","value":450},
--    {"product_id":"<uuid>","mode":"none","value":0}]
-- mode: percent = % off that item, price = fixed bundle price per unit,
--       none = no discount on that item.
-- Products in applicable_products without a rule keep using discount_value (%),
-- so every existing bundle behaves exactly as before.
-- Additive only.

alter table public.promotions
  add column if not exists bundle_items jsonb not null default '[]'::jsonb;
