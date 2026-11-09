import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { fetchAll } from "@/lib/fetchAll";
import { useCompany } from "../lib/CompanyContext";
import { useSearchParams } from "react-router-dom";
import { Search, Download, ChevronLeft, ChevronRight, X } from "lucide-react";
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
  var [sp, setSp] = useSearchParams();
  var productId = sp.get("product") || "";
  var [prod, setProd] = useState(null);       // { name, perStore: [{store, now, in, out}] , totals }
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
    if (productId) qb = qb.eq("product_id", productId);
    if (storeId !== "all") qb = qb.eq("store_id", storeId);
    if (type !== "all") qb = qb.eq("movement_type", type);
    if (q) qb = qb.ilike("product_name", "%" + q.replace(/[%,]/g, " ") + "%");
    if (from) qb = qb.gte("created_at", from + "T00:00:00");
    if (to) qb = qb.lte("created_at", to + "T23:59:59");
    return qb.order("created_at", { ascending: false });
  }, [companyId, productId, storeId, type, q, from, to]);

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

  // Item view: stock now per store + everything that moved, per store.
  useEffect(function () {
    if (!productId || !companyId) { setProd(null); return; }
    var cancelled = false;
    (async function () {
      var pr = await supabase.from("products").select("name").eq("id", productId).maybeSingle();
      var inv = await supabase.from("store_inventory").select("store_id, stock_quantity").eq("product_id", productId);
      var mv = await fetchAll(function () {
        return supabase.from("inventory_movements").select("store_id, movement_type, quantity_change")
          .eq("company_id", companyId).eq("product_id", productId).order("created_at", { ascending: false });
      });
      if (cancelled) return;
      var per = {};
      (inv.data || []).forEach(function (r) { per[r.store_id] = { now: Number(r.stock_quantity || 0), sold: 0, tin: 0, tout: 0, adj: 0, count: 0, recv: 0 }; });
      mv.forEach(function (m) {
        var o = per[m.store_id] || (per[m.store_id] = { now: 0, sold: 0, tin: 0, tout: 0, adj: 0, count: 0, recv: 0 });
        var c = Number(m.quantity_change || 0), t = m.movement_type;
        if (t === "sale") o.sold += c;
        else if (t === "transfer_in") o.tin += c;
        else if (t === "transfer_out" || t === "transfer_return") o.tout += c;
        else if (t === "stock_take" || t === "stock_take_reversal") o.count += c;
        else if (t === "restock" || t === "in") o.recv += c;
        else o.adj += c;
      });
      setProd({ name: (pr.data || {}).name || "", per: per, n: mv.length });
    })();
    return function () { cancelled = true; };
  }, [productId, companyId]);

  function openProduct(id) { var n = new URLSearchParams(sp); n.set("product", id); setSp(n); setPage(0); }
  function clearProduct() { var n = new URLSearchParams(sp); n.delete("product"); setSp(n); setPage(0); }

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

      {productId && (
        <div className="bg-card rounded-xl border border-primary/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">Item history</div>
              <div className="text-lg font-bold">{prod ? prod.name : "Loading…"}</div>
              {prod && <div className="text-xs text-muted-foreground">{prod.n} movements recorded</div>}
            </div>
            <Button variant="outline" size="sm" onClick={clearProduct} className="gap-1"><X className="w-4 h-4" /> Back to all items</Button>
          </div>
          {prod && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-muted-foreground text-left border-b border-border">
                  <th className="py-1.5 pr-3">Store</th><th className="pr-3 text-right">In stock now</th><th className="pr-3 text-right">Received</th>
                  <th className="pr-3 text-right">Transfer in</th><th className="pr-3 text-right">Transfer out</th><th className="pr-3 text-right">Sold</th>
                  <th className="pr-3 text-right">Counts</th><th className="text-right">Adjustments</th></tr></thead>
                <tbody>
                  {Object.keys(prod.per).sort(function (a, b) { return storeName(a).localeCompare(storeName(b)); }).map(function (sid) {
                    var o = prod.per[sid];
                    var f = function (v) { return v ? (v > 0 ? "+" : "") + fmtQty(v) : "–"; };
                    return (
                      <tr key={sid} className="border-b border-border/40 last:border-0">
                        <td className="py-1.5 pr-3 font-medium">{storeName(sid) || "Unknown store"}</td>
                        <td className="pr-3 text-right font-semibold">{fmtQty(o.now)}</td>
                        <td className="pr-3 text-right">{f(o.recv)}</td><td className="pr-3 text-right">{f(o.tin)}</td>
                        <td className="pr-3 text-right">{f(o.tout)}</td><td className="pr-3 text-right">{f(o.sold)}</td>
                        <td className="pr-3 text-right">{f(o.count)}</td><td className="text-right">{f(o.adj)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
                    <td className="p-3 font-medium">
                      <button type="button" className="text-left hover:underline hover:text-primary" title="Show this item's full history"
                        onClick={function () { openProduct(m.product_id); }}>{m.product_name}</button>
                    </td>
                    <td className="p-3 text-xs">{typeLabel(m.movement_type)}</td>
                    <td className={cn("p-3 text-right font-semibold", ch > 0 ? "text-green-500" : ch < 0 ? "text-red-500" : "")}>{ch > 0 ? "+" : ""}{fmtQty(ch)}</td>
                    <td className="p-3 text-right text-xs text-muted-foreground whitespace-nowrap">{fmtQty(m.previous_qty)} → {fmtQty(m.new_qty)}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[260px] truncate" title={(m.reason || "") + " " + (m.notes || "")}>{[(m.from_store_id || m.to_store_id) ? (storeName(m.from_store_id) || "?") + " → " + (storeName(m.to_store_id) || "?") : "", m.reason, m.notes].filter(Boolean).join(" · ")}</td>
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
