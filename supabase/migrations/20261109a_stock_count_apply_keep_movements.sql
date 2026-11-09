-- Approving a stock count used to overwrite store stock with the counted number,
-- wiping anything received (transfers, GRVs) or sold between the moment the
-- item was counted and the moment the manager approved. Levitate lost 224
-- received units this way (TRF000007 received 7 Nov 08:20, count approved 16:21).
-- New stock = counted qty + net of non-count movements recorded AFTER the item was counted.
create or replace function public.stock_count_apply(p_count_id uuid, p_uncounted text default 'skip', p_notes text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  g record; v_store uuid; v_company uuid; rec record;
  v_prev numeric; v_target numeric; v_after numeric;
  v_applied int := 0; v_skipped int := 0; v_value numeric := 0;
begin
  select * into g from public.stock_count_guard(p_count_id, true);
  if g.status in ('completed','cancelled') then raise exception 'This count is already %', g.status; end if;
  v_store := g.store_id; v_company := g.company_id;

  for rec in
    select i.product_id, i.product_name, i.unit_cost, i.counted_at,
           case when i.counted_qty is null and coalesce(p_uncounted,'skip') = 'zero' then 0 else i.counted_qty end as counted
    from stock_count_items i
    where i.count_id = p_count_id and not i.excluded
  loop
    if rec.counted is null then v_skipped := v_skipped + 1; continue; end if;

    select si.stock_quantity into v_prev from store_inventory si
    where si.store_id = v_store and si.product_id = rec.product_id;

    if v_prev is null then
      insert into store_inventory (company_id, store_id, product_id, stock_quantity, low_stock_threshold)
      values (v_company, v_store, rec.product_id, 0, 5) on conflict do nothing;
      v_prev := 0;
    end if;

    -- stock that moved after this item was counted (sales, transfers in/out, GRVs...) must survive
    select coalesce(sum(m.quantity_change), 0) into v_after
    from inventory_movements m
    where m.store_id = v_store and m.product_id = rec.product_id
      and rec.counted_at is not null and m.created_at > rec.counted_at
      and m.movement_type not in ('stock_take','stock_take_reversal');
    v_target := rec.counted + v_after;

    if v_prev = v_target then v_skipped := v_skipped + 1; continue; end if;

    update store_inventory set stock_quantity = v_target, updated_at = now()
    where store_id = v_store and product_id = rec.product_id;
    update products p set stock_quantity = (select coalesce(sum(si.stock_quantity),0) from store_inventory si where si.product_id = p.id), updated_at = now()
    where p.id = rec.product_id;

    insert into inventory_movements
      (company_id, store_id, product_id, product_name, movement_type, quantity, quantity_change, previous_qty, new_qty, reason, notes, reference_id, created_by, created_at)
    values
      (v_company, v_store, rec.product_id, rec.product_name, 'stock_take', abs(v_target - v_prev), v_target - v_prev, v_prev, v_target,
       'Stock count', coalesce(p_notes, 'Stock count ' || p_count_id::text), p_count_id, auth.uid(), now());

    v_value := v_value + (v_target - v_prev) * coalesce(rec.unit_cost,0);
    v_applied := v_applied + 1;
  end loop;

  update stock_counts set status = 'completed', completed_at = now(), completed_by = auth.uid(), updated_at = now(), notes = coalesce(p_notes, notes)
  where id = p_count_id;
  return jsonb_build_object('status','ok','applied',v_applied,'skipped',v_skipped,'value_change',v_value);
end;
$function$;
