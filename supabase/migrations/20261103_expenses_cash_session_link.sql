-- Cash expenses captured in Finances now reduce the till's expected cash and show on the Z report / EOD report.
-- Applies to NEW cash expenses only (linked to the store's open session at insert time). Historic rows untouched.

-- 1. Link column
alter table public.expenses
  add column if not exists cashier_session_id uuid references public.cashier_sessions(id) on delete set null;
create index if not exists expenses_cashier_session_idx
  on public.expenses (cashier_session_id) where cashier_session_id is not null;

-- 2. Auto-link cash expenses to the store's open session
create or replace function public.expenses_link_open_session()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if NEW.cashier_session_id is null
     and NEW.store_id is not null
     and lower(coalesce(NEW.payment_method,'cash')) = 'cash' then
    select cs.id into NEW.cashier_session_id
      from cashier_sessions cs
     where cs.company_id = NEW.company_id
       and cs.store_id = NEW.store_id
       and cs.status = 'open'
     order by cs.opening_time desc
     limit 1;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_expenses_link_session on public.expenses;
create trigger trg_expenses_link_session
  before insert on public.expenses
  for each row execute function public.expenses_link_open_session();

-- 3. Helper for the POS Z report (RLS-safe for cashiers)
create or replace function public.budify_session_cash_expenses(p_session uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(sum(e.amount), 0)
    from expenses e
    join cashier_sessions cs on cs.id = e.cashier_session_id
   where e.cashier_session_id = p_session
     and cs.company_id = public.get_my_company_id()
     and lower(coalesce(e.payment_method,'cash')) = 'cash';
$fn$;
grant execute on function public.budify_session_cash_expenses(uuid) to authenticated;

-- 4. Expected cash subtracts linked cash expenses
create or replace function public.budify_session_expected_cash(p_session uuid, p_opening numeric)
returns numeric
language plpgsql
stable security definer
set search_path to 'public'
as $fn$
declare
  v_order_cash numeric := 0;
  v_tab_cash   numeric := 0;
  v_out        numeric := 0;
  v_exp        numeric := 0;
begin
  select coalesce(sum(
    case
      when o.payment_method = 'cash' then coalesce(o.total_amount,0)
      when o.payment_method = 'split' then (
        select coalesce(sum((c->>'amount')::numeric),0)
        from jsonb_array_elements(
          case when jsonb_typeof(coalesce(nullif(o.payment_details #>> '{}',''),'[]')::jsonb) = 'array'
               then coalesce(nullif(o.payment_details #>> '{}',''),'[]')::jsonb
               else '[]'::jsonb end
        ) c
        where c->>'method' = 'cash'
      )
      else 0
    end
  ),0)
  into v_order_cash
  from orders o
  where o.cashier_session_id = p_session
    and o.status = 'completed';

  select coalesce(sum(amount),0)
  into v_tab_cash
  from order_payments
  where cashier_session_id = p_session
    and lower(coalesce(payment_method,'')) = 'cash';

  select coalesce(sum(amount),0)
  into v_out
  from till_cash_outs
  where cashier_session_id = p_session;

  select coalesce(sum(amount),0)
  into v_exp
  from expenses
  where cashier_session_id = p_session
    and lower(coalesce(payment_method,'cash')) = 'cash';

  return coalesce(p_opening,0) + v_order_cash + v_tab_cash - v_out - v_exp;
end;
$fn$;

-- 5. Patch budify_session_summary and report_end_of_day in place (asserts the patch applied)
do $mig$
declare
  d text; d2 text;
begin
  -- session summary: add linked cash expenses to cash paid out
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'budify_session_summary';
  d2 := replace(d,
    $a$from till_cash_outs where cashier_session_id = p_session;$a$,
    $b$from till_cash_outs where cashier_session_id = p_session;
  v_outs := v_outs + coalesce((select sum(e.amount) from expenses e
     where e.cashier_session_id = p_session
       and lower(coalesce(e.payment_method,'cash')) = 'cash'), 0);$b$);
  if d2 = d then raise exception 'budify_session_summary patch did not apply'; end if;
  execute d2;

  -- end-of-day report: add linked cash expenses to cash outs total and list
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'report_end_of_day';
  d2 := replace(d,
    $a$     and public.eod_store_ok(p_store, t.store_id);$a$,
    $b$     and public.eod_store_ok(p_store, t.store_id);

  v_out_total := v_out_total + coalesce((select sum(e.amount) from expenses e
     where e.company_id = v_company
       and e.cashier_session_id is not null
       and lower(coalesce(e.payment_method,'cash')) = 'cash'
       and e.created_at >= v_from and e.created_at < v_to
       and public.eod_store_ok(p_store, e.store_id)), 0);
  v_cash_outs := v_cash_outs || coalesce((select jsonb_agg(jsonb_build_object(
         'supplier', coalesce(e.vendor,'Expense'),
         'reason',   coalesce(e.description,''),
         'amount',   round(coalesce(e.amount,0),2),
         'time',     to_char(e.created_at at time zone 'Africa/Johannesburg','HH24:MI')
       ) order by e.created_at)
     from expenses e
     where e.company_id = v_company
       and e.cashier_session_id is not null
       and lower(coalesce(e.payment_method,'cash')) = 'cash'
       and e.created_at >= v_from and e.created_at < v_to
       and public.eod_store_ok(p_store, e.store_id)), '[]'::jsonb);$b$);
  if d2 = d then raise exception 'report_end_of_day patch did not apply'; end if;
  execute d2;
end
$mig$;
