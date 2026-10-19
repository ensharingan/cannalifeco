/**
 * TillCashOuts.jsx — Management page
 * Route: /till-cash-outs
 * Add to App.jsx:
 *   import TillCashOuts from "./pages/TillCashOuts";
 *   <Route path="/till-cash-outs" element={<TillCashOuts />} />
 * Add to your sidebar nav (owner/admin only).
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { Banknote, Calendar, Store, User, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useCompany } from "../lib/CompanyContext";
import { formatCurrency } from "../lib/currency";

function fmt(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-ZA", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function today() {
  return new Date().toISOString().split("T")[0];
}
function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}

export default function TillCashOuts() {
  const { companyId } = useCompany();
  const [rows, setRows] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);

  const [filterStore, setFilterStore] = useState("all");
  const [filterFrom, setFilterFrom] = useState(monthStart());
  const [filterTo, setFilterTo] = useState(today());

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      // Load stores for filter
      const { data: storeData } = await supabase
        .from("stores").select("id, name")
        .eq("company_id", companyId).order("name");
      setStores(storeData || []);

      // Load cash-outs with session + cashier info
      let q = supabase
        .from("till_cash_outs")
        .select(`
          id, amount, reason, supplier_name, created_at,
          store_id,
          cashier_session_id,
          cashier_sessions ( cashier_name, opening_time ),
          stores ( name )
        `)
        .eq("company_id", companyId)
        .gte("created_at", filterFrom + "T00:00:00")
        .lte("created_at", filterTo + "T23:59:59")
        .order("created_at", { ascending: false });

      if (filterStore !== "all") q = q.eq("store_id", filterStore);

      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
    } catch (err) {
      toast.error("Failed to load cash-outs: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  }, [companyId, filterStore, filterFrom, filterTo]);

  useEffect(() => { load(); }, [load]);

  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const exportCSV = () => {
    const header = ["Date", "Store", "Cashier", "Supplier", "Reason", "Amount"];
    const csvRows = rows.map(r => [
      fmt(r.created_at),
      r.stores?.name || "—",
      r.cashier_sessions?.cashier_name || "—",
      r.supplier_name || "—",
      (r.reason || "").replace(/,/g, ";"),
      parseFloat(r.amount).toFixed(2),
    ]);
    const csv = [header, ...csvRows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `till-cash-outs-${filterFrom}-to-${filterTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Banknote className="w-6 h-6 text-primary" /> Till Cash-Outs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cash removed from tills for supplier payments
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={exportCSV} disabled={!rows.length}>
          <FileDown className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-lg border bg-card">
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Store</Label>
          <Select value={filterStore} onValueChange={setFilterStore}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button className="w-full" onClick={load}>Apply</Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Cash-Outs</p>
          <p className="text-2xl font-bold text-red-500 mt-1">{formatCurrency(total)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Transactions</p>
          <p className="text-2xl font-bold mt-1">{rows.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Average per Transaction</p>
          <p className="text-2xl font-bold mt-1">{rows.length ? formatCurrency(total / rows.length) : "—"}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Banknote className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">No cash-outs in this period</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="p-3 text-left font-medium">Date & Time</th>
                <th className="p-3 text-left font-medium">
                  <span className="flex items-center gap-1"><Store className="w-3 h-3" /> Store</span>
                </th>
                <th className="p-3 text-left font-medium">
                  <span className="flex items-center gap-1"><User className="w-3 h-3" /> Cashier</span>
                </th>
                <th className="p-3 text-left font-medium">Supplier / Reason</th>
                <th className="p-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{fmt(r.created_at)}</td>
                  <td className="p-3">{r.stores?.name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3">{r.cashier_sessions?.cashier_name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3">
                    {r.supplier_name && <p className="font-medium">{r.supplier_name}</p>}
                    {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                    {!r.supplier_name && !r.reason && <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-3 text-right font-semibold text-red-500">
                    {formatCurrency(parseFloat(r.amount) || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30">
                <td colSpan={4} className="p-3 text-sm font-semibold">Total</td>
                <td className="p-3 text-right font-bold text-red-500">{formatCurrency(total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
