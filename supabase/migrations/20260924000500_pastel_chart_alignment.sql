-- ============================================================================
-- Canna Life Co — Align the chart of accounts with the client's Pastel ledger
-- ----------------------------------------------------------------------------
-- Source: "General Ledger Master Listing" printed from the client's Pastel on
-- 23/09/2026 (Aruzascope (Pty) Ltd) — 120 accounts, Financial Categories
-- B05–B80 / I05–I35, plus the trial balance snapshot from the accountant.
--
-- Why: the client will migrate their Pastel history into this ledger once the
-- contract is signed off. Account numbers, names and categories therefore have
-- to be identical to Pastel's, so that a trial balance or opening-balance file
-- lands on the same account codes with no translation table in between.
--
-- What this does
--   1. Adds the Pastel metadata to gl_accounts (financial category, "Cat"
--      report-writer number, and an in_pastel_chart marker).
--   2. Stores the 120-account chart once, in acc_chart_template, and makes
--      acc_bootstrap_company() copy from it instead of a hard-coded array.
--   3. Handles Pastel's single VAT control account (9500/000). The old chart had
--      separate VAT input/output accounts and the tax report keyed off them.
--   4. Splits settlement discount into Discount Received (2700) and Discount
--      Allowed (3550), as Pastel does.
--   5. Ties each store's bank account (Bank BW … Bank WP) to its own cash book.
--   6. Re-charts companies that were bootstrapped with the first Canna Life Co chart
--      (acc_align_chart_to_pastel) — in place, never touching posted ledger rows.
--   7. Fixes the tax report counting the VAT line itself inside "output net".
--
-- Safe to run more than once.
-- ============================================================================


-- ─── 1. Columns ─────────────────────────────────────────────────────────────

alter table public.gl_accounts
  add column if not exists financial_category      text,      -- Pastel: 'B60'
  add column if not exists financial_category_name text,      -- Pastel: 'Bank'
  add column if not exists pastel_category         smallint,  -- Pastel "Cat" column (report writer)
  add column if not exists in_pastel_chart         boolean not null default false;

create index if not exists gl_accounts_fincat_idx
  on public.gl_accounts (company_id, financial_category, code, sub_code);

-- Each store banks into its own account (Bank BW, Bank CD …), so a cash book can
-- be tied to the store it serves. Lines captured in that book inherit the store.
alter table public.cash_books
  add column if not exists store_id   uuid,
  add column if not exists store_code text;

-- Pastel has separate Discount Received (2700) and Discount Allowed (3550).
-- rounding_account_id stays as "discount received"; this is the other side.
alter table public.accounting_settings
  add column if not exists discount_allowed_account_id uuid
    references public.gl_accounts(id) on delete set null;

-- Two new control roles: Pastel's single VAT control account, and discount allowed.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.gl_accounts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%control_type%'
  loop
    execute format('alter table public.gl_accounts drop constraint %I', c.conname);
  end loop;

  alter table public.gl_accounts
    add constraint gl_accounts_control_type_ck
    check (control_type is null or control_type in (
      'bank', 'customer', 'supplier', 'inventory',
      'tax_input', 'tax_output', 'tax_control',
      'retained_earnings', 'rounding', 'discount_allowed',
      'interstore', 'stock_adjustment', 'sales', 'cost_of_sales'
    ));
end $$;


-- ─── 2. The Pastel chart, stored once ───────────────────────────────────────
-- Reference data, identical for every company. Companies get a copy in
-- gl_accounts (so they can add their own accounts and rename freely).

create table if not exists public.acc_chart_template (
  code                    text not null,
  sub_code                text not null default '000',
  name                    text not null,
  financial_category      text not null,          -- 'B60'
  financial_category_name text not null,          -- 'Bank'
  pastel_category         smallint,               -- Pastel "Cat"
  category                text not null,          -- Budify: asset/liability/equity/income/expense
  subcategory             text not null,
  is_bank                 boolean not null default false,
  control_type            text,
  sort_order              integer not null,
  primary key (code, sub_code)
);

alter table public.acc_chart_template enable row level security;
drop policy if exists acc_chart_template_select on public.acc_chart_template;
create policy acc_chart_template_select on public.acc_chart_template
  for select to authenticated using (true);
grant select on public.acc_chart_template to authenticated;

insert into public.acc_chart_template
  (code, sub_code, name, financial_category, financial_category_name, pastel_category,
   category, subcategory, is_bank, control_type, sort_order)
values
  ('5100','000','Share Capital / Members Contribution','B10','Share Capital',40,'equity','equity',false,null,1),
  ('5200','000','Retained Income / (Accumulated Loss)','B15','Retained Income',45,'equity','equity',false,'retained_earnings',2),
  ('5400','000','Shareholders / Directors / Members Loans','B20','Shareholders Loan',50,'liability','non_current_liability',false,null,3),
  ('5500','000','Long Term Liabilities','B25','Long Term Borrowings',55,'liability','non_current_liability',false,null,4),
  ('5700','000','Deferred Taxation Provision','B30','Other Long Term Liabilities',58,'liability','non_current_liability',false,null,5),
  ('5600','000','Instalment Sale Creditors','B30','Other Long Term Liabilities',58,'liability','non_current_liability',false,null,6),
  ('6250','010','Computer Equipment - @ Cost','B35','Fixed Assets',63,'asset','non_current_asset',false,null,7),
  ('6250','020','Computer Equipment - Accum Depre','B35','Fixed Assets',63,'asset','non_current_asset',false,null,8),
  ('6250','000','Computer Equipment - Net Value','B35','Fixed Assets',63,'asset','non_current_asset',false,null,9),
  ('6350','010','Furniture & Fittings - @ Cost','B35','Fixed Assets',65,'asset','non_current_asset',false,null,10),
  ('6350','020','Furniture & Fittings - Accum Depre','B35','Fixed Assets',65,'asset','non_current_asset',false,null,11),
  ('6350','000','Furniture & Fittings - Net value','B35','Fixed Assets',65,'asset','non_current_asset',false,null,12),
  ('6100','010','Land & Buildings - @ Cost','B35','Fixed Assets',60,'asset','non_current_asset',false,null,13),
  ('6100','020','Land & Buildings - Accum Depre','B35','Fixed Assets',60,'asset','non_current_asset',false,null,14),
  ('6100','000','Land & Buildings - Net Value','B35','Fixed Assets',60,'asset','non_current_asset',false,null,15),
  ('6200','010','Motor Vehicles - @ Cost','B35','Fixed Assets',62,'asset','non_current_asset',false,null,16),
  ('6200','020','Motor Vehicles - Accum Depre','B35','Fixed Assets',62,'asset','non_current_asset',false,null,17),
  ('6200','000','Motor Vehicles - Net Value','B35','Fixed Assets',62,'asset','non_current_asset',false,null,18),
  ('6300','010','Office Equipment - @ Cost','B35','Fixed Assets',64,'asset','non_current_asset',false,null,19),
  ('6300','020','Office Equipment - Accum Depre','B35','Fixed Assets',64,'asset','non_current_asset',false,null,20),
  ('6300','000','Office Equipment - Net Value','B35','Fixed Assets',64,'asset','non_current_asset',false,null,21),
  ('6600','010','Other Fixed Assets - @ Cost','B35','Fixed Assets',66,'asset','non_current_asset',false,null,22),
  ('6600','020','Other Fixed Assets - Accum Depre','B35','Fixed Assets',66,'asset','non_current_asset',false,null,23),
  ('6600','000','Other Fixed Assets - Net Value','B35','Fixed Assets',66,'asset','non_current_asset',false,null,24),
  ('6150','010','Plant & Machinery - @ Cost','B35','Fixed Assets',61,'asset','non_current_asset',false,null,25),
  ('6150','020','Plant & Machinery - Accum Depre','B35','Fixed Assets',61,'asset','non_current_asset',false,null,26),
  ('6150','000','Plant & Machinery - Net Value','B35','Fixed Assets',61,'asset','non_current_asset',false,null,27),
  ('7100','000','Investments','B40','Investments',70,'asset','non_current_asset',false,null,28),
  ('7100','100','Listed Shares - @ Cost','B40','Investments',70,'asset','non_current_asset',false,null,29),
  ('7400','000','Loans To / (From) Subsidiary Co''s','B40','Investments',70,'asset','non_current_asset',false,null,30),
  ('7200','000','Shares in Subsidiary Companies','B40','Investments',70,'asset','non_current_asset',false,null,31),
  ('7100','200','Unlisted Shares - @ Cost','B40','Investments',70,'asset','non_current_asset',false,null,32),
  ('7000','000','Goodwill / Intangible Assets','B45','Other Fixed Assets',71,'asset','non_current_asset',false,null,33),
  ('7700','000','Inventory Control Account','B50','Inventory',72,'asset','current_asset',false,'inventory',34),
  ('8000','000','Customer Control Account','B55','Accounts Receivable',74,'asset','current_asset',false,'customer',35),
  ('8050','000','Less: Provision For Doubtful Debts','B55','Accounts Receivable',74,'asset','current_asset',false,null,36),
  ('8410','000','Bank BW','B60','Bank',76,'asset','current_asset',true,'bank',37),
  ('8420','000','Bank CD','B60','Bank',76,'asset','current_asset',true,'bank',38),
  ('8430','000','Bank GA','B60','Bank',76,'asset','current_asset',true,'bank',39),
  ('8400','000','Bank Investment','B60','Bank',76,'asset','current_asset',true,'bank',40),
  ('8440','000','Bank ML','B60','Bank',76,'asset','current_asset',true,'bank',41),
  ('8450','000','Bank TB','B60','Bank',76,'asset','current_asset',true,'bank',42),
  ('8460','000','Bank WD','B60','Bank',76,'asset','current_asset',true,'bank',43),
  ('8470','000','Bank WP','B60','Bank',76,'asset','current_asset',true,'bank',44),
  ('8150','000','Cash Control - IQ','B65','Other Current Assets',0,'asset','current_asset',false,null,45),
  ('8100','000','Cash Control - Pastel','B65','Other Current Assets',78,'asset','current_asset',false,null,46),
  ('8200','010','Prepayments / Deferred Expenses','B65','Other Current Assets',78,'asset','current_asset',false,null,47),
  ('8200','020','Staff Loans','B65','Other Current Assets',78,'asset','current_asset',false,null,48),
  ('8200','000','Sundry Customers','B65','Other Current Assets',78,'asset','current_asset',false,null,49),
  ('9100','000','GRN Accrual Account','B70','Accounts Payable',80,'liability','current_liability',false,null,50),
  ('9000','000','Supplier Control Account','B70','Accounts Payable',80,'liability','current_liability',false,'supplier',51),
  ('9300','000','Taxation Payable','B75','Taxation',88,'liability','current_liability',false,null,52),
  ('9350','000','Dividends Payable','B80','Other Current Liabilities',88,'liability','current_liability',false,null,53),
  ('9990','000','Opening Balance / Suspense Account','B80','Other Current Liabilities',88,'liability','current_liability',false,null,54),
  ('9400','000','Provision for Future Expenses','B80','Other Current Liabilities',90,'liability','current_liability',false,null,55),
  ('9400','010','Provision for Insurance','B80','Other Current Liabilities',90,'liability','current_liability',false,null,56),
  ('9400','020','Provision for Salary Bonus','B80','Other Current Liabilities',90,'liability','current_liability',false,null,57),
  ('9250','000','Salary & Wages Control','B80','Other Current Liabilities',88,'liability','current_liability',false,null,58),
  ('9250','010','Salary & Wages Control - UIF','B80','Other Current Liabilities',88,'liability','current_liability',false,null,59),
  ('9200','000','Sundry Suppliers','B80','Other Current Liabilities',88,'liability','current_liability',false,null,60),
  ('9991','000','Suspense Account','B80','Other Current Liabilities',0,'liability','current_liability',false,null,61),
  ('9500','000','Vat / Tax Control Account','B80','Other Current Liabilities',85,'liability','current_liability',false,'tax_control',62),
  ('9510','000','Vat / Tax Provision Account','B80','Other Current Liabilities',85,'liability','current_liability',false,null,63),
  ('1001','000','Refunds Paid','I10','Sales',10,'income','revenue',false,null,64),
  ('1000','000','Sales','I10','Sales',10,'income','revenue',false,'sales',65),
  ('2000','000','Cost of Sales / Purchases','I15','Cost of Sales',15,'expense','cost_of_sales',false,'cost_of_sales',66),
  ('2400','020','Direct Cost Manufac Variance','I15','Cost of Sales',18,'expense','cost_of_sales',false,null,67),
  ('2300','000','Freight on Goods Purchased','I15','Cost of Sales',15,'expense','cost_of_sales',false,null,68),
  ('2100','000','Inventory Adjustment','I15','Cost of Sales',15,'expense','cost_of_sales',false,'stock_adjustment',69),
  ('2150','000','Inventory Count Variance','I15','Cost of Sales',15,'expense','cost_of_sales',false,null,70),
  ('2400','010','Labour Cost Manufac Variance','I15','Cost of Sales',18,'expense','cost_of_sales',false,null,71),
  ('2400','030','Other Cost Manufac Variance','I15','Cost of Sales',18,'expense','cost_of_sales',false,null,72),
  ('2350','000','Packaging Costs','I15','Cost of Sales',15,'expense','cost_of_sales',false,null,73),
  ('2500','000','Pft/Loss on Foreign Currency Exchange','I15','Cost of Sales',15,'expense','cost_of_sales',false,null,74),
  ('2200','000','Purchase Variance','I15','Cost of Sales',15,'expense','cost_of_sales',false,null,75),
  ('2400','000','Recovery Account','I15','Cost of Sales',18,'expense','cost_of_sales',false,null,76),
  ('2850','000','Bad Debts Recovered','I20','Other Income',20,'income','other_income',false,null,77),
  ('2700','000','Discount Received for Cash','I20','Other Income',20,'income','other_income',false,'rounding',78),
  ('2750','000','Interest Received','I20','Other Income',20,'income','other_income',false,null,79),
  ('2800','000','Pft/Loss on Sale of Non Current Assets','I20','Other Income',20,'income','other_income',false,null,80),
  ('2900','000','Sundry Income','I20','Other Income',20,'income','other_income',false,null,81),
  ('3100','000','Accounting / Audit Fees','I25','Expenses',25,'expense','operating',false,null,82),
  ('3000','000','Accounting Fees','I25','Expenses',25,'expense','operating',false,null,83),
  ('3050','000','Advertising & Promotions','I25','Expenses',25,'expense','operating',false,null,84),
  ('3150','000','Bad Debts','I25','Expenses',25,'expense','operating',false,null,85),
  ('3200','000','Bank Charges','I25','Expenses',25,'expense','operating',false,null,86),
  ('3250','000','Cleaning','I25','Expenses',25,'expense','operating',false,null,87),
  ('3300','000','Computer Expenses','I25','Expenses',25,'expense','operating',false,null,88),
  ('3350','000','Consulting Fees','I25','Expenses',25,'expense','operating',false,null,89),
  ('3400','000','Courier & Postage','I25','Expenses',25,'expense','operating',false,null,90),
  ('3450','000','Depreciation','I25','Expenses',25,'expense','operating',false,null,91),
  ('3500','000','Directors Fees / Members Remuneration','I25','Expenses',25,'expense','operating',false,null,92),
  ('3550','000','Discount Allowed for Cash','I25','Expenses',25,'expense','operating',false,'discount_allowed',93),
  ('3600','000','Donations','I25','Expenses',25,'expense','operating',false,null,94),
  ('3650','000','Electricity & Water','I25','Expenses',25,'expense','operating',false,null,95),
  ('3700','000','Entertainment Expenses','I25','Expenses',25,'expense','operating',false,null,96),
  ('3750','000','Finance Charges','I25','Expenses',25,'expense','operating',false,null,97),
  ('3800','000','General Expenses','I25','Expenses',25,'expense','operating',false,null,98),
  ('3850','000','Insurance','I25','Expenses',25,'expense','operating',false,null,99),
  ('3900','000','Interest Paid','I25','Expenses',25,'expense','operating',false,null,100),
  ('3950','000','Leasing Charges','I25','Expenses',25,'expense','operating',false,null,101),
  ('4000','000','Legal Fees','I25','Expenses',25,'expense','operating',false,null,102),
  ('4050','000','Levies','I25','Expenses',25,'expense','operating',false,null,103),
  ('4150','000','Motor Vehicle Expenses','I25','Expenses',25,'expense','operating',false,null,104),
  ('4210','000','Pft/Loss on foreign exchange','I25','Expenses',25,'expense','operating',false,null,105),
  ('4200','000','Printing & Stationery','I25','Expenses',25,'expense','operating',false,null,106),
  ('4300','000','Rent Paid','I25','Expenses',25,'expense','operating',false,null,107),
  ('4350','000','Repairs & Maintenance','I25','Expenses',25,'expense','operating',false,null,108),
  ('4380','000','Royalty Expenses','I25','Expenses',25,'expense','operating',false,null,109),
  ('4400','000','Salaries & Wages','I25','Expenses',25,'expense','operating',false,null,110),
  ('4400','002','Salaries & Wages - UIF','I25','Expenses',25,'expense','operating',false,null,111),
  ('4400','001','Salaries & Wages - Wages','I25','Expenses',25,'expense','operating',false,null,112),
  ('4450','000','Staff Training','I25','Expenses',25,'expense','operating',false,null,113),
  ('4500','000','Staff Welfare','I25','Expenses',25,'expense','operating',false,null,114),
  ('4550','000','Subscriptions','I25','Expenses',25,'expense','operating',false,null,115),
  ('4600','000','Telephone & Fax','I25','Expenses',25,'expense','operating',false,null,116),
  ('4650','000','Travel & Accommodation','I25','Expenses',25,'expense','operating',false,null,117),
  ('4820','000','Deferred Taxation','I30','Tax',30,'expense','other_expense',false,null,118),
  ('4800','000','Normal Taxation','I30','Tax',30,'expense','other_expense',false,null,119),
  ('4850','000','Dividend Declared / Paid','I35','Dividends',35,'equity','equity',false,null,120)
on conflict (code, sub_code) do update
  set name = excluded.name,
      financial_category = excluded.financial_category,
      financial_category_name = excluded.financial_category_name,
      pastel_category = excluded.pastel_category,
      category = excluded.category,
      subcategory = excluded.subcategory,
      is_bank = excluded.is_bank,
      control_type = excluded.control_type,
      sort_order = excluded.sort_order;


-- ─── 3. Posting routines that had to learn about the Pastel chart ───────────

-- 3a. Resolving a posting account by role. New: tax_control (Pastel keeps one
--     VAT account for both directions), discount_allowed, and interstore falling
--     back to Inventory Control — Pastel has no interstore clearing account, and
--     a transfer moves value between stores inside the same inventory account.
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
           when 'discount_allowed'  then s.discount_allowed_account_id
           when 'sales'             then s.sales_account_id
           when 'cost_of_sales'     then s.cost_of_sales_account_id
           when 'retained_earnings' then s.retained_earnings_id
         end
    into v_id
  from public.accounting_settings s
  where s.company_id = p_company;

  -- Interstore: no dedicated clearing account configured → Inventory Control.
  if v_id is null and p_control = 'interstore' then
    select s.inventory_account_id into v_id
    from public.accounting_settings s where s.company_id = p_company;
  end if;

  if v_id is null then
    select id into v_id
    from public.gl_accounts
    where company_id = p_company and active
      and control_type = any (
        case p_control
          when 'tax_input'  then array['tax_input',  'tax_control']
          when 'tax_output' then array['tax_output', 'tax_control']
          when 'interstore' then array['interstore', 'inventory']
          else array[p_control]
        end)
    order by in_pastel_chart desc, code, sub_code
    limit 1;
  end if;

  if v_id is null then
    raise exception 'No % account configured. Set it under Accounting → Settings.', p_control
      using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;

-- 3b. Cash book posting. Two changes: lines with no store inherit the cash book's
--     store; settlement discount on a *receipt* now lands on Discount Allowed
--     (3550) rather than sharing the Discount Received account.
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
  v_book_store  uuid;
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

  select gl_account_id, store_id into v_bank_acct, v_book_store
    from public.cash_books where id = v_cash_book;

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
      values (v_company, v_period, e.entry_date, v_bank_acct, coalesce(e.store_id, v_book_store),
        0, e.amount_inclusive, e.description, e.reference, 'cash_book', e.id, e.id, p_batch_id, auth.uid());
      v_cr := v_cr + e.amount_inclusive;

      -- Allocation (net of tax)
      insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
        debit, credit, description, reference, source_type, source_id, source_line_id, batch_id,
        party_type, party_id, tax_type_id, tax_amount, created_by)
      values (v_company, v_period, e.entry_date, v_alloc, coalesce(e.store_id, v_book_store),
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
        values (v_company, v_period, e.entry_date, v_tax_acct, coalesce(e.store_id, v_book_store),
          e.tax_amount, 0, coalesce(e.description, '') || ' (input tax)', e.reference,
          'cash_book', e.id, e.id, p_batch_id, e.tax_type_id, e.tax_amount, auth.uid());
        v_dr := v_dr + e.tax_amount;
      end if;

      -- Settlement discount received
      if e.gcs in ('C','S') and e.discount <> 0 then
        v_disc_acct := public.acc_control_account(v_company, 'rounding');
        insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
          debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
        values (v_company, v_period, e.entry_date, v_disc_acct, coalesce(e.store_id, v_book_store),
          0, e.discount, coalesce(e.description, '') || ' (settlement discount)', e.reference,
          'cash_book', e.id, e.id, p_batch_id, auth.uid());
        v_cr := v_cr + e.discount;
      end if;

    else -- receipt
      insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
        debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
      values (v_company, v_period, e.entry_date, v_bank_acct, coalesce(e.store_id, v_book_store),
        e.amount_inclusive, 0, e.description, e.reference, 'cash_book', e.id, e.id, p_batch_id, auth.uid());
      v_dr := v_dr + e.amount_inclusive;

      insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
        debit, credit, description, reference, source_type, source_id, source_line_id, batch_id,
        party_type, party_id, tax_type_id, tax_amount, created_by)
      values (v_company, v_period, e.entry_date, v_alloc, coalesce(e.store_id, v_book_store),
        0, e.amount_exclusive + case when e.gcs in ('C','S') then e.discount else 0 end,
        e.description, e.reference, 'cash_book', e.id, e.id, p_batch_id,
        v_party_type, v_party_id, e.tax_type_id, e.tax_amount, auth.uid());
      v_cr := v_cr + e.amount_exclusive + case when e.gcs in ('C','S') then e.discount else 0 end;

      if e.tax_amount <> 0 then
        v_tax_acct := public.acc_control_account(v_company, 'tax_output');
        insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
          debit, credit, description, reference, source_type, source_id, source_line_id, batch_id,
          tax_type_id, tax_amount, created_by)
        values (v_company, v_period, e.entry_date, v_tax_acct, coalesce(e.store_id, v_book_store),
          0, e.tax_amount, coalesce(e.description, '') || ' (output tax)', e.reference,
          'cash_book', e.id, e.id, p_batch_id, e.tax_type_id, e.tax_amount, auth.uid());
        v_cr := v_cr + e.tax_amount;
      end if;

      if e.gcs in ('C','S') and e.discount <> 0 then
        v_disc_acct := public.acc_control_account(v_company, 'discount_allowed');
        insert into public.gl_transactions (company_id, period_id, txn_date, gl_account_id, store_id,
          debit, credit, description, reference, source_type, source_id, source_line_id, batch_id, created_by)
        values (v_company, v_period, e.entry_date, v_disc_acct, coalesce(e.store_id, v_book_store),
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

-- 3c. Tax report. Pastel keeps a single VAT control account, so direction can no
--     longer come from which account was hit: on a tax_control account a credit
--     is output tax and a debit is input tax (receipts credit it, payments
--     debit it). Separate tax_input / tax_output accounts still work as before.
--     Also fixes output_net: it used to include the VAT line itself, because the
--     VAT account is a liability with the tax type stamped on it.
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
                       and coalesce(a.control_type, '') not in ('tax_output','tax_input','tax_control')
                      then t.credit else 0 end), 0)                  as output_net,
    coalesce(sum(case a.control_type
                   when 'tax_output'  then t.credit - t.debit
                   when 'tax_control' then t.credit
                   else 0 end), 0)                                   as output_tax,
    coalesce(sum(case when t.debit > 0 and a.category in ('expense','asset')
                       and coalesce(a.control_type, '') not in ('tax_output','tax_input','tax_control')
                      then t.debit else 0 end), 0)                   as input_net,
    coalesce(sum(case a.control_type
                   when 'tax_input'   then t.debit - t.credit
                   when 'tax_control' then t.debit
                   else 0 end), 0)                                   as input_tax
  from public.tax_types tt
  left join public.gl_transactions t
         on t.tax_type_id = tt.id
        and t.txn_date between p_from and p_to
  left join public.gl_accounts a on a.id = t.gl_account_id
  where tt.company_id = p_company
  group by tt.code, tt.description, tt.rate
  order by tt.code
$$;


-- 3d. Closing a tax period, same direction rule as the report.
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

  select coalesce(sum(case a.control_type
                        when 'tax_output'  then t.credit - t.debit
                        when 'tax_control' then t.credit
                        else 0 end), 0),
         coalesce(sum(case a.control_type
                        when 'tax_input'   then t.debit - t.credit
                        when 'tax_control' then t.debit
                        else 0 end), 0)
    into v_out, v_in
  from public.gl_transactions t
  join public.gl_accounts a on a.id = t.gl_account_id
  where t.company_id = v_company
    and a.control_type in ('tax_output', 'tax_input', 'tax_control')
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


-- ─── 4. Seeding, re-charting and bootstrap ──────────────────────────────────

-- 4a. Copy the Pastel chart into a company. Existing accounts (same code and
--     sub code) are left exactly as they are — a club's own edits win.
create or replace function public.acc_seed_pastel_accounts(p_company uuid)
returns integer
language plpgsql
security invoker
as $$
declare
  v_none  uuid;
  v_added integer;
begin
  select id into v_none from public.tax_types where company_id = p_company and code = '00';

  with ins as (
    insert into public.gl_accounts (
      company_id, code, sub_code, name, category, subcategory, is_bank, control_type,
      default_tax_type_id, financial_category, financial_category_name, pastel_category,
      in_pastel_chart
    )
    select p_company, t.code, t.sub_code, t.name, t.category, t.subcategory, t.is_bank,
           t.control_type,
           v_none,             -- Pastel: every account is "No tax type, default 00"
           t.financial_category, t.financial_category_name, t.pastel_category, true
    from public.acc_chart_template t
    order by t.sort_order
    on conflict (company_id, code, sub_code) do nothing
    returning 1
  )
  select count(*) into v_added from ins;

  -- Accounts that already existed under a Pastel code: keep them, but carry the
  -- Pastel category across when their name still matches the Pastel name.
  update public.gl_accounts a
     set financial_category = t.financial_category,
         financial_category_name = t.financial_category_name,
         pastel_category = t.pastel_category,
         in_pastel_chart = true
    from public.acc_chart_template t
   where a.company_id = p_company
     and a.code = t.code and a.sub_code = t.sub_code
     and a.name = t.name
     and not a.in_pastel_chart;

  return v_added;
end;
$$;


-- 4b. Point the automatic postings at the right accounts. Only fills gaps —
--     anything already set in Accounting → Setup is left alone.
create or replace function public.acc_apply_posting_map(p_company uuid)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.accounting_settings (company_id) values (p_company)
  on conflict (company_id) do nothing;

  update public.accounting_settings s
     set default_tax_type_id      = coalesce(s.default_tax_type_id,
           (select id from public.tax_types where company_id = p_company and code = '01')),
         -- Bank BW (8410) is the default; Bank Investment (8400) never is.
         bank_account_id          = coalesce(s.bank_account_id,
           (select id from public.gl_accounts
             where company_id = p_company and active and control_type = 'bank'
             order by (code = '8410') desc, in_pastel_chart desc, code, sub_code limit 1)),
         sales_account_id         = coalesce(s.sales_account_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type = 'sales'
             order by in_pastel_chart desc, code, sub_code limit 1)),
         cost_of_sales_account_id = coalesce(s.cost_of_sales_account_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type = 'cost_of_sales'
             order by in_pastel_chart desc, code, sub_code limit 1)),
         inventory_account_id     = coalesce(s.inventory_account_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type = 'inventory'
             order by in_pastel_chart desc, code, sub_code limit 1)),
         -- One VAT control account serves both directions.
         tax_input_account_id     = coalesce(s.tax_input_account_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type in ('tax_control','tax_input')
             order by (control_type = 'tax_control') desc, in_pastel_chart desc, code, sub_code limit 1)),
         tax_output_account_id    = coalesce(s.tax_output_account_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type in ('tax_control','tax_output')
             order by (control_type = 'tax_control') desc, in_pastel_chart desc, code, sub_code limit 1)),
         debtors_control_id       = coalesce(s.debtors_control_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type = 'customer'
             order by in_pastel_chart desc, code, sub_code limit 1)),
         creditors_control_id     = coalesce(s.creditors_control_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type = 'supplier'
             order by in_pastel_chart desc, code, sub_code limit 1)),
         retained_earnings_id     = coalesce(s.retained_earnings_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type = 'retained_earnings'
             order by in_pastel_chart desc, code, sub_code limit 1)),
         rounding_account_id      = coalesce(s.rounding_account_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type = 'rounding'
             order by in_pastel_chart desc, code, sub_code limit 1)),
         discount_allowed_account_id = coalesce(s.discount_allowed_account_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type = 'discount_allowed'
             order by in_pastel_chart desc, code, sub_code limit 1)),
         stock_adjustment_id      = coalesce(s.stock_adjustment_id,
           (select id from public.gl_accounts where company_id = p_company and active and control_type = 'stock_adjustment'
             order by in_pastel_chart desc, code, sub_code limit 1)),
         -- interstore_clearing_id deliberately left empty: transfers run through
         -- Inventory Control (see acc_control_account).
         updated_at = now()
   where s.company_id = p_company;
end;
$$;


-- 4c. Re-chart a company that was bootstrapped with the first Canna Life Co chart.
--
--   • Only accounts whose code AND name still match the original bootstrap are
--     touched; anything the club added or renamed is left alone.
--   • Old accounts are parked out of the way (sub code 'L000'), the Pastel chart
--     is seeded, then every reference is repointed to the nearest Pastel account.
--   • A parked account with no posted ledger rows is deleted. One with history is
--     kept, inactive, so the audit trail survives. gl_transactions is never edited.
--   • Cash books on a parked bank account with nothing captured are dropped;
--     bootstrap then creates one per Pastel bank account.
--
-- Returns a summary. Idempotent: with no legacy accounts left it only seeds.
create or replace function public.acc_align_chart_to_pastel(p_company uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  -- old code, old name, Pastel code, Pastel sub code
  v_map    text[][] := array[
    ['1000','Inventory',                    '7700','000'],
    ['1100','Debtors Control',              '8000','000'],
    ['1200','Petty Cash',                   '8100','000'],
    ['1300','VAT Input',                    '9500','000'],
    ['1400','Prepaid Expenses',             '8200','010'],
    ['1700','Furniture & Equipment',        '6350','010'],
    ['1750','Accumulated Depreciation',     '6350','020'],
    ['8400','Bank - Current Account',       '8410','000'],
    ['9000','Interstore Clearing',          '7700','000'],
    ['9100','Suspense',                     '9991','000'],
    ['2000','Creditors Control',            '9000','000'],
    ['2100','VAT Output',                   '9500','000'],
    ['2200','Accruals',                     '9400','000'],
    ['2300','Member Deposits Held',         '9991','000'],
    ['3000','Owners Capital',               '5100','000'],
    ['3100','Retained Earnings',            '5200','000'],
    ['4000','Sales',                        '1000','000'],
    ['4100','Membership Fees',              '1000','000'],
    ['4200','Grow Club Fees',               '1000','000'],
    ['4800','Other Income',                 '2900','000'],
    ['4900','Settlement Discount Received', '2700','000'],
    ['5000','Cost of Sales',                '2000','000'],
    ['5100','Stock Adjustments',            '2100','000'],
    ['6000','Rent',                         '4300','000'],
    ['6010','Salaries & Wages',             '4400','000'],
    ['6020','Electricity & Water',          '3650','000'],
    ['6030','Bank Charges',                 '3200','000'],
    ['6040','Telephone & Internet',         '4600','000'],
    ['6050','Marketing & Advertising',      '3050','000'],
    ['6060','Repairs & Maintenance',        '4350','000'],
    ['6070','Accounting & Secretarial',     '3000','000'],
    ['6080','Insurance',                    '3850','000'],
    ['6090','Consumables & Packaging',      '3800','000'],
    ['6100','Security',                     '3800','000'],
    ['6110','Licences & Compliance',        '3800','000'],
    ['6120','Software & Subscriptions',     '4550','000'],
    ['6900','Sundry Expenses',              '3800','000']
  ];
  i         integer;
  v_parked  uuid[] := '{}';
  v_targets uuid[] := '{}';
  v_id      uuid;
  v_target  uuid;
  fk        record;
  v_removed integer := 0;
  v_kept    integer := 0;
  v_hist    boolean;
  v_added   integer;
  v_clash   jsonb := '[]'::jsonb;
begin
  if p_company is null then
    raise exception 'acc_align_chart_to_pastel needs a company id';
  end if;

  -- Phase 1: park the legacy accounts so their codes are free.
  for i in 1 .. array_length(v_map, 1) loop
    select id into v_id
    from public.gl_accounts
    where company_id = p_company and code = v_map[i][1] and sub_code = '000'
      and name = v_map[i][2] and not in_pastel_chart;
    if v_id is not null then
      update public.gl_accounts set sub_code = 'L' || sub_code, updated_at = now() where id = v_id;
      v_parked := v_parked || v_id;
    end if;
    v_id := null;
  end loop;

  -- Phase 2: seed the Pastel chart.
  v_added := public.acc_seed_pastel_accounts(p_company);

  -- Any Pastel code already taken by a club's own account is reported, not overwritten.
  select coalesce(jsonb_agg(t.code || '/' || t.sub_code), '[]'::jsonb) into v_clash
  from public.acc_chart_template t
  join public.gl_accounts a on a.company_id = p_company and a.code = t.code and a.sub_code = t.sub_code
  where not a.in_pastel_chart;

  -- Phase 3: repoint and retire each parked account.
  for i in 1 .. array_length(v_map, 1) loop
    select id into v_id
    from public.gl_accounts
    where company_id = p_company and id = any (v_parked)
      and code = v_map[i][1] and name = v_map[i][2]
    limit 1;
    continue when v_id is null;

    select id into v_target
    from public.gl_accounts
    where company_id = p_company and code = v_map[i][3] and sub_code = v_map[i][4] and in_pastel_chart;

    v_hist := exists (select 1 from public.gl_transactions t where t.gl_account_id = v_id);

    if v_target is not null then
      -- Empty cash books on a legacy bank account are simply removed.
      delete from public.cash_books cb
       where cb.company_id = p_company and cb.gl_account_id = v_id
         and not exists (select 1 from public.cash_book_batches b where b.cash_book_id = cb.id)
         and not exists (select 1 from public.cash_book_entries e where e.cash_book_id = cb.id);

      -- The posting map always moves to the Pastel account. With no ledger
      -- history, every other reference moves too. With history, only lines that
      -- have not been posted yet move: posted documents keep pointing at the
      -- account their ledger rows are on, so the two never disagree.
      -- gl_transactions is never rewritten.
      for fk in
        select c.conrelid::regclass::text as tbl, a.attname as col,
               (c.conrelid = 'public.accounting_settings'::regclass) as is_settings
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.confrelid = 'public.gl_accounts'::regclass and c.contype = 'f'
          and c.conrelid <> 'public.gl_transactions'::regclass
      loop
        continue when v_hist and not fk.is_settings;
        execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
          using v_target, v_id;
      end loop;

      if v_hist then
        update public.cash_book_entries set gl_account_id = v_target
         where gl_account_id = v_id and not posted;
        update public.journal_entries je set gl_account_id = v_target
          from public.journal_batches jb
         where je.batch_id = jb.id and jb.status = 'open' and je.gl_account_id = v_id;
        update public.inventory_journal_entries ie set gl_account_id = v_target
          from public.inventory_journal_batches ib
         where ie.batch_id = ib.id and ib.status = 'open' and ie.gl_account_id = v_id;
        update public.inventory_journal_entries ie set markup_account_id = v_target
          from public.inventory_journal_batches ib
         where ie.batch_id = ib.id and ib.status = 'open' and ie.markup_account_id = v_id;
      end if;
    end if;

    if v_hist then
      update public.gl_accounts
         set active = false, name = name || ' (legacy)', updated_at = now()
       where id = v_id;
      v_kept := v_kept + 1;
    else
      delete from public.gl_accounts where id = v_id;
      v_removed := v_removed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'pastel_accounts_added', v_added,
    'legacy_removed',        v_removed,
    'legacy_kept_inactive',  v_kept,
    'code_clashes',          v_clash
  );
end;
$$;


-- 4d. One call gives a club a working set of books, on the Pastel chart.
--     Same signature as before, so the Cash Books screen needs no change.
create or replace function public.acc_bootstrap_company(
  p_company    uuid,
  p_year_start date default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_start      date;
  v_end        date;
  v_year       uuid;
  v_tax_std    uuid;
  v_cash_book  uuid;
  i            integer;
  p_start      date;
  p_end        date;
  v_align      jsonb;
  b            record;
  v_next       integer;
begin
  if p_company is null then
    raise exception 'acc_bootstrap_company needs a company id';
  end if;

  -- ── Tax types ────────────────────────────────────────────────────────────
  insert into public.tax_types (company_id, code, description, rate, tax_kind, is_default)
  values (p_company, '00', 'Tax type 0 - No tax', 0, 'none', false)
  on conflict (company_id, code) do nothing;

  insert into public.tax_types (company_id, code, description, rate, tax_kind, is_default)
  values (p_company, '01', 'VAT - Standard rate 15%', 15, 'both', true)
  on conflict (company_id, code) do nothing;

  insert into public.tax_types (company_id, code, description, rate, tax_kind, is_default)
  values (p_company, '02', 'VAT - Zero rated', 0, 'output', false)
  on conflict (company_id, code) do nothing;

  insert into public.tax_types (company_id, code, description, rate, tax_kind, is_default)
  values (p_company, '03', 'VAT - Exempt', 0, 'both', false)
  on conflict (company_id, code) do nothing;

  select id into v_tax_std from public.tax_types where company_id = p_company and code = '01';

  -- ── Chart of accounts: the client's Pastel chart ─────────────────────────
  v_align := public.acc_align_chart_to_pastel(p_company);

  -- ── Financial year (SA default: March → February) ────────────────────────
  v_start := coalesce(
    p_year_start,
    case when extract(month from current_date) >= 3
         then make_date(extract(year from current_date)::int, 3, 1)
         else make_date(extract(year from current_date)::int - 1, 3, 1)
    end
  );
  v_end := (v_start + interval '1 year - 1 day')::date;

  insert into public.financial_years (company_id, name, start_date, end_date, is_current)
  values (p_company,
          to_char(v_start, 'YYYY') || '/' || to_char(v_end, 'YY'),
          v_start, v_end, true)
  on conflict (company_id, name) do nothing;

  select id into v_year from public.financial_years
   where company_id = p_company and start_date = v_start limit 1;

  for i in 1 .. 12 loop
    p_start := (v_start + ((i - 1) || ' month')::interval)::date;
    p_end   := ((p_start + interval '1 month') - interval '1 day')::date;
    insert into public.accounting_periods (
      company_id, financial_year_id, period_no, name, start_date, end_date
    )
    values (
      p_company, v_year, i,
      lpad(i::text, 2, '0') || ' - ' || to_char(p_start, 'Mon YYYY'),
      p_start, p_end
    )
    on conflict (financial_year_id, period_no) do nothing;
  end loop;

  -- Period 13 carries year-end adjustments and shares the last day.
  insert into public.accounting_periods (
    company_id, financial_year_id, period_no, name, start_date, end_date
  )
  values (p_company, v_year, 13, '13 - Year End Adjustments', v_end, v_end)
  on conflict (financial_year_id, period_no) do nothing;

  -- ── Posting map ──────────────────────────────────────────────────────────
  perform public.acc_apply_posting_map(p_company);

  -- ── One cash book per bank account (Bank BW … Bank WP, Bank Investment) ──
  for b in
    select id, name from public.gl_accounts
     where company_id = p_company and active and is_bank and in_pastel_chart
     order by code, sub_code
  loop
    if not exists (select 1 from public.cash_books where company_id = p_company and gl_account_id = b.id) then
      select coalesce(max(code::integer), 0) + 1 into v_next
        from public.cash_books where company_id = p_company and code ~ '^[0-9]+$';
      insert into public.cash_books (company_id, code, name, gl_account_id, default_tax_type_id, store_code)
      values (p_company, lpad(v_next::text, 2, '0'), b.name, b.id, v_tax_std,
              case when b.name ~ '^Bank [A-Z]{2}$' then right(b.name, 2) end);
    end if;
  end loop;

  -- A cash book carried over from the first chart takes the Pastel bank name.
  update public.cash_books cb
     set name = a.name,
         store_code = coalesce(cb.store_code, case when a.name ~ '^Bank [A-Z]{2}$' then right(a.name, 2) end),
         updated_at = now()
    from public.gl_accounts a
   where cb.company_id = p_company and cb.gl_account_id = a.id
     and a.in_pastel_chart and cb.name = 'Bank - Current Account';

  select id into v_cash_book from public.cash_books
   where company_id = p_company and active order by code limit 1;

  return jsonb_build_object(
    'company_id',      p_company,
    'financial_year',  v_year,
    'accounts',        (select count(*) from public.gl_accounts       where company_id = p_company and active),
    'pastel_accounts', (select count(*) from public.gl_accounts       where company_id = p_company and in_pastel_chart),
    'periods',         (select count(*) from public.accounting_periods where company_id = p_company),
    'tax_types',       (select count(*) from public.tax_types          where company_id = p_company),
    'cash_books',      (select count(*) from public.cash_books          where company_id = p_company),
    'cash_book',       v_cash_book,
    'chart',           v_align
  );
end;
$$;

grant execute on function public.acc_seed_pastel_accounts(uuid)       to authenticated;
grant execute on function public.acc_apply_posting_map(uuid)          to authenticated;
grant execute on function public.acc_align_chart_to_pastel(uuid)      to authenticated;
grant execute on function public.acc_bootstrap_company(uuid, date)    to authenticated;
grant execute on function public.acc_control_account(uuid, text)      to authenticated;
grant execute on function public.acc_post_cash_book_batch(uuid)       to authenticated;
grant execute on function public.acc_tax_report(uuid, date, date)     to authenticated;
grant execute on function public.acc_close_tax_period(uuid)           to authenticated;
