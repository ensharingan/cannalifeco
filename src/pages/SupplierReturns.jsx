import { useState, useEffect, useCallback } from "react";
import { supabase } from '@/api/supabaseClient';
import { Plus, Search, Eye, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";

const statusColors = {
  draft:        "bg-slate-100 text-slate-600 border-slate-200",
  sent:         "bg-blue-500/10 text-blue-600 border-blue-200",
  acknowledged: "bg-yellow-500/10 text-yellow-600 border-yellow-200",
  credited:     "bg-green-500/10 text-green-600 border-green-200",
  rejected:     "bg-red-500/10 text-red-600 border-red-200",
};

const parseItems = (v) => {
  try { let x = v; if (typeof x === "string") x = JSON.parse(x); if (typeof x === "string") x = JSON.parse(x); return Array.isArray(x) ? x : []; } catch { return []; }
};
const reasons = ["damaged", "expired", "short_delivery", "incorrect_order", "overstock", "quality_issue", "other"];
const statuses = ["draft", "sent", "acknowledged", "credited", "rejected"];

function generateRFC() {
  return "RFC-" + Date.now().toString(36).toUpperCase();
}

const emptyForm = {
  supplier_id: "",
  supplier_name: "",
  reason: "damaged",
  status: "draft",
  notes: "",
  items: [],
};

export default function SupplierReturns() {
  const { companyId } = useCompany();
  const [returns, setReturns] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [viewReturn, setViewReturn] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [{ data: returnsData }, { data: suppliersData }, { data: productsData }] = await Promise.all([
        supabase.from('supplier_returns').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(200),
        supabase.from('suppliers').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100),
        supabase.from('products').select('id, name, cost_price, price').eq('company_id', companyId).order('name').limit(200),
      ]);
      setReturns(returnsData || []);
      setSuppliers(suppliersData || []);
      setProducts(productsData || []);
    } catch (err) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const addItem = () => setForm(f => ({
    ...f,
    items: [...f.items, { product_id: "", product_name: "", quantity: 1, unit_cost: 0 }]
  }));

  const updateItem = (idx, field, value) => setForm(f => {
    const items = [...f.items];
    items[idx] = { ...items[idx], [field]: value };
    if (field === "product_id") {
      const p = products.find(p => p.id === value);
      if (p) {
        items[idx].product_name = p.name;
        items[idx].unit_cost = p.cost_price || p.price || 0;
      }
    }
    return { ...f, items };
  });

  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const totalCredit = form.items.reduce((s, i) => s + (Number(i.quantity) * Number(i.unit_cost)), 0);

  const handleSave = async () => {
    if (!form.supplier_id || form.items.length === 0) {
      toast.error("Select a supplier and add at least one item");
      return;
    }
    setIsSaving(true);
    try {
      const { error } = await supabase.from('supplier_returns').insert({
        company_id: companyId,
        rfc_number: generateRFC(),
        supplier_id: form.supplier_id,
        supplier_name: form.supplier_name,
        reason: form.reason,
        status: form.status,
        notes: form.notes,
        items: JSON.stringify(form.items),
        total_credit: totalCredit,
      });
      if (error) throw error;
      toast.success("RFC created successfully");
      setShowForm(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to create RFC');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusUpdate = async (ret, status) => {
    try {
      const { error } = await supabase
        .from('supplier_returns')
        .update({ status })
        .eq('id', ret.id);
      if (error) throw error;
      toast.success(`Status updated to ${status}`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  const filtered = returns.filter(r =>
    `${r.supplier_name} ${r.rfc_number}`.toLowerCase().includes(search.toLowerCase())
  );

  const totalCredited = returns
    .filter(r => r.status === "credited")
    .reduce((s, r) => s + (r.total_credit || 0), 0);
  const pending = returns.filter(r => ["draft", "sent", "acknowledged"].includes(r.status)).length;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Supplier Returns (RFC)</h1>
          <p className="text-sm text-muted-foreground">Return for Credit requests to suppliers</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setShowForm(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> New RFC
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Total RFCs</p>
          <p className="text-2xl font-bold">{returns.length}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">{pending}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Total Credited</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(totalCredited)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by supplier or RFC number..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">RFC #</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Supplier</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Reason</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Date</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Credit</th>
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="p-3 font-mono text-xs text-muted-foreground">{r.rfc_number}</td>
                  <td className="p-3 text-sm font-medium">{r.supplier_name}</td>
                  <td className="p-3 text-sm capitalize text-muted-foreground hidden md:table-cell">
                    {r.reason?.replace(/_/g, " ")}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground hidden md:table-cell">
                    {new Date(r.created_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="p-3">
                    <span className={cn("text-xs px-2 py-1 rounded-full border font-medium capitalize", statusColors[r.status])}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3 text-right text-sm font-bold">{formatCurrency(r.total_credit || 0)}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => setViewReturn(r)} className="text-muted-foreground hover:text-foreground">
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <p className="text-sm text-muted-foreground text-center py-12">No returns found</p>
        )}
      </div>

      {/* Create RFC dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Return for Credit (RFC)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Supplier *</Label>
                {suppliers.length === 0 ? (
                  <p className="text-xs text-yellow-500 mt-1">
                    No suppliers found. Add suppliers first in the Suppliers page.
                  </p>
                ) : (
                  <Select value={form.supplier_id} onValueChange={v => {
                    const s = suppliers.find(s => s.id === v);
                    setForm(f => ({ ...f, supplier_id: v, supplier_name: s?.name || "" }));
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label>Reason</Label>
                <Select value={form.reason} onValueChange={v => setForm(f => ({ ...f, reason: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {reasons.map(r => (
                      <SelectItem key={r} value={r} className="capitalize">{r.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Return Items *</Label>
                <Button size="sm" variant="outline" onClick={addItem} className="h-7 text-xs gap-1">
                  <Plus className="w-3 h-3" /> Add Item
                </Button>
              </div>
              {form.items.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                  No items added yet
                </p>
              )}
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-muted/30 p-2 rounded-lg">
                    <div className="col-span-5">
                      {idx === 0 && <Label className="text-xs">Product</Label>}
                      <Select value={item.product_id} onValueChange={v => updateItem(idx, "product_id", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select product" /></SelectTrigger>
                        <SelectContent>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      {idx === 0 && <Label className="text-xs">Qty</Label>}
                      <Input
                        type="number" min={1}
                        value={item.quantity}
                        onChange={e => updateItem(idx, "quantity", e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-3">
                      {idx === 0 && <Label className="text-xs">Unit Cost</Label>}
                      <Input
                        type="number" step="0.01"
                        value={item.unit_cost}
                        onChange={e => updateItem(idx, "unit_cost", e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-2 flex items-end justify-end gap-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {formatCurrency(item.quantity * item.unit_cost)}
                      </span>
                      <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-xs ml-1">✕</button>
                    </div>
                  </div>
                ))}
              </div>
              {form.items.length > 0 && (
                <div className="flex justify-end mt-2">
                  <span className="text-sm font-bold">Total Credit: {formatCurrency(totalCredit)}</span>
                </div>
              )}
            </div>

            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes</Label>
              <Input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Additional notes..."
              />
            </div>

            <Button onClick={handleSave} disabled={isSaving} className="w-full">
              {isSaving ? "Creating..." : "Create RFC"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewReturn} onOpenChange={() => setViewReturn(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" /> {viewReturn?.rfc_number}
            </DialogTitle>
          </DialogHeader>
          {viewReturn && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Supplier:</span><br /><span className="font-medium">{viewReturn.supplier_name}</span></div>
                <div><span className="text-muted-foreground">Reason:</span><br /><span className="capitalize">{viewReturn.reason?.replace(/_/g, " ")}</span></div>
                {viewReturn.reason === "short_delivery" && (
                  <div><span className="text-muted-foreground">Supplier to:</span><br /><span>{viewReturn.resolution === "refund" ? "Refund" : "Issue a credit note"}</span></div>
                )}
                <div><span className="text-muted-foreground">Date:</span><br />{new Date(viewReturn.created_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                <div>
                  <span className="text-muted-foreground">Status:</span><br />
                  <span className={cn("text-xs px-2 py-1 rounded-full border font-medium capitalize", statusColors[viewReturn.status])}>
                    {viewReturn.status}
                  </span>
                </div>
              </div>
              {viewReturn.items && (
                <div>
                  <p className="text-sm font-semibold mb-2">Items</p>
                  <div className="space-y-1">
                    {parseItems(viewReturn.items).map((item, i) => (
                      <div key={i} className="flex justify-between text-sm py-1 border-b border-border/50">
                        <span>{item.product_name} × {item.quantity}</span>
                        <span className="font-medium">{formatCurrency(item.quantity * item.unit_cost)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-between font-bold text-base border-t border-border pt-3">
                <span>Total Credit</span>
                <span className="text-green-600">{formatCurrency(viewReturn.total_credit || 0)}</span>
              </div>
              {viewReturn.notes && (
                <p className="text-xs text-muted-foreground italic">{viewReturn.notes}</p>
              )}
              <div>
                <Label className="text-xs">Update Status</Label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {statuses.filter(s => s !== viewReturn.status).map(s => (
                    <Button
                      key={s} size="sm" variant="outline"
                      className="h-7 text-xs capitalize"
                      onClick={() => {
                        handleStatusUpdate(viewReturn, s);
                        setViewReturn(prev => ({ ...prev, status: s }));
                      }}
                    >
                      → {s}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
