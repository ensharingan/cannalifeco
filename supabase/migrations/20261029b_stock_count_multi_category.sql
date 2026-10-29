-- Stock counts: allow several categories in one count.
-- Adds stock_counts.categories (text[]) and an optional p_categories argument.
-- The legacy p_category argument still works (treated as a one-item list), and
-- stock_counts.category keeps a comma-joined label so existing screens still render.
alter table public.stock_counts add column if not exists categories text[];

drop function if exists public.stock_count_create(uuid, text, text, text, boolean);

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
  select v_id, v_company, p_store_id, pr.id, pr.name, pr.sku, pr.barcode, pr.category, coalesce(pr.cost_price,0), si.stock_quantity
  from products pr
  join store_inventory si on si.product_id = pr.id and si.store_id = p_store_id
  where pr.company_id = v_company
    and coalesce(pr.is_active, true)
    and coalesce(si.stock_quantity,0) > 0
    and (coalesce(p_scope,'all') <> 'category' or pr.category = any(v_cats));

  get diagnostics v_n = row_count;
  update stock_counts set items_total = v_n, updated_at = now() where id = v_id;
  return v_id;
end; $function$;
