import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { PieChart, FileDown, RefreshCw, AlertTriangle } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import AccountingNav from '@/components/accounting/AccountingNav';
import { saveReportPdf } from '@/lib/accountingPdf';
import { formatMoney, formatMoneyR, formatDateZA, toDateInput, round2 } from '@/lib/accounting';
import * as acc from '@/api/accounting';

// Trial Balance, Income Statement, Balance Sheet and Cash Movement, all built
// from one acc_trial_balance() call. The raw `closing` figure from the database
// is debit-minus-credit, so income, liability and equity accounts arrive
// negative — flipping them once, here, is what makes every report below read
// with positive numbers.

var REPORTS = [
  { id: 'trial',   label: 'Trial Balance' },
  { id: 'income',  label: 'Income Statement' },
  { id: 'balance', label: 'Balance Sheet' },
  { id: 'cash',    label: 'Cash Movement' },
];

export default function FinancialReports() {
  var ctx = useCompany();
  var companyId = ctx ? ctx.companyId : null;
  var company = ctx ? ctx.company : null;

  var [report, setReport] = useState('trial');
  var [from, setFrom] = useState('');
  var [to, setTo] = useState(toDateInput(new Date()));
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(false);
  var [cashRows, setCashRows] = useState([]);

  useEffect(function () {
    var now = new Date();
    // Default to the financial year to date — March for a South African club.
    var startYear = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
    setFrom(toDateInput(new Date(startYear, 2, 1)));
  }, []);

  var run = useCallback(async function () {
    if (!companyId || !from || !to) return;
    setLoading(true);
    try {
      var tb = await acc.trialBalance(companyId, from, to);
      setRows(tb);
      if (report === 'cash') {
        setCashRows(await acc.ledgerTransactions(companyId, { from: from, to: to }));
      }
    } catch (err) {
      toast.error(err.message || 'Could not run the report');
    } finally {
      setLoading(false);
    }
  }, [companyId, from, to, report]);

  useEffect(function () { run(); }, [run]);

  // Normalised view: `amount` always reads positive for a normal balance.
  var normalised = useMemo(function () {
    return rows.map(function (r) {
      var raw = Number(r.closing || 0);
      var debitPositive = r.category === 'asset' || r.category === 'expense';
      return Object.assign({}, r, {
        amount: round2(debitPositive ? raw : -raw),
        rawClosing: raw,
        periodDebit: Number(r.period_debit || 0),
        periodCredit: Number(r.period_credit || 0),
      });
    });
  }, [rows]);

  function byCategory(cat) {
    return normalised.filter(function (r) { return r.category === cat; });
  }

  function sum(list) {
    return round2(list.reduce(function (s, r) { return s + Number(r.amount || 0); }, 0));
  }

  var income = byCategory('income');
  var expense = byCategory('expense');
  var assets = byCategory('asset');
  var liabilities = byCategory('liability');
  var equity = byCategory('equity');

  var totalIncome = sum(income);
  var totalExpense = sum(expense);
  var netProfit = round2(totalIncome - totalExpense);
  var totalAssets = sum(assets);
  var totalLiabilities = sum(liabilities);
  var totalEquity = sum(equity);

  // The balance sheet only balances once the profit for the period is carried
  // into equity — it has not been journalised to retained earnings yet.
  var equityWithProfit = round2(totalEquity + netProfit);
  var balanceCheck = round2(totalAssets - (totalLiabilities + equityWithProfit));

  var trialTotals = useMemo(function () {
    var dr = 0, cr = 0;
    for (var i = 0; i < normalised.length; i++) {
      dr += normalised[i].periodDebit;
      cr += normalised[i].periodCredit;
    }
    return { debit: round2(dr), credit: round2(cr) };
  }, [normalised]);

  var cashSummary = useMemo(function () {
    if (report !== 'cash') return { rows: [], opening: 0, closing: 0, inflow: 0, outflow: 0 };
    var bankIds = {};
    for (var i = 0; i < rows.length; i++) {
      // The trial balance carries the account's own metadata; bank accounts are
      // the ones the ledger view marks as current assets named in cash books.
      bankIds[rows[i].account_id] = rows[i];
    }
    var grouped = {};
    var inflow = 0, outflow = 0;
    for (var j = 0; j < cashRows.length; j++) {
      var t = cashRows[j];
      var a = t.account;
      if (!a) continue;
      var key = a.code + '/' + a.sub_code + ' ' + a.name;
      if (!grouped[key]) grouped[key] = { name: key, inflow: 0, outflow: 0, net: 0 };
      grouped[key].inflow += Number(t.debit || 0);
      grouped[key].outflow += Number(t.credit || 0);
      grouped[key].net = round2(grouped[key].inflow - grouped[key].outflow);
    }
    var list = Object.keys(grouped).map(function (k) { return grouped[k]; })
      .sort(function (x, y) { return Math.abs(y.net) - Math.abs(x.net); });
    for (var k = 0; k < list.length; k++) { inflow += list[k].inflow; outflow += list[k].outflow; }
    return { rows: list, inflow: round2(inflow), outflow: round2(outflow) };
  }, [report, cashRows, rows]);

  function exportPdf() {
    var subtitle = formatDateZA(from) + ' to ' + formatDateZA(to);
    var companyName = company ? company.name : '';

    if (report === 'trial') {
      saveReportPdf({
        title: 'Trial Balance', subtitle: subtitle, companyName: companyName,
        columns: [
          { key: 'code', label: 'Code', width: 14 },
          { key: 'name', label: 'Account', width: 52 },
          { key: 'opening', label: 'Opening', width: 20, type: 'money' },
          { key: 'debit', label: 'Debit', width: 20, type: 'money' },
          { key: 'credit', label: 'Credit', width: 20, type: 'money' },
          { key: 'closing', label: 'Closing', width: 22, type: 'money' },
        ],
        rows: normalised.map(function (r) {
          return {
            code: r.code + '/' + r.sub_code, name: r.name,
            opening: r.opening, debit: r.periodDebit, credit: r.periodCredit, closing: r.amount,
          };
        }),
        totals: { name: 'TOTALS', debit: trialTotals.debit, credit: trialTotals.credit },
      }, 'trial-balance.pdf');
      return;
    }

    if (report === 'income') {
      var incomeRows = [{ __section: 'INCOME' }]
        .concat(income.map(function (r) { return { name: r.code + '/' + r.sub_code + ' ' + r.name, amount: r.amount }; }))
        .concat([{ name: 'Total income', amount: totalIncome, __bold: true, __rule: true }])
        .concat([{ __section: 'EXPENSES' }])
        .concat(expense.map(function (r) { return { name: r.code + '/' + r.sub_code + ' ' + r.name, amount: r.amount }; }))
        .concat([{ name: 'Total expenses', amount: totalExpense, __bold: true, __rule: true }]);
      saveReportPdf({
        title: 'Income Statement', subtitle: subtitle, companyName: companyName,
        columns: [
          { key: 'name', label: 'Account', width: 70 },
          { key: 'amount', label: 'Amount', width: 30, type: 'money' },
        ],
        rows: incomeRows,
        totals: { name: netProfit >= 0 ? 'NET PROFIT' : 'NET LOSS', amount: Math.abs(netProfit) },
      }, 'income-statement.pdf');
      return;
    }

    if (report === 'balance') {
      var bsRows = [{ __section: 'ASSETS' }]
        .concat(assets.map(function (r) { return { name: r.code + '/' + r.sub_code + ' ' + r.name, amount: r.amount }; }))
        .concat([{ name: 'Total assets', amount: totalAssets, __bold: true, __rule: true }])
        .concat([{ __section: 'LIABILITIES' }])
        .concat(liabilities.map(function (r) { return { name: r.code + '/' + r.sub_code + ' ' + r.name, amount: r.amount }; }))
        .concat([{ name: 'Total liabilities', amount: totalLiabilities, __bold: true, __rule: true }])
        .concat([{ __section: 'EQUITY' }])
        .concat(equity.map(function (r) { return { name: r.code + '/' + r.sub_code + ' ' + r.name, amount: r.amount }; }))
        .concat([{ name: 'Profit for the period (not yet journalised)', amount: netProfit }])
        .concat([{ name: 'Total equity', amount: equityWithProfit, __bold: true, __rule: true }]);
      saveReportPdf({
        title: 'Balance Sheet', subtitle: 'As at ' + formatDateZA(to), companyName: companyName,
        columns: [
          { key: 'name', label: 'Account', width: 70 },
          { key: 'amount', label: 'Amount', width: 30, type: 'money' },
        ],
        rows: bsRows,
        totals: { name: 'LIABILITIES + EQUITY', amount: round2(totalLiabilities + equityWithProfit) },
        notes: Math.abs(balanceCheck) > 0.005
          ? ['Out of balance by R' + formatMoney(balanceCheck) + ' — check for unposted batches.']
          : [],
      }, 'balance-sheet.pdf');
      return;
    }

    saveReportPdf({
      title: 'Cash Movement', subtitle: subtitle, companyName: companyName,
      columns: [
        { key: 'name', label: 'Account', width: 54 },
        { key: 'inflow', label: 'Debits in', width: 16, type: 'money' },
        { key: 'outflow', label: 'Credits out', width: 16, type: 'money' },
        { key: 'net', label: 'Net movement', width: 18, type: 'money' },
      ],
      rows: cashSummary.rows,
      totals: { name: 'TOTAL', inflow: cashSummary.inflow, outflow: cashSummary.outflow,
                net: round2(cashSummary.inflow - cashSummary.outflow) },
    }, 'cash-movement.pdf');
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <AccountingNav />

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <PieChart className="h-5 w-5 text-primary" /> Financial Reports
        </h1>
        <p className="text-sm text-muted-foreground">
          Built from posted transactions only — unposted batches are not included.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex gap-1">
          {REPORTS.map(function (r) {
            return (
              <button key={r.id} onClick={function () { setReport(r.id); }}
                className={'rounded-lg px-3 py-1.5 text-xs font-medium ' +
                  (report === r.id ? 'bg-primary text-primary-foreground'
                                   : 'border border-border text-muted-foreground hover:bg-muted/50')}>
                {r.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-3">
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
          <button onClick={run} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/40">
            <RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} /> Run
          </button>
          <button onClick={exportPdf} disabled={!rows.length}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <FileDown className="h-4 w-4" /> PDF
          </button>
        </div>
      </div>

      {!rows.length && !loading && (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nothing posted in this range yet.
        </div>
      )}

      {report === 'trial' && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 text-right font-medium">Opening</th>
                <th className="px-3 py-2 text-right font-medium">Debit</th>
                <th className="px-3 py-2 text-right font-medium">Credit</th>
                <th className="px-3 py-2 text-right font-medium">Closing</th>
              </tr>
            </thead>
            <tbody>
              {normalised.map(function (r) {
                return (
                  <tr key={r.account_id} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono">{r.code}/{r.sub_code}</td>
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{formatMoney(r.opening)}</td>
                    <td className="px-3 py-1.5 text-right">{r.periodDebit ? formatMoney(r.periodDebit) : ''}</td>
                    <td className="px-3 py-1.5 text-right">{r.periodCredit ? formatMoney(r.periodCredit) : ''}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{formatMoney(r.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                <td colSpan={3} className="px-3 py-2 text-right">Totals</td>
                <td className="px-3 py-2 text-right">{formatMoney(trialTotals.debit)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(trialTotals.credit)}</td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {report === 'income' && rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Income" rows={income} total={totalIncome} />
          <Section title="Expenses" rows={expense} total={totalExpense} />
          <div className="lg:col-span-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{netProfit >= 0 ? 'Net profit' : 'Net loss'}</p>
              <p className={'text-2xl font-bold ' + (netProfit >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                {formatMoneyR(Math.abs(netProfit))}
              </p>
            </div>
          </div>
        </div>
      )}

      {report === 'balance' && rows.length > 0 && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Assets" rows={assets} total={totalAssets} />
            <div className="space-y-4">
              <Section title="Liabilities" rows={liabilities} total={totalLiabilities} />
              <Section
                title="Equity"
                rows={equity.concat([{ account_id: '__profit', code: '—', sub_code: '', name: 'Profit for the period', amount: netProfit }])}
                total={equityWithProfit}
              />
            </div>
          </div>
          {Math.abs(balanceCheck) > 0.005 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              Out of balance by {formatMoneyR(balanceCheck)} — usually an unposted batch or an
              opening balance that was never journalised.
            </div>
          )}
        </>
      )}

      {report === 'cash' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Total debits" value={formatMoneyR(cashSummary.inflow)} />
            <Stat label="Total credits" value={formatMoneyR(cashSummary.outflow)} />
            <Stat label="Net movement" value={formatMoneyR(round2(cashSummary.inflow - cashSummary.outflow))} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 text-right font-medium">Debits in</th>
                  <th className="px-3 py-2 text-right font-medium">Credits out</th>
                  <th className="px-3 py-2 text-right font-medium">Net movement</th>
                </tr>
              </thead>
              <tbody>
                {cashSummary.rows.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">No movement in this range.</td></tr>
                )}
                {cashSummary.rows.map(function (r) {
                  return (
                    <tr key={r.name} className="border-t border-border">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-right">{formatMoney(r.inflow)}</td>
                      <td className="px-3 py-1.5 text-right">{formatMoney(r.outflow)}</td>
                      <td className={'px-3 py-1.5 text-right font-medium ' + (r.net < 0 ? 'text-destructive' : '')}>
                        {formatMoney(r.net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, rows, total }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {rows.length === 0 && (
            <tr><td className="px-3 py-6 text-center text-muted-foreground">Nothing posted.</td></tr>
          )}
          {rows.map(function (r) {
            return (
              <tr key={r.account_id} className="border-b border-border/60">
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.code}{r.sub_code ? '/' + r.sub_code : ''}</td>
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5 text-right">{formatMoney(r.amount)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td colSpan={2} className="px-3 py-2">Total {title.toLowerCase()}</td>
            <td className="px-3 py-2 text-right">{formatMoney(total)}</td>
          </tr>
        </tfoot>
      </table>
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
