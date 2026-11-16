-- 1. GRV acceptance: supplier GRVs can be held 'awaiting_acceptance' and only load
--    stock when the store accepts (counts) them, like a stock transfer.
-- 2. Stock transfer drafts (no stock moves until dispatched).
-- 3. Transfer receive may count MORE than sent: surplus is added to the receiver and removed from the sender.
-- 4. reorder_lists: one internal reorder block per store (not one PO per supplier).

alter table public.goods_received_notes drop constraint if exists goods_received_notes_status_check;
alter table public.goods_received_notes add constraint goods_received_notes_status_check
  check (status = any (array['draft','awaiting_acceptance','posted','cancelled']));
alter table public.goods_received_notes add column if not exists accepted_by_name text, add column if not exists accepted_at timestamptz;
alter table public.grn_lines add column if not exists expected_quantity numeric, add column if not exists short_reason text;

alter table public.stock_transfer_notes drop constraint if exists stock_transfer_notes_status_check;
alter table public.stock_transfer_notes add constraint stock_transfer_notes_status_check
  check (status = any (array['draft','dispatched','received','received_variance','variance_closed','cancelled']));

-- ---- grv_save: hold for acceptance when asked ----
create or replace function public.grv_save(p_grn_id uuid, p_header jsonb, p_lines jsonb, p_post boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_co uuid; v_role text; v_id uuid := p_grn_id; v_store uuid; v_sup uuid; v_reg boolean; v_int boolean; v_num text; v_st text; v_req uuid;
  v_mgr boolean; v_iss numeric; v_rst text; v_rsup uuid; v_short jsonb;
  e jsonb; v_pid uuid; v_q numeric; v_c numeric; v_vt text; v_pn text; v_sk text; v_lt numeric; v_vat numeric; s_ex numeric := 0; s_vat numeric := 0;
begin
  select company_id, role into v_co, v_role from profiles where id = v_uid;
  if v_co is null then raise exception 'Not authorised to receive goods'; end if;
  v_mgr := v_role in ('owner','admin','manager','superadmin','head_office','supervisor');
  v_store := nullif(p_header->>'store_id','')::uuid; v_sup := nullif(p_header->>'supplier_id','')::uuid; v_req := nullif(p_header->>'request_id','')::uuid;
  v_short := case when jsonb_typeof(p_header->'short_reasons') = 'object' then p_header->'short_reasons' else '{}'::jsonb end;
  if v_store is null or not exists (select 1 from stores where id = v_store and company_id = v_co) then raise exception 'Choose a valid destination store'; end if;
  if not public.ws_store_ok(v_store) then raise exception 'You do not have access to this store'; end if;
  select coalesce(vat_registered,false), coalesce(is_internal,false) into v_reg, v_int from suppliers where id = v_sup and company_id = v_co;
  if not found then raise exception 'Choose a supplier'; end if;
  if v_req is null and v_int and not v_mgr and coalesce(current_setting('app.grv_bypass_request', true),'') <> '1' then
    raise exception 'Stock from the stock room is received against a request the stock room has issued. Create a request first.';
  end if;
  if v_req is not null then
    select status, supplier_id into v_rst, v_rsup from stock_requests where id = v_req and company_id = v_co and store_id = v_store;
    if not found then raise exception 'That request belongs to another store'; end if;
    if v_rst = 'requested' then raise exception 'The stock room has not issued this request yet'; end if;
    if v_rst <> 'issued' then raise exception 'That request is already %', v_rst; end if;
    if v_rsup <> v_sup then raise exception 'The supplier must match the request'; end if;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one product line'; end if;
  if v_id is null then
    insert into goods_received_notes (company_id, grn_number, supplier_id, store_id, status, created_by)
    values (v_co, 'GRV' || lpad(nextval('grn_number_seq')::text, 6, '0'), v_sup, v_store, 'draft', v_uid) returning id into v_id;
  else
    select status into v_st from goods_received_notes where id = v_id and company_id = v_co for update;
    if not found then raise exception 'GRV not found'; end if;
    if v_st <> 'draft' then raise exception 'Only draft GRVs can be edited'; end if;
    perform public.grv_clear_lines(v_id);
  end if;
  for e in select * from jsonb_array_elements(p_lines) loop
    v_pid := nullif(e->>'product_id','')::uuid; v_q := (e->>'quantity')::numeric; v_c := coalesce((e->>'unit_cost')::numeric, 0);
    if v_q is null or v_q <= 0 then raise exception 'Quantity must be more than zero'; end if;
    if v_c < 0 then raise exception 'Cost cannot be negative'; end if;
    select name, sku, coalesce(vat_type,'standard') into v_pn, v_sk, v_vt from products where id = v_pid and company_id = v_co;
    if not found then raise exception 'Product not found'; end if;
    if not v_mgr then
      select coalesce(nullif(si.cost_price,0), nullif(pr.cost_price,0), 0) into v_c
      from products pr left join store_inventory si on si.product_id = pr.id and si.store_id = v_store where pr.id = v_pid;
    elsif (e->>'vat_type') in ('standard','zero_rated','exempt') then
      v_vt := e->>'vat_type';
    end if;
    if v_req is not null then
      select issued_quantity into v_iss from stock_request_lines where request_id = v_req and product_id = v_pid;
      if not found then raise exception '% is not on the request', v_pn; end if;
      if v_q > coalesce(v_iss,0) then raise exception '%: the stock room issued %, you cannot receive more than that', v_pn, coalesce(v_iss,0); end if;
    end if;
    v_lt := round(v_q * v_c, 2);
    v_vat := case when v_reg and v_vt = 'standard' then round(v_lt * 0.15, 2) else 0 end;
    insert into grn_lines (grn_id, company_id, product_id, product_name, sku, quantity, unit_cost, vat_type, vat_amount, line_total)
    values (v_id, v_co, v_pid, v_pn, v_sk, v_q, v_c, v_vt, v_vat, v_lt);
    s_ex := s_ex + v_lt; s_vat := s_vat + v_vat;
  end loop;
  update goods_received_notes set supplier_id = v_sup, store_id = v_store, request_id = v_req, short_reasons = v_short,
    delivery_note_no = nullif(p_header->>'delivery_note_no',''),
    received_date = coalesce(nullif(p_header->>'received_date','')::date, current_date), notes = nullif(p_header->>'notes',''),
    total_excl = s_ex, total_vat = s_vat, total_incl = s_ex + s_vat, updated_at = now() where id = v_id;
  if p_post then
    -- Supplier deliveries can be held until the store counts and accepts them (requests are already their own acceptance).
    if v_req is null and coalesce((p_header->>'hold_for_acceptance')::boolean, false) then
      update goods_received_notes set status = 'awaiting_acceptance', updated_at = now() where id = v_id;
      select grn_number into v_num from goods_received_notes where id = v_id;
      return jsonb_build_object('ok', true, 'id', v_id, 'grn_number', v_num, 'status', 'awaiting_acceptance');
    end if;
    return public.grv_post(v_id);
  end if;
  select grn_number into v_num from goods_received_notes where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'grn_number', v_num, 'status', 'draft');
end $function$;

-- ---- grv_post: also post an accepted (awaiting) GRV ----
do $$
declare d text;
begin
  d := pg_get_functiondef('public.grv_post(uuid)'::regprocedure);
  d := replace(d, 'if g.status <> ''draft'' then', 'if g.status not in (''draft'',''awaiting_acceptance'') then');
  if d not like '%awaiting_acceptance%' then raise exception 'grv_post patch did not apply'; end if;
  execute d;
end $$;

-- ---- grv_cancel: awaiting GRVs can be cancelled too ----
create or replace function public.grv_cancel(p_grn_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_co uuid; v_n int;
begin
  select company_id into v_co from profiles where id = auth.uid();
  if v_co is null then raise exception 'Not authorised'; end if;
  update goods_received_notes set status = 'cancelled', updated_at = now()
   where id = p_grn_id and company_id = v_co and status in ('draft','awaiting_acceptance') and public.ws_store_ok(store_id);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Only draft or awaiting GRVs can be cancelled'; end if;
  return jsonb_build_object('ok', true);
end $function$;

-- ---- grv_accept: the store counts the delivery; stock loads only for what was counted ----
create or replace function public.grv_accept(p_grn_id uuid, p_name text, p_lines jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_co uuid; g goods_received_notes%rowtype; l grn_lines%rowtype; x jsonb; v_cnt numeric; v_reason text; v_rate numeric;
begin
  select company_id into v_co from profiles where id = v_uid;
  if v_co is null then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter the name of the person accepting the delivery'; end if;
  select * into g from goods_received_notes where id = p_grn_id and company_id = v_co for update;
  if not found then raise exception 'GRV not found'; end if;
  if g.status <> 'awaiting_acceptance' then raise exception 'This GRV is % and cannot be accepted', g.status; end if;
  if not public.ws_store_ok(g.store_id) then raise exception 'You do not have access to this store'; end if;
  for l in select * from grn_lines where grn_id = g.id loop
    select e into x from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) e where (e->>'product_id')::uuid = l.product_id limit 1;
    v_cnt := round(coalesce(nullif(x->>'received_quantity','')::numeric, l.quantity), 3);
    v_reason := nullif(trim(coalesce(x->>'reason','')), '');
    if v_cnt < 0 then raise exception 'Counts cannot be negative'; end if;
    if v_cnt > l.quantity then raise exception '%: counted % is more than the % on the delivery note', l.product_name, v_cnt, l.quantity; end if;
    if v_cnt < l.quantity then
      if v_reason is null then raise exception '%: give a reason for the shortfall', l.product_name; end if;
      v_rate := case when l.quantity > 0 then l.vat_amount / l.quantity else 0 end;
      if v_cnt = 0 then
        delete from grn_lines where id = l.id;
      else
        update grn_lines set expected_quantity = l.quantity, short_reason = v_reason, quantity = v_cnt,
          line_total = round(v_cnt * unit_cost, 2), vat_amount = round(v_rate * v_cnt, 2) where id = l.id;
      end if;
    end if;
  end loop;
  update goods_received_notes set total_excl = coalesce((select sum(line_total) from grn_lines where grn_id = g.id),0),
    total_vat = coalesce((select sum(vat_amount) from grn_lines where grn_id = g.id),0),
    total_incl = coalesce((select sum(line_total + vat_amount) from grn_lines where grn_id = g.id),0),
    accepted_by_name = trim(p_name), accepted_at = now() where id = g.id;
  return public.grv_post(g.id);
end $function$;
revoke all on function public.grv_accept(uuid, text, jsonb) from public, anon;
grant execute on function public.grv_accept(uuid, text, jsonb) to authenticated, service_role;

-- ---- Transfer drafts ----
create or replace function public.transfer_save_draft(p_id uuid, p_header jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_co uuid; v_from uuid; v_to uuid; v_id uuid := p_id; v_num text; v_st text; e record; v_pn text; v_sk text; v_cost numeric; v_n int := 0;
begin
  select company_id into v_co from profiles where id = v_uid;
  if v_co is null then raise exception 'Not authorised'; end if;
  v_from := nullif(p_header->>'from_store_id','')::uuid; v_to := nullif(p_header->>'to_store_id','')::uuid;
  if v_from is null or v_to is null or v_from = v_to then raise exception 'Choose two different stores'; end if;
  if not exists (select 1 from stores where id = v_from and company_id = v_co) or not exists (select 1 from stores where id = v_to and company_id = v_co) then raise exception 'Invalid store'; end if;
  if not public.ws_store_ok(v_from) then raise exception 'You do not have access to the source store'; end if;
  if v_id is null then
    insert into stock_transfer_notes (company_id, transfer_number, from_store_id, to_store_id, transfer_date, status, dispatched_by_name, driver_name, vehicle_reg, notes, created_by)
    values (v_co, 'TRF' || lpad(nextval('transfer_note_seq')::text, 6, '0'), v_from, v_to, coalesce(nullif(p_header->>'transfer_date','')::date, current_date), 'draft',
      nullif(p_header->>'dispatched_by_name',''), nullif(p_header->>'driver_name',''), nullif(p_header->>'vehicle_reg',''), nullif(p_header->>'notes',''), v_uid)
    returning id, transfer_number into v_id, v_num;
  else
    select status, transfer_number into v_st, v_num from stock_transfer_notes where id = v_id and company_id = v_co for update;
    if not found then raise exception 'Draft not found'; end if;
    if v_st <> 'draft' then raise exception 'Only drafts can be edited'; end if;
    if not exists (select 1 from stock_transfer_notes where id = v_id and public.ws_store_ok(from_store_id)) then raise exception 'You do not have access to this draft'; end if;
    update stock_transfer_notes set from_store_id = v_from, to_store_id = v_to, transfer_date = coalesce(nullif(p_header->>'transfer_date','')::date, current_date),
      dispatched_by_name = nullif(p_header->>'dispatched_by_name',''), driver_name = nullif(p_header->>'driver_name',''), vehicle_reg = nullif(p_header->>'vehicle_reg',''), notes = nullif(p_header->>'notes','')
    where id = v_id;
    delete from stock_transfer_note_lines where note_id = v_id;
  end if;
  for e in select (x->>'product_id')::uuid pid, sum((x->>'quantity')::numeric) q from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x group by 1 order by 1 loop
    if e.q is null or e.q <= 0 then continue; end if;
    select name, sku into v_pn, v_sk from products where id = e.pid and company_id = v_co;
    if not found then raise exception 'Product not found'; end if;
    select coalesce(nullif(si.cost_price,0), (select cost_price from products where id = e.pid)) into v_cost from store_inventory si where si.store_id = v_from and si.product_id = e.pid;
    insert into stock_transfer_note_lines (note_id, company_id, product_id, product_name, sku, quantity, unit_cost) values (v_id, v_co, e.pid, v_pn, v_sk, e.q, v_cost);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'id', v_id, 'transfer_number', v_num, 'lines', v_n, 'status', 'draft');
end $function$;

create or replace function public.transfer_dispatch_draft(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_co uuid; n stock_transfer_notes%rowtype; l stock_transfer_note_lines%rowtype; v_neg boolean; v_have numeric; v_cnt int := 0;
begin
  select company_id into v_co from profiles where id = v_uid;
  if v_co is null then raise exception 'Not authorised'; end if;
  select * into n from stock_transfer_notes where id = p_id and company_id = v_co for update;
  if not found then raise exception 'Draft not found'; end if;
  if n.status <> 'draft' then raise exception '% is already %', n.transfer_number, n.status; end if;
  if not public.ws_store_ok(n.from_store_id) then raise exception 'You do not have access to the source store'; end if;
  select coalesce(allow_negative_stock,false) into v_neg from companies where id = v_co;
  if not exists (select 1 from stock_transfer_note_lines where note_id = p_id) then raise exception 'Add at least one product before dispatching'; end if;
  for l in select * from stock_transfer_note_lines where note_id = p_id order by product_id loop
    select stock_quantity into v_have from store_inventory where store_id = n.from_store_id and product_id = l.product_id for update;
    v_have := coalesce(v_have, 0);
    if v_have < l.quantity and not v_neg then raise exception 'Not enough stock of % at the source store (have %, need %)', l.product_name, v_have, l.quantity; end if;
    insert into store_inventory (company_id, store_id, product_id, stock_quantity, updated_at) values (v_co, n.from_store_id, l.product_id, v_have - l.quantity, now())
      on conflict (store_id, product_id) do update set stock_quantity = v_have - l.quantity, updated_at = now();
    update products p set stock_quantity = (select coalesce(sum(si.stock_quantity),0) from store_inventory si where si.product_id = p.id) where p.id = l.product_id;
    insert into inventory_movements (company_id, product_id, store_id, movement_type, quantity, quantity_change, previous_qty, new_qty, reason, reference_id, product_name, notes, created_by, from_store_id, to_store_id)
    values (v_co, l.product_id, n.from_store_id, 'transfer_out', l.quantity, -l.quantity, v_have, v_have - l.quantity, 'transfer', n.id, l.product_name, 'Transfer ' || n.transfer_number, v_uid, n.from_store_id, n.to_store_id);
    v_cnt := v_cnt + 1;
  end loop;
  update stock_transfer_notes set status = 'dispatched' where id = p_id;
  return jsonb_build_object('ok', true, 'id', n.id, 'transfer_number', n.transfer_number, 'lines', v_cnt);
end $function$;

create or replace function public.transfer_delete_draft(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_co uuid; n stock_transfer_notes%rowtype;
begin
  select company_id into v_co from profiles where id = auth.uid();
  if v_co is null then raise exception 'Not authorised'; end if;
  select * into n from stock_transfer_notes where id = p_id and company_id = v_co for update;
  if not found then raise exception 'Draft not found'; end if;
  if n.status <> 'draft' then raise exception 'Only drafts can be deleted'; end if;
  if not public.ws_store_ok(n.from_store_id) then raise exception 'You do not have access to this draft'; end if;
  delete from stock_transfer_note_lines where note_id = p_id;
  delete from stock_transfer_notes where id = p_id;
  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.transfer_save_draft(uuid, jsonb, jsonb), public.transfer_dispatch_draft(uuid), public.transfer_delete_draft(uuid) from public, anon;
grant execute on function public.transfer_save_draft(uuid, jsonb, jsonb), public.transfer_dispatch_draft(uuid), public.transfer_delete_draft(uuid) to authenticated, service_role;

-- ---- transfer_receive: allow counting MORE than sent (surplus comes off the sending store) ----
create or replace function public.transfer_receive(p_id uuid, p_name text, p_lines jsonb default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_co uuid; n stock_transfer_notes%rowtype; l stock_transfer_note_lines%rowtype; x jsonb;
  v_cnt numeric; v_reason text; v_dst numeric; v_new numeric; v_old_cost numeric; v_new_cost numeric; v_var boolean := false; v_over numeric; v_src numeric; v_over_any boolean := false;
begin
  select company_id into v_co from profiles where id = v_uid;
  if v_co is null then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter the name of the person who received the stock'; end if;
  select * into n from stock_transfer_notes where id = p_id and company_id = v_co for update;
  if not found then raise exception 'Transfer not found'; end if;
  if n.status <> 'dispatched' then raise exception '% has already been received', n.transfer_number; end if;
  if not public.ws_store_ok(n.to_store_id) then raise exception 'Only the receiving store can receive this transfer'; end if;
  for l in select * from stock_transfer_note_lines where note_id = p_id loop
    select e into x from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) e where (e->>'line_id')::uuid = l.id limit 1;
    v_cnt := round(coalesce(nullif(x->>'received_quantity','')::numeric, l.quantity), 3);
    v_reason := nullif(trim(coalesce(x->>'reason','')),'');
    if v_cnt < 0 then raise exception 'Counts cannot be negative'; end if;
    if v_cnt < l.quantity then
      v_var := true;
      if v_reason is null then raise exception '%: give a reason for the shortfall', l.product_name; end if;
    elsif v_cnt > l.quantity then
      if v_reason is null then raise exception '%: give a reason for receiving more than the % sent', l.product_name, l.quantity; end if;
      v_over := v_cnt - l.quantity; v_over_any := true;
      -- the extra comes off the sending store (it was physically in the delivery)
      select stock_quantity into v_src from store_inventory where store_id = n.from_store_id and product_id = l.product_id for update;
      v_src := coalesce(v_src, 0);
      insert into store_inventory (company_id, store_id, product_id, stock_quantity, updated_at) values (v_co, n.from_store_id, l.product_id, v_src - v_over, now())
        on conflict (store_id, product_id) do update set stock_quantity = v_src - v_over, updated_at = now();
      insert into inventory_movements (company_id, product_id, store_id, movement_type, quantity, quantity_change, previous_qty, new_qty, reason, reference_id, product_name, notes, created_by, from_store_id, to_store_id)
      values (v_co, l.product_id, n.from_store_id, 'transfer_out', v_over, -v_over, v_src, v_src - v_over, 'transfer_surplus', n.id, l.product_name, 'Transfer ' || n.transfer_number || ' - extra sent beyond the note', v_uid, n.from_store_id, n.to_store_id);
    end if;
    update stock_transfer_note_lines set received_quantity = v_cnt, variance_reason = v_reason where id = l.id;
    if v_cnt > 0 then
      select stock_quantity, cost_price into v_dst, v_old_cost from store_inventory where store_id = n.to_store_id and product_id = l.product_id for update;
      v_dst := coalesce(v_dst, 0); v_new := v_dst + v_cnt;
      v_new_cost := case
        when coalesce(l.unit_cost,0) <= 0 then v_old_cost
        when coalesce(v_old_cost,0) <= 0 or v_dst <= 0 then l.unit_cost
        else round((v_dst * v_old_cost + v_cnt * l.unit_cost) / v_new, 4) end;
      insert into store_inventory (company_id, store_id, product_id, stock_quantity, cost_price, updated_at)
      values (v_co, n.to_store_id, l.product_id, v_new, v_new_cost, now())
      on conflict (store_id, product_id) do update set stock_quantity = v_new, cost_price = coalesce(v_new_cost, store_inventory.cost_price), updated_at = now();
      insert into inventory_movements (company_id, product_id, store_id, movement_type, quantity, quantity_change, previous_qty, new_qty, reason, reference_id, product_name, notes, created_by, from_store_id, to_store_id)
      values (v_co, l.product_id, n.to_store_id, 'transfer_in', v_cnt, v_cnt, v_dst, v_new, 'transfer', n.id, l.product_name, 'Transfer ' || n.transfer_number, v_uid, n.from_store_id, n.to_store_id);
    end if;
    update products p set stock_quantity = (select coalesce(sum(si.stock_quantity),0) from store_inventory si where si.product_id = p.id) where p.id = l.product_id;
  end loop;
  update stock_transfer_notes set status = case when v_var then 'received_variance' else 'received' end,
    received_by_name = trim(p_name), received_at = now(), receive_notes = p_notes where id = p_id;
  return jsonb_build_object('ok', true, 'transfer_number', n.transfer_number, 'variance', v_var, 'surplus', v_over_any);
end $function$;

-- ---- reorder_lists: one internal block per store ----
create table if not exists public.reorder_lists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  list_number text,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  groups jsonb not null default '[]'::jsonb,   -- [{supplier_id, supplier_name, lines:[{product_id, product_name, quantity, cost_price, line_total}]}]
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.reorder_lists enable row level security;
drop policy if exists reorder_lists_company on public.reorder_lists;
create policy reorder_lists_company on public.reorder_lists for all to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
