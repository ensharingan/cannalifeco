import { useState, useEffect, useMemo } from "react";
import { supabase } from '@/api/supabaseClient';
import {
  Download, Search, AlertTriangle, CheckCircle2, Package, Boxes, Banknote, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "../../lib/currency";
import { cn } from "@/lib/utils";
import { SectionHeader, useSection } from "./sections";

// Owner / manager view that ties UNITS SOLD to REVENUE to STOCK:
//   units x list price = expected revenue   vs   actual revenue (after discounts)
//   units sold (orders)                      vs   units deducted from stock (ledger)
//   opening stock + movements = closing stock (shop front and warehouse)
// Data comes from the report_stock_reconciliation RPC, which scopes by store/role.

const n = (v) => (typeof v === 'number' ? v : Number(v || 0));
const money = (v) => formatCurrency(n(v));
const qty = (v) => {
  const x = Math.round(n(v) * 100) / 100;
  return Number.isInteger(x) ? String(x) : x.toFixed(2);
};
const signed = (v) => (n(v) > 0 ? '+' : '') + qty(v);

const MOVE_LABELS = {
  sale: 'Sale',
  in: 'Refund / return',
  return: 'Return',
  restock: 'Restock',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  stock_take: 'Stock take',
  room_transfer: 'Back room → front',
  warehouse_to_front: 'Warehouse → front',
  warehouse_to_warehouse: 'Front → warehouse',
  warehouse_receive: 'Received into warehouse',
  warehouse_stock_take: 'Warehouse stock take',
  warehouse_migrate: 'Back room → warehouse',
};
const moveLabel = (t) => MOVE_LABELS[t] || t;

const todayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

function toCSV(rows, headers) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map(h => esc(h.label)).join(','),
    ...rows.map(r => headers.map(h => esc(h.get(r))).join(','))].join('\n');
}
function downloadCSV(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const looksLikeTest = (name) => /\b(test|sample)s?\b/i.test(name || '');

export default function StockReconciliation({ companyId, storeId, date }) {
  const { isOpen } = useSection('stock');
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  useEffect(() => { setFrom(date); setTo(date); }, [date]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [tab, setTab] = useState('items');          // items | movements
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [moveType, setMoveType] = useState('');
  const [onlyMismatches, setOnlyMismatches] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);
  const [hideTest, setHideTest] = useState(false);

  const load = () => {
    if (!companyId || !from || !to || !isOpen) return;
    setLoading(true);
    setError(null);
    supabase
      .rpc('report_stock_reconciliation', {
        p_from: from, p_to: to, p_store: storeId || null, p_company: companyId,
      })
      .then(({ data, error }) => { if (error) throw error; setData(data); })
      .catch((err) => {
        console.error('Stock reconciliation failed:', err);
        setError(err.message || 'Could not build the stock reconciliation.');
        setData(null);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [companyId, from, to, storeId, isOpen]);

  const items = data?.items || [];
  const totalMismatch = items.filter(i => n(i.stock_diff) !== 0).length;
  const movements = data?.movements || [];

  const isActive = (i) =>
    n(i.units_sold) !== 0 || n(i.ledger_sold) !== 0 || n(i.received) !== 0 ||
    n(i.from_warehouse) !== 0 || n(i.to_warehouse) !== 0 || n(i.transfer_out) !== 0 ||
    n(i.adjustments) !== 0 || n(i.wh_received) !== 0 || n(i.wh_adjust) !== 0;

  const categories = useMemo(
    () => [...new Set(items.map(i => i.category).filter(Boolean))].sort(),
    [items]
  );
  const moveTypes = useMemo(
    () => [...new Set(movements.map(m => m.type))].sort(),
    [movements]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (onlyActive && !isActive(i)) return false;
      if (onlyMismatches && n(i.stock_diff) === 0) return false;
      if (hideTest && looksLikeTest(i.name)) return false;
      if (category && i.category !== category) return false;
      if (q && !((i.name || '').toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [items, search, category, onlyMismatches, onlyActive, hideTest]);

  const filteredMoves = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movements.filter(m => {
      if (moveType && m.type !== moveType) return false;
      if (hideTest && looksLikeTest(m.product)) return false;
      if (q && !((m.product || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [movements, search, moveType, hideTest]);

  // Summary is for everything matching the filters (so owners can slice by category).
  const sum = (k) => filtered.reduce((s, i) => s + n(i[k]), 0);
  const unitsSold = sum('units_sold');
  const expectedRev = sum('expected_revenue');
  const actualRev = sum('actual_revenue');
  const discountGap = actualRev - expectedRev;
  const frontClosing = sum('closing_front');
  const whClosing = sum('closing_wh');
  const mismatchCount = filtered.filter(i => n(i.stock_diff) !== 0).length;
  const mismatchUnits = filtered.reduce((s, i) => s + Math.abs(n(i.stock_diff)), 0);

  const exportItems = () => downloadCSV(
    `stock-reconciliation-${from}${to !== from ? '-to-' + to : ''}.csv`,
    toCSV(filtered, [
      { label: 'Item', get: r => r.name },
      { label: 'SKU', get: r => r.sku || '' },
      { label: 'Category', get: r => r.category },
      { label: 'Opening (front)', get: r => r.opening_front },
      { label: 'Received', get: r => r.received },
      { label: 'From warehouse', get: r => r.from_warehouse },
      { label: 'To warehouse', get: r => r.to_warehouse },
      { label: 'Transfers out', get: r => r.transfer_out },
      { label: 'Adjustments', get: r => r.adjustments },
      { label: 'Sold (stock ledger)', get: r => r.ledger_sold },
      { label: 'Closing (front)', get: r => r.closing_front },
      { label: 'Warehouse opening', get: r => r.opening_wh },
      { label: 'Warehouse closing', get: r => r.closing_wh },
      { label: 'Units sold (orders)', get: r => r.units_sold },
      { label: 'Stock vs sales difference', get: r => r.stock_diff },
      { label: 'Expected revenue', get: r => r.expected_revenue },
      { label: 'Actual revenue', get: r => r.actual_revenue },
      { label: 'Revenue difference', get: r => r.revenue_diff },
    ])
  );
  const exportMoves = () => downloadCSV(
    `stock-movements-${from}${to !== from ? '-to-' + to : ''}.csv`,
    toCSV(filteredMoves, [
      { label: 'Time', get: r => r.time },
      { label: 'Store', get: r => r.store },
      { label: 'Product', get: r => r.product },
      { label: 'Type', get: r => moveLabel(r.type) },
      { label: 'Qty', get: r => r.qty },
      { label: 'Shop front change', get: r => r.front_change },
      { label: 'Warehouse change', get: r => r.wh_change },
      { label: 'Reason', get: r => r.reason },
      { label: 'User', get: r => r.user },
    ])
  );

  const cards = [
    { label: 'Units sold', value: qty(unitsSold),
      sub: `${money(actualRev)} revenue`, icon: Package, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'Expected vs actual',
      value: money(actualRev),
      sub: Math.abs(discountGap) < 0.005 ? `Matches ${money(expectedRev)} list value`
        : `${money(expectedRev)} list · ${discountGap < 0 ? '-' : '+'}${money(Math.abs(discountGap))} ${discountGap < 0 ? 'discounts' : 'over'}`,
      icon: Banknote, color: 'text-green-500', bg: 'bg-green-500/10' },
    { label: 'Stock on hand (close)', value: qty(frontClosing + whClosing),
      sub: `${qty(frontClosing)} shop · ${qty(whClosing)} warehouse`,
      icon: Boxes, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { label: 'Stock vs sales',
      value: mismatchCount === 0 ? 'All match' : `${mismatchCount} item${mismatchCount === 1 ? '' : 's'}`,
      sub: mismatchCount === 0 ? 'Units sold = units deducted' : `${qty(mismatchUnits)} unit${mismatchUnits === 1 ? '' : 's'} out`,
      icon: mismatchCount === 0 ? CheckCircle2 : AlertTriangle,
      color: mismatchCount === 0 ? 'text-green-600' : 'text-red-500',
      bg: mismatchCount === 0 ? 'bg-green-500/10' : 'bg-red-500/10' },
  ];

  const selectCls = "h-9 rounded-md border border-input bg-background px-3 text-sm";
  const th = "py-2 font-medium text-right whitespace-nowrap";

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4 no-print">
      <SectionHeader
        id="stock"
        title="Stock vs revenue"
        subtitle={`Units sold × price = revenue, matched to stock in, out and on hand.${data?.store_name ? ' · ' + data.store_name : ''}`}
        badge={data && totalMismatch > 0 ? (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-500">
            {totalMismatch} mismatch{totalMismatch === 1 ? '' : 'es'}
          </span>
        ) : null}
        right={(
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" value={from} max={to}
                 onChange={e => setFrom(e.target.value)} className="h-9 text-sm w-36" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={to} min={from} max={todayStr()}
                 onChange={e => setTo(e.target.value)} className="h-9 text-sm w-36" />
          <Button variant="outline" size="sm" onClick={load} className="gap-2 h-9">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="gap-2 h-9"
                  onClick={tab === 'items' ? exportItems : exportMoves}
                  disabled={tab === 'items' ? !filtered.length : !filteredMoves.length}>
            <Download className="w-4 h-4" /> {tab === 'items' ? 'Reconciliation CSV' : 'Movements CSV'}
          </Button>
        </div>
        )}
      />

      {isOpen && error && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">The stock report didn't load</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {isOpen && loading && !data && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {isOpen && data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map(c => (
              <div key={c.label} className="border border-border rounded-xl p-3 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${c.bg}`}><c.icon className={`w-5 h-5 ${c.color}`} /></div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="text-lg font-bold truncate">{c.value}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-md border border-input overflow-hidden h-9">
              {[['items', 'Reconciliation'], ['movements', `Movements (${movements.length})`]].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)}
                        className={cn("px-3 text-sm", tab === k ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>
                  {l}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)}
                     placeholder="Item or SKU" className="h-9 text-sm pl-8 w-44" />
            </div>
            {tab === 'items' ? (
              <>
                <select value={category} onChange={e => setCategory(e.target.value)} className={selectCls}>
                  <option value="">All categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={onlyMismatches} onChange={e => setOnlyMismatches(e.target.checked)} />
                  Mismatches only
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />
                  Active items only
                </label>
              </>
            ) : (
              <select value={moveType} onChange={e => setMoveType(e.target.value)} className={selectCls}>
                <option value="">All movement types</option>
                {moveTypes.map(t => <option key={t} value={t}>{moveLabel(t)}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={hideTest} onChange={e => setHideTest(e.target.checked)} />
              Hide TEST / sample items
            </label>
          </div>

          {tab === 'items' ? (
            filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {items.length ? 'Nothing matches those filters' : 'No stock activity in this period'}
              </p>
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 font-medium text-left">Item</th>
                      <th className={th}>Opening</th>
                      <th className={th}>Received</th>
                      <th className={th} title="Moved between shop front and warehouse (net)">Warehouse ⇄ front</th>
                      <th className={th} title="Transfers out + stock-take corrections">Out / adj.</th>
                      <th className={th}>Sold (stock)</th>
                      <th className={th}>Closing</th>
                      <th className={th}>Warehouse</th>
                      <th className={cn(th, "border-l border-border pl-3")}>Units sold</th>
                      <th className={th} title="Units × list price">Expected</th>
                      <th className={th}>Actual</th>
                      <th className="py-2 font-medium text-left pl-3">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((i, idx) => {
                      const sd = n(i.stock_diff);
                      const rd = n(i.revenue_diff);
                      const whNet = n(i.from_warehouse) - n(i.to_warehouse);
                      const outAdj = -n(i.transfer_out) + n(i.adjustments);
                      return (
                        <tr key={(i.product_id || i.name) + idx}
                            className={cn("border-b border-border/40 last:border-0", sd !== 0 && "bg-red-500/5")}>
                          <td className="py-2">
                            <span className="font-medium">{i.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {i.category}{i.sku ? ` · ${i.sku}` : ''}
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums">{qty(i.opening_front)}</td>
                          <td className="py-2 text-right tabular-nums">{n(i.received) ? signed(i.received) : '—'}</td>
                          <td className="py-2 text-right tabular-nums">{whNet ? signed(whNet) : '—'}</td>
                          <td className="py-2 text-right tabular-nums">{outAdj ? signed(outAdj) : '—'}</td>
                          <td className="py-2 text-right tabular-nums">{n(i.ledger_sold) ? '-' + qty(i.ledger_sold) : '—'}</td>
                          <td className="py-2 text-right tabular-nums font-semibold">{qty(i.closing_front)}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{qty(i.closing_wh)}</td>
                          <td className="py-2 text-right tabular-nums border-l border-border pl-3">{n(i.units_sold) ? qty(i.units_sold) : '—'}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{n(i.expected_revenue) ? money(i.expected_revenue) : '—'}</td>
                          <td className="py-2 text-right tabular-nums font-semibold">{n(i.actual_revenue) ? money(i.actual_revenue) : '—'}</td>
                          <td className="py-2 pl-3 text-xs whitespace-nowrap">
                            {sd !== 0 ? (
                              <span className="text-red-500 font-medium">
                                {sd > 0
                                  ? `Sold ${qty(sd)} more than stock deducted`
                                  : `Stock fell ${qty(-sd)} more than sold`}
                              </span>
                            ) : rd < -0.005 ? (
                              <span className="text-amber-600">Discount {money(-rd)}</span>
                            ) : rd > 0.005 ? (
                              <span className="text-amber-600">Over list {money(rd)}</span>
                            ) : n(i.units_sold) ? (
                              <span className="text-green-600">Matches</span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-bold">
                      <td className="py-2">Total ({filtered.length})</td>
                      <td className="py-2 text-right tabular-nums">{qty(sum('opening_front'))}</td>
                      <td className="py-2 text-right tabular-nums">{signed(sum('received'))}</td>
                      <td className="py-2 text-right tabular-nums">{signed(sum('from_warehouse') - sum('to_warehouse'))}</td>
                      <td className="py-2 text-right tabular-nums">{signed(-sum('transfer_out') + sum('adjustments'))}</td>
                      <td className="py-2 text-right tabular-nums">-{qty(sum('ledger_sold'))}</td>
                      <td className="py-2 text-right tabular-nums">{qty(frontClosing)}</td>
                      <td className="py-2 text-right tabular-nums">{qty(whClosing)}</td>
                      <td className="py-2 text-right tabular-nums border-l border-border pl-3">{qty(unitsSold)}</td>
                      <td className="py-2 text-right tabular-nums">{money(expectedRev)}</td>
                      <td className="py-2 text-right tabular-nums">{money(actualRev)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          ) : (
            filteredMoves.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No movements match</p>
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 font-medium text-left">Time</th>
                      <th className="py-2 font-medium text-left">Product</th>
                      <th className="py-2 font-medium text-left">Type</th>
                      <th className={th}>Shop front</th>
                      <th className={th}>Warehouse</th>
                      <th className="py-2 font-medium text-left pl-3">Reason</th>
                      <th className="py-2 font-medium text-left">User</th>
                      {!storeId && <th className="py-2 font-medium text-left">Store</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMoves.map((m, idx) => (
                      <tr key={idx} className="border-b border-border/40 last:border-0">
                        <td className="py-2 whitespace-nowrap text-muted-foreground">{m.time}</td>
                        <td className="py-2 font-medium">{m.product}</td>
                        <td className="py-2 whitespace-nowrap">{moveLabel(m.type)}</td>
                        <td className={cn("py-2 text-right tabular-nums", n(m.front_change) < 0 && "text-red-500")}>
                          {n(m.front_change) ? signed(m.front_change) : '—'}
                        </td>
                        <td className={cn("py-2 text-right tabular-nums", n(m.wh_change) < 0 && "text-red-500")}>
                          {n(m.wh_change) ? signed(m.wh_change) : '—'}
                        </td>
                        <td className="py-2 pl-3 text-muted-foreground max-w-[260px] truncate" title={m.reason}>{m.reason}</td>
                        <td className="py-2 text-muted-foreground whitespace-nowrap">{m.user}</td>
                        {!storeId && <td className="py-2 text-muted-foreground whitespace-nowrap">{m.store}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {movements.length >= 3000 && (
                  <p className="text-xs text-muted-foreground pt-2">
                    Showing the latest 3000 movements — narrow the date range to see older ones.
                  </p>
                )}
              </div>
            )
          )}

          <p className="text-xs text-muted-foreground">
            Opening and closing are rebuilt from today's stock by reversing the movement log, so they are only as
            reliable as the log. "Sold (stock)" is what the till deducted; "Units sold" is what the orders say —
            when they differ, something changed stock outside a normal sale.
          </p>
        </>
      )}
    </div>
  );
}
