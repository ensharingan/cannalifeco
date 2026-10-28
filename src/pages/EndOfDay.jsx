import { useState, useEffect, useMemo } from "react";
import { supabase } from '@/api/supabaseClient';
import {
  Printer, Download, RefreshCw, Store as StoreIcon, AlertTriangle,
  ShoppingCart, Banknote, Wallet, TrendingUp, Search, ChevronsDownUp, ChevronsUpDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "../lib/currency";
import { cn } from "@/lib/utils";
import { useCompany } from "../lib/CompanyContext";
import StockReconciliation from "../components/eod/StockReconciliation";
import { SectionsCtx, SectionHeader, useSection, useSectionsState } from "../components/eod/sections";

// ── helpers ──────────────────────────────────────────────────────────────────
const todayStr = () => {
  // Local (SAST) calendar date, not UTC — new Date().toISOString() rolls over
  // at 02:00 local and would show "tomorrow" for a late-night cash-up.
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().split('T')[0];
};

const n = (v) => (typeof v === 'number' ? v : Number(v || 0));
const money = (v) => formatCurrency(n(v));

const prettyMethod = (m) => {
  const map = {
    cash: 'Cash', card: 'Card', eft: 'EFT', mobile: 'Mobile',
    account: 'On account', credit: 'Store credit', split: 'Split',
    unknown: 'Unspecified'
  };
  return map[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Unspecified');
};

const prettyDate = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-ZA', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
};

function toCSV(rows, headers) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(h => esc(h.label)).join(',')];
  for (const r of rows) lines.push(headers.map(h => esc(h.get(r))).join(','));
  return lines.join('\n');
}

function downloadCSV(filename, csv) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// ─────────────────────────────────────────────────────────────────────────────

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #z-print, #z-print * { visibility: visible !important; }
  #z-print {
    position: absolute; left: 0; top: 0; width: 100%;
    padding: 0; margin: 0; color: #000; background: #fff;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
  }
  #z-print table { width: 100%; border-collapse: collapse; }
  #z-print th, #z-print td { padding: 2px 0; }
  #z-print .z-rule { border-top: 1px dashed #000; margin: 6px 0; }
  #z-print .z-solid { border-top: 2px solid #000; margin: 6px 0; }
  .no-print { display: none !important; }
  @page { margin: 12mm; }
}
`;

function Row({ label, value, bold, muted, negative }) {
  return (
    <div className={cn("flex justify-between gap-4 py-1.5 text-sm",
      bold && "font-bold text-base")}>
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={cn("tabular-nums",
        negative && "text-red-500",
        bold && !negative && "text-foreground")}>{value}</span>
    </div>
  );
}

function Panel({ id, title, right, children, className }) {
  const { isOpen } = useSection(id);
  return (
    <div className={cn("bg-card border border-border rounded-xl p-5", className)}>
      <div className={isOpen ? "mb-3" : ""}>
        <SectionHeader id={id} title={title} right={right} />
      </div>
      {isOpen && children}
    </div>
  );
}

export default function EndOfDay() {
  const { companyId } = useCompany();
  const [date, setDate] = useState(todayStr());
  const [storeId, setStoreId] = useState('');       // '' = all stores
  const [stores, setStores] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [itemSearch, setItemSearch] = useState('');
  const sections = useSectionsState();
  const anySectionOpen = Object.values(sections.open).some(Boolean);

  // Store list for the picker. Single-store clubs simply get an empty list and
  // the picker stays hidden.
  useEffect(() => {
    if (!companyId) return;
    supabase
      .from('stores')
      .select('id, name, is_active')
      .eq('company_id', companyId)
      .order('name')
      .then(({ data, error }) => {
        if (error) { console.error('Failed to load stores:', error); return; }
        setStores((data || []).filter(s => s.is_active !== false));
      });
  }, [companyId]);

  const load = () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    supabase
      .rpc('report_end_of_day', {
        p_date: date,
        p_store: storeId || null,
        p_company: companyId
      })
      .then(({ data, error }) => {
        if (error) throw error;
        setReport(data);
      })
      .catch((err) => {
        console.error('End of day report failed:', err);
        setError(err.message || 'Could not build the report.');
        setReport(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [companyId, date, storeId]);

  const totals    = report?.totals || {};
  const drawer    = report?.cash_drawer || {};
  const payments  = report?.payments || [];
  const tabs      = report?.tab_payments || [];
  const sessions  = report?.sessions || [];
  const items     = report?.items || [];
  const categories= report?.categories || [];
  const byStore   = report?.by_store || [];
  const cashOuts  = report?.cash_outs || [];
  const expenses  = report?.expenses || [];

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.sku || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q)
    );
  }, [items, itemSearch]);

  const unitsSold = items.reduce((s, i) => s + n(i.qty), 0);
  const gramsSold = items.reduce((s, i) => s + n(i.grams), 0);
  const totalProfit = items.reduce((s, i) => s + n(i.profit), 0);
  const expenseTotal = expenses.reduce((s, e) => s + n(e.amount), 0);

  const varianceKnown = drawer.variance !== null && drawer.variance !== undefined;
  const variance = n(drawer.variance);

  const exportItems = () => {
    downloadCSV(
      `z-report-items-${date}${storeId ? '-store' : ''}.csv`,
      toCSV(items, [
        { label: 'Item',     get: r => r.name },
        { label: 'SKU',      get: r => r.sku || '' },
        { label: 'Category', get: r => r.category },
        { label: 'Qty',      get: r => r.qty },
        { label: 'Grams',    get: r => r.grams },
        { label: 'Revenue',  get: r => r.revenue },
        { label: 'Cost',     get: r => r.cogs },
        { label: 'Profit',   get: r => r.profit },
        { label: 'Margin %', get: r => r.margin },
      ])
    );
  };

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Loading company…</div>;
  }

  return (
    <SectionsCtx.Provider value={sections}>
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <style>{PRINT_CSS}</style>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3 no-print">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">End of Day</h1>
          <p className="text-sm text-muted-foreground">
            {prettyDate(date)} · {report?.store_name || 'All stores'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={date}
            max={todayStr()}
            onChange={e => setDate(e.target.value)}
            className="h-9 text-sm w-40"
          />
          {stores.length > 1 && (
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All stores</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={() => sections.setAll(!anySectionOpen)}
                  className="gap-2 h-9" title="Show or hide every section">
            {anySectionOpen ? <ChevronsDownUp className="w-4 h-4" /> : <ChevronsUpDown className="w-4 h-4" />}
            {anySectionOpen ? 'Collapse all' : 'Expand all'}
          </Button>
          <Button variant="outline" size="sm" onClick={load} className="gap-2 h-9">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportItems}
                  disabled={!items.length} className="gap-2 h-9">
            <Download className="w-4 h-4" /> Items CSV
          </Button>
          <Button size="sm" onClick={() => window.print()}
                  disabled={!report} className="gap-2 h-9">
            <Printer className="w-4 h-4" /> Print
          </Button>
        </div>
      </div>

      {error && (
        <div className="no-print flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">The report didn't load</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {loading && !report && (
        <div className="flex items-center justify-center py-24 no-print">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {report && (
        <>
          {/* ── Open till warning ──────────────────────────────────────── */}
          {n(drawer.open_sessions) > 0 && (
            <div className="no-print flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">
                  {drawer.open_sessions} till{n(drawer.open_sessions) === 1 ? '' : 's'} still open
                </p>
                <p className="text-sm text-muted-foreground">
                  Sales are counted, but the cash variance below only covers tills that have been cashed up.
                </p>
              </div>
            </div>
          )}

          {/* ── KPIs ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 no-print">
            {[
              { label: "Net sales",  value: money(totals.net_sales),
                icon: Banknote, color: "text-green-500", bg: "bg-green-500/10" },
              { label: "Orders",     value: n(totals.order_count),
                icon: ShoppingCart, color: "text-blue-500", bg: "bg-blue-500/10" },
              { label: "Avg order",  value: money(totals.avg_order),
                icon: TrendingUp, color: "text-primary", bg: "bg-primary/10" },
              { label: "Cash expected", value: money(drawer.expected_cash),
                icon: Wallet, color: "text-amber-500", bg: "bg-amber-500/10" },
            ].map(c => (
              <div key={c.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${c.bg}`}>
                  <c.icon className={`w-5 h-5 ${c.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="text-xl font-bold truncate">{c.value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start no-print">
            {/* ── Sales summary ────────────────────────────────────────── */}
            <Panel id="summary" title="Sales summary">
              <div className="divide-y divide-border/50">
                <Row label="Gross sales" value={money(totals.gross_sales)} />
                <Row label="Discounts" value={'-' + money(totals.discounts)} negative={n(totals.discounts) > 0} />
                <Row label="Net sales" value={money(totals.net_sales)} bold />
                {n(totals.tax) > 0 && <Row label="Tax" value={money(totals.tax)} muted />}
                {n(totals.store_credit_used) > 0 &&
                  <Row label="Store credit used" value={money(totals.store_credit_used)} muted />}
                {n(totals.refund_count) > 0 &&
                  <Row label={`Refunds (${totals.refund_count})`} value={'-' + money(totals.refund_total)} negative />}
                {n(totals.unpaid_count) > 0 &&
                  <Row label={`Unpaid / on account (${totals.unpaid_count})`} value={money(totals.unpaid_total)} muted />}
                <Row label="Orders" value={n(totals.order_count)} muted />
                <Row label="Items sold" value={unitsSold} muted />
                {gramsSold > 0 && <Row label="Grams moved" value={gramsSold.toFixed(2) + ' g'} muted />}
                <Row label="Gross profit" value={money(totalProfit)} />
                {expenseTotal > 0 && <Row label="Expenses logged" value={'-' + money(expenseTotal)} negative />}
              </div>
            </Panel>

            {/* ── Cash up ──────────────────────────────────────────────── */}
            <Panel id="cashup" title="Cash up">
              <div className="divide-y divide-border/50">
                <Row label="Opening float" value={money(drawer.opening_float)} />
                <Row label="Cash sales" value={money(drawer.cash_sales)} />
                {n(drawer.tab_cash) > 0 && <Row label="Tab settlements (cash)" value={money(drawer.tab_cash)} />}
                <Row label="Cash paid out" value={'-' + money(drawer.cash_outs)} negative={n(drawer.cash_outs) > 0} />
                <Row label="Expected in drawer" value={money(drawer.expected_cash)} bold />
                {n(drawer.closed_sessions) > 0 ? (
                  <>
                    <Row label="Counted (cashed-up tills)" value={money(drawer.counted_cash)} />
                    <Row label="Expected (same tills)" value={money(drawer.expected_closed)} muted />
                    <Row
                      label={variance === 0 ? 'Balanced' : variance > 0 ? 'Over' : 'Short'}
                      value={(variance > 0 ? '+' : '') + money(variance)}
                      bold
                      negative={variance < 0}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground py-3">
                    No till has been cashed up for this day yet.
                  </p>
                )}
              </div>
            </Panel>

            {/* ── Payment mix ──────────────────────────────────────────── */}
            <Panel id="payments" title="Payment methods">
              {payments.length === 0
                ? <p className="text-sm text-muted-foreground py-6 text-center">No payments recorded</p>
                : (
                  <div className="space-y-3">
                    {payments.map(p => {
                      const pct = n(totals.net_sales) > 0 ? (n(p.amount) / n(totals.net_sales)) * 100 : 0;
                      return (
                        <div key={p.method} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium">{prettyMethod(p.method)}
                              <span className="text-muted-foreground font-normal"> · {p.count}</span>
                            </span>
                            <span className="text-muted-foreground tabular-nums">
                              {money(p.amount)} ({pct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {tabs.length > 0 && (
                      <div className="pt-3 mt-3 border-t border-border/50">
                        <p className="text-xs text-muted-foreground mb-2">
                          Tab settlements collected today (against earlier orders)
                        </p>
                        {tabs.map(t => (
                          <div key={t.method} className="flex justify-between text-sm py-0.5">
                            <span>{prettyMethod(t.method)} · {t.count}</span>
                            <span className="tabular-nums text-muted-foreground">{money(t.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
            </Panel>

            {/* ── Categories ───────────────────────────────────────────── */}
            <Panel id="categories" title="By category">
              {categories.length === 0
                ? <p className="text-sm text-muted-foreground py-6 text-center">Nothing sold</p>
                : (
                  <div className="divide-y divide-border/50">
                    {categories.map(c => (
                      <Row key={c.category}
                           label={`${c.category} · ${n(c.qty)} sold`}
                           value={money(c.revenue)} />
                    ))}
                  </div>
                )}
            </Panel>
          </div>

          {/* ── Stock vs revenue (owners / managers only) ─────────────── */}
          {!isCashierView && (
            <StockReconciliation companyId={companyId} storeId={storeId} date={date} />
          )}

          {/* ── Per store ─────────────────────────────────────────────── */}
          {!storeId && byStore.length > 1 && (
            <Panel id="stores" title="By store" className="no-print">
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 font-medium">Store</th>
                      <th className="py-2 font-medium text-right">Orders</th>
                      <th className="py-2 font-medium text-right">Cash</th>
                      <th className="py-2 font-medium text-right">Card</th>
                      <th className="py-2 font-medium text-right">Net sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byStore.map(s => (
                      <tr key={s.store_id || 'unassigned'}
                          className="border-b border-border/40 last:border-0">
                        <td className="py-2">
                          <button
                            className="flex items-center gap-2 hover:text-primary transition-colors text-left"
                            onClick={() => s.store_id && setStoreId(s.store_id)}
                            disabled={!s.store_id}
                          >
                            <StoreIcon className="w-3.5 h-3.5 shrink-0 opacity-60" />
                            {s.store}
                          </button>
                        </td>
                        <td className="py-2 text-right tabular-nums">{n(s.orders)}</td>
                        <td className="py-2 text-right tabular-nums">{money(s.cash)}</td>
                        <td className="py-2 text-right tabular-nums">{money(s.card)}</td>
                        <td className="py-2 text-right tabular-nums font-semibold">{money(s.net_sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* ── Tills ─────────────────────────────────────────────────── */}
          <Panel id="tills" title="Tills" className="no-print">
            {sessions.length === 0
              ? <p className="text-sm text-muted-foreground py-6 text-center">No till sessions opened on this day</p>
              : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 font-medium">Cashier</th>
                        <th className="py-2 font-medium">Store</th>
                        <th className="py-2 font-medium">Hours</th>
                        <th className="py-2 font-medium text-right">Orders</th>
                        <th className="py-2 font-medium text-right">Sales</th>
                        <th className="py-2 font-medium text-right">Expected</th>
                        <th className="py-2 font-medium text-right">Counted</th>
                        <th className="py-2 font-medium text-right">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map(s => {
                        const v = s.cash_variance;
                        return (
                          <tr key={s.session_id} className="border-b border-border/40 last:border-0">
                            <td className="py-2 font-medium">{s.cashier}</td>
                            <td className="py-2 text-muted-foreground">{s.store}</td>
                            <td className="py-2 text-muted-foreground whitespace-nowrap">
                              {s.opened} – {s.closed || '…'}
                            </td>
                            <td className="py-2 text-right tabular-nums">{n(s.orders)}</td>
                            <td className="py-2 text-right tabular-nums">{money(s.sales)}</td>
                            <td className="py-2 text-right tabular-nums">
                              {s.expected_cash === null || s.expected_cash === undefined ? '—' : money(s.expected_cash)}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {s.cashed_up ? money(s.counted_cash) : '—'}
                            </td>
                            <td className={cn("py-2 text-right tabular-nums font-medium",
                              !s.cashed_up ? "text-muted-foreground"
                                : n(v) < 0 ? "text-red-500"
                                : n(v) > 0 ? "text-amber-500" : "text-green-600")}>
                              {!s.cashed_up ? 'Open' : (n(v) > 0 ? '+' : '') + money(v)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </Panel>

          {/* ── Items sold ────────────────────────────────────────────── */}
          <Panel
            id="items"
            title={`Items sold (${items.length})`}
            className="no-print"
            right={
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  placeholder="Filter items"
                  className="h-8 text-sm pl-8 w-44"
                />
              </div>
            }
          >
            {filteredItems.length === 0
              ? <p className="text-sm text-muted-foreground py-6 text-center">
                  {items.length ? 'Nothing matches that filter' : 'No items sold on this day'}
                </p>
              : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 font-medium">Item</th>
                        <th className="py-2 font-medium">Category</th>
                        <th className="py-2 font-medium text-right">Qty</th>
                        <th className="py-2 font-medium text-right">Grams</th>
                        <th className="py-2 font-medium text-right">Revenue</th>
                        <th className="py-2 font-medium text-right">Profit</th>
                        <th className="py-2 font-medium text-right">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((i, idx) => (
                        <tr key={(i.sku || i.name) + idx} className="border-b border-border/40 last:border-0">
                          <td className="py-2">
                            <span className="font-medium">{i.name}</span>
                            {i.sku && <span className="text-xs text-muted-foreground ml-2">{i.sku}</span>}
                          </td>
                          <td className="py-2 text-muted-foreground">{i.category}</td>
                          <td className="py-2 text-right tabular-nums">{n(i.qty)}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {n(i.grams) > 0 ? n(i.grams).toFixed(2) : '—'}
                          </td>
                          <td className="py-2 text-right tabular-nums font-semibold">{money(i.revenue)}</td>
                          <td className="py-2 text-right tabular-nums">{money(i.profit)}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {n(i.margin).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border font-bold">
                        <td className="py-2" colSpan={2}>Total</td>
                        <td className="py-2 text-right tabular-nums">
                          {filteredItems.reduce((s, i) => s + n(i.qty), 0)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {filteredItems.reduce((s, i) => s + n(i.grams), 0).toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {money(filteredItems.reduce((s, i) => s + n(i.revenue), 0))}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {money(filteredItems.reduce((s, i) => s + n(i.profit), 0))}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
          </Panel>

          {/* ── Cash outs & expenses ──────────────────────────────────── */}
          {(cashOuts.length > 0 || expenses.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 no-print">
              {cashOuts.length > 0 && (
                <Panel id="cashouts" title={`Cash paid out (${cashOuts.length})`}>
                  <div className="divide-y divide-border/50">
                    {cashOuts.map((c, i) => (
                      <Row key={i}
                           label={`${c.time} · ${c.supplier}${c.reason ? ' — ' + c.reason : ''}`}
                           value={money(c.amount)} />
                    ))}
                    <Row label="Total" value={money(drawer.cash_outs)} bold />
                  </div>
                </Panel>
              )}
              {expenses.length > 0 && (
                <Panel id="expenses" title={`Expenses (${expenses.length})`}>
                  <div className="divide-y divide-border/50">
                    {expenses.map((e, i) => (
                      <Row key={i}
                           label={`${e.description}${e.vendor ? ' — ' + e.vendor : ''}`}
                           value={money(e.amount)} />
                    ))}
                    <Row label="Total" value={money(expenseTotal)} bold />
                  </div>
                </Panel>
              )}
            </div>
          )}

          {/* ── Printable till-roll version ───────────────────────────── */}
          <div id="z-print" className="hidden print:block">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>END OF DAY REPORT</div>
              <div>{report.store_name}</div>
              <div>{prettyDate(date)}</div>
              <div style={{ fontSize: '10px' }}>Printed {report.generated_at}</div>
            </div>
            <div className="z-solid" />

            <table>
              <tbody>
                <tr><td>Gross sales</td><td style={{ textAlign: 'right' }}>{money(totals.gross_sales)}</td></tr>
                <tr><td>Discounts</td><td style={{ textAlign: 'right' }}>-{money(totals.discounts)}</td></tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>NET SALES</td><td style={{ textAlign: 'right' }}>{money(totals.net_sales)}</td>
                </tr>
                <tr><td>Orders</td><td style={{ textAlign: 'right' }}>{n(totals.order_count)}</td></tr>
                <tr><td>Avg order</td><td style={{ textAlign: 'right' }}>{money(totals.avg_order)}</td></tr>
                {n(totals.refund_count) > 0 && (
                  <tr><td>Refunds ({totals.refund_count})</td>
                      <td style={{ textAlign: 'right' }}>-{money(totals.refund_total)}</td></tr>
                )}
              </tbody>
            </table>

            <div className="z-rule" />
            <div style={{ fontWeight: 700 }}>PAYMENTS</div>
            <table>
              <tbody>
                {payments.map(p => (
                  <tr key={p.method}>
                    <td>{prettyMethod(p.method)} ({p.count})</td>
                    <td style={{ textAlign: 'right' }}>{money(p.amount)}</td>
                  </tr>
                ))}
                {tabs.map(t => (
                  <tr key={'tab-' + t.method}>
                    <td>Tab {prettyMethod(t.method).toLowerCase()} ({t.count})</td>
                    <td style={{ textAlign: 'right' }}>{money(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="z-rule" />
            <div style={{ fontWeight: 700 }}>CASH UP</div>
            <table>
              <tbody>
                <tr><td>Opening float</td><td style={{ textAlign: 'right' }}>{money(drawer.opening_float)}</td></tr>
                <tr><td>Cash sales</td><td style={{ textAlign: 'right' }}>{money(drawer.cash_sales)}</td></tr>
                {n(drawer.tab_cash) > 0 && (
                  <tr><td>Tab cash</td><td style={{ textAlign: 'right' }}>{money(drawer.tab_cash)}</td></tr>
                )}
                <tr><td>Paid out</td><td style={{ textAlign: 'right' }}>-{money(drawer.cash_outs)}</td></tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>EXPECTED</td><td style={{ textAlign: 'right' }}>{money(drawer.expected_cash)}</td>
                </tr>
                {n(drawer.closed_sessions) > 0 && (
                  <>
                    <tr><td>Counted</td><td style={{ textAlign: 'right' }}>{money(drawer.counted_cash)}</td></tr>
                    <tr style={{ fontWeight: 700 }}>
                      <td>{variance < 0 ? 'SHORT' : variance > 0 ? 'OVER' : 'BALANCED'}</td>
                      <td style={{ textAlign: 'right' }}>{(variance > 0 ? '+' : '') + money(variance)}</td>
                    </tr>
                  </>
                )}
                {n(drawer.open_sessions) > 0 && (
                  <tr><td colSpan={2} style={{ fontSize: '10px' }}>
                    {drawer.open_sessions} till(s) not cashed up
                  </td></tr>
                )}
              </tbody>
            </table>

            {sessions.length > 0 && (
              <>
                <div className="z-rule" />
                <div style={{ fontWeight: 700 }}>TILLS</div>
                <table>
                  <tbody>
                    {sessions.map(s => (
                      <tr key={'p' + s.session_id}>
                        <td>{s.cashier} · {s.store} · {s.opened}-{s.closed || 'open'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {money(s.sales)}
                          {s.cashed_up ? ` (${n(s.cash_variance) > 0 ? '+' : ''}${money(s.cash_variance)})` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {!storeId && byStore.length > 1 && (
              <>
                <div className="z-rule" />
                <div style={{ fontWeight: 700 }}>BY STORE</div>
                <table>
                  <tbody>
                    {byStore.map(s => (
                      <tr key={'ps' + (s.store_id || 'u')}>
                        <td>{s.store} ({n(s.orders)})</td>
                        <td style={{ textAlign: 'right' }}>{money(s.net_sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <div className="z-rule" />
            <div style={{ fontWeight: 700 }}>ITEMS SOLD</div>
            <table>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={'pi' + idx}>
                    <td>{n(i.qty)} × {i.name}</td>
                    <td style={{ textAlign: 'right' }}>{money(i.revenue)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td>TOTAL {unitsSold} items</td>
                  <td style={{ textAlign: 'right' }}>
                    {money(items.reduce((s, i) => s + n(i.revenue), 0))}
                  </td>
                </tr>
                {gramsSold > 0 && (
                  <tr><td>Grams moved</td>
                      <td style={{ textAlign: 'right' }}>{gramsSold.toFixed(2)} g</td></tr>
                )}
              </tbody>
            </table>

            {cashOuts.length > 0 && (
              <>
                <div className="z-rule" />
                <div style={{ fontWeight: 700 }}>PAID OUT</div>
                <table>
                  <tbody>
                    {cashOuts.map((c, i) => (
                      <tr key={'pc' + i}>
                        <td>{c.time} {c.supplier}</td>
                        <td style={{ textAlign: 'right' }}>{money(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <div className="z-solid" />
            <div style={{ textAlign: 'center', fontSize: '10px' }}>
              <div>Cashier signature ______________________</div>
              <div style={{ marginTop: '10px' }}>Manager signature ______________________</div>
              <div style={{ marginTop: '10px' }}>Canna Life Co</div>
            </div>
          </div>
        </>
      )}
    </div>
    </SectionsCtx.Provider>
  );
}
