import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import {
  Search, Package, Store, MapPin, Phone, MessageCircle, Filter, ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import MarketplaceGate, { MarketplaceComplianceBanner } from "@/components/MarketplaceGate";

const CATEGORIES = [
  "flower", "pre_rolls", "edibles", "concentrates", "oils",
  "vapes", "accessories", "equipment", "packaging", "seeds",
  "nutrients", "lighting", "other",
];

export default function Marketplace() {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [viewProduct, setViewProduct] = useState(null);
  const [viewSupplier, setViewSupplier] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prodsRes, supsRes] = await Promise.all([
        supabase
          .from("marketplace_products")
          .select("*, marketplace_suppliers(id, business_name, location, whatsapp, phone, email, logo_url, description, is_verified)")
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("marketplace_suppliers")
          .select("id, business_name, location, is_verified")
          .eq("is_active", true)
          .order("business_name"),
      ]);

      setProducts(prodsRes.data || []);
      setSuppliers(supsRes.data || []);
    } catch (err) {
      toast.error("Failed to load marketplace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (filterCategory && p.category !== filterCategory) return false;
      if (filterSupplier && p.marketplace_suppliers?.id !== filterSupplier) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (p.name || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          (p.marketplace_suppliers?.business_name || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, filterCategory, filterSupplier, search]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const p of products) {
      const cat = p.category || "other";
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [products]);

  const openWhatsApp = (product) => {
    const sup = product.marketplace_suppliers;
    if (!sup?.whatsapp && !sup?.phone) {
      toast.error("No WhatsApp number available for this supplier");
      return;
    }
    const number = (sup.whatsapp || sup.phone).replace(/\D/g, "");
    const fullNumber = number.startsWith("0") ? "27" + number.slice(1) : number;
    const msg = encodeURIComponent(
      `Hi ${sup.business_name}, I'm interested in your product "${product.name}" listed on Cannalife Co Marketplace. Could you share more details?`
    );
    window.open(`https://wa.me/${fullNumber}?text=${msg}`, "_blank");
  };

  const openEmail = (product) => {
    const sup = product.marketplace_suppliers;
    if (!sup?.email) {
      toast.error("No email available for this supplier");
      return;
    }
    const subject = encodeURIComponent(`Enquiry about ${product.name} - Cannalife Co Marketplace`);
    const body = encodeURIComponent(
      `Hi ${sup.business_name},\n\nI'm interested in your product "${product.name}" listed on Cannalife Co Marketplace.\n\nCould you share pricing, availability, and delivery details?\n\nThanks`
    );
    window.open(`mailto:${sup.email}?subject=${subject}&body=${body}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Store className="h-6 w-6" /> Marketplace
        </h1>
        <p className="text-sm text-muted-foreground">
          Browse products from {suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""} · {products.length} products available
        </p>
      </div>

      {/* Compliance status banner (hidden once verified) */}
      <MarketplaceComplianceBanner />

      {/* Category tabs */}
      <div className="flex gap-1 flex-wrap">
        <button
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
            !filterCategory ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
          )}
          onClick={() => setFilterCategory("")}
        >
          All ({products.length})
        </button>
        {CATEGORIES.filter(c => categoryCounts[c]).map(cat => (
          <button
            key={cat}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors capitalize",
              filterCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
            )}
            onClick={() => setFilterCategory(filterCategory === cat ? "" : cat)}
          >
            {cat.replace(/_/g, " ")} ({categoryCounts[cat]})
          </button>
        ))}
      </div>

      {/* Search + Supplier filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products or suppliers..." className="pl-9" />
        </div>
        {suppliers.length > 1 && (
          <Select value={filterSupplier || "__all__"} onValueChange={v => setFilterSupplier(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Suppliers</SelectItem>
              {suppliers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.business_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Product Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-lg font-medium">No products found</p>
          <p className="text-sm text-muted-foreground">
            {search || filterCategory || filterSupplier
              ? "Try adjusting your filters"
              : "No suppliers have listed products yet"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => {
            const sup = p.marketplace_suppliers;
            return (
              <div
                key={p.id}
                className="bg-card rounded-xl border border-border overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group"
                onClick={() => setViewProduct(p)}
              >
                {/* Image */}
                <div className="aspect-square bg-muted relative overflow-hidden">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-12 h-12 text-muted-foreground/50" />
                    </div>
                  )}
                  <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 text-white text-[10px] rounded-full capitalize">
                    {(p.category || "other").replace(/_/g, " ")}
                  </span>
                </div>

                {/* Info */}
                <div className="p-3 space-y-1">
                  <h3 className="font-semibold text-sm truncate">{p.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">{p.description || "No description"}</p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-lg font-bold text-primary">{Number(p.price).toFixed(2)}</span>
                    <span className="text-[10px] text-muted-foreground">per {p.unit} · MOQ {p.min_order_qty}</span>
                  </div>
                  {sup && (
                    <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
                      <Store className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">{sup.business_name}</span>
                      {sup.is_verified && <span className="text-[10px] text-green-500">✓</span>}
                      {sup.location && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <MapPin className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground truncate">{sup.location}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Product Detail Dialog */}
      <Dialog open={!!viewProduct} onOpenChange={() => setViewProduct(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewProduct?.name}</DialogTitle></DialogHeader>
          {viewProduct && (() => {
            const sup = viewProduct.marketplace_suppliers;
            return (
              <div className="space-y-4">
                {viewProduct.image_url && (
                  <img src={viewProduct.image_url} alt={viewProduct.name} className="w-full aspect-video object-cover rounded-lg" />
                )}

                <div>
                  <span className="px-2 py-0.5 bg-muted rounded text-xs capitalize">
                    {(viewProduct.category || "other").replace(/_/g, " ")}
                  </span>
                </div>

                {viewProduct.description && (
                  <p className="text-sm text-muted-foreground">{viewProduct.description}</p>
                )}

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-muted rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Price</p>
                    <p className="text-lg font-bold text-primary">{Number(viewProduct.price).toFixed(2)}</p>
                    <p className="text-[10px] text-muted-foreground">per {viewProduct.unit}</p>
                  </div>
                  <div className="bg-muted rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Min Order</p>
                    <p className="text-lg font-bold">{viewProduct.min_order_qty}</p>
                    <p className="text-[10px] text-muted-foreground">{viewProduct.unit}(s)</p>
                  </div>
                  <div className="bg-muted rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Min Total</p>
                    <p className="text-lg font-bold">{(viewProduct.price * viewProduct.min_order_qty).toFixed(2)}</p>
                  </div>
                </div>

                {/* Supplier info */}
                {sup && (
                  <div className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Store className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">{sup.business_name}</span>
                      {sup.is_verified && <span className="text-xs text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">Verified</span>}
                    </div>
                    {sup.description && <p className="text-xs text-muted-foreground">{sup.description}</p>}
                    {sup.location && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {sup.location}
                      </p>
                    )}
                  </div>
                )}

                {/* Action buttons — gated per supplier */}
                <MarketplaceGate supplierId={sup?.id} className="w-full">
                  <div className="flex gap-2">
                    {(sup?.whatsapp || sup?.phone) && (
                      <Button
                        onClick={() => openWhatsApp(viewProduct)}
                        className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                      >
                        <MessageCircle className="w-4 h-4" /> WhatsApp
                      </Button>
                    )}
                    {sup?.email && (
                      <Button
                        variant="outline"
                        onClick={() => openEmail(viewProduct)}
                        className="flex-1 gap-2"
                      >
                        <ExternalLink className="w-4 h-4" /> Email
                      </Button>
                    )}
                    {sup?.phone && (
                      <Button
                        variant="outline"
                        onClick={() => window.open(`tel:${sup.phone}`)}
                        className="gap-2"
                      >
                        <Phone className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </MarketplaceGate>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
