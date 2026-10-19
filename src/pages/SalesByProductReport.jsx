import { useState, useEffect, useCallback, useMemo } from "react";
import { useCompany } from "@/lib/CompanyContext";
import { supabase } from "@/api/supabaseClient";
import { Download, Printer, ChevronDown, ChevronRight, TrendingDown, Search, X } from "lucide-react";

var DATE_PRESETS = [
  { label: "Today",        days: 0 },
  { label: "Last 7 Days",  days: 7 },
  { label: "Last 30 Days", days: 30 },
  { label: "This Month",   days: -1 },
  { label: "Custom",       days: null },
];

var GROUP_OPTIONS = [
  { key: "category", label: "Category" },
  { key: "supplier", label: "Supplier" },
  { key: "none",     label: "None (flat SKU list)" },
];

var PAGE = 1000;

function getPresetDates(preset) {
  var now = new Date();
  var end = new Date(now);
  end.setHours(23, 59, 59, 999);
  var start = new Date(now);

  if (preset.days === 0) {
    start.setHours(0, 0, 0, 0);
  } else if (preset.days === -1) {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
  } else if (preset.days > 0) {
    start.setDate(start.getDate() - preset.days);
    start.setHours(0, 0, 0, 0);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

function formatR(val) {
  if (val === null || val === undefined || isNaN(val)) return "0.00";
  var n = Number(val);
  var abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-" : "") + abs;
}

function fmtQty(n) {
  var v = Number(n) || 0;
  return Math.abs(v % 1) > 0.0001 ? v.toFixed(2) : v.toLocaleString();
}

function gpColor(pct) {
  if (pct >= 60) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 40) return "text-green-600 dark:text-green-400";
  if (pct >= 20) return "text-yellow-600 dark:text-yellow-400";
  if (pct >= 0)  return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function fmtDaysCover(dc) {
  if (dc === null || dc === undefined) return "—";
  return Number(dc).toFixed(1);
}

// PostgREST caps unbounded selects at 1000 rows and truncates silently.
// Always page through.
async function fetchAllPaged(buildQuery) {
  var all = [];
  var from = 0;
  for (var guard = 0; guard < 200; guard++) {
    var res = await buildQuery().range(from, from + PAGE - 1);
    if (res.error) throw res.error;
    var batch = res.data || [];
    all = all.concat(batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export default function SalesByProductReport() {
  var { selectedStore, company } = useCompany();

  var initDates = getPresetDates(DATE_PRESETS[2]);

  var [preset, setPreset] = useState("Last 30 Days");
  var [startDate, setStartDate] = useState(initDates.start.slice(0, 10));
  var [endDate, setEndDate] = useState(initDates.end.slice(0, 10));
  var [loading, setLoading] = useState(false);
  var [rows, setRows] = useState([]);
  var [periodDays, setPeriodDays] = useState(30);
  var [collapsed, setCollapsed] = useState({});
  var [sortField, setSortField] = useState("revenue");
  var [sortDir, setSortDir] = useState("desc");

  // Filters
  var [search, setSearch] = useState("");
  var [filterCategory, setFilterCategory] = useState("");
  var [filterSupplier, setFilterSupplier] = useState("");
  var [groupBy, setGroupBy] = useState("category");

  var applyPreset = useCallback(function (p) {
    setPreset(p.label);
    if (p.days === null) return;
    var dates = getPresetDates(p);
    setStartDate(dates.start.slice(0, 10));
    setEndDate(dates.end.slice(0, 10));
  }, []);

  var fetchReport = useCallback(async function () {
    if (!company) return;
    setLoading(true);

    try {
      var start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      var end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      var days = Math.max(Math.ceil((end - start) / 86400000), 1);
      setPeriodDays(days);

      var startIso = start.toISOString();
      var endIso = end.toISOString();
      var storeId = selectedStore ? selectedStore.id : null;

      var orders = await fetchAllPaged(function () {
        var q = supabase
          .from("orders")
          .select("items, store_id, created_at")
          .eq("company_id", company.id)
          .eq("status", "completed")
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("created_at", { ascending: true });
        if (storeId) q = q.eq("store_id", storeId);
        return q;
      });

      var products = await fetchAllPaged(function () {
        return supabase
          .from("products")
          .select("id, name, category, sku, barcode, cost_price, supplier_id, stock_quantity")
          .eq("company_id", company.id)
          .order("id", { ascending: true });
      });

      var suppliers = await fetchAllPaged(function () {
        return supabase
          .from("suppliers")
          .select("id, name")
          .eq("company_id", company.id)
          .order("id", { ascending: true });
      });

      var inv = await fetchAllPaged(function () {
        var q = supabase
          .from("store_inventory")
          .select("product_id, stock_quantity, store_id")
          .eq("company_id", company.id)
          .order("product_id", { ascending: true });
        if (storeId) q = q.eq("store_id", storeId);
        return q;
      });

      var productMap = {};
      products.forEach(function (p) { productMap[p.id] = p; });

      var supplierMap = {};
      suppliers.forEach(function (s) { supplierMap[s.id] = s.name; });

      var invMap = {};
      inv.forEach(function (r) {
        if (!r.product_id) return;
        invMap[r.product_id] = (invMap[r.product_id] || 0) + (Number(r.stock_quantity) || 0);
      });

      var agg = {};

      orders.forEach(function (order) {
        var items = order.items;
        if (!items) return;
        if (typeof items === "string") {
          try { items = JSON.parse(items); } catch (e) { return; }
        }
        if (!Array.isArray(items)) return;

        items.forEach(function (item) {
          var pid = item.product_id;
          if (!pid) return;
          var prod = productMap[pid] || {};

          var lines = Number(item.quantity) || 0;
          var gpu = Number(item.grams_per_unit) || 1;
          // Units sold in stock terms: a 5g tier sale is 5 units, not 1.
          var units = lines * gpu;

          // price is the price of the whole tier, so revenue is per line.
          var sell = (Number(item.price) || 0) * lines;

          // cost_price is per single unit (per gram), so COGS follows units.
          var unitCost = Number(item.cost_price);
          if (!unitCost) unitCost = Number(prod.cost_price) || 0;
          var cost = unitCost * units;

          var category = prod.category || item.category || "Uncategorised";
          var sku = prod.sku || item.sku || prod.barcode || "";
          var name = prod.name || item.name || "Unknown";
          var supplier = supplierMap[prod.supplier_id] || supplierMap[item.supplier_id] || "—";

          if (!agg[pid]) {
            agg[pid] = {
              id: pid, name: name, sku: sku, supplier: supplier, category: category,
              qty: 0, cost: 0, sell: 0,
            };
          }
          agg[pid].qty += units;
          agg[pid].cost += cost;
          agg[pid].sell += sell;
        });
      });

      var list = Object.keys(agg).map(function (pid) {
        var p = agg[pid];
        var gp = p.sell - p.cost;
        var closing = (invMap[p.id] !== undefined)
          ? invMap[p.id]
          : Number((productMap[p.id] || {}).stock_quantity || 0);
        var perDay = p.qty / days;
        return {
          id: p.id, name: p.name, sku: p.sku, supplier: p.supplier, category: p.category,
          qty: p.qty, closing: closing,
          daysCover: perDay > 0 ? (closing / perDay) : null,
          cost: p.cost, sell: p.sell, gp: gp,
          gpPct: p.sell > 0 ? (gp / p.sell) * 100 : 0,
        };
      });

      setRows(list);
    } catch (e) {
      console.error(e);
      setRows([]);
    }
    setLoading(false);
  }, [company, selectedStore, startDate, endDate]);

  useEffect(function () { fetchReport(); }, [fetchReport]);

  var categoryOptions = useMemo(function () {
    var seen = {};
    rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }, [rows]);

  var supplierOptions = useMemo(function () {
    var seen = {};
    rows.forEach(function (r) { if (r.supplier) seen[r.supplier] = true; });
    return Object.keys(seen).sort();
  }, [rows]);

  var filteredRows = useMemo(function () {
    var term = search.trim().toLowerCase();
    return rows.filter(function (r) {
      if (filterCategory && r.category !== filterCategory) return false;
      if (filterSupplier && r.supplier !== filterSupplier) return false;
      if (term) {
        var hay = (r.name || "").toLowerCase() + " " + (r.sku || "").toLowerCase();
        if (hay.indexOf(term) === -1) return false;
      }
      return true;
    });
  }, [rows, search, filterCategory, filterSupplier]);

  function sortRows(list) {
    var copy = list.slice();
    copy.sort(function (a, b) {
      var av = sortField === "qty" ? a.qty : sortField === "gp" ? a.gp : sortField === "closing" ? a.closing : a.sell;
      var bv = sortField === "qty" ? b.qty : sortField === "gp" ? b.gp : sortField === "closing" ? b.closing : b.sell;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }

  function summarise(list) {
    var t = list.reduce(function (acc, p) {
      return {
        qty: acc.qty + p.qty,
        closing: acc.closing + (p.closing || 0),
        cost: acc.cost + p.cost,
        sell: acc.sell + p.sell,
      };
    }, { qty: 0, closing: 0, cost: 0, sell: 0 });
    t.gp = t.sell - t.cost;
    t.gpPct = t.sell > 0 ? (t.gp / t.sell) * 100 : 0;
    var perDay = t.qty / periodDays;
    t.daysCover = perDay > 0 ? (t.closing / perDay) : null;
    return t;
  }

  var groups = useMemo(function () {
    if (groupBy === "none") {
      return [{ name: "", products: sortRows(filteredRows), flat: true }].map(function (g) {
        return Object.assign(g, summarise(g.products));
      });
    }
    var map = {};
    filteredRows.forEach(function (r) {
      var key = groupBy === "supplier" ? (r.supplier || "—") : (r.category || "Uncategorised");
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    var out = Object.keys(map).map(function (k) {
      var g = { name: k, products: sortRows(map[k]), flat: false };
      return Object.assign(g, summarise(g.products));
    });
    out.sort(function (a, b) { return b.sell - a.sell; });
    return out;
  }, [filteredRows, groupBy, sortField, sortDir, periodDays]);

  var totals = useMemo(function () {
    return filteredRows.length ? summarise(filteredRows) : null;
  }, [filteredRows, periodDays]);

  var hasFilters = !!(search || filterCategory || filterSupplier);

  function clearFilters() {
    setSearch(""); setFilterCategory(""); setFilterSupplier("");
  }

  function toggleGroup(name) {
    setCollapsed(function (prev) {
      var next = Object.assign({}, prev);
      next[name] = !next[name];
      return next;
    });
  }

  function handleSort(field) {
    if (sortField === field) setSortDir(function (d) { return d === "asc" ? "desc" : "asc"; });
    else { setSortField(field); setSortDir("desc"); }
  }

  function printReport() { window.print(); }

  // Exports exactly what is on screen, filters included.
  function exportCSV() {
    var head = ["Group", "Product", "SKU", "Supplier", "Category", "Items Sold",
      "Closing Stock", "Days Cover", "Cost (COGS)", "Sell (incl)", "GP Amount", "GP %"];
    var out = [head];

    groups.forEach(function (g) {
      g.products.forEach(function (p) {
        out.push([
          g.flat ? "" : g.name, p.name, p.sku, p.supplier, p.category,
          p.qty.toFixed(2), p.closing,
          (p.daysCover === null ? "" : p.daysCover.toFixed(1)),
          p.cost.toFixed(2), p.sell.toFixed(2), p.gp.toFixed(2), p.gpPct.toFixed(1) + "%",
        ]);
      });
      if (!g.flat) {
        out.push([g.name + " SUBTOTAL", "", "", "", "", g.qty.toFixed(2), g.closing,
          (g.daysCover === null ? "" : g.daysCover.toFixed(1)),
          g.cost.toFixed(2), g.sell.toFixed(2), g.gp.toFixed(2), g.gpPct.toFixed(1) + "%"]);
        out.push([]);
      }
    });

    if (totals) {
      out.push(["GRAND TOTAL", "", "", "", "", totals.qty.toFixed(2), totals.closing,
        (totals.daysCover === null ? "" : totals.daysCover.toFixed(1)),
        totals.cost.toFixed(2), totals.sell.toFixed(2), totals.gp.toFixed(2),
        totals.gpPct.toFixed(1) + "%"]);
    }

    var csv = out.map(function (r) {
      return r.map(function (c) { return '"' + String(c === undefined ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");

    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "sales-by-product-" + startDate + "-to-" + endDate + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function SortIcon({ field }) {
    if (sortField !== field) return <span className="text-muted-foreground/40 ml-1">↕</span>;
    return <span className="text-primary ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  var thClass = "px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none";
  var thPlain = "px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider";
  var tdClass = "px-3 py-2.5 text-right text-sm text-foreground tabular-nums";
  var selectClass = "bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground min-w-[9rem]";

  return (
    <div className="p-4 lg:p-6 space-y-5 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Sales by Product</h1>
          <p className="text-sm text-muted-foreground mt-0.5">SKU quantities sold, cost and margin by date range</p>
        </div>
        <div className="flex gap-2 no-print">
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border transition-colors">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button onClick={printReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border transition-colors">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-4 space-y-3 no-print">
        <div className="flex flex-wrap gap-2">
          {DATE_PRESETS.map(function (p) {
            return (
              <button key={p.label} onClick={function () { applyPreset(p); }}
                className={"px-3 py-1.5 rounded-full text-xs font-medium transition-all " +
                  (preset === p.label
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground border border-border")}>
                {p.label}
              </button>
            );
          })}
        </div>

        {preset === "Custom" && (
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">From</label>
              <input type="date" value={startDate} onChange={function (e) { setStartDate(e.target.value); }}
                className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">To</label>
              <input type="date" value={endDate} onChange={function (e) { setEndDate(e.target.value); }}
                className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground" />
            </div>
            <div className="flex items-end">
              <button onClick={fetchReport}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                Apply
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-end pt-1">
          <div className="flex flex-col gap-1 flex-1 min-w-[14rem]">
            <label className="text-xs text-muted-foreground">Search product or SKU</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input type="text" value={search} placeholder="e.g. Durban Poison or 20003993"
                onChange={function (e) { setSearch(e.target.value); }}
                className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-foreground" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Category</label>
            <select value={filterCategory} onChange={function (e) { setFilterCategory(e.target.value); }} className={selectClass}>
              <option value="">All categories</option>
              {categoryOptions.map(function (c) { return <option key={c} value={c}>{c}</option>; })}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Supplier</label>
            <select value={filterSupplier} onChange={function (e) { setFilterSupplier(e.target.value); }} className={selectClass}>
              <option value="">All suppliers</option>
              {supplierOptions.map(function (s) { return <option key={s} value={s}>{s}</option>; })}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Group by</label>
            <select value={groupBy} onChange={function (e) { setGroupBy(e.target.value); }} className={selectClass}>
              {GROUP_OPTIONS.map(function (g) { return <option key={g.key} value={g.key}>{g.label}</option>; })}
            </select>
          </div>

          {hasFilters && (
            <button onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border transition-colors">
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>

        {hasFilters && (
          <p className="text-xs text-muted-foreground">
            Showing {filteredRows.length} of {rows.length} products · exports match this view
          </p>
        )}
      </div>

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Items Sold", value: fmtQty(totals.qty) },
            { label: "Total Revenue", value: formatR(totals.sell) },
            { label: "Total Cost (COGS)", value: formatR(totals.cost) },
            { label: "Gross Profit", value: formatR(totals.gp), sub: totals.gpPct.toFixed(1) + "% GP", positive: totals.gp >= 0 },
          ].map(function (card) {
            return (
              <div key={card.label} className="bg-card rounded-xl border border-border p-4">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{card.label}</p>
                <p className={"text-lg font-bold mt-1 " + (card.positive === false ? "text-red-600 dark:text-red-400" : card.positive === true ? "text-primary" : "text-foreground")}>
                  {card.value}
                </p>
                {card.sub && <p className={"text-xs mt-0.5 " + gpColor(totals.gpPct)}>{card.sub}</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mr-3" />
            Loading report...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <TrendingDown className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">{rows.length === 0 ? "No sales data for this period" : "No products match these filters"}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-8"></th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Product</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">SKU/Code</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Supplier</th>
                  <th className={thClass} onClick={function () { handleSort("qty"); }}>Items Sold <SortIcon field="qty" /></th>
                  <th className={thClass} onClick={function () { handleSort("closing"); }}>Closing Stock <SortIcon field="closing" /></th>
                  <th className={thPlain}>Days Cover</th>
                  <th className={thPlain}>Cost (COGS)</th>
                  <th className={thClass} onClick={function () { handleSort("revenue"); }}>Sell (incl) <SortIcon field="revenue" /></th>
                  <th className={thClass} onClick={function () { handleSort("gp"); }}>GP Amount <SortIcon field="gp" /></th>
                  <th className={thPlain}>GP %</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(function (g) {
                  var isOpen = g.flat || !collapsed[g.name];
                  var out = [];

                  if (!g.flat) {
                    out.push(
                      <tr key={"g-" + g.name} onClick={function () { toggleGroup(g.name); }}
                        className="bg-muted/50 border-t border-border cursor-pointer hover:bg-muted/70 transition-colors select-none">
                        <td className="px-3 py-2.5">
                          {isOpen ? <ChevronDown className="w-4 h-4 text-primary" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-foreground" colSpan={3}>
                          {g.name}
                          <span className="ml-2 text-xs text-muted-foreground font-normal">
                            {g.products.length} product{g.products.length !== 1 ? "s" : ""}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-foreground tabular-nums">{fmtQty(g.qty)}</td>
                        <td className={"px-3 py-2.5 text-right font-semibold tabular-nums " + (g.closing < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{fmtQty(g.closing)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-muted-foreground tabular-nums">{fmtDaysCover(g.daysCover)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-muted-foreground tabular-nums">{formatR(g.cost)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-foreground tabular-nums">{formatR(g.sell)}</td>
                        <td className={"px-3 py-2.5 text-right font-semibold tabular-nums " + gpColor(g.gpPct)}>{formatR(g.gp)}</td>
                        <td className={"px-3 py-2.5 text-right font-bold tabular-nums " + gpColor(g.gpPct)}>{g.gpPct.toFixed(1)}%</td>
                      </tr>
                    );
                  }

                  if (isOpen) {
                    g.products.forEach(function (p) {
                      out.push(
                        <tr key={p.id} className="border-t border-border/40 hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2.5 text-foreground">{p.name}</td>
                          <td className="px-3 py-2.5 text-muted-foreground font-mono text-xs">{p.sku || "—"}</td>
                          <td className="px-3 py-2.5 text-muted-foreground text-xs">{p.supplier || "—"}</td>
                          <td className={tdClass}>{fmtQty(p.qty)}</td>
                          <td className={tdClass + (p.closing < 0 ? " text-red-600 dark:text-red-400" : "")}>{fmtQty(p.closing)}</td>
                          <td className={tdClass + " text-muted-foreground"}>{fmtDaysCover(p.daysCover)}</td>
                          <td className={tdClass + " text-muted-foreground"}>{formatR(p.cost)}</td>
                          <td className={tdClass}>{formatR(p.sell)}</td>
                          <td className={"px-3 py-2.5 text-right text-sm tabular-nums " + gpColor(p.gpPct)}>{formatR(p.gp)}</td>
                          <td className={"px-3 py-2.5 text-right text-sm font-semibold tabular-nums " + gpColor(p.gpPct)}>{p.gpPct.toFixed(1)}%</td>
                        </tr>
                      );
                    });
                  }

                  return out;
                })}

                {totals && (
                  <tr className="border-t-2 border-primary/30 bg-primary/5">
                    <td></td>
                    <td className="px-3 py-3 font-bold text-foreground text-sm" colSpan={3}>GRAND TOTAL</td>
                    <td className="px-3 py-3 text-right font-bold text-foreground tabular-nums">{fmtQty(totals.qty)}</td>
                    <td className={"px-3 py-3 text-right font-bold tabular-nums " + (totals.closing < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{fmtQty(totals.closing)}</td>
                    <td className={"px-3 py-3 text-right font-bold tabular-nums text-muted-foreground"}>{fmtDaysCover(totals.daysCover)}</td>
                    <td className="px-3 py-3 text-right font-bold text-muted-foreground tabular-nums">{formatR(totals.cost)}</td>
                    <td className="px-3 py-3 text-right font-bold text-foreground tabular-nums">{formatR(totals.sell)}</td>
                    <td className={"px-3 py-3 text-right font-bold tabular-nums " + gpColor(totals.gpPct)}>{formatR(totals.gp)}</td>
                    <td className={"px-3 py-3 text-right font-bold tabular-nums " + gpColor(totals.gpPct)}>{totals.gpPct.toFixed(1)}%</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          table { font-size: 11px; }
        }
      `}</style>
    </div>
  );
}
