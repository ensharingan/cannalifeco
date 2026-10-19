import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "../lib/CompanyContext";
import { useAuth } from "@/lib/AuthContext";
import {
  Warehouse, Store, Building2, TrendingUp, Package, ArrowRight, Search,
  Plus, Minus, Trash2, Send, RefreshCw, Lock, Unlock, AlertTriangle, Boxes,
  Receipt, CircleDollarSign, ShieldOff, ShieldCheck, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import TransferDocumentModal from "../components/headoffice/TransferDocumentModal";

/*
 * Head Office console — franchise-level control across every store in the
 * company. One company, many stores: the DC is a store with type 'warehouse',
 * branches are type 'branch'.
 *
 * Everything here goes through the ho_* RPCs rather than direct table writes.
 * ho_transfer_stock() is the only thing that may move stock between stores —
 * it is atomic across all lines and writes the stock_movements audit pair, so
 * a half-applied transfer is not a state this page can produce. It now also
 * opens a stock_transfer_batches row per send, which is what the delivery
 * note and DC invoice are printed from (see TransferDocumentModal).
 *
 * Billing tab is franchise-internal money between head office and its own
 * branches (DC stock cost recovery + royalty) — separate from the platform's
 * own subscription billing, which this white-label build has none of.
 */

const TABS = [
  { key: "overview",     label: "Group Overview" },
  { key: "distribution", label: "Distribution" },
  { key: "catalogue",    label: "Catalogue & Pricing" },
  { key: "billing",      label: "Billing" },
];

const STORE_ICON = {
  warehouse: Warehouse,
  branch:    Building2,
  franchise: Building2,
  single:    Store,
};

function rands(n) {
  return "" + Number(n || 0).toLocaleString("en-ZA", { maximumFractionDigits: 0 });
}

function StatCard({ icon: Icon, label, value, sub, tone = "primary" }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    green:   "bg-green-500/10 text-green-400",
    amber:   "bg-amber-500/10 text-amber-400",
    blue:    "bg-blue-500/10 text-blue-400",
  };
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex gap-4 items-center">
      <div className={`p-3 rounded-lg ${tones[tone]}`}><Icon className="w-5 h-5" /></div>
      <div className="min-w-0">
        <p className="text-2xl font-bold truncate">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-xs text-primary mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function HeadOffice() {
  const { companyId, company } = useCompany();
  const { profile } = useAuth();
  const [tab, setTab] = useState("overview");
  const [stores, setStores] = useState([]);

  const role = profile?.role || "cashier";
  const canManage = ["head_office", "owner", "admin", "superadmin"].includes(role);

  const loadStores = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("stores")
      .select("id, name, type, is_active, royalty_rate, billing_status")
      .eq("company_id", companyId)
      .order("name");
    if (error) { toast.error("Failed to load stores"); return; }
    setStores((data || []).filter((s) => s.is_active !== false));
  }, [companyId]);

  useEffect(() => { loadStores(); }, [loadStores]);

  if (!canManage) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
        <h1 className="text-lg font-semibold">Head office access required</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask the account owner to set your role to Head Office.
        </p>
      </div>
    );
  }

  const warehouses = stores.filter((s) => s.type === "warehouse");

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Head Office</h1>
          <p className="text-sm text-muted-foreground">
            {company?.trading_name || company?.company_name || "Franchise"} ·{" "}
            {stores.length} store{stores.length === 1 ? "" : "s"}
            {warehouses.length > 0 && ` · ${warehouses.length} DC`}
          </p>
        </div>
        <Link to="/stores">
          <Button variant="outline" className="gap-2">
            <Store className="w-4 h-4" /> Manage Stores
          </Button>
        </Link>
      </div>

      {warehouses.length === 0 && (
        <div className="bg-card border border-amber-500/30 rounded-xl p-5 flex items-start gap-3">
          <Warehouse className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-amber-400 text-sm">No distribution centre yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add a store with type <strong>Warehouse</strong> to receive supplier stock
              centrally and push it out to branches.
            </p>
          </div>
          <Link to="/stores">
            <Button size="sm" variant="outline">Add one</Button>
          </Link>
        </div>
      )}

      <div className="flex gap-2 flex-wrap border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-px ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview"     && <GroupOverview />}
      {tab === "distribution" && <Distribution stores={stores} companyId={companyId} />}
      {tab === "catalogue"    && <CataloguePricing companyId={companyId} company={company} />}
      {tab === "billing"      && (
        <Billing stores={stores} companyId={companyId} onStoresChanged={loadStores} />
      )}
    </div>
  );
}

/* ─── GROUP OVERVIEW ──────────────────────────────────────────────────────── */

function GroupOverview() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("ho_group_summary", {
      p_from: from,
      p_to: to,
    });
    if (error) toast.error(error.message);
    else setRows(data || []);
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const totals = rows.reduce(
    (acc, r) => ({
      sales: acc.sales + Number(r.sales_total || 0),
      orders: acc.orders + Number(r.orders || 0),
      stockValue: acc.stockValue + Number(r.stock_value || 0),
      lowLines: acc.lowLines + Number(r.low_stock_lines || 0),
      royalty: acc.royalty + Number(r.royalty_amount || 0),
    }),
    { sales: 0, orders: 0, stockValue: 0, lowLines: 0, royalty: 0 },
  );

  const best = rows.length ? rows[0] : null;

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw className={"w-3.5 h-3.5" + (loading ? " animate-spin" : "")} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={TrendingUp} label="Group Sales" value={rands(totals.sales)} tone="green"
          sub={`${totals.orders.toLocaleString()} orders`} />
        <StatCard icon={Boxes} label="Stock at Cost" value={rands(totals.stockValue)} tone="blue"
          sub="across all stores" />
        <StatCard icon={AlertTriangle} label="Low Stock Lines" value={totals.lowLines} tone="amber"
          sub={totals.lowLines > 0 ? "need replenishment" : "all healthy"} />
        <StatCard icon={CircleDollarSign} label="Royalty Due" value={rands(totals.royalty)} tone="primary"
          sub="this period, at current rates" />
        <StatCard icon={Store} label="Top Store" value={best ? best.store_name : "—"} tone="primary"
          sub={best ? rands(best.sales_total) : null} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Store</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Billing</th>
                <th className="px-4 py-3 text-right">Orders</th>
                <th className="px-4 py-3 text-right">Sales</th>
                <th className="px-4 py-3 text-right">Avg Basket</th>
                <th className="px-4 py-3 text-right">Stock Units</th>
                <th className="px-4 py-3 text-right">Stock Value</th>
                <th className="px-4 py-3 text-right">Low</th>
                <th className="px-4 py-3 text-right">Royalty %</th>
                <th className="px-4 py-3 text-right">Royalty Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground">No stores yet</td></tr>
              ) : rows.map((r) => {
                const Icon = STORE_ICON[r.store_type] || Store;
                const suspended = r.billing_status === "suspended";
                return (
                  <tr key={r.store_id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                        {r.store_name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">{r.store_type}</td>
                    <td className="px-4 py-3">
                      <span className={
                        "text-xs font-medium px-2 py-0.5 rounded-full " +
                        (suspended ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400")
                      }>
                        {suspended ? "Suspended" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{Number(r.orders).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-400">{rands(r.sales_total)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{rands(r.avg_basket)}</td>
                    <td className="px-4 py-3 text-right">{Number(r.stock_units || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{rands(r.stock_value)}</td>
                    <td className="px-4 py-3 text-right">
                      {Number(r.low_stock_lines) > 0
                        ? <span className="text-amber-400 font-medium">{r.low_stock_lines}</span>
                        : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {r.royalty_rate ? Number(r.royalty_rate) + "%" : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-primary">
                      {rands(r.royalty_amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Stock value uses cost price where set, falling back to sell price. Cancelled orders are excluded.
        Royalty Due is a live estimate at each store's current rate — it becomes a real invoice on the
        Billing tab, which locks the sales figure to the period billed.
      </p>
    </div>
  );
}

/* ─── DISTRIBUTION: DC → STORE ────────────────────────────────────────────── */

function Distribution({ stores, companyId }) {
  const warehouses = stores.filter((s) => s.type === "warehouse");
  const [fromStore, setFromStore] = useState("");
  const [toStore, setToStore] = useState("");
  const [search, setSearch] = useState("");
  const [matrix, setMatrix] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState({});
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [recent, setRecent] = useState([]);
  const [docBatchId, setDocBatchId] = useState(null);

  useEffect(() => {
    if (!fromStore && warehouses.length > 0) setFromStore(warehouses[0].id);
  }, [warehouses, fromStore]);

  const loadStock = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("ho_store_stock", {
      p_search: search || null,
      p_limit: 300,
    });
    if (error) toast.error(error.message);
    setMatrix(data || []);
    setLoading(false);
  }, [search]);

  const loadRecent = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from("stock_transfers")
      .select("id, quantity, created_at, from_store_id, to_store_id, product_id, notes, batch_id")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(25);
    setRecent(data || []);
  }, [companyId]);

  useEffect(() => { loadStock(); }, [loadStock]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  // ho_store_stock returns one row per product × store. Pivot to one row per
  // product with a per-store quantity map so the grid reads left to right.
  const products = useMemo(() => {
    const byProduct = new Map();
    for (const row of matrix) {
      if (!byProduct.has(row.product_id)) {
        byProduct.set(row.product_id, {
          id: row.product_id,
          name: row.product_name,
          sku: row.sku,
          category: row.category,
          qty: {},
        });
      }
      byProduct.get(row.product_id).qty[row.store_id] = Number(row.quantity || 0);
    }
    return Array.from(byProduct.values());
  }, [matrix]);

  const productById = useMemo(() => {
    const m = {};
    for (const p of products) m[p.id] = p;
    return m;
  }, [products]);

  const cartLines = Object.entries(cart).filter(([, q]) => Number(q) > 0);
  const totalUnits = cartLines.reduce((s, [, q]) => s + Number(q), 0);

  const setQty = (productId, qty) => {
    setCart((prev) => {
      const next = { ...prev };
      if (!qty || Number(qty) <= 0) delete next[productId];
      else next[productId] = Number(qty);
      return next;
    });
  };

  const available = (productId) => {
    const p = productById[productId];
    if (!p || !fromStore) return 0;
    return p.qty[fromStore] || 0;
  };

  const overCommitted = cartLines.filter(([id, q]) => Number(q) > available(id));

  const submit = async () => {
    if (!fromStore || !toStore) { toast.error("Pick a source and a destination"); return; }
    if (fromStore === toStore) { toast.error("Source and destination are the same store"); return; }
    if (cartLines.length === 0) { toast.error("Nothing to send"); return; }
    if (overCommitted.length > 0) {
      toast.error(`${overCommitted.length} line(s) exceed what the DC holds`);
      return;
    }

    const fromName = stores.find((s) => s.id === fromStore)?.name || "source";
    const toName = stores.find((s) => s.id === toStore)?.name || "destination";
    if (!confirm(`Move ${totalUnits} unit(s) across ${cartLines.length} line(s) from ${fromName} to ${toName}?\n\nThis takes effect immediately and generates a delivery note and invoice.`)) return;

    setSending(true);
    try {
      const { data, error } = await supabase.rpc("ho_transfer_stock", {
        p_from_store: fromStore,
        p_to_store: toStore,
        p_lines: cartLines.map(([product_id, quantity]) => ({ product_id, quantity })),
        p_notes: notes || null,
      });
      if (error) throw error;
      toast.success(`Moved ${data.units} unit(s) across ${data.lines} line(s) to ${toName}`);
      setCart({});
      setNotes("");
      await Promise.all([loadStock(), loadRecent()]);
      if (data?.batch_id) setDocBatchId(data.batch_id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const storeName = (id) => stores.find((s) => s.id === id)?.name || "—";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <Label className="text-xs text-muted-foreground">From (distribution centre)</Label>
          <Select value={fromStore} onValueChange={setFromStore}>
            <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select source" /></SelectTrigger>
            <SelectContent>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}{s.type === "warehouse" ? " · DC" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="hidden lg:flex items-center justify-center">
          <ArrowRight className="w-6 h-6 text-muted-foreground" />
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <Label className="text-xs text-muted-foreground">To (store)</Label>
          <Select value={toStore} onValueChange={setToStore}>
            <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select destination" /></SelectTrigger>
            <SelectContent>
              {stores.filter((s) => s.id !== fromStore).map((s) => (
                <SelectItem key={s.id} value={s.id} disabled={s.billing_status === "suspended"}>
                  {s.name}{s.billing_status === "suspended" ? " (suspended)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products by name or SKU..."
          className="pl-10"
        />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[460px]">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-right">At DC</th>
                <th className="px-4 py-3 text-right">At Destination</th>
                <th className="px-4 py-3 text-center w-40">Send</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Loading...</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No products match</td></tr>
              ) : products.map((p) => {
                const atSource = fromStore ? (p.qty[fromStore] || 0) : 0;
                const atDest = toStore ? (p.qty[toStore] || 0) : 0;
                const qty = cart[p.id] || 0;
                const over = qty > atSource;
                return (
                  <tr key={p.id} className={"hover:bg-muted/20 " + (qty > 0 ? "bg-primary/5" : "")}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.sku || "no SKU"}{p.category ? ` · ${p.category}` : ""}
                      </p>
                    </td>
                    <td className={"px-4 py-2.5 text-right font-medium " + (atSource <= 0 ? "text-muted-foreground" : "")}>
                      {atSource.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{atDest.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                          onClick={() => setQty(p.id, Math.max(0, qty - 1))} disabled={qty <= 0}>
                          <Minus className="w-3 h-3" />
                        </Button>
                        <Input
                          type="number"
                          min={0}
                          value={qty || ""}
                          placeholder="0"
                          onChange={(e) => setQty(p.id, e.target.value)}
                          className={"h-8 w-16 text-center " + (over ? "border-red-500 text-red-400" : "")}
                        />
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                          onClick={() => setQty(p.id, qty + 1)} disabled={atSource <= 0 && qty >= atSource}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {cartLines.length > 0 && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-sm">
                {cartLines.length} line{cartLines.length === 1 ? "" : "s"} · {totalUnits} unit{totalUnits === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-muted-foreground">
                {storeName(fromStore)} → {storeName(toStore) || "select a destination"}
              </p>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
              onClick={() => setCart({})}>
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </Button>
          </div>

          {overCommitted.length > 0 && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {overCommitted.length} line{overCommitted.length === 1 ? "" : "s"} exceed what the DC holds. Reduce them before sending.
            </div>
          )}

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Driver, waybill reference, anything to appear on the delivery note..."
            className="resize-none text-sm"
          />

          <Button onClick={submit} disabled={sending || !toStore || overCommitted.length > 0}
            className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700">
            <Send className="w-4 h-4" />
            {sending ? "Moving stock..." : `Send to ${storeName(toStore) || "store"}`}
          </Button>
        </div>
      )}

      <div>
        <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Package className="w-4 h-4 text-muted-foreground" /> Recent transfers
        </h2>
        {recent.length === 0 ? (
          <div className="bg-card border border-border rounded-xl py-8 text-center text-sm text-muted-foreground">
            No transfers yet
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {recent.map((t) => (
              <div key={t.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {productById[t.product_id]?.name || "Product"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {storeName(t.from_store_id)} → {storeName(t.to_store_id)}
                    {t.notes ? ` · ${t.notes}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right shrink-0">
                    <p className="font-semibold">{Number(t.quantity).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString("en-ZA")}
                    </p>
                  </div>
                  {t.batch_id && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                      onClick={() => setDocBatchId(t.batch_id)}>
                      <FileText className="w-3.5 h-3.5" /> Docs
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TransferDocumentModal
        batchId={docBatchId}
        open={!!docBatchId}
        onClose={() => setDocBatchId(null)}
      />
    </div>
  );
}

/* ─── CATALOGUE & CENTRAL PRICING ─────────────────────────────────────────── */

function CataloguePricing({ companyId, company }) {
  const [locked, setLocked] = useState(false);
  const [savingLock, setSavingLock] = useState(false);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocked(Boolean(company?.pos_settings?.central_pricing_lock));
  }, [company]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    let q = supabase
      .from("products")
      .select("id, name, sku, category, price, cost_price, is_active")
      .eq("company_id", companyId)
      .order("name")
      .limit(300);
    if (search) q = q.ilike("name", `%${search}%`);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setProducts(data || []);
    setLoading(false);
  }, [companyId, search]);

  useEffect(() => { load(); }, [load]);

  const toggleLock = async () => {
    setSavingLock(true);
    try {
      const next = !locked;
      const merged = Object.assign({}, company?.pos_settings || {}, {
        central_pricing_lock: next,
      });
      const { error } = await supabase
        .from("companies")
        .update({ pos_settings: merged })
        .eq("id", companyId);
      if (error) throw error;
      setLocked(next);
      toast.success(next
        ? "Branches can no longer change prices"
        : "Branches can change their own prices again");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingLock(false);
    }
  };

  const setEdit = (id, field, value) => {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  };

  const dirtyIds = Object.keys(edits);

  const saveAll = async () => {
    if (dirtyIds.length === 0) return;
    setSaving(true);
    try {
      for (const id of dirtyIds) {
        const patch = {};
        if (edits[id].price !== undefined) patch.price = Number(edits[id].price);
        if (edits[id].cost_price !== undefined) patch.cost_price = Number(edits[id].cost_price);
        const { error } = await supabase.from("products").update(patch).eq("id", id);
        if (error) throw error;
      }
      toast.success(`${dirtyIds.length} product${dirtyIds.length === 1 ? "" : "s"} updated`);
      setEdits({});
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className={"p-2.5 rounded-lg " + (locked ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
            {locked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
          </div>
          <div>
            <p className="font-semibold text-sm">Head office sets pricing</p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-lg">
              With this on, only head office can change price or cost price. Branch managers
              keep every other product field, so they can still fix a description or image.
            </p>
          </div>
        </div>
        <Switch checked={locked} onCheckedChange={toggleLock} disabled={savingLock} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search catalogue..." className="pl-10" />
        </div>
        {dirtyIds.length > 0 && (
          <Button onClick={saveAll} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            {saving ? "Saving..." : `Save ${dirtyIds.length} change${dirtyIds.length === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[520px]">
          <table className="w-full text-sm min-w-[620px]">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-right w-32">Cost</th>
                <th className="px-4 py-3 text-right w-32">Sell</th>
                <th className="px-4 py-3 text-right w-24">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading...</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No products</td></tr>
              ) : products.map((p) => {
                const cost = edits[p.id]?.cost_price ?? p.cost_price ?? 0;
                const price = edits[p.id]?.price ?? p.price ?? 0;
                const margin = Number(price) > 0
                  ? Math.round(((Number(price) - Number(cost)) / Number(price)) * 100)
                  : 0;
                const dirty = !!edits[p.id];
                return (
                  <tr key={p.id} className={"hover:bg-muted/20 " + (dirty ? "bg-primary/5" : "")}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.sku || "no SKU"}</p>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground capitalize">{p.category || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Input type="number" min={0} step="0.01" value={cost}
                        onChange={(e) => setEdit(p.id, "cost_price", e.target.value)}
                        className="h-8 text-right" />
                    </td>
                    <td className="px-4 py-2.5">
                      <Input type="number" min={0} step="0.01" value={price}
                        onChange={(e) => setEdit(p.id, "price", e.target.value)}
                        className="h-8 text-right" />
                    </td>
                    <td className={"px-4 py-2.5 text-right font-medium " +
                      (margin < 0 ? "text-red-400" : margin < 20 ? "text-amber-400" : "text-green-400")}>
                      {margin}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Prices are company-wide. A branch sells at the price set here — per-store pricing
        is not supported, by design, so a franchise cannot drift on price.
      </p>
    </div>
  );
}

/* ─── BILLING: royalty fee + store suspension ────────────────────────────── */

function Billing({ stores, companyId, onStoresChanged }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [preview, setPreview] = useState({});     // store_id -> calc row
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [issuing, setIssuing] = useState({});      // store_id -> bool
  const [invoices, setInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [rateEdits, setRateEdits] = useState({});
  const [savingRate, setSavingRate] = useState({});
  const [suspending, setSuspending] = useState({});

  const billable = stores.filter((s) => s.type !== "warehouse");

  const loadPreview = useCallback(async () => {
    if (billable.length === 0) return;
    setLoadingPreview(true);
    try {
      const results = await Promise.all(
        billable.map((s) =>
          supabase
            .rpc("ho_calculate_royalty", { p_store_id: s.id, p_from: from, p_to: to })
            .then(({ data, error }) => ({ id: s.id, row: error ? null : (data || [])[0] })),
        ),
      );
      const next = {};
      for (const r of results) next[r.id] = r.row;
      setPreview(next);
    } finally {
      setLoadingPreview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billable.map((s) => s.id).join(","), from, to]);

  const loadInvoices = useCallback(async () => {
    if (!companyId) return;
    setLoadingInvoices(true);
    const { data, error } = await supabase
      .from("franchise_royalty_invoices")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    setInvoices(data || []);
    setLoadingInvoices(false);
  }, [companyId]);

  useEffect(() => { loadPreview(); }, [loadPreview]);
  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const storeName = (id) => stores.find((s) => s.id === id)?.name || "—";

  const issue = async (storeId) => {
    setIssuing((p) => ({ ...p, [storeId]: true }));
    try {
      const { data, error } = await supabase.rpc("ho_issue_royalty_invoice", {
        p_store_id: storeId,
        p_from: from,
        p_to: to,
        p_due_date: null,
        p_notes: null,
      });
      if (error) throw error;
      toast.success(`${data.invoice_no} issued for ${rands(data.royalty_amount)}`);
      await loadInvoices();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIssuing((p) => ({ ...p, [storeId]: false }));
    }
  };

  const markPaid = async (invoiceId, amount) => {
    if (!confirm(`Mark this royalty invoice as paid (${rands(amount)})?`)) return;
    try {
      const { error } = await supabase.rpc("ho_mark_royalty_paid", {
        p_invoice_id: invoiceId,
        p_paid_amount: amount,
        p_paid_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success("Marked as paid");
      await loadInvoices();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveRate = async (storeId) => {
    const val = rateEdits[storeId];
    if (val === undefined) return;
    setSavingRate((p) => ({ ...p, [storeId]: true }));
    try {
      const { error } = await supabase
        .from("stores")
        .update({ royalty_rate: Number(val) })
        .eq("id", storeId);
      if (error) throw error;
      toast.success("Royalty rate updated");
      setRateEdits((p) => { const n = { ...p }; delete n[storeId]; return n; });
      onStoresChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingRate((p) => ({ ...p, [storeId]: false }));
    }
  };

  const toggleSuspend = async (store) => {
    const suspend = store.billing_status !== "suspended";
    let reason = null;
    if (suspend) {
      reason = prompt(`Reason for suspending ${store.name} (shown to head office, not the branch):`, "Non-payment") || "Non-payment";
    } else if (!confirm(`Reinstate ${store.name}? Its POS will work again immediately.`)) {
      return;
    }
    setSuspending((p) => ({ ...p, [store.id]: true }));
    try {
      const { error } = await supabase.rpc("ho_set_store_billing_status", {
        p_store_id: store.id,
        p_status: suspend ? "suspended" : "active",
        p_reason: reason,
      });
      if (error) throw error;
      toast.success(suspend ? `${store.name} suspended` : `${store.name} reinstated`);
      onStoresChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSuspending((p) => ({ ...p, [store.id]: false }));
    }
  };

  const STATUS_TONE = {
    issued: "bg-blue-500/10 text-blue-400",
    paid: "bg-green-500/10 text-green-400",
    overdue: "bg-red-500/10 text-red-400",
    cancelled: "bg-muted text-muted-foreground",
  };

  return (
    <div className="space-y-8">
      {/* Royalty calculator */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <CircleDollarSign className="w-4 h-4 text-muted-foreground" /> Royalty for period
          </h2>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={loadPreview} disabled={loadingPreview}>
              <RefreshCw className={"w-3.5 h-3.5" + (loadingPreview ? " animate-spin" : "")} /> Recalculate
            </Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Store</th>
                  <th className="px-4 py-3 text-right">Sales</th>
                  <th className="px-4 py-3 text-right w-40">Royalty %</th>
                  <th className="px-4 py-3 text-right">Royalty Owed</th>
                  <th className="px-4 py-3 text-center w-36">Issue Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {billable.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No branches yet</td></tr>
                ) : billable.map((s) => {
                  const row = preview[s.id];
                  const rateVal = rateEdits[s.id] ?? s.royalty_rate ?? 0;
                  const dirty = rateEdits[s.id] !== undefined && Number(rateEdits[s.id]) !== Number(s.royalty_rate || 0);
                  return (
                    <tr key={s.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{s.name}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {row ? rands(row.sales_total) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          <Input
                            type="number" min={0} max={100} step={0.5}
                            value={rateVal}
                            onChange={(e) => setRateEdits((p) => ({ ...p, [s.id]: e.target.value }))}
                            className="h-8 w-20 text-right"
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                          {dirty && (
                            <Button size="sm" variant="outline" className="h-8 px-2"
                              onClick={() => saveRate(s.id)} disabled={savingRate[s.id]}>
                              {savingRate[s.id] ? "..." : "Save"}
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-primary">
                        {row ? rands(row.royalty_amount) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Button size="sm" variant="outline" className="gap-1.5"
                          onClick={() => issue(s.id)}
                          disabled={issuing[s.id] || !row || Number(row.royalty_amount) <= 0}>
                          <Receipt className="w-3.5 h-3.5" />
                          {issuing[s.id] ? "..." : "Issue"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Change a store's royalty % here — it saves to that store immediately and is what the
          next invoice bills at. Issuing locks in the sales figure for the period so it can't be
          double-billed.
        </p>
      </section>

      {/* Invoice history */}
      <section className="space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" /> Royalty invoices
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left">Invoice</th>
                  <th className="px-4 py-3 text-left">Store</th>
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingInvoices ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading...</td></tr>
                ) : invoices.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No royalty invoices yet</td></tr>
                ) : invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{inv.invoice_no}</td>
                    <td className="px-4 py-2.5">{storeName(inv.store_id)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {inv.period_start} → {inv.period_end}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">{rands(inv.royalty_amount)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={"text-xs font-medium px-2 py-0.5 rounded-full " + (STATUS_TONE[inv.status] || "")}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {inv.status === "issued" || inv.status === "overdue" ? (
                        <Button size="sm" variant="outline" onClick={() => markPaid(inv.id, inv.royalty_amount)}>
                          Mark Paid
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Store billing status */}
      <section className="space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <ShieldOff className="w-4 h-4 text-muted-foreground" /> Store billing status
        </h2>
        <div className="bg-card border border-border rounded-xl divide-y divide-border">
          {stores.map((s) => {
            const suspended = s.billing_status === "suspended";
            return (
              <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{s.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{s.type}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={
                    "text-xs font-medium px-2 py-0.5 rounded-full " +
                    (suspended ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400")
                  }>
                    {suspended ? "Suspended" : "Active"}
                  </span>
                  <Button
                    size="sm"
                    variant={suspended ? "outline" : "destructive"}
                    className="gap-1.5"
                    onClick={() => toggleSuspend(s)}
                    disabled={suspending[s.id]}
                  >
                    {suspended
                      ? <><ShieldCheck className="w-3.5 h-3.5" /> Reinstate</>
                      : <><ShieldOff className="w-3.5 h-3.5" /> Suspend</>}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Suspending a store blocks its POS and stops it receiving DC stock transfers until
          reinstated. It does not touch is_active (used to permanently close a store) or the
          platform's own subscription billing.
        </p>
      </section>
    </div>
  );
}
