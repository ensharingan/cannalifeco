import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Plus, Search, Edit, Tag, ToggleLeft, ToggleRight, Scale, Trash2, Ticket } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCompany } from "../lib/CompanyContext";

const promoTypes = [
  { key: "percentage_discount", label: "% Discount" },
  { key: "fixed_discount",      label: "Fixed Discount" },
  { key: "buy_x_get_y",         label: "Buy X Get Y" },
  { key: "bundle",              label: "Bundle Deal" },
  { key: "free_item",           label: "Free Item" },
  { key: "weight_special",      label: "Weight Special (Xg for RY)" },
];

// Only these two settle against the cart subtotal, which is what the
// promo_code_validate function on the server knows how to price. The rest
// depend on what's in the basket and stay automatic.
const CODEABLE_TYPES = ["percentage_discount", "fixed_discount"];

const typeColors = {
  percentage_discount: "bg-blue-500/10 text-blue-600",
  fixed_discount:      "bg-green-500/10 text-green-600",
  buy_x_get_y:         "bg-purple-500/10 text-purple-600",
  bundle:              "bg-orange-500/10 text-orange-600",
  free_item:           "bg-pink-500/10 text-pink-600",
  weight_special:      "bg-emerald-500/10 text-emerald-600",
};

const TIER_OPTIONS = [
  { value: "all",      label: "👥 All Members" },
  { value: "bronze",   label: "🥉 Bronze" },
  { value: "silver",   label: "🥈 Silver" },
  { value: "gold",     label: "🥇 Gold" },
  { value: "platinum", label: "💎 Platinum" },
];

const TIER_COLORS = {
  all:      "bg-blue-500/10 text-blue-500",
  bronze:   "bg-amber-500/10 text-amber-600",
  silver:   "bg-slate-400/10 text-slate-500",
  gold:     "bg-yellow-500/10 text-yellow-500",
  platinum: "bg-purple-500/10 text-purple-500",
};

const empty = {
  name: "", description: "", promo_type: "percentage_discount",
  discount_value: 0, buy_quantity: 1, get_quantity: 1,
  free_product_id: "", free_product_name: "",
  start_date: "", end_date: "", is_active: true, max_uses: 0,
  applicable_products: [], target_tier: "all",
  weight_tiers: [],
  code: "", max_uses_per_member: 0,
};

// weight_tiers is jsonb — may arrive as an array already, or as a string on older rows.
function parseWeightTiers(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

// applicable_products is a text column holding a JSON array.
function parseApplicable(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export default function Promotions() {
  const { companyId } = useCompany();
  const [promos, setPromos] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editPromo, setEditPromo] = useState(null);
  const [form, setForm] = useState(empty);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    if (!companyId) return;
    try {
      const [{ data: promoData }, { data: productData }] = await Promise.all([
        supabase.from("promotions").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(200),
        supabase.from("products").select("id, name, price").eq("company_id", companyId).order("name").limit(200),
      ]);
      setPromos(promoData || []);
      setProducts(productData || []);
    } catch (err) {
      toast.error("Failed to load promotions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [companyId]);

  const openCreate = () => { setEditPromo(null); setForm(empty); setShowForm(true); };
  const openEdit = (p) => {
    setEditPromo(p);
    setForm({
      ...p,
      applicable_products: parseApplicable(p.applicable_products),
      weight_tiers: parseWeightTiers(p.weight_tiers),
      target_tier: p.target_tier || "all",
      start_date: p.start_date || "",
      end_date: p.end_date || "",
      code: p.code || "",
      max_uses_per_member: p.max_uses_per_member || 0,
    });
    setShowForm(true);
  };

  // ── Weight tier editor helpers ──
  const addTier = () => {
    setForm(f => ({ ...f, weight_tiers: [...(f.weight_tiers || []), { grams: "", price: "", label: "" }] }));
  };
  const updateTier = (idx, field, value) => {
    setForm(f => {
      const next = (f.weight_tiers || []).slice();
      next[idx] = { ...next[idx], [field]: value };
      return { ...f, weight_tiers: next };
    });
  };
  const removeTier = (idx) => {
    setForm(f => ({ ...f, weight_tiers: (f.weight_tiers || []).filter((_, i) => i !== idx) }));
  };

  const codeable = CODEABLE_TYPES.includes(form.promo_type);

  const handleSave = async () => {
    if (!form.name) { toast.error("Name is required"); return; }

    // Clean + validate weight tiers before they hit the POS.
    let cleanTiers = [];
    if (form.promo_type === "weight_special") {
      cleanTiers = (form.weight_tiers || [])
        .map(t => ({
          grams: Number(t.grams) || 0,
          price: Number(t.price) || 0,
          label: (t.label || "").trim(),
        }))
        .filter(t => t.grams > 0 && t.price > 0);

      if (!cleanTiers.length) {
        toast.error("Add at least one weight tier (grams + price)");
        return;
      }
      const seen = {};
      for (const t of cleanTiers) {
        if (seen[t.grams]) { toast.error(`Duplicate tier for ${t.grams}g`); return; }
        seen[t.grams] = true;
      }
      cleanTiers.sort((a, b) => a.grams - b.grams);
      cleanTiers = cleanTiers.map(t => ({ ...t, label: t.label || `${t.grams}g for ${t.price}` }));

      if (!(form.applicable_products || []).length) {
        toast.error("Pick the products this weight special applies to");
        return;
      }
    }

    // A code only makes sense on the two subtotal-based types. Anything else
    // is dropped rather than saved as a code that would never redeem.
    const cleanCode = codeable ? String(form.code || "").trim().toUpperCase() : "";
    if (cleanCode && /\s/.test(cleanCode)) {
      toast.error("Promo codes can't contain spaces");
      return;
    }

    setIsSaving(true);
    try {
      const data = {
        company_id: companyId,
        name: form.name,
        description: form.description || null,
        promo_type: form.promo_type,
        discount_value: Number(form.discount_value) || 0,
        buy_quantity: Number(form.buy_quantity) || 1,
        get_quantity: Number(form.get_quantity) || 1,
        free_product_id: form.free_product_id || null,
        free_product_name: form.free_product_name || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        is_active: form.is_active,
        max_uses: Number(form.max_uses) || 0,
        applicable_products: JSON.stringify(form.applicable_products || []),
        target_tier: form.target_tier || "all",
        weight_tiers: form.promo_type === "weight_special" ? cleanTiers : [],
        code: cleanCode || null,
        max_uses_per_member: codeable ? (Number(form.max_uses_per_member) || 0) : 0,
      };
      if (editPromo) {
        const { error } = await supabase.from("promotions").update(data).eq("id", editPromo.id);
        if (error) throw error;
        toast.success("Promotion updated");
      } else {
        const { error } = await supabase.from("promotions").insert({ ...data, usage_count: 0 });
        if (error) throw error;
        toast.success("Promotion created");
      }
      setShowForm(false);
      load();
    } catch (err) {
      // 23505 is the unique index on (company_id, code).
      if (err.code === "23505" || (err.message || "").includes("promotions_company_code_uniq")) {
        toast.error(`The code ${cleanCode} is already used by another promotion`);
      } else {
        toast.error(err.message || "Failed to save");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (promo) => {
    const { error } = await supabase.from("promotions").update({ is_active: !promo.is_active }).eq("id", promo.id);
    if (error) { toast.error("Failed to update"); return; }
    toast.success(promo.is_active ? "Promo deactivated" : "Promo activated");
    load();
  };

  const toggleProduct = (productId) => {
    setForm(f => {
      const current = f.applicable_products || [];
      return { ...f, applicable_products: current.includes(productId) ? current.filter(id => id !== productId) : [...current, productId] };
    });
  };

  const promoDescription = (p) => {
    if (p.promo_type === "percentage_discount") return `${p.discount_value}% off`;
    if (p.promo_type === "fixed_discount") return `${p.discount_value} off`;
    if (p.promo_type === "buy_x_get_y") return `Buy ${p.buy_quantity} Get ${p.get_quantity} free`;
    if (p.promo_type === "bundle") return `Bundle: ${p.discount_value}% off`;
    if (p.promo_type === "free_item") return `Free: ${p.free_product_name || "item"}`;
    if (p.promo_type === "weight_special") {
      const tiers = parseWeightTiers(p.weight_tiers);
      if (!tiers.length) return "No tiers set";
      return tiers.map(t => `${t.grams}g = ${t.price}`).join(" · ");
    }
    return "";
  };

  const isExpired = (p) => p.end_date && new Date(p.end_date) < new Date();
  const isLive = (p) => p.is_active && !isExpired(p) && (!p.start_date || new Date(p.start_date) <= new Date());

  const filtered = promos.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
      || (p.code || "").toLowerCase().includes(search.toLowerCase());
    const matchTier = filterTier === "all" || (p.target_tier || "all") === filterTier;
    return matchSearch && matchTier;
  });

  const active = promos.filter(p => isLive(p)).length;

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Promotions</h1>
          <p className="text-sm text-muted-foreground">{active} active · {promos.length} total</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> New Promo</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {promoTypes.map(t => {
          const count = promos.filter(p => p.promo_type === t.key).length;
          return (
            <div key={t.key} className="bg-card rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="text-2xl font-bold">{count}</p>
            </div>
          );
        })}
      </div>

      {/* Tier filter pills */}
      <div className="flex flex-wrap gap-2">
        {TIER_OPTIONS.map(t => (
          <button key={t.value} onClick={() => setFilterTier(t.value)}
            className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
              filterTier === t.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            {t.label}
            <span className="ml-1 opacity-60">
              ({promos.filter(p => t.value === "all" ? true : (p.target_tier || "all") === t.value).length})
            </span>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search by name or code..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      {/* Promo cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(p => {
          const live = isLive(p);
          const expired = isExpired(p);
          const appProducts = parseApplicable(p.applicable_products);
          const wTiers = parseWeightTiers(p.weight_tiers);
          const tierLabel = TIER_OPTIONS.find(t => t.value === (p.target_tier || "all"))?.label || "👥 All Members";
          return (
            <div key={p.id} className={cn("bg-card rounded-xl border p-4 space-y-3 transition-all", !p.is_active && "opacity-60")}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">{p.name}</span>
                </div>
                <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium",
                  expired ? "bg-red-100 text-red-600" : live ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-500"
                )}>
                  {expired ? "Expired" : live ? "Live" : "Inactive"}
                </span>
              </div>

              {/* Code chip — the thing the cashier types at the till */}
              {p.code && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-primary/10 text-primary font-mono font-bold border border-primary/20 tracking-wider">
                    <Ticket className="w-3 h-3" />{p.code}
                  </span>
                  <span className="text-[11px] text-muted-foreground">entered at the till</span>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-xs px-2 py-1 rounded-full font-medium", typeColors[p.promo_type])}>
                  {promoTypes.find(t => t.key === p.promo_type)?.label}
                </span>
                {p.promo_type !== "weight_special" && <span className="text-sm font-bold">{promoDescription(p)}</span>}
              </div>

              {/* Weight tier chips */}
              {p.promo_type === "weight_special" && wTiers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {wTiers.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 font-semibold border border-emerald-500/20">
                      <Scale className="w-3 h-3" />{t.grams}g = {t.price}
                    </span>
                  ))}
                </div>
              )}

              {/* Tier badge */}
              <span className={cn("inline-block text-xs px-2 py-1 rounded-full font-medium", TIER_COLORS[p.target_tier || "all"])}>
                {tierLabel}
              </span>

              {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}

              <div className="text-xs text-muted-foreground space-y-1">
                {p.start_date && <p>Start: {new Date(p.start_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}</p>}
                {p.end_date && <p>Ends: {new Date(p.end_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}</p>}
                {appProducts.length > 0 && <p>{appProducts.length} product(s) applied</p>}
                {p.max_uses > 0 && <p>Uses: {p.usage_count || 0} / {p.max_uses}</p>}
                {!p.max_uses && p.code && <p>Redeemed {p.usage_count || 0} time(s)</p>}
                {p.max_uses_per_member > 0 && <p>Limit: {p.max_uses_per_member} per member</p>}
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border">
                <button onClick={() => toggleActive(p)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  {p.is_active ? <ToggleRight className="w-4 h-4 text-green-500" /> : <ToggleLeft className="w-4 h-4" />}
                  {p.is_active ? "Active" : "Inactive"}
                </button>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => openEdit(p)}>
                  <Edit className="w-3 h-3" /> Edit
                </Button>
              </div>
            </div>
          );
        })}
        {!filtered.length && (
          <div className="col-span-full text-center py-16 text-muted-foreground text-sm">No promotions found.</div>
        )}
      </div>

      {/* Form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editPromo ? "Edit Promotion" : "New Promotion"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Weekend Special" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short description..." />
            </div>

            {/* Membership Tier */}
            <div>
              <Label>Membership Tier</Label>
              <Select value={form.target_tier || "all"} onValueChange={v => setForm(f => ({ ...f, target_tier: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Restrict this promotion to a specific membership tier</p>
            </div>

            <div>
              <Label>Promo Type</Label>
              <Select value={form.promo_type} onValueChange={v => setForm(f => ({ ...f, promo_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{promoTypes.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {["percentage_discount", "fixed_discount", "bundle"].includes(form.promo_type) && (
              <div>
                <Label>{form.promo_type === "percentage_discount" ? "Discount %" : "Discount Amount"}</Label>
                <Input type="number" step="0.01" value={form.discount_value} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))} />
              </div>
            )}

            {/* ── Promo code ── */}
            {codeable && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
                <Label className="flex items-center gap-1.5 text-primary">
                  <Ticket className="w-4 h-4" /> Promo Code
                </Label>
                <Input
                  value={form.code || ""}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "") }))}
                  placeholder="e.g. WEEKEND20"
                  className="font-mono tracking-wider uppercase"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank and this promotion comes off every qualifying sale automatically.
                  Give it a code and it only applies when a cashier types the code at the till.
                </p>
                <div>
                  <Label className="text-xs">Limit per member (0 = no limit)</Label>
                  <Input type="number" min={0} value={form.max_uses_per_member}
                    onChange={e => setForm(f => ({ ...f, max_uses_per_member: e.target.value }))} className="h-9" />
                </div>
              </div>
            )}

            {form.promo_type === "buy_x_get_y" && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Buy Quantity (X)</Label><Input type="number" min={1} value={form.buy_quantity} onChange={e => setForm(f => ({ ...f, buy_quantity: e.target.value }))} /></div>
                <div><Label>Get Quantity (Y)</Label><Input type="number" min={1} value={form.get_quantity} onChange={e => setForm(f => ({ ...f, get_quantity: e.target.value }))} /></div>
              </div>
            )}

            {/* ── Weight Special tier editor ── */}
            {form.promo_type === "weight_special" && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-emerald-700">
                    <Scale className="w-4 h-4" /> Weight Tiers *
                  </Label>
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addTier}>
                    <Plus className="w-3 h-3" /> Add Tier
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Set a fixed total price for a weight. e.g. 3g for 100. The POS deducts the full grams from stock.
                </p>

                {(form.weight_tiers || []).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">No tiers yet — click "Add Tier"</p>
                )}

                {(form.weight_tiers || []).map((t, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <div className="w-20">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Grams</Label>
                      <Input type="number" min="0.1" step="0.1" value={t.grams}
                        onChange={e => updateTier(idx, "grams", e.target.value)} placeholder="3" className="h-9" />
                    </div>
                    <div className="w-24">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Price</Label>
                      <Input type="number" min="0" step="0.01" value={t.price}
                        onChange={e => updateTier(idx, "price", e.target.value)} placeholder="100" className="h-9" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Label (optional)</Label>
                      <Input value={t.label} onChange={e => updateTier(idx, "label", e.target.value)}
                        placeholder="3g Special" className="h-9" />
                    </div>
                    <Button type="button" size="icon" variant="ghost"
                      className="h-9 w-9 text-red-500 hover:text-red-600 hover:bg-red-500/10 shrink-0"
                      onClick={() => removeTier(idx)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {form.promo_type === "free_item" && (
              <div>
                <Label>Free Product</Label>
                <Select value={form.free_product_id} onValueChange={v => {
                  const p = products.find(p => p.id === v);
                  setForm(f => ({ ...f, free_product_id: v, free_product_name: p?.name || "" }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Select free product" /></SelectTrigger>
                  <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
              <div><Label>End Date</Label><Input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
            </div>

            <div>
              <Label>Max Uses (0 = unlimited)</Label>
              <Input type="number" min={0} value={form.max_uses} onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))} />
            </div>

            <div>
              <Label>
                {form.promo_type === "weight_special"
                  ? "Applicable Products * (which strains get this special)"
                  : "Applicable Products (optional — leave empty for all)"}
              </Label>
              {codeable && form.code ? (
                <p className="text-xs text-amber-600 mt-1">
                  A coded promotion comes off the whole sale total, so this product list is ignored while a code is set.
                </p>
              ) : null}
              <div className="mt-2 max-h-40 overflow-y-auto border rounded-lg divide-y divide-border">
                {products.map(p => (
                  <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 cursor-pointer text-sm">
                    <input type="checkbox" checked={(form.applicable_products || []).includes(p.id)} onChange={() => toggleProduct(p.id)} className="rounded" />
                    <span className="flex-1">{p.name}</span>
                    {p.price != null && <span className="text-xs text-muted-foreground">{p.price}/g</span>}
                  </label>
                ))}
              </div>
            </div>

            <Button onClick={handleSave} disabled={isSaving} className="w-full">
              {isSaving ? "Saving..." : editPromo ? "Update Promotion" : "Create Promotion"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
