-- ============================================================================
-- Cannalife Co — Accounting posting routines, balances and reporting helpers
-- ----------------------------------------------------------------------------
-- Nothing in the UI writes to gl_transactions directly. Every posting goes
-- through one of the acc_post_* functions here, which validate the batch,
-- write balanced double entries, and flip the batch to 'posted' in the same
-- transaction. A failed validation aborts the whole posting.
-- ============================================================================


-- ─── Period lookup ──────────────────────────────────────────────────────────

create or replace function public.acc_period_for_date(p_company uuid, p_date date)
returns uuid
language sql
stable
as $$
  select id
  from public.accounting_periods
  where company_id = p_company
    and p_date between start_date and end_date
  order by period_no
  limit 1
$$;


-- ─── Tax maths ──────────────────────────────────────────────────────────────
-- One place decides how an amount splits into net + tax, so the grid, the CSV
-- import and the posting routine can never disagree by a cent.

create or replace function public.acc_split_tax(
  p_amount    numeric,
  p_rate      numeric,
  p_inclusive boolean
)
returns table (net numeric, tax numeric, gross numeric)
language plpgsql
immutable
as $$
declare
  v_rate numeric := coalesce(p_rate, 0) / 100.0;
  v_amt  numeric := coalesce(p_amount, 0);
begin
  if v_rate = 0 then
    return query select round(v_amt, 2), 0::numeric, round(v_amt, 2);
  elsif p_inclusive then
    gross := round(v_amt, 2);
    tax   := round(v_amt * v_rate / (1 + v_rate), 2);
    net   := gross - tax;
    return next;
  else
    net   := round(v_amt, 2);
    tax   := round(v_amt * v_rate, 2);
    gross := net + tax;
    return next;
  end if;
end;
$$;


-- ─── Guard rails ────────────────────────────────────────────────────────────
-- Raises if a date may not be posted into: before the lock date, or inside a
-- closed period. Called by every posting routine.

create or replace function public.acc_assert_postable(p_company uuid, p_date date)
returns uuid
language plpgsql
stable
as $$
declare
  v_lock   date;
  v_period uuid;
  v_status text;
begin
  select lock_date into v_lock from public.accounting_settings where company_id = p_company;
  if v_lock is not null and p_date <= v_lock then
    raise exception 'Date % is on or before the accounting lock date (%)', p_date, v_lock
      using errcode = 'check_violation';
  end if;

  select id, status into v_period, v_status
  from public.accounting_periods
  where company_id = p_company and p_date between start_date and end_date
  order by period_no
  limit 1;

  if v_period is null then
    raise exception 'No accounting period covers %. Create the financial year first.', p_date
      using errcode = 'check_violation';
  end if;
  if v_status = 'closed' then
    raise exception 'The accounting period covering % is closed.', p_date
      using errcode = 'check_violation';
  end if;

  return v_period;
end;
$$;


-- Resolve a posting account by its control role, falling back to the settings
-- map. Raises a readable error rather than posting to the wrong account.
create or replace function public.acc_control_account(p_company uuid, p_control text)
returns uuid
language plpgsql
stable
as $$
declare
  v_id uuid;
begin
  select case p_control
           when 'tax_input'         then s.tax_input_account_id
           when 'tax_output'        then s.tax_output_account_id
           when 'customer'          then s.debtors_control_id
           when 'supplier'          then s.creditors_control_id
           when 'inventory'         then s.inventory_account_id
           when 'stock_adjustment'  then s.stock_adjustment_id
           when 'interstore'        then s.interstore_clearing_id
           when 'rounding'          then s.rounding_account_id
           when 'sales'             then s.sales_account_id
           when 'cost_of_sales'     then s.cost_of_sales_account_id
           when 'retained_earnings' then s.retained_earnings_id
         end
    into v_id
  from public.accounting_settings s
  where s.company_id = p_company;

  if v_id is null then
    select id into v_id
    from public.gl_accounts
    where company_id = p_company and control_type = p_control and active
    order by code
    limit 1;
  end if;

  if v_id is null then
    raise exception 'No % account configured. Set it under Accounting → Settings.', p_control
      using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;


-- ─── Post a cash book batch ─────────────────────────────────────────────────
-- Payments credit the bank and debit the allocation; receipts do the reverse.
-- Input tax on payments, output tax on receipts. Settlement discount on a
-- customer/supplier line settles more than the bank moved, with the difference
-- going to the settlement-discount (rounding) account.

create or replace function public.acc_post_cash_book_batch(p_batch_id uuid)
returns TABLE (lines_posted integer, total_debits numeric, total_credits numeric)
language plpgsql
security invoker
as $$
declare
  v_company     uuid;
  v_cash_book   uuid;
  v_bank_acct   uuid;
  v_status      text;
  e             record;
  v_period      uuid;
  v_alloc       uuid;
  v_party_type  text;
  v_party_id    uuid;
  v_tax_acct    uuid;
  v_lines       integer := 0;
  v_dr          numeric := 0;
  v_cr          numeric := 0;
  v_disc_acct   uuid;
begin
  select b.company_id, b.cash_book_id, b.status
    into v_company, v_cash_book, v_status
  from public.cash_book_batches b
  where b.id = p_batch_id
  for update;

  if v_company is null then
    raise exception 'Cash book batch % not found', p_batch_id;
  end if;
  if v_status <> 'open' then
    raise exception 'Batch is already %', v_status using errcode = 'check_violation';
  end if;

  select gl_account_id into v_bank_acct from public.cash_books where id = v_cash_book;

  for e in
    select *
    from public.cash_book_entries
    where batch_id = p_batch_id
      and posted = false
      and (amount_inclusive <> 0 or amount_exclusive <> 0)
    order by side, line_no
  loop
    v_period := public.acc_assert_postable(v_company, e.entry_date);

    -- Where the other side of the entry lands.
    if e.gcs = 'G' then
      v_alloc      := e.gl_account_id;
      v_party_type := null;
      v_party_id   := null;
    elsif e.gcs = 'C' then
      v_alloc      := public.acc_control_account(v_company, 'customer');
      v_party_type := 'customer';
      v_party_id   := e.member_id;
    else
      v_alloc      := public.acc_control_account(v_company, 'supplier');
      v_party_type := 'supplier';
      v_party_id   := e.supplier_id;
    end if;

    if e.side = 'payment' then
      -- Bank out
      insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
        debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
      values (v_company, v_period, e.entry_date, v_bank_acct, e.store_id,
        0, e.amount_inclusive, e.description, e.reference, 'cash_book', e.id, e.id, p_batch_id, auth.uid());
      v_cr := v_cr + e.amount_inclusive;

      -- Allocation (net of tax)
      insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
        debit, credit, description, reference, source_type, source_id, source_line_id, batch_id,
        party_type, party_id, tax_type_id, tax_amount, created_by)
      values (v_company, v_period, e.entry_date, v_alloc, e.store_id,
        e.amount_exclusive + case when e.gcs in ('C','S') then e.discount else 0 end, 0,
        e.description, e.reference, 'cash_book', e.id, e.id, p_batch_id,
        v_party_type, v_party_id, e.tax_type_id, e.tax_amount, auth.uid());
      v_dr := v_dr + e.amount_exclusive + case when e.gcs in ('C','S') then e.discount else 0 end;

      -- Input tax
      if e.tax_amount <> 0 then
        v_tax_acct := public.acc_control_account(v_company, 'tax_input');
        insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
          debit, credit, description, reference, source_type, source_id, source_line_id, batch_id,
          tax_type_id, tax_amount, created_by)
        values (v_company, v_period, e.entry_date, v_tax_acct, e.store_id,
          e.tax_amount, 0, coalesce(e.description, '') || ' (input tax)', e.reference,
          'cash_book', e.id, e.id, p_batch_id, e.tax_type_id, e.tax_amount, auth.uid());
        v_dr := v_dr + e.tax_amount;
      end if;

      -- Settlement discount received
      if e.gcs in ('C','S') and e.discount <> 0 then
        v_disc_acct := public.acc_control_account(v_company, 'rounding');
        insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
          debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
        values (v_company, v_period, e.entry_date, v_disc_acct, e.store_id,
          0, e.discount, coalesce(e.description, '') || ' (settlement discount)', e.reference,
          'cash_book', e.id, e.id, p_batch_id, auth.uid());
        v_cr := v_cr + e.discount;
      end if;

    else -- receipt
      insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
        debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
      values (v_company, v_period, e.entry_date, v_bank_acct, e.store_id,
        e.amount_inclusive, 0, e.description, e.reference, 'cash_book', e.id, e.id, p_batch_id, auth.uid());
      v_dr := v_dr + e.amount_inclusive;

      insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
        debit, credit, description, reference, source_type, source_id, source_line_id, batch_id,
        party_type, party_id, tax_type_id, tax_amount, created_by)
      values (v_company, v_period, e.entry_date, v_alloc, e.store_id,
        0, e.amount_exclusive + case when e.gcs in ('C','S') then e.discount else 0 end,
        e.description, e.reference, 'cash_book', e.id, e.id, p_batch_id,
        v_party_type, v_party_id, e.tax_type_id, e.tax_amount, auth.uid());
      v_cr := v_cr + e.amount_exclusive + case when e.gcs in ('C','S') then e.discount else 0 end;

      if e.tax_amount <> 0 then
        v_tax_acct := public.acc_control_account(v_company, 'tax_output');
        insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
          debit, credit, description, reference, source_type, source_id, source_line_id, batch_id,
          tax_type_id, tax_amount, created_by)
        values (v_company, v_period, e.entry_date, v_tax_acct, e.store_id,
          0, e.tax_amount, coalesce(e.description, '') || ' (output tax)', e.reference,
          'cash_book', e.id, e.id, p_batch_id, e.tax_type_id, e.tax_amount, auth.uid());
        v_cr := v_cr + e.tax_amount;
      end if;

      if e.gcs in ('C','S') and e.discount <> 0 then
        v_disc_acct := public.acc_control_account(v_company, 'rounding');
        insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
          debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
        values (v_company, v_period, e.entry_date, v_disc_acct, e.store_id,
          e.discount, 0, coalesce(e.description, '') || ' (settlement discount)', e.reference,
          'cash_book', e.id, e.id, p_batch_id, auth.uid());
        v_dr := v_dr + e.discount;
      end if;
    end if;

    update public.cash_book_entries
       set posted = true, posted_at = now(), period_id = v_period
     where id = e.id;

    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'Nothing to post — the batch has no completed lines.'
      using errcode = 'check_violation';
  end if;

  if round(v_dr, 2) <> round(v_cr, 2) then
    raise exception 'Posting is out of balance by %. Nothing was written.', round(v_dr - v_cr, 2)
      using errcode = 'check_violation';
  end if;

  update public.cash_book_batches
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_batch_id;

  lines_posted := v_lines;
  total_debits := round(v_dr, 2);
  total_credits := round(v_cr, 2);
  return next;
end;
$$;


-- ─── Post a general journal batch ───────────────────────────────────────────

create or replace function public.acc_post_journal_batch(p_batch_id uuid)
returns TABLE (lines_posted integer, total_debits numeric, total_credits numeric)
language plpgsql
security invoker
as $$
declare
  v_company uuid;
  v_status  text;
  v_dr      numeric := 0;
  v_cr      numeric := 0;
  v_lines   integer := 0;
  e         record;
  v_period  uuid;
  v_acct    uuid;
  v_ptype   text;
  v_pid     uuid;
begin
  select company_id, status into v_company, v_status
  from public.journal_batches where id = p_batch_id for update;

  if v_company is null then
    raise exception 'Journal batch % not found', p_batch_id;
  end if;
  if v_status <> 'open' then
    raise exception 'Batch is already %', v_status using errcode = 'check_violation';
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_dr, v_cr
  from public.journal_entries where batch_id = p_batch_id;

  if round(v_dr, 2) <> round(v_cr, 2) then
    raise exception 'Journal does not balance: debits % vs credits %', round(v_dr, 2), round(v_cr, 2)
      using errcode = 'check_violation';
  end if;
  if v_dr = 0 then
    raise exception 'Nothing to post — the journal has no values.' using errcode = 'check_violation';
  end if;

  for e in
    select * from public.journal_entries
    where batch_id = p_batch_id and (debit <> 0 or credit <> 0)
    order by line_no
  loop
    v_period := public.acc_assert_postable(v_company, e.entry_date);

    if e.gcs = 'G' then
      v_acct := e.gl_account_id; v_ptype := null; v_pid := null;
    elsif e.gcs = 'C' then
      v_acct := public.acc_control_account(v_company, 'customer'); v_ptype := 'customer'; v_pid := e.member_id;
    else
      v_acct := public.acc_control_account(v_company, 'supplier'); v_ptype := 'supplier'; v_pid := e.supplier_id;
    end if;

    insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
      debit, credit, description, reference, source_type, source_id, source_line_id, batch_id,
      party_type, party_id, tax_type_id, tax_amount, created_by)
    values (v_company, v_period, e.entry_date, v_acct, e.store_id,
      e.debit, e.credit, e.description, e.reference, 'journal', p_batch_id, e.id, p_batch_id,
      v_ptype, v_pid, e.tax_type_id, e.tax_amount, auth.uid());

    v_lines := v_lines + 1;
  end loop;

  update public.journal_batches
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_batch_id;

  lines_posted := v_lines;
  total_debits := round(v_dr, 2);
  total_credits := round(v_cr, 2);
  return next;
end;
$$;


-- ─── Post an inventory journal / interstore transfer ────────────────────────
-- Moves the stock as well as the value: store_inventory is updated in the same
-- transaction as the GL, and an inventory_movements row is written so the
-- existing Inventory screen shows the same history it always has.

create or replace function public.acc_post_inventory_journal(p_batch_id uuid)
returns TABLE (lines_posted integer, total_value numeric)
language plpgsql
security invoker
as $$
declare
  v_company   uuid;
  v_status    text;
  v_type      text;
  v_from      uuid;
  v_to        uuid;
  v_ref       text;
  e           record;
  v_period    uuid;
  v_inv_acct  uuid;
  v_contra    uuid;
  v_clearing  uuid;
  v_value     numeric;
  v_total     numeric := 0;
  v_lines     integer := 0;
  v_pname     text;
  v_existing  record;
begin
  select company_id, status, batch_type, from_store_id, to_store_id, reference
    into v_company, v_status, v_type, v_from, v_to, v_ref
  from public.inventory_journal_batches where id = p_batch_id for update;

  if v_company is null then
    raise exception 'Inventory batch % not found', p_batch_id;
  end if;
  if v_status <> 'open' then
    raise exception 'Batch is already %', v_status using errcode = 'check_violation';
  end if;
  if v_type = 'interstore' and (v_from is null or v_to is null) then
    raise exception 'An interstore transfer needs both a From Store and a To Store.'
      using errcode = 'check_violation';
  end if;

  v_inv_acct := public.acc_control_account(v_company, 'inventory');

  for e in
    select * from public.inventory_journal_entries
    where batch_id = p_batch_id and (qty_in <> 0 or qty_out <> 0)
    order by line_no
  loop
    v_period := public.acc_assert_postable(v_company, e.entry_date);
    v_value  := round((e.qty_in - e.qty_out) * e.unit_cost, 2);

    select name into v_pname from public.products where id = e.product_id;

    if v_type = 'interstore' then
      -- Stock out of the source store …
      update public.store_inventory
         set stock_quantity = coalesce(stock_quantity, 0) - (e.qty_in + e.qty_out),
             updated_at = now()
       where company_id = v_company and store_id = v_from and product_id = e.product_id;

      -- … and into the destination, creating the row if that branch has never
      -- carried the product before.
      select * into v_existing from public.store_inventory
       where company_id = v_company and store_id = v_to and product_id = e.product_id
       limit 1;

      if found then
        update public.store_inventory
           set stock_quantity = coalesce(stock_quantity, 0) + (e.qty_in + e.qty_out),
               updated_at = now()
         where id = v_existing.id;
      else
        insert into public.store_inventory (company_id, store_id, product_id, stock_quantity)
        values (v_company, v_to, e.product_id, (e.qty_in + e.qty_out));
      end if;

      insert into public.inventory_movements (company_id, product_id, product_name, quantity_change, movement_type, notes)
      values
        (v_company, e.product_id, v_pname, -(e.qty_in + e.qty_out), 'transfer_out',
         'Interstore journal ' || coalesce(v_ref, '')),
        (v_company, e.product_id, v_pname,  (e.qty_in + e.qty_out), 'transfer_in',
         'Interstore journal ' || coalesce(v_ref, ''));

      -- Value moves through the clearing account so each leg is auditable and
      -- the pair nets to zero across the company.
      if abs(round((e.qty_in + e.qty_out) * e.unit_cost, 2)) > 0 then
        v_clearing := public.acc_control_account(v_company, 'interstore');
        v_value := round((e.qty_in + e.qty_out) * e.unit_cost, 2);

        insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
          debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
        values
          (v_company, v_period, e.entry_date, v_clearing, v_from, 0, v_value,
           coalesce(e.narration, 'Interstore transfer out'), coalesce(e.reference, v_ref),
           'interstore', p_batch_id, e.id, p_batch_id, auth.uid()),
          (v_company, v_period, e.entry_date, v_clearing, v_to, v_value, 0,
           coalesce(e.narration, 'Interstore transfer in'), coalesce(e.reference, v_ref),
           'interstore', p_batch_id, e.id, p_batch_id, auth.uid());
        v_total := v_total + v_value;
      end if;

    else
      -- Normal adjustment batch: qty_in increases stock, qty_out decreases it.
      select * into v_existing from public.store_inventory
       where company_id = v_company and store_id = e.store_id and product_id = e.product_id
       limit 1;

      if found then
        update public.store_inventory
           set stock_quantity = coalesce(stock_quantity, 0) + e.qty_in - e.qty_out,
               updated_at = now()
         where id = v_existing.id;
      else
        insert into public.store_inventory (company_id, store_id, product_id, stock_quantity)
        values (v_company, e.store_id, e.product_id, e.qty_in - e.qty_out);
      end if;

      insert into public.inventory_movements (company_id, product_id, product_name, quantity_change, movement_type, notes)
      values (v_company, e.product_id, v_pname, e.qty_in - e.qty_out,
              case when e.qty_in >= e.qty_out then 'journal_in' else 'journal_out' end,
              coalesce(e.narration, 'Inventory journal'));

      if v_value <> 0 then
        v_contra := coalesce(e.gl_account_id, public.acc_control_account(v_company, 'stock_adjustment'));

        if v_value > 0 then
          insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
            debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
          values
            (v_company, v_period, e.entry_date, v_inv_acct, e.store_id, v_value, 0,
             coalesce(e.narration, 'Inventory journal'), coalesce(e.reference, v_ref),
             'inventory_journal', p_batch_id, e.id, p_batch_id, auth.uid()),
            (v_company, v_period, e.entry_date, v_contra, e.store_id, 0, v_value,
             coalesce(e.narration, 'Inventory journal'), coalesce(e.reference, v_ref),
             'inventory_journal', p_batch_id, e.id, p_batch_id, auth.uid());
        else
          insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
            debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
          values
            (v_company, v_period, e.entry_date, v_inv_acct, e.store_id, 0, abs(v_value),
             coalesce(e.narration, 'Inventory journal'), coalesce(e.reference, v_ref),
             'inventory_journal', p_batch_id, e.id, p_batch_id, auth.uid()),
            (v_company, v_period, e.entry_date, v_contra, e.store_id, abs(v_value), 0,
             coalesce(e.narration, 'Inventory journal'), coalesce(e.reference, v_ref),
             'inventory_journal', p_batch_id, e.id, p_batch_id, auth.uid());
        end if;
        v_total := v_total + abs(v_value);
      end if;
    end if;

    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'Nothing to post — the batch has no quantities.' using errcode = 'check_violation';
  end if;

  update public.inventory_journal_batches
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_batch_id;

  lines_posted := v_lines;
  total_value := round(v_total, 2);
  return next;
end;
$$;


-- ─── Balances and reporting ─────────────────────────────────────────────────

-- Signed balance for an account: assets and expenses are debit-positive,
-- everything else credit-positive, so a report can sum without sign gymnastics.
create or replace function public.acc_account_balance(
  p_account uuid,
  p_to_date date default null
)
returns numeric
language sql
stable
as $$
  select coalesce(
    case a.category
      when 'asset'   then sum(t.debit - t.credit)
      when 'expense' then sum(t.debit - t.credit)
      else                sum(t.credit - t.debit)
    end, 0)
  from public.gl_accounts a
  left join public.gl_transactions t
         on t.gl_account_id = a.id
        and (p_to_date is null or t.txn_date <= p_to_date)
  where a.id = p_account
  group by a.category
$$;


-- The cash book's book balance — what the bank account says the club has,
-- before any unpresented items.
create or replace function public.acc_cash_book_balance(
  p_cash_book uuid,
  p_to_date   date default null
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(t.debit - t.credit), 0)
  from public.cash_books cb
  join public.gl_transactions t on t.gl_account_id = cb.gl_account_id
  where cb.id = p_cash_book
    and (p_to_date is null or t.txn_date <= p_to_date)
$$;


-- Trial balance for a date range. Opening carries everything before p_from.
create or replace function public.acc_trial_balance(
  p_company uuid,
  p_from    date default null,
  p_to      date default null
)
returns TABLE (
  account_id   uuid,
  code         text,
  sub_code     text,
  name         text,
  category     text,
  subcategory  text,
  opening      numeric,
  period_debit numeric,
  period_credit numeric,
  closing      numeric
)
language sql
stable
as $$
  select
    a.id,
    a.code,
    a.sub_code,
    a.name,
    a.category,
    a.subcategory,
    coalesce(sum(case when p_from is not null and t.txn_date < p_from
                      then t.debit - t.credit else 0 end), 0)                       as opening,
    coalesce(sum(case when (p_from is null or t.txn_date >= p_from)
                       and (p_to   is null or t.txn_date <= p_to)
                      then t.debit else 0 end), 0)                                  as period_debit,
    coalesce(sum(case when (p_from is null or t.txn_date >= p_from)
                       and (p_to   is null or t.txn_date <= p_to)
                      then t.credit else 0 end), 0)                                 as period_credit,
    coalesce(sum(case when p_to is null or t.txn_date <= p_to
                      then t.debit - t.credit else 0 end), 0)                       as closing
  from public.gl_accounts a
  left join public.gl_transactions t on t.gl_account_id = a.id
  where a.company_id = p_company
  group by a.id, a.code, a.sub_code, a.name, a.category, a.subcategory
  having coalesce(sum(t.debit), 0) <> 0
      or coalesce(sum(t.credit), 0) <> 0
  order by a.code, a.sub_code
$$;


-- Tax report for a date range: output tax (sales side) vs input tax (purchases).
create or replace function public.acc_tax_report(
  p_company uuid,
  p_from    date,
  p_to      date
)
returns TABLE (
  tax_code    text,
  description text,
  rate        numeric,
  output_net  numeric,
  output_tax  numeric,
  input_net   numeric,
  input_tax   numeric
)
language sql
stable
as $$
  select
    tt.code,
    tt.description,
    tt.rate,
    coalesce(sum(case when t.credit > 0 and a.category in ('income','liability')
                      then t.credit else 0 end), 0)                  as output_net,
    coalesce(sum(case when a.control_type = 'tax_output'
                      then t.credit - t.debit else 0 end), 0)        as output_tax,
    coalesce(sum(case when t.debit > 0 and a.category in ('expense','asset')
                       and coalesce(a.control_type, '') <> 'tax_input'
                      then t.debit else 0 end), 0)                   as input_net,
    coalesce(sum(case when a.control_type = 'tax_input'
                      then t.debit - t.credit else 0 end), 0)        as input_tax
  from public.tax_types tt
  left join public.gl_transactions t
         on t.tax_type_id = tt.id
        and t.txn_date between p_from and p_to
  left join public.gl_accounts a on a.id = t.gl_account_id
  where tt.company_id = p_company
  group by tt.code, tt.description, tt.rate
  order by tt.code
$$;


-- ─── Close a tax period ─────────────────────────────────────────────────────
-- Freezes the totals and pushes the accounting lock date forward, so nothing
-- can be back-dated into a VAT return that has already gone to SARS.

create or replace function public.acc_close_tax_period(p_tax_period uuid)
returns public.tax_periods
language plpgsql
security invoker
as $$
declare
  v_company uuid;
  v_from    date;
  v_to      date;
  v_status  text;
  v_out     numeric := 0;
  v_in      numeric := 0;
  v_snap    jsonb;
  v_row     public.tax_periods;
begin
  select company_id, start_date, end_date, status
    into v_company, v_from, v_to, v_status
  from public.tax_periods where id = p_tax_period for update;

  if v_company is null then
    raise exception 'Tax period % not found', p_tax_period;
  end if;
  if v_status = 'closed' then
    raise exception 'That tax period is already closed.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(t.credit - t.debit), 0)
    into v_out
  from public.gl_transactions t
  join public.gl_accounts a on a.id = t.gl_account_id
  where t.company_id = v_company and a.control_type = 'tax_output'
    and t.txn_date between v_from and v_to;

  select coalesce(sum(t.debit - t.credit), 0)
    into v_in
  from public.gl_transactions t
  join public.gl_accounts a on a.id = t.gl_account_id
  where t.company_id = v_company and a.control_type = 'tax_input'
    and t.txn_date between v_from and v_to;

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    into v_snap
  from public.acc_tax_report(v_company, v_from, v_to) r;

  update public.tax_periods
     set status = 'closed',
         output_tax = round(v_out, 2),
         input_tax = round(v_in, 2),
         net_tax = round(v_out - v_in, 2),
         snapshot = v_snap,
         closed_at = now(),
         closed_by = auth.uid()
   where id = p_tax_period
  returning * into v_row;

  -- Move the lock forward, never backward.
  update public.accounting_settings
     set lock_date = greatest(coalesce(lock_date, v_to), v_to), updated_at = now()
   where company_id = v_company;

  return v_row;
end;
$$;


-- ─── Complete a bank reconciliation ─────────────────────────────────────────
-- Marks the matched entries reconciled and writes the statement balance back
-- onto the cash book, which is what the accountant's notes call "update
-- reconciliations so that the statement balance updates".

create or replace function public.acc_update_reconciliation(p_recon uuid)
returns public.bank_reconciliations
language plpgsql
security invoker
as $$
declare
  v_company uuid;
  v_book    uuid;
  v_status  text;
  v_stmt    numeric;
  v_date    date;
  v_matched numeric;
  v_row     public.bank_reconciliations;
begin
  select company_id, cash_book_id, status, statement_balance, statement_date
    into v_company, v_book, v_status, v_stmt, v_date
  from public.bank_reconciliations where id = p_recon for update;

  if v_company is null then
    raise exception 'Reconciliation % not found', p_recon;
  end if;
  if v_status = 'updated' then
    raise exception 'That reconciliation has already been updated.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(case when l.side = 'receipt' then l.amount else -l.amount end), 0)
    into v_matched
  from public.bank_reconciliation_lines l
  where l.reconciliation_id = p_recon and l.matched;

  update public.cash_book_entries e
     set reconciled = true, reconciled_at = now(), reconciliation_id = p_recon
   from public.bank_reconciliation_lines l
  where l.reconciliation_id = p_recon
    and l.matched
    and e.id = l.cash_book_entry_id;

  update public.cash_books
     set statement_balance = v_stmt, last_reconciled_date = v_date, updated_at = now()
   where id = v_book;

  update public.bank_reconciliations
     set status = 'updated',
         book_balance = v_matched,
         difference = round(v_stmt - v_matched, 2),
         completed_at = now(),
         completed_by = auth.uid()
   where id = p_recon
  returning * into v_row;

  return v_row;
end;
$$;
