import { useState } from "react";
import { supabase } from '@/api/supabaseClient';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "../../lib/currency";
import { toast } from "sonner";
import { RotateCcw, Wallet, Banknote } from "lucide-react";

/**
 * PartialRefundDialog
 * 
 * Shows the order's line items with checkboxes.
 * User can select which items to refund + choose refund method.
 * Creates a record in the `refunds` table and updates order refund_status.
 * Optionally credits the member's store_credit.
 */
export default function PartialRefundDialog({ order, companyId, storeId, onComplete, onCancel }) {
  const [selectedItems, setSelectedItems] = useState({});
  const [refundType, setRefundType] = useState("cash"); // cash | store_credit
  const [notes, setNotes] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const items = order.items || [];

  // Already-refunded items (from previous partial refunds)
  const alreadyRefunded = order.refunded_items || {};

  const toggleItem = (index) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      if (next[index]) {
        delete next[index];
      } else {
        const item = items[index];
        next[index] = {
          ...item,
          refund_qty: item.quantity,
          reason: "",
        };
      }
      return next;
    });
  };

  const updateRefundItem = (index, field, value) => {
    setSelectedItems((prev) => ({
      ...prev,
      [index]: { ...prev[index], [field]: value },
    }));
  };

  const selectedCount = Object.keys(selectedItems).length;
  const refundTotal = Object.values(selectedItems).reduce((sum, item) => {
    return sum + (item.price * item.refund_qty);
  }, 0);

  const handleRefund = async () => {
    if (selectedCount === 0) {
      toast.error("Select at least one item to refund");
      return;
    }

    setIsProcessing(true);
    try {
      const refundItems = Object.values(selectedItems).map((item) => ({
        product_id: item.product_id,
        name: item.name,
        quantity: item.refund_qty,
        price: item.price,
        reason: item.reason || "",
      }));

      // 1. Insert refund record
      const { error: refundError } = await supabase.from("refunds").insert({
        order_id: order.id,
        company_id: companyId,
        store_id: storeId || order.store_id,
        member_id: order.member_id,
        refund_type: refundType,
        items: refundItems,
        total_amount: refundTotal,
        notes,
      });

      if (refundError) throw refundError;

      // 2. Update order refund status
      const allItemsRefunded = items.every((item, idx) => {
        return selectedItems[idx]?.refund_qty === item.quantity || alreadyRefunded[idx];
      });

      const { error: orderError } = await supabase
        .from("orders")
        .update({
          refund_status: allItemsRefunded ? "full" : "partial",
          refund_total: (order.refund_total || 0) + refundTotal,
        })
        .eq("id", order.id);

      if (orderError) throw orderError;

      // 3. If store credit refund, add to member's balance
      if (refundType === "store_credit" && order.member_id) {
        const { data: memberData } = await supabase
          .from("members")
          .select("store_credit")
          .eq("id", order.member_id)
          .single();

        if (memberData) {
          await supabase
            .from("members")
            .update({ store_credit: (memberData.store_credit || 0) + refundTotal })
            .eq("id", order.member_id);
        }
      }

      // 4. Return stock for refunded items
      for (const item of refundItems) {
        if (!item.product_id) continue;

        // Update product stock
        const { data: product } = await supabase
          .from("products")
          .select("stock_quantity")
          .eq("id", item.product_id)
          .single();

        if (product) {
          await supabase
            .from("products")
            .update({ stock_quantity: (product.stock_quantity || 0) + item.quantity })
            .eq("id", item.product_id);
        }

        // Update store inventory if applicable
        if (order.store_id) {
          const { data: inv } = await supabase
            .from("store_inventory")
            .select("stock_quantity")
            .eq("product_id", item.product_id)
            .eq("store_id", order.store_id)
            .single();

          if (inv) {
            await supabase
              .from("store_inventory")
              .update({ stock_quantity: (inv.stock_quantity || 0) + item.quantity })
              .eq("product_id", item.product_id)
              .eq("store_id", order.store_id);
          }
        }
      }

      toast.success(`Refund of ${formatCurrency(refundTotal)} processed${refundType === "store_credit" ? " as store credit" : ""}`);
      onComplete?.();
    } catch (err) {
      console.error("Refund error:", err);
      toast.error("Failed to process refund: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Order #{order.id?.slice(0, 8)} · {order.member_name || "Unknown"} · {formatCurrency(order.total_amount)}
        {order.refund_status && (
          <span className="ml-2 text-amber-500">({order.refund_status} refund applied)</span>
        )}
      </div>

      {/* Item selection */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Select items to refund:</Label>
        {items.map((item, idx) => {
          const isSelected = !!selectedItems[idx];
          const wasRefunded = !!alreadyRefunded[idx];

          return (
            <div
              key={idx}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                wasRefunded
                  ? "border-muted bg-muted/30 opacity-50"
                  : isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
              }`}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleItem(idx)}
                disabled={wasRefunded}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{item.name}</span>
                  <span className="text-sm">{formatCurrency(item.price * item.quantity)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.quantity} × {formatCurrency(item.price)}
                  {item.category && ` · ${item.category}`}
                  {wasRefunded && " · Already refunded"}
                </p>

                {isSelected && (
                  <div className="mt-2 flex gap-2">
                    <div className="w-24">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number"
                        min={0.1}
                        max={item.quantity}
                        step={0.1}
                        value={selectedItems[idx]?.refund_qty || item.quantity}
                        onChange={(e) => updateRefundItem(idx, "refund_qty", parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Reason</Label>
                      <Input
                        value={selectedItems[idx]?.reason || ""}
                        onChange={(e) => updateRefundItem(idx, "reason", e.target.value)}
                        className="h-8 text-sm"
                        placeholder="Optional reason"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Refund method */}
      <div>
        <Label className="text-xs font-semibold">Refund method:</Label>
        <Select value={refundType} onValueChange={setRefundType}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">
              <span className="flex items-center gap-2"><Banknote className="w-4 h-4" /> Cash Refund</span>
            </SelectItem>
            <SelectItem value="store_credit">
              <span className="flex items-center gap-2"><Wallet className="w-4 h-4" /> Store Credit</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Notes */}
      <div>
        <Label className="text-xs font-semibold">Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional refund notes"
          rows={2}
        />
      </div>

      {/* Summary + action */}
      {selectedCount > 0 && (
        <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span>Items to refund</span>
            <span>{selectedCount}</span>
          </div>
          <div className="flex justify-between font-bold text-base">
            <span>Refund Total</span>
            <span>{formatCurrency(refundTotal)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {refundType === "store_credit"
              ? `${formatCurrency(refundTotal)} will be added to member's store credit`
              : `${formatCurrency(refundTotal)} cash refund`}
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1" disabled={isProcessing}>
          Cancel
        </Button>
        <Button
          onClick={handleRefund}
          className="flex-1"
          disabled={isProcessing || selectedCount === 0}
        >
          <RotateCcw className="w-4 h-4 mr-1" />
          {isProcessing ? "Processing..." : `Refund ${formatCurrency(refundTotal)}`}
        </Button>
      </div>
    </div>
  );
}
