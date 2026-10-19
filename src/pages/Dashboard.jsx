import { useState, useEffect, useCallback } from "react";
import { supabase } from '@/api/supabaseClient';
import { DollarSign, Users, TrendingUp, Mic, Volume2, Calendar, ChevronDown } from "lucide-react";
import StatCard from "../components/dashboard/StatCard";
import RevenueChart from "../components/dashboard/RevenueChart";
import RecentOrders from "../components/dashboard/RecentOrders";
import LowStockAlert from "../components/dashboard/LowStockAlert";
import TopProducts from "../components/dashboard/TopProducts";
import { formatCurrency } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";

function parseItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

// Fetch EVERY matching row, paging past PostgREST's 1000-row-per-request cap.
// Without this, an unbounded select silently returns only the most-recent 1000
// rows — which is why Total Revenue / order counts froze near 997 once a store
// crossed 1000 lifetime orders. makeQuery(from, to) must return a query that
// already has .range(from, to) applied.
async function fetchAllPaged(makeQuery) {
  var PAGE = 1000;
  var all = [];
  var from = 0;
  // Safety ceiling so a runaway loop can't hang the page.
  while (from < 100000) {
    var { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ── Date range presets ──
var PRESETS = [
  { key: "today",   label: "Today" },
  { key: "7d",      label: "Last 7 days" },
  { key: "30d",     label: "Last 30 days" },
  { key: "90d",     label: "Last 90 days" },
  { key: "custom",  label: "Custom" },
];

function getPresetRange(key) {
  var end = new Date();
  end.setHours(23, 59, 59, 999);
  var start = new Date();
  start.setHours(0, 0, 0, 0);
  if (key === "today") { /* start already today */ }
  else if (key === "7d")  { start.setDate(start.getDate() - 6); }
  else if (key === "30d") { start.setDate(start.getDate() - 29); }
  else if (key === "90d") { start.setDate(start.getDate() - 89); }
  return { start, end };
}

function toInputDate(d) {
  return d.toISOString().slice(0, 10);
}

// ── Build daily chart data for any range ──
function buildChartData(completedOrders, start, end) {
  var days = [];
  var cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  var endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);

  while (cursor <= endDay) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  // If range > 60 days, group by week; > 180 days, group by month
  var totalDays = days.length;

  if (totalDays <= 60) {
    // Daily
    return days.map(function (d) {
      var dayStr = d.toDateString();
      var revenue = completedOrders
        .filter(function (o) { return new Date(o.created_at).toDateString() === dayStr; })
        .reduce(function (s, o) { return s + (o.total_amount || 0); }, 0);
      var label = totalDays <= 14
        ? d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric" })
        : d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
      return { day: label, revenue };
    });
  } else if (totalDays <= 180) {
    // Weekly buckets
    var weeks = {};
    completedOrders.forEach(function (o) {
      var d = new Date(o.created_at);
      // Get Monday of that week
      var day = d.getDay();
      var diff = d.getDate() - day + (day === 0 ? -6 : 1);
      var monday = new Date(d);
      monday.setDate(diff);
      monday.setHours(0, 0, 0, 0);
      var key = monday.toISOString().slice(0, 10);
      weeks[key] = (weeks[key] || 0) + (o.total_amount || 0);
    });
    return Object.keys(weeks).sort().map(function (k) {
      var d = new Date(k);
      return { day: d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }), revenue: weeks[k] };
    });
  } else {
    // Monthly buckets
    var months = {};
    completedOrders.forEach(function (o) {
      var d = new Date(o.created_at);
      var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      months[key] = (months[key] || 0) + (o.total_amount || 0);
    });
    return Object.keys(months).sort().map(function (k) {
      var parts = k.split("-");
      var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      return { day: d.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" }), revenue: months[k] };
    });
  }
}

/* ─── JARVIS ─── */
function useJarvis() {
  var synth = window.speechSynthesis;
  var getBestVoice = function() {
    var voices = synth.getVoices();
    var preferred = ['Daniel', 'Samantha', 'Google UK English Male', 'Alex', 'Microsoft David'];
    for (var i = 0; i < preferred.length; i++) {
      var v = voices.find(function(vv) { return vv.name === preferred[i]; });
      if (v) return v;
    }
    return voices.find(function(v) { return v.lang && v.lang.startsWith('en'); }) || voices[0] || null;
  };
  var speak = function(text, onEnd) {
    synth.cancel();
    var utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.92; utt.pitch = 0.85; utt.volume = 1;
    var voice = getBestVoice();
    if (voice) utt.voice = voice;
    utt.onend = function() { if (onEnd) onEnd(); };
    utt.onerror = function() { if (onEnd) onEnd(); };
    synth.speak(utt);
  };
  var stop = function() { synth.cancel(); };
  var isSpeaking = function() { return synth.speaking; };
  return { speak, stop, isSpeaking };
}

function JarvisButton({ todayRevenue, todayOrders, totalRevenue, completedOrders, netProfit, totalCOGS, totalExpenses, activeMembers, lowStockCount, products, activeStoreId }) {
  var [speaking, setSpeaking] = useState(false);
  var jarvis = useJarvis();

  var buildBriefing = function() {
    var now = new Date();
    var hour = now.getHours();
    var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var day = now.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
    var lowStockItems = products
      .filter(function(p) { return (p.stock_quantity ?? 0) <= (p.low_stock_threshold || 5); })
      .slice(0, 3)
      .map(function(p) { return p.name; });
    return [
      greeting + ". Here is your store briefing for " + day + ".",
      activeStoreId ? "You are viewing a single store." : "You are viewing all stores combined.",
      "Today's revenue is " + formatCurrency(todayRevenue) + " from " + todayOrders + " transaction" + (todayOrders !== 1 ? 's' : '') + ".",
      "Total revenue across all time is " + formatCurrency(totalRevenue) + " from " + completedOrders + " completed orders.",
      "Net profit stands at " + formatCurrency(netProfit) + ", after cost of goods of " + formatCurrency(totalCOGS) + " and expenses of " + formatCurrency(totalExpenses) + ".",
      "You have " + activeMembers + " active member" + (activeMembers !== 1 ? 's' : '') + ".",
      lowStockCount > 0
        ? lowStockCount + " product" + (lowStockCount !== 1 ? 's are' : ' is') + " running low on stock" + (lowStockItems.length > 0 ? ", including " + lowStockItems.join(', ') + "." : ".")
        : "All products are sufficiently stocked.",
      "That concludes your briefing. Have a great day.",
    ].filter(Boolean).join(' ');
  };

  var handleToggle = function() {
    if (jarvis.isSpeaking()) { jarvis.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    jarvis.speak(buildBriefing(), function() { setSpeaking(false); });
  };

  return (
    <button
      onClick={handleToggle}
      title={speaking ? "Stop briefing" : "Get daily briefing"}
      className={"flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border " +
        (speaking
          ? "bg-primary/10 text-primary border-primary/30 animate-pulse"
          : "bg-muted/30 text-muted-foreground border-border hover:border-primary/30 hover:text-primary hover:bg-primary/5")
      }
    >
      {speaking ? <><Volume2 className="w-4 h-4" /> Speaking...</> : <><Mic className="w-4 h-4" /> Briefing</>}
    </button>
  );
}

export default function Dashboard() {
  var { companyId, activeStoreId, loading: companyLoading } = useCompany();
  var [orders, setOrders] = useState([]);
  var [members, setMembers] = useState([]);
  var [products, setProducts] = useState([]);
  var [expenses, setExpenses] = useState([]);
  var [loading, setLoading] = useState(true);

  // ── Date filter state ──
  var [preset, setPreset] = useState("today");
  var [showPresetMenu, setShowPresetMenu] = useState(false);
  var defaultRange = getPresetRange("today");
  var [customStart, setCustomStart] = useState(toInputDate(defaultRange.start));
  var [customEnd, setCustomEnd] = useState(toInputDate(defaultRange.end));
  var [showCustom, setShowCustom] = useState(false);

  var dateRange = preset === "custom"
    ? { start: new Date(customStart + "T00:00:00"), end: new Date(customEnd + "T23:59:59") }
    : getPresetRange(preset);

  var load = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    try {
      // Each of these paginates internally; the four run in parallel.
      var loaded = await Promise.all([
        // Members
        fetchAllPaged(function (a, b) {
          return supabase
            .from("members")
            .select("id, status")
            .eq("company_id", companyId)
            .order("id", { ascending: true })
            .range(a, b);
        }),
        // Orders (store-scoped when a store is active)
        fetchAllPaged(function (a, b) {
          var q = supabase
            .from("orders")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false });
          if (activeStoreId) q = q.eq("store_id", activeStoreId);
          return q.range(a, b);
        }),
        // Expenses (store-scoped when a store is active)
        fetchAllPaged(function (a, b) {
          var q = supabase
            .from("expenses")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false });
          if (activeStoreId) q = q.eq("store_id", activeStoreId);
          return q.range(a, b);
        }),
        // Products (store_inventory join when a store is active, else products)
        fetchAllPaged(function (a, b) {
          if (activeStoreId) {
            return supabase
              .from("store_inventory")
              .select("*, products(*)")
              .eq("store_id", activeStoreId)
              .eq("company_id", companyId)
              .order("product_id", { ascending: true })
              .range(a, b);
          }
          return supabase
            .from("products")
            .select("*")
            .eq("company_id", companyId)
            .order("id", { ascending: true })
            .range(a, b);
        }),
      ]);

      setMembers(loaded[0] || []);
      setOrders(loaded[1] || []);
      setExpenses(loaded[2] || []);

      if (activeStoreId) {
        var normalised = (loaded[3] || [])
          .map(function (row) { return { ...row.products, stock_quantity: row.stock_quantity ?? row.quantity, low_stock_threshold: row.low_stock_threshold || row.products?.low_stock_threshold || 5 }; })
          .filter(Boolean);
        setProducts(normalised);
      } else {
        setProducts(loaded[3] || []);
      }
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
  }, [companyId, activeStoreId]);

  useEffect(function () { load(); }, [load]);

  // ── Filter orders by selected date range ──
  var completedOrders = orders.filter(function (o) { return o.status === "completed"; });

  var rangeOrders = completedOrders.filter(function (o) {
    var d = new Date(o.created_at);
    return d >= dateRange.start && d <= dateRange.end;
  });

  // Today stats always use real today (for JARVIS)
  var today = new Date().toDateString();
  var todayOrders = completedOrders.filter(function (o) { return new Date(o.created_at).toDateString() === today; });
  var todayRevenue = todayOrders.reduce(function (s, o) { return s + (o.total_amount || 0); }, 0);

  // Range stats
  var rangeRevenue = rangeOrders.reduce(function (s, o) { return s + (o.total_amount || 0); }, 0);
  var totalExpenses = expenses.reduce(function (s, e) { return s + (e.amount || 0); }, 0);

  var productCostMap = {};
  products.forEach(function (p) { if (p && p.id) productCostMap[p.id] = p.cost_price || 0; });

  var rangeCOGS = rangeOrders.reduce(function (sum, order) {
    var items = parseItems(order.items);
    return sum + items.reduce(function (s, item) {
      var cost = item.cost_price != null ? Number(item.cost_price) : Number(productCostMap[item.product_id] || 0);
      return s + cost * Number(item.quantity || 1);
    }, 0);
  }, 0);

  var totalCOGS = completedOrders.reduce(function (sum, order) {
    var items = parseItems(order.items);
    return sum + items.reduce(function (s, item) {
      var cost = item.cost_price != null ? Number(item.cost_price) : Number(productCostMap[item.product_id] || 0);
      return s + cost * Number(item.quantity || 1);
    }, 0);
  }, 0);

  var activeMembers = members.filter(function (m) { return !m.status || m.status === "active"; }).length;
  var netProfit = rangeRevenue - rangeCOGS - totalExpenses;
  var lowStockCount = products.filter(function (p) { return (p.stock_quantity ?? 0) <= (p.low_stock_threshold || 5); }).length;

  var chartData = buildChartData(rangeOrders, dateRange.start, dateRange.end);

  var selectedPresetLabel = PRESETS.find(function (p) { return p.key === preset; })?.label || "Today";

  // Format date range label
  var rangeLabelStr = preset === "today"
    ? new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })
    : preset === "custom"
      ? customStart + " → " + customEnd
      : dateRange.start.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) + " – " + dateRange.end.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

  if (companyLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            {activeStoreId ? "Showing selected store data" : "Showing all stores"}
            <span className="text-muted-foreground/60 mx-1">·</span>
            <span className="text-xs">{rangeLabelStr}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Date preset picker */}
          <div className="relative">
            <button
              onClick={function () { setShowPresetMenu(function (v) { return !v; }); }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-muted/30 text-muted-foreground border-border hover:border-primary/30 hover:text-primary hover:bg-primary/5 transition-all"
            >
              <Calendar className="w-4 h-4" />
              {selectedPresetLabel}
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>

            {showPresetMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg min-w-[160px] py-1 overflow-hidden">
                {PRESETS.map(function (p) {
                  return (
                    <button key={p.key}
                      onClick={function () {
                        setPreset(p.key);
                        setShowCustom(p.key === "custom");
                        setShowPresetMenu(false);
                      }}
                      className={"w-full text-left px-4 py-2 text-sm transition-colors " +
                        (preset === p.key ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground")}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Custom date inputs */}
          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customStart} onChange={function (e) { setCustomStart(e.target.value); }}
                className="h-9 px-2 text-xs rounded-md border border-border bg-background text-foreground" />
              <span className="text-xs text-muted-foreground">→</span>
              <input type="date" value={customEnd} onChange={function (e) { setCustomEnd(e.target.value); }}
                className="h-9 px-2 text-xs rounded-md border border-border bg-background text-foreground" />
            </div>
          )}

          <JarvisButton
            todayRevenue={todayRevenue}
            todayOrders={todayOrders.length}
            totalRevenue={completedOrders.reduce(function (s, o) { return s + (o.total_amount || 0); }, 0)}
            completedOrders={completedOrders.length}
            netProfit={netProfit}
            totalCOGS={totalCOGS}
            totalExpenses={totalExpenses}
            activeMembers={activeMembers}
            lowStockCount={lowStockCount}
            products={products}
            activeStoreId={activeStoreId}
          />
        </div>
      </div>

      {/* Stat cards — all based on selected date range */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={preset === "today" ? "Today's Revenue" : "Period Revenue"}
          value={formatCurrency(rangeRevenue)}
          subtitle={rangeOrders.length + " transaction" + (rangeOrders.length !== 1 ? "s" : "")}
          icon={DollarSign}
          color="green"
        />
        <StatCard
          title="Total Revenue"
          value={formatCurrency(completedOrders.reduce(function (s, o) { return s + (o.total_amount || 0); }, 0))}
          subtitle={completedOrders.length + " total orders"}
          icon={TrendingUp}
          color="green"
        />
        <StatCard
          title="Net Profit"
          value={formatCurrency(netProfit)}
          subtitle={"COGS: " + formatCurrency(rangeCOGS) + " · Expenses: " + formatCurrency(totalExpenses)}
          icon={DollarSign}
          color={netProfit >= 0 ? "green" : "destructive"}
        />
        <StatCard
          title="Active Members"
          value={activeMembers}
          subtitle={lowStockCount + " low stock items"}
          icon={Users}
          color="blue"
        />
      </div>

      {/* Chart + recent orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart data={chartData} />
        <RecentOrders orders={orders.slice(0, 8)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LowStockAlert products={products} />
        <TopProducts orders={rangeOrders} />
      </div>
    </div>
  );
}
