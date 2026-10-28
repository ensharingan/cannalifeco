-- Stock vs revenue reconciliation for the End of Day page (owner / manager only).
--
-- For a date range and store scope it returns, per product:
--   * opening / closing stock at the shop front and in the warehouse
--     (derived by reversing inventory_movements from today's balances)
--   * units sold per the ORDERS vs units deducted per the stock LEDGER
--   * expected revenue (units x list price) vs actual revenue (after discounts)
-- plus the full stock movement log for the range.
--
-- Scoping: owners / superadmins see the company, managers see their assigned stores. Cashiers / staff are refused (stock and cost are owner data).
-- Additive only: one new function.

create or replace function public.report_stock_reconciliation(
  p_from    date default current_date,
  p_to      date default null,
  p_store   uuid default null,
  p_company uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_role       text;
  v_profile_co uuid;
  v_profile_st uuid;
  v_company    uuid;
  v_head       boolean := false;
  v_allowed    uuid[];
  v_from       timestamptz;
  v_to         timestamptz;
  v_end        date := coalesce(p_to, p_from);
  v_items      jsonb := '[]'::jsonb;
  v_moves      jsonb := '[]'::jsonb;
  v_store_name text;
begin
  if v_uid is null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Not authorised';
    end if;
    v_company := p_company;
    v_head    := true;
    v_role    := 'superadmin';
  else
    select p.role, p.company_id, p.store_id
      into v_role, v_profile_co, v_profile_st
      from profiles p
     where p.id = v_uid and p.removed_at is null;
    if v_role is null then
      raise exception 'Not authorised';
    end if;
    v_company := case when v_role = 'superadmin' then coalesce(v_profile_co, p_company)
                      else v_profile_co end;
        v_head := v_role in ('owner', 'superadmin') or public.is_head_office();
  end if;

  if v_company is null then
    raise exception 'No company context';
  end if;
  if v_role in ('cashier', 'staff', 'budtender') then
    raise exception 'Stock reconciliation is for owners and managers';
  end if;
  if v_end < p_from then
    raise exception 'End date is before start date';
  end if;
  if v_end - p_from > 92 then
    raise exception 'Please pick a range of 92 days or less';
  end if;

  if not v_head then
    select coalesce(array_agg(distinct x.store_id), '{}')
      into v_allowed
      from (
        select a.store_id from cashier_store_assignments a where a.cashier_id = v_uid
        union
        select v_profile_st where v_profile_st is not null
      ) x
     where x.store_id in (select s.id from stores s where s.company_id = v_company);
  end if;

  if p_store is not null then
    select name into v_store_name
      from stores where id = p_store and company_id = v_company;
    if v_store_name is null then
      raise exception 'Store not found for this company';
    end if;
    if v_allowed is not null and not (p_store = any(v_allowed)) then
      raise exception 'Not authorised for that store';
    end if;
  end if;

  v_from := (p_from::timestamp) at time zone 'Africa/Johannesburg';
  v_to   := ((v_end + 1)::timestamp) at time zone 'Africa/Johannesburg';

  ------------------------------------------------------------------ items
  with scope_stores as (
    select s.id
      from stores s
     where s.company_id = v_company
       and (p_store is null or s.id = p_store)
       and (v_allowed is null or s.id = any(v_allowed))
  ),
  -- Revenue: line value prorated for order-level discounts (same as End of Day).
  li_raw as (
    select o.id                                         as order_id,
           coalesce(o.total_amount,0)                   as order_paid,
           nullif(it->>'product_id','')::uuid           as product_id,
           nullif(btrim(coalesce(it->>'name','')),'')   as item_name,
           nullif(btrim(coalesce(it->>'sku','')),'')    as sku,
           nullif(btrim(coalesce(it->>'category','')),'') as category,
           budify_num(it->>'quantity')                  as qty,
           budify_num(it->>'price')                     as price
      from orders o
      cross join lateral jsonb_array_elements(budify_jsonb_array(o.items)) it
     where o.company_id = v_company
       and o.created_at >= v_from and o.created_at < v_to
       and o.store_id in (select id from scope_stores)
       and o.status = 'completed'
  ),
  li as (
    select r.*,
           case when og.order_gross > 0
                then (r.qty * r.price) * r.order_paid / og.order_gross
                else 0 end as line_net
      from li_raw r
      join (select order_id, sum(qty * price) as order_gross
              from li_raw group by order_id) og on og.order_id = r.order_id
  ),
  sold as (
    select product_id,
           case when product_id is null then 'n:' || coalesce(item_name,'(unnamed)') else product_id::text end as k,
           max(item_name) as item_name, max(sku) as sku, max(category) as category,
           sum(qty) as units, sum(qty * price) as expected, sum(line_net) as actual
      from li
     group by 1, 2
  ),
  mv as (
    select m.product_id, m.movement_type, m.created_at,
           coalesce(m.quantity,0)        as q,
           coalesce(m.quantity_change,0) as qc,
           case when m.movement_type in ('sale','in','return','restock','transfer_in','transfer_out',
                                         'stock_take','room_transfer','warehouse_to_front','warehouse_to_warehouse')
                then coalesce(m.quantity_change,0) else 0 end as fd,
           case m.movement_type
             when 'warehouse_receive'      then coalesce(m.quantity,0)
             when 'warehouse_to_front'     then -coalesce(m.quantity,0)
             when 'warehouse_to_warehouse' then coalesce(m.quantity,0)
             when 'warehouse_stock_take'   then coalesce(m.quantity_change,0)
             when 'warehouse_migrate'      then coalesce(m.quantity,0)
             else 0 end as wd
      from inventory_movements m
     where m.company_id = v_company
       and m.store_id in (select id from scope_stores)
       and m.created_at >= v_from
  ),
  mvagg as (
    select product_id,
           sum(fd) filter (where created_at >= v_to)                         as front_after,
           sum(wd) filter (where created_at >= v_to)                         as wh_after,
           sum(fd) filter (where created_at <  v_to)                         as front_in,
           sum(wd) filter (where created_at <  v_to)                         as wh_in,
           -sum(qc) filter (where movement_type = 'sale' and created_at < v_to)          as ledger_sold,
           sum(qc)  filter (where movement_type in ('in','return') and created_at < v_to) as refund_back,
           sum(qc)  filter (where movement_type in ('restock','transfer_in') and created_at < v_to) as received,
           -sum(qc) filter (where movement_type = 'transfer_out' and created_at < v_to)  as sent_out,
           sum(qc)  filter (where movement_type = 'stock_take' and created_at < v_to)    as stock_take,
           sum(qc)  filter (where movement_type in ('room_transfer','warehouse_to_front') and created_at < v_to) as from_wh,
           -sum(qc) filter (where movement_type = 'warehouse_to_warehouse' and created_at < v_to) as to_wh,
           sum(wd)  filter (where movement_type = 'warehouse_receive' and created_at < v_to)     as wh_received,
           sum(wd)  filter (where movement_type in ('warehouse_stock_take','warehouse_migrate') and created_at < v_to) as wh_adjust
      from mv
     group by product_id
  ),
  inv as (
    select si.product_id, sum(si.stock_quantity) as front_now
      from store_inventory si
     where si.store_id in (select id from scope_stores)
     group by si.product_id
  ),
  wh as (
    select w.product_id, sum(w.quantity) as wh_now
      from (select null::uuid as product_id, 0::numeric as quantity) w  -- Budify has no separate warehouse stock
     where false
     group by w.product_id
  ),
  keys as (
    select product_id from inv
    union select product_id from wh
    union select product_id from mvagg
    union select product_id from sold where product_id is not null
  ),
  rows_ as (
    select k.product_id,
           coalesce(p.name, so.item_name, '(unnamed)')           as name,
           coalesce(p.sku, so.sku)                               as sku,
           coalesce(p.category, so.category, 'Uncategorised')    as category,
           coalesce(so.units,0)                                  as units_sold,
           coalesce(so.expected,0)                               as expected_revenue,
           coalesce(so.actual,0)                                 as actual_revenue,
           coalesce(a.ledger_sold,0)                             as ledger_sold,
           coalesce(a.refund_back,0)                             as refund_back,
           coalesce(a.received,0)                                as received,
           coalesce(a.sent_out,0)                                as sent_out,
           coalesce(a.stock_take,0)                              as stock_take,
           coalesce(a.from_wh,0)                                 as from_wh,
           coalesce(a.to_wh,0)                                   as to_wh,
           coalesce(a.wh_received,0)                             as wh_received,
           coalesce(a.wh_adjust,0)                               as wh_adjust,
           coalesce(i.front_now,0) - coalesce(a.front_after,0)   as closing_front,
           coalesce(i.front_now,0) - coalesce(a.front_after,0) - coalesce(a.front_in,0) as opening_front,
           coalesce(w.wh_now,0)    - coalesce(a.wh_after,0)      as closing_wh,
           coalesce(w.wh_now,0)    - coalesce(a.wh_after,0) - coalesce(a.wh_in,0) as opening_wh,
           coalesce(i.front_now,0)                               as front_now,
           coalesce(w.wh_now,0)                                  as wh_now
      from keys k
      left join products p on p.id = k.product_id
      left join sold so on so.product_id = k.product_id
      left join mvagg a on a.product_id = k.product_id
      left join inv i on i.product_id = k.product_id
      left join wh  w on w.product_id = k.product_id
  ),
  -- Sold lines with no product id (custom items) still need to show up.
  custom as (
    select null::uuid as product_id, so.item_name as name, so.sku,
           coalesce(so.category,'Uncategorised') as category,
           so.units as units_sold, so.expected as expected_revenue, so.actual as actual_revenue,
           0::numeric as ledger_sold, 0::numeric as refund_back, 0::numeric as received, 0::numeric as sent_out,
           0::numeric as stock_take, 0::numeric as from_wh, 0::numeric as to_wh,
           0::numeric as wh_received, 0::numeric as wh_adjust,
           0::numeric as closing_front, 0::numeric as opening_front,
           0::numeric as closing_wh, 0::numeric as opening_wh,
           0::numeric as front_now, 0::numeric as wh_now
      from sold so where so.product_id is null
  ),
  allrows as (
    select * from rows_
     where units_sold <> 0 or ledger_sold <> 0 or refund_back <> 0 or received <> 0 or sent_out <> 0
        or stock_take <> 0 or from_wh <> 0 or to_wh <> 0 or wh_received <> 0 or wh_adjust <> 0
        or front_now <> 0 or wh_now <> 0 or closing_front <> 0 or closing_wh <> 0
    union all
    select * from custom
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id',       product_id,
           'name',             name,
           'sku',              sku,
           'category',         category,
           'opening_front',    round(opening_front,3),
           'received',         round(received + refund_back,3),
           'refund_back',      round(refund_back,3),
           'from_warehouse',   round(from_wh,3),
           'to_warehouse',     round(to_wh,3),
           'transfer_out',     round(sent_out,3),
           'adjustments',      round(stock_take,3),
           'ledger_sold',      round(ledger_sold,3),
           'closing_front',    round(closing_front,3),
           'opening_wh',       round(opening_wh,3),
           'wh_received',      round(wh_received,3),
           'wh_adjust',        round(wh_adjust,3),
           'closing_wh',       round(closing_wh,3),
           'units_sold',       round(units_sold,3),
           'expected_revenue', round(expected_revenue,2),
           'actual_revenue',   round(actual_revenue,2),
           'revenue_diff',     round(actual_revenue - expected_revenue,2),
           'stock_diff',       round(units_sold - (ledger_sold - refund_back),3)
         ) order by abs(units_sold - (ledger_sold - refund_back)) desc, actual_revenue desc, name), '[]'::jsonb)
    into v_items
    from allrows;

  ------------------------------------------------------------- movement log
  select coalesce(jsonb_agg(x.j order by x.ts desc), '[]'::jsonb)
    into v_moves
    from (
      select m.created_at as ts,
             jsonb_build_object(
               'time',       to_char(m.created_at at time zone 'Africa/Johannesburg','YYYY-MM-DD HH24:MI'),
               'store',      coalesce(st.name,'-'),
               'product_id', m.product_id,
               'product',    coalesce(m.product_name, p.name, '-'),
               'type',       m.movement_type,
               'qty',        round(coalesce(m.quantity, abs(m.quantity_change), 0),3),
               'front_change', case when m.movement_type in ('sale','in','return','restock','transfer_in','transfer_out',
                                                          'stock_take','room_transfer','warehouse_to_front','warehouse_to_warehouse')
                                    then round(coalesce(m.quantity_change,0),3) else 0 end,
               'wh_change',  round(case m.movement_type
                               when 'warehouse_receive'      then coalesce(m.quantity,0)
                               when 'warehouse_to_front'     then -coalesce(m.quantity,0)
                               when 'warehouse_to_warehouse' then coalesce(m.quantity,0)
                               when 'warehouse_stock_take'   then coalesce(m.quantity_change,0)
                               when 'warehouse_migrate'      then coalesce(m.quantity,0)
                               else 0 end,3),
               'reason',     coalesce(m.reason, m.notes, ''),
               'user',       coalesce(pr.full_name, pr.email, ''),
               'reference',  m.reference_id
             ) as j
        from inventory_movements m
        left join stores   st on st.id = m.store_id
        left join products p  on p.id  = m.product_id
        left join profiles pr on pr.id = m.created_by
       where m.company_id = v_company
         and m.store_id in (select s.id from stores s
                             where s.company_id = v_company
                               and (p_store is null or s.id = p_store)
                               and (v_allowed is null or s.id = any(v_allowed)))
         and m.created_at >= v_from and m.created_at < v_to
       order by m.created_at desc
       limit 3000
    ) x;

  return jsonb_build_object(
    'from',         p_from,
    'to',           v_end,
    'generated_at', to_char(now() at time zone 'Africa/Johannesburg','YYYY-MM-DD HH24:MI'),
    'store_id',     p_store,
    'store_name',   coalesce(v_store_name, 'All stores'),
    'items',        v_items,
    'movements',    v_moves
  );
end;
$function$;

revoke all on function public.report_stock_reconciliation(date, date, uuid, uuid) from public, anon;
grant execute on function public.report_stock_reconciliation(date, date, uuid, uuid) to authenticated, service_role;
