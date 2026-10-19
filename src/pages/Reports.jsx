import { useState, useEffect } from "react";
import { supabase } from '@/api/supabaseClient';
import { Calendar, TrendingUp, ShoppingCart, DollarSign, Download } from "lucide-react";
import { exportReportsPDF } from "../lib/pdfExport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { formatCurrency } from "../lib/currency";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from "recharts";
import { cn } from "@/lib/utils";
import { useCompany } from "../lib/CompanyContext";

// ── Date helpers (no moment) ──────────────────────────────────────────────────
const isSameDay = (a, b) => a.toDateString() === b.toDateString();
const isSameMonth = (a, b) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
const isBetween = (d, start, end) => d >= start && d <= end;
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
// Step whole months WITHOUT day-of-month overflow. The old version did
// setMonth(getMonth() + n) on the current date, so on the 31st, stepping back
// one month produced "31 September", which JavaScript rolls forward into
// October. On the last three days of a long month the 12-month chart therefore
// showed duplicate months and dropped others entirely. Anchoring to the 1st
// removes the overflow. Run on the 31st, this is the difference between
// Oct/Oct/Dec/Dec and a clean Sep/Oct/Nov/Dec.
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const startOfDay = (d) => { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; };
const endOfDay = (d) => { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; };
const startOfWeek = (d) => {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() - day + (day === 0 ? -6 : 1));
  r.setHours(0, 0, 0, 0);
  return r;
};
const endOfWeek = (d) => {
  const r = startOfWeek(d);
  r.setDate(r.getDate() + 6);
  r.setHours(23, 59, 59, 999);
  return r;
};
const getISOWeek = (d) => {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

// Whole calendar days between two dates.
//
// This used to be called with an end of 23:59:59, which is 6.99997 days for a
// 7-day range. Math.round pushed that to 7, then the caller added 1, so a
// Mon–Sun range built EIGHT day buckets and the KPI cards silently counted an
// extra day of trade. Both ends are now normalised to midnight before the
// subtraction, so the arithmetic can't drift.
const diffDays = (start, end) => Math.round((startOfDay(end) - startOfDay(start)) / 86400000);

const fmtDDMMM = (d) => d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
const fmtMMMYY = (d) => d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
const todayStr = () => new Date().toISOString().split('T')[0];
// ─────────────────────────────────────────────────────────────────────────────

// Robustly parse orders.items — JSONB can arrive as an object, a JSON string,
// or (occasionally) a double-encoded string. Never throw on bad data.
function parseItems(items) {
  if (!items) return [];
  if (typeof items === 'string') {
    try { return JSON.parse(items); } catch { return []; }
  }
  return Array.isArray(items) ? items : [];
}

// Fetch EVERY matching row, paging past PostgREST's 1000-row-per-request cap.
// The old code used entities.Order.filter(..., 1000), which silently kept only
// the most-recent 1000 rows — pinning the order counter and dropping the oldest
// orders from any historical range. Pagination pulls the full set.
async function fetchAllRows(table, companyId) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  // Hard ceiling as a safety valve (50k rows) so a runaway loop can't hang the page.
  while (from < 50000) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

const TABS = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "range", label: "Date Range" },
];

// How many day buckets the chart will draw before it stops. The KPI totals are
// no longer derived from these buckets, so a range longer than this renders a
// truncated chart but still reports correct totals.
const MAX_DAY_BUCKETS = 90;

export default function Reports() {
  const { companyId, activeStoreId } = useCompany();
  const [stores, setStores] = useState([]);
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("daily");
  const [rangeStart, setRangeStart] = useState(todayStr());
  const [rangeEnd, setRangeEnd] = useState(todayStr());
  // 'all' or a store id. Seeded from the sidebar's active store so the page
  // opens on whatever the user was already looking at, but switchable here —
  // the sidebar has no "All Stores" entry, and a report needs one.
  const [storeFilter, setStoreFilter] = useState(activeStoreId || 'all');

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([
      fetchAllRows('orders', companyId),
      fetchAllRows('expenses', companyId),
      supabase.from('stores').select('id, name, is_active').eq('company_id', companyId).limit(100),
    ])
      .then(([o, e, st]) => {
        setOrders(o);
        setExpenses(e);
        setStores(((st && st.data) || []).filter(x => x.is_active !== false));
      })
      .catch((err) => { console.error('Failed to load report data:', err); })
      .finally(() => setLoading(false));
  }, [companyId]);

  // Reports used to total the whole company regardless of the sidebar store
  // picker, so a multi-store club saw combined figures here but per-store
  // figures on Sales. It now follows the same picker as every other page.
  //
  // No store selected means All Stores. Rows with a null store_id are legacy
  // (recorded before store tracking) and are only ever counted in the All
  // Stores view, so they can't silently vanish from the company total.
  const inScope = (row) => storeFilter === 'all' || row.store_id === storeFilter;

  const scopedOrders = orders.filter(inScope);
  const scopedExpenses = expenses.filter(inScope);

  const activeStoreName = storeFilter === 'all'
    ? 'All Stores'
    : ((stores.find(s => s.id === storeFilter) || {}).name || 'Selected store');

  const completed = scopedOrders.filter(o => o.status === "completed");

  // One window, defined once, used by the KPI cards, the charts, the payment
  // breakdown, the top products table and the PDF export. Previously the cards
  // read the chart buckets while everything else read a separately-computed
  // window, so the same page could show two different totals for one period.
  const { periodStart, periodEnd, periodLabel } = (() => {
    const today = new Date();

    if (tab === "daily") {
      return {
        periodStart: startOfDay(addDays(today, -13)),
        periodEnd: endOfDay(today),
        periodLabel: "Last 14 Days",
      };
    }

    if (tab === "weekly") {
      return {
        periodStart: startOfWeek(addDays(today, -11 * 7)),
        periodEnd: endOfWeek(today),
        periodLabel: "Last 12 Weeks",
      };
    }

    if (tab === "monthly") {
      const first = addMonths(today, -11);
      first.setDate(1);
      return {
        periodStart: startOfDay(first),
        periodEnd: endOfDay(today),
        periodLabel: "Last 12 Months",
      };
    }

    return {
      periodStart: new Date(rangeStart + 'T00:00:00'),
      periodEnd: new Date(rangeEnd + 'T23:59:59'),
      periodLabel: `${rangeStart} → ${rangeEnd}`,
    };
  })();

  // Expenses carry their own `date` (when the cost was actually incurred) —
  // separate from `created_at` (when someone got around to logging it, often
  // days later). Orders don't have this split: created_at is the sale itself.
  // Bucketing expenses by created_at silently misattributed them to whatever
  // day they were typed in, breaking day-by-day P&L.
  const expenseDate = (e) => new Date((e.date || e.created_at) + (e.date ? 'T00:00:00' : ''));

  const filteredOrders = completed.filter(o => isBetween(new Date(o.created_at), periodStart, periodEnd));
  const filteredExpenses = scopedExpenses.filter(e => isBetween(expenseDate(e), periodStart, periodEnd));

  // Chart buckets. Display only — the totals below never read these.
  const chartData = (() => {
    if (tab === "weekly") {
      return Array.from({ length: 12 }, (_, i) => {
        const weekStart = startOfWeek(addDays(new Date(), -(11 - i) * 7));
        const weekEnd = endOfWeek(weekStart);
        const inWeek = (d) => isBetween(new Date(d.created_at), weekStart, weekEnd);
        const ords = completed.filter(inWeek);
        return {
          name: `W${getISOWeek(weekStart)}`,
          revenue: ords.reduce((s, o) => s + (o.total_amount || 0), 0),
          expenses: scopedExpenses.filter(e => isBetween(expenseDate(e), weekStart, weekEnd)).reduce((s, e) => s + (e.amount || 0), 0),
          orders: ords.length,
        };
      });
    }

    if (tab === "monthly") {
      return Array.from({ length: 12 }, (_, i) => {
        const m = addMonths(new Date(), -(11 - i));
        const inMonth = (d) => isSameMonth(new Date(d.created_at), m);
        const ords = completed.filter(inMonth);
        return {
          name: fmtMMMYY(m),
          revenue: ords.reduce((s, o) => s + (o.total_amount || 0), 0),
          expenses: scopedExpenses.filter(e => isSameMonth(expenseDate(e), m)).reduce((s, e) => s + (e.amount || 0), 0),
          orders: ords.length,
        };
      });
    }

    // daily and range both bucket by calendar day across the period.
    const dayCount = Math.min(Math.max(diffDays(periodStart, periodEnd) + 1, 1), MAX_DAY_BUCKETS);
    return Array.from({ length: dayCount }, (_, i) => {
      const d = startOfDay(addDays(periodStart, i));
      const onDay = (row) => isSameDay(new Date(row.created_at), d);
      const ords = completed.filter(onDay);
      return {
        name: fmtDDMMM(d),
        revenue: ords.reduce((s, o) => s + (o.total_amount || 0), 0),
        expenses: scopedExpenses.filter(e => isSameDay(expenseDate(e), d)).reduce((s, e) => s + (e.amount || 0), 0),
        orders: ords.length,
      };
    });
  })();

  // Totals come straight from the filtered rows, so they stay correct even when
  // the chart truncates a long range.
  const totalRevenue = filteredOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
  const totalExpenses = filteredExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalOrders = filteredOrders.length;
  const netProfit = totalRevenue - totalExpenses;
  const avgOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const productMap = {};
  for (const order of filteredOrders) {
    const parsed = parseItems(order.items);
    for (const item of parsed) {
      if (!item || !item.name) continue;
      if (!productMap[item.name]) productMap[item.name] = { qty: 0, revenue: 0 };
      productMap[item.name].qty += (item.quantity || 0);
      productMap[item.name].revenue += (item.price || 0) * (item.quantity || 0);
    }
  }
  const topProducts = Object.entries(productMap)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 8)
    .map(([name, v]) => ({ name, ...v }));

  // Payment method breakdown
  const paymentBreakdown = {};
  for (const o of filteredOrders) {
    const m = o.payment_method || "other";
    paymentBreakdown[m] = (paymentBreakdown[m] || 0) + (o.total_amount || 0);
  }

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">{periodLabel} · {activeStoreName}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => exportReportsPDF({ periodLabel: `${periodLabel} · ${activeStoreName}`, totalRevenue, totalExpenses, netProfit, totalOrders, avgOrder, topProducts, paymentBreakdown, chartData })}
          className="gap-2"
        >
          <Download className="w-4 h-4" /> Export PDF
        </Button>
      </div>

      {/* Period tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}>{t.label}</button>
        ))}
        {stores.length > 1 && (
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="h-9 w-52 ml-auto">
              <SelectValue placeholder="All Stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores.map(st => (
                <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {tab === "range" && (
          <div className="flex items-center gap-2 ml-2">
            <Input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} className="h-9 text-sm w-36" />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} className="h-9 text-sm w-36" />
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Revenue", value: formatCurrency(totalRevenue), icon: DollarSign, color: "text-green-500", bg: "bg-green-500/10" },
          { label: "Expenses", value: formatCurrency(totalExpenses), icon: TrendingUp, color: "text-red-500", bg: "bg-red-500/10" },
          { label: "Net Profit", value: formatCurrency(netProfit), icon: TrendingUp, color: netProfit >= 0 ? "text-primary" : "text-red-500", bg: "bg-primary/10" },
          { label: "Orders", value: totalOrders, icon: ShoppingCart, color: "text-blue-500", bg: "bg-blue-500/10" },
        ].map(c => (
          <div key={c.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg ${c.bg}`}><c.icon className={`w-5 h-5 ${c.color}`} /></div>
            <div>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-xl font-bold">{c.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Revenue vs Expenses chart */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold mb-4">Revenue &amp; Expenses — {periodLabel}</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Bar dataKey="revenue" name="Revenue" fill="hsl(152, 55%, 28%)" radius={[4,4,0,0]} />
              <Bar dataKey="expenses" name="Expenses" fill="hsl(0, 72%, 51%)" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Orders trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold mb-4">Order Trends</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
                <Line type="monotone" dataKey="orders" name="Orders" stroke="hsl(200, 70%, 50%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold mb-4">Payment Methods</h3>
          <div className="space-y-3 mt-2">
            {Object.entries(paymentBreakdown).length === 0
              ? <p className="text-sm text-muted-foreground text-center py-8">No data</p>
              : Object.entries(paymentBreakdown).sort((a,b) => b[1]-a[1]).map(([method, amt]) => {
                const pct = totalRevenue > 0 ? (amt / totalRevenue) * 100 : 0;
                return (
                  <div key={method} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="capitalize font-medium">{method}</span>
                      <span className="text-muted-foreground">{formatCurrency(amt)} ({pct.toFixed(1)}%)</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Top products */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold mb-4">Top Products by Revenue</h3>
        {topProducts.length === 0
          ? <p className="text-sm text-muted-foreground text-center py-8">No sales data</p>
          : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
                <Bar dataKey="revenue" name="Revenue" fill="hsl(152, 55%, 28%)" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* P&L Summary */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold mb-4">P&amp;L Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Gross Revenue</span>
            <span className="font-semibold text-green-600">{formatCurrency(totalRevenue)}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Total Expenses</span>
            <span className="font-semibold text-red-500">-{formatCurrency(totalExpenses)}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Avg Order Value</span>
            <span className="font-semibold">{formatCurrency(avgOrder)}</span>
          </div>
          <div className="flex justify-between py-2 font-bold text-base">
            <span>Net Profit</span>
            <span className={netProfit >= 0 ? "text-green-600" : "text-red-500"}>{formatCurrency(netProfit)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
