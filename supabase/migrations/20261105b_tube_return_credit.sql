-- Tube Return Credit (approved by the client 2026-11-05).
-- A customer who hands in empty tubes gets a fixed credit (default R80 per 10 tubes) against a sale.
-- It is a TRADE-IN, not a discount: it is taken at the end of the sale like store credit, never through
-- the discount fields, so the "no discount on promo / Anton stock" rule is untouched and the item
-- prices on the order stay at list / promo price.
--
-- 1. orders gets the tube figures so every receipt, report and refund can see what was traded in.
-- 2. tube_returns is the audit trail / "Returned Tubes" bin: one row per sale that took tubes.
-- 3. A BEFORE INSERT guard rejects a credit the club's own settings would not allow (tampering, stale till).
-- 4. pos_settings keys: tube_return_enabled, tube_return_batch (tubes per credit), tube_return_credit (rand per batch).
--    Absent key = feature off, same convention as the other POS flags.

alter table public.orders
  add column if not exists tube_credit_amount numeric(12,2) not null default 0,
  add column if not exists tubes_returned integer not null default 0;

alter table public.orders drop constraint if exists orders_tube_credit_nonneg;
alter table public.orders
  add constraint orders_tube_credit_nonneg check (tube_credit_amount >= 0 and tubes_returned >= 0);

create table if not exists public.tube_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid,
  order_id uuid references public.orders(id) on delete set null,
  cashier_session_id uuid,
  tubes integer not null check (tubes > 0),
  credit_amount numeric(12,2) not null check (credit_amount >= 0),
  recorded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists tube_returns_company_created_idx on public.tube_returns (company_id, created_at desc);
create index if not exists tube_returns_store_idx on public.tube_returns (store_id, created_at desc);
create index if not exists tube_returns_session_idx on public.tube_returns (cashier_session_id) where cashier_session_id is not null;

alter table public.tube_returns enable row level security;

-- Read-only from the client. Rows are written by the trigger below, so a till can't log tubes
-- without a matching order, and nobody can edit or delete the trail.
drop policy if exists tube_returns_select on public.tube_returns;
create policy tube_returns_select on public.tube_returns
  for select to authenticated
  using (company_id = public.get_my_company_id());

-- Guard: the credit on an order must match the club's own rule.
create or replace function public.orders_validate_tube_credit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_ps jsonb;
  v_enabled boolean;
  v_batch integer;
  v_credit numeric;
begin
  if coalesce(NEW.tubes_returned, 0) = 0 and coalesce(NEW.tube_credit_amount, 0) = 0 then
    return NEW;
  end if;

  select coalesce(c.pos_settings, '{}'::jsonb) into v_ps from companies c where c.id = NEW.company_id;
  v_enabled := coalesce((v_ps ->> 'tube_return_enabled')::boolean, false);
  v_batch := coalesce(nullif(v_ps ->> 'tube_return_batch', '')::integer, 10);
  v_credit := coalesce(nullif(v_ps ->> 'tube_return_credit', '')::numeric, 80);

  if not v_enabled then
    raise exception 'Tube return credit is not switched on for this club';
  end if;
  if v_batch <= 0 or NEW.tubes_returned % v_batch <> 0 then
    raise exception 'Tubes must be returned in multiples of %', v_batch;
  end if;
  -- Credit may be less than the full batch value (capped at the sale total) but never more.
  if NEW.tube_credit_amount > (NEW.tubes_returned / v_batch) * v_credit + 0.005 then
    raise exception 'Tube credit is more than the club rate allows';
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_orders_validate_tube_credit on public.orders;
create trigger trg_orders_validate_tube_credit
  before insert on public.orders
  for each row execute function public.orders_validate_tube_credit();

-- Audit trail: one tube_returns row per order that took tubes.
create or replace function public.orders_log_tube_return()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if coalesce(NEW.tubes_returned, 0) > 0 then
    insert into tube_returns (company_id, store_id, order_id, cashier_session_id, tubes, credit_amount, recorded_by)
    values (NEW.company_id, NEW.store_id, NEW.id, NEW.cashier_session_id, NEW.tubes_returned, NEW.tube_credit_amount, NEW.user_id);
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_orders_log_tube_return on public.orders;
create trigger trg_orders_log_tube_return
  after insert on public.orders
  for each row execute function public.orders_log_tube_return();

-- Z report helper: tubes and credit taken on one session (RLS-safe for cashiers).
create or replace function public.budify_session_tube_returns(p_session uuid)
returns table (tubes bigint, credit_amount numeric)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(sum(t.tubes), 0)::bigint, coalesce(sum(t.credit_amount), 0)
  from tube_returns t
  where t.cashier_session_id = p_session
    and t.company_id = public.get_my_company_id();
$fn$;

grant execute on function public.budify_session_tube_returns(uuid) to authenticated;

-- Switch it on for Canna Life Co only (not the compliance sandbox) with the approved rule (R80 per 10 tubes). Existing values win if already set.
update public.companies
   set pos_settings = jsonb_build_object(
         'tube_return_enabled', true,
         'tube_return_batch', 10,
         'tube_return_credit', 80
       ) || coalesce(pos_settings, '{}'::jsonb)
 where company_name = 'Canna Life Co';
