import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import {
  Download, Search, RefreshCw, ChevronDown, ChevronRight, Crown, AlertTriangle,
  Users, Repeat, ShoppingBasket, Percent,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "../../lib/currency";
import { useCompany } from "../../lib/CompanyContext";
import { cn } from "@/lib/utils";

// Owner / manager report: who the high-value customers are and how they buy.
// Data: report_customer_insights RPC (role + store scoped on the server).

const n = (v) => (typeof v === "number" ? v : Number(v || 0));
const money = (v) => formatCurrency(n(v));
const pct = (v) => (v === null || v === undefined ? "-" : n(v).toFixed(1) + "%");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hourLabel = (h) => {
  if (h === null || h === undefined) return "-";
  const x = Number(h);
  return (x % 12 === 0 ? 12 : x % 12) + (x < 12 ? "am" : "pm");
};
const payLabel = (p) => (p ? p.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "-");

const STATUS = {
  active:   { label: "Active",   cls: "bg-emerald-100 text-emerald-700" },
  at_risk:  { label: "At risk",  cls: "bg-red-100 text-red-700" },
  new:      { label: "New",      cls: "bg-blue-100 text-blue-700" },
  one_time: { label: "One-time", cls: "bg-slate-100 text-slate-600" },
};

const todayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};
const daysAgoStr = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

function toCSV(rows, headers) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map((h) => esc(h.label)).join(","),
    ...rows.map((r) => headers.map((h) => esc(h.get(r))).join(","))].join("\n");
}
function downloadCSV(filename, csv) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Card({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {Icon && <Icon className="w-3.5 h-3.5" />}{label}
      </div>
      <div className={cn("text-xl font-bold mt-1", tone)}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Panel({ title, subtitle, children, right }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// Horizontal bars. rows: [{label, a, b?}]  a = VIP value (highlighted), b = everyone value
function Bars({ rows, aLabel, bLabel, fmt }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(n(r.a), n(r.b))));
  return (
    <div className="space-y-1.5">
      {(aLabel || bLabel) && (
        <div className="flex gap-4 text-[11px] text-muted-foreground">
          {aLabel && <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />{aLabel}</span>}
          {bLabel && <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-muted-foreground/30 inline-block" />{bLabel}</span>}
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[110px_1fr_auto] gap-2 items-center text-xs">
          <span className="truncate text-muted-foreground" title={r.label}>{r.label}</span>
          <div className="space-y-0.5">
            {r.b !== undefined && (
              <div className="h-2 rounded bg-muted-foreground/30" style={{ width: (100 * n(r.b)) / max + "%" }} />
            )}
            <div className="h-2 rounded bg-primary" style={{ width: (100 * n(r.a)) / max + "%" }} />
          </div>
          <span className="tabular-nums text-right min-w-[64px]">{fmt ? fmt(r.a) : n(r.a)}</span>
        </div>
      ))}
    </div>
  );
}

function Compare({ label, a, b, fmt, higherBetter }) {
  const f = fmt || ((x) => x);
  const better = higherBetter === undefined ? null : higherBetter ? n(a) >= n(b) : n(a) <= n(b);
  return (
    <tr className="border-t">
      <td className="py-1.5 text-muted-foreground">{label}</td>
      <td className={cn("py-1.5 text-right font-medium tabular-nums", better && "text-emerald-600")}>{f(a)}</td>
      <td className="py-1.5 text-right tabular-nums">{f(b)}</td>
    </tr>
  );
}

function CustomerDetail({ c }) {
  const trend = n(c.spend_prev30) > 0 ? ((n(c.spend_30) - n(c.spend_prev30)) / n(c.spend_prev30)) * 100 : null;
  return (
    <div className="grid gap-4 md:grid-cols-3 p-4 bg-muted/30 text-xs">
      <div className="space-y-1">
        <p className="font-semibold text-sm">Profile</p>
        <p>Member #: <b>{c.membership_id || "-"}</b></p>
        <p>Phone: <b>{c.phone || "-"}</b> · Email: <b>{c.email || "-"}</b></p>
        <p>Joined: <b>{c.joined || "-"}</b></p>
        <p>Points: <b>{n(c.loyalty_points).toLocaleString()}</b> · Lifetime: <b>{n(c.lifetime_points).toLocaleString()}</b></p>
        <p>Store credit: <b>{money(c.store_credit)}</b></p>
        <p>First order: <b>{c.first_order}</b> · Last: <b>{c.last_order}</b> ({c.days_since}d ago)</p>
      </div>
      <div className="space-y-1">
        <p className="font-semibold text-sm">Buying pattern</p>
        <p>Visits: <b>{c.visit_days}</b> days · {c.orders} orders · {n(c.units)} items</p>
        <p>Comes in about every <b>{c.avg_gap ? n(c.avg_gap).toFixed(1) + " days" : "n/a (single visit day)"}</b></p>
        <p>Usually: <b>{DAYS[c.pref_dow] ?? "-"}</b> around <b>{hourLabel(c.pref_hour)}</b></p>
        <p>Pays by: <b>{payLabel(c.pref_pay)}</b> · Store: <b>{c.pref_store || "-"}</b></p>
        <p>Avg basket: <b>{money(c.avg_order)}</b></p>
        <p>Discounts: <b>{money(c.discounts)}</b> ({pct(c.discount_rate)}) · Refunds: <b>{money(c.refunded)}</b></p>
        <p>
          Last 30 days: <b>{money(c.spend_30)}</b> vs prior 30: <b>{money(c.spend_prev30)}</b>
          {trend !== null && (
            <span className={cn("ml-1 font-semibold", trend >= 0 ? "text-emerald-600" : "text-red-600")}>
              ({trend >= 0 ? "+" : ""}{trend.toFixed(0)}%)
            </span>
          )}
        </p>
      </div>
      <div className="space-y-2">
        <div>
          <p className="font-semibold text-sm">Favourite categories</p>
          {(c.top_categories || []).map((x, i) => (
            <p key={i} className="flex justify-between"><span>{x.name}</span><b>{money(x.revenue)} · {n(x.units)}u</b></p>
          ))}
        </div>
        <div>
          <p className="font-semibold text-sm">Top products</p>
          {(c.top_products || []).map((x, i) => (
            <p key={i} className="flex justify-between gap-2"><span className="truncate">{x.name}</span><b className="shrink-0">{money(x.revenue)} · {n(x.units)}u</b></p>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CustomerInsights() {
  const { companyId, stores, activeStoreId } = useCompany();

  const [from, setFrom] = useState(daysAgoStr(89));
  const [to, setTo] = useState(todayStr());
  const [vipPct, setVipPct] = useState(10);
  const [storeId, setStoreId] = useState(activeStoreId || "");
  useEffect(() => { setStoreId(activeStoreId || ""); }, [activeStoreId]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [vipOnly, setVipOnly] = useState(true);
  const [sortKey, setSortKey] = useState("rank");
  const [expanded, setExpanded] = useState({});

  const effectiveStore = storeId;

  const load = () => {
    if (!companyId || !from || !to) return;
    setLoading(true);
    setError(null);
    supabase
      .rpc("report_customer_insights", {
        p_from: from, p_to: to, p_store: effectiveStore || null, p_company: companyId,
        p_vip_pct: vipPct, p_top: 200,
      })
      .then(({ data, error }) => { if (error) throw error; setData(data); })
      .catch((err) => {
        console.error("Customer insights failed:", err);
        setError(err.message || "Could not build the customer report.");
        setData(null);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [companyId, from, to, vipPct, effectiveStore]);

  const customers = data?.customers || [];
  const s = data?.summary || {};
  const cmp = data?.comparison || {};
  const pat = data?.patterns || {};

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = customers.filter((c) => {
      if (vipOnly && !c.is_vip) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (q && !((c.name || "").toLowerCase().includes(q) || (c.membership_id || "").toLowerCase().includes(q) ||
        (c.phone || "").includes(q))) return false;
      return true;
    });
    const by = {
      rank: (a, b) => a.rank - b.rank,
      orders: (a, b) => b.orders - a.orders,
      avg_order: (a, b) => n(b.avg_order) - n(a.avg_order),
      recent: (a, b) => n(a.days_since) - n(b.days_since),
      lapsed: (a, b) => n(b.days_since) - n(a.days_since),
    };
    return [...rows].sort(by[sortKey] || by.rank);
  }, [customers, search, statusFilter, vipOnly, sortKey]);

  const vipShare = n(s.member_spend) > 0 ? (100 * n(s.vip_spend)) / n(s.member_spend) : 0;
  const memberShare = n(s.all_spend) > 0 ? (100 * n(s.member_spend)) / n(s.all_spend) : 0;
  const repeatRate = n(s.buying_members) > 0 ? (100 * n(s.repeat_customers)) / n(s.buying_members) : 0;

  const exportCsv = () => {
    const headers = [
      { label: "Rank", get: (c) => c.rank },
      { label: "Name", get: (c) => c.name },
      { label: "Member #", get: (c) => c.membership_id },
      { label: "Phone", get: (c) => c.phone },
      { label: "Email", get: (c) => c.email },
      { label: "VIP", get: (c) => (c.is_vip ? "Yes" : "No") },
      { label: "Status", get: (c) => STATUS[c.status]?.label || c.status },
      { label: "Spend", get: (c) => c.spend },
      { label: "% of member spend", get: (c) => c.share },
      { label: "Orders", get: (c) => c.orders },
      { label: "Visit days", get: (c) => c.visit_days },
      { label: "Items", get: (c) => c.units },
      { label: "Avg basket", get: (c) => c.avg_order },
      { label: "Avg days between visits", get: (c) => c.avg_gap },
      { label: "Last order", get: (c) => c.last_order },
      { label: "Days since last order", get: (c) => c.days_since },
      { label: "Usual day", get: (c) => DAYS[c.pref_dow] },
      { label: "Usual hour", get: (c) => hourLabel(c.pref_hour) },
      { label: "Payment", get: (c) => payLabel(c.pref_pay) },
      { label: "Store", get: (c) => c.pref_store },
      { label: "Discounts", get: (c) => c.discounts },
      { label: "Refunds", get: (c) => c.refunded },
      { label: "Points", get: (c) => c.loyalty_points },
      { label: "Top categories", get: (c) => (c.top_categories || []).map((x) => x.name).join("; ") },
      { label: "Top products", get: (c) => (c.top_products || []).map((x) => x.name).join("; ") },
    ];
    downloadCSV("customer-insights-" + from + "-to-" + to + ".csv", toCSV(filtered, headers));
  };

  const dowRows = (pat.weekday || []).map((r) => ({ label: DAYS_SHORT[r.dow], a: r.vip_spend, b: r.all_spend }));
  const hourRows = (pat.hour || []).filter((r) => n(r.all_orders) > 0)
    .map((r) => ({ label: hourLabel(r.hour), a: r.vip_orders, b: r.all_orders }));

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs space-y-1">From
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
        </label>
        <label className="text-xs space-y-1">To
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
        </label>
        <div className="flex gap-1">
          {[["30d", 29], ["90d", 89], ["6m", 182], ["1y", 364]].map(([l, d]) => (
            <Button key={l} size="sm" variant="outline" onClick={() => { setFrom(daysAgoStr(d)); setTo(todayStr()); }}>{l}</Button>
          ))}
        </div>
        {(stores || []).length > 1 && (
          <label className="text-xs space-y-1">Store
            <select className="h-9 rounded-md border bg-background px-2 text-sm block" value={storeId}
              onChange={(e) => setStoreId(e.target.value)}>
              <option value="">All stores</option>
              {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs space-y-1">High-value = top
          <select className="h-9 rounded-md border bg-background px-2 text-sm block" value={vipPct}
            onChange={(e) => setVipPct(Number(e.target.value))}>
            {[5, 10, 20, 25].map((p) => <option key={p} value={p}>{p}% by spend</option>)}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1", loading && "animate-spin")} />Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="w-3.5 h-3.5 mr-1" />Export CSV
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 text-red-700 text-sm p-3">{error}</div>
      )}
      {loading && !data && <p className="text-sm text-muted-foreground py-8 text-center">Building the customer report…</p>}

      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            Completed orders linked to a loyalty member, {data.range?.from} to {data.range?.to} · {data.store_name}.
            Walk-in sales with no member attached are not included ({money(n(s.all_spend) - n(s.member_spend))} of {money(s.all_spend)} total sales).
          </p>

          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card icon={Crown} label={"High-value customers (top " + data.vip_pct + "%)"} value={n(s.vip_count)}
              sub={money(s.vip_spend) + " = " + vipShare.toFixed(0) + "% of member spend"} tone="text-amber-600" />
            <Card icon={Users} label="Buying members" value={n(s.buying_members)}
              sub={n(s.members_total) + " members total · " + n(s.members_new) + " joined in range"} />
            <Card icon={Repeat} label="Repeat rate" value={repeatRate.toFixed(0) + "%"}
              sub={n(s.repeat_customers) + " bought 2+ times · " + n(s.avg_orders_per_customer) + " orders avg"} />
            <Card icon={ShoppingBasket} label="Avg spend / member" value={money(s.avg_spend_per_customer)}
              sub={"Avg basket " + money(s.avg_order)} />
            <Card label="Member sales" value={money(s.member_spend)}
              sub={memberShare.toFixed(1) + "% of all sales · " + n(s.member_orders) + " orders"} />
            <Card icon={AlertTriangle} label="High-value at risk" value={n(s.at_risk_vips)}
              sub={money(s.at_risk_spend) + " spend gone quiet"} tone={n(s.at_risk_vips) ? "text-red-600" : ""} />
            <Card icon={Percent} label="VIP discount rate" value={pct(cmp.vip_basket?.discount_rate)}
              sub={"Others " + pct(cmp.rest_basket?.discount_rate)} />
            <Card label="VIP avg basket" value={money(cmp.vip_basket?.avg_order)}
              sub={"Others " + money(cmp.rest_basket?.avg_order)} />
          </div>

          {/* At risk */}
          {(data.at_risk || []).length > 0 && (
            <Panel title="High-value customers who have gone quiet"
              subtitle="No purchase for longer than twice their usual gap (minimum 30 days). Worth a call or a voucher.">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground text-left">
                    <tr><th className="py-1">Customer</th><th>Phone</th><th className="text-right">Spend</th>
                      <th className="text-right">Orders</th><th className="text-right">Last order</th>
                      <th className="text-right">Days quiet</th><th className="text-right">Usual gap</th></tr>
                  </thead>
                  <tbody>
                    {data.at_risk.map((a) => (
                      <tr key={a.member_id} className="border-t">
                        <td className="py-1.5 font-medium">{a.name}</td>
                        <td>{a.phone || "-"}</td>
                        <td className="text-right tabular-nums">{money(a.spend)}</td>
                        <td className="text-right">{a.orders}</td>
                        <td className="text-right">{a.last_order}</td>
                        <td className="text-right text-red-600 font-semibold">{a.days_since}</td>
                        <td className="text-right">{a.avg_gap ? n(a.avg_gap).toFixed(0) + "d" : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* Customer table */}
          <Panel title="Customers ranked by spend"
            subtitle="Click a row for the full buying profile."
            right={
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-muted-foreground" />
                  <Input placeholder="Name, member # or phone" value={search} onChange={(e) => setSearch(e.target.value)}
                    className="h-9 pl-7 w-48" />
                </div>
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Any status</option>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}>
                  <option value="rank">Sort: spend</option>
                  <option value="orders">Sort: most orders</option>
                  <option value="avg_order">Sort: biggest basket</option>
                  <option value="recent">Sort: most recent</option>
                  <option value="lapsed">Sort: longest quiet</option>
                </select>
                <label className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={vipOnly} onChange={(e) => setVipOnly(e.target.checked)} />High-value only
                </label>
              </div>
            }>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground text-left">
                  <tr>
                    <th className="py-1 w-6" /><th className="w-8">#</th><th>Customer</th><th>Status</th>
                    <th className="text-right">Spend</th><th className="text-right">Share</th>
                    <th className="text-right">Orders</th><th className="text-right">Avg basket</th>
                    <th className="text-right">Every</th><th className="text-right">Last seen</th>
                    <th>Usual</th><th>Pays by</th><th>Top category</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={13} className="py-8 text-center text-muted-foreground">No customers match these filters.</td></tr>
                  )}
                  {filtered.map((c) => {
                    const open = !!expanded[c.member_id];
                    const st = STATUS[c.status] || STATUS.active;
                    return [
                      <tr key={c.member_id} className="border-t cursor-pointer hover:bg-muted/40"
                        onClick={() => setExpanded((e) => ({ ...e, [c.member_id]: !e[c.member_id] }))}>
                        <td className="py-2">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                        <td>{c.rank}</td>
                        <td className="font-medium">
                          {c.is_vip && <Crown className="inline w-3 h-3 text-amber-500 mr-1 -mt-0.5" />}{c.name}
                        </td>
                        <td><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", st.cls)}>{st.label}</span></td>
                        <td className="text-right tabular-nums font-semibold">{money(c.spend)}</td>
                        <td className="text-right tabular-nums">{pct(c.share)}</td>
                        <td className="text-right">{c.orders}</td>
                        <td className="text-right tabular-nums">{money(c.avg_order)}</td>
                        <td className="text-right">{c.avg_gap ? n(c.avg_gap).toFixed(0) + "d" : "-"}</td>
                        <td className="text-right">{c.days_since}d ago</td>
                        <td>{DAYS_SHORT[c.pref_dow]} {hourLabel(c.pref_hour)}</td>
                        <td>{payLabel(c.pref_pay)}</td>
                        <td className="truncate max-w-[110px]">{c.top_categories?.[0]?.name || "-"}</td>
                      </tr>,
                      open && (
                        <tr key={c.member_id + "-d"} className="border-t">
                          <td colSpan={13} className="p-0"><CustomerDetail c={c} /></td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Showing {filtered.length} of the top {customers.length} customers. Share = % of all member spend.
              At risk = quiet for longer than twice their usual gap (min. 30 days).
            </p>
          </Panel>

          {/* VIP vs rest */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="High-value vs everyone else">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="text-left py-1" /><th className="text-right">High-value</th><th className="text-right">Others</th></tr>
                </thead>
                <tbody>
                  <Compare label="Customers" a={cmp.vip?.customers} b={cmp.rest?.customers} />
                  <Compare label="Total spend" a={cmp.vip?.spend} b={cmp.rest?.spend} fmt={money} />
                  <Compare label="Avg spend / customer" a={cmp.vip?.avg_spend_per_customer} b={cmp.rest?.avg_spend_per_customer} fmt={money} higherBetter />
                  <Compare label="Avg orders / customer" a={cmp.vip?.avg_orders_per_customer} b={cmp.rest?.avg_orders_per_customer} fmt={(x) => n(x).toFixed(1)} higherBetter />
                  <Compare label="Days between visits" a={cmp.vip?.avg_gap_days} b={cmp.rest?.avg_gap_days} fmt={(x) => (x ? n(x).toFixed(1) : "-")} />
                  <Compare label="Avg basket" a={cmp.vip_basket?.avg_order} b={cmp.rest_basket?.avg_order} fmt={money} higherBetter />
                  <Compare label="Items per order" a={cmp.vip_basket?.avg_items} b={cmp.rest_basket?.avg_items} fmt={(x) => n(x).toFixed(1)} higherBetter />
                  <Compare label="Discount rate" a={cmp.vip_basket?.discount_rate} b={cmp.rest_basket?.discount_rate} fmt={pct} />
                  <Compare label="Orders with a discount" a={cmp.vip_basket?.orders_with_discount_pct} b={cmp.rest_basket?.orders_with_discount_pct} fmt={pct} />
                </tbody>
              </table>
            </Panel>

            <Panel title="How often customers buy" subtitle="Members by number of orders in the range, with their total spend.">
              <Bars rows={(pat.frequency || []).map((r) => ({ label: r.band + " (" + r.customers + ")", a: r.spend }))} fmt={money} />
            </Panel>

            <Panel title="Basket size" subtitle="Orders by value: high-value customers vs others.">
              <Bars rows={(pat.order_bands || []).map((r) => ({ label: r.band, a: r.vip_orders, b: r.rest_orders }))}
                aLabel="High-value" bLabel="Others" />
            </Panel>

            <Panel title="Monthly spend" subtitle="High-value vs other members, by month.">
              <Bars rows={(pat.monthly || []).map((r) => ({ label: r.month, a: r.vip_spend, b: r.rest_spend }))}
                aLabel="High-value" bLabel="Others" fmt={money} />
            </Panel>

            <Panel title="Day of the week" subtitle="Member spend by weekday.">
              <Bars rows={dowRows} aLabel="High-value" bLabel="All members" fmt={money} />
            </Panel>

            <Panel title="Time of day" subtitle="Member orders by hour (store time).">
              <Bars rows={hourRows} aLabel="High-value" bLabel="All members" />
            </Panel>

            <Panel title="What high-value customers buy: categories" subtitle="Revenue from high-value customers, vs all members.">
              <Bars rows={(pat.category || []).map((r) => ({ label: r.name, a: r.vip_revenue, b: r.all_revenue }))}
                aLabel="High-value" bLabel="All members" fmt={money} />
            </Panel>

            <Panel title="What high-value customers buy: top products">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground text-left">
                  <tr><th className="py-1">Product</th><th className="text-right">Revenue</th><th className="text-right">Units</th><th className="text-right">Buyers</th></tr>
                </thead>
                <tbody>
                  {(pat.products || []).map((p, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5"><span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground"> · {p.category}</span></td>
                      <td className="text-right tabular-nums">{money(p.revenue)}</td>
                      <td className="text-right">{n(p.units)}</td>
                      <td className="text-right">{p.buyers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title="How they pay">
              <Bars rows={(pat.payment || []).map((r) => ({ label: payLabel(r.method), a: r.vip_spend, b: r.all_spend }))}
                aLabel="High-value" bLabel="All members" fmt={money} />
            </Panel>

            <Panel title="Where they shop">
              <Bars rows={(pat.store || []).map((r) => ({ label: r.store, a: r.vip_spend, b: r.all_spend }))}
                aLabel="High-value" bLabel="All members" fmt={money} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
