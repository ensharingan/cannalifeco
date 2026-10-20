import { useState, useEffect, useCallback, Fragment } from "react";
import { supabase } from "@/api/supabaseClient";
import {
  Plus, Search, Edit, Trash2, AlertTriangle, Clock, Tag, Package, Link2, Store, X, Scale, Truck, Printer, Upload,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";
import BulkProductImportDialog from "../components/products/BulkProductImportDialog";

const DEFAULT_CATEGORIES = [
  "flower", "bundle", "edibles", "oils", "concentrates", "pre_rolls",
  "accessories", "beverages", "topicals", "other",
];
const DEFAULT_TYPES = [
  "Indoor", "Outdoor", "Greenhouse", "Greendoor", "Tunnel", "Hydro",
  "Pops", "Vape", "Edibles", "Drinks", "Dab", "3g Special", "5g Special",
];

/* Canonical strain vocabulary. Any legacy value already stored on a product
   still displays and still filters, so nothing a club typed goes missing. */
const STRAIN_TYPES = ["indica", "sativa", "hybrid", "cbd"];

function formatStrain(value) {
  if (!value) return "";
  const v = String(value).trim();
  if (!v) return "";
  if (v.toLowerCase() === "cbd") return "CBD";
  if (v.toLowerCase() === "n/a") return "N/A";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

function strainClasses(value) {
  const v = value ? String(value).toLowerCase() : "";
  if (v === "indica") return "bg-purple-500/10 text-purple-400";
  if (v === "sativa") return "bg-orange-500/10 text-orange-400";
  if (v === "hybrid") return "bg-green-500/10 text-green-400";
  if (v === "cbd") return "bg-blue-500/10 text-blue-400";
  return "bg-muted text-muted-foreground";
}

function StrainBadge({ value }) {
  const label = formatStrain(value);
  if (!label) return null;
  return (
    <span className={cn("inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap", strainClasses(value))}>
      {label}
    </span>
  );
}

/* PostgREST silently truncates every request at 1000 rows. Any table that can
   exceed that has to be pulled page by page or the page quietly shows wrong
   numbers with no error anywhere. */
const PAGE_SIZE = 1000;

async function fetchAllRows(buildQuery) {
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (from > 100000) break; // hard stop, should never trigger
  }
  return all;
}

function sel(e) { e.target.select(); }

function toNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/* ─── Per-store pricing ────────────────────────────────────────────
   A branch can sell the same product at its own price. The override lives on
   the store_inventory row that already carries that branch's stock, so NULL
   means "no special price here, use the group price off products". One
   catalogue, one barcode, one set of reports — only the number differs.

   The distinction this page has to make loud is which of the two you are
   editing. The plain price fields write products.price and move every branch
   at once; the fields inside the store box write one branch only. A club lost
   a day's margin at three shops because that wasn't obvious. */

function hasOverride(v) {
  return v !== null && v !== undefined && v !== "";
}

function resolveStorePrice(baseValue, overrideValue) {
  if (!hasOverride(overrideValue)) return baseValue;
  const n = Number(overrideValue);
  return isNaN(n) ? baseValue : n;
}

/* Form fields hold strings so an empty box can mean "inherit" — 0 is a
   legitimate price and must not be confused with blank. */
function overrideToInput(v) {
  return hasOverride(v) ? String(v) : "";
}

function inputToOverride(v) {
  const s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/* ─── Price Tiers Editor ───────────────────────────────────────── */

function PriceTiersEditor({ tiers, onChange }) {
  const addTier = () => {
    onChange([...tiers, { grams: 1, price: 0, label: "" }]);
  };

  const updateTier = (idx, field, value) => {
    const updated = tiers.map((t, i) => {
      if (i !== idx) return t;
      const newTier = { ...t, [field]: value };
      if (field === "grams" && (!t.label || t.label === t.grams + "g" || t.label === t.grams + "g Special")) {
        newTier.label = value <= 1 ? value + "g" : value + "g Special";
      }
      return newTier;
    });
    onChange(updated);
  };

  const removeTier = (idx) => {
    onChange(tiers.filter((_, i) => i !== idx));
  };

  return (
    <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-green-400 font-medium text-sm">
          <Scale className="h-4 w-4" /> Gram Pricing Tiers
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addTier} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Add Tier
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Set prices for different gram amounts. The base price above is for 1g. Each sale deducts the gram amount from stock.
      </p>
      {/* Tiers are flat rand amounts held on the product, so they apply at
          every branch and a per-store price does not move them. A branch that
          prices differently needs its tiers keyed manually until tiers get
          their own per-store override. */}
      <p className="text-xs text-amber-400/90">
        Tiers apply at every store. A store's own price won't change them.
      </p>

      {tiers.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-2">
          No tiers yet — customers will buy at the base price per unit. Add tiers for gram specials.
        </p>
      )}

      {tiers.map((tier, idx) => (
        <div key={idx} className="flex items-end gap-2">
          <div className="flex-1">
            {idx === 0 && <Label className="text-xs">Grams</Label>}
            <Input type="number" min={0.5} step={0.5} value={tier.grams} onFocus={sel}
              onChange={e => updateTier(idx, "grams", Number(e.target.value))} placeholder="3" className="h-9" />
          </div>
          <div className="flex-1">
            {idx === 0 && <Label className="text-xs">Price</Label>}
            <Input type="number" min={0} step={0.01} value={tier.price} onFocus={sel}
              onChange={e => updateTier(idx, "price", Number(e.target.value))} placeholder="60" className="h-9" />
          </div>
          <div className="flex-[1.5]">
            {idx === 0 && <Label className="text-xs">Label</Label>}
            <Input value={tier.label} onChange={e => updateTier(idx, "label", e.target.value)}
              placeholder="3g Special" className="h-9" />
          </div>
          <Button type="button" size="icon" variant="ghost"
            className="h-9 w-9 text-red-500 hover:text-red-600 shrink-0" onClick={() => removeTier(idx)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {tiers.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-0.5 pt-1 border-t border-green-500/30">
          {tiers.map((t, i) => (
            <div key={i}>
              {t.label || t.grams + "g"}: {formatCurrency(t.price)} → deducts {t.grams}g from stock
              {t.grams > 0 && t.price > 0 && (
                <span className="text-green-400 ml-1">({formatCurrency(t.price / t.grams)}/g)</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Delete Product Dialog ────────────────────────────────────── */
/* Defined at module scope so React keeps it mounted across renders. */

function DeleteProductDialog({ open, product, preview, busy, onCancel, onConfirm }) {
  const p = preview || {};
  const movements = (p.inventory_movements || 0) + (p.stock_movements || 0);
  const hasHistory = movements > 0 || (p.stock_count_items || 0) > 0;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-500">
            <Trash2 className="h-5 w-5" /> Delete Product
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm">
            Delete <span className="font-semibold">{product ? product.name : ""}</span>?
            This cannot be undone.
          </p>

          {!preview && (
            <p className="text-sm text-muted-foreground">Checking what will be removed...</p>
          )}

          {preview && hasHistory && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
                <AlertTriangle className="h-4 w-4" /> This product has stock history
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {movements > 0 && <div>{movements} stock movement record{movements === 1 ? "" : "s"}</div>}
                {p.store_inventory > 0 && <div>{p.store_inventory} store stock level{p.store_inventory === 1 ? "" : "s"}</div>}
                {p.stock_count_items > 0 && <div>{p.stock_count_items} stock count entr{p.stock_count_items === 1 ? "y" : "ies"}</div>}
                {p.bundle_links > 0 && <div>{p.bundle_links} bundle{p.bundle_links === 1 ? "" : "s"} will be unlinked</div>}
              </div>
              <p className="text-xs text-amber-300/90 leading-relaxed">
                Sales history and past receipts are not affected. However, Stock Value and
                Inventory Analytics for earlier dates will change once these records are removed.
              </p>
            </div>
          )}

          {preview && !hasHistory && (
            <p className="text-xs text-muted-foreground">
              This product has no stock history. Nothing else will be affected.
            </p>
          )}

          {preview && Number(p.current_stock) > 0 && (
            <p className="text-xs text-red-400">
              Warning: there {Number(p.current_stock) === 1 ? "is" : "are"} still {p.current_stock} in stock.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              onClick={onConfirm}
              disabled={busy || !preview}
            >
              {busy ? "Deleting..." : "Delete Product"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Add Supplier Dialog ──────────────────────────────────────── */

function AddSupplierDialog({ open, onOpenChange, companyId, onSupplierAdded }) {
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(""); setContactName(""); setPhone(""); setEmail(""); setNotes(""); };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Supplier name is required"); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.from("suppliers").insert({
        company_id: companyId, name: name.trim(), contact_name: contactName.trim() || null,
        phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null,
      }).select().single();
      if (error) throw error;
      toast.success(`Supplier "${data.name}" added`);
      onSupplierAdded(data);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message || "Failed to add supplier");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Add Supplier</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Supplier / Company Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Green Valley Farms" autoFocus /></div>
          <div><Label>Contact Person</Label><Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="e.g. John" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="071 234 5678" /></div>
            <div><Label>Email</Label><Input value={email} onChange={e => setEmail(e.target.value)} placeholder="supplier@email.com" /></div>
          </div>
          <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" /></div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} className="flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={!name.trim() || saving} className="flex-1">{saving ? "Saving..." : "Add Supplier"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Product Form ─────────────────────────────────────────────── */

function ProductForm({
  product, products, categories, productTypes, stores, suppliers,
  activeStoreId, getStoreStock,
  onSave, onCancel, isSaving,
  onAddCategory, onDeleteCategory,
  onAddType, onDeleteType,
  onAddSupplier,
}) {
  /* When editing, the stock box always refers to one specific store. Default to
     the store being viewed, or the only store if there is just one. */
  const initialStoreId = product
    ? (activeStoreId || (stores && stores.length === 1 ? stores[0].id : ""))
    : "";

  const initialInv = product && initialStoreId && getStoreStock
    ? getStoreStock(product.id, initialStoreId)
    : null;

  const [form, setForm] = useState({
    name: product?.name || "",
    category: product?.category || (categories[0] || "flower"),
    sku: product?.sku || "",
    barcode: product?.barcode || "",
    /* Group figures — these move every branch. */
    price: product?._base_price != null ? product._base_price : (product?.price || 0),
    cost_price: product?._base_cost != null ? product._base_cost : (product?.cost_price || 0),
    stock_quantity: product?.stock_quantity || 0,
    low_stock_threshold: product?.low_stock_threshold || 5,
    description: product?.description || "",
    product_type: product?.product_type || "",
    thc_percentage: product?.thc_percentage || "",
    cbd_percentage: product?.cbd_percentage || "",
    terpenes_percentage: product?.terpenes_percentage || "",
    strain_type: product?.strain_type || "",
    is_active: product?.is_active !== false,
    is_aging_stock: product?.is_aging_stock || false,
    is_bundle: product?.is_bundle || false,
    bundle_linked_product_id: product?.bundle_linked_product_id || "",
    bundle_grams: product?.bundle_grams || 3,
    price_tiers: product?.price_tiers || [],
    store_id: initialStoreId,
    /* "Select stores" — which stores carry this product. A store only lists,
       sells and counts the products ticked for it. */
    linked_store_ids: product && getStoreStock
      ? (stores || []).filter(s => getStoreStock(product.id, s.id)).map(s => s.id)
      : [],
    supplier_id: product?.supplier_id || "",
    /* One branch's own figures. Blank means it follows the group price. */
    store_price: overrideToInput(initialInv ? initialInv.price : null),
    store_cost_price: overrideToInput(initialInv ? initialInv.cost_price : null),
  });
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [showNewType, setShowNewType] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [newType, setNewType] = useState("");

  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const isFlowerCategory = ["flower"].includes(form.category);

  /* Offer the canonical strains plus whatever this product already holds, so
     editing a product tagged with a legacy value doesn't silently blank it. */
  const strainOptions = (() => {
    const seen = [...STRAIN_TYPES];
    const current = form.strain_type ? String(form.strain_type).trim().toLowerCase() : "";
    if (current && seen.indexOf(current) === -1) seen.push(current);
    return seen;
  })();

  useEffect(() => {
    if (form.category === "bundle" && !form.is_bundle) {
      update("is_bundle", true);
    } else if (form.category !== "bundle" && form.is_bundle) {
      update("is_bundle", false);
      update("bundle_linked_product_id", "");
      update("bundle_grams", 3);
    }
  }, [form.category]);

  /* Switching the target store must reload that store's actual figures,
     otherwise the box still shows the previous store's numbers and saving
     would overwrite good stock — or a good price — with the wrong value. */
  const handleStoreChange = (storeId) => {
    update("store_id", storeId);
    if (product && storeId && getStoreStock) {
      const row = getStoreStock(product.id, storeId);
      update("stock_quantity", row ? toNum(row.stock_quantity) : 0);
      update("low_stock_threshold", row && row.low_stock_threshold != null
        ? toNum(row.low_stock_threshold)
        : (product.low_stock_threshold || 5));
      update("store_price", overrideToInput(row ? row.price : null));
      update("store_cost_price", overrideToInput(row ? row.cost_price : null));
    }
  };

  const handleAddCategory = () => {
    if (!newCat.trim()) return;
    const slug = newCat.trim().toLowerCase().replace(/\s+/g, "_");
    onAddCategory(slug);
    update("category", slug);
    setNewCat("");
    setShowNewCategory(false);
  };

  const handleAddType = () => {
    if (!newType.trim()) return;
    onAddType(newType.trim());
    update("product_type", newType.trim());
    setNewType("");
    setShowNewType(false);
  };

  const flowerProducts = (products || []).filter(p =>
    p.category === "flower" && p.id !== product?.id && p.is_active !== false
  );
  const linkedProduct = flowerProducts.find(p => p.id === form.bundle_linked_product_id);
  const targetStoreName = (stores || []).find(s => s.id === form.store_id)?.name;
  const storeLabel = targetStoreName || "this store";
  const storePriceSet = hasOverride(form.store_price);
  const effectiveStorePrice = resolveStorePrice(toNum(form.price), form.store_price);

  return (
    <div className="space-y-4">
      <div>
        <Label>Product Name *</Label>
        <Input value={form.name} onChange={e => update("name", e.target.value)} placeholder="e.g. OG Kush" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Category</Label>
          {showNewCategory ? (
            <div className="flex gap-2">
              <Input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category name" onKeyDown={e => e.key === "Enter" && handleAddCategory()} autoFocus />
              <Button size="sm" onClick={handleAddCategory}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowNewCategory(false); setNewCat(""); }}><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <Select value={form.category} onValueChange={v => {
              if (v === "__new__") { setShowNewCategory(true); return; }
              update("category", v);
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <div key={c} className="flex items-center justify-between group pr-1">
                    <SelectItem value={c} className="flex-1">
                      {c.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                    </SelectItem>
                    {onDeleteCategory && c !== form.category && (
                      <button type="button" className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={e => { e.preventDefault(); e.stopPropagation(); onDeleteCategory(c); }} title={`Delete "${c.replace(/_/g, " ")}"`}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                <SelectItem value="__new__" className="text-primary font-medium border-t">+ Add new category</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <div>
          <Label>Type</Label>
          {showNewType ? (
            <div className="flex gap-2">
              <Input value={newType} onChange={e => setNewType(e.target.value)} placeholder="New type name" onKeyDown={e => e.key === "Enter" && handleAddType()} autoFocus />
              <Button size="sm" onClick={handleAddType}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowNewType(false); setNewType(""); }}><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <Select value={form.product_type || "__none__"} onValueChange={v => {
              if (v === "__new__") { setShowNewType(true); return; }
              update("product_type", v === "__none__" ? "" : v);
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {productTypes.map(t => (
                  <div key={t} className="flex items-center justify-between group pr-1">
                    <SelectItem value={t} className="flex-1">{t}</SelectItem>
                    {onDeleteType && t !== form.product_type && (
                      <button type="button" className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={e => { e.preventDefault(); e.stopPropagation(); onDeleteType(t); }} title={`Delete "${t}"`}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                <SelectItem value="__new__" className="text-primary font-medium border-t">+ Add new type</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ── Select stores ── */}
      {stores && stores.length > 0 && (
        <div className="rounded-lg border border-border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2"><Store className="h-4 w-4" /> Select stores</Label>
            <div className="flex gap-3 text-xs">
              <button type="button" className="text-primary hover:underline"
                onClick={() => update("linked_store_ids", stores.map(s => s.id))}>Select all</button>
              <button type="button" className="text-muted-foreground hover:underline"
                onClick={() => update("linked_store_ids", [])}>Clear</button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {stores.map(s => {
              const checked = form.linked_store_ids.indexOf(s.id) !== -1;
              return (
                <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-1.5 hover:bg-muted/50">
                  <input type="checkbox" checked={checked}
                    onChange={() => update("linked_store_ids", checked
                      ? form.linked_store_ids.filter(id => id !== s.id)
                      : [...form.linked_store_ids, s.id])} />
                  <span>{s.name}</span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            A store only shows, sells and counts this product when it is ticked here. Unticking a store that still holds stock is blocked.
          </p>
        </div>
      )}

      {/* ── Supplier ── */}
      <div>
        <Label>Supplier</Label>
        <Select value={form.supplier_id || "__none__"} onValueChange={v => {
          if (v === "__add_new__") { onAddSupplier(); return; }
          update("supplier_id", v === "__none__" ? "" : v);
        }}>
          <SelectTrigger><SelectValue placeholder="Select supplier..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— No Supplier —</SelectItem>
            {(suppliers || []).map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
            <SelectItem value="__add_new__" className="text-primary font-medium border-t">
              <span className="flex items-center gap-1"><Plus className="h-3 w-3" /> Add new supplier</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.is_bundle && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-blue-400 font-medium text-sm"><Link2 className="h-4 w-4" /> Bundle Settings</div>
          <div>
            <Label>Linked Flower Product *</Label>
            <Select value={form.bundle_linked_product_id || "__none__"} onValueChange={v => update("bundle_linked_product_id", v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select flower product..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Select flower —</SelectItem>
                {flowerProducts.map(p => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
              </SelectContent>
            </Select>
            {linkedProduct && (
              <p className="text-xs text-muted-foreground mt-1">Stock: {linkedProduct.stock_quantity}g available @ {formatCurrency(linkedProduct.price)}/g</p>
            )}
          </div>
          <div>
            <Label>Bundle Grams</Label>
            <Input type="number" min={1} value={form.bundle_grams} onFocus={sel} onChange={e => update("bundle_grams", Number(e.target.value))} />
            <p className="text-xs text-muted-foreground mt-1">Each sale deducts {form.bundle_grams}g from the linked flower's stock.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div><Label>SKU (optional)</Label><Input value={form.sku} onChange={e => update("sku", e.target.value)} placeholder="Internal code" /></div>
        <div>
          <Label>Barcode</Label>
          <Input value={form.barcode} onChange={e => update("barcode", e.target.value)} placeholder="Auto-generated on save" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        A unique barcode is auto-assigned to new products. Leave blank to auto-generate, or paste a supplier's existing barcode to use theirs. This is what the scanner reads at the till.
      </p>

      {/* ── Group price ──
          Labelled for what it actually does. This used to read "Sell Price" and
          sat next to a store-scoped stock box, so it looked store-scoped too. */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Sell Price — all stores *</Label>
          <Input type="number" min={0} step={0.01} value={form.price} onFocus={sel} onChange={e => update("price", Number(e.target.value))} />
        </div>
        <div>
          <Label>Cost Price — all stores</Label>
          <Input type="number" min={0} step={0.01} value={form.cost_price} onFocus={sel} onChange={e => update("cost_price", Number(e.target.value))} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        {stores && stores.length > 1
          ? "This is the price every branch uses. To price one branch differently, use the store box below."
          : "This is the price your till charges."}
      </p>

      {product && storePriceSet && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 -mt-1">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/90">
            <span className="font-medium">{storeLabel}</span> has its own price of {formatCurrency(toNum(form.store_price))} and
            will keep it. Changing the price above moves the other branches only.
          </p>
        </div>
      )}

      {/* Gram Pricing Tiers — only show when editing a product that already has tiers */}
      {isFlowerCategory && product && form.price_tiers && form.price_tiers.length > 0 && (
        <PriceTiersEditor tiers={form.price_tiers} onChange={val => update("price_tiers", val)} />
      )}

      {/* ── Stock Assignment — NEW product ── */}
      {!product && stores && stores.length > 0 && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-blue-400 font-medium text-sm"><Store className="h-4 w-4" /> Stock Assignment</div>
          <div>
            <Label>Store</Label>
            <Select value={form.store_id || "__none__"} onValueChange={v => update("store_id", v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select store..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— No store (add stock later) —</SelectItem>
                {stores.map(s => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Initial Stock Quantity</Label>
            <Input type="number" min={0} value={form.stock_quantity} onFocus={sel} onChange={e => update("stock_quantity", Math.max(0, Number(e.target.value)))} />
          </div>
          {form.store_id && stores.length > 1 && (
            <div>
              <Label>Sell Price at {storeLabel}</Label>
              <Input type="number" min={0} step={0.01} value={form.store_price}
                onFocus={sel}
                onChange={e => update("store_price", e.target.value)}
                placeholder={`Leave blank — uses ${formatCurrency(toNum(form.price))}`} />
              <p className="text-xs text-muted-foreground mt-1">
                Only fill this in if {storeLabel} charges something different.
              </p>
            </div>
          )}
          {stores.length > 1 && (
            <p className="text-xs text-blue-300/90">
              The product goes into your whole catalogue, but only shows on a branch's till once that branch has stock.
            </p>
          )}
        </div>
      )}

      {/* ── Stock + Price at one store — EDIT product ── */}
      {product && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-blue-400 font-medium text-sm">
            <Store className="h-4 w-4" /> Stock &amp; Price at one store
          </div>

          {stores && stores.length > 1 && (
            <div>
              <Label>Store *</Label>
              <Select value={form.store_id || "__none__"} onValueChange={v => handleStoreChange(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select which store..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Select store —</SelectItem>
                  {stores.map(s => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Stock Quantity</Label>
              <Input type="number" min={0} value={form.stock_quantity} onFocus={sel}
                onChange={e => update("stock_quantity", Math.max(0, Number(e.target.value)))} />
            </div>
            <div>
              <Label>Low Stock Threshold</Label>
              <Input type="number" min={0} value={form.low_stock_threshold} onFocus={sel}
                onChange={e => update("low_stock_threshold", Math.max(0, Number(e.target.value)))} />
            </div>
          </div>

          {form.store_id && (
            <div className="grid grid-cols-2 gap-4 pt-1 border-t border-blue-500/30">
              <div>
                <Label>Sell Price here</Label>
                <Input type="number" min={0} step={0.01} value={form.store_price}
                  onFocus={sel}
                  onChange={e => update("store_price", e.target.value)}
                  placeholder={`Blank — uses ${formatCurrency(toNum(form.price))}`} />
              </div>
              <div>
                <Label>Cost Price here</Label>
                <Input type="number" min={0} step={0.01} value={form.store_cost_price}
                  onFocus={sel}
                  onChange={e => update("store_cost_price", e.target.value)}
                  placeholder={`Blank — uses ${formatCurrency(toNum(form.cost_price))}`} />
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {form.store_id
              ? <>Stock and price apply to <span className="text-blue-300 font-medium">{storeLabel}</span> only. Other stores keep their own. Leave the price blank and this branch follows the {formatCurrency(toNum(form.price))} above.</>
              : "Pick a store above — stock and price are held per store, not across all of them."}
          </p>

          {form.store_id && storePriceSet && (
            <p className="text-xs text-blue-300 font-medium">
              {storeLabel} will ring up {formatCurrency(effectiveStorePrice)}.
            </p>
          )}
        </div>
      )}

      {!product && (
        <div><Label>Low Stock Threshold</Label><Input type="number" min={0} value={form.low_stock_threshold} onFocus={sel} onChange={e => update("low_stock_threshold", Math.max(0, Number(e.target.value)))} /></div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <Label>THC %</Label>
          <Input type="number" min={0} max={100} step={0.1} value={form.thc_percentage} onFocus={sel} onChange={e => update("thc_percentage", e.target.value ? Number(e.target.value) : "")} placeholder="e.g. 22" />
        </div>
        <div>
          <Label>CBD %</Label>
          <Input type="number" min={0} max={100} step={0.1} value={form.cbd_percentage} onFocus={sel} onChange={e => update("cbd_percentage", e.target.value ? Number(e.target.value) : "")} placeholder="e.g. 0.5" />
        </div>
        <div>
          <Label>Terpenes %</Label>
          <Input type="number" min={0} max={100} step={0.1} value={form.terpenes_percentage} onFocus={sel} onChange={e => update("terpenes_percentage", e.target.value ? Number(e.target.value) : "")} placeholder="e.g. 2.5" />
        </div>
        <div>
          <Label>Strain Type</Label>
          <Select value={form.strain_type || "__none__"} onValueChange={v => update("strain_type", v === "__none__" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">N/A</SelectItem>
              {strainOptions.map(s => (
                <SelectItem key={s} value={s}>{formatStrain(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div><Label>Description</Label><Input value={form.description} onChange={e => update("description", e.target.value)} placeholder="Optional description" /></div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch checked={form.is_active} onCheckedChange={v => update("is_active", v)} />
          <Label>Active</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={form.is_aging_stock} onCheckedChange={v => update("is_aging_stock", v)} />
          <Label className="flex items-center gap-1"><Clock className="h-3 w-3" /> Aging Stock</Label>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={!form.name.trim() || isSaving} className="flex-1">
          {isSaving ? "Saving..." : product ? "Update Product" : "Create Product"}
        </Button>
      </div>
    </div>
  );
}

/* ─── Main Products Page ───────────────────────────────────────── */

export default function Products() {
  const { companyId, loading: companyLoading, activeStoreId } = useCompany();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStrain, setSelectedStrain] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [productTypes, setProductTypes] = useState(DEFAULT_TYPES);
  const [stores, setStores] = useState([]);
  const [storeInventory, setStoreInventory] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  /* ── Store view ──────────────────────────────────────────────────
     The sidebar's store picker sets the whole app's active store. This page
     also needs its own, because looking at one branch's stock here should not
     force the till and every other screen to switch with it. It starts on
     whatever the sidebar says and follows the sidebar when that changes, but
     from then on the button at the top of this page wins.

     "" means all stores combined. */
  const [viewStoreId, setViewStoreId] = useState(activeStoreId || "");
  useEffect(() => { setViewStoreId(activeStoreId || ""); }, [activeStoreId]);

  /* Which product's per-store stock breakdown is open, when viewing all stores. */
  const [expandedStock, setExpandedStock] = useState(null);

  /* By default only products with stock in the viewed store (or across all
     stores) are listed. The toggle next to the search box shows the rest. */
  const [showOutOfStock, setShowOutOfStock] = useState(false);

  /* Delete flow state */
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePreview, setDeletePreview] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadCompanySettings = useCallback(async () => {
    if (!companyId) return;
    try {
      const { data } = await supabase.from("companies").select("product_categories, product_types").eq("id", companyId).single();
      if (data?.product_categories) {
        const cats = data.product_categories;
        if (!cats.includes("bundle")) cats.splice(1, 0, "bundle");
        setCategories(cats);
      }
      if (data?.product_types) {
        const types = data.product_types;
        if (!types.includes("3g Special")) types.push("3g Special");
        if (!types.includes("5g Special")) types.push("5g Special");
        setProductTypes(types);
      }
    } catch (_) {}
  }, [companyId]);

  /* Pull every product, not the first 1000. Clubs run well past that. */
  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const rows = await fetchAllRows(() =>
        supabase.from("products").select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
      );
      setProducts(rows);
    } catch (err) {
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const loadStores = useCallback(async () => {
    if (!companyId) return;
    try {
      const { data } = await supabase.from("stores").select("id, name").eq("company_id", companyId).eq("is_active", true).order("name");
      setStores(data || []);
    } catch (_) {}
  }, [companyId]);

  /* Paginated. Previously this capped at 1000 rows, so with several stores most
     products fell off the end of the result and rendered as 0 stock even though
     the database held the right figure.

     Fetched two ways and merged: by company_id, and by the company's store ids.
     A handful of rows in production have an inventory company_id that doesn't
     match their store's company_id, so either filter alone loses stock for
     someone. The union covers both and de-dupes.

     price and cost_price ride along — they are the per-store overrides. */
  const loadStoreInventory = useCallback(async () => {
    if (!companyId) return;
    const COLS = "product_id, store_id, stock_quantity, low_stock_threshold, price, cost_price";
    try {
      const byCompany = await fetchAllRows(() =>
        supabase.from("store_inventory").select(COLS)
          .eq("company_id", companyId)
          .order("product_id", { ascending: true })
      );

      let byStore = [];
      const { data: storeRows } = await supabase.from("stores").select("id").eq("company_id", companyId);
      const storeIds = (storeRows || []).map(s => s.id);
      if (storeIds.length > 0) {
        byStore = await fetchAllRows(() =>
          supabase.from("store_inventory").select(COLS)
            .in("store_id", storeIds)
            .order("product_id", { ascending: true })
        );
      }

      const merged = {};
      for (const r of byCompany) merged[r.product_id + "|" + r.store_id] = r;
      for (const r of byStore) merged[r.product_id + "|" + r.store_id] = r;
      setStoreInventory(Object.values(merged));
    } catch (_) {
      setStoreInventory([]);
    }
  }, [companyId]);

  const loadSuppliers = useCallback(async () => {
    if (!companyId) return;
    try {
      const { data } = await supabase.from("suppliers").select("id, name").eq("company_id", companyId).eq("is_active", true).order("name");
      setSuppliers(data || []);
    } catch (_) {}
  }, [companyId]);

  useEffect(() => {
    if (companyId) { load(); loadCompanySettings(); loadStores(); loadStoreInventory(); loadSuppliers(); }
  }, [companyId, load, loadCompanySettings, loadStores, loadStoreInventory, loadSuppliers]);

  /* Index inventory once instead of scanning the whole array per product. */
  const invByKey = {};
  const invByProduct = {};
  for (const inv of storeInventory) {
    invByKey[inv.product_id + "|" + inv.store_id] = inv;
    if (!invByProduct[inv.product_id]) invByProduct[inv.product_id] = [];
    invByProduct[inv.product_id].push(inv);
  }

  const getStoreStock = (productId, storeId) => invByKey[productId + "|" + storeId] || null;

  const storeNameById = {};
  for (const s of stores) storeNameById[s.id] = s.name;

  /* store_inventory is the authoritative stock source, and now the authoritative
     price source too when a single store is selected. products.stock_quantity is
     legacy and is not read here.

     _base_price is carried through so the form can edit the group price without
     the store price standing in for it. */
  const enrichedProducts = products.map(p => {
    const rows = invByProduct[p.id] || [];

    /* Per-store breakdown, always built — it powers the expandable stock cell
       in the all-stores view and costs nothing to keep. Stores with no
       inventory row for this product are shown as 0 so a branch that has
       simply never been stocked is visible rather than absent. */
    const byStore = stores.map(s => {
      const inv = invByKey[p.id + "|" + s.id];
      return {
        store_id: s.id,
        store_name: s.name,
        qty: inv ? toNum(inv.stock_quantity) : 0,
        has_row: !!inv,
        price: resolveStorePrice(p.price, inv ? inv.price : null),
        price_override: inv && hasOverride(inv.price) ? Number(inv.price) : null,
        low_stock_threshold: inv && inv.low_stock_threshold != null
          ? toNum(inv.low_stock_threshold)
          : toNum(p.low_stock_threshold) || 5,
      };
    });

    if (viewStoreId) {
      const inv = invByKey[p.id + "|" + viewStoreId];
      return {
        ...p,
        price: resolveStorePrice(p.price, inv ? inv.price : null),
        cost_price: resolveStorePrice(p.cost_price, inv ? inv.cost_price : null),
        _base_price: p.price,
        _base_cost: p.cost_price,
        _price_override: inv && hasOverride(inv.price) ? Number(inv.price) : null,
        _by_store: byStore,
        stock_quantity: inv ? toNum(inv.stock_quantity) : 0,
        low_stock_threshold: inv && inv.low_stock_threshold != null
          ? toNum(inv.low_stock_threshold)
          : toNum(p.low_stock_threshold) || 5,
        store_count: rows.length,
      };
    }
    /* Across all stores there is no single right price to show — branches may
       differ — so the group price stands. */
    let total = 0;
    for (const inv of rows) total += toNum(inv.stock_quantity);
    let overrides = 0;
    for (const inv of rows) if (hasOverride(inv.price)) overrides++;
    return {
      ...p,
      _base_price: p.price,
      _base_cost: p.cost_price,
      _price_override: null,
      _override_store_count: overrides,
      _by_store: byStore,
      stock_quantity: total,
      low_stock_threshold: toNum(p.low_stock_threshold) || 5,
      store_count: rows.length,
    };
  });

  const saveCategoriesToCompany = async (newCats) => { setCategories(newCats); await supabase.from("companies").update({ product_categories: newCats }).eq("id", companyId); };
  const saveTypesToCompany = async (newTypes) => { setProductTypes(newTypes); await supabase.from("companies").update({ product_types: newTypes }).eq("id", companyId); };

  const handleAddCategory = (slug) => { if (!categories.includes(slug)) { saveCategoriesToCompany([...categories, slug]); toast.success(`Category "${slug.replace(/_/g, " ")}" added`); } };
  const handleDeleteCategory = (slug) => {
    const used = products.filter(p => p.category === slug);
    if (used.length > 0) { toast.error(`Can't delete "${slug.replace(/_/g, " ")}" — ${used.length} product(s) still use it.`); return; }
    if (!confirm(`Delete category "${slug.replace(/_/g, " ")}"?`)) return;
    saveCategoriesToCompany(categories.filter(c => c !== slug));
    if (selectedCategory === slug) setSelectedCategory("");
    toast.success(`Category "${slug.replace(/_/g, " ")}" deleted`);
  };
  const handleAddType = (name) => { if (!productTypes.includes(name)) { saveTypesToCompany([...productTypes, name]); toast.success(`Type "${name}" added`); } };
  const handleDeleteType = (name) => {
    const used = products.filter(p => p.product_type === name);
    if (used.length > 0) { toast.error(`Can't delete "${name}" — ${used.length} product(s) still use it.`); return; }
    if (!confirm(`Delete type "${name}"?`)) return;
    saveTypesToCompany(productTypes.filter(t => t !== name));
    toast.success(`Type "${name}" deleted`);
  };

  const handleSupplierAdded = (newSupplier) => {
    setSuppliers(prev => [...prev, newSupplier].sort((a, b) => a.name.localeCompare(b.name)));
  };

  /* Apply the "Select stores" tick-list. Ticking links the product to the
     store with 0 stock. Unticking removes the link, but never while the store
     still holds stock. Returns the names of stores that could not be unlinked. */
  const applyStoreLinks = async (productId, wanted) => {
    const blocked = [];
    for (const st of stores) {
      const inv = invByKey[productId + "|" + st.id];
      const want = wanted.indexOf(st.id) !== -1;
      if (want && !inv) {
        const { error } = await supabase.from("store_inventory").upsert({
          product_id: productId, store_id: st.id, company_id: companyId,
          stock_quantity: 0, low_stock_threshold: 5,
        }, { onConflict: "product_id,store_id", ignoreDuplicates: true });
        if (error) throw error;
      } else if (!want && inv) {
        if (toNum(inv.stock_quantity) > 0) { blocked.push(st.name); continue; }
        const { error } = await supabase.from("store_inventory").delete()
          .eq("product_id", productId).eq("store_id", st.id);
        if (error) throw error;
      }
    }
    if (blocked.length) toast.error("Still holds stock, so not unlinked: " + blocked.join(", "));
  };

  const handleCreate = async (data) => {
    setIsSaving(true);
    try {
      const storeId = data.store_id && data.store_id !== "__none__" ? data.store_id : null;
      const stockQty = Math.max(0, toNum(data.stock_quantity));
      const storePrice = inputToOverride(data.store_price);
      const storeCost = inputToOverride(data.store_cost_price);
      if (storePrice !== null && storePrice < 0) { toast.error("Store price can't be negative"); setIsSaving(false); return; }
      const cleanTiers = (data.price_tiers || []).filter(t => t.grams > 0 && t.price > 0);
      const insertData = {
        name: data.name, category: data.category, sku: data.sku, price: data.price,
        cost_price: data.cost_price,
        /* Seed the legacy column only when no store is chosen, so it can't
           drift out of step with per-store levels afterwards. */
        stock_quantity: storeId ? 0 : stockQty,
        low_stock_threshold: data.low_stock_threshold,
        description: data.description, product_type: data.product_type,
        thc_percentage: data.thc_percentage || null, cbd_percentage: data.cbd_percentage || null, terpenes_percentage: data.terpenes_percentage || null,
        strain_type: data.strain_type || null, is_active: data.is_active, is_aging_stock: data.is_aging_stock,
        is_bundle: data.is_bundle,
        bundle_linked_product_id: data.is_bundle ? data.bundle_linked_product_id : null,
        bundle_grams: data.is_bundle ? data.bundle_grams : null,
        price_tiers: cleanTiers, company_id: companyId,
        supplier_id: data.supplier_id || null,
      };
      // Only set barcode if the user typed one — otherwise omit it so the
      // database auto-generates a unique code via its column default.
      if (data.barcode && data.barcode.trim()) insertData.barcode = data.barcode.trim();
      const { data: newProduct, error } = await supabase.from("products").insert(insertData).select().single();
      if (error) throw error;

      if (storeId) {
        const { error: invError } = await supabase.from("store_inventory").upsert({
          product_id: newProduct.id,
          store_id: storeId,
          company_id: companyId,
          stock_quantity: stockQty,
          low_stock_threshold: Math.max(0, toNum(data.low_stock_threshold)),
          price: storePrice,
          cost_price: storeCost,
        }, { onConflict: "product_id,store_id" });
        if (invError) throw invError;
      }
      const wantedLinks = (data.linked_store_ids || []).slice();
      if (storeId && wantedLinks.indexOf(storeId) === -1) wantedLinks.push(storeId);
      await applyStoreLinks(newProduct.id, wantedLinks);
      const createdStoreName = stores.find(s => s.id === storeId)?.name;
      toast.success(storePrice !== null && createdStoreName
        ? `Product created · ${createdStoreName} priced at ${formatCurrency(storePrice)}`
        : "Product created");
      setShowForm(false);
      await load(); await loadStoreInventory();
    } catch (err) {
      toast.error(err?.message || "Failed to create product");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (data) => {
    /* Never guess the store — writing stock or a price to the wrong branch is
       worse than refusing to save. */
    const targetStoreId = data.store_id || viewStoreId || (stores.length === 1 ? stores[0].id : null);
    if (!targetStoreId && stores.length > 0) {
      toast.error("Pick which store this stock belongs to before saving.");
      return;
    }

    const storePrice = inputToOverride(data.store_price);
    const storeCost = inputToOverride(data.store_cost_price);
    if (storePrice !== null && storePrice < 0) { toast.error("Store price can't be negative"); return; }
    if (storeCost !== null && storeCost < 0) { toast.error("Store cost price can't be negative"); return; }

    setIsSaving(true);
    try {
      const cleanTiers = (data.price_tiers || []).filter(t => t.grams > 0 && t.price > 0);
      const updateData = {
        name: data.name, category: data.category, sku: data.sku, price: data.price,
        cost_price: data.cost_price,
        /* stock_quantity deliberately omitted — store_inventory owns it. */
        low_stock_threshold: data.low_stock_threshold,
        description: data.description, product_type: data.product_type,
        thc_percentage: data.thc_percentage || null, cbd_percentage: data.cbd_percentage || null, terpenes_percentage: data.terpenes_percentage || null,
        strain_type: data.strain_type || null, is_active: data.is_active, is_aging_stock: data.is_aging_stock,
        is_bundle: data.is_bundle,
        bundle_linked_product_id: data.is_bundle ? data.bundle_linked_product_id : null,
        bundle_grams: data.is_bundle ? data.bundle_grams : null,
        price_tiers: cleanTiers,
        supplier_id: data.supplier_id || null,
      };
      // Update barcode only when a value is present, so an empty field
      // doesn't wipe the existing auto-generated code.
      if (data.barcode && data.barcode.trim()) updateData.barcode = data.barcode.trim();
      const { error } = await supabase.from("products").update(updateData).eq("id", editProduct.id);
      if (error) throw error;

      if (targetStoreId) {
        const { error: invError } = await supabase.from("store_inventory").upsert({
          product_id: editProduct.id,
          store_id: targetStoreId,
          company_id: companyId,
          stock_quantity: Math.max(0, toNum(data.stock_quantity)),
          low_stock_threshold: Math.max(0, toNum(data.low_stock_threshold)),
          price: storePrice,
          cost_price: storeCost,
        }, { onConflict: "product_id,store_id" });
        if (invError) throw invError;
      }

      const wantedLinks = (data.linked_store_ids || []).slice();
      if (targetStoreId && wantedLinks.indexOf(targetStoreId) === -1) wantedLinks.push(targetStoreId);
      await applyStoreLinks(editProduct.id, wantedLinks);

      const storeName = stores.find(s => s.id === targetStoreId)?.name;
      let msg = "Product updated";
      if (storeName) {
        msg = storePrice !== null
          ? `Product updated · ${storeName} sells at ${formatCurrency(storePrice)}`
          : `Product updated · stock saved to ${storeName}`;
      }
      toast.success(msg);
      setEditProduct(null);
      await load(); await loadStoreInventory();
    } catch (err) {
      toast.error(err?.message || "Failed to update product");
    } finally {
      setIsSaving(false);
    }
  };

  /* Open the confirm dialog and fetch a preview of what will be removed. */
  const handleDelete = async (product) => {
    setDeleteTarget(product);
    setDeletePreview(null);
    try {
      const { data, error } = await supabase.rpc("product_delete_preview", { p_product_id: product.id });
      if (error) throw error;
      if (data && data.ok === false) {
        toast.error(data.error || "Could not check this product");
        setDeleteTarget(null);
        return;
      }
      setDeletePreview(data);
    } catch (err) {
      toast.error(err?.message || "Could not check this product");
      setDeleteTarget(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc("delete_product_and_data", { p_product_id: deleteTarget.id });
      if (error) throw error;
      if (data && data.ok === false) {
        toast.error(data.error || "Failed to delete product");
        return;
      }
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      setDeletePreview(null);
      await load(); await loadStoreInventory();
    } catch (err) {
      toast.error(err?.message || "Failed to delete product");
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeletePreview(null);
  };

  const filtered = enrichedProducts.filter(p => {
    if (!showOutOfStock && p.category !== "bundle" && !(toNum(p.stock_quantity) > 0)) return false;
    if (selectedCategory && p.category !== selectedCategory) return false;
    if (selectedStrain) {
      const s = p.strain_type ? String(p.strain_type).trim().toLowerCase() : "";
      if (selectedStrain === "__untagged__") { if (s) return false; }
      else if (s !== selectedStrain) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (p.name || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q) || (p.barcode || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q) || (p.product_type || "").toLowerCase().includes(q) || (p.strain_type || "").toLowerCase().includes(q);
    }
    return true;
  });

  const categoryCounts = {};
  for (const p of enrichedProducts) { const cat = p.category || "other"; categoryCounts[cat] = (categoryCounts[cat] || 0) + 1; }

  /* Strain options and counts, built from what this company actually holds so a
     legacy value never becomes unfilterable. */
  const strainCounts = {};
  let untaggedCount = 0;
  for (const p of enrichedProducts) {
    const s = p.strain_type ? String(p.strain_type).trim().toLowerCase() : "";
    if (!s) { untaggedCount++; continue; }
    strainCounts[s] = (strainCounts[s] || 0) + 1;
  }
  const strainOptions = Object.keys(strainCounts).sort();

  const totalStock = filtered.reduce((s, p) => s + toNum(p.stock_quantity), 0);
  const totalRetailValue = filtered.reduce((s, p) => s + toNum(p.stock_quantity) * toNum(p.price), 0);
  const totalCostValue = filtered.reduce((s, p) => s + toNum(p.stock_quantity) * toNum(p.cost_price), 0);

  /* Stock held per store, over whatever is currently filtered. Drives the
     summary strip so a manager can see where the units sit without opening a
     single product. */
  const stockByStore = stores.map(s => {
    let qty = 0;
    let skus = 0;
    for (const p of filtered) {
      const row = (p._by_store || []).find(b => b.store_id === s.id);
      const n = row ? row.qty : 0;
      qty += n;
      if (n > 0) skus++;
    }
    return { id: s.id, name: s.name, qty, skus };
  });

  /* Build a supplier lookup map for the table */
  const supplierMap = {};
  for (const s of suppliers) { supplierMap[s.id] = s.name; }

  const viewStoreName = stores.find(s => s.id === viewStoreId)?.name;
  const isFilteredView = !!(search || selectedCategory || selectedStrain);
  const multiStore = stores.length > 1;

  if (companyLoading || loading) {
    return (<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>);
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" /> Products</h1>
          <p className="text-muted-foreground text-sm">
            {isFilteredView
              ? <>{filtered.length} of {enrichedProducts.length} products</>
              : <>{enrichedProducts.length} products</>} · {totalStock} units in stock
            {viewStoreId
              ? <span> · {viewStoreName || "Selected store"}</span>
              : multiStore && <span> · all {stores.length} stores combined</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* ── Store picker ──
              Scoped to this page. Stock, prices and the totals row all follow
              it. The sidebar's store still sets the app default and this
              resets to it whenever that changes. */}
          {multiStore && (
            <Select value={viewStoreId || "__all__"} onValueChange={v => {
              setViewStoreId(v === "__all__" ? "" : v);
              setExpandedStock(null);
            }}>
              <SelectTrigger className={cn("w-[190px]", viewStoreId && "border-primary/60 text-primary")}>
                <span className="flex items-center gap-2 truncate">
                  <Store className="h-4 w-4 shrink-0" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Stores ({stores.length})</SelectItem>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button asChild variant="outline"><Link to="/print-labels"><Printer className="h-4 w-4 mr-1" /> Print Labels</Link></Button>
          <Button variant="outline" onClick={() => setShowBulk(true)}><Upload className="h-4 w-4 mr-1" /> Bulk Upload</Button>
          <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1" /> Add Product</Button>
        </div>
      </div>

      {/* Stock per store at a glance. Also doubles as a one-click switch into
          a branch, which is what most people actually want after seeing a
          number they don't like. */}
      {multiStore && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setViewStoreId(""); setExpandedStock(null); }}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition-colors min-w-[130px]",
              !viewStoreId ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:bg-muted/60"
            )}
          >
            <div className="text-xs text-muted-foreground">All Stores</div>
            <div className="text-sm font-semibold">{totalStock} units</div>
          </button>
          {stockByStore.map(s => (
            <button
              key={s.id}
              onClick={() => { setViewStoreId(s.id); setExpandedStock(null); }}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors min-w-[130px]",
                viewStoreId === s.id ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:bg-muted/60"
              )}
            >
              <div className="text-xs text-muted-foreground truncate max-w-[160px]">{s.name}</div>
              <div className="text-sm font-semibold">{s.qty} units</div>
              <div className="text-[10px] text-muted-foreground">{s.skus} product{s.skus === 1 ? "" : "s"} stocked</div>
            </button>
          ))}
        </div>
      )}

      {/* Which prices am I looking at? Without this the table reads as one set
          of numbers for the whole club, which is how a group price gets edited
          by someone who meant to change one branch. */}
      {multiStore && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <Tag className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            {viewStoreId
              ? <>Stock and prices shown are <span className="font-medium text-foreground">{viewStoreName}</span>'s. Edit a product to change this branch's price or the group price.</>
              : <>Showing stock added up across all {stores.length} stores, at group prices. Pick a store above, or click a stock figure to see the split per branch.</>}
          </p>
        </div>
      )}

      <div className="flex gap-1 flex-wrap">
        <button className={cn("px-3 py-1.5 rounded-full text-sm font-medium transition-colors", !selectedCategory ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80")} onClick={() => setSelectedCategory("")}>All ({enrichedProducts.length})</button>
        {categories.map(cat => {
          const count = categoryCounts[cat] || 0;
          return (<button key={cat} className={cn("px-3 py-1.5 rounded-full text-sm font-medium transition-colors", selectedCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80")} onClick={() => setSelectedCategory(selectedCategory === cat ? "" : cat)}>{cat.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())} ({count})</button>);
        })}
      </div>

      {/* Strain filter — only rendered once a club has tagged something */}
      {(strainOptions.length > 0 || untaggedCount > 0) && (
        <div className="flex gap-1 flex-wrap items-center">
          <span className="text-xs text-muted-foreground mr-1">Strain:</span>
          <button
            className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors", !selectedStrain ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80")}
            onClick={() => setSelectedStrain("")}
          >
            All
          </button>
          {strainOptions.map(s => (
            <button
              key={s}
              className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors",
                selectedStrain === s ? "bg-primary text-primary-foreground" : cn(strainClasses(s), "hover:opacity-80"))}
              onClick={() => setSelectedStrain(selectedStrain === s ? "" : s)}
            >
              {formatStrain(s)} ({strainCounts[s]})
            </button>
          ))}
          {untaggedCount > 0 && (
            <button
              className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors", selectedStrain === "__untagged__" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80")}
              onClick={() => setSelectedStrain(selectedStrain === "__untagged__" ? "" : "__untagged__")}
              title="Products with no strain type set"
            >
              Not set ({untaggedCount})
            </button>
          )}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products, SKU, barcode or strain..." className="pl-9" />
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={showOutOfStock} onCheckedChange={setShowOutOfStock} />
        Show out-of-stock products
        {!showOutOfStock && (
          <span className="text-xs">({enrichedProducts.filter(p => p.category !== "bundle" && !(toNum(p.stock_quantity) > 0)).length} hidden)</span>
        )}
      </label>

      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Product</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Category</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Type</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Strain</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">Supplier</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">SKU</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">Barcode</th>
                <th className="text-right p-3 font-medium">Price</th>
                <th className="text-right p-3 font-medium hidden md:table-cell">Cost</th>
                <th className="text-right p-3 font-medium">
                  Stock{viewStoreName ? <span className="block text-[10px] font-normal text-muted-foreground">{viewStoreName}</span> : null}
                </th>
                <th className="text-right p-3 font-medium hidden lg:table-cell">Retail Val</th>
                <th className="text-right p-3 font-medium hidden lg:table-cell">Cost Val</th>
                <th className="text-center p-3 font-medium">Status</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 && (<tr><td colSpan={14} className="text-center text-muted-foreground py-12">{search || selectedStrain ? "No products match your filters" : "No products yet"}</td></tr>)}
              {filtered.map(p => {
                const qty = toNum(p.stock_quantity);
                const threshold = toNum(p.low_stock_threshold) || 5;
                /* Out of stock and low stock are different problems and should
                   not look identical — red used to fire on both, which read as
                   an error on perfectly healthy stock sitting on its threshold. */
                const isOut = qty <= 0;
                const isLow = !isOut && qty <= threshold;
                const retailVal = qty * toNum(p.price);
                const costVal = qty * toNum(p.cost_price);
                const hasTiers = p.price_tiers && p.price_tiers.length > 0;
                const strainLabel = formatStrain(p.strain_type);
                const isOverridden = p._price_override !== null && p._price_override !== undefined;
                const canExpand = !viewStoreId && multiStore;
                const isExpanded = expandedStock === p.id;
                return (
                  <Fragment key={p.id}>
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground md:hidden">
                        {(p.category || "").replace(/_/g, " ")} · {p.product_type || "—"}{strainLabel ? " · " + strainLabel : ""}
                      </div>
                      {p.supplier_id && supplierMap[p.supplier_id] && (
                        <div className="text-xs text-muted-foreground md:hidden flex items-center gap-1"><Truck className="h-3 w-3" /> {supplierMap[p.supplier_id]}</div>
                      )}
                      {p.barcode && (<div className="text-xs text-muted-foreground lg:hidden font-mono">🏷️ {p.barcode}</div>)}
                      {p.is_bundle && (<span className="inline-flex items-center gap-1 text-xs text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded mt-0.5"><Link2 className="h-3 w-3" /> Bundle</span>)}
                      {hasTiers && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {p.price_tiers.map((t, ti) => (<span key={ti} className="inline-block text-xs bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">{t.label || t.grams + "g"}: {formatCurrency(t.price)}</span>))}
                        </div>
                      )}
                    </td>
                    <td className="p-3 hidden md:table-cell"><span className="inline-block px-2 py-0.5 rounded bg-muted text-xs">{(p.category || "other").replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</span></td>
                    <td className="p-3 text-muted-foreground hidden md:table-cell">{p.product_type || "—"}</td>
                    <td className="p-3 hidden md:table-cell">
                      {strainLabel ? <StrainBadge value={p.strain_type} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-3 text-muted-foreground hidden lg:table-cell">
                      {p.supplier_id && supplierMap[p.supplier_id] ? (
                        <span className="inline-flex items-center gap-1 text-xs"><Truck className="h-3 w-3" /> {supplierMap[p.supplier_id]}</span>
                      ) : "—"}
                    </td>
                    <td className="p-3 text-muted-foreground text-xs font-mono hidden lg:table-cell">{p.sku || "—"}</td>
                    <td className="p-3 text-muted-foreground text-xs font-mono hidden lg:table-cell">{p.barcode || "—"}</td>
                    <td className="p-3 text-right font-medium">
                      {formatCurrency(p.price)}
                      {isOverridden && (
                        <div className="text-[10px] font-normal text-primary" title={`Group price ${formatCurrency(p._base_price)}`}>
                          {viewStoreName} price
                        </div>
                      )}
                      {!viewStoreId && p._override_store_count > 0 && (
                        <div className="text-[10px] font-normal text-muted-foreground" title="Some branches price this differently">
                          {p._override_store_count} store{p._override_store_count === 1 ? "" : "s"} differ
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right text-muted-foreground hidden md:table-cell">{formatCurrency(p.cost_price)}</td>
                    <td className={cn("p-3 text-right font-medium", isOut ? "text-red-500" : isLow ? "text-amber-500" : "")}>
                      {canExpand ? (
                        <button
                          type="button"
                          onClick={() => setExpandedStock(isExpanded ? null : p.id)}
                          className="inline-flex items-center gap-1 hover:underline"
                          title="Show stock per store"
                        >
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {qty}
                        </button>
                      ) : qty}
                      {isOut && <AlertTriangle className="inline h-3 w-3 ml-1" title="Out of stock" />}
                      {isLow && <AlertTriangle className="inline h-3 w-3 ml-1" title={`Low stock (threshold ${threshold})`} />}
                      {!viewStoreId && p.store_count > 1 && (
                        <div className="text-[10px] text-muted-foreground font-normal">across {p.store_count} stores</div>
                      )}
                    </td>
                    <td className="p-3 text-right text-muted-foreground hidden lg:table-cell">{formatCurrency(retailVal)}</td>
                    <td className="p-3 text-right text-muted-foreground hidden lg:table-cell">{formatCurrency(costVal)}</td>
                    <td className="p-3 text-center">
                      {p.is_active ? (<span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Active" />) : (<span className="inline-block w-2 h-2 rounded-full bg-gray-300" title="Inactive" />)}
                      {p.is_aging_stock && <Clock className="inline h-3 w-3 ml-1 text-amber-500" title="Aging" />}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="Print label"><Link to="/print-labels"><Printer className="h-3.5 w-3.5" /></Link></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditProduct(p)}><Edit className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDelete(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>

                  {/* Per-store split for this one product. Only reachable from
                      the all-stores view, where the single figure otherwise
                      hides which branch is actually empty. */}
                  {canExpand && isExpanded && (
                    <tr className="bg-muted/20">
                      <td colSpan={14} className="p-3">
                        <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                          <Store className="h-3 w-3" /> {p.name} — stock per store
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(p._by_store || []).map(b => {
                            const bOut = b.qty <= 0;
                            const bLow = !bOut && b.qty <= b.low_stock_threshold;
                            return (
                              <button
                                key={b.store_id}
                                type="button"
                                onClick={() => { setViewStoreId(b.store_id); setExpandedStock(null); }}
                                className="rounded-md border border-border bg-background px-3 py-2 text-left hover:border-primary/60 transition-colors min-w-[140px]"
                                title={`View ${b.store_name}`}
                              >
                                <div className="text-xs text-muted-foreground truncate max-w-[160px]">{b.store_name}</div>
                                <div className={cn("text-sm font-semibold", bOut ? "text-red-500" : bLow ? "text-amber-500" : "")}>
                                  {b.qty} {bOut ? "· out" : bLow ? "· low" : ""}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {formatCurrency(b.price)}
                                  {b.price_override !== null && <span className="text-primary"> · own price</span>}
                                </div>
                              </button>
                            );
                          })}
                          {(p._by_store || []).length === 0 && (
                            <span className="text-xs text-muted-foreground">No stores set up yet.</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="bg-muted/30 font-medium text-sm">
                <tr>
                  <td className="p-3" colSpan={9}>
                    Totals{isFilteredView ? " (filtered)" : ""}
                    {viewStoreName && <span className="text-muted-foreground font-normal"> · {viewStoreName}</span>}
                  </td>
                  <td className="p-3 text-right">{totalStock}</td>
                  <td className="p-3 text-right hidden lg:table-cell">{formatCurrency(totalRetailValue)}</td>
                  <td className="p-3 text-right hidden lg:table-cell">{formatCurrency(totalCostValue)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Add Product Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Product</DialogTitle></DialogHeader>
          <ProductForm products={products} categories={categories} productTypes={productTypes} stores={stores} suppliers={suppliers}
            activeStoreId={viewStoreId} getStoreStock={getStoreStock}
            onSave={handleCreate} onCancel={() => setShowForm(false)} isSaving={isSaving}
            onAddCategory={handleAddCategory} onDeleteCategory={handleDeleteCategory} onAddType={handleAddType} onDeleteType={handleDeleteType}
            onAddSupplier={() => setShowAddSupplier(true)} />
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={!!editProduct} onOpenChange={() => setEditProduct(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Product</DialogTitle></DialogHeader>
          {editProduct && (
            <ProductForm key={editProduct.id + "|" + viewStoreId} product={editProduct} products={products} categories={categories} productTypes={productTypes} stores={stores} suppliers={suppliers}
              activeStoreId={viewStoreId} getStoreStock={getStoreStock}
              onSave={handleUpdate} onCancel={() => setEditProduct(null)} isSaving={isSaving}
              onAddCategory={handleAddCategory} onDeleteCategory={handleDeleteCategory} onAddType={handleAddType} onDeleteType={handleDeleteType}
              onAddSupplier={() => setShowAddSupplier(true)} />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Product Dialog */}
      <DeleteProductDialog
        open={!!deleteTarget}
        product={deleteTarget}
        preview={deletePreview}
        busy={deleting}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />

      {/* Add Supplier Dialog */}
      <AddSupplierDialog open={showAddSupplier} onOpenChange={setShowAddSupplier} companyId={companyId} onSupplierAdded={handleSupplierAdded} />
      <BulkProductImportDialog
        open={showBulk}
        onClose={() => setShowBulk(false)}
        companyId={companyId}
        products={products}
        stores={stores}
        suppliers={suppliers}
        defaultStoreId={viewStoreId}
        categories={categories}
        productTypes={productTypes}
        onAddCategories={(slugs) => saveCategoriesToCompany([...categories, ...slugs.filter(c => !categories.includes(c))])}
        onAddTypes={(names) => saveTypesToCompany([...productTypes, ...names.filter(t => !productTypes.includes(t))])}
        onDone={async () => { await load(); await loadStoreInventory(); }}
      />
    </div>
  );
}
