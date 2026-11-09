-- Temporary admin tool: merge stock of a duplicate product into the one being kept.
-- Owner/admin only. Logs an 'adjustment' movement on both products per store.
create extension if not exists pg_trgm with schema extensions;

create or replace function public.duplicate_candidates(p_store uuid default null)
returns table(category text, a_id uuid, a_name text, a_store numeric, a_total numeric,
              b_id uuid, b_name text, b_store numeric, b_total numeric, sim numeric)
language plpgsql security definer set search_path to 'public' as $$
declare v_co uuid; v_role text;
begin
  select p.company_id, p.role into v_co, v_role from profiles p where p.id = auth.uid();
  if v_co is null or v_role not in ('owner','admin','superadmin') then raise exception 'Owner or admin only'; end if;
  return query
  with p as (
    select pr.id, pr.name, pr.category,
           regexp_replace(lower(pr.name),'[^a-z0-9]+',' ','g') n,
           regexp_replace(lower(pr.name),'[^0-9]+',' ','g') dg
    from products pr where pr.company_id = v_co and pr.is_active),
  st as (select si.product_id, sum(si.stock_quantity) tot,
                sum(si.stock_quantity) filter (where si.store_id = p_store) here
         from store_inventory si where si.company_id = v_co group by 1)
  select a.category, a.id, a.name, coalesce(sa.here,0), coalesce(sa.tot,0),
         b.id, b.name, coalesce(sb.here,0), coalesce(sb.tot,0),
         round(extensions.similarity(a.n,b.n)::numeric,2)
  from p a join p b on a.id < b.id and a.category = b.category and a.dg = b.dg
       and extensions.similarity(a.n,b.n) >= 0.6
  left join st sa on sa.product_id = a.id left join st sb on sb.product_id = b.id
  where p_store is null or coalesce(sa.here,0) <> 0 or coalesce(sb.here,0) <> 0
  order by 1, 3;
end $$;

create or replace function public.product_merge_stock(p_keep uuid, p_remove uuid, p_store uuid default null, p_retire boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_co uuid; v_role text; k record; r record; row record;
  v_kb numeric; v_moved numeric := 0; v_stores int := 0; v_left numeric; v_pending int;
begin
  select p.company_id, p.role into v_co, v_role from profiles p where p.id = auth.uid();
  if v_co is null or v_role not in ('owner','admin','superadmin') then raise exception 'Owner or admin only'; end if;
  if p_keep = p_remove then raise exception 'Pick two different products'; end if;
  select * into k from products where id = p_keep and company_id = v_co;
  select * into r from products where id = p_remove and company_id = v_co;
  if k.id is null or r.id is null then raise exception 'Product not found'; end if;

  for row in
    select si.store_id, si.stock_quantity from store_inventory si
    where si.product_id = p_remove and si.company_id = v_co and si.stock_quantity <> 0
      and (p_store is null or si.store_id = p_store)
  loop
    select coalesce(sum(stock_quantity),0) into v_kb from store_inventory where product_id = p_keep and store_id = row.store_id;
    insert into store_inventory(company_id, store_id, product_id, stock_quantity, low_stock_threshold)
      values (v_co, row.store_id, p_keep, 0, 5) on conflict do nothing;
    update store_inventory set stock_quantity = v_kb + row.stock_quantity, updated_at = now()
      where product_id = p_keep and store_id = row.store_id;
    update store_inventory set stock_quantity = 0, updated_at = now()
      where product_id = p_remove and store_id = row.store_id;
    insert into inventory_movements(company_id, store_id, product_id, product_name, movement_type, quantity, quantity_change, previous_qty, new_qty, reason, notes, created_by, created_at)
    values (v_co, row.store_id, p_keep, k.name, 'adjustment', abs(row.stock_quantity), row.stock_quantity, v_kb, v_kb + row.stock_quantity, 'Duplicate merge', 'Merged from ' || r.name, auth.uid(), now()),
           (v_co, row.store_id, p_remove, r.name, 'adjustment', abs(row.stock_quantity), -row.stock_quantity, row.stock_quantity, 0, 'Duplicate merge', 'Merged into ' || k.name, auth.uid(), now());
    v_moved := v_moved + row.stock_quantity; v_stores := v_stores + 1;
  end loop;

  update products p set stock_quantity = (select coalesce(sum(si.stock_quantity),0) from store_inventory si where si.product_id = p.id), updated_at = now()
  where p.id in (p_keep, p_remove);

  select coalesce(sum(stock_quantity),0) into v_left from store_inventory where product_id = p_remove;
  if p_retire and v_left = 0 then update products set is_active = false, updated_at = now() where id = p_remove; end if;

  select count(*) into v_pending from stock_count_items i join stock_counts sc on sc.id = i.count_id
  where i.product_id = p_remove and sc.status in ('in_progress','paused','submitted');

  return jsonb_build_object('moved', v_moved, 'stores', v_stores, 'left_on_duplicate', v_left,
                            'retired', (p_retire and v_left = 0), 'pending_count_rows', v_pending);
end $$;

grant execute on function public.duplicate_candidates(uuid) to authenticated;
grant execute on function public.product_merge_stock(uuid, uuid, uuid, boolean) to authenticated;
