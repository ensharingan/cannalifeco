import React, { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { PackageCheck, Plus, Trash2, Search, FileText } from "lucide-react";

const sel =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

async function fetchAll(build) {
  let from = 0, out = [];
  for (;;) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}
// orders/PO items are sometimes stored as a double-encoded JSON string
function parseItems(v) {
  try {
    let x = v;
    if (typeof x === "string") x = JSON.parse(x);
    if (typeof x === "string") x = JSON.parse(x);
    return Array.isArray(x) ? x : [];
  } catch { return []; }
}
const money = (n) => "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GRV() {
  const [cid, setCid] = useState(null);
  const [stores, setStores] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [pos, setPos] = useState([]);
  const [history, setHistory] = useState([]);
  const [storeId, setStoreId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const { data: prof } = await supabase.from("profiles").select("company_id").eq("id", u.user.id).single();
    const company = prof.company_id;
    setCid(company);
    const [{ data: mine }, st, sup, prods, po, hist] = await Promise.all([
      supabase.rpc("ws_my_stores"),
      supabase.from("stores").select("id,name,type").eq("company_id", company).eq("is_active", true).order("name"),
      supabase.from("suppliers").select("id,name").eq("company_id", company).eq("is_active", true).order("name"),
      fetchAll(() => supabase.from("products").select("id,name,sku,barcode,cost_price").eq("company_id", company).eq("is_active", true).order("name")),
      supabase.from("supplier_purchase_orders").select("id,order_number,supplier_id,store_id,items,status,stock_applied").eq("company_id", company).eq("stock_applied", false).order("created_at", { ascending: false }),
      supabase.from("grv_documents").select("id,grv_number,created_at,total_cost,supplier_invoice_no,store_id,supplier_id,purchase_order_id").eq("company_id", company).order("created_at", { ascending: false }).limit(40),
    ]);
    const allowed = new Set(mine || []);
    const list = (st.data || []).filter((s) => allowed.has(s.id));
    setStores(list);
    setStoreId((cur) => cur || (list.find((s) => s.type === "warehouse") || list[0])?.id || "");
    setSuppliers(sup.data || []);
    setProducts(prods);
    setPos(po.data || []);
    setHistory(hist.data || []);
  }, []);
  useEffect(() => { load().catch((e) => toast.error(e.message)); }, [load]);

  const storeName = (id) => stores.find((s) => s.id === id)?.name || "—";
  const supName = (id) => suppliers.find((s) => s.id === id)?.name || "—";

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return products.filter((p) => (p.name || "").toLowerCase().includes(t) || (p.sku || "").toLowerCase().includes(t) || (p.barcode || "") === t).slice(0, 8);
  }, [q, products]);

  const addProduct = (p) => {
    setLines((ls) => ls.find((l) => l.product_id === p.id) ? ls : [...ls, { product_id: p.id, name: p.name, sku: p.sku, qty_ordered: null, qty_received: "", cost_price: p.cost_price || "" }]);
    setQ("");
  };
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const pickPo = (id) => {
    setPoId(id);
    if (!id) return;
    const po = pos.find((p) => p.id === id);
    if (!po) return;
    if (po.supplier_id) setSupplierId(po.supplier_id);
    if (po.store_id && stores.find((s) => s.id === po.store_id)) setStoreId(po.store_id);
    const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
    const byId = new Map(products.map((p) => [p.id, p]));
    const out = [], missing = [];
    for (const it of parseItems(po.items)) {
      const nm = (it.product_name || it.name || "").trim();
      const p = byId.get(it.product_id) || byName.get(nm.toLowerCase());
      const qty = Number(it.quantity || 0);
      if (!p) { missing.push(nm || "unnamed line"); continue; }
      out.push({ product_id: p.id, name: p.name, sku: p.sku, qty_ordered: qty, qty_received: String(qty), cost_price: it.cost_price ?? p.cost_price ?? "" });
    }
    setLines(out);
    if (missing.length) toast.warning(`Not in catalogue, add manually: ${missing.join(", ")}`);
  };

  const total = lines.reduce((a, l) => a + (Number(l.qty_received) || 0) * (Number(l.cost_price) || 0), 0);

  const submit = async () => {
    if (!storeId) return toast.error("Choose the receiving store");
    const payload = lines
      .filter((l) => Number(l.qty_received) >= 0 && l.qty_received !== "")
      .map((l) => ({ product_id: l.product_id, qty_ordered: l.qty_ordered, qty_received: Number(l.qty_received), cost_price: Number(l.cost_price) || 0 }));
    if (!payload.some((l) => l.qty_received > 0)) return toast.error("Enter received quantities");
    setBusy(true);
    const { data, error } = await supabase.rpc("grv_post", {
      p_store: storeId, p_supplier: supplierId || null, p_po: poId || null,
      p_invoice: invoice, p_notes: notes, p_lines: payload,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${data.grv_number} posted — ${data.lines} lines, ${money(data.total_cost)}`);
    setLines([]); setPoId(""); setInvoice(""); setNotes(""); setSupplierId("");
    load();
  };

  const poOptions = pos.filter((p) => !storeId || !p.store_id || p.store_id === storeId);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <PackageCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Goods Received (GRV)</h1>
          <p className="text-sm text-muted-foreground">Book supplier stock into the warehouse. Stock is added the moment you post.</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs text-muted-foreground space-y-1">Receiving store
            <select className={sel} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground space-y-1">Supplier
            <select className={sel} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— none —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground space-y-1">Purchase order (optional)
            <select className={sel} value={poId} onChange={(e) => pickPo(e.target.value)}>
              <option value="">— none —</option>
              {poOptions.map((p) => <option key={p.id} value={p.id}>{p.order_number}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground space-y-1">Supplier invoice / delivery note no.
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </label>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search product name, SKU or scan barcode…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && matches.length === 1) addProduct(matches[0]); }} />
          {matches.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
              {matches.map((p) => (
                <button key={p.id} onClick={() => addProduct(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted">
                  <span className="text-foreground">{p.name}</span><span className="text-xs text-muted-foreground">{p.sku}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="text-left py-2">Product</th><th className="w-24 text-right">Ordered</th><th className="w-28 text-right">Received</th><th className="w-28 text-right">Unit cost</th><th className="w-28 text-right">Line total</th><th className="w-10" /></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const short = l.qty_ordered != null && Number(l.qty_received) < Number(l.qty_ordered);
                  return (
                    <tr key={l.product_id} className="border-t border-border">
                      <td className="py-2 text-foreground">{l.name}<div className="text-xs text-muted-foreground">{l.sku}</div></td>
                      <td className="text-right text-muted-foreground">{l.qty_ordered ?? "—"}</td>
                      <td><Input type="number" min="0" step="any" className={`text-right ${short ? "border-amber-500" : ""}`} value={l.qty_received} onChange={(e) => setLine(i, "qty_received", e.target.value)} /></td>
                      <td><Input type="number" min="0" step="any" className="text-right" value={l.cost_price} onChange={(e) => setLine(i, "cost_price", e.target.value)} /></td>
                      <td className="text-right text-foreground">{money((Number(l.qty_received) || 0) * (Number(l.cost_price) || 0))}</td>
                      <td><Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Total cost <span className="ml-2 text-lg font-semibold text-foreground">{money(total)}</span></div>
          <Button onClick={submit} disabled={busy || lines.length === 0}><Plus className="h-4 w-4 mr-1" />{busy ? "Posting…" : "Post GRV"}</Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-foreground"><FileText className="h-4 w-4" />Recent GRVs</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="text-left px-4 py-2">GRV</th><th className="text-left">Date</th><th className="text-left">Store</th><th className="text-left">Supplier</th><th className="text-left">Invoice</th><th className="text-right px-4">Cost</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t border-border">
                <td className="px-4 py-2 font-medium text-foreground">{h.grv_number}</td>
                <td className="text-muted-foreground">{new Date(h.created_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="text-foreground">{storeName(h.store_id)}</td>
                <td className="text-foreground">{supName(h.supplier_id)}</td>
                <td className="text-muted-foreground">{h.supplier_invoice_no || "—"}</td>
                <td className="px-4 text-right text-foreground">{money(h.total_cost)}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No GRVs yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
