# Canna Life Co — Accounting Module

A Pastel/Sage-style double-entry general ledger built into the Canna Life Co white label
of Budify. It covers everything in the accountant's notes: cash books with
payment and receipt processing, bank reconciliation, general journals, inventory
journals, interstore transfers, tax periods with close-off, and PDF reports
throughout.

---

## 1. What was built

### Database (`supabase/migrations/`)

| File | Contents |
|---|---|
| `20260915000100_accounting_core.sql` | 17 tables: chart of accounts, financial years and periods, tax types, cash books, cash book batches and entries, journals, `gl_transactions`, bank reconciliations, inventory journals, tax periods, settings, import log |
| `20260915000200_accounting_functions.sql` | Posting routines, tax maths, guard rails, trial balance, tax report, reconciliation and tax-period close |
| `20260915000300_accounting_rls.sql` | Row-level security on every table, plus function grants |
| `20260915000400_accounting_bootstrap.sql` | `acc_bootstrap_company()` — one call sets a club up with books (superseded by the file below) |
| `20260924000500_pastel_chart_alignment.sql` | The client's 120-account Pastel chart, the Pastel-shaped posting rules, and the re-chart routine (see section 7) |

`gl_transactions` is the single source of truth. Nothing else is a balance; every
report is derived from it. It has no UPDATE or DELETE policy — corrections are
posted as reversals, so the audit trail survives.

### Frontend

```
src/lib/brand.js                              white-label identity (name, colours, logo)
src/lib/accounting.js                         tax maths, CSV parsing, formatting, validation
src/lib/accountingPdf.js                      one PDF writer for every accounting report
src/api/accounting.js                         data access + RPC wrappers

src/components/accounting/AccountingNav.jsx   sub-navigation strip
src/components/accounting/AllocationCell.jsx  GCS allocation cell (GL / member / supplier)
src/components/accounting/CsvImportDialog.jsx bank statement import with column mapping

src/pages/accounting/CashBooks.jsx            cash book home — balances and variances
src/pages/accounting/ProcessCashBook.jsx      the capture grid (Payments / Receipts)
src/pages/accounting/BankReconciliation.jsx   two-step reconciliation assistant
src/pages/accounting/Journals.jsx             general journal batches
src/pages/accounting/InventoryJournals.jsx    inventory journals AND interstore transfers
src/pages/accounting/TaxPeriods.jsx           VAT report and period close-off
src/pages/accounting/FinancialReports.jsx     trial balance, income statement, balance sheet, cash movement
src/pages/accounting/GeneralLedger.jsx        account drill-down with running balance
src/pages/accounting/AccountingSetup.jsx      chart of accounts, posting map, periods
```

Routes live under `/accounting/*` behind `AccountingGuard` (owner, manager,
superadmin). The database enforces the same rule, so a hand-typed URL returns an
empty screen rather than someone else's bank balance.

---

## 2. Mapping to the accountant's notes

| Note | Where it landed |
|---|---|
| "Different cashbook accounts, each bank account its own cashbook" | `cash_books`, one per bank GL account · Cash Books screen |
| "Each cashbook needs to show the balance which aligns with the variance bank account" | Book balance vs last statement balance, with variance, on each card |
| "Tab for processing of Payments made" / "Tab for Receipts" | Payments and Receipts tabs over one batch |
| "Must have Tax Column" | Tax type per line; rate from `tax_types`, never hard-coded |
| "Option to change the different tax periods" | Period derived from the line date; `tax_periods` for VAT cycles |
| "Options at the bottom to insert or delete a row" | Insert `Ctrl+I` / Delete `Ctrl+D`, plus per-row delete |
| "CSV layout ... if we could import this for cashbooks" | `CsvImportDialog` — guesses the mapping from your own export's headers, handles `'02 Feb'` dates and quoted values, previews before writing |
| "Setting tabs options" | Cash book settings dialog: contra account, tax processing, default tax type, inclusive/exclusive, increment references, repeat descriptions, open item, settlement discount |
| "Indicate to which supplier the payment needs to be allocated" | GCS = S on a payment line |
| "Option under GCS (General Ledgers/Customer/Suppliers)" | GCS column on both cash book and journal grids |
| "Tax/vat column is of utmost importance" | Tax splits net/tax/gross in one place shared by the grid, the import and the posting routine |
| "Bank Reconciliation: select cashbook / period / statement balance / Next" | Step 1 of the assistant |
| "Select all ... indicate whether its over or under or in balance" | Step 2, with a live over/under/in-balance readout |
| "Update reconciliations so that the statement balance updates" | `acc_update_reconciliation()` writes the statement balance back onto the cash book |
| "Need Inventory Journal Option" | Inventory Journals (normal batch) |
| "Interstore Transfers between warehouse and stores" | Interstore Transfers (from/to store batch) |
| "Pull tax reports and close off tax period" | Tax Periods — run, then close; closing freezes a snapshot and moves the lock date |
| "All of the above needs to convert to PDF reports" | PDF export on every screen via `accountingPdf.js` |

---

## 3. How posting works

Capture never touches the ledger. Entries sit in an open batch until **Update**
(cash books) or **Post** (journals, inventory), which calls one RPC that
validates, writes both sides of every entry, and flips the batch status — all in
one database transaction. A half-posted batch is not a reachable state.

**Cash book — payment**

```
Credit   Bank                  gross
Debit    Allocation            net (+ settlement discount, on a C/S line)
Debit    VAT control (9500)    tax
Credit   Discount Received     discount   (C/S lines only, 2700)
```

**Cash book — receipt**: the mirror image. Tax is credited to the VAT control
account, and settlement discount is debited to Discount Allowed (3550).

Lines with no store take the store of their cash book (Bank CD posts as store CD).

**Inventory journal**: value in debits Inventory and credits the contra account
(stock adjustments by default); value out reverses it. `store_inventory` moves in
the same transaction, and an `inventory_movements` row is written so the existing
Inventory screen shows the same history it always has.

**Interstore transfer**: stock leaves the source branch and arrives at the
destination (creating the row if that branch has never carried the product), with
both value legs passing through Inventory Control (7700), tagged with the from
and to store, so the pair nets to zero for the company. Pastel has no clearing
account; set one under Setup → Posting map only if a licensee wants it.

### Guard rails

- `acc_assert_postable()` rejects any date on or before the accounting lock date,
  or inside a closed period.
- Cash book lines are checked against a database constraint: the allocation must
  match the GCS letter, or the row must be blank.
- Journals will not post unless debits equal credits.
- Every posting re-checks that its own debits and credits agree before committing.

---

## 4. Setting up a club

1. Point `.env` at the Canna Life Co Supabase project (see `.env.example`). **Not** the
   shared Budify project — Canna Life Co runs on its own isolated instance.
2. Apply the five migrations in order.
3. Open **Accounting → Cash Books** as an owner and click **Set up the books**.
   That calls `acc_bootstrap_company()`, which creates:
   - 4 SA tax types (`00` no tax, `01` VAT 15%, `02` zero rated, `03` exempt)
   - the client's 120-account Pastel chart of accounts, identical codes, names,
     Cat numbers and financial categories
   - a March–February financial year with 12 periods plus period 13 for year-end
   - the posting map, wired to the control accounts
   - one cash book per bank account: Bank Investment and Bank BW, CD, GA, ML, TB,
     WD, WP (the store code is taken from the name)
4. Under **Setup → Posting map**, confirm each account, then adjust the chart to
   the club's own numbering if needed. Nothing is hard-coded — the posting
   routines find accounts through the map, so renumbering is safe.
5. Under **Cash Books → Settings**, tie each bank's cash book to its store.

Re-running step 3 is safe: it fills in what is missing and never duplicates.

---

## 5. Known limits / next steps

- **POS sales are not journalised yet.** The ledger currently reflects what is
  captured in the accounting module. Posting each completed sale (Debit bank or
  debtors, Credit sales and VAT output, plus the cost-of-sales pair) is the
  natural next piece, and the posting map already has every account it needs.
- **Year-end rollover** is not automated. Profit for the period shows on the
  balance sheet as "not yet journalised" rather than being carried into retained
  earnings. A `acc_run_year_end()` routine is the remaining piece.
- **Interstore source stock** is validated in the UI, not the database. A line
  that moves more than the source branch holds is blocked on screen; the database
  would let it drive the branch negative.
- **Customer and supplier ageing** (open item matching, F3 Match in Pastel) is
  modelled in the data — `party_type` / `party_id` on every ledger row — but has
  no screen yet.
- The main JS bundle is over 500 kB. Pre-existing, and worth splitting with
  `React.lazy` on the accounting routes when someone next touches the build.

---

## 6. Incidental fix

The repository called `toast()` from `sonner` in around thirty pages but never
mounted sonner's `<Toaster />`, so none of those notifications ever appeared.
This fork mounts it in `App.jsx` alongside the existing Radix toaster.

---

## 7. Pastel chart alignment (24 Sep 2026)

Source: Pastel *General Ledger Master Listing* for Aruzascope (Pty) Ltd, printed
23/09/2026, plus the trial balance snapshot from the accountant. The goal is that
a Pastel trial balance or opening-balance file loads onto the same account codes
with no translation table. `docs/pastel-chart-of-accounts.csv` is the full list.

- **One chart, stored once.** `acc_chart_template` holds the 120 accounts;
  `acc_bootstrap_company()` copies them. Accounts carry `financial_category`
  (B10 … I35), `pastel_category` (the Pastel "Cat" column) and `in_pastel_chart`.
- **Net Value accounts** (e.g. 6250/000) exist because Pastel has them. Post to
  the /010 Cost and /020 Accum Depre sub-accounts, as in Pastel.
- **VAT:** a single control account, 9500/000, for input and output. On it a credit
  is output tax and a debit is input tax. The tax report and period close use
  that rule.
- **Settlement discount:** Discount Received 2700 on payments, Discount Allowed
  3550 on receipts.
- **Category mapping:** B10/B15 equity; B20-B30 non-current liability; B35-B45
  non-current asset; B50-B65 current asset; B70-B80 current liability; I10 revenue;
  I15 cost of sales; I20 other income; I25 expenses; I30 tax. **I35 Dividends is
  mapped to equity**, so a declared dividend reduces equity rather than profit.
  Tell us if the accountant wants it shown as an income statement appropriation.
- **Re-chart.** `acc_align_chart_to_pastel(company)` replaces the first Canna Life Co
  chart in place. Old accounts with no ledger history are deleted; ones with
  history are kept inactive (code suffix `L000`, name suffix "(legacy)") and never
  edited. A reclass journal moves their balances. It only touches accounts whose
  code and name still match the original bootstrap.
- **Fixed:** the tax report counted the VAT line inside "output net".

### Not yet built
- POS sales are not posted to the ledger. The client's card and cash takings per
  store (e.g. `CD-CARD`, `CD-CASH`, invoices `CDI08864` …) need a confirmed rule
  from the accountant for which account each lands on (Bank CD, Cash Control -
  Pastel 8100, or Cash Control - IQ 8150).
- The migration import itself (opening balances, customers, suppliers) waits for
  the signed-off data.
