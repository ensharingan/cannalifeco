import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import {
  Plus, Edit, Trash2, Package, Settings, LogOut, Leaf, Store, Save, Eye, EyeOff, Upload, X, Image,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const PRODUCT_CATEGORIES = [
  "flower", "pre_rolls", "edibles", "concentrates", "oils",
  "vapes", "accessories", "equipment", "packaging", "seeds",
  "nutrients", "lighting", "other",
];

const UNITS = ["each", "gram", "kg", "pack", "box", "case", "bag", "bottle", "roll"];

function ProductForm({ product, supplierId, onSave, onCancel, isSaving }) {
  const [form, setForm] = useState({
    name: product?.name || "",
    description: product?.description || "",
    category: product?.category || "other",
    price: product?.price || 0,
    unit: product?.unit || "each",
    min_order_qty: product?.min_order_qty || 1,
    image_url: product?.image_url || "",
    thc_percentage: product?.thc_percentage || "",
    cbd_percentage: product?.cbd_percentage || "",
    strain_type: product?.strain_type || "",
    is_active: product?.is_active !== false,
  });
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState(product?.image_url || "");
  const fileRef = useRef(null);

  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `${supplierId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(`supplier-products/${fileName}`, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("uploads")
        .getPublicUrl(`supplier-products/${fileName}`);

      const publicUrl = urlData.publicUrl;
      update("image_url", publicUrl);
      setImagePreview(publicUrl);
      toast.success("Image uploaded");
    } catch (err) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    update("image_url", "");
    setImagePreview("");
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Product Name *</Label>
        <Input value={form.name} onChange={e => update("name", e.target.value)} placeholder="e.g. Premium OG Kush" autoFocus />
      </div>
      <div>
        <Label>Description</Label>
        <Textarea value={form.description} onChange={e => update("description", e.target.value)} placeholder="Describe your product..." rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Category</Label>
          <Select value={form.category} onValueChange={v => update("category", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRODUCT_CATEGORIES.map(c => (
                <SelectItem key={c} value={c} className="capitalize">
                  {c.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Unit</Label>
          <Select value={form.unit} onValueChange={v => update("unit", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNITS.map(u => (
                <SelectItem key={u} value={u} className="capitalize">{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Price (R)</Label>
          <Input type="number" min={0} step={0.01} value={form.price} onChange={e => update("price", Number(e.target.value))} />
        </div>
        <div>
          <Label>Min Order Qty</Label>
          <Input type="number" min={1} value={form.min_order_qty} onChange={e => update("min_order_qty", Number(e.target.value))} />
        </div>
      </div>

      {/* THC / CBD / Strain */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>THC %</Label>
          <Input type="number" min={0} max={100} step={0.1} value={form.thc_percentage} onChange={e => update("thc_percentage", e.target.value ? Number(e.target.value) : "")} placeholder="e.g. 22" />
        </div>
        <div>
          <Label>CBD %</Label>
          <Input type="number" min={0} max={100} step={0.1} value={form.cbd_percentage} onChange={e => update("cbd_percentage", e.target.value ? Number(e.target.value) : "")} placeholder="e.g. 0.5" />
        </div>
        <div>
          <Label>Strain Type</Label>
          <Select value={form.strain_type || "__none__"} onValueChange={v => update("strain_type", v === "__none__" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">N/A</SelectItem>
              <SelectItem value="Indica">Indica</SelectItem>
              <SelectItem value="Sativa">Sativa</SelectItem>
              <SelectItem value="Hybrid">Hybrid</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Image Upload */}
      <div>
        <Label>Product Image</Label>
        {imagePreview ? (
          <div className="mt-2 flex items-start gap-3">
            <img src={imagePreview} alt="Product" className="w-24 h-24 rounded-lg object-cover border border-border" />
            <div className="space-y-2">
              <button type="button" onClick={removeImage} className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1">
                <X className="w-3 h-3" /> Remove image
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className="text-primary hover:text-primary/80 text-xs flex items-center gap-1">
                <Upload className="w-3 h-3" /> Replace
              </button>
            </div>
          </div>
        ) : (
          <label className="mt-2 flex items-center gap-3 px-4 py-4 rounded-lg border border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors">
            <Image className="w-5 h-5 text-muted-foreground" />
            <div>
              <span className="text-sm text-muted-foreground">{uploading ? "Uploading..." : "Click to upload product image"}</span>
              <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG up to 5MB</p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
          </label>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={form.is_active} onCheckedChange={v => update("is_active", v)} />
        <Label>Listed (visible to buyers)</Label>
      </div>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={!form.name.trim() || isSaving} className="flex-1">
          {isSaving ? "Saving..." : product ? "Update Product" : "Add Product"}
        </Button>
      </div>
    </div>
  );
}

export default function SupplierDashboard() {
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/supplier-login"); return; }

      const { data: sup, error: supErr } = await supabase
        .from("marketplace_suppliers")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (supErr || !sup) {
        toast.error("No supplier profile found");
        navigate("/supplier-login");
        return;
      }

      setSupplier(sup);
      setProfileForm(sup);

      const { data: prods } = await supabase
        .from("marketplace_products")
        .select("*")
        .eq("supplier_id", sup.id)
        .order("created_at", { ascending: false });

      setProducts(prods || []);
    } catch (err) {
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    try {
      const { error } = await supabase
        .from("marketplace_suppliers")
        .update({
          business_name: profileForm.business_name,
          contact_name: profileForm.contact_name,
          phone: profileForm.phone,
          whatsapp: profileForm.whatsapp,
          location: profileForm.location,
          description: profileForm.description,
        })
        .eq("id", supplier.id);
      if (error) throw error;
      toast.success("Profile updated");
      setSupplier(prev => ({ ...prev, ...profileForm }));
    } catch (err) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleCreateProduct = async (data) => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("marketplace_products")
        .insert({
          ...data,
          supplier_id: supplier.id,
          thc_percentage: data.thc_percentage || null,
          cbd_percentage: data.cbd_percentage || null,
          strain_type: data.strain_type || null,
        });
      if (error) throw error;
      toast.success("Product listed");
      setShowProductForm(false);
      await loadData();
    } catch (err) {
      toast.error(err.message || "Failed to add product");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateProduct = async (data) => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("marketplace_products")
        .update({
          ...data,
          thc_percentage: data.thc_percentage || null,
          cbd_percentage: data.cbd_percentage || null,
          strain_type: data.strain_type || null,
        })
        .eq("id", editProduct.id);
      if (error) throw error;
      toast.success("Product updated");
      setEditProduct(null);
      await loadData();
    } catch (err) {
      toast.error(err.message || "Failed to update product");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProduct = async (id) => {
    if (!confirm("Delete this product?")) return;
    try {
      const { error } = await supabase.from("marketplace_products").delete().eq("id", id);
      if (error) throw error;
      toast.success("Product deleted");
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      toast.error("Failed to delete product");
    }
  };

  const handleToggleActive = async (product) => {
    try {
      const { error } = await supabase
        .from("marketplace_products")
        .update({ is_active: !product.is_active })
        .eq("id", product.id);
      if (error) throw error;
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_active: !p.is_active } : p));
      toast.success(product.is_active ? "Product hidden" : "Product listed");
    } catch (err) {
      toast.error("Failed to update product");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/supplier-login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="h-16 border-b border-border bg-card/50 flex items-center justify-between px-4 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center">
            <Leaf className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg">Canna Life Co</span>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Supplier Portal</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium hidden sm:inline">{supplier?.business_name}</span>
          {supplier?.is_verified ? (
            <span className="text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full hidden sm:inline">Verified</span>
          ) : (
            <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full hidden sm:inline">Pending verification</span>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 lg:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Store className="h-6 w-6" /> {supplier?.business_name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {products.length} product{products.length !== 1 ? "s" : ""} listed
              {!supplier?.is_verified && (
                <span className="ml-2 text-amber-500 text-xs">· Pending verification</span>
              )}
            </p>
          </div>
          <Button onClick={() => setShowProductForm(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Product
          </Button>
        </div>

        <Tabs defaultValue="products">
          <TabsList>
            <TabsTrigger value="products">
              <Package className="w-4 h-4 mr-1" /> Products
            </TabsTrigger>
            <TabsTrigger value="profile">
              <Settings className="w-4 h-4 mr-1" /> Profile
            </TabsTrigger>
          </TabsList>

          {/* Products Tab */}
          <TabsContent value="products" className="mt-4">
            {products.length === 0 ? (
              <div className="text-center py-16 bg-card rounded-xl border border-border">
                <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-lg font-medium">No products yet</p>
                <p className="text-sm text-muted-foreground mb-4">Add your first product to start reaching dispensary owners.</p>
                <Button onClick={() => setShowProductForm(true)} className="gap-2">
                  <Plus className="w-4 h-4" /> Add Your First Product
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {products.map(p => (
                  <div key={p.id} className="bg-card rounded-xl border border-border overflow-hidden hover:border-primary/30 transition-colors">
                    {/* Product image */}
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-full h-40 object-cover" />
                    ) : (
                      <div className="w-full h-40 bg-muted flex items-center justify-center">
                        <Package className="w-10 h-10 text-muted-foreground" />
                      </div>
                    )}
                    <div className="p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-sm">{p.name}</h3>
                          {p.description && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{p.description}</p>}
                        </div>
                        <button onClick={() => handleToggleActive(p)} title={p.is_active ? "Click to hide" : "Click to list"}>
                          {p.is_active ? (
                            <Eye className="w-4 h-4 text-green-500" />
                          ) : (
                            <EyeOff className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 bg-muted rounded text-xs capitalize">{(p.category || "other").replace(/_/g, " ")}</span>
                        {p.strain_type && <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded text-xs">{p.strain_type}</span>}
                        {p.thc_percentage && <span className="text-xs text-muted-foreground">THC {p.thc_percentage}%</span>}
                        {p.cbd_percentage && <span className="text-xs text-muted-foreground">CBD {p.cbd_percentage}%</span>}
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-border">
                        <div>
                          <span className="text-lg font-bold text-primary">R{Number(p.price).toFixed(2)}</span>
                          <span className="text-xs text-muted-foreground ml-1">/{p.unit}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditProduct(p)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => handleDeleteProduct(p.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Profile Tab */}
          <TabsContent value="profile" className="mt-4">
            <div className="bg-card rounded-xl border border-border p-6 space-y-4 max-w-xl">
              <h3 className="font-semibold">Business Profile</h3>
              <div>
                <Label>Business Name</Label>
                <Input value={profileForm.business_name || ""} onChange={e => setProfileForm(p => ({ ...p, business_name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Contact Person</Label>
                  <Input value={profileForm.contact_name || ""} onChange={e => setProfileForm(p => ({ ...p, contact_name: e.target.value }))} />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input value={profileForm.phone || ""} onChange={e => setProfileForm(p => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>WhatsApp</Label>
                  <Input value={profileForm.whatsapp || ""} onChange={e => setProfileForm(p => ({ ...p, whatsapp: e.target.value }))} />
                </div>
                <div>
                  <Label>Location</Label>
                  <Input value={profileForm.location || ""} onChange={e => setProfileForm(p => ({ ...p, location: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>About</Label>
                <Textarea value={profileForm.description || ""} onChange={e => setProfileForm(p => ({ ...p, description: e.target.value }))} rows={3} />
              </div>
              <Button onClick={handleSaveProfile} disabled={isSavingProfile} className="gap-2">
                <Save className="w-4 h-4" />
                {isSavingProfile ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Product Dialog */}
      <Dialog open={showProductForm} onOpenChange={setShowProductForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Product</DialogTitle></DialogHeader>
          <ProductForm supplierId={supplier?.id} onSave={handleCreateProduct} onCancel={() => setShowProductForm(false)} isSaving={isSaving} />
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={!!editProduct} onOpenChange={() => setEditProduct(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Product</DialogTitle></DialogHeader>
          {editProduct && (
            <ProductForm product={editProduct} supplierId={supplier?.id} onSave={handleUpdateProduct} onCancel={() => setEditProduct(null)} isSaving={isSaving} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
