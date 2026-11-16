import { useState, useEffect, useMemo, useCallback } from "react";
import { useCompany } from "@/lib/CompanyContext";
import { supabase } from "@/api/supabaseClient";
import { Download, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const iso = (d) => d.toISOString().slice(0, 10);
const fmt = (n) => "R" + (Number(n) || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (n) => String(n || "-").replace(/^Canna Life Co - /, "");

export default function DiscountsReport() {
  const { companyId, stores } = useCompany();
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(iso(now));
  const [storeId, setStoreId] = useState("all");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const out = [];
      const start = new Date(from + "T00:00:00").toISOString();
      const end = new Date(to + "T23:59:59.999").toISOString();
      for (let f = 0; ; f += 1000) {
        let query = supabase.from("orders")
          .select("id, order_number, created_at, store_id, member_name, total_amount, discount_amount, discount_type, discount_value, discount_note, status, payment_method")
          .eq("company_id", companyId).gt("discount_amount", 0)
          .gte("created_at", start).lte("created_at", end).neq("status", "cancelled")
          .order("created_at", { ascending: false });
        if (storeId !== "all") query = query.eq("store_id", storeId);
        const { data, error } = await query.range(f, f + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      setRows(out);
    } catch (e) { toast.error(e.message || "Could not load the report"); }
    finally { setLoading(false); }
  }, [companyId, from, to, storeId]);
  useEffect(() => { load(); }, [load]);

  const storeName = useMemo(() => Object.fromEntries((stores || []).map(s => [s.id, short(s.name)])), [stores]);
  const shown = rows.filter(r => !q || [r.order_number, r.member_name, r.discount_note].some(v => String(v || "").toLowerCase().includes(q.toLowerCase())));
  const total = shown.reduce((s, r) => s + Number(r.discount_amount || 0), 0);
  const noNote = shown.filter(r => !String(r.discount_note || "").trim()).length;
  const byStore = useMemo(() => {
    const m = {};
    shown.forEach(r => { const k = storeName[r.store_id] || "-"; m[k] = m[k] || { n: 0, amt: 0 }; m[k].n++; m[k].amt += Number(r.discount_amount || 0); });
    return Object.entries(m).sort((a, b) => b[1].amt - a[1].amt);
  }, [shown, storeName]);

  const exportCsv = () => {
    const head = ["Date", "Order", "Store", "Member", "Discount", "Type", "Order total", "Payment", "Note"];
    const lines = shown.map(r => [new Date(r.created_at).toLocaleString("en-ZA"), r.order_number, storeName[r.store_id], r.member_name, Number(r.discount_amount).toFixed(2), r.discount_type, Number(r.total_amount).toFixed(2), r.payment_method, r.discount_note]
      .map(v => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    a.download = `discounts_${from}_to_${to}.csv`; a.click();
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Tag className="w-6 h-6" /> Discounts Report</h1>
          <p className="text-sm text-muted-foreground">Every sale where a discount was given, with the note the cashier entered.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!shown.length}><Download className="w-4 h-4 mr-1" /> Export CSV</Button>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <div><div className="text-xs text-muted-foreground mb-1">From</div><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><div className="text-xs text-muted-foreground mb-1">To</div><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div><div className="text-xs text-muted-foreground mb-1">Store</div>
          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={storeId} onChange={e => setStoreId(e.target.value)}>
            <option value="all">All stores</option>
            {(stores || []).map(s => <option key={s.id} value={s.id}>{short(s.name)}</option>)}
          </select></div>
        <div className="flex-1 min-w-[200px]"><div className="text-xs text-muted-foreground mb-1">Search</div><Input placeholder="Order, member or note" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border rounded-lg p-3 bg-card"><div className="text-xs text-muted-foreground">Total discounts</div><div className="text-xl font-bold">{fmt(total)}</div></div>
        <div className="border rounded-lg p-3 bg-card"><div className="text-xs text-muted-foreground">Sales with a discount</div><div className="text-xl font-bold">{shown.length}</div></div>
        <div className="border rounded-lg p-3 bg-card"><div className="text-xs text-muted-foreground">Average discount</div><div className="text-xl font-bold">{fmt(shown.length ? total / shown.length : 0)}</div></div>
        <div className="border rounded-lg p-3 bg-card"><div className="text-xs text-muted-foreground">Missing a note</div><div className={"text-xl font-bold " + (noNote ? "text-amber-500" : "")}>{noNote}</div></div>
      </div>
      {byStore.length > 1 && (
        <div className="border rounded-lg bg-card p-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
          {byStore.map(([n, v]) => <span key={n}><span className="font-medium">{n}</span> {fmt(v.amt)} <span className="text-muted-foreground">({v.n})</span></span>)}
        </div>)}
      <div className="border rounded-lg overflow-x-auto bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left"><tr><th className="p-3">Date</th><th className="p-3">Order</th><th className="p-3">Store</th><th className="p-3">Member</th><th className="p-3 text-right">Discount</th><th className="p-3 text-right">Order total</th><th className="p-3">Note</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading...</td></tr>
              : shown.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No discounted sales in this period</td></tr>
              : shown.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="p-3 font-mono text-xs">{r.order_number}</td>
                  <td className="p-3">{storeName[r.store_id] || "-"}</td>
                  <td className="p-3">{r.member_name || "Walk-in"}</td>
                  <td className="p-3 text-right font-medium">{fmt(r.discount_amount)}</td>
                  <td className="p-3 text-right">{fmt(r.total_amount)}</td>
                  <td className="p-3 text-muted-foreground">{r.discount_note || <span className="text-amber-500">no note</span>}</td>
                </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
