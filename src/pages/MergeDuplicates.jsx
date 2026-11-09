import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "../lib/CompanyContext";
import { toast } from "sonner";
import { RefreshCw, Merge, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function n(v) { return Math.round(Number(v || 0) * 1000) / 1000; }

var ALL = "__all__";

// TEMPORARY admin tool. Pick a store, pick a suspected duplicate pair, check the
// numbers, press Merge. Stock moves from the product being removed into the one
// kept (default: whichever holds the most stock). Owner/admin only (enforced in the DB).
export default function MergeDuplicates() {
  var { companyId } = useCompany();
  var [allowed, setAllowed] = useState(null);
  useEffect(function () {
    supabase.rpc("merge_tool_allowed").then(function (r) { setAllowed(!r.error && r.data === true); });
  }, []);
  var [stores, setStores] = useState([]);
  var [storeId, setStoreId] = useState("");
  var [scope, setScope] = useState("store"); // store | all
  var [pairs, setPairs] = useState([]);
  var [allCount, setAllCount] = useState(null);
  var [loading, setLoading] = useState(false);
  var [sel, setSel] = useState(null);        // { keepId, removeId, a, b }
  var [retire, setRetire] = useState(true);
  var [busy, setBusy] = useState(false);
  var [done, setDone] = useState({});

  var allMode = storeId === ALL;

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
    var res = await supabase.rpc("duplicate_candidates", { p_store: storeId === ALL ? null : storeId });
    if (res.error) toast.error(res.error.message); else setPairs(res.data || []);
    if (storeId === ALL) {
      setAllCount(res.error ? null : (res.data || []).length);
    } else {
      var all = await supabase.rpc("duplicate_candidates", { p_store: null });
      setAllCount(all.error ? null : (all.data || []).length);
    }
    setLoading(false);
  }, [storeId]);
  useEffect(function () { load(); }, [load]);
  useEffect(function () { if (storeId === ALL) setScope("all"); }, [storeId]);

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
    var storeScope = scope === "store" && !allMode;
    var msg = 'Move ' + (storeScope ? n(remHere) + " units at " + storeName : n(remTotal) + " units across ALL stores") +
      ' from "' + remName + '" into "' + keepName + '"?';
    if (!window.confirm(msg)) return;
    setBusy(true);
    var res = await supabase.rpc("product_merge_stock", {
      p_keep: sel.keepId, p_remove: keepIsA ? p.b_id : p.a_id,
      p_store: storeScope ? storeId : null, p_retire: retire && !storeScope,
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

  if (allowed === null) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!allowed) return <div className="p-6 text-sm text-muted-foreground">You don't have access to this tool.</div>;

  var hiddenCount = (!allMode && allCount != null) ? Math.max(0, allCount - pairs.length) : 0;

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
            <SelectContent>
              <SelectItem value={ALL}>All stores (every suspected pair)</SelectItem>
              {stores.map(function (s) { return <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>; })}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh</Button>
        </div>
      </div>

      {!allMode && hiddenCount > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span>{hiddenCount} more suspected pair{hiddenCount === 1 ? "" : "s"} hold no stock at this store but exist at other stores.</span>
          <Button size="sm" variant="outline" onClick={function () { setStoreId(ALL); }}>Show all stores</Button>
        </div>
      )}

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
                    <div className="text-xs text-muted-foreground">{allMode ? "" : "At this store: " + n(r.here) + " · "}all stores: {n(r.tot)}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-4 flex-wrap text-sm">
              {!allMode && (
                <label className="flex items-center gap-2">
                  <input type="radio" checked={scope === "store"} onChange={function () { setScope("store"); }} /> This store only
                </label>
              )}
              <label className="flex items-center gap-2">
                <input type="radio" checked={scope === "all" || allMode} onChange={function () { setScope("all"); }} /> All stores
              </label>
              {(scope === "all" || allMode) && (
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
              <th className="p-3">Category</th><th className="p-3">Product A</th><th className="p-3 text-right">{allMode ? "All stores" : "Here / all"}</th>
              <th className="p-3">Product B</th><th className="p-3 text-right">{allMode ? "All stores" : "Here / all"}</th><th className="p-3 text-right">Match</th><th className="p-3" />
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
                  <td className="p-3 text-right text-xs">{allMode ? n(p.a_total) : n(p.a_store) + " / " + n(p.a_total)}</td>
                  <td className="p-3 font-medium">{p.b_name}</td>
                  <td className="p-3 text-right text-xs">{allMode ? n(p.b_total) : n(p.b_store) + " / " + n(p.b_total)}</td>
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
