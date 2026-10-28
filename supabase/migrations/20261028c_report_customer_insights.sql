-- High-value customer / buying-pattern report for the Loyalty page (owner / manager only).
-- POPIA: returns member name, phone and email, so it is restricted to owners, superadmins and
-- managers (cashier / staff / budtender refused), scoped to the caller's company and, for managers,
-- to their assigned stores. SECURITY DEFINER; revoked from public / anon.
--
-- One RPC returns, for a date range and store scope:
--   * summary      - buyers, member revenue, VIP count and their share of revenue, repeat rate ...
--   * customers    - the top N customers by spend with full detail (visit rhythm, preferred day /
--                    time / store / payment, top categories and products, discounts, refunds,
--                    30-day trend, status active / at_risk / new / one_time)
--   * at_risk      - VIPs who have gone quiet (longer than 2x their usual gap, min 30 days)
--   * patterns     - weekday, hour, payment, store, category, product, order-value bands,
--                    visit-frequency and monthly trend, VIP vs everyone else
--   * comparison   - VIP vs the rest: basket size, items per order, discount rate ...
--
-- "VIP" = the top p_vip_pct percent of buying members by spend in the range (min. 1).
-- Only completed member orders count. Scoping mirrors report_end_of_day; cashiers / staff are
-- refused (this is customer contact + spend data). Additive only: one new function.

create or replace function public.report_customer_insights(
  p_from    date    default null,
  p_to      date    default null,
  p_store   uuid    default null,
  p_company uuid    default null,
  p_vip_pct numeric default 10,
  p_top     int     default 50
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
  v_today      date := (now() at time zone 'Africa/Johannesburg')::date;
  v_end        date;
  v_start      date;
  v_asof       date;
  v_from       timestamptz;
  v_to         timestamptz;
  v_vip        numeric := least(greatest(coalesce(p_vip_pct, 10), 1), 100);
  v_top        int     := least(greatest(coalesce(p_top, 50), 1), 200);
  v_store_name text;
  v_result     jsonb;
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
    raise exception 'Customer insights are for owners and managers';
  end if;

  v_end   := coalesce(p_to, v_today);
  v_start := coalesce(p_from, v_end - 89);
  if v_end < v_start then
    raise exception 'End date is before start date';
  end if;
  if v_end - v_start > 3700 then
    raise exception 'Please pick a range of 10 years or less';
  end if;
  v_asof := least(v_end, v_today);

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

  v_from := (v_start::timestamp) at time zone 'Africa/Johannesburg';
  v_to   := ((v_end + 1)::timestamp) at time zone 'Africa/Johannesburg';

  with
  scope_stores as (
    select s.id, s.name from stores s
     where s.company_id = v_company
       and (p_store is null or s.id = p_store)
       and (v_allowed is null or s.id = any(v_allowed))
  ),
  all_ord as (
    select o.id, o.member_id, o.store_id,
           coalesce(o.total_amount,0)    as amt,
           coalesce(o.discount_amount,0) as disc,
           coalesce(o.refund_total,0)    as refunded,
           lower(coalesce(nullif(o.payment_method,''),'unknown')) as pm,
           o.created_at,
           (o.created_at at time zone 'Africa/Johannesburg') as lt,
           o.items
      from orders o
     where o.company_id = v_company
       and o.status = 'completed'
       and o.created_at >= v_from and o.created_at < v_to
       and (p_store is null or o.store_id = p_store)
       and (v_allowed is null or o.store_id = any(v_allowed))
  ),
  ord as (select * from all_ord where member_id is not null),

  -- line items, prorated so a customer's lines add up to what they actually paid
  li_raw as (
    select o.id as order_id, o.member_id, o.amt as order_paid,
           nullif(it->>'product_id','')::uuid                   as product_id,
           nullif(btrim(coalesce(it->>'name','')),'')           as iname,
           nullif(btrim(coalesce(it->>'category','')),'')       as icat,
           budify_num(it->>'quantity')                          as qty,
           budify_num(it->>'price')                             as price
      from ord o
      cross join lateral jsonb_array_elements(budify_jsonb_array(o.items)) it
  ),
  li as (
    select r.*,
           case when og.g > 0 then r.qty * r.price * r.order_paid / og.g else 0 end as net,
           regexp_replace(lower(regexp_replace(coalesce(r.icat,'Uncategorised'),'[_ -]+',' ','g')),'s$','') as ckey,
           coalesce(r.product_id::text, 'n:' || coalesce(r.iname,'?')) as pkey
      from li_raw r
      join (select order_id, sum(qty * price) as g from li_raw group by order_id) og
        on og.order_id = r.order_id
  ),
  ou as (select order_id, sum(qty) as units from li group by order_id),
  mu as (select member_id, sum(qty) as units from li group by member_id),

  ma as (
    select member_id,
           count(*)                       as orders,
           sum(amt)                       as spend,
           avg(amt)                       as avg_order,
           min(created_at)                as first_at,
           max(created_at)                as last_at,
           min(lt::date)                  as first_day,
           max(lt::date)                  as last_day,
           count(distinct lt::date)       as visit_days,
           sum(disc)                      as disc,
           sum(refunded)                  as refunded,
           coalesce(sum(amt) filter (where created_at >= v_to - interval '30 days'), 0) as spend_30,
           coalesce(sum(amt) filter (where created_at >= v_to - interval '60 days'
                                       and created_at <  v_to - interval '30 days'), 0) as spend_prev30,
           mode() within group (order by store_id)                       as pref_store,
           mode() within group (order by pm)                             as pref_pay,
           mode() within group (order by extract(dow  from lt)::int)     as pref_dow,
           mode() within group (order by extract(hour from lt)::int)     as pref_hour
      from ord
     group by member_id
  ),
  rk as (
    select ma.*, coalesce(mu.units,0) as units,
           row_number() over (order by ma.spend desc, ma.orders desc, ma.member_id) as rn,
           count(*)     over ()                                                      as n,
           sum(ma.spend) over ()                                                     as total_spend,
           sum(ma.spend) over (order by ma.spend desc, ma.orders desc, ma.member_id) as cum_spend
      from ma left join mu on mu.member_id = ma.member_id
  ),
  rk2 as (
    select rk.*,
           (rn <= greatest(1, ceil(n * v_vip / 100.0)))                                   as is_vip,
           case when visit_days > 1
                then (last_day - first_day)::numeric / (visit_days - 1) end               as avg_gap,
           (v_asof - last_day)                                                            as days_since
      from rk
  ),
  mem as (
    select m.id, m.first_name, m.last_name, m.membership_id, m.phone, m.email,
           m.loyalty_points, null::int as lifetime_points, m.store_credit, m.created_at as joined
      from members m where m.company_id = v_company
  ),
  cust as (
    select r.*,
           coalesce(nullif(btrim(coalesce(m.first_name,'') || ' ' || coalesce(m.last_name,'')),''), 'Unknown member') as name,
           m.membership_id, m.phone, m.email, m.loyalty_points, m.lifetime_points, m.store_credit, m.joined,
           case
             when r.orders = 1 then case when m.joined >= v_from then 'new' else 'one_time' end
             when r.days_since > greatest(30, 2 * coalesce(r.avg_gap, 0)) then 'at_risk'
             when m.joined >= v_from and r.orders <= 3 then 'new'
             else 'active'
           end as status
      from rk2 r left join mem m on m.id = r.member_id
  ),
  tp as (select * from cust where rn <= v_top),

  mcat as (
    select l.member_id, l.ckey,
           initcap(replace(replace(max(coalesce(l.icat,'Uncategorised')),'_',' '),'-',' ')) as label,
           sum(l.net) as rev, sum(l.qty) as units
      from li l where l.member_id in (select member_id from tp)
     group by l.member_id, l.ckey
  ),
  mcat_r as (select *, row_number() over (partition by member_id order by rev desc) as r from mcat),
  mprod as (
    select l.member_id, l.pkey, max(coalesce(l.iname,'(unnamed)')) as label,
           sum(l.net) as rev, sum(l.qty) as units
      from li l where l.member_id in (select member_id from tp)
     group by l.member_id, l.pkey
  ),
  mprod_r as (select *, row_number() over (partition by member_id order by rev desc) as r from mprod),

  ov as (
    select o.*, r.is_vip, coalesce(ou.units,0) as units
      from ord o
      join rk2 r on r.member_id = o.member_id
      left join ou on ou.order_id = o.id
  ),
  lv as (
    select l.*, r.is_vip from li l join rk2 r on r.member_id = l.member_id
  )

  select jsonb_build_object(
    'range',   jsonb_build_object('from', v_start, 'to', v_end, 'as_of', v_asof),
    'vip_pct', v_vip,
    'store_name', coalesce(v_store_name, 'All stores'),
    'generated_at', to_char(now() at time zone 'Africa/Johannesburg','YYYY-MM-DD HH24:MI'),

    'summary', jsonb_build_object(
      'members_total',   (select count(*) from members m where m.company_id = v_company),
      'members_new',     (select count(*) from members m where m.company_id = v_company
                            and m.created_at >= v_from and m.created_at < v_to
                            ),
      'buying_members',  (select count(*) from rk2),
      'member_orders',   (select count(*) from ord),
      'member_spend',    (select round(coalesce(sum(amt),0),2) from ord),
      'all_orders',      (select count(*) from all_ord),
      'all_spend',       (select round(coalesce(sum(amt),0),2) from all_ord),
      'avg_order',       (select round(coalesce(avg(amt),0),2) from ord),
      'avg_orders_per_customer', (select round(coalesce(avg(orders),0),2) from rk2),
      'avg_spend_per_customer',  (select round(coalesce(avg(spend),0),2) from rk2),
      'repeat_customers', (select count(*) from rk2 where orders >= 2),
      'vip_count',       (select count(*) from rk2 where is_vip),
      'vip_spend',       (select round(coalesce(sum(spend) filter (where is_vip),0),2) from rk2),
      'at_risk_vips',    (select count(*) from cust where is_vip and status = 'at_risk'),
      'at_risk_spend',   (select round(coalesce(sum(spend),0),2) from cust where is_vip and status = 'at_risk')
    ),

    'customers', (
      select coalesce(jsonb_agg(c.j order by c.rn), '[]'::jsonb)
        from (
          select t.rn,
            jsonb_build_object(
              'rank', t.rn, 'member_id', t.member_id, 'name', t.name,
              'membership_id', t.membership_id, 'phone', t.phone, 'email', t.email,
              'loyalty_points', t.loyalty_points, 'lifetime_points', t.lifetime_points,
              'store_credit', t.store_credit, 'joined', t.joined::date,
              'is_vip', t.is_vip, 'status', t.status,
              'orders', t.orders, 'visit_days', t.visit_days,
              'spend', round(t.spend,2), 'avg_order', round(t.avg_order,2),
              'units', round(t.units,2),
              'share', round(100 * t.spend / nullif(t.total_spend,0), 2),
              'cum_share', round(100 * t.cum_spend / nullif(t.total_spend,0), 2),
              'first_order', t.first_day, 'last_order', t.last_day,
              'days_since', t.days_since,
              'avg_gap', round(t.avg_gap, 1),
              'discounts', round(t.disc,2),
              'discount_rate', round(100 * t.disc / nullif(t.spend + t.disc, 0), 1),
              'refunded', round(t.refunded,2),
              'spend_30', round(t.spend_30,2), 'spend_prev30', round(t.spend_prev30,2),
              'pref_store', (select s.name from scope_stores s where s.id = t.pref_store),
              'pref_pay', t.pref_pay, 'pref_dow', t.pref_dow, 'pref_hour', t.pref_hour,
              'top_categories', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'name', x.label, 'revenue', round(x.rev,2), 'units', round(x.units,2)) order by x.r), '[]'::jsonb)
                                   from mcat_r x where x.member_id = t.member_id and x.r <= 4),
              'top_products',   (select coalesce(jsonb_agg(jsonb_build_object(
                                    'name', x.label, 'revenue', round(x.rev,2), 'units', round(x.units,2)) order by x.r), '[]'::jsonb)
                                   from mprod_r x where x.member_id = t.member_id and x.r <= 5)
            ) as j
            from tp t
        ) c
    ),

    'at_risk', (
      select coalesce(jsonb_agg(a.j order by a.spend desc), '[]'::jsonb)
        from (
          select c.spend,
                 jsonb_build_object(
                   'member_id', c.member_id, 'name', c.name, 'phone', c.phone,
                   'membership_id', c.membership_id,
                   'spend', round(c.spend,2), 'orders', c.orders,
                   'last_order', c.last_day, 'days_since', c.days_since,
                   'avg_gap', round(c.avg_gap,1), 'rank', c.rn,
                   'pref_dow', c.pref_dow) as j
            from cust c where c.is_vip and c.status = 'at_risk'
           order by c.spend desc limit 25
        ) a
    ),

    'comparison', (
      select jsonb_build_object(
        'vip',  (select jsonb_build_object(
                   'customers', count(*) filter (where true),
                   'orders', coalesce(sum(orders),0),
                   'spend', round(coalesce(sum(spend),0),2),
                   'avg_spend_per_customer', round(coalesce(avg(spend),0),2),
                   'avg_orders_per_customer', round(coalesce(avg(orders),0),2),
                   'avg_gap_days', round(avg(avg_gap),1))
                 from rk2 where is_vip),
        'rest', (select jsonb_build_object(
                   'customers', count(*),
                   'orders', coalesce(sum(orders),0),
                   'spend', round(coalesce(sum(spend),0),2),
                   'avg_spend_per_customer', round(coalesce(avg(spend),0),2),
                   'avg_orders_per_customer', round(coalesce(avg(orders),0),2),
                   'avg_gap_days', round(avg(avg_gap),1))
                 from rk2 where not is_vip),
        'vip_basket',  (select jsonb_build_object(
                   'avg_order', round(coalesce(avg(amt),0),2),
                   'avg_items', round(coalesce(avg(units),0),2),
                   'discount_rate', round(100 * coalesce(sum(disc),0) / nullif(sum(amt) + sum(disc),0), 1),
                   'orders_with_discount_pct', round(100.0 * count(*) filter (where disc > 0) / nullif(count(*),0), 1))
                 from ov where is_vip),
        'rest_basket', (select jsonb_build_object(
                   'avg_order', round(coalesce(avg(amt),0),2),
                   'avg_items', round(coalesce(avg(units),0),2),
                   'discount_rate', round(100 * coalesce(sum(disc),0) / nullif(sum(amt) + sum(disc),0), 1),
                   'orders_with_discount_pct', round(100.0 * count(*) filter (where disc > 0) / nullif(count(*),0), 1))
                 from ov where not is_vip)
      )
    ),

    'patterns', jsonb_build_object(
      'weekday', (select jsonb_agg(jsonb_build_object(
                    'dow', g, 'vip_orders', coalesce(x.vo,0), 'vip_spend', round(coalesce(x.vs,0),2),
                    'all_orders', coalesce(x.ao,0), 'all_spend', round(coalesce(x.asp,0),2)) order by g)
                    from generate_series(0,6) g
                    left join (select extract(dow from lt)::int d,
                                      count(*) filter (where is_vip) vo, sum(amt) filter (where is_vip) vs,
                                      count(*) ao, sum(amt) asp
                                 from ov group by 1) x on x.d = g),
      'hour',    (select jsonb_agg(jsonb_build_object(
                    'hour', g, 'vip_orders', coalesce(x.vo,0), 'vip_spend', round(coalesce(x.vs,0),2),
                    'all_orders', coalesce(x.ao,0), 'all_spend', round(coalesce(x.asp,0),2)) order by g)
                    from generate_series(0,23) g
                    left join (select extract(hour from lt)::int h,
                                      count(*) filter (where is_vip) vo, sum(amt) filter (where is_vip) vs,
                                      count(*) ao, sum(amt) asp
                                 from ov group by 1) x on x.h = g),
      'payment', (select coalesce(jsonb_agg(jsonb_build_object(
                    'method', pm, 'vip_orders', vo, 'vip_spend', round(vs,2),
                    'all_orders', ao, 'all_spend', round(asp,2)) order by asp desc), '[]'::jsonb)
                    from (select pm, count(*) filter (where is_vip) vo,
                                 coalesce(sum(amt) filter (where is_vip),0) vs,
                                 count(*) ao, sum(amt) asp from ov group by pm) q),
      'store',   (select coalesce(jsonb_agg(jsonb_build_object(
                    'store', coalesce(s.name,'-'), 'vip_orders', q.vo, 'vip_spend', round(q.vs,2),
                    'all_orders', q.ao, 'all_spend', round(q.asp,2)) order by q.asp desc), '[]'::jsonb)
                    from (select store_id, count(*) filter (where is_vip) vo,
                                 coalesce(sum(amt) filter (where is_vip),0) vs,
                                 count(*) ao, sum(amt) asp from ov group by store_id) q
                    left join scope_stores s on s.id = q.store_id),
      'category',(select coalesce(jsonb_agg(jsonb_build_object(
                    'name', label, 'vip_revenue', round(vr,2), 'all_revenue', round(ar,2),
                    'units', round(u,2), 'buyers', b, 'vip_buyers', vb) order by ar desc), '[]'::jsonb)
                    from (select initcap(replace(replace(max(coalesce(icat,'Uncategorised')),'_',' '),'-',' ')) as label,
                                 coalesce(sum(net) filter (where is_vip),0) vr, sum(net) ar, sum(qty) u,
                                 count(distinct member_id) b,
                                 count(distinct member_id) filter (where is_vip) vb
                            from lv group by ckey order by sum(net) desc limit 14) q),
      'products',(select coalesce(jsonb_agg(jsonb_build_object(
                    'name', label, 'category', cat, 'revenue', round(r,2), 'units', round(u,2),
                    'buyers', b, 'orders', o) order by r desc), '[]'::jsonb)
                    from (select max(coalesce(iname,'(unnamed)')) label,
                                 initcap(replace(replace(max(coalesce(icat,'Uncategorised')),'_',' '),'-',' ')) cat,
                                 sum(net) r, sum(qty) u, count(distinct member_id) b, count(distinct order_id) o
                            from lv where is_vip group by pkey order by sum(net) desc limit 15) q),
      'order_bands', (select coalesce(jsonb_agg(jsonb_build_object(
                    'band', band, 'vip_orders', vo, 'rest_orders', ro) order by ord_), '[]'::jsonb)
                    from (select case when amt < 100 then 1 when amt < 250 then 2 when amt < 500 then 3
                                      when amt < 1000 then 4 else 5 end as ord_,
                                 case when amt < 100 then 'Under R100' when amt < 250 then 'R100–249'
                                      when amt < 500 then 'R250–499' when amt < 1000 then 'R500–999'
                                      else 'R1000+' end as band,
                                 count(*) filter (where is_vip) vo, count(*) filter (where not is_vip) ro
                            from ov group by 1, 2) q),
      'frequency', (select coalesce(jsonb_agg(jsonb_build_object(
                    'band', band, 'customers', c, 'spend', round(s,2)) order by ord_), '[]'::jsonb)
                    from (select case when orders = 1 then 1 when orders = 2 then 2 when orders <= 4 then 3
                                      when orders <= 9 then 4 else 5 end as ord_,
                                 case when orders = 1 then '1 order' when orders = 2 then '2 orders'
                                      when orders <= 4 then '3–4 orders' when orders <= 9 then '5–9 orders'
                                      else '10+ orders' end as band,
                                 count(*) c, sum(spend) s
                            from rk2 group by 1, 2) q),
      'monthly', (select coalesce(jsonb_agg(jsonb_build_object(
                    'month', m, 'vip_spend', round(vs,2), 'rest_spend', round(rs,2),
                    'vip_orders', vo, 'rest_orders', ro, 'customers', cu) order by m), '[]'::jsonb)
                    from (select to_char(date_trunc('month', lt), 'YYYY-MM') m,
                                 coalesce(sum(amt) filter (where is_vip),0) vs,
                                 coalesce(sum(amt) filter (where not is_vip),0) rs,
                                 count(*) filter (where is_vip) vo, count(*) filter (where not is_vip) ro,
                                 count(distinct member_id) cu
                            from ov group by 1) q)
    )
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.report_customer_insights(date, date, uuid, uuid, numeric, int) from public, anon;
grant execute on function public.report_customer_insights(date, date, uuid, uuid, numeric, int) to authenticated, service_role;
