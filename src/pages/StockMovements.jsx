import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { fetchAll } from "@/lib/fetchAll";
import { useCompany } from "../lib/CompanyContext";
import { Search, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

var PAGE = 100;
var TYPES = [
  ["sale", "Sale"], ["stock_take", "Stock count"], ["stock_take_reversal", "Count reversal"],
  ["restock", "Restock"], ["in", "Stock in"], ["transfer_in", "Transfer in"], ["transfer_out", "Transfer out"],
  ["transfer_return", "Transfer return"], ["adjustment", "Adjustment"], ["damage", "Damage"],
];
function typeLabel(t) {
  var f = TYPES.find(function (x) { return x[0] === t; });
  return f ? f[1] : (t || "").replace(/_/g, " ");
}
function fmtQty(n) {
  if (n === null || n === undefined) return "–";
  return String(Math.round(Number(n) * 1000) / 1000);
}

export default function StockMovements() {
  var { companyId } = useCompany();
  var [rows, setRows] = useState([]);
  var [total, setTotal] = useState(0);
  var [page, setPage] = useState(0);
  var [loading, setLoading] = useState(true);
  var [stores, setStores] = useState([]);
  var [users, setUsers] = useState({});
  var [storeId, setStoreId] = useState("all");
  var [type, setType] = useState("all");
  var [search, setSearch] = useState("");
  var [q, setQ] = useState("");
  var [from, setFrom] = useState("");
  var [to, setTo] = useState("");

  useEffect(function () {
    if (!companyId) return;
    supabase.from("stores").select("id, name").eq("company_id", companyId).order("name")
      .then(function (r) { setStores(r.data || []); });
  }, [companyId]);

  // debounce the search box
  useEffect(function () {
    var t = setTimeout(function () { setQ(search.trim()); setPage(0); }, 350);
    return function () { clearTimeout(t); };
  }, [search]);

  var build = useCallback(function (withCount) {
    var qb = supabase.from("inventory_movements")
      .select("*", withCount ? { count: "exact" } : undefined)
      .eq("company_id", companyId);
    if (storeId !== "all") qb = qb.eq("store_id", storeId);
    if (type !== "all") qb = qb.eq("movement_type", type);
    if (q) qb = qb.ilike("product_name", "%" + q.replace(/[%,]/g, " ") + "%");
    if (from) qb = qb.gte("created_at", from + "T00:00:00");
    if (to) qb = qb.lte("created_at", to + "T23:59:59");
    return qb.order("created_at", { ascending: false });
  }, [companyId, storeId, type, q, from, to]);

  useEffect(function () {
    if (!companyId) return;
    var cancelled = false;
    setLoading(true);
    build(true).range(page * PAGE, page * PAGE + PAGE - 1).then(async function (res) {
      if (cancelled) return;
      var data = res.data || [];
      setRows(data);
      setTotal(res.count || 0);
      var ids = Array.from(new Set(data.map(function (m) { return m.created_by; }).filter(Boolean)));
      if (ids.length) {
        try {
          var pr = await supabase.from("profiles").select("*").in("id", ids);
          var map = {};
          (pr.data || []).forEach(function (p) { map[p.id] = p.full_name || p.name || p.email || ""; });
          if (!cancelled) setUsers(function (old) { return Object.assign({}, old, map); });
        } catch (e) { /* names are optional */ }
      }
      setLoading(false);
    });
    return function () { cancelled = true; };
  }, [companyId, build, page]);

  var storeName = function (id) {
    var s = stores.find(function (x) { return x.id === id; });
    return s ? s.name : "";
  };

  async function exportCSV() {
    var all = await fetchAll(function () { return build(false); });
    var head = ["Date", "Store", "Product", "Type", "Change", "Before", "After", "Reason", "Notes", "By", "Reference"];
    var lines = [head.join(",")].concat(all.map(function (m) {
      return [
        new Date(m.created_at).toLocaleString(), storeName(m.store_id), m.product_name, typeLabel(m.movement_type),
        m.quantity_change, m.previous_qty, m.new_qty, m.reason, m.notes, users[m.created_by] || "", m.reference_id,
      ].map(function (v) { return '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"'; }).join(",");
    }));
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stock-movements-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
  }

  var pages = Math.max(1, Math.ceil(total / PAGE));
  function reset(fn) { return function (v) { fn(v); setPage(0); }; }

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Movements</h1>
          <p className="text-sm text-muted-foreground">Every change to stock: sales, counts, transfers, adjustments. {total.toLocaleString()} matching</p>
        </div>
        <Button variant="outline" onClick={exportCSV} className="gap-2"><Download className="w-4 h-4" /> Export CSV</Button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder="Search product…" className="pl-9 w-[220px]" />
        </div>
        <Select value={storeId} onValueChange={reset(setStoreId)}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            {stores.map(function (s) { return <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>; })}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={reset(setType)}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TYPES.map(function (t) { return <SelectItem key={t[0]} value={t[0]}>{t[1]}</SelectItem>; })}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={function (e) { setFrom(e.target.value); setPage(0); }} className="w-[150px]" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={function (e) { setTo(e.target.value); setPage(0); }} className="w-[150px]" />
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground text-left">
                <th className="p-3">Date</th><th className="p-3">Store</th><th className="p-3">Product</th><th className="p-3">Type</th>
                <th className="p-3 text-right">Change</th><th className="p-3 text-right">Before → After</th><th className="p-3">Reason / notes</th><th className="p-3">By</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No movements match</td></tr>
              ) : rows.map(function (m) {
                var ch = Number(m.quantity_change || 0);
                return (
                  <tr key={m.id} className="border-b border-border/50 last:border-0">
                    <td className="p-3 whitespace-nowrap text-xs">{new Date(m.created_at).toLocaleString()}</td>
                    <td className="p-3 text-xs">{storeName(m.store_id) || "–"}</td>
                    <td className="p-3 font-medium">{m.product_name}</td>
                    <td className="p-3 text-xs">{typeLabel(m.movement_type)}</td>
                    <td className={cn("p-3 text-right font-semibold", ch > 0 ? "text-green-500" : ch < 0 ? "text-red-500" : "")}>{ch > 0 ? "+" : ""}{fmtQty(ch)}</td>
                    <td className="p-3 text-right text-xs text-muted-foreground whitespace-nowrap">{fmtQty(m.previous_qty)} → {fmtQty(m.new_qty)}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[260px] truncate" title={(m.reason || "") + " " + (m.notes || "")}>{[m.reason, m.notes].filter(Boolean).join(" · ")}</td>
                    <td className="p-3 text-xs">{users[m.created_by] || (m.created_by ? "" : "System")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between p-3 border-t border-border text-xs text-muted-foreground">
          <span>Page {page + 1} of {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={function () { setPage(page - 1); }}><ChevronLeft className="w-4 h-4" /></Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={function () { setPage(page + 1); }}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}
