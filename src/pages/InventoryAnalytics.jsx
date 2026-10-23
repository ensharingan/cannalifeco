import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "../lib/CompanyContext";
import { exportInventoryPDF } from "../lib/pdfExport";
import { forecastProduct, buildForecastChart } from "../lib/forecasting";
import { formatCurrency } from "../lib/currency";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, Legend, CartesianGrid, ReferenceLine
} from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, Clock, Package, ShoppingCart, RefreshCw, ArrowUpRight, Download, Send, Zap,
  Activity, Layers, ShieldAlert, Boxes
} from "lucide-react";
import { cn } from "@/lib/utils";

// Fetch EVERY matching row, paging past PostgREST's 1000-row-per-request cap.
// makeQuery(from, to) must return a query that already has .range(from, to) applied.
async function fetchAllPaged(makeQuery) {
  var PAGE = 1000;
  var all = [];
  var from = 0;
  while (from < 100000) {
    var res = await makeQuery(from, from + PAGE - 1);
    if (res.error) throw res.error;
    var data = res.data || [];
    if (data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Strain display helpers — kept identical to Inventory.jsx so a product reads
// the same wherever it appears in the app.
function formatStrain(value) {
  if (!value) return "";
  var v = String(value).trim();
  if (!v) return "";
  if (v.toLowerCase() === "cbd") return "CBD";
  if (v.toLowerCase() === "n/a") return "N/A";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

function strainClasses(value) {
  var v = value ? String(value).toLowerCase() : "";
  if (v === "indica") return "bg-purple-500/10 text-purple-400";
  if (v === "sativa") return "bg-orange-500/10 text-orange-400";
  if (v === "hybrid") return "bg-green-500/10 text-green-400";
  if (v === "cbd") return "bg-blue-500/10 text-blue-400";
  return "bg-muted text-muted-foreground";
}

// "flower · Indica" style subtitle used under product names.
function categoryStrainLabel(p) {
  var parts = [];
  if (p.category) parts.push(p.category.replace(/_/g, " "));
  var s = formatStrain(p.strain_type);
  if (s) parts.push(s);
  return parts.join(" · ");
}

function StrainBadge({ value }) {
  var label = formatStrain(value);
  if (!label) return null;
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap", strainClasses(value))}>
      {label}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, color = "primary" }) {
  const colors = {
    primary: "text-primary bg-primary/10",
    yellow: "text-yellow-500 bg-yellow-500/10",
    red: "text-red-500 bg-red-500/10",
    green: "text-green-500 bg-green-500/10",
    orange: "text-orange-500 bg-orange-500/10",
  };
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex gap-4 items-start">
      <div className={cn("p-2.5 rounded-lg", colors[color])}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function InventoryAnalytics() {
  const { companyId, activeStoreId, stores: ctxStores } = useCompany();
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingPO, setSendingPO] = useState(false);
  const [poSent, setPoSent] = useState(false);
  const [horizon, setHorizon] = useState(30); // forecast window: 30 / 60 / 90 days
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("demand");
  const [showAllRows, setShowAllRows] = useState(false);

  // ── Load products (per-store stock), orders, suppliers ──
  //
  // Stock is read from store_inventory, the source of truth for per-store stock,
  // NOT products.stock_quantity (which is a company-wide legacy column). When a
  // store is selected, each product's stock_quantity is overridden with that
  // store's store_inventory row; when "All Stores" is active, quantities are
  // summed across every store. Orders are scoped to the store too, so the
  // sales-based forecasts and turnover match the store you're viewing.
  //
  // activeStoreId is in the dependency list, so switching stores refetches.
  const load = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    try {
      var results = await Promise.all([
        // Base product catalogue (company-wide metadata, incl. strain_type)
        fetchAllPaged(function (a, b) {
          return supabase
            .from("products")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .range(a, b);
        }),
        // Per-store stock rows
        fetchAllPaged(function (a, b) {
          var q = supabase
            .from("store_inventory")
            .select("*")
            .eq("company_id", companyId)
            .order("product_id", { ascending: true })
            .range(a, b);
          if (activeStoreId) q = q.eq("store_id", activeStoreId);
          return q;
        }),
        // Completed orders, scoped to the store (legacy null-store orders kept visible)
        fetchAllPaged(function (a, b) {
          var q = supabase
            .from("orders")
            .select("*")
            .eq("company_id", companyId)
            .eq("status", "completed")
            .order("created_at", { ascending: false })
            .range(a, b);
          if (activeStoreId) q = q.or("store_id.eq." + activeStoreId + ",store_id.is.null");
          return q;
        }),
        // Suppliers
        supabase.from("suppliers").select("*").eq("company_id", companyId).then(function (r) { return { data: r.data || [], error: r.error }; }),
      ]);

      var rawProducts = results[0] || [];
      var invRows = results[1] || [];
      var completedOrders = results[2] || [];
      var supplierList = (results[3] && results[3].data) || [];

      // Build a per-product stock map from store_inventory. With a store selected,
      // invRows are already filtered to that store; with "All Stores", they span
      // every store and we sum them.
      var stockByProduct = {};
      var thresholdByProduct = {};
      for (var i = 0; i < invRows.length; i++) {
        var pid = invRows[i].product_id;
        stockByProduct[pid] = (stockByProduct[pid] || 0) + (invRows[i].stock_quantity || 0);
        // Keep the tightest (lowest) low-stock threshold seen for this product.
        if (invRows[i].low_stock_threshold != null) {
          if (thresholdByProduct[pid] == null || invRows[i].low_stock_threshold < thresholdByProduct[pid]) {
            thresholdByProduct[pid] = invRows[i].low_stock_threshold;
          }
        }
      }

      // Overlay per-store stock onto each product. A product with no store_inventory
      // row for the selected store shows 0 (it isn't stocked there).
      var merged = rawProducts.map(function (p) {
        var storeStock = stockByProduct[p.id];
        return {
          ...p,
          stock_quantity: storeStock != null ? storeStock : 0,
          low_stock_threshold: thresholdByProduct[p.id] != null ? thresholdByProduct[p.id] : (p.low_stock_threshold || 5),
        };
      });

      setProducts(merged);
      setOrders(completedOrders);
      setSuppliers(supplierList);
    } catch (err) {
      console.error("Inventory Analytics load error:", err);
    } finally {
      setLoading(false);
    }
  }, [companyId, activeStoreId]);

  useEffect(function () { load(); }, [load]);

  // Name of the store currently in view (for the subtitle)
  var activeStoreName = activeStoreId && ctxStores
    ? (ctxStores.find(function (s) { return s.id === activeStoreId; }) || {}).name
    : null;

  // --- compute sales per product from orders ---
  const salesMap = {};
  const revenueMap = {};
  const salesByDay = {}; // productId -> { date -> qty }

  orders.forEach(order => {
    let items = [];
    try { items = typeof order.items === "string" ? JSON.parse(order.items || "[]") : (order.items || []); } catch (_) {}
    const day = order.created_at?.slice(0, 10);
    items.forEach(item => {
      const pid = item.product_id;
      salesMap[pid] = (salesMap[pid] || 0) + (item.quantity || 0);
      revenueMap[pid] = (revenueMap[pid] || 0) + ((item.quantity || 0) * (item.price || 0));
      if (day) {
        if (!salesByDay[pid]) salesByDay[pid] = {};
        salesByDay[pid][day] = (salesByDay[pid][day] || 0) + (item.quantity || 0);
      }
    });
  });

  // Enriched products with regression-based forecasting
  const enriched = products.map(p => {
    const sold = salesMap[p.id] || 0;
    const current = p.stock_quantity || 0;
    const avgStock = sold + current > 0 ? (sold + current) / 2 : 1;
    const turnover = sold / avgStock;
    const revenue = revenueMap[p.id] || 0;

    const forecast = forecastProduct(salesByDay[p.id] || {});
    const { dailyRate, growthRate, projectedTotal, suggestedReorder, forecastPoints } = forecast;
    const daysUntilEmpty = dailyRate > 0 ? Math.floor(current / dailyRate) : null;

    return { ...p, sold, turnover, revenue, dailyRate, growthRate, projectedTotal, daysUntilEmpty, suggestedReorder, forecastPoints };
  });

  // ── 3-month demand analysis (three 30-day blocks) ──
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const daysAgoOf = (day) => Math.floor((todayMidnight.getTime() - new Date(day + "T00:00:00").getTime()) / 86400000);
  const COVER_RISK_DAYS = 14;
  const COVER_OVER_DAYS = 90;

  const demandRows = enriched.map(p => {
    const byDay = salesByDay[p.id] || {};
    let b0 = 0, b1 = 0, b2 = 0; // 60-90d ago, 30-60d ago, last 30d
    Object.keys(byDay).forEach(day => {
      const ago = daysAgoOf(day);
      if (ago < 0 || ago >= 90) return;
      if (ago < 30) b2 += byDay[day];
      else if (ago < 60) b1 += byDay[day];
      else b0 += byDay[day];
    });
    const sold3m = b0 + b1 + b2;
    const avgMonth = sold3m / 3;
    const avgDay = sold3m / 90;
    const stock = Math.max(0, p.stock_quantity || 0);
    const cover = avgDay > 0 ? stock / avgDay : null;
    const trend = b1 > 0 ? ((b2 - b1) / b1) * 100 : (b2 > 0 ? 100 : null);
    const orderQty = Math.max(0, Math.ceil(avgDay * 30 - stock));
    let status = "healthy";
    if (p.is_active === false) status = "inactive";
    else if (stock <= 0 && sold3m > 0) status = "out";
    else if (stock <= 0) status = "empty";
    else if (sold3m === 0) status = "nodemand";
    else if (cover < COVER_RISK_DAYS) status = "risk";
    else if (cover > COVER_OVER_DAYS) status = "over";
    return { ...p, b0, b1, b2, sold3m, avgMonth, avgDay, stockQty: stock, cover, trend, orderQty, status, abc: "C" };
  });

  // ABC class: A = the products driving the first 80% of units sold, B = next 15%
  (function () {
    const total = demandRows.reduce((sum, r) => sum + r.sold3m, 0);
    if (total <= 0) return;
    let cum = 0;
    [...demandRows].filter(r => r.sold3m > 0).sort((a, b) => b.sold3m - a.sold3m).forEach(r => {
      const before = cum / total;
      cum += r.sold3m;
      r.abc = before < 0.8 ? "A" : before < 0.95 ? "B" : "C";
    });
  })();

  const classACount = demandRows.filter(r => r.abc === "A" && r.sold3m > 0).length;
  const totalAvgMonth = demandRows.reduce((sum, r) => sum + r.avgMonth, 0);
  const totalAvgDay = demandRows.reduce((sum, r) => sum + r.avgDay, 0);
  const totalStockUnits = demandRows.reduce((sum, r) => sum + (r.status === "inactive" ? 0 : r.stockQty), 0);
  const stockCoverDays = totalAvgDay > 0 ? Math.round(totalStockUnits / totalAvgDay) : null;
  const riskRows = demandRows.filter(r => r.status === "risk");
  const overRows = demandRows.filter(r => r.status === "over");
  const overUnits = overRows.reduce((sum, r) => sum + r.stockQty, 0);
  const emptyCount = demandRows.filter(r => r.status === "out" || r.status === "empty").length;
  const monthlyDemandChart = [
    { label: "60–90d ago", units: demandRows.reduce((sum, r) => sum + r.b0, 0) },
    { label: "30–60d ago", units: demandRows.reduce((sum, r) => sum + r.b1, 0) },
    { label: "Last 30d", units: demandRows.reduce((sum, r) => sum + r.b2, 0) },
  ];
  const STATUS_META = {
    out: { label: "Out of stock", cls: "bg-red-500/10 text-red-500" },
    empty: { label: "Empty", cls: "bg-muted text-muted-foreground" },
    risk: { label: "Stockout risk", cls: "bg-orange-500/10 text-orange-500" },
    healthy: { label: "Healthy", cls: "bg-green-500/10 text-green-500" },
    over: { label: "Overstocked (>90d)", cls: "bg-blue-500/10 text-blue-400" },
    nodemand: { label: "No demand", cls: "bg-muted text-muted-foreground" },
    inactive: { label: "Inactive", cls: "bg-muted text-muted-foreground" },
  };
  const visibleDemandRows = demandRows
    .filter(r => statusFilter === "all" || r.status === statusFilter)
    .sort((a, b) => {
      if (sortBy === "cover") return (a.cover ?? 99999) - (b.cover ?? 99999);
      if (sortBy === "stock") return b.stockQty - a.stockQty;
      if (sortBy === "order") return b.orderQty - a.orderQty;
      return b.avgMonth - a.avgMonth;
    });
  const shownDemandRows = showAllRows ? visibleDemandRows : visibleDemandRows.slice(0, 50);
  const fmtNum = (n) => Math.round(n).toLocaleString("en-ZA");

  const topSellers = [...enriched].sort((a, b) => b.sold - a.sold).slice(0, 10);
  const agingStock = enriched.filter(p => p.is_aging_stock || (p.sold === 0 && (p.stock_quantity || 0) > 0));
  const lowStock = enriched
    .filter(p => p.is_active !== false && (p.stock_quantity || 0) > 0 && (p.stock_quantity || 0) <= (p.low_stock_threshold || 5))
    .sort((a, b) => (a.daysUntilEmpty ?? 999) - (b.daysUntilEmpty ?? 999));
  const outOfStock = enriched.filter(p => p.is_active !== false && (p.stock_quantity || 0) <= 0);

  // Units sold split by strain type — shows which side of the shelf actually moves.
  const strainPerformance = (function () {
    var byStrain = {};
    enriched.forEach(function (p) {
      var label = formatStrain(p.strain_type) || "Not set";
      if (!byStrain[label]) byStrain[label] = { name: label, raw: p.strain_type || "", sold: 0, revenue: 0, products: 0 };
      byStrain[label].sold += p.sold || 0;
      byStrain[label].revenue += p.revenue || 0;
      byStrain[label].products += 1;
    });
    return Object.keys(byStrain)
      .map(function (k) { return byStrain[k]; })
      .filter(function (r) { return r.sold > 0; })
      .sort(function (a, b) { return b.sold - a.sold; });
  })();

  // 30 / 60 / 90-day forecast chart data
  const forecastChartData = buildForecastChart(enriched, 5, horizon);
  const forecastProductNames = forecastChartData.length > 0
    ? Object.keys(forecastChartData[0]).filter(k => k !== "date")
    : [];
  const CHART_COLORS = [
    "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
    "hsl(var(--chart-4))", "hsl(var(--chart-5))"
  ];

  // Turnover chart - top 8 by turnover
  const turnoverChart = [...enriched]
    .filter(p => p.sold > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 8)
    .map(p => ({ name: p.name?.slice(0, 14), turnover: Math.round(p.turnover * 100) / 100 }));

  const handleSendPurchaseOrders = async () => {
    if (!lowStock.length && !outOfStock.length) return;
    setSendingPO(true);
    const items = [...outOfStock, ...lowStock];
    const lines = items.map(p => {
      const strain = formatStrain(p.strain_type);
      return `• ${p.name}${strain ? ` (${strain})` : ""} — Current: ${p.stock_quantity} | Suggested Order: ${p.suggestedReorder || "N/A"} units`;
    }).join("\n");
    const supplierEmails = suppliers.map(s => s.email).filter(Boolean);
    const subject = `Purchase Order Request — ${new Date().toLocaleDateString()}`;
    const body = `Dear Supplier,\n\nPlease find below our restocking request based on current inventory levels:\n\n${lines}\n\nKindly confirm availability and pricing at your earliest convenience.\n\nRegards,\nCanna Life Co Inventory System`;

    if (supplierEmails.length > 0) {
      for (const email of supplierEmails) {
        // TODO: Implement email sending via your preferred service (Resend, SendGrid etc)
      }
    }
    setSendingPO(false);
    setPoSent(true);
    setTimeout(() => setPoSent(false), 4000);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Turnover rates, trends, and restocking recommendations
            <span className="text-muted-foreground/60 mx-1">·</span>
            <span className="text-xs font-medium text-foreground">{activeStoreName || "All stores combined"}</span>
          </p>
        </div>
        <button
          onClick={() => exportInventoryPDF({ products, lowStock, agingStock, topSellers })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-sm font-medium hover:bg-muted/80 transition-colors"
        >
          <Download className="w-4 h-4" /> Export PDF
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Package} label="Total Products" value={products.length} color="primary" />
        <StatCard icon={ShoppingCart} label="Top Seller" value={topSellers[0]?.name?.slice(0, 16) || "—"} sub={`${topSellers[0]?.sold || 0} units sold`} color="green" />
        <StatCard icon={AlertTriangle} label="Low Stock" value={lowStock.length} sub={`${outOfStock.length} out of stock`} color="red" />
        <StatCard icon={Clock} label="Aging Stock" value={agingStock.length} sub="no/slow movement" color="orange" />
      </div>

      {/* Demand KPIs (3-month basis) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Activity} label="Avg Monthly Demand" value={fmtNum(totalAvgMonth)} sub="units / month · 3-month basis" color="primary" />
        <StatCard icon={Layers} label="Stock Cover" value={stockCoverDays != null ? stockCoverDays.toLocaleString("en-ZA") + "d" : "—"} sub={fmtNum(totalStockUnits) + " units on hand"} color="green" />
        <StatCard icon={ShieldAlert} label="Stockout Risk" value={riskRows.length} sub={"under " + COVER_RISK_DAYS + " days of cover"} color="red" />
        <StatCard icon={Boxes} label="Overstocked" value={overRows.length} sub={fmtNum(overUnits) + " units > " + COVER_OVER_DAYS + " days cover"} color="yellow" />
      </div>

      {/* Demand by Month */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Demand by Month</h2>
          <span className="text-xs text-muted-foreground ml-1">(units sold per 30-day block, 3-month)</span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {classACount > 0 ? classACount + (classACount === 1 ? " product drives" : " products drive") + " 80% of units sold (Class A)." : "No sales in the last 90 days yet."}
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthlyDemandChart} barCategoryGap="35%">
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [fmtNum(v) + " units", "Sold"]}
            />
            <Bar dataKey="units" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Stock vs Demand */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Stock vs Demand</h2>
            <span className="text-xs text-muted-foreground ml-1">(3-month average)</span>
          </div>
          <div className="flex gap-2">
            <select value={statusFilter} onChange={function (e) { setStatusFilter(e.target.value); setShowAllRows(false); }}
              className="h-9 rounded-lg border border-border bg-background px-3 text-xs">
              <option value="all">All statuses</option>
              <option value="out">Out of stock</option>
              <option value="risk">Stockout risk</option>
              <option value="healthy">Healthy</option>
              <option value="over">Overstocked (&gt;90d)</option>
              <option value="nodemand">No demand</option>
            </select>
            <select value={sortBy} onChange={function (e) { setSortBy(e.target.value); }}
              className="h-9 rounded-lg border border-border bg-background px-3 text-xs">
              <option value="demand">Sort: Avg monthly demand</option>
              <option value="cover">Sort: Lowest cover</option>
              <option value="stock">Sort: Most in stock</option>
              <option value="order">Sort: Order to cover 30d</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase">
                <th className="text-left pb-2 pr-4">Product</th>
                <th className="text-right pb-2 px-3">In stock</th>
                <th className="text-right pb-2 px-3">Sold (3-month)</th>
                <th className="text-right pb-2 px-3">Avg / month</th>
                <th className="text-right pb-2 px-3">Avg / day</th>
                <th className="text-right pb-2 px-3">Cover</th>
                <th className="text-right pb-2 px-3">Trend (30d)</th>
                <th className="text-right pb-2 px-3">Order to cover 30d</th>
                <th className="text-left pb-2 pl-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {shownDemandRows.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">No products match this filter</td></tr>
              )}
              {shownDemandRows.map(r => (
                <tr key={r.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2.5">
                      <span className={cn("w-5 h-5 shrink-0 rounded text-[10px] font-bold flex items-center justify-center",
                        r.abc === "A" ? "bg-green-500/15 text-green-500" : r.abc === "B" ? "bg-yellow-500/15 text-yellow-500" : "bg-muted text-muted-foreground")}>
                        {r.abc}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium truncate max-w-[220px]">{r.name}</p>
                        <p className="text-xs text-muted-foreground capitalize truncate max-w-[220px]">{categoryStrainLabel(r) || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-semibold">{fmtNum(r.stockQty)}</td>
                  <td className="py-3 px-3 text-right">{fmtNum(r.sold3m)}</td>
                  <td className="py-3 px-3 text-right">{r.avgMonth.toFixed(1)}</td>
                  <td className="py-3 px-3 text-right text-muted-foreground">{r.avgDay.toFixed(2)}</td>
                  <td className="py-3 px-3 text-right">{r.status === "out" ? "0d" : r.cover != null ? Math.round(r.cover).toLocaleString("en-ZA") + "d" : "—"}</td>
                  <td className="py-3 px-3 text-right">
                    {r.trend == null ? "—" : (
                      <span className={cn("text-xs font-medium", r.trend >= 0 ? "text-green-500" : "text-red-500")}>
                        {r.trend >= 0 ? "↑" : "↓"} {Math.abs(Math.round(r.trend))}%
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right">{r.orderQty > 0 ? fmtNum(r.orderQty) : "—"}</td>
                  <td className="py-3 pl-3">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap", STATUS_META[r.status].cls)}>
                      {STATUS_META[r.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleDemandRows.length > 50 && (
          <button onClick={function () { setShowAllRows(!showAllRows); }}
            className="mt-3 w-full py-2 rounded-lg bg-muted text-xs font-medium hover:bg-muted/80 transition-colors">
            {showAllRows ? "Show top 50" : "Show all " + visibleDemandRows.length + " products"}
          </button>
        )}
      </div>

      {/* Sales by Strain Type */}
      {strainPerformance.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Sales by Strain Type</h2>
            <span className="text-xs text-muted-foreground ml-1">(what your members actually buy)</span>
          </div>
          <div className="space-y-2">
            {strainPerformance.map(function (row) {
              var topSold = strainPerformance[0].sold || 1;
              return (
                <div key={row.name} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="w-20 shrink-0">
                    {row.raw ? <StrainBadge value={row.raw} /> : (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">Not set</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: Math.max(2, Math.round((row.sold / topSold) * 100)) + "%" }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{row.products} {row.products === 1 ? "product" : "products"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{row.sold} units</p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(row.revenue)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 30 / 60 / 90-Day Demand Forecast Chart */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            <h2 className="font-semibold">{horizon}-Day Demand Forecast</h2>
            <span className="text-xs text-muted-foreground ml-1">(linear regression — growth-adjusted)</span>
          </div>
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
            {[30, 60, 90].map(function (d) {
              return (
                <button key={d} onClick={function () { setHorizon(d); }}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors",
                    horizon === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {d} days
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Projected units to sell per day for top 5 products over the next {horizon} days. Reorder quantities below are adjusted for trend.</p>
        {forecastChartData.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[30, 60, 90].map(function (d) {
              var key = d === 30 ? "projected30" : d === 60 ? "projected60" : "projected90";
              var total = enriched.reduce(function (sum, p) { return sum + (p[key] || 0); }, 0);
              return (
                <div key={d} className={cn("rounded-lg border px-3 py-2", horizon === d ? "border-primary/50 bg-primary/5" : "border-border")}>
                  <p className="text-[11px] text-muted-foreground">Next {d} days</p>
                  <p className="text-lg font-bold">{fmtNum(total)} <span className="text-xs font-normal text-muted-foreground">units</span></p>
                </div>
              );
            })}
          </div>
        )}
        {forecastChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={forecastChartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={horizon === 30 ? 4 : horizon === 60 ? 8 : 12} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {forecastProductNames.map((name, i) => (
                <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[i % 5]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-10">Not enough sales history to generate a forecast</p>
        )}
      </div>

      {/* Turnover Rate Chart */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Inventory Turnover Rate</h2>
          <span className="text-xs text-muted-foreground ml-1">(higher = selling faster)</span>
        </div>
        {turnoverChart.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={turnoverChart} barCategoryGap="30%">
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v) => [v.toFixed(2), "Turnover"]}
              />
              <Bar dataKey="turnover" radius={[6, 6, 0, 0]}>
                {turnoverChart.map((_, i) => (
                  <Cell key={i} fill={`hsl(var(--chart-${(i % 5) + 1}))`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-10">No sales data yet</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Sellers */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-green-500" />
            <h2 className="font-semibold">Top Selling Products</h2>
          </div>
          <div className="space-y-2">
            {topSellers.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No sales recorded yet</p>}
            {topSellers.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                <span className="text-xs font-bold text-muted-foreground w-5">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{categoryStrainLabel(p) || "—"}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-green-500">{p.sold} units</p>
                  <p className="text-xs text-muted-foreground">{formatCurrency(p.revenue)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Aging Stock */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-orange-500" />
            <h2 className="font-semibold">Aging / Slow-Moving Stock</h2>
          </div>
          <div className="space-y-2">
            {agingStock.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No aging stock detected</p>}
            {agingStock.slice(0, 8).map(p => (
              <div key={p.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4 text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <StrainBadge value={p.strain_type} />
                  </div>
                  <p className="text-xs text-muted-foreground">{p.stock_quantity} in stock · {p.sold} sold total</p>
                </div>
                <span className="text-xs px-2 py-1 bg-orange-500/10 text-orange-400 rounded-full font-medium shrink-0">Promote</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Low Stock + Restock Predictions */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-red-500" />
            <h2 className="font-semibold">Low Stock Alerts & Restock Suggestions</h2>
          </div>
          {(lowStock.length > 0 || outOfStock.length > 0) && (
            <button
              onClick={handleSendPurchaseOrders}
              disabled={sendingPO}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                poSent ? "bg-green-500/20 text-green-400" : "bg-primary/10 text-primary hover:bg-primary/20"
              }`}
            >
              <Send className="w-4 h-4" />
              {sendingPO ? "Sending..." : poSent ? "PO Sent ✓" : `Send PO to Suppliers (${suppliers.length})`}
            </button>
          )}
        </div>
        {lowStock.length === 0 && outOfStock.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">All stock levels are healthy</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase">
                  <th className="text-left pb-2 pr-4">Product</th>
                  <th className="text-left pb-2 px-4">Strain</th>
                  <th className="text-right pb-2 px-4">Current</th>
                  <th className="text-right pb-2 px-4">Daily Rate</th>
                  <th className="text-right pb-2 px-4">Days Left</th>
                  <th className="text-right pb-2 pl-4">Reorder Qty</th>
                </tr>
              </thead>
              <tbody>
                {[...outOfStock, ...lowStock].map(p => (
                  <tr key={p.id} className="border-b border-border/50 last:border-0">
                    <td className="py-3 pr-4">
                      <p className="font-medium truncate max-w-[160px]">{p.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{p.category?.replace(/_/g, " ")}</p>
                    </td>
                    <td className="py-3 px-4">
                      {formatStrain(p.strain_type)
                        ? <StrainBadge value={p.strain_type} />
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={cn(
                        "font-semibold",
                        p.stock_quantity <= 0 ? "text-red-500" : "text-yellow-500"
                      )}>
                        {p.stock_quantity}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-muted-foreground">
                      {p.dailyRate > 0 ? `${p.dailyRate.toFixed(1)}/day` : "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {p.stock_quantity <= 0 ? (
                        <span className="text-xs px-2 py-0.5 bg-red-500/10 text-red-500 rounded-full font-medium">Out</span>
                      ) : p.daysUntilEmpty != null ? (
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium",
                          p.daysUntilEmpty <= 7 ? "bg-red-500/10 text-red-500" : "bg-yellow-500/10 text-yellow-500"
                        )}>
                          ~{p.daysUntilEmpty}d
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-3 pl-4 text-right">
                      {p.suggestedReorder ? (
                        <div>
                          <div className="flex items-center justify-end gap-1 text-primary font-semibold">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            {p.suggestedReorder} units
                          </div>
                          {p.growthRate > 0.01 && (
                            <p className="text-xs text-green-500 text-right">↑ {(p.growthRate * 100).toFixed(1)}%/day growth</p>
                          )}
                          {p.growthRate < -0.01 && (
                            <p className="text-xs text-red-400 text-right">↓ declining trend</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
