import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Settings2, Plus, Save, Lock, Unlock, Search, FileDown, CalendarRange, ListTree, Map,
} from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import AccountingNav from '@/components/accounting/AccountingNav';
import { saveReportPdf } from '@/lib/accountingPdf';
import { ACCOUNT_CATEGORIES, SUBCATEGORIES, FINANCIAL_CATEGORIES, formatDateZA } from '@/lib/accounting';
import * as acc from '@/api/accounting';

// Setup: the chart of accounts, the posting map that tells the automatic double
// entries where to land, and the financial periods. Everything the posting
// routines look up by role is configured here rather than hard-coded, so a club
// can renumber its chart without anything silently posting to the wrong place.

var POSTING_MAP = [
  { key: 'bank_account_id',          label: 'Default bank',            hint: 'Used when a cash book has no contra account of its own' },
  { key: 'sales_account_id',         label: 'Sales',                   hint: 'Where POS revenue lands' },
  { key: 'cost_of_sales_account_id', label: 'Cost of sales',           hint: 'Cost side of a sale' },
  { key: 'inventory_account_id',     label: 'Inventory',               hint: 'Stock on hand — inventory journals post here' },
  { key: 'tax_input_account_id',     label: 'VAT input',               hint: 'Tax on payments and purchases. Pastel uses one VAT control account (9500/000) for both directions' },
  { key: 'tax_output_account_id',    label: 'VAT output',              hint: 'Tax on receipts and sales. Same account as VAT input on the Pastel chart' },
  { key: 'debtors_control_id',       label: 'Debtors control',         hint: 'Customer (member) allocations' },
  { key: 'creditors_control_id',     label: 'Creditors control',       hint: 'Supplier allocations' },
  { key: 'retained_earnings_id',     label: 'Retained earnings',       hint: 'Year-end profit transfer' },
  { key: 'rounding_account_id',      label: 'Discount received',       hint: 'Settlement discount on supplier payments (Pastel 2700/000)' },
  { key: 'discount_allowed_account_id', label: 'Discount allowed',     hint: 'Settlement discount on customer receipts (Pastel 3550/000)' },
  { key: 'stock_adjustment_id',      label: 'Stock adjustments',       hint: 'Default contra for inventory journals' },
  { key: 'interstore_clearing_id',   label: 'Interstore clearing',     hint: 'Optional. Leave empty to move transfer value through Inventory Control, as Pastel has no clearing account' },
];

export default function AccountingSetup() {
  var ctx = useCompany();
  var companyId = ctx ? ctx.companyId : null;
  var company = ctx ? ctx.company : null;

  var [tab, setTab] = useState('accounts');
  var [loading, setLoading] = useState(true);
  var [accounts, setAccounts] = useState([]);
  var [taxTypes, setTaxTypes] = useState([]);
  var [periods, setPeriods] = useState([]);
  var [years, setYears] = useState([]);
  var [settings, setSettings] = useState(null);
  var [term, setTerm] = useState('');
  var [finCat, setFinCat] = useState('');
  var [showNew, setShowNew] = useState(false);
  var [saving, setSaving] = useState(false);

  var load = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    try {
      var res = await Promise.all([
        acc.listAccounts(companyId, { includeInactive: true }),
        acc.listTaxTypes(companyId),
        acc.listPeriods(companyId),
        acc.listFinancialYears(companyId),
        acc.getSettings(companyId),
      ]);
      setAccounts(res[0]);
      setTaxTypes(res[1]);
      setPeriods(res[2]);
      setYears(res[3]);
      setSettings(res[4] || { company_id: companyId });
    } catch (err) {
      toast.error(err.message || 'Could not load setup');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(function () { load(); }, [load]);

  var filtered = useMemo(function () {
    var t = term.trim().toLowerCase();
    return accounts.filter(function (a) {
      if (finCat && a.financial_category !== finCat) return false;
      if (!t) return true;
      return (a.code + '/' + a.sub_code + ' ' + a.name + ' ' + (a.subcategory || '') + ' ' +
        (a.financial_category || '') + ' ' + (a.financial_category_name || '')).toLowerCase().indexOf(t) !== -1;
    });
  }, [accounts, term, finCat]);

  // How much of the client's Pastel chart is present. 120 of 120 is the goal
  // — it means a Pastel trial balance can be loaded straight onto these codes.
  var pastelCount = useMemo(function () {
    return accounts.filter(function (a) { return a.in_pastel_chart; }).length;
  }, [accounts]);

  async function saveMap() {
    setSaving(true);
    try {
      var patch = {};
      POSTING_MAP.forEach(function (m) { patch[m.key] = settings[m.key] || null; });
      patch.default_tax_type_id = settings.default_tax_type_id || null;
      patch.tax_entry_method = settings.tax_entry_method || 'inclusive';
      patch.financial_year_start_month = Number(settings.financial_year_start_month || 3);
      patch.lock_date = settings.lock_date || null;
      await acc.saveSettings(companyId, patch);
      toast.success('Posting map saved');
    } catch (err) {
      toast.error(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAccount(account) {
    try {
      await acc.updateAccount(account.id, { active: !account.active });
      setAccounts(function (l) {
        return l.map(function (a) { return a.id === account.id ? Object.assign({}, a, { active: !a.active }) : a; });
      });
    } catch (err) {
      toast.error(err.message || 'Could not update');
    }
  }

  function exportChart() {
    saveReportPdf({
      title: 'Chart of Accounts',
      subtitle: accounts.length + ' accounts',
      companyName: company ? company.name : '',
      columns: [
        { key: 'code', label: 'Account', width: 14 },
        { key: 'name', label: 'Name', width: 46 },
        { key: 'fin', label: 'Financial category', width: 30 },
        { key: 'cat', label: 'Cat', width: 6 },
        { key: 'category', label: 'Type', width: 14 },
        { key: 'control', label: 'Control', width: 18 },
        { key: 'state', label: 'Active', width: 8 },
      ],
      rows: accounts.map(function (a) {
        return {
          code: a.code + '/' + a.sub_code, name: a.name,
          fin: a.financial_category ? a.financial_category + ' - ' + (a.financial_category_name || '') : '',
          cat: a.pastel_category != null ? String(a.pastel_category) : '',
          category: a.category,
          control: (a.control_type || '').replace(/_/g, ' '), state: a.active ? 'Yes' : 'No',
        };
      }),
    }, 'chart-of-accounts.pdf');
  }

  function set(key, value) {
    setSettings(function (s) { var n = Object.assign({}, s); n[key] = value; return n; });
  }

  if (loading || !settings) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <AccountingNav />

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Settings2 className="h-5 w-5 text-primary" /> Accounting Setup
        </h1>
        <p className="text-sm text-muted-foreground">
          Chart of accounts, posting map and financial periods.
        </p>
      </div>

      <div className="flex gap-1">
        <Tab id="accounts" current={tab} onClick={setTab} icon={ListTree}>Chart of accounts</Tab>
        <Tab id="map" current={tab} onClick={setTab} icon={Map}>Posting map</Tab>
        <Tab id="periods" current={tab} onClick={setTab} icon={CalendarRange}>Periods</Tab>
      </div>

      {tab === 'accounts' && (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input value={term} onChange={function (e) { setTerm(e.target.value); }}
                placeholder="Search accounts" className="bg-transparent text-xs outline-none" />
            </div>
            <select value={finCat} onChange={function (e) { setFinCat(e.target.value); }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              <option value="">All financial categories</option>
              {FINANCIAL_CATEGORIES.map(function (c) {
                return <option key={c.code} value={c.code}>{c.code} - {c.name}</option>;
              })}
            </select>
            <span className="text-[11px] text-muted-foreground">
              {pastelCount} Pastel accounts loaded
            </span>
            <div className="flex gap-2">
              <button onClick={exportChart} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50">
                <FileDown className="h-3.5 w-3.5" /> PDF
              </button>
              <button onClick={function () { setShowNew(true); }} className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground">
                <Plus className="h-3.5 w-3.5" /> New account
              </button>
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Financial category</th>
                  <th className="px-3 py-2 font-medium">Cat</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Control</th>
                  <th className="px-3 py-2 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (a) {
                  return (
                    <tr key={a.id} className={'border-t border-border ' + (a.active ? '' : 'opacity-50')}>
                      <td className="px-3 py-1.5 font-mono">{a.code}/{a.sub_code}</td>
                      <td className="px-3 py-1.5">{a.name}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {a.financial_category ? a.financial_category + ' - ' + (a.financial_category_name || '') : ''}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">
                        {a.pastel_category != null ? a.pastel_category : ''}
                      </td>
                      <td className="px-3 py-1.5 capitalize">{a.category}</td>
                      <td className="px-3 py-1.5 capitalize text-muted-foreground">
                        {(a.control_type || '').replace(/_/g, ' ')}
                      </td>
                      <td className="px-3 py-1.5">
                        <button onClick={function () { toggleAccount(a); }}
                          className="text-xs underline text-muted-foreground hover:text-foreground">
                          {a.active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'map' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Posting map</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Every automatic double entry finds its account through this map. A missing entry
              stops the posting with a readable error rather than guessing.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {POSTING_MAP.map(function (m) {
                return (
                  <div key={m.key}>
                    <label className="mb-1 block text-xs font-medium">{m.label}</label>
                    <select value={settings[m.key] || ''} onChange={function (e) { set(m.key, e.target.value); }}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                      <option value="">— not set —</option>
                      {accounts.filter(function (a) { return a.active; }).map(function (a) {
                        return <option key={a.id} value={a.id}>{a.code}/{a.sub_code} {a.name}</option>;
                      })}
                    </select>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{m.hint}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Defaults</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Default tax type</label>
                <select value={settings.default_tax_type_id || ''} onChange={function (e) { set('default_tax_type_id', e.target.value); }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                  <option value="">— none —</option>
                  {taxTypes.map(function (t) { return <option key={t.id} value={t.id}>{t.code} - {t.description}</option>; })}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Entry method</label>
                <select value={settings.tax_entry_method || 'inclusive'} onChange={function (e) { set('tax_entry_method', e.target.value); }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                  <option value="inclusive">Inclusive</option>
                  <option value="exclusive">Exclusive</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Financial year starts</label>
                <select value={settings.financial_year_start_month || 3} onChange={function (e) { set('financial_year_start_month', e.target.value); }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                  {['January','February','March','April','May','June','July','August','September','October','November','December']
                    .map(function (m, i) { return <option key={m} value={i + 1}>{m}</option>; })}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              {settings.lock_date ? <Lock className="h-4 w-4 text-amber-600" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
              Accounting lock date
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing can be posted on or before this date. Closing a tax period moves it forward
              automatically — set it by hand only to re-open a period you closed early.
            </p>
            <input type="date" value={settings.lock_date || ''} onChange={function (e) { set('lock_date', e.target.value); }}
              className="mt-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </div>

          <div className="flex justify-end">
            <button onClick={saveMap} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save setup'}
            </button>
          </div>
        </div>
      )}

      {tab === 'periods' && (
        <div className="space-y-4">
          {years.map(function (y) {
            var yearPeriods = periods.filter(function (p) { return p.financial_year_id === y.id; });
            return (
              <div key={y.id} className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div>
                    <h2 className="text-sm font-semibold">{y.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {formatDateZA(y.start_date)} — {formatDateZA(y.end_date)}
                    </p>
                  </div>
                  <span className={'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                    (y.status === 'open' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                                         : 'bg-muted text-muted-foreground')}>
                    {y.is_current ? 'current · ' : ''}{y.status}
                  </span>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Period</th>
                      <th className="px-3 py-2 font-medium">From</th>
                      <th className="px-3 py-2 font-medium">To</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearPeriods.map(function (p) {
                      return (
                        <tr key={p.id} className="border-t border-border">
                          <td className="px-3 py-1.5">{p.name}</td>
                          <td className="px-3 py-1.5">{formatDateZA(p.start_date)}</td>
                          <td className="px-3 py-1.5">{formatDateZA(p.end_date)}</td>
                          <td className="px-3 py-1.5 capitalize">{p.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
          {years.length === 0 && (
            <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
              No financial year yet. Run the setup from the Cash Books screen.
            </div>
          )}
        </div>
      )}

      {showNew && (
        <NewAccountDialog
          companyId={companyId}
          taxTypes={taxTypes}
          onClose={function () { setShowNew(false); }}
          onSaved={function (a) { setAccounts(function (l) { return l.concat([a]); }); setShowNew(false); }}
        />
      )}
    </div>
  );
}

function Tab({ id, current, onClick, children, icon: Icon }) {
  var active = current === id;
  return (
    <button onClick={function () { onClick(id); }}
      className={'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ' +
        (active ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-muted/50')}>
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

function NewAccountDialog({ companyId, taxTypes, onClose, onSaved }) {
  var [form, setForm] = useState({
    code: '', sub_code: '000', name: '', category: 'expense',
    subcategory: 'operating', default_tax_type_id: '',
    financial_category: 'I25', pastel_category: '',
  });
  var [saving, setSaving] = useState(false);

  function set(k, v) {
    setForm(function (f) {
      var n = Object.assign({}, f);
      n[k] = v;
      if (k === 'category') { n.subcategory = SUBCATEGORIES[v][0]; n.financial_category = ''; }
      if (k === 'financial_category') {
        var fc = FINANCIAL_CATEGORIES.filter(function (c) { return c.code === v; })[0];
        if (fc) { n.category = fc.category; n.subcategory = fc.subcategory; }
      }
      return n;
    });
  }

  async function save() {
    if (!form.code.trim() || !form.name.trim()) { toast.error('Code and name are required'); return; }
    setSaving(true);
    try {
      var fc = FINANCIAL_CATEGORIES.filter(function (c) { return c.code === form.financial_category; })[0];
      var a = await acc.createAccount(Object.assign({ company_id: companyId }, form, {
        default_tax_type_id: form.default_tax_type_id || null,
        financial_category: fc ? fc.code : null,
        financial_category_name: fc ? fc.name : null,
        pastel_category: form.pastel_category === '' ? null : Number(form.pastel_category),
      }));
      toast.success('Account created');
      onSaved(a);
    } catch (err) {
      toast.error(err.message || 'Could not create the account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-24">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">New general ledger account</h2>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Main code *</label>
            <input value={form.code} onChange={function (e) { set('code', e.target.value); }} placeholder="6200"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Sub code</label>
            <input value={form.sub_code} onChange={function (e) { set('sub_code', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-muted-foreground">Name *</label>
            <input value={form.name} onChange={function (e) { set('name', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Financial category</label>
            <select value={form.financial_category} onChange={function (e) { set('financial_category', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">— none —</option>
              {FINANCIAL_CATEGORIES.map(function (c) {
                return <option key={c.code} value={c.code}>{c.code} - {c.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Pastel Cat (optional)</label>
            <input value={form.pastel_category} onChange={function (e) { set('pastel_category', e.target.value.replace(/[^0-9]/g, '')); }}
              placeholder="25" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Category</label>
            <select value={form.category} onChange={function (e) { set('category', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              {ACCOUNT_CATEGORIES.map(function (c) { return <option key={c.value} value={c.value}>{c.label}</option>; })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Group</label>
            <select value={form.subcategory} onChange={function (e) { set('subcategory', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              {SUBCATEGORIES[form.category].map(function (s) {
                return <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>;
              })}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-muted-foreground">Default tax type</label>
            <select value={form.default_tax_type_id} onChange={function (e) { set('default_tax_type_id', e.target.value); }}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">— none —</option>
              {taxTypes.map(function (t) { return <option key={t.id} value={t.id}>{t.code} - {t.description}</option>; })}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
