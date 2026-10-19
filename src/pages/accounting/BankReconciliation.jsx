import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Landmark, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle, FileDown,
  CheckSquare, Square, History, Search, X,
} from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import AccountingNav from '@/components/accounting/AccountingNav';
import { saveSummaryPdf } from '@/lib/accountingPdf';
import { formatMoney, formatMoneyR, formatDateZA, toDateInput, round2 } from '@/lib/accounting';
import * as acc from '@/api/accounting';

// Bank Reconciliation Assistant.
//
// Step 1 is the Selections screen from the notes: cash book, period, up-to
// date, statement balance. Step 2 lists everything posted and unreconciled up
// to that date with a select-all, and says plainly whether the cash book is
// over, under, or in balance. Update writes the reconciliation back and moves
// the cash book's statement balance forward.
//
// Matching screen mirrors the Pastel assistant the accountant already works
// from: Payments and Receipts as their own columns (not one signed amount),
// and a "Find by amount" box — with a statement in one hand, she's hunting
// for "what's the R1,798.33 line" far more often than she's scrolling.

export default function BankReconciliation() {
  var ctx = useCompany();
  var companyId = ctx ? ctx.companyId : null;
  var company = ctx ? ctx.company : null;
  var [searchParams] = useSearchParams();

  var [step, setStep] = useState(1);
  var [loading, setLoading] = useState(true);
  var [books, setBooks] = useState([]);
  var [periods, setPeriods] = useState([]);
  var [history, setHistory] = useState([]);

  var [cashBookId, setCashBookId] = useState(searchParams.get('cashBook') || '');
  var [periodId, setPeriodId] = useState('');
  var [upToDate, setUpToDate] = useState(toDateInput(new Date()));
  var [statementBalance, setStatementBalance] = useState('');

  var [entries, setEntries] = useState([]);
  var [checked, setChecked] = useState({});
  var [openingBalance, setOpeningBalance] = useState(0);
  var [working, setWorking] = useState(false);
  var [findAmount, setFindAmount] = useState('');

  var load = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    try {
      var res = await Promise.all([
        acc.listCashBooks(companyId),
        acc.listPeriods(companyId),
        acc.listReconciliations(companyId),
      ]);
      setBooks(res[0]);
      setPeriods(res[1]);
      setHistory(res[2].slice(0, 10));
      if (!cashBookId && res[0].length) setCashBookId(res[0][0].id);
    } catch (err) {
      toast.error(err.message || 'Could not load reconciliation data');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(function () { load(); }, [load]);

  var book = useMemo(function () {
    for (var i = 0; i < books.length; i++) if (books[i].id === cashBookId) return books[i];
    return null;
  }, [books, cashBookId]);

  // When a period is chosen its end date becomes the natural "up to" date,
  // which is what the accountant does by hand every time.
  useEffect(function () {
    if (!periodId) return;
    for (var i = 0; i < periods.length; i++) {
      if (periods[i].id === periodId) { setUpToDate(periods[i].end_date); return; }
    }
  }, [periodId, periods]);

  async function goToMatching() {
    if (!cashBookId) { toast.error('Choose a cash book'); return; }
    if (statementBalance === '') { toast.error('Enter the statement balance'); return; }
    setWorking(true);
    try {
      var rows = await acc.unreconciledEntries(companyId, cashBookId, upToDate);
      setEntries(rows);

      // Everything already reconciled before this run is the opening position;
      // the matching list only has to close the gap from there.
      var reconciledToDate = await acc.cashBookBalance(cashBookId, upToDate);
      var unreconciledNet = rows.reduce(function (s, r) {
        return s + (r.side === 'receipt' ? Number(r.amount_inclusive || 0) : -Number(r.amount_inclusive || 0));
      }, 0);
      setOpeningBalance(round2(reconciledToDate - unreconciledNet));

      var pre = {};
      rows.forEach(function (r) { pre[r.id] = false; });
      setChecked(pre);
      setFindAmount('');
      setStep(2);
    } catch (err) {
      toast.error(err.message || 'Could not load the entries to match');
    } finally {
      setWorking(false);
    }
  }

  var matchedTotal = useMemo(function () {
    var total = 0;
    for (var i = 0; i < entries.length; i++) {
      if (!checked[entries[i].id]) continue;
      var amt = Number(entries[i].amount_inclusive || 0);
      total += entries[i].side === 'receipt' ? amt : -amt;
    }
    return round2(total);
  }, [entries, checked]);

  var bookBalance = round2(openingBalance + matchedTotal);
  var stmt = round2(Number(statementBalance || 0));
  var difference = round2(stmt - bookBalance);
  var inBalance = Math.abs(difference) < 0.005;
  var matchedCount = Object.keys(checked).filter(function (k) { return checked[k]; }).length;

  // "Find by amount" — the accountant works off a paper/PDF statement and
  // hunts for one line at a time, so this narrows the list to whatever's
  // within a cent of what she typed rather than requiring an exact string
  // match on a formatted amount.
  var findAmountNum = findAmount === '' ? null : Number(findAmount);
  var foundEntries = useMemo(function () {
    if (findAmountNum === null || isNaN(findAmountNum)) return entries;
    return entries.filter(function (e) {
      return Math.abs(Number(e.amount_inclusive || 0) - Math.abs(findAmountNum)) < 0.005;
    });
  }, [entries, findAmountNum]);
  var foundCount = (findAmountNum === null || isNaN(findAmountNum)) ? 0 : foundEntries.length;

  function tickFound() {
    if (!foundEntries.length) return;
    setChecked(function (c) {
      var n = Object.assign({}, c);
      foundEntries.forEach(function (e) { n[e.id] = true; });
      return n;
    });
  }

  function toggleAll() {
    var allOn = entries.length > 0 && entries.every(function (e) { return checked[e.id]; });
    var next = {};
    entries.forEach(function (e) { next[e.id] = !allOn; });
    setChecked(next);
  }

  async function doUpdate() {
    if (!inBalance) { toast.error('The cash book is out by ' + formatMoneyR(difference) + ' — match or unmatch lines until it balances'); return; }
    if (!matchedCount) { toast.error('Nothing selected to reconcile'); return; }
    setWorking(true);
    try {
      var recon = await acc.createReconciliation({
        company_id: companyId,
        cash_book_id: cashBookId,
        period_id: periodId || null,
        statement_date: upToDate,
        statement_balance: stmt,
        opening_balance: openingBalance,
        book_balance: bookBalance,
        difference: difference,
        status: 'balanced',
      });

      var lines = entries.filter(function (e) { return checked[e.id]; }).map(function (e) {
        return {
          company_id: companyId,
          reconciliation_id: recon.id,
          cash_book_entry_id: e.id,
          side: e.side,
          amount: e.amount_inclusive,
          matched: true,
        };
      });
      await acc.saveReconciliationLines(lines);
      await acc.updateReconciliation(recon.id);

      toast.success('Reconciliation updated — statement balance is now ' + formatMoneyR(stmt));
      setStep(1);
      setStatementBalance('');
      setEntries([]);
      setChecked({});
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not update the reconciliation');
    } finally {
      setWorking(false);
    }
  }

  function exportPdf() {
    saveSummaryPdf({
      title: 'Bank Reconciliation',
      subtitle: (book ? book.code + ' - ' + book.name : '') + ' · up to ' + formatDateZA(upToDate),
      companyName: company ? company.name : '',
      pairs: [
        { label: 'Opening reconciled balance', value: openingBalance },
        { label: 'Matched this reconciliation (' + matchedCount + ' lines)', value: matchedTotal },
        { label: 'Book balance', value: bookBalance, bold: true, rule: true },
        { label: 'Bank statement balance', value: stmt },
        {
          label: inBalance ? 'Difference — in balance' : (difference > 0 ? 'Difference — under' : 'Difference — over'),
          value: difference, bold: true, rule: true,
        },
      ],
      columns: [
        { key: 'date', label: 'Date', width: 18 },
        { key: 'reference', label: 'Reference', width: 22 },
        { key: 'description', label: 'Description', width: 60 },
        { key: 'side', label: 'Type', width: 16 },
        { key: 'amount', label: 'Amount', width: 24, type: 'money' },
        { key: 'state', label: 'Matched', width: 16 },
      ],
      rows: entries.map(function (e) {
        return {
          date: formatDateZA(e.entry_date),
          reference: e.reference || '',
          description: e.description || '',
          side: e.side === 'receipt' ? 'Receipt' : 'Payment',
          amount: e.side === 'receipt' ? e.amount_inclusive : -e.amount_inclusive,
          state: checked[e.id] ? 'Yes' : '',
        };
      }),
    }, 'bank-reconciliation-' + (book ? book.code : '') + '-' + upToDate + '.pdf');
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

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Landmark className="h-5 w-5 text-primary" /> Bank Reconciliation
        </h1>
        <p className="text-sm text-muted-foreground">
          Tie the cash book back to the bank statement, then update the reconciliation.
        </p>
      </div>

      {/* Step rail */}
      <div className="flex items-center gap-3">
        <StepDot n={1} active={step === 1} done={step > 1} label="Selections" />
        <div className="h-px flex-1 bg-border" />
        <StepDot n={2} active={step === 2} done={false} label="Match & update" />
      </div>

      {step === 1 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Bank Reconciliation Assistant</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the cash book, the period, the date to reconcile up to, and the balance on the
            bank statement. Only posted entries are offered for matching.
          </p>

          <div className="mt-4 grid max-w-2xl gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">Cash Book</label>
              <select
                value={cashBookId}
                onChange={function (e) { setCashBookId(e.target.value); }}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
              >
                <option value="">— choose —</option>
                {books.map(function (b) {
                  return <option key={b.id} value={b.id}>{b.code} - {b.name}</option>;
                })}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">Period</label>
              <select
                value={periodId}
                onChange={function (e) { setPeriodId(e.target.value); }}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
              >
                <option value="">— all periods —</option>
                {periods.map(function (p) {
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} ({formatDateZA(p.start_date)} - {formatDateZA(p.end_date)})
                      {p.status === 'closed' ? ' · closed' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Up to which date</label>
              <input
                type="date"
                value={upToDate}
                onChange={function (e) { setUpToDate(e.target.value); }}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Statement balance</label>
              <input
                type="number" step="0.01"
                value={statementBalance}
                onChange={function (e) { setStatementBalance(e.target.value); }}
                placeholder="13783.83"
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-right text-sm"
              />
            </div>
          </div>

          {book && (
            <p className="mt-3 text-xs text-muted-foreground">
              Last reconciled {book.last_reconciled_date ? formatDateZA(book.last_reconciled_date) : 'never'} at{' '}
              {formatMoneyR(book.statement_balance)}.
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <button
              onClick={goToMatching}
              disabled={working || !cashBookId}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {working ? 'Loading…' : 'Next'} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            <Stat label="Opening balance" value={formatMoneyR(openingBalance)} />
            <Stat label={'Matched (' + matchedCount + ')'} value={formatMoneyR(matchedTotal)} />
            <Stat label="Cash book balance" value={formatMoneyR(bookBalance)} />
            <Stat label="Unreconciled" value={String(entries.length - matchedCount)} />
            <Stat
              label={inBalance ? 'In balance' : (difference > 0 ? 'Under by' : 'Over by')}
              value={inBalance ? '—' : formatMoneyR(Math.abs(difference))}
              tone={inBalance ? 'good' : 'warn'}
            />
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50"
                >
                  <CheckSquare className="h-3.5 w-3.5" /> Select all
                </button>
                <span className="text-xs text-muted-foreground">
                  {entries.length} unreconciled entr{entries.length === 1 ? 'y' : 'ies'} up to {formatDateZA(upToDate)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportPdf} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50">
                  <FileDown className="h-3.5 w-3.5" /> PDF
                </button>
                <button onClick={function () { setStep(1); }} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
              </div>
            </div>

            {/* Find by amount — same purpose as Pastel's "Find By Amount" box:
                with the bank statement in hand, jump straight to the line
                that matches rather than scanning the whole list. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <label className="text-xs text-muted-foreground shrink-0">Find by amount</label>
              <input
                type="number" step="0.01"
                value={findAmount}
                onChange={function (e) { setFindAmount(e.target.value); }}
                placeholder="0.00"
                className="w-32 rounded-md border border-border bg-background px-2 py-1 text-right text-xs"
              />
              {findAmount !== '' && (
                <>
                  <span className={'text-xs font-medium ' + (foundCount ? 'text-emerald-600' : 'text-amber-600')}>
                    {foundCount} match{foundCount === 1 ? '' : 'es'}
                  </span>
                  <button
                    onClick={tickFound}
                    disabled={!foundCount}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted/50 disabled:opacity-50"
                  >
                    <CheckSquare className="h-3 w-3" /> Tick matched
                  </button>
                  <button
                    onClick={function () { setFindAmount(''); }}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50"
                  >
                    <X className="h-3 w-3" /> Clear
                  </button>
                </>
              )}
            </div>

            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60">
                  <tr className="text-left">
                    <th className="w-10 px-2 py-2"></th>
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Reference</th>
                    <th className="px-2 py-2 font-medium">Description</th>
                    <th className="px-2 py-2 text-right font-medium">Payments</th>
                    <th className="px-2 py-2 text-right font-medium">Receipts</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                        Nothing left to reconcile up to this date.
                      </td>
                    </tr>
                  )}
                  {entries.map(function (e) {
                    var on = !!checked[e.id];
                    var isMatch = findAmount !== '' && foundEntries.indexOf(e) !== -1;
                    return (
                      <tr
                        key={e.id}
                        onClick={function () {
                          setChecked(function (c) { var n = Object.assign({}, c); n[e.id] = !n[e.id]; return n; });
                        }}
                        className={'cursor-pointer border-t border-border hover:bg-muted/30 ' +
                          (isMatch ? 'bg-amber-500/10 ' : '') + (on ? 'bg-primary/5' : '')}
                      >
                        <td className="px-2 py-1.5">
                          {on ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                        </td>
                        <td className="px-2 py-1.5">{formatDateZA(e.entry_date)}</td>
                        <td className="px-2 py-1.5">{e.reference || ''}</td>
                        <td className="max-w-[320px] truncate px-2 py-1.5">{e.description || ''}</td>
                        <td className="px-2 py-1.5 text-right font-medium text-amber-600">
                          {e.side === 'payment' ? formatMoney(e.amount_inclusive) : ''}
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium text-emerald-600">
                          {e.side === 'receipt' ? formatMoney(e.amount_inclusive) : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-3">
              <div className="flex items-center gap-2 text-xs">
                {inBalance ? (
                  <span className="flex items-center gap-1.5 font-medium text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" /> In balance — ready to update
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-medium text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    {difference > 0 ? 'Under' : 'Over'} by {formatMoneyR(Math.abs(difference))}
                  </span>
                )}
              </div>
              <button
                onClick={doUpdate}
                disabled={working || !inBalance}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {working ? 'Updating…' : 'Update reconciliation'}
              </button>
            </div>
          </div>
        </>
      )}

      {history.length > 0 && step === 1 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Recent reconciliations</h2>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Statement date</th>
                <th className="px-3 py-2 font-medium">Cash book</th>
                <th className="px-3 py-2 text-right font-medium">Statement balance</th>
                <th className="px-3 py-2 text-right font-medium">Difference</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map(function (h) {
                var b = null;
                for (var i = 0; i < books.length; i++) if (books[i].id === h.cash_book_id) b = books[i];
                return (
                  <tr key={h.id} className="border-t border-border">
                    <td className="px-3 py-2">{formatDateZA(h.statement_date)}</td>
                    <td className="px-3 py-2">{b ? b.code + ' - ' + b.name : '—'}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(h.statement_balance)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(h.difference)}</td>
                    <td className="px-3 py-2 capitalize">{h.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StepDot({ n, active, done, label }) {
  return (
    <div className="flex items-center gap-2">
      <div className={'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ' +
        (active ? 'bg-primary text-primary-foreground' : done ? 'bg-emerald-600 text-white' : 'border border-border text-muted-foreground')}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </div>
      <span className={'text-sm ' + (active ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={'mt-1 text-lg font-bold ' +
        (tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : '')}>
        {value}
      </p>
    </div>
  );
}
