import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import {
  DollarSign, TrendingUp, TrendingDown, Plus, Search, Trash2, Receipt, Store as StoreIcon, Lock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import StatCard from "../components/dashboard/StatCard";
import { formatCurrency } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";
import { useAuth } from "../lib/AuthContext";

const expenseCategories = [
  "rent", "utilities", "supplies", "payroll", "marketing",
  "licensing", "maintenance", "transport", "cleaning",
  "security", "stock_purchase", "other",
];

const PAYMENT_METHODS = [
  { value: "cash", label: "💵 Cash" },
  { value: "card", label: "💳 Card" },
  { value: "eft", label: "🏦 EFT" },
];

// Packages that unlock per-store expense capture. `companies.package` and
// `companies.subscription_plan` are known to disagree on legacy rows, so we
// treat the account as multi-store if EITHER column says growth or better.
const MULTI_STORE_PACKAGES = ["growth", "premium", "enterprise"];

const isSameMonth = (a, b) =>
  a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

const addMonths = (d, n) => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
};

const fmtMMMM = (d) => d.toLocaleDateString("en-ZA", { month: "short" });

export default function Finances() {
  const { companyId, loading: companyLoading, stores: ctxStores, activeStoreId } = useCompany();
  const { user, profile } = useAuth();
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [stores, setStores] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [companyPlan, setCompanyPlan] = useState({ package: null, subscription_plan: null });

  // Expense form
  const defaultForm = {
    description: "",
    amount: "",
    category: "other",
    vendor: "",
    date: new Date().toISOString().split("T")[0],
    store_id: "",
    notes: "",
    payment_method: "cash",
  };
  const [expenseForm, setExpenseForm] = useState(defaultForm);

  // Expense filters
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [filterPayment, setFilterPayment] = useState("");

  const isOwner = profile?.role === "owner" || profile?.role === "superadmin";

  /* ── Package gate: per-store expense capture is a Growth feature ── */
  const planValues = [companyPlan.package, companyPlan.subscription_plan]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase().trim());
  const isGrowth =
    profile?.role === "superadmin" || planValues.some((v) => MULTI_STORE_PACKAGES.includes(v));
  // Per-store capture only makes sense once the company actually has stores.
  const perStoreEnabled = isGrowth && stores.length > 0;

  /* ── Load stores + package ── */
  const loadStores = useCallback(async () => {
    if (!companyId) return;
    try {
      const [storesRes, companyRes] = await Promise.all([
        supabase
          .from("stores")
          .select("id, name")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("companies")
          .select("package, subscription_plan")
          .eq("id", companyId)
          .maybeSingle(),
      ]);
      setStores(storesRes.data || []);
      if (companyRes.data) {
        setCompanyPlan({
          package: companyRes.data.package || null,
          subscription_plan: companyRes.data.subscription_plan || null,
        });
      }
    } catch (_) {}
  }, [companyId]);

  /* ── Load data ──
   * Scoped to the Active Store selector: when a specific store is chosen
   * (activeStoreId truthy), both orders and expenses are filtered to that
   * store at the query level. "All Stores" (activeStoreId falsy) keeps the
   * company-wide view. Previously this only filtered company_id, so every
   * KPI card ignored the Active Store selector entirely. */
  const loadData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      let ordersQuery = supabase
        .from("orders")
        .select("id, total_amount, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1000);
      let expensesQuery = supabase
        .from("expenses")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(500);

      if (activeStoreId) {
        ordersQuery = ordersQuery.eq("store_id", activeStoreId);
        expensesQuery = expensesQuery.eq("store_id", activeStoreId);
      }

      const [ordersRes, expensesRes] = await Promise.all([ordersQuery, expensesQuery]);
      setOrders(ordersRes.data || []);
      setExpenses(expensesRes.data || []);

      const userIds = [
        ...new Set(
          (expensesRes.data || []).map((e) => e.created_by).filter(Boolean)
        ),
      ];
      if (userIds.length > 0) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);
        const map = {};
        for (const p of profileData || []) {
          map[p.id] = p.full_name || p.email || "Unknown";
        }
        setProfiles(map);
      }
    } catch (err) {
      console.error("Failed to load finances data:", err);
      toast.error("Failed to load data. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [companyId, activeStoreId]);

  useEffect(() => {
    if (companyId) {
      loadData();
      loadStores();
    }
  }, [companyId, loadData, loadStores]);

  // Default the expense to the store the user is currently working at.
  useEffect(() => {
    if (showExpenseForm && activeStoreId) {
      setExpenseForm((p) => ({ ...p, store_id: p.store_id || activeStoreId }));
    }
  }, [showExpenseForm, activeStoreId]);

  // If the plan doesn't allow per-store capture, drop any store filter that
  // may have been set before the plan/stores loaded.
  useEffect(() => {
    if (!perStoreEnabled && filterStore) setFilterStore("");
  }, [perStoreEnabled, filterStore]);

  // A specific Active Store is already applied at the query level above, so
  // the in-page "Store" filter (used for the Expenses-by-Store breakdown and
  // the list below) would otherwise silently narrow an already-narrowed set.
  // Reset it whenever the Active Store selection changes.
  useEffect(() => {
    setFilterStore("");
  }, [activeStoreId]);

  /* ── Revenue / expense calculations ── */
  const completedOrders = orders.filter((o) => o.status === "completed");
  const totalRevenue = completedOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const profit = totalRevenue - totalExpenses;

  // Expenses carry their own `date` (when the cost was incurred), separate
  // from `created_at` (when it was logged — often days later). Bucketing by
  // created_at attributes an expense to the wrong month/day and throws off
  // the P&L for the period it actually belongs to.
  const expenseDate = (e) => new Date((e.date || e.created_at) + (e.date ? "T00:00:00" : ""));

  const now = new Date();
  const thisMonthOrders = completedOrders.filter((o) => isSameMonth(new Date(o.created_at), now));
  const thisMonthRevenue = thisMonthOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
  const thisMonthExpenses = expenses
    .filter((e) => isSameMonth(expenseDate(e), now))
    .reduce((s, e) => s + (e.amount || 0), 0);

  const chartData = Array.from({ length: 6 }, (_, i) => {
    const month = addMonths(now, -(5 - i));
    const rev = completedOrders
      .filter((o) => isSameMonth(new Date(o.created_at), month))
      .reduce((s, o) => s + (o.total_amount || 0), 0);
    const exp = expenses
      .filter((e) => isSameMonth(expenseDate(e), month))
      .reduce((s, e) => s + (e.amount || 0), 0);
    return { name: fmtMMMM(month), revenue: rev, expenses: exp };
  });

  const todayStr = now.toISOString().split("T")[0];
  const todayExpenses = expenses
    .filter((e) => e.date === todayStr || (!e.date && e.created_at && e.created_at.startsWith(todayStr)))
    .reduce((s, e) => s + (e.amount || 0), 0);

  /* ── Payment method breakdown ── */
  const cashExpenses = expenses.filter((e) => (e.payment_method || "cash") === "cash").reduce((s, e) => s + (e.amount || 0), 0);
  const cardExpenses = expenses.filter((e) => e.payment_method === "card").reduce((s, e) => s + (e.amount || 0), 0);
  const eftExpenses = expenses.filter((e) => e.payment_method === "eft").reduce((s, e) => s + (e.amount || 0), 0);

  /* ── Per-store expense breakdown (Growth) ──
   * Only meaningful on "All Stores" — once a specific Active Store is
   * selected, `expenses` is already scoped to it at the query level, so
   * this collapses to a single tile. Hide it in that case rather than show
   * a redundant one-store "breakdown". */
  const storeBreakdown = perStoreEnabled && !activeStoreId
    ? [
        ...stores.map((s) => ({ id: s.id, name: s.name })),
        { id: null, name: "General / Unassigned" },
      ]
        .map((s) => {
          const rows = expenses.filter((e) => (e.store_id || null) === s.id);
          return {
            ...s,
            total: rows.reduce((sum, e) => sum + (e.amount || 0), 0),
            month: rows
              .filter((e) => isSameMonth(expenseDate(e), now))
              .reduce((sum, e) => sum + (e.amount || 0), 0),
            count: rows.length,
          };
        })
        .filter((s) => s.id !== null || s.count > 0)
    : [];

  /* ── Add expense ── */
  const handleAddExpense = async () => {
    if (!expenseForm.description || !expenseForm.amount) return;
    setIsSaving(true);
    try {
      // On Growth the user picks the store (defaulting to the active one).
      // On Starter every expense is booked to the active store so single-store
      // clubs still get correct attribution without exposing the picker.
      const storeId = perStoreEnabled
        ? expenseForm.store_id || null
        : activeStoreId || (stores.length === 1 ? stores[0].id : null);

      const insertData = {
        description: expenseForm.description.trim(),
        amount: Number(expenseForm.amount),
        category: expenseForm.category,
        vendor: expenseForm.vendor.trim() || null,
        date: expenseForm.date || new Date().toISOString().split("T")[0],
        store_id: storeId,
        notes: expenseForm.notes?.trim() || null,
        payment_method: expenseForm.payment_method || "cash",
        created_by: user?.id || null,
        company_id: companyId,
      };
      const { error } = await supabase.from("expenses").insert(insertData);
      if (error) throw error;
      toast.success("Expense recorded");
      setShowExpenseForm(false);
      setExpenseForm(defaultForm);
      await loadData();
    } catch (err) {
      console.error("Failed to save expense:", err);
      toast.error(err?.message || "Failed to save expense");
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Delete expense ── */
  const handleDelete = async (id) => {
    if (!confirm("Delete this expense?")) return;
    try {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) throw error;
      toast.success("Expense deleted");
      await loadData();
    } catch (err) {
      toast.error("Failed to delete expense");
    }
  };

  /* ── Filter expenses ── */
  const filteredExpenses = expenses.filter((e) => {
    if (filterCategory && e.category !== filterCategory) return false;
    if (perStoreEnabled && filterStore && e.store_id !== filterStore) return false;
    if (filterPayment && (e.payment_method || "cash") !== filterPayment) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (e.description || "").toLowerCase().includes(q) ||
        (e.vendor || "").toLowerCase().includes(q) ||
        (e.category || "").toLowerCase().includes(q) ||
        (e.notes || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredTotal = filteredExpenses.reduce((s, e) => s + (e.amount || 0), 0);

  const paymentLabel = (method) => {
    const found = PAYMENT_METHODS.find((p) => p.value === method);
    return found ? found.label : "💵 Cash";
  };

  if (companyLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finances</h1>
          <p className="text-sm text-muted-foreground">Revenue, expenses &amp; profit tracking</p>
        </div>
        <Button onClick={() => setShowExpenseForm(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Add Expense
        </Button>
      </div>

      {/* Stats */}
      {isOwner ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Revenue" value={formatCurrency(totalRevenue)} icon={DollarSign} color="success" />
          <StatCard title="Total Expenses" value={formatCurrency(totalExpenses)} icon={TrendingDown} color="destructive" />
          <StatCard title="Net Profit" value={formatCurrency(profit)} icon={TrendingUp} color={profit >= 0 ? "primary" : "destructive"} />
          <StatCard
            title="This Month"
            value={formatCurrency(thisMonthRevenue - thisMonthExpenses)}
            subtitle={`Rev: ${formatCurrency(thisMonthRevenue)} | Exp: ${formatCurrency(thisMonthExpenses)}`}
            icon={DollarSign}
            color="blue"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Today's Expenses</p>
            <p className="text-xl font-bold text-red-500">{formatCurrency(todayExpenses)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">This Month</p>
            <p className="text-xl font-bold text-red-500">{formatCurrency(thisMonthExpenses)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4 hidden md:block">
            <p className="text-xs text-muted-foreground">Total Expenses</p>
            <p className="text-xl font-bold text-red-500">{formatCurrency(totalExpenses)}</p>
          </div>
        </div>
      )}

      {/* Payment method breakdown — owner only */}
      {isOwner && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground mb-1">💵 Cash Expenses</p>
            <p className="text-lg font-bold text-red-500">{formatCurrency(cashExpenses)}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground mb-1">💳 Card Expenses</p>
            <p className="text-lg font-bold text-red-500">{formatCurrency(cardExpenses)}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground mb-1">🏦 EFT Expenses</p>
            <p className="text-lg font-bold text-red-500">{formatCurrency(eftExpenses)}</p>
          </div>
        </div>
      )}

      {/* Per-store expense breakdown — Growth plan, owner only, "All Stores" only */}
      {isOwner && perStoreEnabled && storeBreakdown.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <StoreIcon className="h-4 w-4" /> Expenses by Store
            </h3>
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
              Growth
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {storeBreakdown.map((s) => (
              <button
                key={s.id || "general"}
                type="button"
                onClick={() => setFilterStore(s.id || "")}
                className="text-left rounded-lg border border-border bg-background/40 p-4 hover:border-primary/50 transition-colors"
              >
                <p className="text-xs text-muted-foreground truncate">{s.name}</p>
                <p className="text-lg font-bold text-red-500">{formatCurrency(s.total)}</p>
                <p className="text-[11px] text-muted-foreground">
                  This month: {formatCurrency(s.month)} · {s.count} record(s)
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chart — owner only */}
      {isOwner && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold mb-4">Revenue vs Expenses (6 months)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
                <Bar dataKey="revenue" fill="hsl(152, 55%, 28%)" radius={[4, 4, 0, 0]} name="Revenue" />
                <Bar dataKey="expenses" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Expenses section */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Expenses
          </h3>
          <span className="text-xs text-muted-foreground">
            {filteredExpenses.length} record(s) · Total:{" "}
            <span className="font-medium text-red-500">{formatCurrency(filteredTotal)}</span>
          </span>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="pl-9 h-9" />
          </div>
          <Select value={filterCategory || "__all__"} onValueChange={(v) => setFilterCategory(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Categories</SelectItem>
              {expenseCategories.map((c) => (
                <SelectItem key={c} value={c} className="capitalize">
                  {c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterPayment || "__all__"} onValueChange={(v) => setFilterPayment(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Payment" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Methods</SelectItem>
              {PAYMENT_METHODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {perStoreEnabled && !activeStoreId && (
            <Select value={filterStore || "__all__"} onValueChange={(v) => setFilterStore(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Store" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Stores</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(filterCategory || filterStore || filterPayment || search) && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearch(""); setFilterCategory(""); setFilterStore(""); setFilterPayment(""); }}>
              Clear
            </Button>
          )}
        </div>

        {/* Expense list */}
        <div className="space-y-1">
          {filteredExpenses.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search || filterCategory || filterStore || filterPayment
                ? "No expenses match your filters"
                : 'No expenses recorded yet. Tap "Add Expense" to record one.'}
            </p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Date</th>
                      <th className="text-left p-3 font-medium">Description</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Category</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Vendor</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Payment</th>
                      {perStoreEnabled && <th className="text-left p-3 font-medium hidden lg:table-cell">Store</th>}
                      <th className="text-left p-3 font-medium hidden lg:table-cell">By</th>
                      <th className="text-right p-3 font-medium">Amount</th>
                      {isOwner && <th className="text-right p-3 font-medium w-[50px]"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredExpenses.map((e) => {
                      const storeName = stores.find((s) => s.id === e.store_id)?.name;
                      const recordedBy = e.created_by ? profiles[e.created_by] || "—" : "—";
                      return (
                        <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3 whitespace-nowrap text-muted-foreground">
                            {e.date
                              ? new Date(e.date + "T00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
                              : new Date(e.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{e.description}</div>
                            {e.notes && <div className="text-xs text-muted-foreground">{e.notes}</div>}
                            <div className="text-xs text-muted-foreground md:hidden capitalize">
                              {(e.category || "").replace(/_/g, " ")} {e.vendor ? `· ${e.vendor}` : ""} · {paymentLabel(e.payment_method || "cash")}
                              {perStoreEnabled ? ` · ${storeName || "General"}` : ""}
                            </div>
                          </td>
                          <td className="p-3 hidden md:table-cell">
                            <span className="inline-block px-2 py-0.5 rounded bg-muted text-xs capitalize">
                              {(e.category || "other").replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="p-3 text-muted-foreground hidden md:table-cell">{e.vendor || "—"}</td>
                          <td className="p-3 hidden md:table-cell">
                            <span className="text-xs">{paymentLabel(e.payment_method || "cash")}</span>
                          </td>
                          {perStoreEnabled && (
                            <td className="p-3 text-muted-foreground hidden lg:table-cell">{storeName || "General"}</td>
                          )}
                          <td className="p-3 text-muted-foreground text-xs hidden lg:table-cell">{recordedBy}</td>
                          <td className="p-3 text-right font-bold text-red-500">-{formatCurrency(e.amount)}</td>
                          {isOwner && (
                            <td className="p-3 text-right">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDelete(e.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  {filteredExpenses.length > 0 && (
                    <tfoot className="bg-muted/30 font-medium text-sm">
                      <tr>
                        <td className="p-3" colSpan={perStoreEnabled ? 7 : 6}>
                          Total ({filteredExpenses.length} expenses)
                        </td>
                        <td className="p-3 text-right font-bold text-red-500">-{formatCurrency(filteredTotal)}</td>
                        {isOwner && <td />}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Expense Dialog */}
      <Dialog open={showExpenseForm} onOpenChange={setShowExpenseForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Description *</Label>
              <Input
                value={expenseForm.description}
                onChange={(e) => setExpenseForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="e.g. Bought cleaning supplies"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm((p) => ({ ...p, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={expenseForm.date}
                  onChange={(e) => setExpenseForm((p) => ({ ...p, date: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={expenseForm.category} onValueChange={(v) => setExpenseForm((p) => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {expenseCategories.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={expenseForm.payment_method} onValueChange={(v) => setExpenseForm((p) => ({ ...p, payment_method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Store / Branch — Growth plan only */}
            {perStoreEnabled ? (
              <div>
                <Label className="flex items-center gap-2">
                  Store / Branch
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                    Growth
                  </span>
                </Label>
                <Select
                  value={expenseForm.store_id || "__none__"}
                  onValueChange={(v) => setExpenseForm((p) => ({ ...p, store_id: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— General (whole company) —</SelectItem>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Book the cost against the branch it belongs to, or leave as General for company-wide overheads.
                </p>
              </div>
            ) : (
              stores.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-start gap-2">
                  <Lock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs font-medium">Per-store expense capture is a Growth feature</p>
                    <p className="text-[11px] text-muted-foreground">
                      This expense will be booked to your current store. Upgrade to Growth to split expenses
                      across branches and see spend per store.
                    </p>
                  </div>
                </div>
              )
            )}

            <div>
              <Label>Vendor / Supplier</Label>
              <Input
                value={expenseForm.vendor}
                onChange={(e) => setExpenseForm((p) => ({ ...p, vendor: e.target.value }))}
                placeholder="e.g. Makro, Builders, Petrol station"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={expenseForm.notes}
                onChange={(e) => setExpenseForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Optional — receipt ref, reason, etc."
              />
            </div>
            <Button
              onClick={handleAddExpense}
              disabled={!expenseForm.description || !expenseForm.amount || Number(expenseForm.amount) <= 0 || isSaving}
              className="w-full"
            >
              {isSaving ? "Saving..." : "Record Expense"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
