import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "@/lib/CompanyContext";
import { Printer, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";

/*
 * Printable delivery note / DC invoice for one stock_transfer_batches row.
 * ho_transfer_stock() (see HeadOffice.jsx) opens a batch and tags every line
 * it moves with batch_id — this reads that batch back, plus the lines and
 * store/product detail, and lays it out as something you can print or PDF.
 *
 * DC invoice = cost recovery for the stock itself, using each product's
 * cost_price at today's catalogue value (there's no price-at-transfer-time
 * snapshot, so this is "what it would cost to restock today", not a
 * historical figure).
 */

export default function TransferDocumentModal({ batchId, open, onClose }) {
  const { company } = useCompany();
  const [loading, setLoading] = useState(false);
  const [batch, setBatch] = useState(null);
  const [lines, setLines] = useState([]);
  const [fromStore, setFromStore] = useState(null);
  const [toStore, setToStore] = useState(null);

  const load = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const { data: batchRow, error: batchErr } = await supabase
        .from("stock_transfer_batches")
        .select("id, company_id, from_store_id, to_store_id, notes, created_at")
        .eq("id", batchId)
        .single();
      if (batchErr) throw batchErr;
      setBatch(batchRow);

      const [{ data: transferRows, error: transferErr }, { data: storeRows, error: storeErr }] =
        await Promise.all([
          supabase
            .from("stock_transfers")
            .select("id, product_id, quantity")
            .eq("batch_id", batchId),
          supabase
            .from("stores")
            .select("id, name, address, city, phone")
            .in("id", [batchRow.from_store_id, batchRow.to_store_id]),
        ]);
      if (transferErr) throw transferErr;
      if (storeErr) throw storeErr;

      setFromStore(storeRows.find((s) => s.id === batchRow.from_store_id) || null);
      setToStore(storeRows.find((s) => s.id === batchRow.to_store_id) || null);

      const productIds = [...new Set((transferRows || []).map((r) => r.product_id))];
      let productById = {};
      if (productIds.length > 0) {
        const { data: productRows, error: productErr } = await supabase
          .from("products")
          .select("id, name, sku, cost_price, price")
          .in("id", productIds);
        if (productErr) throw productErr;
        productById = Object.fromEntries((productRows || []).map((p) => [p.id, p]));
      }

      setLines((transferRows || []).map((r) => {
        const p = productById[r.product_id] || {};
        const unitCost = Number(p.cost_price ?? p.price ?? 0);
        return {
          id: r.id,
          name: p.name || "Product",
          sku: p.sku || "",
          quantity: Number(r.quantity || 0),
          unitCost,
          lineCost: unitCost * Number(r.quantity || 0),
        };
      }));
    } catch (err) {
      toast.error(err.message || "Could not load transfer documents");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    if (open && batchId) load();
    if (!open) { setBatch(null); setLines([]); setFromStore(null); setToStore(null); }
  }, [open, batchId, load]);

  const totalUnits = lines.reduce((s, l) => s + l.quantity, 0);
  const totalCost = lines.reduce((s, l) => s + l.lineCost, 0);
  const docNo = batch ? `DC-${batch.id.slice(0, 8).toUpperCase()}` : "";
  const companyName = company?.trading_name || company?.company_name || "Canna Life Co";

  const print = () => window.print();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto print:max-h-none print:overflow-visible">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-4 h-4" /> Delivery note & DC invoice
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>
        ) : !batch ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {batchId ? "This transfer has no document on record." : "No transfer selected."}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="font-bold text-lg">{companyName}</p>
                <p className="text-xs text-muted-foreground">Internal stock transfer document</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold">{docNo}</p>
                <p className="text-muted-foreground">
                  {new Date(batch.created_at).toLocaleString("en-ZA")}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">From</p>
                <p className="font-medium">{fromStore?.name || "—"}</p>
                {fromStore?.address && <p className="text-xs text-muted-foreground">{fromStore.address}</p>}
                {fromStore?.city && <p className="text-xs text-muted-foreground">{fromStore.city}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">To</p>
                <p className="font-medium">{toStore?.name || "—"}</p>
                {toStore?.address && <p className="text-xs text-muted-foreground">{toStore.address}</p>}
                {toStore?.city && <p className="text-xs text-muted-foreground">{toStore.city}</p>}
              </div>
            </div>

            {batch.notes && (
              <div className="text-sm bg-muted/30 rounded-lg px-3 py-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wide mr-2">Notes</span>
                {batch.notes}
              </div>
            )}

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit Cost</th>
                    <th className="px-3 py-2 text-right">Line Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2">
                        <p className="font-medium">{l.name}</p>
                        {l.sku && <p className="text-xs text-muted-foreground">{l.sku}</p>}
                      </td>
                      <td className="px-3 py-2 text-right">{l.quantity.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(l.unitCost)}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(l.lineCost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right">{totalUnits.toLocaleString()}</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right">{formatCurrency(totalCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              DC invoice cost is each product's current cost price — this build doesn't snapshot
              cost at the moment of transfer, so treat it as today's replacement value rather than
              a historical figure.
            </p>

            <div className="flex justify-end gap-2 print:hidden">
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={print} className="gap-2">
                <Printer className="w-4 h-4" /> Print
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
