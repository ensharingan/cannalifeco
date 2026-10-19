-- ============================================================================
-- Cannalife Co — Double-entry accounting core
-- ----------------------------------------------------------------------------
-- Adds a Pastel/Sage-style general ledger to the POS: chart of accounts,
-- financial years and periods, tax types, cash books with payment/receipt
-- processing, bank reconciliation, general journals, inventory journals,
-- interstore transfers and tax period close-off.
--
-- Everything is company-scoped. The posted ledger is gl_transactions — every
-- other table either feeds it (batches) or reports off it.
--
-- Safe to run more than once: every object is IF NOT EXISTS / OR REPLACE.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- The company and role of the calling user. SECURITY DEFINER so the policies
-- below can read profiles without recursing through profiles' own RLS.

create or replace function public.acc_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

create or replace function public.acc_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Owner/manager/superadmin may touch the books. Cashiers never may.
create or replace function public.acc_can_post()
returns boolean
language sql
stable
as $$
  select coalesce(public.acc_role() in ('owner', 'manager', 'superadmin'), false)
$$;


-- ─── Tax types ──────────────────────────────────────────────────────────────
-- Mirrors Pastel's tax type list: '00' is the zero/no-tax type, '01' is the
-- standard SA VAT rate. Rates live here, never hard-coded in the UI, so a
-- rate change is a data change.

create table if not exists public.tax_types (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  code              text not null,
  description       text not null,
  rate              numeric(9,4) not null default 0,       -- 15.0000 = 15%
  tax_kind          text not null default 'both'
                      check (tax_kind in ('input', 'output', 'both', 'none')),
  is_default        boolean not null default false,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  unique (company_id, code)
);

create index if not exists tax_types_company_idx on public.tax_types (company_id) where active;


-- ─── Chart of accounts ──────────────────────────────────────────────────────
-- Pastel-style main account + sub account ("8400/000"). control_type marks the
-- handful of accounts the posting routines need to find by role rather than by
-- code, so a club can renumber its chart without breaking posting.

create table if not exists public.gl_accounts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  code                text not null,
  sub_code            text not null default '000',
  name                text not null,
  category            text not null
                        check (category in ('asset', 'liability', 'equity', 'income', 'expense')),
  subcategory         text,
  is_bank             boolean not null default false,
  is_control          boolean not null default false,
  control_type        text
                        check (control_type is null or control_type in (
                          'bank', 'customer', 'supplier', 'inventory',
                          'tax_input', 'tax_output', 'retained_earnings',
                          'rounding', 'interstore', 'stock_adjustment',
                          'sales', 'cost_of_sales'
                        )),
  default_tax_type_id uuid references public.tax_types(id) on delete set null,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  unique (company_id, code, sub_code)
);

create index if not exists gl_accounts_company_idx on public.gl_accounts (company_id, code, sub_code);
create index if not exists gl_accounts_control_idx on public.gl_accounts (company_id, control_type) where control_type is not null;


-- ─── Financial years and periods ────────────────────────────────────────────
-- SA financial years usually run March→February, hence 12 periods plus an
-- optional period 13 for year-end adjustments.

create table if not exists public.financial_years (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  start_date    date not null,
  end_date      date not null,
  is_current    boolean not null default false,
  status        text not null default 'open' check (status in ('open', 'closed')),
  created_at    timestamptz not null default now(),
  unique (company_id, name),
  check (end_date > start_date)
);

create table if not exists public.accounting_periods (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  financial_year_id  uuid not null references public.financial_years(id) on delete cascade,
  period_no          integer not null check (period_no between 1 and 13),
  name               text not null,
  start_date         date not null,
  end_date           date not null,
  status             text not null default 'open' check (status in ('open', 'closed')),
  closed_at          timestamptz,
  closed_by          uuid,
  created_at         timestamptz not null default now(),
  unique (financial_year_id, period_no),
  check (end_date >= start_date)
);

create index if not exists accounting_periods_company_idx
  on public.accounting_periods (company_id, start_date, end_date);


-- ─── Company accounting settings ────────────────────────────────────────────
-- One row per company. The *_account_id columns are the posting map: which GL
-- account each automatic double entry lands on.

create table if not exists public.accounting_settings (
  company_id                 uuid primary key references public.companies(id) on delete cascade,
  financial_year_start_month integer not null default 3 check (financial_year_start_month between 1 and 12),
  tax_entry_method           text not null default 'inclusive' check (tax_entry_method in ('inclusive', 'exclusive')),
  default_tax_type_id        uuid references public.tax_types(id) on delete set null,

  bank_account_id            uuid references public.gl_accounts(id) on delete set null,
  sales_account_id           uuid references public.gl_accounts(id) on delete set null,
  cost_of_sales_account_id   uuid references public.gl_accounts(id) on delete set null,
  inventory_account_id       uuid references public.gl_accounts(id) on delete set null,
  tax_input_account_id       uuid references public.gl_accounts(id) on delete set null,
  tax_output_account_id      uuid references public.gl_accounts(id) on delete set null,
  debtors_control_id         uuid references public.gl_accounts(id) on delete set null,
  creditors_control_id       uuid references public.gl_accounts(id) on delete set null,
  retained_earnings_id       uuid references public.gl_accounts(id) on delete set null,
  rounding_account_id        uuid references public.gl_accounts(id) on delete set null,
  stock_adjustment_id        uuid references public.gl_accounts(id) on delete set null,
  interstore_clearing_id     uuid references public.gl_accounts(id) on delete set null,

  -- Nothing may post on or before this date. Set it after a period is signed off.
  lock_date                  date,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz
);


-- ─── Cash books ─────────────────────────────────────────────────────────────
-- One cash book per bank account, exactly as in the accountant's notes. The
-- contra account is the bank GL account; its balance is what the cash book
-- screen shows and what the bank reconciliation ties back to.

create table if not exists public.cash_books (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  code                        text not null,                 -- '01', '02' …
  name                        text not null,                 -- 'Bank Investment'
  gl_account_id               uuid not null references public.gl_accounts(id) on delete restrict,
  bank_name                   text,
  account_number              text,
  branch_code                 text,

  -- Settings dialog
  tax_processing              boolean not null default true,
  default_tax_type_id         uuid references public.tax_types(id) on delete set null,
  entry_method                text not null default 'inclusive' check (entry_method in ('inclusive', 'exclusive')),
  increment_references        text not null default 'yes' check (increment_references in ('yes', 'no', 'once')),
  repeat_descriptions         boolean not null default true,
  invoke_open_item            boolean not null default true,
  allocate_settlement_discount boolean not null default false,
  this_year_transactions      boolean not null default true,

  -- Last reconciled statement figure, updated by the reconciliation assistant.
  statement_balance           numeric(14,2) not null default 0,
  last_reconciled_date        date,
  active                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz,
  unique (company_id, code)
);

create index if not exists cash_books_company_idx on public.cash_books (company_id) where active;


-- ─── Cash book batches and entries ──────────────────────────────────────────
-- A batch is one capture session against one cash book. Entries carry both
-- sides (payments and receipts) and are only reflected in the ledger once the
-- batch is posted — mirroring Pastel's Update.

create table if not exists public.cash_book_batches (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  cash_book_id  uuid not null references public.cash_books(id) on delete cascade,
  period_id     uuid references public.accounting_periods(id) on delete set null,
  description   text,
  status        text not null default 'open' check (status in ('open', 'posted', 'deleted')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  posted_at     timestamptz,
  posted_by     uuid
);

create index if not exists cash_book_batches_open_idx
  on public.cash_book_batches (company_id, cash_book_id, status);

create table if not exists public.cash_book_entries (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  batch_id             uuid not null references public.cash_book_batches(id) on delete cascade,
  cash_book_id         uuid not null references public.cash_books(id) on delete cascade,
  side                 text not null check (side in ('payment', 'receipt')),
  line_no              integer not null default 1,

  period_id            uuid references public.accounting_periods(id) on delete set null,
  entry_date           date not null,

  -- GCS: allocate to a General ledger account, a Customer (member) or a Supplier.
  gcs                  char(1) not null default 'G' check (gcs in ('G', 'C', 'S')),
  gl_account_id        uuid references public.gl_accounts(id) on delete restrict,
  member_id            uuid,
  supplier_id          uuid,
  store_id             uuid,

  reference            text,
  description          text,

  tax_type_id          uuid references public.tax_types(id) on delete set null,
  tax_rate             numeric(9,4) not null default 0,
  amount_inclusive     numeric(14,2) not null default 0,
  amount_exclusive     numeric(14,2) not null default 0,
  tax_amount           numeric(14,2) not null default 0,

  discount             numeric(14,2) not null default 0,
  discount_tax_type_id uuid references public.tax_types(id) on delete set null,
  project              text,

  reconciled           boolean not null default false,
  reconciled_at        timestamptz,
  reconciliation_id    uuid,

  posted               boolean not null default false,
  posted_at            timestamptz,

  source               text not null default 'manual' check (source in ('manual', 'import')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,

  -- The allocation target must match the GCS letter. Catching this here means
  -- a half-captured line can never reach the ledger.
  constraint cash_book_entries_allocation_ck check (
    (gcs = 'G' and gl_account_id is not null and member_id is null and supplier_id is null) or
    (gcs = 'C' and member_id  is not null and gl_account_id is null and supplier_id is null) or
    (gcs = 'S' and supplier_id is not null and gl_account_id is null and member_id is null) or
    (amount_inclusive = 0 and amount_exclusive = 0)   -- an untouched blank row
  )
);

create index if not exists cash_book_entries_batch_idx on public.cash_book_entries (batch_id, side, line_no);
create index if not exists cash_book_entries_recon_idx
  on public.cash_book_entries (company_id, cash_book_id, reconciled, entry_date);
create index if not exists cash_book_entries_posted_idx
  on public.cash_book_entries (company_id, cash_book_id, posted, entry_date);


-- ─── General journals ───────────────────────────────────────────────────────

create table if not exists public.journal_batches (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  code         text,
  description  text,
  period_id    uuid references public.accounting_periods(id) on delete set null,
  status       text not null default 'open' check (status in ('open', 'posted', 'deleted')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  posted_at    timestamptz,
  posted_by    uuid
);

create table if not exists public.journal_entries (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  batch_id       uuid not null references public.journal_batches(id) on delete cascade,
  line_no        integer not null default 1,
  entry_date     date not null,
  period_id      uuid references public.accounting_periods(id) on delete set null,
  gcs            char(1) not null default 'G' check (gcs in ('G', 'C', 'S')),
  gl_account_id  uuid references public.gl_accounts(id) on delete restrict,
  member_id      uuid,
  supplier_id    uuid,
  store_id       uuid,
  reference      text,
  description    text,
  debit          numeric(14,2) not null default 0,
  credit         numeric(14,2) not null default 0,
  tax_type_id    uuid references public.tax_types(id) on delete set null,
  tax_amount     numeric(14,2) not null default 0,
  project        text,
  created_at     timestamptz not null default now(),
  constraint journal_entries_one_side_ck check (debit = 0 or credit = 0)
);

create index if not exists journal_entries_batch_idx on public.journal_entries (batch_id, line_no);


-- ─── The posted ledger ──────────────────────────────────────────────────────
-- Immutable by convention: corrections are posted as reversing entries, never
-- edited, so an audit trail survives.

create table if not exists public.gl_transactions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  period_id      uuid references public.accounting_periods(id) on delete set null,
  txn_date       date not null,
  gl_account_id  uuid not null references public.gl_accounts(id) on delete restrict,
  store_id       uuid,
  debit          numeric(14,2) not null default 0,
  credit         numeric(14,2) not null default 0,
  description    text,
  reference      text,
  source_type    text not null
                   check (source_type in ('cash_book', 'journal', 'inventory_journal',
                                          'interstore', 'sale', 'purchase', 'opening',
                                          'year_end')),
  source_id      uuid,
  source_line_id uuid,
  batch_id       uuid,
  party_type     text check (party_type is null or party_type in ('customer', 'supplier')),
  party_id       uuid,
  tax_type_id    uuid references public.tax_types(id) on delete set null,
  tax_amount     numeric(14,2) not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  constraint gl_transactions_one_side_ck check (
    debit >= 0 and credit >= 0 and (debit = 0 or credit = 0) and (debit + credit) > 0
  )
);

create index if not exists gl_transactions_account_idx on public.gl_transactions (company_id, gl_account_id, txn_date);
create index if not exists gl_transactions_period_idx  on public.gl_transactions (company_id, period_id);
create index if not exists gl_transactions_source_idx  on public.gl_transactions (company_id, source_type, source_id);
create index if not exists gl_transactions_party_idx   on public.gl_transactions (company_id, party_type, party_id)
  where party_id is not null;
create index if not exists gl_transactions_tax_idx     on public.gl_transactions (company_id, txn_date)
  where tax_amount <> 0;


-- ─── Bank reconciliation ────────────────────────────────────────────────────

create table if not exists public.bank_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  cash_book_id      uuid not null references public.cash_books(id) on delete cascade,
  period_id         uuid references public.accounting_periods(id) on delete set null,
  statement_date    date not null,
  statement_balance numeric(14,2) not null default 0,
  opening_balance   numeric(14,2) not null default 0,
  book_balance      numeric(14,2) not null default 0,
  difference        numeric(14,2) not null default 0,
  status            text not null default 'draft' check (status in ('draft', 'balanced', 'updated')),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  completed_by      uuid
);

create index if not exists bank_reconciliations_book_idx
  on public.bank_reconciliations (company_id, cash_book_id, statement_date desc);

create table if not exists public.bank_reconciliation_lines (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  reconciliation_id   uuid not null references public.bank_reconciliations(id) on delete cascade,
  cash_book_entry_id  uuid not null references public.cash_book_entries(id) on delete cascade,
  side                text not null check (side in ('payment', 'receipt')),
  amount              numeric(14,2) not null default 0,
  matched             boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (reconciliation_id, cash_book_entry_id)
);


-- ─── Inventory journals and interstore transfers ────────────────────────────
-- Both are the same batch table with a different batch_type, exactly as Pastel
-- models them (Process → Inventory Journals → Normal Batch / Interstore
-- Transfer Batch).

create table if not exists public.inventory_journal_batches (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  batch_type     text not null default 'normal' check (batch_type in ('normal', 'interstore')),
  period_id      uuid references public.accounting_periods(id) on delete set null,
  description    text,
  reference      text,
  entry_date     date not null default current_date,
  from_store_id  uuid,                         -- interstore only
  to_store_id    uuid,                         -- interstore only
  status         text not null default 'open' check (status in ('open', 'posted', 'deleted')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  posted_at      timestamptz,
  posted_by      uuid,
  constraint inventory_journal_stores_ck check (
    batch_type <> 'interstore' or status = 'open'
    or (from_store_id is not null and to_store_id is not null and from_store_id <> to_store_id)
  )
);

create table if not exists public.inventory_journal_entries (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  batch_id           uuid not null references public.inventory_journal_batches(id) on delete cascade,
  line_no            integer not null default 1,
  product_id         uuid,
  inventory_code     text,
  unit               text,
  narration          text,
  store_id           uuid,
  entry_date         date not null,
  reference          text,
  qty_at_period      numeric(14,4) not null default 0,
  qty_in             numeric(14,4) not null default 0,
  qty_out            numeric(14,4) not null default 0,
  current_average    numeric(14,4) not null default 0,
  unit_cost          numeric(14,4) not null default 0,
  new_average        numeric(14,4) not null default 0,
  new_quantity       numeric(14,4) not null default 0,
  gl_account_id      uuid references public.gl_accounts(id) on delete set null,
  markup_account_id  uuid references public.gl_accounts(id) on delete set null,
  project            text,
  created_at         timestamptz not null default now()
);

create index if not exists inventory_journal_entries_batch_idx
  on public.inventory_journal_entries (batch_id, line_no);


-- ─── Tax periods ────────────────────────────────────────────────────────────
-- A VAT period that can be closed off once processing is complete, freezing a
-- snapshot of what was submitted.

create table if not exists public.tax_periods (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'open' check (status in ('open', 'closed')),
  output_tax  numeric(14,2) not null default 0,
  input_tax   numeric(14,2) not null default 0,
  net_tax     numeric(14,2) not null default 0,
  snapshot    jsonb,
  closed_at   timestamptz,
  closed_by   uuid,
  created_at  timestamptz not null default now(),
  unique (company_id, start_date, end_date),
  check (end_date >= start_date)
);


-- ─── CSV import log ─────────────────────────────────────────────────────────
-- Keeps a record of every bank statement imported into a cash book, so a
-- double import is visible rather than a mystery.

create table if not exists public.cash_book_imports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  cash_book_id  uuid not null references public.cash_books(id) on delete cascade,
  batch_id      uuid references public.cash_book_batches(id) on delete set null,
  filename      text,
  row_count     integer not null default 0,
  mapping       jsonb,
  imported_at   timestamptz not null default now(),
  imported_by   uuid
);
