-- Payment method on a sale can be corrected between cash, card and payment_link
-- in any direction. Same guards as before: sales only (never refunds), completed
-- and unrefunded orders only, cashiers/staff only while the till session that
-- took the sale is still open and at a store they work at; managers/owners can
-- correct any. Cash <-> card/link moves the till session's cash/card totals.
-- Who changed it, from what and when is recorded on the order.
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
  v_new text := lower(coalesce(p_new_method,''));
  v_old text;
  v_old_cash boolean;
  v_new_cash boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if v_new not in ('cash','card','payment_link') then
    raise exception 'Payment can only be changed to cash, card or payment link';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  select p.role into v_role from profiles p where p.id = v_uid and p.company_id = v_order.company_id;
  if v_role is null or v_role not in ('owner','admin','manager','superadmin','cashier','staff') then
    raise exception 'Not authorised';
  end if;

  v_old := lower(coalesce(v_order.payment_method,''));
  if v_old not in ('cash','card','payment_link') then
    raise exception 'Only cash, card or payment link sales can be changed';
  end if;
  if v_old = v_new then
    raise exception 'This sale is already paid by that method';
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
  v_old_cash := (v_old = 'cash');
  v_new_cash := (v_new = 'cash');

  update orders
     set payment_method = v_new,
         payment_details = jsonb_build_array(jsonb_build_object('method', v_new,'amount', v_amt))::jsonb,
         payment_changed_from = v_old,
         payment_changed_by = v_uid,
         payment_changed_at = now(),
         updated_at = now()
   where id = p_order_id;

  if v_sess_open and v_old_cash <> v_new_cash then
    update cashier_sessions
       set cash_sales = greatest(0, coalesce(cash_sales,0) + case when v_new_cash then v_amt else -v_amt end),
           card_sales = greatest(0, coalesce(card_sales,0) + case when v_new_cash then -v_amt else v_amt end),
           updated_at = now()
     where id = v_order.cashier_session_id;
  end if;

  return jsonb_build_object('status','ok','order_id',p_order_id,'amount',v_amt,'session_adjusted',v_sess_open and v_old_cash <> v_new_cash);
end;
$$;

grant execute on function public.change_order_payment_method(uuid, text) to authenticated;
