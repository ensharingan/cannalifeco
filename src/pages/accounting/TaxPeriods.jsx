import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  ReceiptText, Lock, FileDown, AlertTriangle, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import AccountingNav from '@/components/accounting/AccountingNav';
import { saveSummaryPdf } from '@/lib/accountingPdf';
import { formatMoney, formatMoneyR, formatDateZA, toDateInput, round2 } from '@/lib/accounting';
import * as acc from '@/api/accounting';

// VAT periods: pull the tax report for a date range, then close the period off
// once the return has gone to SARS. Closing freezes a snapshot of the figures
// and pushes the accounting lock date forward, so nothing can be back-dated
// into a return that has already been submitted.

export default function TaxPeriods() {
  var ctx = useCompany();
  var companyId = ctx ? ctx.companyId : null;
  var company = ctx ? ctx.company : null;

  var [loading, setLoading] = useState(true);
  var [taxPeriods, setTaxPeriods] = useState([]);
  var [rows, setRows] = useState([]);
  var [from, setFrom] = useState('');
  var [to, setTo] = useState('');
  var [running, setRunning] = useState(false);
  var [closing, setClosing] = useState(false);

  var load = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    try {
      setTaxPeriods(await acc.listTaxPeriods(companyId));
    } catch (err) {
      toast.error(err.message || 'Could not load tax periods');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(function () { load(); }, [load]);

  // SA VAT runs in two-month cycles; default to the one that just ended.
  useEffect(function () {
    var now = new Date();
    var endMonth = now.getMonth();
    var start = new Date(now.getFullYear(), endMonth - 1, 1);
    var end = new Date(now.getFullYear(), endMonth + 1, 0);
    setFrom(toDateInput(start));
    setTo(toDateInput(end));
  }, []);

  var totals = useMemo(function () {
    var out = 0, inp = 0;
    for (var i = 0; i < rows.length; i++) {
      out += Number(rows[i].output_tax || 0);
      inp += Number(rows[i].input_tax || 0);
    }
    return { output: round2(out), input: round2(inp), net: round2(out - inp) };
  }, [rows]);

  async function run() {
    if (!from || !to) { toast.error('Choose a date range'); return; }
    setRunning(true);
    try {
      setRows(await acc.taxReport(companyId, from, to));
    } catch (err) {
      toast.error(err.message || 'Could not run the tax report');
    } finally {
      setRunning(false);
    }
  }

  async function createAndClose() {
    if (!rows.length) { toast.error('Run the report first'); return; }
    setClosing(true);
    try {
      var name = formatDateZA(from) + ' - ' + formatDateZA(to);
      var tp = await acc.createTaxPeriod({
        company_id: companyId, name: name, start_date: from, end_date: to,
      });
      var closed = await acc.closeTaxPeriod(tp.id);
      toast.success('Tax period closed · net ' + formatMoneyR(closed.net_tax));
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not close the period');
    } finally {
      setClosing(false);
    }
  }

  async function closeExisting(tp) {
    setClosing(true);
    try {
      var closed = await acc.closeTaxPeriod(tp.id);
      toast.success('Closed · net ' + formatMoneyR(closed.net_tax));
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not close the period');
    } finally {
      setClosing(false);
    }
  }

  function exportPdf(period) {
    var reportRows = period && period.snapshot ? period.snapshot : rows;
    var out = 0, inp = 0;
    for (var i = 0; i < reportRows.length; i++) {
      out += Number(reportRows[i].output_tax || 0);
      inp += Number(reportRows[i].input_tax || 0);
    }
    saveSummaryPdf({
      title: 'VAT Report',
      subtitle: period
        ? period.name + ' · ' + period.status
        : formatDateZA(from) + ' to ' + formatDateZA(to),
      companyName: company ? company.name : '',
      pairs: [
        { label: 'Output tax (on sales and receipts)', value: round2(out) },
        { label: 'Input tax (on purchases and payments)', value: round2(inp) },
        {
          label: round2(out - inp) >= 0 ? 'Net VAT payable to SARS' : 'Net VAT refundable from SARS',
          value: Math.abs(round2(out - inp)), bold: true, rule: true,
        },
      ],
      columns: [
        { key: 'tax_code', label: 'Code', width: 12 },
        { key: 'description', label: 'Tax type', width: 46 },
        { key: 'rate', label: 'Rate %', width: 14, type: 'money' },
        { key: 'output_net', label: 'Output net', width: 22, type: 'money' },
        { key: 'output_tax', label: 'Output tax', width: 22, type: 'money' },
        { key: 'input_net', label: 'Input net', width: 22, type: 'money' },
        { key: 'input_tax', label: 'Input tax', width: 22, type: 'money' },
      ],
      rows: reportRows,
    }, 'vat-report-' + (period ? period.start_date : from) + '.pdf');
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
          <ReceiptText className="h-5 w-5 text-primary" /> Tax Periods
        </h1>
        <p className="text-sm text-muted-foreground">
          Run the VAT report for a period, then close it off once the return is filed.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
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
          <button onClick={run} disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <RefreshCw className={'h-4 w-4 ' + (running ? 'animate-spin' : '')} /> Run report
          </button>
          {rows.length > 0 && (
            <>
              <button onClick={function () { exportPdf(null); }}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/40">
                <FileDown className="h-4 w-4" /> PDF
              </button>
              <button onClick={createAndClose} disabled={closing}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-950/30 dark:text-amber-200">
                <Lock className="h-4 w-4" /> {closing ? 'Closing…' : 'Close this period'}
              </button>
            </>
          )}
        </div>

        {rows.length > 0 && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Stat label="Output tax" value={formatMoneyR(totals.output)} />
              <Stat label="Input tax" value={formatMoneyR(totals.input)} />
              <Stat
                label={totals.net >= 0 ? 'Net payable to SARS' : 'Net refundable from SARS'}
                value={formatMoneyR(Math.abs(totals.net))}
                tone={totals.net >= 0 ? 'warn' : 'good'}
              />
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Tax type</th>
                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                    <th className="px-3 py-2 text-right font-medium">Output net</th>
                    <th className="px-3 py-2 text-right font-medium">Output tax</th>
                    <th className="px-3 py-2 text-right font-medium">Input net</th>
                    <th className="px-3 py-2 text-right font-medium">Input tax</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(function (r) {
                    return (
                      <tr key={r.tax_code} className="border-t border-border">
                        <td className="px-3 py-1.5 font-mono">{r.tax_code}</td>
                        <td className="px-3 py-1.5">{r.description}</td>
                        <td className="px-3 py-1.5 text-right">{Number(r.rate || 0).toFixed(2)}%</td>
                        <td className="px-3 py-1.5 text-right">{formatMoney(r.output_net)}</td>
                        <td className="px-3 py-1.5 text-right">{formatMoney(r.output_tax)}</td>
                        <td className="px-3 py-1.5 text-right">{formatMoney(r.input_net)}</td>
                        <td className="px-3 py-1.5 text-right">{formatMoney(r.input_tax)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                    <td colSpan={4} className="px-3 py-2 text-right">Totals</td>
                    <td className="px-3 py-2 text-right">{formatMoney(totals.output)}</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right">{formatMoney(totals.input)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Closing this period freezes these figures and moves the accounting lock date to{' '}
                {formatDateZA(to)}. Nothing dated on or before then can be posted afterwards
                without moving the lock date back under Setup.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Tax period history</h2>
        </div>
        {taxPeriods.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No tax periods yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 text-right font-medium">Output</th>
                <th className="px-3 py-2 text-right font-medium">Input</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {taxPeriods.map(function (tp) {
                return (
                  <tr key={tp.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      {tp.name}
                      <span className="ml-2 text-muted-foreground">
                        {formatDateZA(tp.start_date)} – {formatDateZA(tp.end_date)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{formatMoney(tp.output_tax)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(tp.input_tax)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatMoney(tp.net_tax)}</td>
                    <td className="px-3 py-2">
                      {tp.status === 'closed' ? (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> closed
                        </span>
                      ) : (
                        <span className="text-amber-600">open</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {tp.snapshot && (
                          <button onClick={function () { exportPdf(tp); }}
                            className="text-muted-foreground underline hover:text-foreground">
                            PDF
                          </button>
                        )}
                        {tp.status !== 'closed' && (
                          <button onClick={function () { closeExisting(tp); }} disabled={closing}
                            className="text-amber-600 underline disabled:opacity-50">
                            Close
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={'mt-1 text-lg font-bold ' +
        (tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : '')}>
        {value}
      </p>
    </div>
  );
}
