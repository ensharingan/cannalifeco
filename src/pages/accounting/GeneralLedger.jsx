import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Scale, FileDown, RefreshCw, Search } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import AccountingNav from '@/components/accounting/AccountingNav';
import { saveReportPdf } from '@/lib/accountingPdf';
import {
  formatMoney, formatMoneyR, formatDateZA, toDateInput, round2, downloadCsv,
} from '@/lib/accounting';
import * as acc from '@/api/accounting';

// Account drill-down: every posted transaction on one account, with a running
// balance. This is the screen someone opens when a figure on the trial balance
// looks wrong, so the source column matters as much as the amount — it says
// which batch put it there.

var SOURCE_LABELS = {
  cash_book: 'Cash book',
  journal: 'Journal',
  inventory_journal: 'Inventory journal',
  interstore: 'Interstore',
  sale: 'Sale',
  purchase: 'Purchase',
  opening: 'Opening balance',
  year_end: 'Year end',
};

export default function GeneralLedger() {
  var ctx = useCompany();
  var companyId = ctx ? ctx.companyId : null;
  var company = ctx ? ctx.company : null;

  var [accounts, setAccounts] = useState([]);
  var [accountId, setAccountId] = useState('');
  var [from, setFrom] = useState('');
  var [to, setTo] = useState(toDateInput(new Date()));
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [running, setRunning] = useState(false);
  var [term, setTerm] = useState('');

  useEffect(function () {
    var now = new Date();
    setFrom(toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
  }, []);

  var load = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    try {
      var list = await acc.listAccounts(companyId);
      setAccounts(list);
      if (!accountId && list.length) setAccountId(list[0].id);
    } catch (err) {
      toast.error(err.message || 'Could not load accounts');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(function () { load(); }, [load]);

  var account = useMemo(function () {
    for (var i = 0; i < accounts.length; i++) if (accounts[i].id === accountId) return accounts[i];
    return null;
  }, [accounts, accountId]);

  var run = useCallback(async function () {
    if (!companyId || !accountId) return;
    setRunning(true);
    try {
      setRows(await acc.ledgerTransactions(companyId, { accountId: accountId, from: from, to: to }));
    } catch (err) {
      toast.error(err.message || 'Could not load transactions');
    } finally {
      setRunning(false);
    }
  }, [companyId, accountId, from, to]);

  useEffect(function () { if (accountId && from && to) run(); }, [accountId, from, to, run]);

  var filtered = useMemo(function () {
    if (!term.trim()) return rows;
    var t = term.toLowerCase();
    return rows.filter(function (r) {
      return ((r.description || '') + ' ' + (r.reference || '')).toLowerCase().indexOf(t) !== -1;
    });
  }, [rows, term]);

  // Debit-positive for assets and expenses, credit-positive otherwise — the
  // running balance reads the way an accountant expects for that account type.
  var debitPositive = account && (account.category === 'asset' || account.category === 'expense');

  var withBalance = useMemo(function () {
    var running = 0;
    return filtered.map(function (r) {
      var move = debitPositive
        ? Number(r.debit || 0) - Number(r.credit || 0)
        : Number(r.credit || 0) - Number(r.debit || 0);
      running = round2(running + move);
      return Object.assign({}, r, { balance: running });
    });
  }, [filtered, debitPositive]);

  var totals = useMemo(function () {
    var dr = 0, cr = 0;
    for (var i = 0; i < filtered.length; i++) {
      dr += Number(filtered[i].debit || 0);
      cr += Number(filtered[i].credit || 0);
    }
    return { debit: round2(dr), credit: round2(cr) };
  }, [filtered]);

  function exportPdf() {
    saveReportPdf({
      title: 'General Ledger',
      subtitle: (account ? account.code + '/' + account.sub_code + ' ' + account.name : '') +
        ' · ' + formatDateZA(from) + ' to ' + formatDateZA(to),
      companyName: company ? company.name : '',
      landscape: true,
      columns: [
        { key: 'date', label: 'Date', width: 16 },
        { key: 'reference', label: 'Reference', width: 20 },
        { key: 'description', label: 'Description', width: 60 },
        { key: 'source', label: 'Source', width: 22 },
        { key: 'debit', label: 'Debit', width: 20, type: 'money' },
        { key: 'credit', label: 'Credit', width: 20, type: 'money' },
        { key: 'balance', label: 'Balance', width: 22, type: 'money' },
      ],
      rows: withBalance.map(function (r) {
        return {
          date: formatDateZA(r.txn_date),
          reference: r.reference || '',
          description: r.description || '',
          source: SOURCE_LABELS[r.source_type] || r.source_type,
          debit: r.debit || '',
          credit: r.credit || '',
          balance: r.balance,
        };
      }),
      totals: { description: 'TOTALS', debit: totals.debit, credit: totals.credit },
    }, 'general-ledger-' + (account ? account.code : '') + '.pdf');
  }

  function exportCsv() {
    downloadCsv(
      'general-ledger-' + (account ? account.code : '') + '.csv',
      ['Date', 'Reference', 'Description', 'Source', 'Debit', 'Credit', 'Balance'],
      withBalance.map(function (r) {
        return [r.txn_date, r.reference, r.description, SOURCE_LABELS[r.source_type] || r.source_type,
                r.debit, r.credit, r.balance];
      })
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  var closing = withBalance.length ? withBalance[withBalance.length - 1].balance : 0;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <AccountingNav />

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Scale className="h-5 w-5 text-primary" /> General Ledger
        </h1>
        <p className="text-sm text-muted-foreground">
          Every posted transaction on an account, with a running balance.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-[260px] flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">Account</label>
          <select value={accountId} onChange={function (e) { setAccountId(e.target.value); }}
            className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm">
            {accounts.map(function (a) {
              return <option key={a.id} value={a.id}>{a.code}/{a.sub_code} {a.name}</option>;
            })}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">From</label>
          <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }}
            className="rounded-md border border-border bg-background px-2 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">To</label>
          <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }}
            className="rounded-md border border-border bg-background px-2 py-2 text-sm" />
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={term} onChange={function (e) { setTerm(e.target.value); }}
            placeholder="Filter" className="w-28 bg-transparent text-xs outline-none" />
        </div>
        <button onClick={run} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/40">
          <RefreshCw className={'h-4 w-4 ' + (running ? 'animate-spin' : '')} /> Refresh
        </button>
        <button onClick={exportPdf} disabled={!rows.length}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/40 disabled:opacity-50">
          <FileDown className="h-4 w-4" /> PDF
        </button>
        <button onClick={exportCsv} disabled={!rows.length}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/40 disabled:opacity-50">
          <FileDown className="h-4 w-4" /> CSV
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Debits" value={formatMoneyR(totals.debit)} />
        <Stat label="Credits" value={formatMoneyR(totals.credit)} />
        <Stat label="Movement in period" value={formatMoneyR(closing)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th>
              <th className="px-3 py-2 text-right font-medium">Credit</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {withBalance.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  Nothing posted to this account in this range.
                </td>
              </tr>
            )}
            {withBalance.map(function (r) {
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-1.5">{formatDateZA(r.txn_date)}</td>
                  <td className="px-3 py-1.5">{r.reference || ''}</td>
                  <td className="max-w-[360px] truncate px-3 py-1.5">{r.description || ''}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {SOURCE_LABELS[r.source_type] || r.source_type}
                  </td>
                  <td className="px-3 py-1.5 text-right">{r.debit ? formatMoney(r.debit) : ''}</td>
                  <td className="px-3 py-1.5 text-right">{r.credit ? formatMoney(r.credit) : ''}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{formatMoney(r.balance)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
