import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  BookOpen, Plus, Trash2, FileDown, AlertTriangle, CheckCircle2, ChevronRight,
} from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import AccountingNav from '@/components/accounting/AccountingNav';
import AllocationCell from '@/components/accounting/AllocationCell';
import { saveReportPdf } from '@/lib/accountingPdf';
import {
  formatMoney, formatMoneyR, formatDateZA, toDateInput, periodForDate, round2,
} from '@/lib/accounting';
import * as acc from '@/api/accounting';

// General journals — the double-entry batch Pastel puts under Process → Journals.
// Nothing posts until debits equal credits, which the database enforces again on
// the way in, so a journal can never leave the ledger unbalanced.

export default function Journals() {
  var ctx = useCompany();
  var companyId = ctx ? ctx.companyId : null;
  var company = ctx ? ctx.company : null;

  var [loading, setLoading] = useState(true);
  var [batches, setBatches] = useState([]);
  var [activeId, setActiveId] = useState(null);
  var [lines, setLines] = useState([]);
  var [accounts, setAccounts] = useState([]);
  var [members, setMembers] = useState([]);
  var [suppliers, setSuppliers] = useState([]);
  var [periods, setPeriods] = useState([]);
  var [posting, setPosting] = useState(false);

  var load = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    try {
      var res = await Promise.all([
        acc.listJournalBatches(companyId),
        acc.listAccounts(companyId),
        acc.listMembers(companyId),
        acc.listSuppliers(companyId),
        acc.listTaxTypes(companyId),
        acc.listPeriods(companyId),
      ]);
      setBatches(res[0]);
      setAccounts(res[1]);
      setMembers(res[2]);
      setSuppliers(res[3]);
      setPeriods(res[5]);
    } catch (err) {
      toast.error(err.message || 'Could not load journals');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(function () { load(); }, [load]);

  var active = useMemo(function () {
    for (var i = 0; i < batches.length; i++) if (batches[i].id === activeId) return batches[i];
    return null;
  }, [batches, activeId]);

  var openBatches = batches.filter(function (b) { return b.status === 'open'; });
  var postedBatches = batches.filter(function (b) { return b.status === 'posted'; });

  var totals = useMemo(function () {
    var dr = 0, cr = 0;
    for (var i = 0; i < lines.length; i++) {
      dr += Number(lines[i].debit || 0);
      cr += Number(lines[i].credit || 0);
    }
    return { debit: round2(dr), credit: round2(cr), diff: round2(dr - cr) };
  }, [lines]);

  var balanced = Math.abs(totals.diff) < 0.005 && totals.debit > 0;

  async function openBatch(id) {
    setActiveId(id);
    try { setLines(await acc.listJournalEntries(id)); }
    catch (err) { toast.error(err.message || 'Could not load that journal'); }
  }

  async function newBatch() {
    try {
      var b = await acc.createJournalBatch({
        company_id: companyId,
        description: 'Journal ' + new Date().toLocaleDateString('en-ZA'),
      });
      setBatches(function (l) { return [b].concat(l); });
      setActiveId(b.id);
      setLines([]);
      toast.success('New journal batch');
    } catch (err) {
      toast.error(err.message || 'Could not create a batch');
    }
  }

  async function addLine() {
    if (!active) return;
    var today = lines.length ? lines[lines.length - 1].entry_date : toDateInput(new Date());
    var p = periodForDate(periods, today);
    try {
      var saved = await acc.saveJournalEntry({
        company_id: companyId,
        batch_id: active.id,
        line_no: lines.length + 1,
        entry_date: today,
        period_id: p ? p.id : null,
        gcs: 'G',
        debit: 0,
        credit: 0,
        description: lines.length ? lines[lines.length - 1].description : (active.description || ''),
      });
      setLines(function (l) { return l.concat([saved]); });
    } catch (err) {
      toast.error(err.message || 'Could not add a line');
    }
  }

  function patch(id, p) {
    setLines(function (l) { return l.map(function (r) { return r.id === id ? Object.assign({}, r, p) : r; }); });
  }

  async function persist(row) {
    try {
      await acc.saveJournalEntry({
        id: row.id,
        entry_date: row.entry_date,
        period_id: row.period_id,
        gcs: row.gcs,
        gl_account_id: row.gcs === 'G' ? row.gl_account_id : null,
        member_id: row.gcs === 'C' ? row.member_id : null,
        supplier_id: row.gcs === 'S' ? row.supplier_id : null,
        reference: row.reference,
        description: row.description,
        debit: row.debit,
        credit: row.credit,
        tax_type_id: row.tax_type_id,
        tax_amount: row.tax_amount,
        line_no: row.line_no,
      });
    } catch (err) {
      toast.error(err.message || 'Could not save that line');
    }
  }

  async function removeLine(row) {
    try {
      await acc.deleteJournalEntry(row.id);
      setLines(function (l) { return l.filter(function (r) { return r.id !== row.id; }); });
    } catch (err) {
      toast.error(err.message || 'Could not delete');
    }
  }

  async function post() {
    if (!balanced) { toast.error('Journal is out by ' + formatMoneyR(totals.diff)); return; }
    setPosting(true);
    try {
      var res = await acc.postJournalBatch(active.id);
      toast.success('Posted ' + res.lines_posted + ' lines · ' + formatMoneyR(res.total_debits));
      setActiveId(null);
      setLines([]);
      await load();
    } catch (err) {
      toast.error(err.message || 'Posting failed');
    } finally {
      setPosting(false);
    }
  }

  function exportPdf() {
    saveReportPdf({
      title: 'General Journal',
      subtitle: (active ? active.description : '') + ' · ' + lines.length + ' lines',
      companyName: company ? company.name : '',
      columns: [
        { key: 'line', label: '#', width: 6 },
        { key: 'date', label: 'Date', width: 16 },
        { key: 'account', label: 'Account', width: 46 },
        { key: 'reference', label: 'Reference', width: 18 },
        { key: 'description', label: 'Description', width: 40 },
        { key: 'debit', label: 'Debit', width: 20, type: 'money' },
        { key: 'credit', label: 'Credit', width: 20, type: 'money' },
      ],
      rows: lines.map(function (l) {
        return {
          line: l.line_no,
          date: formatDateZA(l.entry_date),
          account: label(l),
          reference: l.reference || '',
          description: l.description || '',
          debit: l.debit || '',
          credit: l.credit || '',
        };
      }),
      totals: { description: 'TOTALS', debit: totals.debit, credit: totals.credit },
    }, 'general-journal.pdf');
  }

  function label(row) {
    var i;
    if (row.gcs === 'G') {
      for (i = 0; i < accounts.length; i++) if (accounts[i].id === row.gl_account_id)
        return accounts[i].code + '/' + accounts[i].sub_code + ' ' + accounts[i].name;
    } else if (row.gcs === 'C') {
      for (i = 0; i < members.length; i++) if (members[i].id === row.member_id) return members[i].full_name;
    } else {
      for (i = 0; i < suppliers.length; i++) if (suppliers[i].id === row.supplier_id) return suppliers[i].name;
    }
    return '';
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
            <BookOpen className="h-5 w-5 text-primary" /> General Journals
          </h1>
          <p className="text-sm text-muted-foreground">
            Double-entry adjustments. A batch only posts once debits equal credits.
          </p>
        </div>
        <button onClick={newBatch} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New journal
        </button>
      </div>

      {!active && (
        <div className="grid gap-4 lg:grid-cols-2">
          <BatchList title="Open batches" batches={openBatches} onOpen={openBatch} empty="No open journals." />
          <BatchList title="Recently posted" batches={postedBatches.slice(0, 10)} onOpen={openBatch} empty="Nothing posted yet." />
        </div>
      )}

      {active && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <button onClick={function () { setActiveId(null); setLines([]); }}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/50">
                All journals
              </button>
              <input
                value={active.description || ''}
                onChange={function (e) {
                  var v = e.target.value;
                  setBatches(function (l) { return l.map(function (b) { return b.id === active.id ? Object.assign({}, b, { description: v }) : b; }); });
                }}
                readOnly={active.status !== 'open'}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
              <span className={'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                (active.status === 'open' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200')}>
                {active.status}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Debits / Credits</p>
                <p className="text-sm font-bold">
                  {formatMoney(totals.debit)} / {formatMoney(totals.credit)}
                </p>
              </div>
              <button onClick={exportPdf} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted/50">
                <FileDown className="h-3.5 w-3.5" /> PDF
              </button>
              {active.status === 'open' && (
                <button onClick={post} disabled={posting || !balanced}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  {posting ? 'Posting…' : 'Post journal'}
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[980px] text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="w-10 px-2 py-2 font-semibold">#</th>
                  <th className="w-32 px-2 py-2 font-semibold">Date</th>
                  <th className="w-16 px-2 py-2 font-semibold">GCS</th>
                  <th className="px-2 py-2 font-semibold">Account</th>
                  <th className="w-28 px-2 py-2 font-semibold">Reference</th>
                  <th className="px-2 py-2 font-semibold">Description</th>
                  <th className="w-28 px-2 py-2 text-right font-semibold">Debit</th>
                  <th className="w-28 px-2 py-2 text-right font-semibold">Credit</th>
                  <th className="w-10 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No lines yet.</td></tr>
                )}
                {lines.map(function (l) {
                  var ro = active.status !== 'open';
                  return (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-2 py-1">{l.line_no}</td>
                      <td className="p-0">
                        <input type="date" value={l.entry_date || ''} readOnly={ro}
                          onChange={function (e) {
                            var p = periodForDate(periods, e.target.value);
                            patch(l.id, { entry_date: e.target.value, period_id: p ? p.id : null });
                          }}
                          onBlur={function () { persist(l); }}
                          className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5" />
                      </td>
                      <td className="p-0">
                        <select value={l.gcs} disabled={ro}
                          onChange={function (e) { patch(l.id, { gcs: e.target.value, gl_account_id: null, member_id: null, supplier_id: null }); }}
                          onBlur={function () { persist(l); }}
                          className="w-full bg-transparent px-1 py-1 text-xs outline-none focus:bg-primary/5">
                          <option value="G">G</option><option value="C">C</option><option value="S">S</option>
                        </select>
                      </td>
                      <td className="p-0">
                        <AllocationCell
                          gcs={l.gcs} disabled={ro}
                          value={l.gcs === 'G' ? l.gl_account_id : l.gcs === 'C' ? l.member_id : l.supplier_id}
                          accounts={accounts} members={members} suppliers={suppliers}
                          onChange={function (v) {
                            var p = {};
                            if (l.gcs === 'G') p.gl_account_id = v; else if (l.gcs === 'C') p.member_id = v; else p.supplier_id = v;
                            patch(l.id, p);
                            persist(Object.assign({}, l, p));
                          }}
                        />
                      </td>
                      <td className="p-0">
                        <input value={l.reference || ''} readOnly={ro}
                          onChange={function (e) { patch(l.id, { reference: e.target.value }); }}
                          onBlur={function () { persist(l); }}
                          className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5" />
                      </td>
                      <td className="p-0">
                        <input value={l.description || ''} readOnly={ro}
                          onChange={function (e) { patch(l.id, { description: e.target.value }); }}
                          onBlur={function () { persist(l); }}
                          className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5" />
                      </td>
                      <td className="p-0">
                        <input type="number" step="0.01" value={l.debit || ''} readOnly={ro}
                          onChange={function (e) { patch(l.id, { debit: Number(e.target.value || 0), credit: 0 }); }}
                          onBlur={function () { persist(l); }}
                          className="w-full bg-transparent px-1.5 py-1 text-right text-xs outline-none focus:bg-primary/5" />
                      </td>
                      <td className="p-0">
                        <input type="number" step="0.01" value={l.credit || ''} readOnly={ro}
                          onChange={function (e) { patch(l.id, { credit: Number(e.target.value || 0), debit: 0 }); }}
                          onBlur={function () { persist(l); }}
                          className="w-full bg-transparent px-1.5 py-1 text-right text-xs outline-none focus:bg-primary/5" />
                      </td>
                      <td className="px-2 py-1 text-center">
                        {!ro && (
                          <button onClick={function () { removeLine(l); }} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                  <td colSpan={6} className="px-2 py-2 text-right">Totals</td>
                  <td className="px-2 py-2 text-right">{formatMoney(totals.debit)}</td>
                  <td className="px-2 py-2 text-right">{formatMoney(totals.credit)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {active.status === 'open' && (
              <button onClick={addLine} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/50">
                <Plus className="h-4 w-4" /> Add line
              </button>
            )}
            <span className={'flex items-center gap-1.5 text-xs font-medium ' + (balanced ? 'text-emerald-600' : 'text-amber-600')}>
              {balanced
                ? <><CheckCircle2 className="h-4 w-4" /> Balanced</>
                : <><AlertTriangle className="h-4 w-4" /> Out of balance by {formatMoneyR(totals.diff)}</>}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function BatchList({ title, batches, onOpen, empty }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {batches.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul>
          {batches.map(function (b) {
            return (
              <li key={b.id}>
                <button onClick={function () { onOpen(b.id); }}
                  className="flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left hover:bg-muted/40">
                  <span>
                    <span className="block text-sm">{b.description || 'Journal'}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateZA(b.created_at)}
                      {b.posted_at ? ' · posted ' + formatDateZA(b.posted_at) : ''}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
