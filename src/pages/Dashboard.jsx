import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import {
  RefreshCw, BadgeCheck, Users, UserCheck, UserX, UserPlus, AlertTriangle,
  Package, PackageX, Clock, Mic, Volume2, ChevronRight, Wallet, Truck, FileWarning, X,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { Link } from "react-router-dom";
import { formatCurrency } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";

/* ───────────────────────── helpers ───────────────────────── */

function parseItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      var v = JSON.parse(raw);
      if (typeof v === "string") v = JSON.parse(v); // double-encoded
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  return [];
}

// Page past PostgREST's 1000-row cap. makeQuery(from, to) must apply .range().
async function fetchAllPaged(makeQuery) {
  var PAGE = 1000, all = [], from = 0;
  while (from < 200000) {
    var { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

var PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
  { key: "month", label: "Month" },
];

function getRange(key) {
  var end = new Date(); end.setHours(23, 59, 59, 999);
  var start = new Date(); start.setHours(0, 0, 0, 0);
  if (key === "7d") start.setDate(start.getDate() - 6);
  else if (key === "14d") start.setDate(start.getDate() - 13);
  else if (key === "30d") start.setDate(start.getDate() - 29);
  else if (key === "month") start.setDate(1);
  return { start, end };
}

// The comparison window: same length, immediately before. For "month" it is the
// previous month up to the same day, so month-to-date compares like with like.
function getPrevRange(key, r) {
  if (key === "month") {
    var s = new Date(r.start); s.setMonth(s.getMonth() - 1);
    var e = new Date(r.end); e.setDate(0); // last day of previous month
    var sameDay = new Date(s.getFullYear(), s.getMonth(), Math.min(new Date().getDate(), e.getDate()), 23, 59, 59, 999);
    return { start: s, end: sameDay };
  }
  var len = r.end.getTime() - r.start.getTime() + 1;
  return { start: new Date(r.start.getTime() - len), end: new Date(r.start.getTime() - 1) };
}

function inRange(ts, r) { var d = new Date(ts); return d >= r.start && d <= r.end; }
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function fmtNum(n, dp) { return num(n).toLocaleString("en-ZA", { maximumFractionDigits: dp ?? 0 }); }
function compactR(n) {
  n = num(n);
  var a = Math.abs(n);
  if (a >= 1e6) return "R" + (n / 1e6).toFixed(1) + "m";
  if (a >= 1e4) return "R" + (n / 1e3).toFixed(1) + "k";
  return "R" + Math.round(n).toLocaleString("en-ZA");
}
function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
function agoLabel(date) {
  if (!date) return "";
  var mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return "Updated " + mins + " min" + (mins === 1 ? "" : "s") + " ago";
  return "Updated " + Math.round(mins / 60) + "h ago";
}
function durationSince(ts) {
  var mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  var h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m";
}
function localYmd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Say money the way a person would: "200 rands", "1 rand", "12,500 rands 50 cents".
// Speech engines read "R200" as "R two hundred", so the briefing never uses the symbol.
function speakRands(n) {
  n = num(n);
  var neg = n < 0;
  var cents = Math.round(Math.abs(n) * 100);
  var rands = Math.floor(cents / 100);
  var c = cents % 100;
  var out = rands.toLocaleString("en-US") + (rands === 1 ? " rand" : " rands");
  if (c > 0) out += " " + c + (c === 1 ? " cent" : " cents");
  return (neg ? "minus " : "") + out;
}

// When a member actually joined the club. Imported members carry their real join
// date in membership_start_date; created_at is only when the row landed in Budify,
// so counting by created_at turns every data import into a fake spike of signups.
function joinDate(x) {
  var s = x.membership_start_date || x.registration_date;
  return s ? new Date(s + "T12:00:00") : new Date(x.created_at);
}
// Start date later than the day the record was created cannot be right —
// usually a mistyped date from an import reconciliation.
function joinDateSuspect(x) {
  var s = x.membership_start_date;
  return !!(s && x.created_at && s > localYmd(new Date(x.created_at)));
}

// Split a payment across methods. Split orders carry [{method, amount}] in payment_details.
function paymentBreakdown(order) {
  var method = (order.payment_method || "other").toLowerCase();
  var total = num(order.total_amount);
  if (method === "split") {
    var parts = parseItems(order.payment_details);
    if (parts.length) return parts.map(function (p) { return { method: (p.method || "other").toLowerCase(), amount: num(p.amount) }; });
  }
  return [{ method: method, amount: total }];
}

var METHOD_META = {
  card:    { label: "Card",       color: "#9ca3af" },
  cash:    { label: "Cash",       color: "#5b8a3a" },
  eft:     { label: "EFT",        color: "#f97316" },
  account: { label: "On Account", color: "#3b82f6" },
  credit:  { label: "Store Credit", color: "#a855f7" },
  payment_link: { label: "Payment Link", color: "#14b8a6" },
  other:   { label: "Other",      color: "#eab308" },
};
function methodKey(m) {
  if (m === "card" || m === "cash" || m === "eft" || m === "credit" || m === "payment_link") return m;
  if (m === "account" || m === "unpaid") return "account";
  return "other";
}

/* ───────────────────────── UI primitives ───────────────────────── */

function Panel({ title, subtitle, onRefresh, refreshing, children }) {
  return (
    <section className="bg-card border border-border rounded-xl shadow-sm flex flex-col min-w-0">
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-[15px] leading-tight">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {onRefresh && (
          <button onClick={onRefresh} title="Refresh" className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors">
            <RefreshCw className={"w-3.5 h-3.5" + (refreshing ? " animate-spin" : "")} />
          </button>
        )}
      </header>
      <div className="px-4 pb-4 space-y-3 flex-1">{children}</div>
    </section>
  );
}

function Box({ tone, className, children }) {
  var tones = {
    plain: "bg-background border-border",
    green: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900",
    red: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900",
    amber: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900",
    solid: "bg-primary border-primary text-primary-foreground",
  };
  return <div className={"rounded-lg border p-3 " + (tones[tone || "plain"]) + " " + (className || "")}>{children}</div>;
}

function Row({ label, value, strong, className }) {
  return (
    <div className={"flex items-center justify-between gap-3 text-xs " + (className || "")}>
      <span className="text-muted-foreground truncate">{label}</span>
      <span className={"tabular-nums whitespace-nowrap " + (strong ? "font-semibold text-sm text-foreground" : "text-foreground")}>{value}</span>
    </div>
  );
}

function Eyebrow({ children, className }) {
  return <p className={"text-[10px] font-semibold uppercase tracking-wider text-muted-foreground " + (className || "")}>{children}</p>;
}

function MiniStat({ label, value, sub, tone }) {
  return (
    <Box tone={tone} className="text-center px-2">
      <Eyebrow className="!text-[9px]">{label}</Eyebrow>
      <p className="text-lg font-bold tabular-nums leading-tight mt-1 truncate">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </Box>
  );
}

function CountTile({ value, label, icon: Icon, tone, sub }) {
  var tones = {
    solid: "bg-primary text-primary-foreground border-primary",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900",
    red: "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900",
    plain: "bg-background text-foreground border-border",
  };
  return (
    <div className={"rounded-lg border px-2 py-3 text-center " + tones[tone || "plain"]}>
      <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
      <p className="text-[11px] mt-1.5 flex items-center justify-center gap-1 opacity-90">
        {Icon && <Icon className="w-3 h-3" />}{label}
      </p>
      {sub}
    </div>
  );
}

/* ───────────────────────── JARVIS briefing (kept) ───────────────────────── */

// Same JARVIS voice as Super Admin.
function useJarvis() {
  var synth = window.speechSynthesis;
  var voicesRef = useRef([]);

  useEffect(function () {
    if (!synth) return;
    var refresh = function () { voicesRef.current = synth.getVoices() || []; };
    refresh();
    synth.onvoiceschanged = refresh;
    return function () { synth.onvoiceschanged = null; };
  }, []);

  var getBestVoice = function () {
    var voices = voicesRef.current.length ? voicesRef.current : (synth.getVoices() || []);
    var preferred = [
      "Microsoft Ryan Online (Natural) - English (United Kingdom)",
      "Microsoft Thomas Online (Natural) - English (United Kingdom)",
      "Google UK English Male",
      "Daniel (Enhanced)",
      "Daniel",
      "Arthur",
      "Oliver",
      "Alex",
    ];
    for (var i = 0; i < preferred.length; i++) {
      var exact = voices.find(function (v) { return v.name === preferred[i]; });
      if (exact) return exact;
    }
    var gbMale = voices.find(function (v) {
      return v.lang === "en-GB" && !/female|samantha|karen|serena|fiona|moira/i.test(v.name);
    });
    if (gbMale) return gbMale;
    var gb = voices.find(function (v) { return v.lang === "en-GB"; });
    if (gb) return gb;
    return voices.find(function (v) { return v.lang && v.lang.startsWith("en"); }) || voices[0] || null;
  };

  // Chrome cuts speech off after ~15 seconds unless the utterance is split.
  var speak = function (text, onEnd) {
    if (!synth) { if (onEnd) onEnd(); return; }
    synth.cancel();
    var voice = getBestVoice();
    var chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
    var index = 0;
    var next = function () {
      if (index >= chunks.length) { if (onEnd) onEnd(); return; }
      var utt = new SpeechSynthesisUtterance(chunks[index].trim());
      utt.rate = 0.96;
      utt.pitch = 0.8;
      utt.volume = 1;
      if (voice) utt.voice = voice;
      utt.onend = function () { index += 1; next(); };
      utt.onerror = function () { index += 1; next(); };
      synth.speak(utt);
    };
    next();
  };

  var stop = function () { if (synth) synth.cancel(); };
  var isSpeaking = function () { return synth ? synth.speaking : false; };
  return { speak, stop, isSpeaking };
}

function JarvisButton({ briefing }) {
  var [speaking, setSpeaking] = useState(false);
  var jarvis = useJarvis();
  var toggle = function () {
    if (jarvis.isSpeaking()) { jarvis.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    jarvis.speak(briefing(), function () { setSpeaking(false); });
  };
  return (
    <button onClick={toggle} title={speaking ? "Stop briefing" : "Get daily briefing"}
      className={"flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border " +
        (speaking ? "bg-primary/10 text-primary border-primary/30 animate-pulse"
          : "bg-background text-muted-foreground border-border hover:border-primary/30 hover:text-primary")}>
      {speaking ? <><Volume2 className="w-3.5 h-3.5" /> Speaking…</> : <><Mic className="w-3.5 h-3.5" /> Briefing</>}
    </button>
  );
}

/* ───────────────────────── Dashboard ───────────────────────── */

export default function Dashboard() {
  var ctx = useCompany();
  var companyId = ctx.companyId, activeStoreId = ctx.activeStoreId, companyLoading = ctx.loading;

  var [period, setPeriod] = useState("month");
  var [trendMode, setTrendMode] = useState("revenue");
  var [memFrom, setMemFrom] = useState(""); // member join-date filter (yyyy-mm-dd), blank = all members
  var [memTo, setMemTo] = useState("");
  var [loading, setLoading] = useState(true);
  var [refreshing, setRefreshing] = useState(false);
  var [loadedAt, setLoadedAt] = useState(null);
  var [, tick] = useState(0);

  var [me, setMe] = useState(null);
  var [company, setCompany] = useState(null);
  var [storeName, setStoreName] = useState(null);
  var [orders, setOrders] = useState([]);
  var [unpaid, setUnpaid] = useState([]);
  var [refunds, setRefunds] = useState([]);
  var [sessions, setSessions] = useState([]);
  var [openSessions, setOpenSessions] = useState([]);
  var [expenses, setExpenses] = useState([]);
  var [inventory, setInventory] = useState([]);
  var [members, setMembers] = useState([]);
  var [suppliersOwed, setSuppliersOwed] = useState(0);

  var [customFrom, setCustomFrom] = useState(""); // top-bar custom range (yyyy-mm-dd)
  var [customTo, setCustomTo] = useState("");

  var range = useMemo(function () {
    if (period !== "custom") return getRange(period);
    var end = customTo ? new Date(customTo + "T23:59:59.999") : new Date();
    if (!customTo) end.setHours(23, 59, 59, 999);
    var start = customFrom ? new Date(customFrom + "T00:00:00") : new Date(end.getTime() - 29 * 86400000);
    if (!customFrom) start.setHours(0, 0, 0, 0);
    if (start > end) { var t = start; start = new Date(end); end = t; }
    return { start: start, end: end };
  }, [period, customFrom, customTo]);
  var prevRange = useMemo(function () { return getPrevRange(period, range); }, [period, range]);

  // Always load at least 30 days so days-of-supply and trends have history.
  var fetchStart = useMemo(function () {
    var s = new Date(range.start);
    var d30 = new Date(); d30.setHours(0, 0, 0, 0); d30.setDate(d30.getDate() - 29);
    return s < d30 ? s : d30;
  }, [range]);

  var load = useCallback(async function (soft) {
    if (!companyId) return;
    soft ? setRefreshing(true) : setLoading(true);
    var since = fetchStart.toISOString();
    var scope = function (q) { return activeStoreId ? q.eq("store_id", activeStoreId) : q; };
    try {
      var res = await Promise.all([
        supabase.auth.getUser().then(async function (r) {
          var uid = r.data?.user?.id;
          if (!uid) return null;
          var p = await supabase.from("profiles").select("full_name, role, email").eq("id", uid).maybeSingle();
          return p.data || { email: r.data.user.email };
        }),
        supabase.from("companies").select("company_name, trading_name, status, subscription_status").eq("id", companyId).maybeSingle().then(function (r) { return r.data; }),
        activeStoreId
          ? supabase.from("stores").select("name").eq("id", activeStoreId).maybeSingle().then(function (r) { return r.data?.name || null; })
          : Promise.resolve(null),
        fetchAllPaged(function (a, b) {
          return scope(supabase.from("orders")
            .select("id, total_amount, payment_method, payment_details, status, items, created_at, cashier_session_id, refund_total")
            .eq("company_id", companyId).gte("created_at", since)
            .order("created_at", { ascending: false })).range(a, b);
        }),
        fetchAllPaged(function (a, b) {
          return scope(supabase.from("orders").select("id, total_amount, created_at, member_name")
            .eq("company_id", companyId).eq("status", "unpaid")
            .order("created_at", { ascending: false })).range(a, b);
        }),
        fetchAllPaged(function (a, b) {
          return scope(supabase.from("refunds").select("id, total_amount, payment_method, created_at")
            .eq("company_id", companyId).gte("created_at", since)
            .order("created_at", { ascending: false })).range(a, b);
        }),
        fetchAllPaged(function (a, b) {
          return scope(supabase.from("cashier_sessions")
            .select("id, cashier_name, status, opening_time, closing_time, total_sales, total_orders, cash_variance, card_variance")
            .eq("company_id", companyId).gte("opening_time", since)
            .order("opening_time", { ascending: false })).range(a, b);
        }),
        scope(supabase.from("cashier_sessions").select("id, cashier_name, opening_time, store_id")
          .eq("company_id", companyId).eq("status", "open")
          .order("opening_time", { ascending: false }).limit(20)).then(function (r) { return r.data || []; }),
        fetchAllPaged(function (a, b) {
          return scope(supabase.from("expenses").select("id, amount, date, created_at, category, expense_category")
            .eq("company_id", companyId).gte("created_at", new Date(range.start.getTime() - 86400000 * 62).toISOString())
            .order("created_at", { ascending: false })).range(a, b);
        }),
        fetchAllPaged(function (a, b) {
          return scope(supabase.from("store_inventory")
            .select("id, product_id, store_id, stock_quantity, low_stock_threshold, cost_price, price, products(name, cost_price, price, low_stock_threshold, is_active, unit_weight)")
            .eq("company_id", companyId)
            .order("id", { ascending: true })).range(a, b);
        }),
        fetchAllPaged(function (a, b) {
          return supabase.from("members")
            .select("id, status, is_active, is_banned, expiry_date, created_at, membership_start_date, registration_date, id_document_url, fica_status")
            .eq("company_id", companyId)
            .order("id", { ascending: true }).range(a, b);
        }),
        supabase.from("suppliers").select("total_owed").eq("company_id", companyId).then(function (r) {
          return (r.data || []).reduce(function (s, x) { return s + num(x.total_owed); }, 0);
        }),
      ]);
      setMe(res[0]); setCompany(res[1]); setStoreName(res[2]);
      setOrders(res[3]); setUnpaid(res[4]); setRefunds(res[5]);
      setSessions(res[6]); setOpenSessions(res[7]); setExpenses(res[8]);
      setInventory(res[9]); setMembers(res[10]); setSuppliersOwed(res[11]);
      setLoadedAt(new Date());
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [companyId, activeStoreId, fetchStart, range]);

  useEffect(function () { load(false); }, [load]);
  useEffect(function () { var t = setInterval(function () { tick(function (n) { return n + 1; }); }, 60000); return function () { clearInterval(t); }; }, []);

  /* ───── derived figures ───── */

  var m = useMemo(function () {
    var completed = orders.filter(function (o) { return o.status === "completed"; });
    var periodOrders = completed.filter(function (o) { return inRange(o.created_at, range); });

    // cost map for COGS fallback when a line has no cost snapshot
    var costMap = {};
    inventory.forEach(function (r) { costMap[r.product_id] = num(r.cost_price ?? r.products?.cost_price); });

    var gross = 0, cogs = 0, unitsPeriod = 0;
    periodOrders.forEach(function (o) {
      gross += num(o.total_amount);
      parseItems(o.items).forEach(function (it) {
        var q = num(it.quantity || 1);
        unitsPeriod += q;
        cogs += (it.cost_price != null ? num(it.cost_price) : num(costMap[it.product_id])) * q;
      });
    });

    // Refunds: new-model refunds rows + legacy status='refunded' orders in the period
    var periodRefundRows = refunds.filter(function (r) { return inRange(r.created_at, range); });
    var legacyRefunded = orders.filter(function (o) { return o.status === "refunded" && inRange(o.created_at, range); });
    var refundTotal = periodRefundRows.reduce(function (s, r) { return s + num(r.total_amount); }, 0)
      + legacyRefunded.reduce(function (s, o) { return s + num(o.total_amount); }, 0);
    var refundCount = periodRefundRows.length + legacyRefunded.length;

    var periodExpenses = expenses.filter(function (e) {
      var d = e.date ? new Date(e.date + "T12:00:00") : new Date(e.created_at);
      return d >= range.start && d <= range.end;
    });
    var expenseTotal = periodExpenses.reduce(function (s, e) { return s + num(e.amount); }, 0);

    var netSales = gross - refundTotal;
    var grossProfit = netSales - cogs;
    var netProfit = grossProfit - expenseTotal;
    var outstanding = unpaid.reduce(function (s, o) { return s + num(o.total_amount); }, 0);

    // Payment methods
    var methods = {};
    periodOrders.forEach(function (o) {
      paymentBreakdown(o).forEach(function (p) {
        var k = methodKey(p.method);
        methods[k] = (methods[k] || 0) + p.amount;
      });
    });
    var methodList = Object.keys(methods).map(function (k) { return { key: k, value: methods[k], ...METHOD_META[k] }; })
      .filter(function (x) { return x.value > 0; }).sort(function (a, b) { return b.value - a.value; });
    var methodTotal = methodList.reduce(function (s, x) { return s + x.value; }, 0);

    // Sessions
    var periodSessions = sessions.filter(function (s) { return inRange(s.opening_time, range); });
    var closedSessions = periodSessions.filter(function (s) { return s.status === "closed"; });
    var sessionsWithSales = new Set(periodOrders.map(function (o) { return o.cashier_session_id; }).filter(Boolean)).size;
    var avgPerSession = periodSessions.length ? gross / periodSessions.length : 0;
    var variance = closedSessions.reduce(function (s, x) { return s + num(x.cash_variance); }, 0);

    // Daily trend
    var days = [];
    var cur = new Date(range.start); cur.setHours(0, 0, 0, 0);
    var endDay = new Date(range.end); endDay.setHours(0, 0, 0, 0);
    if (period === "today") {
      for (var h = 0; h < 24; h++) days.push({ key: h, label: String(h).padStart(2, "0") + "h", revenue: 0, orders: 0 });
      periodOrders.forEach(function (o) { var hh = new Date(o.created_at).getHours(); days[hh].revenue += num(o.total_amount); days[hh].orders += 1; });
    } else {
      var idx = {};
      while (cur <= endDay) {
        var k = cur.toDateString();
        idx[k] = days.length;
        days.push({ key: k, label: cur.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }), revenue: 0, orders: 0 });
        cur.setDate(cur.getDate() + 1);
      }
      periodOrders.forEach(function (o) {
        var i = idx[new Date(o.created_at).toDateString()];
        if (i != null) { days[i].revenue += num(o.total_amount); days[i].orders += 1; }
      });
    }

    // Busy-hours heatmap (weekday × hour), from sales in the period
    var heat = Array.from({ length: 7 }, function () { return new Array(24).fill(0); });
    periodOrders.forEach(function (o) { var d = new Date(o.created_at); heat[d.getDay()][d.getHours()] += 1; });
    var heatMax = Math.max(1, ...heat.flat());

    // Inventory
    var d30 = new Date(); d30.setHours(0, 0, 0, 0); d30.setDate(d30.getDate() - 29);
    var sold30 = {};
    var units30 = 0;
    completed.forEach(function (o) {
      if (new Date(o.created_at) < d30) return;
      parseItems(o.items).forEach(function (it) {
        var q = num(it.quantity || 1);
        sold30[it.product_id] = (sold30[it.product_id] || 0) + q;
        units30 += q;
      });
    });
    var activeInv = inventory.filter(function (r) { return r.products ? r.products.is_active !== false : true; });
    var onHand = 0, costValue = 0, retailValue = 0, low = [], outOfStock = 0, negative = 0;
    activeInv.forEach(function (r) {
      var q = num(r.stock_quantity);
      var cost = num(r.cost_price ?? r.products?.cost_price);
      var price = num(r.price ?? r.products?.price);
      var thr = num(r.low_stock_threshold ?? r.products?.low_stock_threshold) || 5;
      if (q > 0) { onHand += q; costValue += q * cost; retailValue += q * price; }
      if (q < 0) negative += 1;
      if (q <= 0) outOfStock += 1;
      else if (q <= thr) {
        var daily = (sold30[r.product_id] || 0) / 30;
        low.push({ id: r.id, name: r.products?.name || "Unnamed product", qty: q, days: daily > 0 ? Math.floor(q / daily) : null });
      }
    });
    low.sort(function (a, b) { return (a.days ?? 9999) - (b.days ?? 9999) || a.qty - b.qty; });
    var avgDailyUnits = units30 / 30;
    var daysSupply = avgDailyUnits > 0 ? Math.floor(onHand / avgDailyUnits) : null;

    // Members
    var today0 = new Date(); today0.setHours(0, 0, 0, 0);

    // Optional join-date filter for the member tiles. Blank = every member.
    var memFiltered = !!(memFrom || memTo);
    var cohortStart = memFrom ? new Date(memFrom + "T00:00:00") : null;
    var cohortEnd = memTo ? new Date(memTo + "T23:59:59.999") : null;
    var inCohort = function (jd) {
      if (cohortStart && jd < cohortStart) return false;
      if (cohortEnd && jd > cohortEnd) return false;
      return true;
    };

    var mTotal = 0, mValid = 0, mExpired = 0, mPending = 0, mBanned = 0, idDocs = 0;
    var mNew = 0, mNewPrev = 0, mNewSuspect = 0, mDateSuspect = 0, expiring30 = 0;
    var lim30 = new Date(today0); lim30.setDate(lim30.getDate() + 30);

    // Signups by month — last 6 months including the current one, by join date.
    // Always shows every member so the trend stays readable while a filter is set.
    var signupMonths = [];
    var monthIdx = {};
    for (var i6 = 5; i6 >= 0; i6--) {
      var md = new Date(today0.getFullYear(), today0.getMonth() - i6, 1);
      var mk = md.getFullYear() + "-" + md.getMonth();
      monthIdx[mk] = signupMonths.length;
      signupMonths.push({
        key: mk,
        label: md.toLocaleDateString("en-ZA", { month: "short" }),
        full: md.toLocaleDateString("en-ZA", { month: "long", year: "numeric" }),
        signups: 0,
      });
    }

    members.forEach(function (x) {
      var jd = joinDate(x);
      var suspect = joinDateSuspect(x);
      var mi = monthIdx[jd.getFullYear() + "-" + jd.getMonth()];
      if (mi != null) signupMonths[mi].signups += 1;

      if (!inCohort(jd)) return;
      mTotal += 1;
      if (suspect) mDateSuspect += 1;
      if (jd >= range.start && jd <= range.end) { mNew += 1; if (suspect) mNewSuspect += 1; }
      if (jd >= prevRange.start && jd <= prevRange.end) mNewPrev += 1;

      if (x.is_banned) { mBanned += 1; return; }
      if (x.status === "pending") mPending += 1;
      var expired = x.expiry_date && new Date(x.expiry_date + "T23:59:59") < today0;
      if (expired) mExpired += 1;
      else if (x.status !== "pending" && x.is_active !== false) mValid += 1;
      if (x.id_document_url) idDocs += 1;
      if (x.expiry_date) {
        var ed = new Date(x.expiry_date + "T00:00:00");
        if (ed >= today0 && ed <= lim30) expiring30 += 1;
      }
    });
    var signupAvg = signupMonths.slice(0, 5).reduce(function (s, x) { return s + x.signups; }, 0) / 5;

    return {
      periodOrders, gross, cogs, unitsPeriod, refundTotal, refundCount, expenseTotal, periodExpenses,
      netSales, grossProfit, netProfit, outstanding, methodList, methodTotal,
      periodSessions, closedSessions, sessionsWithSales, avgPerSession, variance,
      days, heat, heatMax,
      onHand, costValue, retailValue, low, outOfStock, negative, daysSupply, avgDailyUnits, skuCount: activeInv.length,
      mTotal, mValid, mExpired, mPending, mBanned, mNew, mNewPrev, mNewSuspect, mDateSuspect, idDocs, expiring30,
      signupMonths, signupAvg, memFiltered,
    };
  }, [orders, unpaid, refunds, sessions, expenses, inventory, members, range, prevRange, period, memFrom, memTo]);

  var briefing = function () {
    var hour = new Date().getHours();
    var greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    var day = new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
    var club = (company?.trading_name || company?.company_name || "the club");
    var lines = [];
    lines.push(greet + ", sir. " + club + " systems online.");
    lines.push("Club briefing for " + day + ".");
    lines.push("Sales for the selected period stand at " + speakRands(m.netSales) + " from " + m.periodOrders.length + " transaction" + (m.periodOrders.length === 1 ? "" : "s") + ".");
    lines.push("Gross profit is " + speakRands(m.grossProfit) + ". Net profit after expenses, " + speakRands(m.netProfit) + ".");
    if (m.outstanding > 0) lines.push("Members owe " + speakRands(m.outstanding) + " on account.");
    lines.push(openSessions.length ? openSessions.length + " register session" + (openSessions.length > 1 ? "s are" : " is") + " currently open." : "No register sessions are open.");
    if (m.daysSupply != null) lines.push("Stock on hand covers about " + m.daysSupply + " days.");
    lines.push(m.low.length ? m.low.length + " product" + (m.low.length === 1 ? " is" : "s are") + " running low. I would attend to that, sir." : "Stock levels look healthy.");
    if (m.negative > 0) lines.push("Flagging " + m.negative + " product" + (m.negative === 1 ? "" : "s") + " in negative stock.");
    lines.push(m.mNew + " new member" + (m.mNew === 1 ? "" : "s") + " signed up this period.");
    lines.push(m.mValid + " members are valid, " + m.mExpired + " have expired, and " + m.mPending + " application" + (m.mPending === 1 ? " is" : "s are") + " pending.");
    lines.push("That is everything. I will be here if you need me.");
    return lines.join(" ");
  };

  if (companyLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  var hour = new Date().getHours();
  var greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  var firstName = (me?.full_name || me?.email || "").split(/[\s@]/)[0];
  var clubName = company?.trading_name || company?.company_name || "Club";
  var roleLabel = me?.role ? me.role.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : null;
  var periodLabel = range.start.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) +
    (period === "today" ? "" : " – " + range.end.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }));
  var updated = agoLabel(loadedAt);
  var refresh = function () { load(true); };
  var margin = m.netSales > 0 ? pct(m.grossProfit, m.netSales) : 0;
  var idIncomplete = m.mTotal - m.idDocs;
  var newDelta = m.mNew - m.mNewPrev;
  var prevLabel = period === "today" ? "yesterday" : period === "month" ? "last month (same days)" : period === "custom" ? "the range before" : "previous " + period;
  var memLabel = m.memFiltered
    ? "Joined " + (memFrom ? new Date(memFrom + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "the beginning")
      + " – " + (memTo ? new Date(memTo + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "today")
    : updated;
  var dateInput = "w-full bg-background border border-border rounded-md px-2 py-1 text-xs";

  return (
    <div className="space-y-5">
      {/* ── Greeting band ── */}
      <div className="rounded-xl bg-muted/60 border border-border px-5 py-4">
        <h1 className="text-xl font-bold">{greeting}{firstName ? ", " + firstName : ""}!</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{storeName || "All branches"}</p>
        {roleLabel && <p className="text-xs font-semibold">{roleLabel}</p>}
      </div>

      {/* ── Title + period control ── */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-1.5">
            {clubName}{storeName ? " " + storeName : ""} Dashboard
            {company?.status === "active" && <BadgeCheck className="w-5 h-5 text-emerald-600" />}
          </h2>
          <p className="text-xs text-muted-foreground">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-muted/60 rounded-lg p-0.5">
            {PERIODS.map(function (p) {
              return (
                <button key={p.key} onClick={function () { setPeriod(p.key); setCustomFrom(""); setCustomTo(""); }}
                  className={"px-2.5 py-1 rounded-md text-xs font-medium transition-colors " +
                    (period === p.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className={"flex items-center gap-1 rounded-lg p-0.5 border " + (period === "custom" ? "border-primary bg-primary/10" : "border-border bg-muted/60")}>
            <input type="date" title="From" value={customFrom} max={customTo || undefined}
              onChange={function (e) { setCustomFrom(e.target.value); setPeriod(e.target.value || customTo ? "custom" : "month"); }}
              className="bg-transparent text-xs px-1.5 py-1 rounded-md outline-none w-[7.5rem]" />
            <span className="text-[10px] text-muted-foreground">to</span>
            <input type="date" title="To" value={customTo} min={customFrom || undefined}
              onChange={function (e) { setCustomTo(e.target.value); setPeriod(e.target.value || customFrom ? "custom" : "month"); }}
              className="bg-transparent text-xs px-1.5 py-1 rounded-md outline-none w-[7.5rem]" />
            {period === "custom" && (
              <button title="Clear range" onClick={function () { setCustomFrom(""); setCustomTo(""); setPeriod("month"); }}
                className="p-1 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
            )}
          </div>
          <JarvisButton briefing={briefing} />
        </div>
      </div>

      {/* ── Four columns ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">

        {/* ═════ Financial Overview ═════ */}
        <Panel title="Financial Overview" subtitle={updated} onRefresh={refresh} refreshing={refreshing}>
          <Eyebrow>Current period</Eyebrow>

          <Box tone="green">
            <div className="flex items-center justify-between">
              <Eyebrow className="!text-emerald-800 dark:!text-emerald-300">Net Sales</Eyebrow>
              <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(m.netSales)}</span>
            </div>
            <div className="border-t border-emerald-300/60 mt-2 pt-1.5">
              <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                {formatCurrency(m.gross)} sales less {formatCurrency(m.refundTotal)} refunds
              </p>
            </div>
          </Box>

          <Box className="space-y-2.5">
            <Row label="COST OF SALES" value={formatCurrency(m.cogs)} strong />
            <div className="border-t border-border" />
            <Row label="GROSS PROFIT" value={<>{formatCurrency(m.grossProfit)} <span className="text-[10px] text-muted-foreground font-normal">({margin}%)</span></>} strong />
            <div className="border-t border-border" />
            <Row label="EXPENSES" value={formatCurrency(m.expenseTotal)} strong />
          </Box>

          <Box tone={m.netProfit >= 0 ? "solid" : "red"}>
            <div className="flex items-center justify-between">
              <span className={"text-[11px] font-bold uppercase tracking-wider " + (m.netProfit >= 0 ? "" : "text-red-700 dark:text-red-400")}>Net Profit</span>
              <span className={"text-xl font-bold tabular-nums " + (m.netProfit >= 0 ? "" : "text-red-700 dark:text-red-400")}>{formatCurrency(m.netProfit)}</span>
            </div>
          </Box>

          <Box className="space-y-2">
            <p className="text-xs font-semibold">Money Owed</p>
            <Link to="/orders" className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-2 text-xs hover:bg-muted transition-colors">
              <span className="flex items-center gap-2"><Wallet className="w-3.5 h-3.5 text-blue-500" /> On Account (to you)</span>
              <span className="flex items-center gap-1 tabular-nums font-medium">{formatCurrency(m.outstanding)}<ChevronRight className="w-3 h-3 text-muted-foreground" /></span>
            </Link>
            <Link to="/supplier-payments" className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-2 text-xs hover:bg-muted transition-colors">
              <span className="flex items-center gap-2"><Truck className="w-3.5 h-3.5 text-orange-500" /> Suppliers (by you)</span>
              <span className="flex items-center gap-1 tabular-nums font-medium">{formatCurrency(suppliersOwed)}<ChevronRight className="w-3 h-3 text-muted-foreground" /></span>
            </Link>
            <p className="text-[10px] text-muted-foreground">{unpaid.length} unpaid account sale{unpaid.length === 1 ? "" : "s"}</p>
          </Box>
        </Panel>

        {/* ═════ POS Overview ═════ */}
        <Panel title="POS Overview" subtitle={updated} onRefresh={refresh} refreshing={refreshing}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Register Reporting</p>
            <Link to="/reports" className="text-[11px] text-blue-600 hover:underline">View Details →</Link>
          </div>
          <Box tone="solid">
            <Eyebrow className="!text-primary-foreground/80">{period === "today" ? "Today" : "This period"}</Eyebrow>
            <p className="text-2xl font-bold tabular-nums mt-0.5">{formatCurrency(m.gross)}</p>
            <p className="text-[11px] opacity-90">{m.periodOrders.length} sale{m.periodOrders.length === 1 ? "" : "s"} · {fmtNum(m.unitsPeriod, 1)} units</p>
          </Box>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs font-semibold">POS Session Management</p>
            <Link to="/cashier-sessions" className="text-[11px] text-blue-600 hover:underline">View Sessions →</Link>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Sessions" value={m.periodSessions.length} sub="this period" />
            <MiniStat label="Avg / Session" value={compactR(m.avgPerSession)} sub="average" />
            <MiniStat label="Refunds" value={m.refundCount} sub={compactR(m.refundTotal)} />
          </div>
          {m.closedSessions.length > 0 && (
            <Row label="Cash variance (closed sessions)"
              value={<span className={m.variance < 0 ? "text-red-600" : m.variance > 0 ? "text-amber-600" : "text-emerald-600"}>{formatCurrency(m.variance)}</span>} />
          )}

          <Box tone={openSessions.length ? "green" : "plain"} className="space-y-1.5">
            <Eyebrow className={openSessions.length ? "!text-emerald-800 dark:!text-emerald-300" : ""}>Open Sessions ({openSessions.length})</Eyebrow>
            {openSessions.length === 0 && <p className="text-xs text-muted-foreground">No registers open.</p>}
            {openSessions.slice(0, 5).map(function (s) {
              var stale = Date.now() - new Date(s.opening_time).getTime() > 16 * 3600000;
              return (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">{s.cashier_name || "Cashier"} <span className="text-muted-foreground">· {durationSince(s.opening_time)}</span></span>
                  <span className={"text-[10px] font-bold px-2 py-0.5 rounded " + (stale ? "bg-amber-500 text-white" : "bg-primary text-primary-foreground")}>
                    {stale ? "NOT CLOSED" : "OPEN"}
                  </span>
                </div>
              );
            })}
            {openSessions.length > 5 && <p className="text-[10px] text-muted-foreground">+{openSessions.length - 5} more</p>}
          </Box>

          <Box>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold">Payment Methods</p>
              <span className="text-[10px] text-muted-foreground">This period</span>
            </div>
            {m.methodList.length === 0 ? <p className="text-xs text-muted-foreground">No sales yet.</p> : (
              <div className="flex items-center gap-3">
                <div className="w-24 h-24 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={m.methodList} dataKey="value" innerRadius={28} outerRadius={44} paddingAngle={1} stroke="none" isAnimationActive={false}>
                        {m.methodList.map(function (x) { return <Cell key={x.key} fill={x.color} />; })}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5 min-w-0">
                  {m.methodList.map(function (x) {
                    return (
                      <div key={x.key} className="flex items-start justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 truncate"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: x.color }} />{x.label}</span>
                        <span className="text-right leading-tight">
                          <span className="font-semibold block">{pct(x.value, m.methodTotal)}%</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{formatCurrency(x.value)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Box>

          <Box>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold">{period === "today" ? "Sales by Hour" : "Sales Trend"}</p>
              <div className="flex gap-2">
                {["revenue", "orders"].map(function (k) {
                  return <button key={k} onClick={function () { setTrendMode(k); }}
                    className={"text-[11px] " + (trendMode === k ? "text-blue-600 font-semibold" : "text-muted-foreground hover:text-foreground")}>
                    {k === "revenue" ? "Revenue" : "Sales"}</button>;
                })}
              </div>
            </div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={m.days} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5b8a3a" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#5b8a3a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                    tickFormatter={function (v) { return trendMode === "revenue" ? (v >= 1000 ? "R" + Math.round(v / 1000) + "k" : "R" + v) : v; }} />
                  <Tooltip formatter={function (v) { return trendMode === "revenue" ? formatCurrency(v) : v + " sales"; }}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Area type="monotone" dataKey={trendMode} stroke="#5b8a3a" strokeWidth={2} fill="url(#dashTrend)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Box>
        </Panel>

        {/* ═════ Inventory Overview ═════ */}
        <Panel title="Inventory Overview" subtitle={updated} onRefresh={refresh} refreshing={refreshing}>
          <Box tone={m.negative > 0 ? "red" : "green"}>
            <Eyebrow className={m.negative > 0 ? "!text-red-700 dark:!text-red-400" : "!text-emerald-800 dark:!text-emerald-300"}>Stock Value (at cost)</Eyebrow>
            <p className={"text-2xl font-bold tabular-nums mt-0.5 " + (m.negative > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>{formatCurrency(m.costValue)}</p>
            <div className="mt-2 space-y-1">
              <Row label="Retail value" value={formatCurrency(m.retailValue)} />
              <Row label="Potential margin" value={formatCurrency(m.retailValue - m.costValue)} />
              {m.negative > 0 && <Row label="Products in negative stock" value={<span className="text-red-600 font-semibold">{m.negative}</span>} />}
            </div>
          </Box>

          <Box>
            <Eyebrow>On Hand</Eyebrow>
            <p className="text-2xl font-bold tabular-nums mt-0.5">{fmtNum(m.onHand, 1)} <span className="text-sm font-medium text-muted-foreground">units</span></p>
            <div className="mt-2 space-y-1">
              <Row label="Active products" value={m.skuCount} />
              <Row label="Sold this period" value={fmtNum(m.unitsPeriod, 1) + " units"} />
              <Row label="Avg sold / day (30d)" value={fmtNum(m.avgDailyUnits, 1) + " units"} />
            </div>
          </Box>

          <Box>
            <div className="flex items-center justify-between mb-1.5">
              <Eyebrow>Running Low</Eyebrow>
              <Link to="/inventory" className="text-[11px] text-blue-600 hover:underline">View All →</Link>
            </div>
            {m.low.length === 0 ? <p className="text-xs text-muted-foreground">Nothing below its threshold.</p> : (
              <div className="space-y-1.5">
                {m.low.slice(0, 5).map(function (p) {
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{p.name}</span>
                      <span className="whitespace-nowrap tabular-nums">
                        {fmtNum(p.qty, 1)}
                        {p.days != null && <span className={"ml-1.5 text-[10px] " + (p.days <= 3 ? "text-red-600 font-semibold" : "text-muted-foreground")}>{p.days}d left</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Box>

          <div className="grid grid-cols-3 gap-2">
            <Box tone={m.daysSupply == null ? "plain" : m.daysSupply < 7 ? "red" : m.daysSupply < 14 ? "amber" : "green"} className="text-center px-1">
              <p className="text-[9px] font-semibold uppercase tracking-wider flex items-center justify-center gap-1"><Clock className="w-3 h-3" />Days Supply</p>
              <p className="text-xl font-bold tabular-nums mt-1">{m.daysSupply ?? "—"}</p>
              <p className="text-[10px] text-muted-foreground">remaining</p>
            </Box>
            <Box tone={m.low.length ? "amber" : "plain"} className="text-center px-1">
              <p className="text-[9px] font-semibold uppercase tracking-wider flex items-center justify-center gap-1"><AlertTriangle className="w-3 h-3" />Low</p>
              <p className="text-xl font-bold tabular-nums mt-1">{m.low.length}</p>
              <p className="text-[10px] text-muted-foreground">products</p>
            </Box>
            <Box tone={m.outOfStock ? "red" : "plain"} className="text-center px-1">
              <p className="text-[9px] font-semibold uppercase tracking-wider flex items-center justify-center gap-1 text-red-600"><PackageX className="w-3 h-3" />Out</p>
              <p className="text-xl font-bold tabular-nums mt-1">{m.outOfStock}</p>
              <p className="text-[10px] text-muted-foreground">products</p>
            </Box>
          </div>
        </Panel>

        {/* ═════ Member Overview ═════ */}
        <Panel title="Member Overview" subtitle={memLabel} onRefresh={refresh} refreshing={refreshing}>
          {/* Join-date range filter */}
          <Box className="space-y-2">
            <div className="flex items-center justify-between">
              <Eyebrow>Filter by join date</Eyebrow>
              {m.memFiltered && (
                <button onClick={function () { setMemFrom(""); setMemTo(""); }}
                  className="text-[11px] text-blue-600 hover:underline flex items-center gap-0.5">
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-muted-foreground">From
                <input type="date" className={dateInput + " mt-0.5"} value={memFrom} max={memTo || undefined}
                  onChange={function (e) { setMemFrom(e.target.value); }} />
              </label>
              <label className="text-[10px] text-muted-foreground">To
                <input type="date" className={dateInput + " mt-0.5"} value={memTo} min={memFrom || undefined}
                  onChange={function (e) { setMemTo(e.target.value); }} />
              </label>
            </div>
            {m.memFiltered && <p className="text-[10px] text-muted-foreground">Counts below only include members who joined in this range.</p>}
          </Box>

          <div className="grid grid-cols-3 gap-2">
            <CountTile value={fmtNum(m.mTotal)} label="Total" icon={Users} tone="solid" />
            <CountTile value={fmtNum(m.mValid)} label="Valid" icon={UserCheck} tone="green" />
            <CountTile value={fmtNum(m.mExpired)} label="Expired" icon={UserX} tone="red" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CountTile value={fmtNum(m.mPending)} label="Pending Applications" tone="amber" />
            <CountTile value={fmtNum(m.mNew)} label="New this period" icon={UserPlus} tone="plain"
              sub={
                <p title={"vs " + prevLabel + ": " + m.mNewPrev}
                  className={"text-[10px] mt-1 tabular-nums " + (newDelta > 0 ? "text-emerald-600" : newDelta < 0 ? "text-red-600" : "text-muted-foreground")}>
                  {newDelta > 0 ? "▲ " + newDelta : newDelta < 0 ? "▼ " + Math.abs(newDelta) : "="} vs {period === "today" ? "yesterday" : "prev."}
                </p>
              } />
          </div>

          <Box>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold">New Members by Month</p>
              <span className="text-[10px] text-muted-foreground">by join date · all members</span>
            </div>
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.signupMonths} margin={{ top: 14, right: 2, left: 2, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={0} />
                  <Tooltip cursor={{ fill: "rgba(91,138,58,0.08)" }}
                    formatter={function (v) { return [v + " new member" + (v === 1 ? "" : "s"), ""]; }}
                    labelFormatter={function (l, p) { return p && p[0] ? p[0].payload.full : l; }}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Bar dataKey="signups" radius={[3, 3, 0, 0]} isAnimationActive={false}
                    label={{ position: "top", fontSize: 9, fill: "currentColor" }}>
                    {m.signupMonths.map(function (x, i) {
                      return <Cell key={x.key} fill={i === m.signupMonths.length - 1 ? "#5b8a3a" : "rgba(91,138,58,0.45)"} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Row className="mt-1.5" label="5-month average" value={fmtNum(m.signupAvg, 1) + " / month"} />
            {m.mDateSuspect > 0 && (
              <p className="text-[10px] text-amber-600 mt-1.5 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                <span>{m.mDateSuspect} member{m.mDateSuspect === 1 ? " has a join date" : "s have join dates"} later than the record was created — check on the Members page.</span>
              </p>
            )}
          </Box>

          <Box>
            <p className="text-xs font-semibold mb-2">ID Document Tracking</p>
            <div className="grid grid-cols-2 gap-2">
              <CountTile value={fmtNum(m.idDocs)} label="Complete" tone="green" />
              <CountTile value={fmtNum(idIncomplete)} label="Incomplete" icon={idIncomplete ? FileWarning : null} tone="plain" />
            </div>
            <div className="h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: pct(m.idDocs, m.mTotal) + "%" }} />
            </div>
          </Box>

          <Box className="space-y-1.5">
            <Row label="Expiring in next 30 days" value={<span className={m.expiring30 ? "text-amber-600 font-semibold" : ""}>{fmtNum(m.expiring30)}</span>} />
            <Row label="Banned" value={fmtNum(m.mBanned)} />
            <Link to="/members" className="text-[11px] text-blue-600 hover:underline inline-block pt-0.5">View Members →</Link>
          </Box>

          <Box>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold">Busy Hours</p>
              <span className="text-[10px] text-muted-foreground">sales per hour</span>
            </div>
            <div className="space-y-[3px]">
              {[1, 2, 3, 4, 5, 6, 0].map(function (dow) {
                return (
                  <div key={dow} className="flex items-center gap-1">
                    <span className="w-6 text-[9px] text-muted-foreground">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow]}</span>
                    <div className="flex-1 grid gap-[2px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                      {m.heat[dow].map(function (v, h) {
                        var a = v / m.heatMax;
                        return <div key={h} title={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow] + " " + String(h).padStart(2, "0") + ":00 — " + v + " sales"}
                          className="h-2.5 rounded-[2px] bg-muted"
                          style={v ? { background: "rgba(91,138,58," + (0.15 + a * 0.85).toFixed(2) + ")" } : undefined} />;
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between pl-7 text-[9px] text-muted-foreground pt-0.5">
                <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>24h</span>
              </div>
            </div>
          </Box>
        </Panel>
      </div>
    </div>
  );
}