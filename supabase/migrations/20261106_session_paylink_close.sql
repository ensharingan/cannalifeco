-- Close Day: capture the Pay Link (payment_link) total alongside cash and card.
-- Additive only: new nullable columns, a new expected-paylink function, and
-- in-place patches (asserted) to the reconcile trigger and session summary.

alter table public.cashier_sessions
  add column if not exists closing_paylink_total numeric,
  add column if not exists expected_paylink numeric,
  add column if not exists paylink_variance numeric;

create or replace function public.budify_session_expected_paylink(p_session uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_order numeric := 0;
  v_tab   numeric := 0;
begin
  select coalesce(sum(
    case
      when lower(coalesce(o.payment_method,'')) = 'payment_link' then coalesce(o.total_amount,0)
      when lower(coalesce(o.payment_method,'')) = 'split' then (
        select coalesce(sum((c->>'amount')::numeric),0)
        from jsonb_array_elements(
          case when jsonb_typeof(coalesce(nullif(o.payment_details #>> '{}',''),'[]')::jsonb) = 'array'
               then coalesce(nullif(o.payment_details #>> '{}',''),'[]')::jsonb
               else '[]'::jsonb end
        ) c
        where lower(coalesce(c->>'method','')) = 'payment_link'
      )
      else 0
    end
  ),0)
  into v_order
  from orders o
  where o.cashier_session_id = p_session
    and o.status = 'completed';

  select coalesce(sum(amount),0)
  into v_tab
  from order_payments
  where cashier_session_id = p_session
    and lower(coalesce(payment_method,'')) = 'payment_link';

  return v_order + v_tab;
end;
$fn$;

-- Reconcile trigger: also work out expected pay link and its variance on close
create or replace function public.budify_set_session_reconcile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if NEW.status = 'closed'
     and (TG_OP = 'INSERT' or OLD.status is distinct from 'closed' or NEW.expected_cash is null)
  then
    NEW.expected_cash := public.budify_session_expected_cash(NEW.id, NEW.opening_float);
    NEW.cash_variance := case
                           when NEW.closing_float is null then null
                           else NEW.closing_float - NEW.expected_cash
                         end;

    NEW.expected_card := public.budify_session_expected_card(NEW.id);
    NEW.card_variance := case
                           when NEW.closing_card_total is null then null
                           else NEW.closing_card_total - NEW.expected_card
                         end;

    NEW.expected_paylink := public.budify_session_expected_paylink(NEW.id);
    NEW.paylink_variance := case
                              when NEW.closing_paylink_total is null then null
                              else NEW.closing_paylink_total - NEW.expected_paylink
                            end;
  end if;
  return NEW;
end;
$fn$;

-- Session summary: expose pay link figures (patched in place, asserted)
do $mig$
declare
  d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'budify_session_summary';

  d2 := replace(d,
    $a$    'expected_card',   round(v_card + v_tab_card, 2),$a$,
    $b$    'expected_card',   round(v_card + v_tab_card, 2),
    'paylink_sales',   round(public.budify_session_expected_paylink(p_session), 2),
    'expected_paylink', round(public.budify_session_expected_paylink(p_session), 2),
    'closing_paylink', v_sess.closing_paylink_total,
    'paylink_variance', v_sess.paylink_variance,$b$);
  if d2 = d then raise exception 'budify_session_summary patch did not apply'; end if;
  execute d2;
end
$mig$;
