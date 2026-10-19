import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Wallet, Plus, Settings2, FileDown, RefreshCw, AlertTriangle, ArrowRight, Landmark,
} from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import AccountingNav from '@/components/accounting/AccountingNav';
import { saveReportPdf } from '@/lib/accountingPdf';
import { formatMoneyR, formatDateZA } from '@/lib/accounting';
import * as acc from '@/api/accounting';

// The cash book home screen from the accountant's notes: every bank account as
// its own cash book, each showing the balance that the bank reconciliation
// ties back to. The "Variance" column is the gap between the book balance and
// the last statement balance the reconciliation wrote back — an at-a-glance
// answer to "is this account reconciled?".

export default function CashBooks() {
  var ctx = useCompany();
  var companyId = ctx ? ctx.companyId : null;
  var company = ctx ? ctx.company : null;

  var [loading, setLoading] = useState(true);
  var [books, setBooks] = useState([]);
  var [balances, setBalances] = useState({});
  var [accounts, setAccounts] = useState([]);
  var [taxTypes, setTaxTypes] = useState([]);
  var [stores, setStores] = useState([]);
  var [needsSetup, setNeedsSetup] = useState(false);
  var [showNew, setShowNew] = useState(false);
  var [editing, setEditing] = useState(null);
  var [error, setError] = useState('');

  var load = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      var results = await Promise.all([
        acc.listCashBooks(companyId),
        acc.listAccounts(companyId),
        acc.listTaxTypes(companyId),
        acc.listStores(companyId),
      ]);
      var list = results[0];
      setBooks(list);
      setAccounts(results[1]);
      setTaxTypes(results[2]);
      setStores(results[3]);
      setNeedsSetup(results[1].length === 0);

      var bal = {};
      for (var i = 0; i < list.length; i++) {
        try { bal[list[i].id] = await acc.cashBookBalance(list[i].id); }
        catch (balanceError) {
          // An account with no postings yet has no balance to read — show zero
          // rather than failing the whole page.
          console.warn('[cannalife] balance unavailable', balanceError);
          bal[list[i].id] = 0;
        }
      }
      setBalances(bal);
    } catch (err) {
      setError(err.message || 'Could not load the cash books.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(function () { load(); }, [load]);

  async function runBootstrap() {
    try {
      var res = await acc.bootstrapCompany(companyId);
      toast.success('Books created — ' + res.accounts + ' accounts, ' + res.periods + ' periods');
      await load();
    } catch (err) {
      toast.error(err.message || 'Setup failed');
    }
  }

  function exportPdf() {
    var rows = books.map(function (b) {
      var balance = Number(balances[b.id] || 0);
      var variance = balance - Number(b.statement_balance || 0);
      return {
        code: b.code,
        name: b.name,
        account: b.gl_account ? b.gl_account.code + '/' + b.gl_account.sub_code : '',
        bank: b.bank_name || '',
        balance: balance,
        statement: b.statement_balance,
        variance: variance,
        reconciled: b.last_reconciled_date ? formatDateZA(b.last_reconciled_date) : 'Never',
      };
    });
    var totalBalance = rows.reduce(function (s, r) { return s + Number(r.balance || 0); }, 0);
    saveReportPdf({
      title: 'Cash Book Balances',
      subtitle: 'All cash books as at ' + new Date().toLocaleDateString('en-ZA'),
      companyName: company ? company.name : '',
      columns: [
        { key: 'code', label: 'CB', width: 8 },
        { key: 'name', label: 'Cash Book', width: 34 },
        { key: 'account', label: 'GL', width: 14 },
        { key: 'bank', label: 'Bank', width: 20 },
        { key: 'balance', label: 'Book Balance', width: 22, type: 'money' },
        { key: 'statement', label: 'Statement', width: 20, type: 'money' },
        { key: 'variance', label: 'Variance', width: 18, type: 'money' },
        { key: 'reconciled', label: 'Last Rec', width: 18 },
      ],
      rows: rows,
      totals: { name: 'TOTAL', balance: totalBalance },
    }, 'cash-book-balances.pdf');
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <AccountingNav />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Wallet className="h-5 w-5 text-primary" /> Cash Books
          </h1>
          <p className="text-sm text-muted-foreground">
            One cash book per bank account. Balances come from posted transactions only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/40">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={exportPdf} disabled={!books.length} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/40 disabled:opacity-50">
            <FileDown className="h-4 w-4" /> PDF
          </button>
          <button onClick={function () { setShowNew(true); }} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> New Cash Book
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {needsSetup && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
          <h2 className="text-sm font-semibold">This club has no books yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the chart of accounts (the client's Pastel chart), SA VAT tax types, a March–February financial year with
            13 periods, and one cash book per bank account. Nothing is overwritten if you run it again.
          </p>
          <button onClick={runBootstrap} className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            Set up the books <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {!books.length && !needsSetup && (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <Landmark className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No cash books yet</p>
          <p className="text-sm text-muted-foreground">Add one per bank account the club operates.</p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {books.map(function (b) {
          var balance = Number(balances[b.id] || 0);
          var variance = balance - Number(b.statement_balance || 0);
          var inBalance = Math.abs(variance) < 0.005;
          return (
            <div key={b.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {b.code} · {b.gl_account ? b.gl_account.code + '/' + b.gl_account.sub_code : '—'}{b.store_code ? ' · Store ' + b.store_code : ''}
                  </p>
                  <h3 className="truncate text-base font-semibold">{b.name}</h3>
                  {b.bank_name && <p className="truncate text-xs text-muted-foreground">{b.bank_name}</p>}
                </div>
                <button
                  onClick={function () { setEditing(b); }}
                  title="Cash book settings"
                  className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="mt-3 text-2xl font-bold">{formatMoneyR(balance)}</p>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Statement balance</span>
                  <span>{formatMoneyR(b.statement_balance)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Variance</span>
                  <span className={inBalance ? 'text-emerald-600' : 'text-amber-600'}>
                    {inBalance ? 'In balance' : formatMoneyR(variance)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Last reconciled</span>
                  <span>{b.last_reconciled_date ? formatDateZA(b.last_reconciled_date) : 'Never'}</span>
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <Link
                  to={'/accounting/cash-books/' + b.id}
                  className="flex-1 rounded-lg bg-primary px-3 py-2 text-center text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  Process
                </Link>
                <Link
                  to={'/accounting/bank-rec?cashBook=' + b.id}
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-center text-xs font-medium hover:bg-muted/40"
                >
                  Reconcile
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {(showNew || editing) && (
        <CashBookDialog
          companyId={companyId}
          accounts={accounts}
          taxTypes={taxTypes}
          stores={stores}
          book={editing}
          onClose={function () { setShowNew(false); setEditing(null); }}
          onSaved={function () { setShowNew(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Cash book create / settings ──────────────────────────────────────────────
// This is the "Settings..." dialog from the notes: contra account, tax
// processing, default tax type, entry method and reference incrementing.

function CashBookDialog({ companyId, accounts, taxTypes, stores, book, onClose, onSaved }) {
  var isEdit = !!book;
  var [form, setForm] = useState({
    code: book ? book.code : '',
    name: book ? book.name : '',
    gl_account_id: book ? book.gl_account_id : '',
    bank_name: book ? (book.bank_name || '') : '',
    account_number: book ? (book.account_number || '') : '',
    store_id: book ? (book.store_id || '') : '',
    store_code: book ? (book.store_code || '') : '',
    branch_code: book ? (book.branch_code || '') : '',
    tax_processing: book ? book.tax_processing : true,
    default_tax_type_id: book ? (book.default_tax_type_id || '') : '',
    entry_method: book ? book.entry_method : 'inclusive',
    increment_references: book ? book.increment_references : 'yes',
    repeat_descriptions: book ? book.repeat_descriptions : true,
    invoke_open_item: book ? book.invoke_open_item : true,
    allocate_settlement_discount: book ? book.allocate_settlement_discount : false,
    this_year_transactions: book ? book.this_year_transactions : true,
  });
  var [saving, setSaving] = useState(false);

  var bankAccounts = accounts.filter(function (a) {
    return a.is_bank || a.control_type === 'bank' || a.subcategory === 'current_asset';
  });

  function set(key, value) {
    setForm(function (f) { var n = Object.assign({}, f); n[key] = value; return n; });
  }

  async function save() {
    if (!form.code.trim() || !form.name.trim() || !form.gl_account_id) {
      toast.error('Code, name and contra account are all required');
      return;
    }
    setSaving(true);
    try {
      var payload = Object.assign({}, form, {
        default_tax_type_id: form.default_tax_type_id || null,
        store_id: form.store_id || null,
        store_code: form.store_code.trim().toUpperCase() || null,
      });
      if (isEdit) await acc.updateCashBook(book.id, payload);
      else await acc.createCashBook(Object.assign({ company_id: companyId }, payload));
      toast.success(isEdit ? 'Cash book updated' : 'Cash book created');
      onSaved();
    } catch (err) {
      toast.error(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-2xl rounded-lg border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{isEdit ? 'Cash book settings' : 'New cash book'}</h2>
          <p className="text-xs text-muted-foreground">
            The contra account is the bank account in the general ledger that this cash book posts to.
          </p>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Code *">
            <input value={form.code} onChange={function (e) { set('code', e.target.value); }}
              placeholder="01" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Name *">
            <input value={form.name} onChange={function (e) { set('name', e.target.value); }}
              placeholder="Bank - Current Account" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Contra account *" full>
            <select value={form.gl_account_id} onChange={function (e) { set('gl_account_id', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">— choose —</option>
              {(bankAccounts.length ? bankAccounts : accounts).map(function (a) {
                return <option key={a.id} value={a.id}>{a.code}/{a.sub_code} {a.name}</option>;
              })}
            </select>
          </Field>
          <Field label="Bank">
            <input value={form.bank_name} onChange={function (e) { set('bank_name', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Account number">
            <input value={form.account_number} onChange={function (e) { set('account_number', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Store (lines captured here are tagged to it)">
            <select value={form.store_id} onChange={function (e) { set('store_id', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">— none —</option>
              {(stores || []).map(function (s) { return <option key={s.id} value={s.id}>{s.name}</option>; })}
            </select>
          </Field>
          <Field label="Pastel store code (BW, CD …)">
            <input value={form.store_code} onChange={function (e) { set('store_code', e.target.value); }}
              maxLength={4} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm uppercase" />
          </Field>

          <div className="sm:col-span-2 mt-2 border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle label="Tax processing" checked={form.tax_processing}
                onChange={function (v) { set('tax_processing', v); }} />
              <Field label="Default tax type">
                <select value={form.default_tax_type_id} onChange={function (e) { set('default_tax_type_id', e.target.value); }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                  <option value="">— none —</option>
                  {taxTypes.map(function (t) {
                    return <option key={t.id} value={t.id}>{t.code} - {t.description}</option>;
                  })}
                </select>
              </Field>
              <Field label="Default entry method">
                <div className="flex gap-3 pt-1 text-sm">
                  {['exclusive', 'inclusive'].map(function (m) {
                    return (
                      <label key={m} className="flex items-center gap-1.5">
                        <input type="radio" checked={form.entry_method === m}
                          onChange={function () { set('entry_method', m); }} />
                        <span className="capitalize">{m}</span>
                      </label>
                    );
                  })}
                </div>
              </Field>
              <Field label="Increment references">
                <div className="flex gap-3 pt-1 text-sm">
                  {['yes', 'no', 'once'].map(function (m) {
                    return (
                      <label key={m} className="flex items-center gap-1.5">
                        <input type="radio" checked={form.increment_references === m}
                          onChange={function () { set('increment_references', m); }} />
                        <span className="capitalize">{m}</span>
                      </label>
                    );
                  })}
                </div>
              </Field>
            </div>
          </div>

          <div className="sm:col-span-2 mt-1 border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Processing</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle label="This year transactions" checked={form.this_year_transactions}
                onChange={function (v) { set('this_year_transactions', v); }} />
              <Toggle label="Repeat descriptions" checked={form.repeat_descriptions}
                onChange={function (v) { set('repeat_descriptions', v); }} />
              <Toggle label="Invoke open item" checked={form.invoke_open_item}
                onChange={function (v) { set('invoke_open_item', v); }} />
              <Toggle label="Allocate settlement discount" checked={form.allocate_settlement_discount}
                onChange={function (v) { set('allocate_settlement_discount', v); }} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/50">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!checked} onChange={function (e) { onChange(e.target.checked); }} />
      {label}
    </label>
  );
}
