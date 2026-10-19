-- ============================================================================
-- Cannalife Co — One-call accounting bootstrap for a club
-- ----------------------------------------------------------------------------
-- acc_bootstrap_company() gives a club a working set of books in one call:
-- SA tax types, a cannabis-club chart of accounts, a financial year with 12
-- periods, the posting map, and a first cash book on the bank account.
--
-- Idempotent: run it again and it fills in what is missing without duplicating
-- what is already there. That matters because Cannalife Co onboards franchisee
-- stores one at a time.
-- ============================================================================

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
  v_tax_zero   uuid;
  v_bank       uuid;
  v_cash_book  uuid;
  i            integer;
  p_start      date;
  p_end        date;
  v_created    jsonb := '{}'::jsonb;

  -- code, sub, name, category, subcategory, is_bank, control_type
  accounts     text[][] := array[
    ['1000','000','Inventory',                  'asset',    'current_asset',     'f','inventory'],
    ['1100','000','Debtors Control',            'asset',    'current_asset',     'f','customer'],
    ['1200','000','Petty Cash',                 'asset',    'current_asset',     'f',null],
    ['1300','000','VAT Input',                  'asset',    'current_asset',     'f','tax_input'],
    ['1400','000','Prepaid Expenses',           'asset',    'current_asset',     'f',null],
    ['1700','000','Furniture & Equipment',      'asset',    'non_current_asset', 'f',null],
    ['1750','000','Accumulated Depreciation',   'asset',    'non_current_asset', 'f',null],
    ['8400','000','Bank - Current Account',     'asset',    'current_asset',     't','bank'],
    ['9000','000','Interstore Clearing',        'asset',    'current_asset',     'f','interstore'],
    ['9100','000','Suspense',                   'asset',    'current_asset',     'f',null],

    ['2000','000','Creditors Control',          'liability','current_liability', 'f','supplier'],
    ['2100','000','VAT Output',                 'liability','current_liability', 'f','tax_output'],
    ['2200','000','Accruals',                   'liability','current_liability', 'f',null],
    ['2300','000','Member Deposits Held',       'liability','current_liability', 'f',null],

    ['3000','000','Owners Capital',             'equity',   'equity',            'f',null],
    ['3100','000','Retained Earnings',          'equity',   'equity',            'f','retained_earnings'],

    ['4000','000','Sales',                      'income',   'revenue',           'f','sales'],
    ['4100','000','Membership Fees',            'income',   'revenue',           'f',null],
    ['4200','000','Grow Club Fees',             'income',   'revenue',           'f',null],
    ['4800','000','Other Income',               'income',   'other_income',      'f',null],
    ['4900','000','Settlement Discount Received','income',  'other_income',      'f','rounding'],

    ['5000','000','Cost of Sales',              'expense',  'cost_of_sales',     'f','cost_of_sales'],
    ['5100','000','Stock Adjustments',          'expense',  'cost_of_sales',     'f','stock_adjustment'],
    ['6000','000','Rent',                       'expense',  'operating',         'f',null],
    ['6010','000','Salaries & Wages',           'expense',  'operating',         'f',null],
    ['6020','000','Electricity & Water',        'expense',  'operating',         'f',null],
    ['6030','000','Bank Charges',               'expense',  'operating',         'f',null],
    ['6040','000','Telephone & Internet',       'expense',  'operating',         'f',null],
    ['6050','000','Marketing & Advertising',    'expense',  'operating',         'f',null],
    ['6060','000','Repairs & Maintenance',      'expense',  'operating',         'f',null],
    ['6070','000','Accounting & Secretarial',   'expense',  'operating',         'f',null],
    ['6080','000','Insurance',                  'expense',  'operating',         'f',null],
    ['6090','000','Consumables & Packaging',    'expense',  'operating',         'f',null],
    ['6100','000','Security',                   'expense',  'operating',         'f',null],
    ['6110','000','Licences & Compliance',      'expense',  'operating',         'f',null],
    ['6120','000','Software & Subscriptions',   'expense',  'operating',         'f',null],
    ['6900','000','Sundry Expenses',            'expense',  'operating',         'f',null]
  ];
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

  select id into v_tax_std  from public.tax_types where company_id = p_company and code = '01';
  select id into v_tax_zero from public.tax_types where company_id = p_company and code = '00';

  -- ── Chart of accounts ────────────────────────────────────────────────────
  for i in 1 .. array_length(accounts, 1) loop
    insert into public.gl_accounts (
      company_id, code, sub_code, name, category, subcategory, is_bank, control_type,
      default_tax_type_id
    )
    values (
      p_company, accounts[i][1], accounts[i][2], accounts[i][3],
      accounts[i][4], accounts[i][5], accounts[i][6]::boolean, accounts[i][7],
      case when accounts[i][4] in ('income', 'expense') then v_tax_std else v_tax_zero end
    )
    on conflict (company_id, code, sub_code) do nothing;
  end loop;

  select id into v_bank from public.gl_accounts
   where company_id = p_company and control_type = 'bank' order by code limit 1;

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
  insert into public.accounting_settings (company_id) values (p_company)
  on conflict (company_id) do nothing;

  update public.accounting_settings s
     set default_tax_type_id      = coalesce(s.default_tax_type_id, v_tax_std),
         bank_account_id          = coalesce(s.bank_account_id,          (select id from public.gl_accounts where company_id = p_company and control_type = 'bank'              order by code limit 1)),
         sales_account_id         = coalesce(s.sales_account_id,         (select id from public.gl_accounts where company_id = p_company and control_type = 'sales'             limit 1)),
         cost_of_sales_account_id = coalesce(s.cost_of_sales_account_id, (select id from public.gl_accounts where company_id = p_company and control_type = 'cost_of_sales'     limit 1)),
         inventory_account_id     = coalesce(s.inventory_account_id,     (select id from public.gl_accounts where company_id = p_company and control_type = 'inventory'         limit 1)),
         tax_input_account_id     = coalesce(s.tax_input_account_id,     (select id from public.gl_accounts where company_id = p_company and control_type = 'tax_input'         limit 1)),
         tax_output_account_id    = coalesce(s.tax_output_account_id,    (select id from public.gl_accounts where company_id = p_company and control_type = 'tax_output'        limit 1)),
         debtors_control_id       = coalesce(s.debtors_control_id,       (select id from public.gl_accounts where company_id = p_company and control_type = 'customer'          limit 1)),
         creditors_control_id     = coalesce(s.creditors_control_id,     (select id from public.gl_accounts where company_id = p_company and control_type = 'supplier'          limit 1)),
         retained_earnings_id     = coalesce(s.retained_earnings_id,     (select id from public.gl_accounts where company_id = p_company and control_type = 'retained_earnings' limit 1)),
         rounding_account_id      = coalesce(s.rounding_account_id,      (select id from public.gl_accounts where company_id = p_company and control_type = 'rounding'          limit 1)),
         stock_adjustment_id      = coalesce(s.stock_adjustment_id,      (select id from public.gl_accounts where company_id = p_company and control_type = 'stock_adjustment'  limit 1)),
         interstore_clearing_id   = coalesce(s.interstore_clearing_id,   (select id from public.gl_accounts where company_id = p_company and control_type = 'interstore'        limit 1)),
         updated_at = now()
   where s.company_id = p_company;

  -- ── First cash book ──────────────────────────────────────────────────────
  if v_bank is not null then
    insert into public.cash_books (company_id, code, name, gl_account_id, default_tax_type_id)
    values (p_company, '01', 'Bank - Current Account', v_bank, v_tax_std)
    on conflict (company_id, code) do nothing;
    select id into v_cash_book from public.cash_books where company_id = p_company and code = '01';
  end if;

  v_created := jsonb_build_object(
    'company_id',      p_company,
    'financial_year',  v_year,
    'accounts',        (select count(*) from public.gl_accounts       where company_id = p_company),
    'periods',         (select count(*) from public.accounting_periods where company_id = p_company),
    'tax_types',       (select count(*) from public.tax_types          where company_id = p_company),
    'cash_book',       v_cash_book
  );
  return v_created;
end;
$$;

grant execute on function public.acc_bootstrap_company(uuid, date) to authenticated;
