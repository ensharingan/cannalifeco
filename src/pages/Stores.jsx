import { useState, useEffect, useCallback } from "react";
import { supabase } from '@/api/supabaseClient';
import { Plus, Edit, Store, Warehouse, GitBranch, Building2, Percent, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useCompany } from "../lib/CompanyContext";

const TYPE_CONFIG = {
  single:    { label: "Single Store", icon: Store,     color: "text-blue-500",   bg: "bg-blue-500/10" },
  branch:    { label: "Branch",       icon: GitBranch, color: "text-green-500",  bg: "bg-green-500/10" },
  warehouse: { label: "Warehouse",    icon: Warehouse, color: "text-orange-500", bg: "bg-orange-500/10" },
  franchise: { label: "Franchise",    icon: Building2, color: "text-purple-500", bg: "bg-purple-500/10" },
};

// Plan limits. These MUST stay in sync with the enforce_store_limit() trigger
// on public.stores, which resolves the limit as:
//   greatest(plan_limit, coalesce(store_limit_override, 0))
// and counts EVERY row in stores for the company, warehouses included.
const PLAN_LIMITS = {
  starter: { maxStores: 1, allowWarehouse: false, allowFranchise: false },
  growth:  { maxStores: 5, allowWarehouse: true,  allowFranchise: true },
};

function getPlanLimits(plan) {
  var key = (plan || "starter").toLowerCase();
  return PLAN_LIMITS[key] || PLAN_LIMITS.starter;
}

// Mirrors enforce_store_limit(): the override can only RAISE the ceiling,
// never drop a company below what their plan already entitles them to.
function getEffectiveLimits(plan, overrideLimit) {
  var base = getPlanLimits(plan);
  var override = Number(overrideLimit) || 0;
  return {
    maxStores: Math.max(base.maxStores, override),
    planMaxStores: base.maxStores,
    hasOverride: override > base.maxStores,
    allowWarehouse: base.allowWarehouse,
    allowFranchise: base.allowFranchise,
  };
}

const EMPTY = { name: "", type: "single", address: "", city: "", phone: "", email: "", manager_name: "", is_active: true, royalty_rate: 0, notes: "" };

export default function Stores() {
  const { companyId, loading: companyLoading } = useCompany();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [isSaving, setIsSaving] = useState(false);
  const [companyPlan, setCompanyPlan] = useState("starter");
  const [storeLimitOverride, setStoreLimitOverride] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      var results = await Promise.all([
        supabase.from('stores').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100),
        // Read the plan from companies, not subscriptions: the trigger reads
        // companies.package first and falls back to companies.subscription_plan,
        // so pulling from subscriptions here can disagree with the database.
        supabase.from('companies').select('package, subscription_plan, store_limit_override').eq('id', companyId).maybeSingle(),
      ]);
      if (results[0].error) throw results[0].error;
      setStores(results[0].data || []);
      if (results[1].data) {
        setCompanyPlan(results[1].data.package || results[1].data.subscription_plan || "starter");
        setStoreLimitOverride(results[1].data.store_limit_override);
      }
    } catch (err) {
      toast.error('Failed to load stores');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { if (companyId) load(); }, [companyId, load]);

  var limits = getEffectiveLimits(companyPlan, storeLimitOverride);
  var storeCount = stores.length;
  var canAddStore = storeCount < limits.maxStores;
  var canAddWarehouse = limits.allowWarehouse;
  var isGrowth = (companyPlan || "").toLowerCase() === "growth";

  function limitMessage() {
    if (limits.hasOverride || isGrowth) {
      return "Your plan allows " + limits.maxStores + " location" + (limits.maxStores !== 1 ? "s" : "") + " in total, warehouse included. Get in touch if you need more.";
    }
    return "Your " + companyPlan + " plan allows " + limits.maxStores + " location" + (limits.maxStores !== 1 ? "s" : "") + ". Upgrade to Growth for up to " + PLAN_LIMITS.growth.maxStores + " locations in total, which can include a warehouse.";
  }

  const openNew = () => {
    if (!canAddStore) {
      toast.error(limitMessage());
      return;
    }
    setForm(EMPTY);
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (s) => { setForm({ ...s }); setEditing(s.id); setShowForm(true); };
  const up = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    // Validate plan limits on create
    if (!editing) {
      if (!canAddStore) {
        toast.error(limitMessage());
        return;
      }
      if (form.type === "warehouse" && !canAddWarehouse) {
        toast.error("Warehouse is not available on the Starter plan. Upgrade to Growth to add a warehouse.");
        return;
      }
      if (form.type === "franchise" && !limits.allowFranchise) {
        toast.error("Franchise stores are not available on the Starter plan. Upgrade to Growth.");
        return;
      }
    }

    setIsSaving(true);
    try {
      if (editing) {
        const { error } = await supabase.from('stores').update(form).eq('id', editing);
        if (error) throw error;
        toast.success('Store updated');
      } else {
        const { error } = await supabase.from('stores').insert({ ...form, company_id: companyId });
        if (error) throw error;
        toast.success('Store created');
      }
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(err?.message || 'Failed to save store');
    } finally {
      setIsSaving(false);
    }
  };

  const franchiseStores = stores.filter(s => s.type === "franchise");

  if (companyLoading || (loading && stores.length === 0)) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;

  // Available store types based on plan
  var availableTypes = [
    { value: "single", label: "🏪 Single Store", allowed: true },
    { value: "branch", label: "🌿 Branch", allowed: true },
    { value: "warehouse", label: "🏭 Warehouse", allowed: canAddWarehouse },
    { value: "franchise", label: "🏢 Franchise", allowed: limits.allowFranchise },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stores</h1>
          <p className="text-sm text-muted-foreground">
            Manage your store locations
            <span className="ml-2 text-xs text-muted-foreground/60">
              · {storeCount}/{limits.maxStores} locations used ({companyPlan} plan{limits.hasOverride ? ", extended" : ""})
            </span>
          </p>
        </div>
        <Button onClick={openNew} className="gap-2" disabled={!canAddStore}>
          {canAddStore ? <Plus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          Add Store
        </Button>
      </div>

      {/* Plan limit banner */}
      {!canAddStore && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-400">Location limit reached</p>
            <p className="text-xs text-muted-foreground">{limitMessage()}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
          const Icon = cfg.icon;
          const count = stores.filter(s => s.type === type).length;
          return (
            <div key={type} className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${cfg.bg}`}><Icon className={`w-5 h-5 ${cfg.color}`} /></div>
              <div><p className="text-xs text-muted-foreground">{cfg.label}</p><p className="text-2xl font-bold">{count}</p></div>
            </div>
          );
        })}
      </div>

      {franchiseStores.length > 0 && (
        <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3"><Percent className="w-4 h-4 text-purple-500" /><h3 className="text-sm font-semibold text-purple-700 dark:text-purple-300">Franchise Royalty Overview</h3></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {franchiseStores.map(s => (
              <div key={s.id} className="bg-white dark:bg-card rounded-lg p-3 border border-purple-500/10">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.city}</p>
                <p className="text-lg font-bold text-purple-600 mt-1">{s.royalty_rate || 0}% royalty</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stores.length === 0 ? (
          <div className="col-span-3 text-center py-16 text-muted-foreground">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm mb-4">No stores yet. Add your first store.</p>
            <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4" /> Add Store</Button>
          </div>
        ) : stores.map(s => {
          const cfg = TYPE_CONFIG[s.type] || TYPE_CONFIG.single;
          const Icon = cfg.icon;
          return (
            <div key={s.id} className="bg-card rounded-xl border border-border p-5 space-y-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${cfg.bg}`}><Icon className={`w-5 h-5 ${cfg.color}`} /></div>
                  <div><h3 className="font-semibold text-sm">{s.name}</h3><span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span></div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${s.is_active!==false?"bg-green-500":"bg-gray-300"}`} />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}><Edit className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              {(s.address||s.city) && <p className="text-xs text-muted-foreground">{[s.address,s.city].filter(Boolean).join(", ")}</p>}
              {s.manager_name && <p className="text-xs text-muted-foreground">Manager: {s.manager_name}</p>}
              {s.type==="franchise" && s.royalty_rate>0 && (
                <div className="flex items-center gap-1 bg-purple-500/10 text-purple-600 rounded-md px-2 py-1 w-fit">
                  <Percent className="w-3 h-3" /><span className="text-xs font-semibold">{s.royalty_rate}% royalty</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?"Edit Store":"Add Store"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Store Name *</Label><Input value={form.name} onChange={e=>up("name",e.target.value)} placeholder="e.g. Cape Town Branch" /></div>
            <div><Label>Store Type *</Label>
              <Select value={form.type} onValueChange={v=>up("type",v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availableTypes.map(function (t) {
                    return (
                      <SelectItem key={t.value} value={t.value} disabled={!t.allowed}>
                        {t.label}{!t.allowed ? " (Growth plan)" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {!editing && form.type === "warehouse" && !canAddWarehouse && (
                <p className="text-xs text-amber-500 mt-1">Warehouse requires the Growth plan</p>
              )}
            </div>
            {form.type==="franchise" && <div><Label>Royalty Rate (%)</Label><Input type="number" min={0} max={100} step={0.5} value={form.royalty_rate} onChange={e=>up("royalty_rate",Number(e.target.value))} /></div>}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Address</Label><Input value={form.address} onChange={e=>up("address",e.target.value)} /></div>
              <div><Label>City</Label><Input value={form.city} onChange={e=>up("city",e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={form.phone} onChange={e=>up("phone",e.target.value)} /></div>
              <div><Label>Email</Label><Input value={form.email} onChange={e=>up("email",e.target.value)} /></div>
            </div>
            <div><Label>Manager Name</Label><Input value={form.manager_name} onChange={e=>up("manager_name",e.target.value)} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e=>up("notes",e.target.value)} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.is_active!==false} onCheckedChange={v=>up("is_active",v)} /><Label>Active</Label></div>
            <Button onClick={save} disabled={!form.name||isSaving} className="w-full">{isSaving?"Saving...":editing?"Update Store":"Create Store"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
