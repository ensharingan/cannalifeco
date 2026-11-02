-- Reason a cashier gave for a manual (line or cart-level) discount.
alter table public.orders add column if not exists discount_note text;
