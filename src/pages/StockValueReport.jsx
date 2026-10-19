import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "@/lib/CompanyContext";
import { useAuth } from "@/lib/AuthContext";
import {
  Package,
  TrendingDown,
  ArrowLeftRight,
  ShoppingCart,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Boxes,
  Download,
} from "lucide-react";

// Period presets for the SKU Inventory tab (variable reporting window)
var INV_PRESETS = [
  { label: "Last 7 Days", days: 7 },
  { label: "Last 30 Days", days: 30 },
  { label: "Last 90 Days", days: 90 },
  { label: "This Month", days: -1 },
  { label: "Custom", days: null },
];

function invPresetRange(preset) {
  var now = new Date();
  var end = new Date(now); end.setHours(23, 59, 59, 999);
  var start = new Date(now);
  if (preset.days === -1) {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (preset.days > 0) {
    start.setDate(start.getDate() - preset.days);
  }
  start.setHours(0, 0, 0, 0);
  return { start: start, end: end };
}

export default function StockValueReport() {
  var { company } = useCompany();
  var { user } = useAuth();

  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);
  var [stores, setStores] = useState([]);
  var [selectedStore, setSelectedStore] = useState("all");
  var [currentStockValue, setCurrentStockValue] = useState([]);
  var [cogsData, setCogsData] = useState({ totalCOGS: 0, totalRevenue: 0, grossProfit: 0, margin: 0, totalItemsSold: 0 });
  var [purchaseOrderData, setPurchaseOrderData] = useState(null);
  var [stockMovements, setStockMovements] = useState([]);
  var [activeTab, setActiveTab] = useState("current");
  var [expandedStore, setExpandedStore] = useState(null);

  // --- SKU Inventory tab state ---
  var [invPreset, setInvPreset] = useState("Last 30 Days");
  var _initInv = invPresetRange(INV_PRESETS[1]);
  var [invFrom, setInvFrom] = useState(_initInv.start.toISOString().slice(0, 10));
  var [invTo, setInvTo] = useState(_initInv.end.toISOString().slice(0, 10));
  var [invRows, setInvRows] = useState([]);
  var [invLoading, setInvLoading] = useState(false);
  var [invError, setInvError] = useState(null);
  var [invSort, setInvSort] = useState({ field: "items_sold_per_day", dir: "desc" });

  useEffect(function () {
    if (company) {
      fetchStores();
    }
  }, [company]);

  useEffect(function () {
    if (company) {
      fetchAll();
    }
  }, [company, selectedStore]);

  // Load SKU inventory when its tab is active or the period changes
  useEffect(function () {
    if (company && activeTab === "sku-inventory") {
      fetchSkuInventory();
    }
  }, [company, activeTab, invFrom, invTo]);

  function fetchStores() {
    supabase
      .from("stores")
      .select("id, name")
      .eq("company_id", company.id)
      .then(function (result) {
        if (!result.error) setStores(result.data || []);
      });
  }

  function fetchAll() {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchCurrentStockValue().catch(function(e) { console.error("Stock value error:", e); }),
      fetchCOGS().catch(function(e) { console.error("COGS error:", e); }),
      fetchPurchaseOrders().catch(function(e) { console.error("PO error:", e); }),
      fetchStockMovements().catch(function(e) { console.error("Movements error:", e); }),
    ])
      .finally(function () {
        setLoading(false);
      });
  }

  function fetchCurrentStockValue() {
    var query = supabase
      .from("store_inventory")
      .select(
        "store_id, stock_quantity, products(id, name, cost_price, price), stores(name)"
      )
      .eq("company_id", company.id)
      .gt("stock_quantity", 0);

    if (selectedStore !== "all") {
      query = query.eq("store_id", selectedStore);
    }

    return query.then(function (result) {
      if (result.error) throw result.error;
      var rows = result.data || [];

      // Group by store
      var byStore = {};
      rows.forEach(function (row) {
        var storeName = row.stores ? row.stores.name : "Unknown Store";
        var storeId = row.store_id;
        if (!byStore[storeId]) {
          byStore[storeId] = { storeId: storeId, storeName: storeName, items: [], totalCostValue: 0, totalRetailValue: 0 };
        }
        var costPrice = row.products ? parseFloat(row.products.cost_price || 0) : 0;
        var retailPrice = row.products ? parseFloat(row.products.price || 0) : 0;
        var qty = parseFloat(row.stock_quantity || 0);
        var itemCost = costPrice * qty;
        var itemRetail = retailPrice * qty;
        byStore[storeId].items.push({
          name: row.products ? row.products.name : "Unknown Product",
          qty: qty,
          costPrice: costPrice,
          retailPrice: retailPrice,
          costValue: itemCost,
          retailValue: itemRetail,
        });
        byStore[storeId].totalCostValue += itemCost;
        byStore[storeId].totalRetailValue += itemRetail;
      });

      setCurrentStockValue(Object.values(byStore));
    });
  }

  function fetchCOGS() {
    var query = supabase
      .from("orders")
      .select("id, store_id, total_amount, items")
      .eq("company_id", company.id)
      .eq("status", "completed");

    if (selectedStore !== "all") {
      query = query.eq("store_id", selectedStore);
    }

    // Cost fallback needs current product costs when a line item lacks a snapshot
    return supabase
      .from("products")
      .select("id, cost_price")
      .eq("company_id", company.id)
      .then(function (prodRes) {
        var costMap = {};
        (prodRes.data || []).forEach(function (p) { costMap[p.id] = parseFloat(p.cost_price) || 0; });

        return query.then(function(result) {
          if (result.error) throw result.error;
          var rows = result.data || [];

          var totalCOGS = 0;
          var totalRevenue = 0;
          var totalItemsSold = 0;

          rows.forEach(function(order) {
            totalRevenue += parseFloat(order.total_amount || 0);
            // orders.items is a double-encoded JSON string
            var items = order.items;
            if (typeof items === "string") {
              try { items = JSON.parse(items); } catch (e) { items = []; }
            }
            if (!Array.isArray(items)) items = [];
            items.forEach(function(item) {
              var qty = parseFloat(item.quantity || 1);
              // Use the cost snapshot frozen at sale; fall back to current product cost.
              var cost = parseFloat(item.cost_price);
              if (!cost) cost = costMap[item.product_id] || 0;
              totalCOGS += cost * qty;
              totalItemsSold += qty;
            });
          });

          setCogsData({
            totalCOGS: totalCOGS,
            totalRevenue: totalRevenue,
            grossProfit: totalRevenue - totalCOGS,
            margin: totalRevenue > 0 ? ((totalRevenue - totalCOGS) / totalRevenue) * 100 : 0,
            totalItemsSold: totalItemsSold,
          });
        });
      });
  }

  function fetchPurchaseOrders() {
    var query = supabase
      .from("supplier_purchase_orders")
      .select("id, order_number, invoice_total, calculated_total, amount_paid, balance_due, status, received_at, created_at, store_id, stores(name)")
      .eq("company_id", company.id);

    if (selectedStore !== "all") {
      query = query.eq("store_id", selectedStore);
    }

    return query.then(function (result) {
      if (result.error) throw result.error;
      var rows = result.data || [];
      var totalOrdered = 0;
      var totalPaid = 0;
      var totalOutstanding = 0;
      rows.forEach(function (row) {
        totalOrdered += parseFloat(row.invoice_total || row.calculated_total || 0);
        totalPaid += parseFloat(row.amount_paid || 0);
        totalOutstanding += parseFloat(row.balance_due || 0);
      });
      setPurchaseOrderData({
        totalOrders: rows.length,
        totalOrdered: totalOrdered,
        totalPaid: totalPaid,
        totalOutstanding: totalOutstanding,
        orders: rows,
      });
    });
  }

  function fetchStockMovements() {
    var query = supabase
      .from("inventory_movements")
      .select("id, movement_type, quantity, reason, notes, created_at, product_id, products(name)")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(100);

    return query.then(function (result) {
      if (result.error) throw result.error;
      setStockMovements(result.data || []);
    });
  }

  // --- SKU Inventory report (server-side RPC, company-scoped via auth.uid) ---
  function fetchSkuInventory() {
    setInvLoading(true);
    setInvError(null);
    var fromIso = new Date(invFrom + "T00:00:00").toISOString();
    var toIso = new Date(invTo + "T23:59:59").toISOString();
    return supabase
      .rpc("report_sku_inventory", { p_from: fromIso, p_to: toIso })
      .then(function (result) {
        if (result.error) throw result.error;
        setInvRows(result.data || []);
      })
      .catch(function (e) {
        console.error("SKU inventory error:", e);
        setInvError(e.message || "Failed to load inventory report");
      })
      .finally(function () {
        setInvLoading(false);
      });
  }

  function applyInvPreset(p) {
    setInvPreset(p.label);
    if (p.days === null) return;
    var r = invPresetRange(p);
    setInvFrom(r.start.toISOString().slice(0, 10));
    setInvTo(r.end.toISOString().slice(0, 10));
  }

  function invSortRows(rows) {
    var f = invSort.field, dir = invSort.dir;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var av = a[f], bv = b[f];
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      if (typeof av === "string") { av = av.toLowerCase(); bv = (bv || "").toLowerCase(); return dir === "asc" ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0); }
      return dir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }

  function toggleInvSort(field) {
    setInvSort(function (prev) {
      if (prev.field === field) return { field: field, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { field: field, dir: "desc" };
    });
  }

  function exportInvCSV() {
    var header = ["SKU Name", "SKU", "Supplier", "Category", "Closing Inventory", "Items Sold/Day", "Days Cover", "Inventory Cost"];
    var rows = [header];
    invSortRows(invRows).forEach(function (r) {
      rows.push([
        r.sku_name || "", r.sku || "", r.supplier || "", r.category || "",
        Number(r.closing_inventory || 0),
        Number(r.items_sold_per_day || 0).toFixed(2),
        r.days_cover === null || r.days_cover === undefined ? "" : Number(r.days_cover).toFixed(2),
        Number(r.inventory_cost || 0).toFixed(2),
      ]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "sku-inventory-" + invFrom + "-to-" + invTo + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatRand(val) {
    return "" + (parseFloat(val) || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  }

  var totalCurrentCost = currentStockValue.reduce(function (a, s) { return a + s.totalCostValue; }, 0);
  var totalCurrentRetail = currentStockValue.reduce(function (a, s) { return a + s.totalRetailValue; }, 0);
  var potentialProfit = totalCurrentRetail - totalCurrentCost;

  var tabs = [
    { id: "current", label: "Current Stock Value", icon: Package },
    { id: "sku-inventory", label: "SKU Inventory", icon: Boxes },
    { id: "cogs", label: "Cost of Sales", icon: TrendingDown },
    { id: "purchases", label: "Purchase Orders", icon: ShoppingCart },
    { id: "movements", label: "Stock Movements", icon: ArrowLeftRight },
  ];

  // Inventory summary figures
  var invTotalCost = invRows.reduce(function (a, r) { return a + (parseFloat(r.inventory_cost) || 0); }, 0);
  var invTotalUnits = invRows.reduce(function (a, r) { return a + (parseFloat(r.closing_inventory) || 0); }, 0);
  var invNegative = invRows.filter(function (r) { return (parseFloat(r.closing_inventory) || 0) < 0; }).length;
  var invSortedRows = invSortRows(invRows);

  function InvTh(props) {
    var active = invSort.field === props.field;
    return (
      <th
        onClick={function () { toggleInvSort(props.field); }}
        style={{ padding: "12px 16px", textAlign: props.align || "left", color: active ? "#4ade80" : "#4b5563", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      >
        {props.label}{active ? (invSort.dir === "asc" ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e8e8e8", fontFamily: "'Inter', sans-serif", padding: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em", color: "#4ade80", textTransform: "uppercase", marginBottom: "6px" }}>
            Inventory Intelligence
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#ffffff", margin: 0, lineHeight: 1.2 }}>
            Stock Value Report
          </h1>
          <p style={{ color: "#6b7280", fontSize: "13px", margin: "6px 0 0" }}>
            Real-time inventory valuation across all stores
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* Store filter (not applied to the RPC-backed SKU Inventory tab) */}
          <select
            value={selectedStore}
            onChange={function (e) { setSelectedStore(e.target.value); }}
            style={{
              background: "#1a1d27", border: "1px solid #2a2d3a", color: "#e8e8e8",
              borderRadius: "8px", padding: "8px 14px", fontSize: "13px", cursor: "pointer",
            }}
          >
            <option value="all">All Stores</option>
            {stores.map(function (s) { return <option key={s.id} value={s.id}>{s.name}</option>; })}
          </select>
          <button
            onClick={function () { activeTab === "sku-inventory" ? fetchSkuInventory() : fetchAll(); }}
            style={{
              background: "#1a1d27", border: "1px solid #2a2d3a", color: "#9ca3af",
              borderRadius: "8px", padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "28px" }}>
        <SummaryCard
          label="Stock at Cost"
          value={formatRand(totalCurrentCost)}
          sub="Current inventory cost value"
          color="#4ade80"
        />
        <SummaryCard
          label="Stock at Retail"
          value={formatRand(totalCurrentRetail)}
          sub="If all stock sold at full price"
          color="#60a5fa"
        />
        <SummaryCard
          label="Potential Gross Profit"
          value={formatRand(potentialProfit)}
          sub="Retail minus cost"
          color="#a78bfa"
        />
        <SummaryCard
          label="Total COGS (Sold)"
          value={formatRand(cogsData.totalCOGS)}
          sub={`${(cogsData.totalItemsSold || 0).toFixed(0)} units sold`}
          color="#f59e0b"
        />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "20px", background: "#1a1d27", borderRadius: "10px", padding: "4px" }}>
        {tabs.map(function (tab) {
          var Icon = tab.icon;
          var active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={function () { setActiveTab(tab.id); }}
              style={{
                flex: 1, padding: "9px 12px", borderRadius: "7px", border: "none", cursor: "pointer",
                background: active ? "#252836" : "transparent",
                color: active ? "#ffffff" : "#6b7280",
                fontWeight: active ? 600 : 400,
                fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                transition: "all 0.15s",
              }}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* SKU INVENTORY — self-contained, doesn't depend on the shared loading state */}
      {activeTab === "sku-inventory" && (
        <div>
          {/* Period controls */}
          <div style={{ background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {INV_PRESETS.map(function (p) {
                  var active = invPreset === p.label;
                  return (
                    <button key={p.label} onClick={function () { applyInvPreset(p); }}
                      style={{
                        padding: "6px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                        border: active ? "none" : "1px solid #2a2d3a",
                        background: active ? "#4ade80" : "transparent",
                        color: active ? "#0f1117" : "#9ca3af",
                      }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <button onClick={exportInvCSV}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 500, cursor: "pointer", background: "#252836", border: "1px solid #2a2d3a", color: "#9ca3af" }}>
                <Download size={13} /> Export CSV
              </button>
            </div>
            {invPreset === "Custom" && (
              <div style={{ display: "flex", gap: "12px", marginTop: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "11px", color: "#6b7280" }}>From</label>
                  <input type="date" value={invFrom} onChange={function (e) { setInvFrom(e.target.value); }}
                    style={{ background: "#0f1117", border: "1px solid #2a2d3a", color: "#e8e8e8", borderRadius: "8px", padding: "7px 10px", fontSize: "13px" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "11px", color: "#6b7280" }}>To</label>
                  <input type="date" value={invTo} onChange={function (e) { setInvTo(e.target.value); }}
                    style={{ background: "#0f1117", border: "1px solid #2a2d3a", color: "#e8e8e8", borderRadius: "8px", padding: "7px 10px", fontSize: "13px" }} />
                </div>
              </div>
            )}
          </div>

          {/* Inventory summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "20px" }}>
            <SummaryCard label="SKUs Reported" value={invRows.length} sub="Active products with stock or sales" color="#60a5fa" />
            <SummaryCard label="Closing Units" value={invTotalUnits.toLocaleString("en-ZA")} sub="Total units on hand" color="#e8e8e8" />
            <SummaryCard label="Inventory Cost" value={formatRand(invTotalCost)} sub="Closing stock at cost" color="#4ade80" />
            <SummaryCard label="Negative Stock" value={invNegative} sub="SKUs oversold below zero" color={invNegative > 0 ? "#f87171" : "#4ade80"} />
          </div>

          <div style={{ background: "#1a1d27", borderRadius: "10px", overflow: "hidden", border: "1px solid #2a2d3a" }}>
            {invLoading ? (
              <div style={{ textAlign: "center", padding: "60px", color: "#4b5563" }}>
                <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: "12px" }} />
                <p>Loading inventory report...</p>
              </div>
            ) : invError ? (
              <div style={{ background: "#1f1010", border: "1px solid #7f1d1d", borderRadius: "10px", padding: "20px", color: "#fca5a5", display: "flex", gap: "10px", alignItems: "center" }}>
                <AlertTriangle size={16} /> {invError}
              </div>
            ) : invRows.length === 0 ? (
              <EmptyState message="No stock or sales in this period." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#13151f" }}>
                      <InvTh field="sku_name" label="SKU Name" />
                      <InvTh field="sku" label="SKU" />
                      <InvTh field="supplier" label="Supplier" />
                      <InvTh field="category" label="Category" />
                      <InvTh field="closing_inventory" label="Closing Inv." align="right" />
                      <InvTh field="items_sold_per_day" label="Items Sold/Day" align="right" />
                      <InvTh field="days_cover" label="Days Cover" align="right" />
                      <InvTh field="inventory_cost" label="Inventory Cost" align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {invSortedRows.map(function (r, i) {
                      var closing = parseFloat(r.closing_inventory) || 0;
                      var invCost = parseFloat(r.inventory_cost) || 0;
                      var negative = closing < 0;
                      return (
                        <tr key={(r.sku || "") + "-" + i} style={{ borderTop: "1px solid #1f2230" }}>
                          <td style={{ padding: "10px 16px", color: "#e8e8e8" }}>{r.sku_name || "—"}</td>
                          <td style={{ padding: "10px 16px", color: "#6b7280", fontFamily: "monospace", fontSize: "12px" }}>{r.sku || "—"}</td>
                          <td style={{ padding: "10px 16px", color: "#9ca3af" }}>{r.supplier || "—"}</td>
                          <td style={{ padding: "10px 16px", color: "#9ca3af" }}>{r.category || "—"}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: negative ? "#f87171" : "#e8e8e8" }}>
                            {closing.toLocaleString("en-ZA")}
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "#9ca3af" }}>
                            {(parseFloat(r.items_sold_per_day) || 0).toFixed(2)}
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: negative ? "#f87171" : "#9ca3af" }}>
                            {r.days_cover === null || r.days_cover === undefined ? "—" : (parseFloat(r.days_cover)).toFixed(2)}
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: invCost < 0 ? "#f87171" : "#4ade80" }}>
                            {formatRand(invCost)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p style={{ fontSize: "11px", color: "#4b5563", marginTop: "10px" }}>
            Days cover = closing inventory ÷ average units sold per day over the selected period. Negative values indicate stock sold below zero (oversell).
          </p>
        </div>
      )}

      {/* Tab Content (shared-loading tabs) */}
      {activeTab !== "sku-inventory" && (
        loading ? (
          <div style={{ textAlign: "center", padding: "60px", color: "#4b5563" }}>
            <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: "12px" }} />
            <p>Loading report data...</p>
          </div>
        ) : error ? (
          <div style={{ background: "#1f1010", border: "1px solid #7f1d1d", borderRadius: "10px", padding: "20px", color: "#fca5a5", display: "flex", gap: "10px", alignItems: "center" }}>
            <AlertTriangle size={16} /> {error}
          </div>
        ) : (
          <>
            {/* CURRENT STOCK VALUE */}
            {activeTab === "current" && (
              <div>
                {currentStockValue.length === 0 ? (
                  <EmptyState message="No stock on hand found for the selected filter." />
                ) : (
                  currentStockValue.map(function (store) {
                    var isOpen = expandedStore === store.storeId;
                    return (
                      <div key={store.storeId} style={{ background: "#1a1d27", borderRadius: "10px", marginBottom: "12px", overflow: "hidden", border: "1px solid #2a2d3a" }}>
                        <button
                          onClick={function () { setExpandedStore(isOpen ? null : store.storeId); }}
                          style={{
                            width: "100%", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center",
                            background: "transparent", border: "none", color: "#e8e8e8", cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#4ade80" }} />
                            <span style={{ fontWeight: 600, fontSize: "15px" }}>{store.storeName}</span>
                            <span style={{ fontSize: "12px", color: "#6b7280" }}>{store.items.length} products</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "2px" }}>Cost Value</div>
                              <div style={{ fontWeight: 700, color: "#4ade80", fontSize: "15px" }}>{formatRand(store.totalCostValue)}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "2px" }}>Retail Value</div>
                              <div style={{ fontWeight: 700, color: "#60a5fa", fontSize: "15px" }}>{formatRand(store.totalRetailValue)}</div>
                            </div>
                            {isOpen ? <ChevronUp size={16} color="#6b7280" /> : <ChevronDown size={16} color="#6b7280" />}
                          </div>
                        </button>
                        {isOpen && (
                          <div style={{ borderTop: "1px solid #2a2d3a" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                              <thead>
                                <tr style={{ background: "#13151f" }}>
                                  {["Product", "Qty", "Cost Price", "Retail Price", "Cost Value", "Retail Value"].map(function (h) {
                                    return (
                                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", color: "#4b5563", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                        {h}
                                      </th>
                                    );
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {store.items.sort(function (a, b) { return b.costValue - a.costValue; }).map(function (item, i) {
                                  return (
                                    <tr key={i} style={{ borderTop: "1px solid #1f2230" }}>
                                      <td style={{ padding: "10px 16px", color: "#e8e8e8" }}>{item.name}</td>
                                      <td style={{ padding: "10px 16px", color: "#9ca3af" }}>{item.qty}</td>
                                      <td style={{ padding: "10px 16px", color: "#9ca3af" }}>{formatRand(item.costPrice)}</td>
                                      <td style={{ padding: "10px 16px", color: "#9ca3af" }}>{formatRand(item.retailPrice)}</td>
                                      <td style={{ padding: "10px 16px", color: "#4ade80", fontWeight: 600 }}>{formatRand(item.costValue)}</td>
                                      <td style={{ padding: "10px 16px", color: "#60a5fa", fontWeight: 600 }}>{formatRand(item.retailValue)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* COGS */}
            {activeTab === "cogs" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "20px" }}>
                  <SummaryCard label="Total Revenue" value={formatRand(cogsData.totalRevenue)} sub="From completed orders" color="#60a5fa" />
                  <SummaryCard label="Cost of Goods Sold" value={formatRand(cogsData.totalCOGS)} sub="Stock cost for sold items" color="#f59e0b" />
                  <SummaryCard label="Gross Profit" value={formatRand(cogsData.grossProfit)} sub="Revenue minus COGS" color="#4ade80" />
                  <SummaryCard label="Gross Margin" value={cogsData.margin.toFixed(1) + "%"} sub="Profit as % of revenue" color="#a78bfa" />
                </div>
                <div style={{ background: "#1a1d27", borderRadius: "10px", padding: "24px", border: "1px solid #2a2d3a" }}>
                  <h3 style={{ margin: "0 0 6px", fontSize: "15px", fontWeight: 600, color: "#e8e8e8" }}>Cost of Goods Sold Summary</h3>
                  <p style={{ margin: "0 0 20px", fontSize: "13px", color: "#6b7280" }}>
                    Based on all completed orders — cost snapshot at time of sale, falling back to current product cost.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                    {[
                      { label: "Total Items Sold", value: cogsData.totalItemsSold.toFixed(0) + " units" },
                      { label: "Total Revenue", value: formatRand(cogsData.totalRevenue), color: "#60a5fa" },
                      { label: "Total COGS", value: formatRand(cogsData.totalCOGS), color: "#f59e0b" },
                      { label: "Gross Profit", value: formatRand(cogsData.grossProfit), color: "#4ade80" },
                      { label: "Gross Margin %", value: cogsData.margin.toFixed(2) + "%", color: "#a78bfa" },
                    ].map(function (row, i) {
                      return (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderBottom: i < 4 ? "1px solid #2a2d3a" : "none" }}>
                          <span style={{ color: "#9ca3af", fontSize: "14px" }}>{row.label}</span>
                          <span style={{ color: row.color || "#e8e8e8", fontWeight: 700, fontSize: "15px" }}>{row.value}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* PURCHASE ORDERS */}
            {activeTab === "purchases" && purchaseOrderData && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "20px" }}>
                  <SummaryCard label="Total POs" value={purchaseOrderData.totalOrders} sub="All purchase orders" color="#60a5fa" />
                  <SummaryCard label="Total Ordered" value={formatRand(purchaseOrderData.totalOrdered)} sub="Invoice value" color="#e8e8e8" />
                  <SummaryCard label="Total Paid" value={formatRand(purchaseOrderData.totalPaid)} sub="Payments made" color="#4ade80" />
                  <SummaryCard label="Outstanding" value={formatRand(purchaseOrderData.totalOutstanding)} sub="Balance due to suppliers" color="#f87171" />
                </div>
                <div style={{ background: "#1a1d27", borderRadius: "10px", overflow: "hidden", border: "1px solid #2a2d3a" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "#13151f" }}>
                        {["PO Number", "Store", "Status", "Invoice Total", "Amount Paid", "Balance Due", "Date"].map(function (h) {
                          return (
                            <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#4b5563", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              {h}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseOrderData.orders.slice(0, 50).map(function (po) {
                        var statusColor = po.status === "received" ? "#4ade80" : po.status === "pending" ? "#f59e0b" : "#9ca3af";
                        var balance = parseFloat(po.balance_due || 0);
                        return (
                          <tr key={po.id} style={{ borderTop: "1px solid #1f2230" }}>
                            <td style={{ padding: "11px 16px", color: "#e8e8e8", fontWeight: 600 }}>{po.order_number || "—"}</td>
                            <td style={{ padding: "11px 16px", color: "#9ca3af" }}>{po.stores ? po.stores.name : "—"}</td>
                            <td style={{ padding: "11px 16px" }}>
                              <span style={{ fontSize: "11px", fontWeight: 600, color: statusColor, background: statusColor + "22", padding: "3px 8px", borderRadius: "4px", textTransform: "capitalize" }}>
                                {po.status}
                              </span>
                            </td>
                            <td style={{ padding: "11px 16px", color: "#e8e8e8" }}>{formatRand(po.invoice_total || po.calculated_total)}</td>
                            <td style={{ padding: "11px 16px", color: "#4ade80" }}>{formatRand(po.amount_paid)}</td>
                            <td style={{ padding: "11px 16px", color: balance > 0 ? "#f87171" : "#4ade80", fontWeight: 600 }}>{formatRand(balance)}</td>
                            <td style={{ padding: "11px 16px", color: "#6b7280" }}>{formatDate(po.received_at || po.created_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {purchaseOrderData.orders.length === 0 && <EmptyState message="No purchase orders found." />}
                </div>
              </div>
            )}

            {/* STOCK MOVEMENTS */}
            {activeTab === "movements" && (
              <div>
                <div style={{ background: "#1a1d27", borderRadius: "10px", overflow: "hidden", border: "1px solid #2a2d3a" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "#13151f" }}>
                        {["Product", "Type", "Qty", "Reason", "Notes", "Date"].map(function (h) {
                          return (
                            <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#4b5563", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              {h}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {stockMovements.map(function (m) {
                        var qty = parseFloat(m.quantity || 0);
                        var isIn = m.movement_type === "in" || m.movement_type === "purchase" || m.movement_type === "receive" || qty > 0;
                        var typeColor = isIn ? "#4ade80" : "#f87171";
                        return (
                          <tr key={m.id} style={{ borderTop: "1px solid #1f2230" }}>
                            <td style={{ padding: "10px 16px", color: "#e8e8e8" }}>{m.products ? m.products.name : "—"}</td>
                            <td style={{ padding: "10px 16px" }}>
                              <span style={{ fontSize: "11px", fontWeight: 600, color: typeColor, background: typeColor + "22", padding: "3px 8px", borderRadius: "4px", textTransform: "capitalize" }}>
                                {m.movement_type || "—"}
                              </span>
                            </td>
                            <td style={{ padding: "10px 16px", color: typeColor, fontWeight: 600 }}>{qty > 0 ? "+" : ""}{qty}</td>
                            <td style={{ padding: "10px 16px", color: "#9ca3af" }}>{m.reason || "—"}</td>
                            <td style={{ padding: "10px 16px", color: "#6b7280" }}>{m.notes || "—"}</td>
                            <td style={{ padding: "10px 16px", color: "#6b7280" }}>{formatDate(m.created_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {stockMovements.length === 0 && <EmptyState message="No stock movements recorded yet." />}
                  {stockMovements.length === 100 && (
                    <div style={{ padding: "12px 16px", borderTop: "1px solid #2a2d3a", fontSize: "12px", color: "#6b7280", textAlign: "center" }}>
                      Showing latest 100 movements
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{ background: "#1a1d27", borderRadius: "10px", padding: "18px 20px", border: "1px solid #2a2d3a" }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>{label}</div>
      <div style={{ fontSize: "22px", fontWeight: 700, color: color || "#e8e8e8", marginBottom: "4px", letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#4b5563" }}>{sub}</div>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: "48px", textAlign: "center", color: "#4b5563", fontSize: "14px" }}>
      <Package size={32} style={{ marginBottom: "12px", opacity: 0.4 }} />
      <p style={{ margin: 0 }}>{message}</p>
    </div>
  );
}
