-- Order-first purchasing: a PO can be raised and sent to the supplier BEFORE
-- stock arrives (status 'ordered'). Nothing is owed and no stock moves until
-- the goods are received against it.

alter table public.supplier_purchase_orders
  add column if not exists sent_at timestamptz,
  add column if not exists sent_via text,
  add column if not exists expected_date date;

-- 'ordered' POs must never count as money owed to the supplier.
create or replace function public.update_supplier_totals_on_po()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'auth'
as $function$
begin
  update suppliers
  set
    total_owed = coalesce((
      select sum(invoice_total) from supplier_purchase_orders
      where supplier_id = new.supplier_id and status not in ('cancelled', 'ordered')
    ), 0),
    total_paid = coalesce((
      select sum(amount) from supplier_payments
      where supplier_id = new.supplier_id
    ), 0)
  where id = new.supplier_id;

  return new;
end;
$function$;
