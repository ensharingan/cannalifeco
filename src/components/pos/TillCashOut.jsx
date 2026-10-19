import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Banknote } from "lucide-react";

export default function TillCashOut({ sessionId, companyId, storeId }) {
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplier_id: "",
    supplier_name_free: "",
    amount: "",
    reason: "",
  });

  useEffect(() => {
    if (!open || !companyId) return;
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setSuppliers(data || []));
  }, [open, companyId]);

  const reset = () => setForm({ supplier_id: "", supplier_name_free: "", amount: "", reason: "" });

  const handleSubmit = async () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }
    if (!form.supplier_id && !form.supplier_name_free.trim() && !form.reason.trim()) {
      toast.error("Select a supplier or enter a reason");
      return;
    }
    if (!sessionId) { toast.error("No active shift — open your day first"); return; }

    setSaving(true);
    try {
      const selectedSupplier = suppliers.find(s => s.id === form.supplier_id);
      const supplierName = selectedSupplier?.name || form.supplier_name_free.trim() || null;
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase.from("till_cash_outs").insert({
        company_id: companyId,
        store_id: storeId || null,
        cashier_session_id: sessionId,
        supplier_id: form.supplier_id || null,
        supplier_name: supplierName,
        amount,
        reason: form.reason.trim() || null,
        created_by: user?.id || null,
      });

      if (error) throw error;
      toast.success(`${amount.toFixed(2)} cash-out recorded${supplierName ? ` — ${supplierName}` : ""}`);
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err.message || "Failed to record cash-out");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { reset(); setOpen(true); }}
        disabled={!sessionId}
        title={!sessionId ? "Open your shift first" : "Pay a supplier from the till"}
        className="gap-1.5"
      >
        <Banknote className="w-4 h-4" />
        Cash Out
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="cashout-desc">
          <DialogHeader>
            <DialogTitle>Till Cash-Out</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p id="cashout-desc" className="text-sm text-muted-foreground">
              Record cash removed from the till to pay a supplier. Deducted from your expected cash at end of day.
            </p>

            {/* Supplier — native select, no shadcn quirks */}
            <div>
              <Label className="text-xs">Supplier</Label>
              {suppliers.length > 0 ? (
                <select
                  className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={form.supplier_id}
                  onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value, supplier_name_free: "" }))}
                >
                  <option value="">— Select supplier or type below —</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">No suppliers on file — type a name below</p>
              )}
            </div>

            {/* Free-text name if none selected */}
            {!form.supplier_id && (
              <div>
                <Label className="text-xs">Supplier Name (if not in list)</Label>
                <Input
                  placeholder="e.g. John Doe Supplies"
                  value={form.supplier_name_free}
                  onChange={e => setForm(f => ({ ...f, supplier_name_free: e.target.value }))}
                />
              </div>
            )}

            <div>
              <Label className="text-xs">Amount *</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                autoFocus
              />
            </div>

            <div>
              <Label className="text-xs">Reason / Note</Label>
              <Input
                placeholder="e.g. Weekly stock payment"
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="flex-1 gap-2" onClick={handleSubmit} disabled={saving || !form.amount}>
                <Banknote className="w-4 h-4" />
                {saving ? "Recording..." : "Record Cash-Out"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
