import { useState, useMemo } from 'react';
import { Upload, X, AlertTriangle, ArrowRight } from 'lucide-react';
import {
  parseStatementCsv, normaliseCsvDate, parseAmount, splitTax, formatMoney,
} from '@/lib/accounting';

// Bank statement import for a cash book.
//
// The accountant's own export has headers like 'Number', 'Date',
// 'Description1', 'Description2', 'Reference', 'Amount', 'Balance' — quoted,
// and with dates as bare "02 Feb". Rather than hard-coding that one layout,
// the dialog guesses the mapping from the headers, shows it, and lets the user
// correct it before anything is written. Positive amounts become receipts,
// negative amounts payments, which is how every SA bank exports.

var TARGETS = [
  { key: 'date',        label: 'Date',         required: true,  hints: ['date', 'transaction date', 'txn date', 'posting date'] },
  { key: 'description', label: 'Description',  required: true,  hints: ['description1', 'description', 'narrative', 'details', 'detail'] },
  { key: 'description2',label: 'Description 2',required: false, hints: ['description2', 'description 2'] },
  { key: 'reference',   label: 'Reference',    required: false, hints: ['reference', 'ref', 'number', 'no'] },
  { key: 'amount',      label: 'Amount',       required: true,  hints: ['amount', 'value', 'debit/credit'] },
  { key: 'balance',     label: 'Balance',      required: false, hints: ['balance', 'running balance'] },
];

function guessMapping(headers) {
  var map = {};
  TARGETS.forEach(function (t) {
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '').toLowerCase().trim();
      if (t.hints.indexOf(h) !== -1) { map[t.key] = headers[i]; return; }
    }
    for (var j = 0; j < headers.length; j++) {
      var hh = String(headers[j] || '').toLowerCase().trim();
      for (var k = 0; k < t.hints.length; k++) {
        if (hh.indexOf(t.hints[k]) !== -1 && !map[t.key]) { map[t.key] = headers[j]; return; }
      }
    }
  });
  return map;
}

export default function CsvImportDialog({
  open, onClose, onImport, defaultAccountId, accounts, taxTypes, defaultTaxTypeId,
  entryMethod, fallbackYear, cashBookName,
}) {
  var [filename, setFilename] = useState('');
  var [headers, setHeaders] = useState([]);
  var [records, setRecords] = useState([]);
  var [mapping, setMapping] = useState({});
  var [accountId, setAccountId] = useState(defaultAccountId || '');
  var [taxTypeId, setTaxTypeId] = useState(defaultTaxTypeId || '');
  var [error, setError] = useState('');
  var [busy, setBusy] = useState(false);

  var taxRate = useMemo(function () {
    for (var i = 0; i < taxTypes.length; i++) if (taxTypes[i].id === taxTypeId) return Number(taxTypes[i].rate || 0);
    return 0;
  }, [taxTypeId, taxTypes]);

  var preview = useMemo(function () {
    if (!records.length || !mapping.date || !mapping.amount) return [];
    var out = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var amount = parseAmount(r[mapping.amount]);
      var date = normaliseCsvDate(r[mapping.date], fallbackYear);
      var desc = [r[mapping.description], mapping.description2 ? r[mapping.description2] : '']
        .filter(Boolean).join(' ').trim();
      var split = splitTax(Math.abs(amount), taxRate, entryMethod !== 'exclusive');
      out.push({
        row: i + 1,
        date: date,
        valid: !!date && amount !== 0,
        description: desc,
        reference: mapping.reference ? r[mapping.reference] : '',
        amount: amount,
        side: amount < 0 ? 'payment' : 'receipt',
        net: split.net,
        tax: split.tax,
        gross: split.gross,
      });
    }
    return out;
  }, [records, mapping, taxRate, entryMethod, fallbackYear]);

  var validRows = preview.filter(function (p) { return p.valid; });
  var skipped = preview.length - validRows.length;

  function handleFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setError('');
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = parseStatementCsv(String(reader.result || ''));
        if (!parsed.records.length) { setError('That file has no data rows.'); return; }
        setFilename(file.name);
        setHeaders(parsed.headers);
        setRecords(parsed.records);
        setMapping(guessMapping(parsed.headers));
      } catch (err) {
        setError(err.message || 'Could not read that file.');
      }
    };
    reader.onerror = function () { setError('Could not read that file.'); };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!accountId) { setError('Choose the contra account these entries allocate to.'); return; }
    if (!validRows.length) { setError('Nothing to import.'); return; }
    setBusy(true);
    setError('');
    try {
      await onImport({
        filename: filename,
        rows: validRows,
        accountId: accountId,
        taxTypeId: taxTypeId || null,
        taxRate: taxRate,
        mapping: mapping,
      });
      reset();
      onClose();
    } catch (err) {
      setError(err.message || 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFilename(''); setHeaders([]); setRecords([]); setMapping({}); setError('');
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-4xl rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Import bank statement</h2>
            <p className="text-xs text-muted-foreground">{cashBookName}</p>
          </div>
          <button onClick={function () { reset(); onClose(); }} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {!records.length && (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-12 hover:bg-muted/30">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">Choose a CSV file</span>
              <span className="text-xs text-muted-foreground">
                Number, Date, Description, Reference, Amount, Balance — in any order
              </span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            </label>
          )}

          {!!records.length && (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-xs">
                  <span className="font-medium">{filename}</span> — {records.length} rows
                </p>
                <button onClick={reset} className="text-xs text-muted-foreground underline hover:text-foreground">
                  Choose a different file
                </button>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Column mapping
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {TARGETS.map(function (t) {
                    return (
                      <div key={t.key}>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          {t.label}{t.required ? ' *' : ''}
                        </label>
                        <select
                          value={mapping[t.key] || ''}
                          onChange={function (e) {
                            var next = Object.assign({}, mapping);
                            if (e.target.value) next[t.key] = e.target.value; else delete next[t.key];
                            setMapping(next);
                          }}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                        >
                          <option value="">— not used —</option>
                          {headers.map(function (h) {
                            return <option key={h} value={h}>{h}</option>;
                          })}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Allocate all lines to *</label>
                  <select
                    value={accountId}
                    onChange={function (e) { setAccountId(e.target.value); }}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="">— choose an account —</option>
                    {accounts.map(function (a) {
                      return <option key={a.id} value={a.id}>{a.code}/{a.sub_code} {a.name}</option>;
                    })}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Every imported line lands here. Re-allocate individual lines in the grid afterwards.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Tax type</label>
                  <select
                    value={taxTypeId}
                    onChange={function (e) { setTaxTypeId(e.target.value); }}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="">— no tax —</option>
                    {taxTypes.map(function (t) {
                      return <option key={t.id} value={t.id}>{t.code} - {t.description}</option>;
                    })}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Amounts are treated as {entryMethod === 'exclusive' ? 'tax exclusive' : 'tax inclusive'}.
                  </p>
                </div>
              </div>

              {preview.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Preview
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {validRows.length} to import
                      {skipped > 0 ? ' · ' + skipped + ' skipped (no date or zero amount)' : ''}
                    </p>
                  </div>
                  <div className="max-h-56 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60">
                        <tr className="text-left">
                          <th className="px-2 py-1.5 font-medium">#</th>
                          <th className="px-2 py-1.5 font-medium">Date</th>
                          <th className="px-2 py-1.5 font-medium">Description</th>
                          <th className="px-2 py-1.5 font-medium">Ref</th>
                          <th className="px-2 py-1.5 text-right font-medium">Net</th>
                          <th className="px-2 py-1.5 text-right font-medium">Tax</th>
                          <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                          <th className="px-2 py-1.5 font-medium">Side</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.slice(0, 200).map(function (p) {
                          return (
                            <tr key={p.row} className={'border-t border-border ' + (p.valid ? '' : 'opacity-40')}>
                              <td className="px-2 py-1">{p.row}</td>
                              <td className="px-2 py-1">{p.date || '—'}</td>
                              <td className="px-2 py-1 max-w-[220px] truncate">{p.description}</td>
                              <td className="px-2 py-1">{p.reference}</td>
                              <td className="px-2 py-1 text-right">{formatMoney(p.net)}</td>
                              <td className="px-2 py-1 text-right">{formatMoney(p.tax)}</td>
                              <td className="px-2 py-1 text-right">{formatMoney(p.gross)}</td>
                              <td className="px-2 py-1">
                                <span className={p.side === 'payment' ? 'text-amber-600' : 'text-emerald-600'}>
                                  {p.side}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={function () { reset(); onClose(); }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            onClick={doImport}
            disabled={busy || !validRows.length}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Import {validRows.length ? validRows.length + ' lines' : ''} <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
