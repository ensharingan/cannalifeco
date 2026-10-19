import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, Plus, Trash2, Upload, FileDown, Printer, Settings2, Save,
  CheckCircle2, AlertTriangle, Percent, RefreshCw,
} from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import AccountingNav from '@/components/accounting/AccountingNav';
import AllocationCell from '@/components/accounting/AllocationCell';
import CsvImportDialog from '@/components/accounting/CsvImportDialog';
import { saveReportPdf } from '@/lib/accountingPdf';
import {
  splitTax, round2, formatMoney, formatMoneyR, toDateInput, periodForDate,
  nextReference, validateEntry, downloadCsv, formatDateZA,
} from '@/lib/accounting';
import * as acc from '@/api/accounting';

// Process Cash Books — the capture grid from the accountant's notes.
//
// Payments and Receipts are two tabs over the same batch, exactly as in Pastel.
// Nothing here touches the general ledger: entries sit in an open batch until
// Update posts the whole batch in one database transaction, which is what makes
// a half-captured month safe to walk away from.

var BLANK = {
  side: 'payment',
  entry_date: '',
  gcs: 'G',
  gl_account_id: null,
  member_id: null,
  supplier_id: null,
  reference: '',
  description: '',
  tax_type_id: null,
  tax_rate: 0,
  amount_inclusive: 0,
  amount_exclusive: 0,
  tax_amount: 0,
  discount: 0,
  project: '',
};

export default function ProcessCashBook() {
  var params = useParams();
  var navigate = useNavigate();
  var ctx = useCompany();
  var companyId = ctx ? ctx.companyId : null;
  var company = ctx ? ctx.company : null;

  var [loading, setLoading] = useState(true);
  var [book, setBook] = useState(null);
  var [books, setBooks] = useState([]);
  var [batch, setBatch] = useState(null);
  var [rows, setRows] = useState([]);
  var [side, setSide] = useState('payment');
  var [accounts, setAccounts] = useState([]);
  var [taxTypes, setTaxTypes] = useState([]);
  var [members, setMembers] = useState([]);
  var [suppliers, setSuppliers] = useState([]);
  var [periods, setPeriods] = useState([]);
  var [balance, setBalance] = useState(0);
  var [inclusive, setInclusive] = useState(true);
  var [posting, setPosting] = useState(false);
  var [savingIds, setSavingIds] = useState({});
  var [showImport, setShowImport] = useState(false);
  var [error, setError] = useState('');

  var lastDescription = useRef('');
  var lastReference = useRef('');

  var load = useCallback(async function () {
    if (!companyId || !params.id) return;
    setLoading(true);
    setError('');
    try {
      var all = await acc.listCashBooks(companyId);
      var current = null;
      for (var i = 0; i < all.length; i++) if (all[i].id === params.id) current = all[i];
      if (!current) { setError('That cash book no longer exists.'); setLoading(false); return; }

      setBooks(all);
      setBook(current);
      setInclusive(current.entry_method !== 'exclusive');

      var results = await Promise.all([
        acc.listAccounts(companyId),
        acc.listTaxTypes(companyId),
        acc.listMembers(companyId),
        acc.listSuppliers(companyId),
        acc.listPeriods(companyId),
        acc.listStores(companyId),
        acc.cashBookBalance(current.id),
      ]);
      setAccounts(results[0]);
      setTaxTypes(results[1]);
      setMembers(results[2]);
      setSuppliers(results[3]);
      setPeriods(results[4]);
      setBalance(results[6]);

      var today = toDateInput(new Date());
      var p = periodForDate(results[4], today);
      var b = await acc.getOrCreateOpenBatch(companyId, current.id, p ? p.id : null);
      setBatch(b);
      var entries = await acc.listBatchEntries(b.id);
      setRows(entries.length ? entries : []);
    } catch (err) {
      setError(err.message || 'Could not open this cash book.');
    } finally {
      setLoading(false);
    }
  }, [companyId, params.id]);

  useEffect(function () { load(); }, [load]);

  var defaultTaxType = useMemo(function () {
    if (!book) return null;
    if (book.default_tax_type_id) {
      for (var i = 0; i < taxTypes.length; i++) if (taxTypes[i].id === book.default_tax_type_id) return taxTypes[i];
    }
    for (var j = 0; j < taxTypes.length; j++) if (taxTypes[j].is_default) return taxTypes[j];
    return taxTypes[0] || null;
  }, [book, taxTypes]);

  var visibleRows = useMemo(function () {
    return rows.filter(function (r) { return r.side === side; });
  }, [rows, side]);

  var batchTotal = useMemo(function () {
    var total = 0;
    for (var i = 0; i < visibleRows.length; i++) total += Number(visibleRows[i].amount_inclusive || 0);
    return round2(total);
  }, [visibleRows]);

  var paymentsTotal = useMemo(function () {
    return round2(rows.filter(function (r) { return r.side === 'payment'; })
      .reduce(function (s, r) { return s + Number(r.amount_inclusive || 0); }, 0));
  }, [rows]);

  var receiptsTotal = useMemo(function () {
    return round2(rows.filter(function (r) { return r.side === 'receipt'; })
      .reduce(function (s, r) { return s + Number(r.amount_inclusive || 0); }, 0));
  }, [rows]);

  var problems = useMemo(function () {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var why = validateEntry(rows[i]);
      if (why) out.push({ id: rows[i].id, side: rows[i].side, line: rows[i].line_no, why: why });
    }
    return out;
  }, [rows]);

  // ─── Row operations ───────────────────────────────────────────────────────

  async function addRow() {
    if (!batch || !book) return;
    var today = toDateInput(new Date());
    var lastRow = visibleRows.length ? visibleRows[visibleRows.length - 1] : null;
    var lineNo = (lastRow ? Number(lastRow.line_no || 0) : 0) + 1;
    var p = periodForDate(periods, lastRow ? lastRow.entry_date : today);

    var reference = '';
    if (book.increment_references === 'yes') reference = nextReference(lastReference.current || (lastRow ? lastRow.reference : ''));
    else if (book.increment_references === 'once') reference = lastReference.current || '';

    var payload = Object.assign({}, BLANK, {
      company_id: companyId,
      batch_id: batch.id,
      cash_book_id: book.id,
      side: side,
      line_no: lineNo,
      entry_date: lastRow ? lastRow.entry_date : today,
      period_id: p ? p.id : null,
      reference: reference,
      description: book.repeat_descriptions ? (lastDescription.current || '') : '',
      tax_type_id: book.tax_processing && defaultTaxType ? defaultTaxType.id : null,
      tax_rate: book.tax_processing && defaultTaxType ? Number(defaultTaxType.rate || 0) : 0,
    });

    try {
      var saved = await acc.saveEntry(payload);
      setRows(function (r) { return r.concat([saved]); });
    } catch (err) {
      toast.error(err.message || 'Could not add a line');
    }
  }

  function patchRow(id, patch) {
    setRows(function (list) {
      return list.map(function (r) { return r.id === id ? Object.assign({}, r, patch) : r; });
    });
  }

  // Money in the grid is one number the user types plus a tax type; everything
  // else (net, tax, gross) is derived, so the three can never disagree.
  function recalc(row, amount, taxRate, isInclusive) {
    var split = splitTax(amount, taxRate, isInclusive);
    return {
      amount_inclusive: split.gross,
      amount_exclusive: split.net,
      tax_amount: split.tax,
      tax_rate: taxRate,
    };
  }

  async function persist(row) {
    setSavingIds(function (s) { var n = Object.assign({}, s); n[row.id] = true; return n; });
    try {
      var payload = {
        id: row.id,
        entry_date: row.entry_date,
        period_id: row.period_id,
        gcs: row.gcs,
        gl_account_id: row.gcs === 'G' ? row.gl_account_id : null,
        member_id: row.gcs === 'C' ? row.member_id : null,
        supplier_id: row.gcs === 'S' ? row.supplier_id : null,
        store_id: row.store_id || null,
        reference: row.reference,
        description: row.description,
        tax_type_id: row.tax_type_id,
        tax_rate: row.tax_rate,
        amount_inclusive: row.amount_inclusive,
        amount_exclusive: row.amount_exclusive,
        tax_amount: row.tax_amount,
        discount: row.discount,
        project: row.project,
        line_no: row.line_no,
      };
      await acc.saveEntry(payload);
      if (row.description) lastDescription.current = row.description;
      if (row.reference) lastReference.current = row.reference;
    } catch (err) {
      toast.error(err.message || 'Could not save that line');
    } finally {
      setSavingIds(function (s) { var n = Object.assign({}, s); delete n[row.id]; return n; });
    }
  }

  async function removeRow(row) {
    try {
      await acc.deleteEntry(row.id);
      setRows(function (list) { return list.filter(function (r) { return r.id !== row.id; }); });
    } catch (err) {
      toast.error(err.message || 'Could not delete that line');
    }
  }

  function toggleIncExc() {
    var next = !inclusive;
    setInclusive(next);
    // Re-derive every visible line from the figure the user actually typed,
    // which is the gross when inclusive and the net when exclusive.
    setRows(function (list) {
      return list.map(function (r) {
        if (r.side !== side) return r;
        var typed = next ? Number(r.amount_inclusive || 0) : Number(r.amount_exclusive || 0);
        return Object.assign({}, r, recalc(r, typed, Number(r.tax_rate || 0), next));
      });
    });
    toast.success(next ? 'Amounts are now tax inclusive' : 'Amounts are now tax exclusive');
  }

  // ─── Keyboard: Ctrl+I insert, Ctrl+D delete last, F8 inc/exc ──────────────
  useEffect(function () {
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey) && e.key !== 'F8') return;
      if (e.key === 'F8') { e.preventDefault(); toggleIncExc(); return; }
      var k = String(e.key || '').toLowerCase();
      if (k === 'i') { e.preventDefault(); addRow(); }
      if (k === 'd') {
        e.preventDefault();
        var last = visibleRows[visibleRows.length - 1];
        if (last) removeRow(last);
      }
    }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  });

  // ─── Post ─────────────────────────────────────────────────────────────────

  async function postBatch() {
    if (problems.length) {
      toast.error(problems.length + ' line' + (problems.length > 1 ? 's are' : ' is') + ' incomplete');
      return;
    }
    if (!rows.length) { toast.error('Nothing to post'); return; }
    setPosting(true);
    try {
      var res = await acc.postCashBookBatch(batch.id);
      toast.success('Posted ' + res.lines_posted + ' lines · ' + formatMoneyR(res.total_debits) + ' each side');
      await load();
    } catch (err) {
      toast.error(err.message || 'Posting failed');
    } finally {
      setPosting(false);
    }
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  async function handleImport(payload) {
    var toInsert = [];
    var maxLine = { payment: 0, receipt: 0 };
    for (var r = 0; r < rows.length; r++) {
      var ln = Number(rows[r].line_no || 0);
      if (ln > maxLine[rows[r].side]) maxLine[rows[r].side] = ln;
    }

    for (var i = 0; i < payload.rows.length; i++) {
      var row = payload.rows[i];
      var p = periodForDate(periods, row.date);
      maxLine[row.side] = maxLine[row.side] + 1;
      toInsert.push({
        company_id: companyId,
        batch_id: batch.id,
        cash_book_id: book.id,
        side: row.side,
        line_no: maxLine[row.side],
        entry_date: row.date,
        period_id: p ? p.id : null,
        gcs: 'G',
        gl_account_id: payload.accountId,
        reference: row.reference || '',
        description: row.description || '',
        tax_type_id: payload.taxTypeId,
        tax_rate: payload.taxRate,
        amount_inclusive: row.gross,
        amount_exclusive: row.net,
        tax_amount: row.tax,
        source: 'import',
      });
    }

    var saved = await acc.insertEntries(toInsert);
    try {
      await acc.logImport({
        company_id: companyId,
        cash_book_id: book.id,
        batch_id: batch.id,
        filename: payload.filename,
        row_count: toInsert.length,
        mapping: payload.mapping,
      });
    } catch (logError) {
      // The import log is a nicety. Losing it must not lose the imported lines.
      console.warn('[cannalife] import log failed', logError);
    }

    setRows(function (list) { return list.concat(saved); });
    toast.success('Imported ' + saved.length + ' lines');
  }

  // ─── Exports ──────────────────────────────────────────────────────────────

  function exportPdf() {
    var rowsOut = visibleRows.map(function (r) {
      return {
        line: r.line_no,
        date: formatDateZA(r.entry_date),
        gcs: r.gcs,
        account: allocationLabel(r),
        reference: r.reference,
        description: r.description,
        tax: taxCode(r.tax_type_id),
        exclusive: r.amount_exclusive,
        taxAmt: r.tax_amount,
        inclusive: r.amount_inclusive,
      };
    });
    saveReportPdf({
      title: 'Cash Book ' + (side === 'payment' ? 'Payments' : 'Receipts'),
      subtitle: book.code + ' - ' + book.name + ' · batch of ' + visibleRows.length + ' lines',
      companyName: company ? company.name : '',
      landscape: true,
      columns: [
        { key: 'line', label: '#', width: 6 },
        { key: 'date', label: 'Date', width: 14 },
        { key: 'gcs', label: 'GCS', width: 7 },
        { key: 'account', label: 'Account', width: 34 },
        { key: 'reference', label: 'Reference', width: 18 },
        { key: 'description', label: 'Description', width: 40 },
        { key: 'tax', label: 'Tax', width: 9 },
        { key: 'exclusive', label: 'Exclusive', width: 18, type: 'money' },
        { key: 'taxAmt', label: 'Tax', width: 16, type: 'money' },
        { key: 'inclusive', label: 'Inclusive', width: 18, type: 'money' },
      ],
      rows: rowsOut,
      totals: { description: 'BATCH TOTAL', inclusive: batchTotal },
      notes: [
        'Payments total: R' + formatMoney(paymentsTotal) + '   Receipts total: R' + formatMoney(receiptsTotal),
        'Unposted batch — figures are not yet reflected in the general ledger.',
      ],
    }, 'cash-book-' + book.code + '-' + side + 's.pdf');
  }

  function exportCsv() {
    downloadCsv(
      'cash-book-' + book.code + '-' + side + 's.csv',
      ['Line', 'Date', 'GCS', 'Account', 'Reference', 'Description', 'Tax', 'Exclusive', 'Tax Amount', 'Inclusive'],
      visibleRows.map(function (r) {
        return [r.line_no, r.entry_date, r.gcs, allocationLabel(r), r.reference, r.description,
                taxCode(r.tax_type_id), r.amount_exclusive, r.tax_amount, r.amount_inclusive];
      })
    );
  }

  function allocationLabel(row) {
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

  function taxCode(id) {
    for (var i = 0; i < taxTypes.length; i++) if (taxTypes[i].id === id) return taxTypes[i].code;
    return '';
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <AccountingNav />
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error || 'Cash book not found.'}
        </div>
        <Link to="/accounting/cash-books" className="text-sm underline">Back to cash books</Link>
      </div>
    );
  }

  var isPayments = side === 'payment';

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <AccountingNav />

      {/* Header strip — cash book, batch type, balance */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <button onClick={function () { navigate('/accounting/cash-books'); }}
            className="rounded-md border border-border p-2 hover:bg-muted/50" title="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">Cash Book</label>
            <select
              value={book.id}
              onChange={function (e) { navigate('/accounting/cash-books/' + e.target.value); }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {books.map(function (b) {
                return <option key={b.id} value={b.id}>{b.code} - {b.name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">Batch Type</label>
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-sm text-muted-foreground">
              Normal batch entry
            </div>
          </div>
        </div>

        <div className="flex items-end gap-4">
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">Balance</p>
            <p className="text-lg font-bold">{formatMoneyR(balance)}</p>
          </div>
          <button onClick={load} className="rounded-md border border-border p-2 hover:bg-muted/50" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Payments / Receipts tabs */}
      <div className="flex overflow-hidden rounded-t-lg border border-border">
        <button
          onClick={function () { setSide('payment'); }}
          className={'flex-1 px-4 py-2 text-sm font-medium transition-colors ' +
            (isPayments ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-card text-muted-foreground hover:bg-muted/40')}
        >
          Payments{paymentsTotal ? ' · R' + formatMoney(paymentsTotal) : ''}
        </button>
        <button
          onClick={function () { setSide('receipt'); }}
          className={'flex-1 px-4 py-2 text-sm font-medium transition-colors ' +
            (!isPayments ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200' : 'bg-card text-muted-foreground hover:bg-muted/40')}
        >
          Receipts{receiptsTotal ? ' · R' + formatMoney(receiptsTotal) : ''}
        </button>
      </div>

      {/* The grid */}
      <div className="-mt-4 overflow-x-auto rounded-b-lg border border-t-0 border-border bg-card">
        <table className="w-full min-w-[1180px] text-xs">
          <thead>
            <tr className={isPayments ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-sky-50 dark:bg-sky-950/30'}>
              <Th w="34">#</Th>
              <Th w="86">Per</Th>
              <Th w="118">Date</Th>
              <Th w="58">GCS</Th>
              <Th w="210">Account</Th>
              <Th w="34">R</Th>
              <Th w="110">Reference</Th>
              <Th w="190">Description</Th>
              <Th w="96">Tax</Th>
              <Th w="110" right>Bank Exclusive</Th>
              <Th w="110" right>Bank Inclusive</Th>
              <Th w="90" right>Discount</Th>
              <Th w="40"></Th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No lines yet. Insert a row (Ctrl+I) or import a bank statement.
                </td>
              </tr>
            )}

            {visibleRows.map(function (row) {
              var period = periodForDate(periods, row.entry_date);
              var invalid = validateEntry(row);
              return (
                <tr key={row.id} className={'border-t border-border ' + (invalid ? 'bg-destructive/5' : '')}>
                  <Td>{row.line_no}</Td>
                  <Td>
                    <span className="px-1.5 text-[11px] text-muted-foreground">
                      {period ? period.name.split(' - ')[0] : '—'}
                    </span>
                  </Td>
                  <Td>
                    <input
                      type="date"
                      value={row.entry_date || ''}
                      onChange={function (e) {
                        var p = periodForDate(periods, e.target.value);
                        patchRow(row.id, { entry_date: e.target.value, period_id: p ? p.id : null });
                      }}
                      onBlur={function () { persist(row); }}
                      className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5"
                    />
                  </Td>
                  <Td>
                    <select
                      value={row.gcs}
                      onChange={function (e) {
                        patchRow(row.id, { gcs: e.target.value, gl_account_id: null, member_id: null, supplier_id: null });
                      }}
                      onBlur={function () { persist(row); }}
                      className="w-full bg-transparent px-1 py-1 text-xs outline-none focus:bg-primary/5"
                    >
                      <option value="G">G</option>
                      <option value="C">C</option>
                      <option value="S">S</option>
                    </select>
                  </Td>
                  <Td>
                    <AllocationCell
                      gcs={row.gcs}
                      value={row.gcs === 'G' ? row.gl_account_id : row.gcs === 'C' ? row.member_id : row.supplier_id}
                      accounts={accounts}
                      members={members}
                      suppliers={suppliers}
                      onChange={function (v) {
                        var patch = {};
                        if (row.gcs === 'G') patch.gl_account_id = v;
                        else if (row.gcs === 'C') patch.member_id = v;
                        else patch.supplier_id = v;
                        patchRow(row.id, patch);
                        persist(Object.assign({}, row, patch));
                      }}
                    />
                  </Td>
                  <Td>
                    <span className="block px-1 text-center text-[11px] text-muted-foreground">
                      {row.reconciled ? 'Y' : 'N'}
                    </span>
                  </Td>
                  <Td>
                    <input
                      value={row.reference || ''}
                      onChange={function (e) { patchRow(row.id, { reference: e.target.value }); }}
                      onBlur={function () { persist(row); }}
                      className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5"
                    />
                  </Td>
                  <Td>
                    <input
                      value={row.description || ''}
                      onChange={function (e) { patchRow(row.id, { description: e.target.value }); }}
                      onBlur={function () { persist(row); }}
                      className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5"
                    />
                  </Td>
                  <Td>
                    <select
                      value={row.tax_type_id || ''}
                      disabled={!book.tax_processing}
                      onChange={function (e) {
                        var t = null;
                        for (var i = 0; i < taxTypes.length; i++) if (taxTypes[i].id === e.target.value) t = taxTypes[i];
                        var rate = t ? Number(t.rate || 0) : 0;
                        var typed = inclusive ? Number(row.amount_inclusive || 0) : Number(row.amount_exclusive || 0);
                        var patch = Object.assign({ tax_type_id: e.target.value || null }, recalc(row, typed, rate, inclusive));
                        patchRow(row.id, patch);
                        persist(Object.assign({}, row, patch));
                      }}
                      className="w-full bg-transparent px-1 py-1 text-xs outline-none focus:bg-primary/5 disabled:opacity-50"
                    >
                      <option value="">—</option>
                      {taxTypes.map(function (t) {
                        return <option key={t.id} value={t.id}>{t.code}</option>;
                      })}
                    </select>
                  </Td>
                  <Td right>
                    <input
                      type="number" step="0.01"
                      value={row.amount_exclusive || ''}
                      readOnly={inclusive}
                      onChange={function (e) {
                        patchRow(row.id, recalc(row, Number(e.target.value || 0), Number(row.tax_rate || 0), false));
                      }}
                      onBlur={function () { persist(row); }}
                      className={'w-full bg-transparent px-1.5 py-1 text-right text-xs outline-none focus:bg-primary/5 ' +
                        (inclusive ? 'text-muted-foreground' : '')}
                    />
                  </Td>
                  <Td right>
                    <input
                      type="number" step="0.01"
                      value={row.amount_inclusive || ''}
                      readOnly={!inclusive}
                      onChange={function (e) {
                        patchRow(row.id, recalc(row, Number(e.target.value || 0), Number(row.tax_rate || 0), true));
                      }}
                      onBlur={function () { persist(row); }}
                      className={'w-full bg-transparent px-1.5 py-1 text-right text-xs font-medium outline-none focus:bg-primary/5 ' +
                        (!inclusive ? 'text-muted-foreground' : '')}
                    />
                  </Td>
                  <Td right>
                    <input
                      type="number" step="0.01"
                      value={row.discount || ''}
                      disabled={row.gcs === 'G'}
                      onChange={function (e) { patchRow(row.id, { discount: Number(e.target.value || 0) }); }}
                      onBlur={function () { persist(row); }}
                      title={row.gcs === 'G' ? 'Settlement discount applies to customer and supplier lines' : ''}
                      className="w-full bg-transparent px-1.5 py-1 text-right text-xs outline-none focus:bg-primary/5 disabled:opacity-40"
                    />
                  </Td>
                  <Td>
                    <div className="flex items-center justify-center gap-1">
                      {savingIds[row.id] && <Save className="h-3 w-3 animate-pulse text-primary" />}
                      <button
                        onClick={function () { removeRow(row); }}
                        title="Delete line (Ctrl+D deletes the last)"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom action bar — Pastel's button strip */}
      <div className={'rounded-lg border border-border p-3 ' +
        (isPayments ? 'bg-amber-50 dark:bg-amber-950/20' : 'bg-sky-50 dark:bg-sky-950/20')}>
        <div className="flex flex-wrap items-center gap-2">
          <Action onClick={function () { addRow(); }} icon={Plus}>Insert &lt;Ctrl-I&gt;</Action>
          <Action onClick={function () {
            var last = visibleRows[visibleRows.length - 1];
            if (last) removeRow(last); else toast.error('No line to delete');
          }} icon={Trash2}>Delete &lt;Ctrl-D&gt;</Action>
          <Action onClick={toggleIncExc} icon={Percent}>
            {inclusive ? 'Inclusive' : 'Exclusive'} &lt;F8&gt;
          </Action>
          <Action onClick={function () { setShowImport(true); }} icon={Upload}>Import CSV</Action>
          <Action onClick={exportPdf} icon={FileDown}>Preview PDF</Action>
          <Action onClick={function () { window.print(); }} icon={Printer}>Print</Action>
          <Action onClick={exportCsv} icon={FileDown}>CSV</Action>
          <Link
            to={'/accounting/bank-rec?cashBook=' + book.id}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
          >
            <Settings2 className="h-3.5 w-3.5" /> Reconcile &lt;F7&gt;
          </Link>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">Batch Total</p>
              <p className="text-sm font-bold">{formatMoneyR(batchTotal)}</p>
            </div>
            <button
              onClick={postBatch}
              disabled={posting || !rows.length || problems.length > 0}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {posting ? 'Updating…' : 'Update'}
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2 text-xs">
          {problems.length === 0 ? (
            <span className="flex items-center gap-1.5 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> In balance — {rows.length} line{rows.length === 1 ? '' : 's'} ready to post
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              {problems.length} incomplete line{problems.length === 1 ? '' : 's'}: {problems[0].why} (line {problems[0].line}, {problems[0].side}s)
            </span>
          )}
        </div>
      </div>

      <CsvImportDialog
        open={showImport}
        onClose={function () { setShowImport(false); }}
        onImport={handleImport}
        accounts={accounts}
        taxTypes={taxTypes}
        defaultTaxTypeId={defaultTaxType ? defaultTaxType.id : ''}
        entryMethod={inclusive ? 'inclusive' : 'exclusive'}
        fallbackYear={new Date().getFullYear()}
        cashBookName={book.code + ' - ' + book.name}
      />
    </div>
  );
}

function Th({ children, w, right }) {
  return (
    <th
      style={{ width: w ? w + 'px' : undefined }}
      className={'border-r border-border px-1.5 py-2 text-[11px] font-semibold uppercase tracking-wide ' +
        (right ? 'text-right' : 'text-left')}
    >
      {children}
    </th>
  );
}

function Td({ children, right }) {
  return (
    <td className={'border-r border-border/60 p-0 align-middle ' + (right ? 'text-right' : '')}>
      {children}
    </td>
  );
}

function Action({ children, onClick, icon: Icon }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
