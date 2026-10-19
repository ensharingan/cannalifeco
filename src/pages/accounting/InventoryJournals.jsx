import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Boxes, ArrowLeftRight, Plus, Trash2, FileDown, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import AccountingNav from '@/components/accounting/AccountingNav';
import { saveReportPdf } from '@/lib/accountingPdf';
import {
  formatMoney, formatMoneyR, formatDateZA, toDateInput, periodForDate, round2,
} from '@/lib/accounting';
import * as acc from '@/api/accounting';

/**
 * Inventory Journals and Interstore Transfers.
 *
 * Pastel models these as one screen with two batch types, and so does this: the
 * only differences are the From/To store header on an interstore batch and
 * which column the quantity lands in. Posting moves the stock in
 * store_inventory and writes the matching value entries to the ledger in the
 * same database transaction, so stock and books can never drift apart.
 *
 * @param {'normal'|'interstore'} batchType
 */
export default function InventoryJournals({ batchType }) {
  var isTransfer = batchType === 'interstore';
  var ctx = useCompany();
  var companyId = ctx ? ctx.companyId : null;
  var company = ctx ? ctx.company : null;

  var [loading, setLoading] = useState(true);
  var [batches, setBatches] = useState([]);
  var [activeId, setActiveId] = useState(null);
  var [lines, setLines] = useState([]);
  var [products, setProducts] = useState([]);
  var [stores, setStores] = useState([]);
  var [accounts, setAccounts] = useState([]);
  var [periods, setPeriods] = useState([]);
  var [inventory, setInventory] = useState([]);
  var [posting, setPosting] = useState(false);

  var load = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    try {
      var res = await Promise.all([
        acc.listInventoryBatches(companyId, batchType),
        acc.listProducts(companyId),
        acc.listStores(companyId),
        acc.listAccounts(companyId),
        acc.listPeriods(companyId),
      ]);
      setBatches(res[0]);
      setProducts(res[1]);
      setStores(res[2].filter(function (s) { return s.is_active !== false; }));
      setAccounts(res[3]);
      setPeriods(res[4]);

      var ids = res[1].map(function (p) { return p.id; });
      setInventory(await acc.storeInventoryFor(companyId, ids));
    } catch (err) {
      toast.error(err.message || 'Could not load batches');
    } finally {
      setLoading(false);
    }
  }, [companyId, batchType]);

  useEffect(function () { load(); }, [load]);

  var active = useMemo(function () {
    for (var i = 0; i < batches.length; i++) if (batches[i].id === activeId) return batches[i];
    return null;
  }, [batches, activeId]);

  var totalValue = useMemo(function () {
    var t = 0;
    for (var i = 0; i < lines.length; i++) {
      var qty = isTransfer ? Number(lines[i].qty_out || 0) : (Number(lines[i].qty_in || 0) - Number(lines[i].qty_out || 0));
      t += qty * Number(lines[i].unit_cost || 0);
    }
    return round2(t);
  }, [lines, isTransfer]);

  function stockFor(productId, storeId) {
    if (!productId || !storeId) return 0;
    for (var i = 0; i < inventory.length; i++) {
      if (inventory[i].product_id === productId && inventory[i].store_id === storeId) {
        return Number(inventory[i].stock_quantity || 0);
      }
    }
    return 0;
  }

  // On an interstore batch the source store is on the batch, so a line that
  // moves more than that branch actually holds is worth flagging before the
  // post fails or drives the stock negative.
  var problems = useMemo(function () {
    if (!active) return [];
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var qty = isTransfer ? Number(l.qty_out || 0) : (Number(l.qty_in || 0) - Number(l.qty_out || 0));
      if (!l.product_id && qty) out.push('Line ' + l.line_no + ': choose a product');
      if (isTransfer && l.product_id && qty > stockFor(l.product_id, active.from_store_id)) {
        out.push('Line ' + l.line_no + ': only ' + stockFor(l.product_id, active.from_store_id) + ' in stock at the source store');
      }
      if (!isTransfer && l.product_id && !l.store_id && qty) out.push('Line ' + l.line_no + ': choose a store');
    }
    if (isTransfer && active.status === 'open' && (!active.from_store_id || !active.to_store_id)) {
      out.push('Choose both a From Store and a To Store');
    }
    if (isTransfer && active.from_store_id && active.from_store_id === active.to_store_id) {
      out.push('From Store and To Store must differ');
    }
    return out;
  }, [lines, active, isTransfer, inventory]);

  async function openBatch(id) {
    setActiveId(id);
    try { setLines(await acc.listInventoryEntries(id)); }
    catch (err) { toast.error(err.message || 'Could not load that batch'); }
  }

  async function newBatch() {
    try {
      var today = toDateInput(new Date());
      var p = periodForDate(periods, today);
      var b = await acc.createInventoryBatch({
        company_id: companyId,
        batch_type: batchType,
        entry_date: today,
        period_id: p ? p.id : null,
        description: (isTransfer ? 'Interstore transfer ' : 'Inventory journal ') + formatDateZA(today),
        reference: '',
      });
      setBatches(function (l) { return [b].concat(l); });
      setActiveId(b.id);
      setLines([]);
    } catch (err) {
      toast.error(err.message || 'Could not create a batch');
    }
  }

  async function patchBatch(p) {
    var next = Object.assign({}, active, p);
    setBatches(function (l) { return l.map(function (b) { return b.id === active.id ? next : b; }); });
    try { await acc.updateInventoryBatch(active.id, p); }
    catch (err) { toast.error(err.message || 'Could not save the batch'); }
  }

  async function addLine() {
    if (!active) return;
    var last = lines.length ? lines[lines.length - 1] : null;
    try {
      var saved = await acc.saveInventoryEntry({
        company_id: companyId,
        batch_id: active.id,
        line_no: lines.length + 1,
        entry_date: active.entry_date || toDateInput(new Date()),
        reference: active.reference || '',
        store_id: isTransfer ? null : (last ? last.store_id : (stores[0] ? stores[0].id : null)),
        narration: last ? last.narration : (active.description || ''),
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
      await acc.saveInventoryEntry({
        id: row.id,
        product_id: row.product_id,
        inventory_code: row.inventory_code,
        unit: row.unit,
        narration: row.narration,
        store_id: row.store_id,
        entry_date: row.entry_date,
        reference: row.reference,
        qty_at_period: row.qty_at_period,
        qty_in: row.qty_in,
        qty_out: row.qty_out,
        current_average: row.current_average,
        unit_cost: row.unit_cost,
        new_average: row.new_average,
        new_quantity: row.new_quantity,
        gl_account_id: row.gl_account_id,
        markup_account_id: row.markup_account_id,
        project: row.project,
        line_no: row.line_no,
      });
    } catch (err) {
      toast.error(err.message || 'Could not save that line');
    }
  }

  // Choosing a product fills in the columns Pastel derives: code, current
  // average cost and the quantity the branch is holding right now.
  function chooseProduct(row, productId) {
    var product = null;
    for (var i = 0; i < products.length; i++) if (products[i].id === productId) product = products[i];
    var storeId = isTransfer ? (active ? active.from_store_id : null) : row.store_id;
    var onHand = stockFor(productId, storeId);
    var cost = product ? Number(product.cost_price || 0) : 0;
    var p = {
      product_id: productId,
      inventory_code: product ? (product.sku || '') : '',
      current_average: cost,
      unit_cost: cost,
      new_average: cost,
      qty_at_period: onHand,
    };
    patch(row.id, p);
    persist(Object.assign({}, row, p));
  }

  async function removeLine(row) {
    try {
      await acc.deleteInventoryEntry(row.id);
      setLines(function (l) { return l.filter(function (r) { return r.id !== row.id; }); });
    } catch (err) {
      toast.error(err.message || 'Could not delete');
    }
  }

  async function post() {
    if (problems.length) { toast.error(problems[0]); return; }
    if (!lines.length) { toast.error('Nothing to post'); return; }
    setPosting(true);
    try {
      var res = await acc.postInventoryBatch(active.id);
      toast.success('Posted ' + res.lines_posted + ' lines · ' + formatMoneyR(res.total_value));
      setActiveId(null);
      setLines([]);
      await load();
    } catch (err) {
      toast.error(err.message || 'Posting failed');
    } finally {
      setPosting(false);
    }
  }

  function productName(id) {
    for (var i = 0; i < products.length; i++) if (products[i].id === id) return products[i].name;
    return '';
  }

  function storeName(id) {
    for (var i = 0; i < stores.length; i++) if (stores[i].id === id) return stores[i].name;
    return '';
  }

  function exportPdf() {
    saveReportPdf({
      title: isTransfer ? 'Interstore Transfer' : 'Inventory Journal',
      subtitle: active
        ? (active.description || '') +
          (isTransfer ? ' · ' + storeName(active.from_store_id) + ' to ' + storeName(active.to_store_id) : '') +
          ' · ref ' + (active.reference || '—')
        : '',
      companyName: company ? company.name : '',
      landscape: true,
      columns: [
        { key: 'line', label: '#', width: 6 },
        { key: 'code', label: 'Code', width: 16 },
        { key: 'product', label: 'Inventory Item', width: 42 },
        { key: 'store', label: 'Store', width: 22 },
        { key: 'date', label: 'Date', width: 16 },
        { key: 'reference', label: 'Reference', width: 18 },
        { key: 'onHand', label: 'Qty at Period', width: 18, type: 'money' },
        { key: 'qtyIn', label: 'In', width: 14, type: 'money' },
        { key: 'qtyOut', label: 'Out', width: 14, type: 'money' },
        { key: 'cost', label: 'Unit Cost', width: 18, type: 'money' },
        { key: 'value', label: 'Value', width: 20, type: 'money' },
      ],
      rows: lines.map(function (l) {
        var qty = isTransfer ? Number(l.qty_out || 0) : (Number(l.qty_in || 0) - Number(l.qty_out || 0));
        return {
          line: l.line_no,
          code: l.inventory_code || '',
          product: productName(l.product_id),
          store: isTransfer ? storeName(active.from_store_id) + ' > ' + storeName(active.to_store_id) : storeName(l.store_id),
          date: formatDateZA(l.entry_date),
          reference: l.reference || '',
          onHand: l.qty_at_period,
          qtyIn: l.qty_in || '',
          qtyOut: l.qty_out || '',
          cost: l.unit_cost,
          value: round2(qty * Number(l.unit_cost || 0)),
        };
      }),
      totals: { product: 'TOTAL VALUE', value: totalValue },
    }, (isTransfer ? 'interstore-transfer' : 'inventory-journal') + '.pdf');
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  var Icon = isTransfer ? ArrowLeftRight : Boxes;
  var readOnly = active && active.status !== 'open';

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <AccountingNav />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Icon className="h-5 w-5 text-primary" />
            {isTransfer ? 'Interstore Transfers' : 'Inventory Journals'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isTransfer
              ? 'Move stock between the warehouse and stores. Posting updates both branches and the ledger together.'
              : 'Adjust stock quantities and values. Posting writes the stock movement and the ledger entry together.'}
          </p>
        </div>
        <button onClick={newBatch} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New batch
        </button>
      </div>

      {!active && (
        <div className="rounded-lg border border-border bg-card">
          {batches.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              No {isTransfer ? 'transfers' : 'journals'} yet.
            </p>
          ) : (
            <ul>
              {batches.map(function (b) {
                return (
                  <li key={b.id}>
                    <button onClick={function () { openBatch(b.id); }}
                      className="flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left hover:bg-muted/40">
                      <span>
                        <span className="block text-sm">{b.description || 'Batch'}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatDateZA(b.entry_date)}
                          {b.reference ? ' · ' + b.reference : ''}
                          {isTransfer && b.from_store_id ? ' · ' + storeName(b.from_store_id) + ' → ' + storeName(b.to_store_id) : ''}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                          (b.status === 'open' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                                               : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200')}>
                          {b.status}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {active && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-end gap-3">
              <button onClick={function () { setActiveId(null); setLines([]); }}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/50">
                All batches
              </button>

              {isTransfer && (
                <>
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">From Store</label>
                    <select value={active.from_store_id || ''} disabled={readOnly}
                      onChange={function (e) { patchBatch({ from_store_id: e.target.value || null }); }}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                      <option value="">—</option>
                      {stores.map(function (s) { return <option key={s.id} value={s.id}>{s.name}</option>; })}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">To Store</label>
                    <select value={active.to_store_id || ''} disabled={readOnly}
                      onChange={function (e) { patchBatch({ to_store_id: e.target.value || null }); }}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                      <option value="">—</option>
                      {stores.map(function (s) { return <option key={s.id} value={s.id}>{s.name}</option>; })}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Date</label>
                <input type="date" value={active.entry_date || ''} readOnly={readOnly}
                  onChange={function (e) {
                    var p = periodForDate(periods, e.target.value);
                    patchBatch({ entry_date: e.target.value, period_id: p ? p.id : null });
                  }}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Reference</label>
                <input value={active.reference || ''} readOnly={readOnly}
                  onChange={function (e) { patchBatch({ reference: e.target.value }); }}
                  placeholder="1708BZ"
                  className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Period</label>
                <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-sm text-muted-foreground">
                  {(function () {
                    var p = periodForDate(periods, active.entry_date);
                    return p ? p.name : 'No period';
                  })()}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Batch value</p>
                <p className="text-sm font-bold">{formatMoneyR(totalValue)}</p>
              </div>
              <button onClick={exportPdf} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted/50">
                <FileDown className="h-3.5 w-3.5" /> PDF
              </button>
              {!readOnly && (
                <button onClick={post} disabled={posting || problems.length > 0 || !lines.length}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  {posting ? 'Posting…' : 'Post batch'}
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[1150px] text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="w-10 px-2 py-2 font-semibold">#</th>
                  <th className="w-24 px-2 py-2 font-semibold">Code</th>
                  <th className="px-2 py-2 font-semibold">Inventory Item</th>
                  {!isTransfer && <th className="w-36 px-2 py-2 font-semibold">Store</th>}
                  <th className="px-2 py-2 font-semibold">Narration</th>
                  <th className="w-28 px-2 py-2 text-right font-semibold">Qty at Period</th>
                  {!isTransfer && <th className="w-20 px-2 py-2 text-right font-semibold">In</th>}
                  <th className="w-20 px-2 py-2 text-right font-semibold">{isTransfer ? 'Qty' : 'Out'}</th>
                  <th className="w-24 px-2 py-2 text-right font-semibold">Unit Cost</th>
                  <th className="w-24 px-2 py-2 text-right font-semibold">Value</th>
                  {!isTransfer && <th className="w-44 px-2 py-2 font-semibold">Contra Account</th>}
                  <th className="w-10 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={isTransfer ? 9 : 12} className="px-3 py-8 text-center text-muted-foreground">
                      No lines yet.
                    </td>
                  </tr>
                )}
                {lines.map(function (l) {
                  var qty = isTransfer ? Number(l.qty_out || 0) : (Number(l.qty_in || 0) - Number(l.qty_out || 0));
                  var value = round2(qty * Number(l.unit_cost || 0));
                  return (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-2 py-1">{l.line_no}</td>
                      <td className="px-2 py-1 text-muted-foreground">{l.inventory_code || '—'}</td>
                      <td className="p-0">
                        <select value={l.product_id || ''} disabled={readOnly}
                          onChange={function (e) { chooseProduct(l, e.target.value); }}
                          className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5">
                          <option value="">— choose a product —</option>
                          {products.map(function (p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
                        </select>
                      </td>
                      {!isTransfer && (
                        <td className="p-0">
                          <select value={l.store_id || ''} disabled={readOnly}
                            onChange={function (e) {
                              var p = { store_id: e.target.value || null, qty_at_period: stockFor(l.product_id, e.target.value) };
                              patch(l.id, p); persist(Object.assign({}, l, p));
                            }}
                            className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5">
                            <option value="">—</option>
                            {stores.map(function (s) { return <option key={s.id} value={s.id}>{s.name}</option>; })}
                          </select>
                        </td>
                      )}
                      <td className="p-0">
                        <input value={l.narration || ''} readOnly={readOnly}
                          onChange={function (e) { patch(l.id, { narration: e.target.value }); }}
                          onBlur={function () { persist(l); }}
                          className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5" />
                      </td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{formatMoney(l.qty_at_period)}</td>
                      {!isTransfer && (
                        <td className="p-0">
                          <input type="number" step="0.0001" value={l.qty_in || ''} readOnly={readOnly}
                            onChange={function (e) { patch(l.id, { qty_in: Number(e.target.value || 0), qty_out: 0 }); }}
                            onBlur={function () { persist(l); }}
                            className="w-full bg-transparent px-1.5 py-1 text-right text-xs outline-none focus:bg-primary/5" />
                        </td>
                      )}
                      <td className="p-0">
                        <input type="number" step="0.0001" value={l.qty_out || ''} readOnly={readOnly}
                          onChange={function (e) {
                            var p = { qty_out: Number(e.target.value || 0) };
                            if (!isTransfer) p.qty_in = 0;
                            patch(l.id, p);
                          }}
                          onBlur={function () { persist(l); }}
                          className="w-full bg-transparent px-1.5 py-1 text-right text-xs outline-none focus:bg-primary/5" />
                      </td>
                      <td className="p-0">
                        <input type="number" step="0.0001" value={l.unit_cost || ''} readOnly={readOnly}
                          onChange={function (e) { patch(l.id, { unit_cost: Number(e.target.value || 0), new_average: Number(e.target.value || 0) }); }}
                          onBlur={function () { persist(l); }}
                          className="w-full bg-transparent px-1.5 py-1 text-right text-xs outline-none focus:bg-primary/5" />
                      </td>
                      <td className="px-2 py-1 text-right font-medium">{formatMoney(value)}</td>
                      {!isTransfer && (
                        <td className="p-0">
                          <select value={l.gl_account_id || ''} disabled={readOnly}
                            onChange={function (e) {
                              var p = { gl_account_id: e.target.value || null };
                              patch(l.id, p); persist(Object.assign({}, l, p));
                            }}
                            className="w-full bg-transparent px-1.5 py-1 text-xs outline-none focus:bg-primary/5">
                            <option value="">— stock adjustment —</option>
                            {accounts.map(function (a) {
                              return <option key={a.id} value={a.id}>{a.code}/{a.sub_code} {a.name}</option>;
                            })}
                          </select>
                        </td>
                      )}
                      <td className="px-2 py-1 text-center">
                        {!readOnly && (
                          <button onClick={function () { removeLine(l); }} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {!readOnly && (
              <button onClick={addLine} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/50">
                <Plus className="h-4 w-4" /> Add line
              </button>
            )}
            {problems.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                <AlertTriangle className="h-4 w-4" /> {problems[0]}
                {problems.length > 1 ? ' (+' + (problems.length - 1) + ' more)' : ''}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
