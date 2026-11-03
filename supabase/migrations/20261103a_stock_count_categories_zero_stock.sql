-- Stock counts: (1) group the count sheet by category, with a category filter;
-- (2) include products the store carries even when system stock is 0, so stock that was
--     received but not yet captured still shows up on the count.

-- 1. Items list: new optional p_category filter; order by category then name.
drop function if exists public.stock_count_items_list(uuid, text, text, integer, integer);

create or replace function public.stock_count_items_list(
  p_count_id uuid,
  p_filter text default 'all',
  p_search text default null,
  p_limit integer default 200,
  p_offset integer default 0,
  p_category text default null
) returns table(product_id uuid, product_name text, sku text, barcode text, category text,
                expected_qty numeric, counted_qty numeric, variance numeric, value_variance numeric,
                excluded boolean, counted_at timestamp with time zone)
language plpgsql security definer set search_path to 'public'
as $function$
declare g record; v_mask boolean; v_f text := coalesce(p_filter,'all');
begin
  select * into g from public.stock_count_guard(p_count_id, false);
  v_mask := g.blind and g.role not in ('owner','admin','manager','superadmin');

  if v_mask and v_f in ('matched','unmatched','variance','over','short') then
    raise exception 'Variance is hidden on a blind count';
  end if;

  return query
  select i.product_id, i.product_name, i.sku, i.barcode, i.category,
         case when v_mask then null else i.expected_qty end,
         i.counted_qty,
         case when v_mask or i.counted_qty is null then null else i.counted_qty - i.expected_qty end,
         case when v_mask or i.counted_qty is null then null
              else (i.counted_qty - i.expected_qty) * coalesce(i.unit_cost,0) end,
         i.excluded,
         i.counted_at
  from stock_count_items i
  where i.count_id = p_count_id
    and (v_f = 'all'
         or (v_f = 'counted'   and i.counted_qty is not null and not i.excluded)
         or (v_f = 'uncounted' and i.counted_qty is null     and not i.excluded)
         or (v_f = 'matched'   and i.counted_qty is not null and not i.excluded and i.counted_qty  = i.expected_qty)
         or (v_f = 'unmatched' and not i.excluded and (i.counted_qty is null or i.counted_qty <> i.expected_qty))
         or (v_f = 'variance'  and not i.excluded and i.counted_qty is not null and i.counted_qty <> i.expected_qty)
         or (v_f = 'over'      and not i.excluded and i.counted_qty is not null and i.counted_qty >  i.expected_qty)
         or (v_f = 'short'     and not i.excluded and i.counted_qty is not null and i.counted_qty <  i.expected_qty)
         or (v_f = 'excluded'  and i.excluded))
    and (p_search is null or trim(p_search) = ''
         or i.product_name ilike '%'||p_search||'%'
         or i.sku          ilike '%'||p_search||'%'
         or i.barcode      ilike '%'||p_search||'%')
    and (p_category is null or trim(p_category) = ''
         or coalesce(i.category,'') = p_category)
  order by
    -- Variance views keep their severity ordering; the working sheet is grouped by category so it
    -- follows how stock is packed in the drawers.
    case when v_f in ('matched','unmatched','variance','over','short','excluded') and not v_mask then
           case when i.excluded then 3
                when i.counted_qty is not null and i.counted_qty <> i.expected_qty then 0
                when i.counted_qty is null then 1
                else 2 end
         else 0 end,
    case when v_f in ('matched','unmatched','variance','over','short','excluded') and not v_mask
              and i.counted_qty is not null then - abs(i.counted_qty - i.expected_qty)
         else 0 end,
    (i.category is null), i.category, i.product_name
  limit greatest(1, least(coalesce(p_limit,200), 2000)) offset greatest(0, coalesce(p_offset,0));
end;
$function$;

revoke all on function public.stock_count_items_list(uuid, text, text, integer, integer, text) from public, anon;
grant execute on function public.stock_count_items_list(uuid, text, text, integer, integer, text) to authenticated, service_role;

-- 2. Count creation: include every active product the store carries, even at 0 stock.
create or replace function public.stock_count_create(
  p_store_id uuid,
  p_name text default null,
  p_scope text default 'all',
  p_category text default null,
  p_blind boolean default true,
  p_categories text[] default null
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid(); v_company uuid; v_role text; v_store text; v_id uuid; v_open uuid; v_n int;
  v_cats text[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select s.company_id, s.name into v_company, v_store from stores s where s.id = p_store_id;
  if v_company is null then raise exception 'Store not found'; end if;
  select p.role into v_role from profiles p where p.id = v_uid and p.company_id = v_company;
  if v_role is null or v_role not in ('owner','admin','manager','superadmin','cashier','staff') then
    raise exception 'Not authorised to start a count for this store';
  end if;
  if v_role in ('cashier','staff') and not exists (
    select 1 from cashier_store_assignments csa where csa.cashier_id = v_uid and csa.store_id = p_store_id
    union all
    select 1 from profiles p where p.id = v_uid and p.store_id = p_store_id
  ) then raise exception 'You are not assigned to this store'; end if;
  select sc.id into v_open from stock_counts sc where sc.store_id = p_store_id and sc.status in ('in_progress','paused') limit 1;
  if v_open is not null then raise exception 'A count is already open for this store. Resume it instead.'; end if;

  select array_agg(distinct c order by c) into v_cats
  from unnest(coalesce(p_categories, case when p_category is not null then array[p_category] end)) c
  where c is not null and trim(c) <> '';
  if coalesce(p_scope,'all') = 'category' and coalesce(array_length(v_cats,1),0) = 0 then
    raise exception 'Pick at least one category';
  end if;
  if coalesce(p_scope,'all') <> 'category' then v_cats := null; end if;

  insert into stock_counts (company_id, store_id, name, scope, category, categories, blind, created_by)
  values (v_company, p_store_id,
    coalesce(nullif(trim(p_name),''), coalesce(v_store,'Store') || ' - ' || to_char(now() at time zone 'Africa/Johannesburg','Mon DD, YYYY, HH12:MI AM')),
    coalesce(p_scope,'all'), array_to_string(v_cats, ', '), v_cats, coalesce(p_blind, true), v_uid)
  returning id into v_id;

  insert into stock_count_items (count_id, company_id, store_id, product_id, product_name, sku, barcode, category, unit_cost, expected_qty)
  select v_id, v_company, p_store_id, pr.id, pr.name, pr.sku, pr.barcode, pr.category, coalesce(pr.cost_price,0), coalesce(si.stock_quantity,0)
  from products pr
  join store_inventory si on si.product_id = pr.id and si.store_id = p_store_id
  where pr.company_id = v_company
    and coalesce(pr.is_active, true)
    and (coalesce(p_scope,'all') <> 'category' or pr.category = any(v_cats));

  get diagnostics v_n = row_count;
  update stock_counts set items_total = v_n, updated_at = now() where id = v_id;
  return v_id;
end; $function$;

revoke all on function public.stock_count_create(uuid, text, text, text, boolean, text[]) from public, anon;
grant execute on function public.stock_count_create(uuid, text, text, text, boolean, text[]) to authenticated, service_role;
