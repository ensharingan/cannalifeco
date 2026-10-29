-- Short deliveries raise a credit (RFC): when a supplier invoice is captured and a line's received
-- quantity is below the invoiced quantity, po_raise_short_delivery_rfc() raises a draft RFC for that
-- supplier for the shortfall (credit note or refund). Only the received quantity is added to stock
-- (apply_purchase_order_stock honours received_quantity). Also brings supplier_returns up to what the
-- RFC page already writes (rfc_number, items, totals), which this database was missing.
-- Access: SECURITY DEFINER, same-company check, cashier/staff refused, revoked from public / anon.

alter table public.supplier_returns
  add column if not exists rfc_number text,
  add column if not exists supplier_name text,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists total_credit numeric not null default 0,
  add column if not exists total_amount numeric not null default 0,
  add column if not exists store_id uuid,
  add column if not exists reference text,
  add column if not exists created_by_name text,
  add column if not exists resolution text not null default 'credit',
  add column if not exists source text,
  add column if not exists supplier_purchase_order_id uuid references public.supplier_purchase_orders(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_returns_resolution_chk') then
    alter table public.supplier_returns
      add constraint supplier_returns_resolution_chk check (resolution in ('credit', 'refund'));
  end if;
end $$;

-- ───────────────────────── 1. supplier stock ─────────────────────────

create or replace function public.apply_purchase_order_stock(p_po_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_po        supplier_purchase_orders%ROWTYPE;
  v_store_id  uuid;
  v_item      jsonb;
  v_name      text;
  v_qty       numeric;
  v_cost      numeric;
  v_pid       uuid;
  v_prev      numeric;
  v_new       numeric;
  v_supplier  text;
  v_applied   jsonb := '[]'::jsonb;
  v_skipped   jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_po FROM supplier_purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  IF v_po.stock_applied THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_applied',
                              'applied_at', v_po.stock_applied_at);
  END IF;

  v_store_id := v_po.store_id;
  IF v_store_id IS NULL THEN
    SELECT id INTO v_store_id FROM stores WHERE company_id = v_po.company_id LIMIT 1;
  END IF;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'No store available to receive stock for company %', v_po.company_id;
  END IF;

  SELECT name INTO v_supplier FROM suppliers WHERE id = v_po.supplier_id;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements((v_po.items #>> '{}')::jsonb)
  LOOP
    v_name := trim(COALESCE(v_item->>'product_name', v_item->>'name', ''));
    -- received_quantity (what physically arrived) wins over the invoiced quantity
    v_qty  := COALESCE(NULLIF(v_item->>'received_quantity','')::numeric,
                       NULLIF(v_item->>'quantity','')::numeric, 0);
    v_cost := NULLIF(v_item->>'cost_price','')::numeric;
    v_pid  := NULL;

    BEGIN
      v_pid := NULLIF(v_item->>'product_id','')::uuid;
    EXCEPTION WHEN others THEN
      v_pid := NULL;
    END;

    IF v_pid IS NOT NULL THEN
      SELECT id INTO v_pid FROM products
       WHERE id = v_pid AND company_id = v_po.company_id;
    END IF;

    IF v_pid IS NULL AND v_name <> '' THEN
      SELECT id INTO v_pid FROM products
       WHERE company_id = v_po.company_id
         AND lower(trim(name)) = lower(v_name)
       ORDER BY created_at
       LIMIT 1;
    END IF;

    -- nothing arrived on this line (counted 0): nothing to load, and not a "skipped" warning
    IF v_qty <= 0 AND NULLIF(v_item->>'received_quantity','') IS NOT NULL THEN
      CONTINUE;
    END IF;

    IF v_pid IS NULL OR v_qty <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object(
        'product_name', v_name,
        'quantity', v_qty,
        'reason', CASE WHEN v_pid IS NULL THEN 'no_matching_product' ELSE 'zero_quantity' END);
      CONTINUE;
    END IF;

    SELECT stock_quantity INTO v_prev
      FROM store_inventory
     WHERE store_id = v_store_id AND product_id = v_pid;

    v_prev := COALESCE(v_prev, 0);
    v_new  := v_prev + v_qty;

    INSERT INTO store_inventory (company_id, store_id, product_id, stock_quantity, updated_at)
    VALUES (v_po.company_id, v_store_id, v_pid, v_qty, now())
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET stock_quantity = store_inventory.stock_quantity + EXCLUDED.stock_quantity,
                  updated_at = now();

    UPDATE products p
       SET stock_quantity = (SELECT COALESCE(SUM(si.stock_quantity),0)
                               FROM store_inventory si WHERE si.product_id = p.id),
           updated_at = now()
     WHERE p.id = v_pid;

    INSERT INTO stock_movements (product_id, store_id, company_id, movement_type,
                                 quantity, previous_qty, new_qty,
                                 supplier_id, supplier_name, cost_price, notes, created_at)
    VALUES (v_pid, v_store_id, v_po.company_id, 'purchase',
            v_qty, v_prev, v_new,
            v_po.supplier_id, v_supplier, v_cost,
            'PO ' || COALESCE(v_po.order_number,'') , now());

    v_applied := v_applied || jsonb_build_object(
      'product_id', v_pid, 'product_name', v_name,
      'quantity', v_qty, 'previous_qty', v_prev, 'new_qty', v_new);
  END LOOP;

  UPDATE supplier_purchase_orders
     SET stock_applied = true, stock_applied_at = now(), updated_at = now()
   WHERE id = p_po_id;

  RETURN jsonb_build_object(
    'ok', true,
    'order_number', v_po.order_number,
    'store_id', v_store_id,
    'applied_count', jsonb_array_length(v_applied),
    'skipped_count', jsonb_array_length(v_skipped),
    'applied', v_applied,
    'skipped', v_skipped);
END;
$function$;

-- Raise (once) a draft RFC for the items on a supplier invoice that were not delivered.
create or replace function public.po_raise_short_delivery_rfc(
  p_po_id uuid,
  p_resolution text default 'credit'   -- 'credit' (credit note) or 'refund'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_co uuid;
  v_role text;
  v_po supplier_purchase_orders%rowtype;
  v_item jsonb;
  v_inv numeric;
  v_rec numeric;
  v_short numeric;
  v_cost numeric;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_supplier text;
  v_rfc text;
  v_id uuid;
  v_res text := case when p_resolution = 'refund' then 'refund' else 'credit' end;
begin
  select company_id, role into v_co, v_role from profiles where id = v_uid;
  if v_co is null or v_role in ('cashier', 'staff') then raise exception 'Not authorised'; end if;
  select * into v_po from supplier_purchase_orders where id = p_po_id and company_id = v_co;
  if not found then raise exception 'Purchase order not found'; end if;

  select id, rfc_number into v_id, v_rfc from supplier_returns
   where supplier_purchase_order_id = p_po_id and source = 'short_delivery' limit 1;
  if found then
    return jsonb_build_object('ok', true, 'already_raised', true, 'rfc_id', v_id, 'rfc_number', v_rfc);
  end if;

  for v_item in select * from jsonb_array_elements((v_po.items #>> '{}')::jsonb) loop
    v_inv := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    if nullif(v_item->>'received_quantity','') is null then continue; end if;
    v_rec := (v_item->>'received_quantity')::numeric;
    v_short := v_inv - v_rec;
    continue when v_short <= 0;
    v_cost := coalesce(nullif(v_item->>'cost_price','')::numeric, 0);
    v_items := v_items || jsonb_build_object(
      'product_id', nullif(v_item->>'product_id',''),
      'product_name', coalesce(v_item->>'product_name', v_item->>'name', ''),
      'quantity', v_short, 'unit_cost', v_cost, 'line_total', round(v_short * v_cost, 2));
    v_total := v_total + round(v_short * v_cost, 2);
  end loop;

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('ok', true, 'nothing_short', true);
  end if;

  select name into v_supplier from suppliers where id = v_po.supplier_id;
  v_rfc := 'RFC-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
  insert into supplier_returns (company_id, rfc_number, supplier_id, supplier_name, reason, status, notes, items,
                                total_credit, total_amount, store_id, created_by, reference, source,
                                supplier_purchase_order_id, resolution)
  values (v_po.company_id, v_rfc, v_po.supplier_id, coalesce(v_supplier, ''), 'short_delivery', 'draft',
          'Short delivery on invoice ' || coalesce(v_po.order_number, left(v_po.id::text, 8))
            || '. Supplier to ' || case when v_res = 'refund' then 'refund' else 'issue a credit note for' end
            || ' the items not delivered.',
          v_items, v_total, v_total, v_po.store_id, v_uid, v_po.order_number, 'short_delivery', v_po.id, v_res)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'rfc_id', v_id, 'rfc_number', v_rfc, 'credit_total', v_total);
end $function$;

revoke all on function public.po_raise_short_delivery_rfc(uuid, text) from public, anon;
grant execute on function public.po_raise_short_delivery_rfc(uuid, text) to authenticated, service_role;


-- the RFC page stores its lines in items jsonb, so the old single-product columns must not be required
alter table public.supplier_returns alter column quantity drop not null;
alter table public.supplier_returns alter column product_id drop not null;
alter table public.supplier_returns alter column supplier_id drop not null;
