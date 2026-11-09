import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "../lib/CompanyContext";
import { toast } from "sonner";
import { RefreshCw, Merge, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function n(v) { return Math.round(Number(v || 0) * 1000) / 1000; }

// TEMPORARY admin tool. Pick a store, pick a suspected duplicate pair, check the
// numbers, press Merge. Stock moves from the product being removed into the one
// kept (default: whichever holds the most stock). Owner/admin only (enforced in the DB).
export default function MergeDuplicates() {
  var { companyId, role } = useCompany();
  var allowed = ["owner", "admin", "superadmin"].indexOf(role) !== -1;
  var [stores, setStores] = useState([]);
  var [storeId, setStoreId] = useState("");
  var [scope, setScope] = useState("store"); // store | all
  var [pairs, setPairs] = useState([]);
  var [loading, setLoading] = useState(false);
  var [sel, setSel] = useState(null);        // { keepId, removeId, a, b }
  var [retire, setRetire] = useState(true);
  var [busy, setBusy] = useState(false);
  var [done, setDone] = useState({});

  useEffect(function () {
    if (!companyId) return;
    supabase.from("stores").select("id, name").eq("company_id", companyId).order("name").then(function (r) {
      setStores(r.data || []);
      var emm = (r.data || []).find(function (s) { return /emmarentia/i.test(s.name); });
      setStoreId(emm ? emm.id : ((r.data || [])[0] || {}).id || "");
    });
  }, [companyId]);

  var load = useCallback(async function () {
    if (!storeId) return;
    setLoading(true);
    var res = await supabase.rpc("duplicate_candidates", { p_store: storeId });
    if (res.error) toast.error(res.error.message); else setPairs(res.data || []);
    setLoading(false);
  }, [storeId]);
  useEffect(function () { load(); }, [load]);

  function pick(p) {
    // keep whichever has more total stock
    var aWins = Number(p.a_total) >= Number(p.b_total);
    setSel({ p: p, keepId: aWins ? p.a_id : p.b_id });
  }

  async function doMerge() {
    if (!sel) return;
    var p = sel.p;
    var keepIsA = sel.keepId === p.a_id;
    var keepName = keepIsA ? p.a_name : p.b_name, remName = keepIsA ? p.b_name : p.a_name;
    var remHere = keepIsA ? p.b_store : p.a_store, remTotal = keepIsA ? p.b_total : p.a_total;
    var storeName = (stores.find(function (s) { return s.id === storeId; }) || {}).name || "this store";
    var msg = 'Move ' + (scope === "store" ? n(remHere) + " units at " + storeName : n(remTotal) + " units across ALL stores") +
      ' from "' + remName + '" into "' + keepName + '"?';
    if (!window.confirm(msg)) return;
    setBusy(true);
    var res = await supabase.rpc("product_merge_stock", {
      p_keep: sel.keepId, p_remove: keepIsA ? p.b_id : p.a_id,
      p_store: scope === "store" ? storeId : null, p_retire: retire && scope === "all",
    });
    setBusy(false);
    if (res.error) { toast.error(res.error.message); return; }
    var d = res.data || {};
    toast.success("Moved " + n(d.moved) + " units" + (d.pending_count_rows ? " · " + d.pending_count_rows + " pending count rows still list the old product" : ""));
    var key = p.a_id + p.b_id;
    setDone(function (o) { var c = Object.assign({}, o); c[key] = true; return c; });
    setSel(null);
    load();
  }

  if (!allowed) return <div className="p-6 text-sm text-muted-foreground">Owner or admin only.</div>;

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Merge Duplicates <span className="text-xs font-normal text-amber-500 border border-amber-500/40 rounded px-1.5 py-0.5 ml-2">temporary</span></h1>
          <p className="text-sm text-muted-foreground">Suspected duplicate products. Pick a pair, check the stock, press Merge. Every move is logged under Stock Movements.</p>
        </div>
        <div className="flex gap-2">
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Store" /></SelectTrigger>
            <SelectContent>{stores.map(function (s) { return <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>; })}</SelectContent>
          </Select>
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh</Button>
        </div>
      </div>

      {sel && (function () {
        var p = sel.p;
        var rows = [
          { id: p.a_id, name: p.a_name, here: p.a_store, tot: p.a_total },
          { id: p.b_id, name: p.b_name, here: p.b_store, tot: p.b_total },
        ];
        return (
          <div className="bg-card rounded-xl border border-primary/40 p-4 space-y-3">
            <p className="text-sm font-semibold">Choose the product to KEEP. The other one's stock moves into it.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {rows.map(function (r) {
                var keep = sel.keepId === r.id;
                return (
                  <button key={r.id} type="button" onClick={function () { setSel({ p: p, keepId: r.id }); }}
                    className={cn("text-left rounded-lg border p-3", keep ? "border-green-500 bg-green-500/10" : "border-border hover:bg-muted/50")}>
                    <div className="text-xs font-semibold mb-1">{keep ? "KEEP" : "MERGE INTO KEEP, THEN REMOVE"}</div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">At this store: {n(r.here)} · all stores: {n(r.tot)}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={scope === "store"} onChange={function () { setScope("store"); }} /> This store only
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={scope === "all"} onChange={function () { setScope("all"); }} /> All stores
              </label>
              {scope === "all" && (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={retire} onChange={function (e) { setRetire(e.target.checked); }} /> Hide the duplicate afterwards
                </label>
              )}
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              Approve or cancel any pending stock counts that list the duplicate first, or an approval can put stock back on it.
            </div>
            <div className="flex gap-2">
              <Button onClick={doMerge} disabled={busy} className="gap-2"><Merge className="w-4 h-4" /> {busy ? "Merging…" : "Merge"}</Button>
              <Button variant="outline" onClick={function () { setSel(null); }}>Cancel</Button>
            </div>
          </div>
        );
      })()}

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground text-left">
              <th className="p-3">Category</th><th className="p-3">Product A</th><th className="p-3 text-right">Here / all</th>
              <th className="p-3">Product B</th><th className="p-3 text-right">Here / all</th><th className="p-3 text-right">Match</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {pairs.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">{loading ? "Loading…" : "No suspected duplicates for this store"}</td></tr>
            ) : pairs.map(function (p) {
              var key = p.a_id + p.b_id;
              return (
                <tr key={key} className={cn("border-b border-border/50 last:border-0", done[key] && "opacity-50")}>
                  <td className="p-3 text-xs">{p.category}</td>
                  <td className="p-3 font-medium">{p.a_name}</td>
                  <td className="p-3 text-right text-xs">{n(p.a_store)} / {n(p.a_total)}</td>
                  <td className="p-3 font-medium">{p.b_name}</td>
                  <td className="p-3 text-right text-xs">{n(p.b_store)} / {n(p.b_total)}</td>
                  <td className="p-3 text-right text-xs">{Math.round(Number(p.sim) * 100)}%</td>
                  <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={function () { pick(p); }}>Review</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
