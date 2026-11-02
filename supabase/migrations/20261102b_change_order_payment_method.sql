-- Let a cashier correct a sale that was rung up as cash but was really paid by
-- card. Sales only (never refunds), cash -> card only, completed and unrefunded
-- orders only. Cashiers/staff can only do it while the till session that took
-- the sale is still open and at a store they work at; managers/owners can
-- correct any. The till session's cash/card totals move with it, and who did it
-- is recorded on the order.
alter table public.orders
  add column if not exists payment_changed_from text,
  add column if not exists payment_changed_by uuid,
  add column if not exists payment_changed_at timestamptz;

create or replace function public.change_order_payment_method(p_order_id uuid, p_new_method text default 'card')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_order orders;
  v_role text;
  v_sess_open boolean := false;
  v_amt numeric;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if lower(coalesce(p_new_method,'')) not in ('card','payment_link') then
    raise exception 'A cash sale can only be changed to card or payment link';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  select p.role into v_role from profiles p where p.id = v_uid and p.company_id = v_order.company_id;
  if v_role is null or v_role not in ('owner','admin','manager','superadmin','cashier','staff') then
    raise exception 'Not authorised';
  end if;

  if lower(coalesce(v_order.payment_method,'')) <> 'cash' then
    raise exception 'Only cash sales can be changed';
  end if;
  if v_order.status <> 'completed' or coalesce(v_order.refund_total,0) > 0 then
    raise exception 'This sale is refunded or not completed, so the payment cannot be changed';
  end if;

  select exists(select 1 from cashier_sessions s where s.id = v_order.cashier_session_id and s.status = 'open')
    into v_sess_open;

  if v_role in ('cashier','staff') then
    if not v_sess_open then
      raise exception 'The till session for this sale is closed. Ask a manager to change it.';
    end if;
    if not (
      exists (select 1 from cashier_store_assignments csa where csa.cashier_id = v_uid and csa.store_id = v_order.store_id)
      or exists (select 1 from profiles p where p.id = v_uid and p.store_id = v_order.store_id)
      or exists (select 1 from cashier_sessions cs where cs.cashier_id = v_uid and cs.store_id = v_order.store_id and cs.status = 'open')
    ) then
      raise exception 'You are not assigned to this store';
    end if;
  end if;

  v_amt := round(coalesce(v_order.total_amount,0), 2);

  update orders
     set payment_method = lower(p_new_method),
         payment_details = jsonb_build_array(jsonb_build_object('method', lower(p_new_method),'amount', v_amt))::jsonb,
         payment_changed_from = 'cash',
         payment_changed_by = v_uid,
         payment_changed_at = now(),
         updated_at = now()
   where id = p_order_id;

  if v_sess_open then
    update cashier_sessions
       set cash_sales = greatest(0, coalesce(cash_sales,0) - v_amt),
           card_sales = coalesce(card_sales,0) + v_amt,
           updated_at = now()
     where id = v_order.cashier_session_id;
  end if;

  return jsonb_build_object('status','ok','order_id',p_order_id,'amount',v_amt,'session_adjusted',v_sess_open);
end;
$$;

grant execute on function public.change_order_payment_method(uuid, text) to authenticated;
