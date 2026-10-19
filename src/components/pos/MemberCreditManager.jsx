import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { Wallet, Undo2, Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatCurrency } from "../../lib/currency";

// Roles allowed to reverse a credit transaction from this dialog. This is a
// UI-level gate only — store_credit_transactions and members currently allow
// writes from any profile in the company via RLS, so this list is what stands
// between a cashier and a reversal, not the database.
var REVERSAL_ROLES = ["owner", "manager", "superadmin"];

function typeLabel(type) {
  var labels = {
    voucher_purchase: "Voucher purchase",
    voucher_redemption: "Voucher redemption",
    purchase: "Store credit used",
    change_credit: "Change added to credit",
    adjustment: "Adjustment",
    refund_reversal: "Refund reversal",
    loyalty_redemption: "Loyalty redemption",
  };
  return labels[type] || type;
}

function formatWhen(ts) {
  try {
    return new Date(ts).toLocaleString("en-ZA", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch (_) { return ts; }
}

// Member credit history + reversal. Reversing never deletes the original row —
// it books an offsetting "adjustment" entry and stamps the original as
// reversed, so the ledger always shows both the mistake and the correction.
export default function MemberCreditManager({ open, onClose, member, companyId, currentUserId, currentUserRole, onBalanceUpdated }) {
  var [transactions, setTransactions] = useState([]);
  var [loading, setLoading] = useState(false);
  var [reversingId, setReversingId] = useState(null);
  var [balance, setBalance] = useState(member ? member.store_credit || 0 : 0);

  var canReverse = REVERSAL_ROLES.indexOf(currentUserRole) !== -1;

  var loadTransactions = useCallback(async function () {
    if (!member || !companyId) return;
    setLoading(true);
    try {
      var res = await supabase.from("store_credit_transactions").select("*")
        .eq("company_id", companyId).eq("member_id", member.id)
        .order("created_at", { ascending: false }).limit(50);
      if (res.error) throw res.error;
      setTransactions(res.data || []);
    } catch (err) {
      toast.error("Couldn't load credit history: " + (err && err.message ? err.message : "Unknown error"));
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [member, companyId]);

  useEffect(function () {
    if (open && member) {
      setBalance(member.store_credit || 0);
      loadTransactions();
    }
  }, [open, member, loadTransactions]);

  var handleReverse = async function (tx) {
    if (!canReverse || tx.reversed_at || reversingId) return;
    setReversingId(tx.id);
    try {
      // Read the balance back fresh rather than trusting the value this
      // dialog opened with — someone else may have rung up a sale for this
      // member in the meantime.
      var freshRes = await supabase.from("members").select("store_credit").eq("id", member.id).maybeSingle();
      if (freshRes.error) throw freshRes.error;
      var currentBalance = (freshRes.data && freshRes.data.store_credit) || 0;
      var reversalAmount = -Number(tx.amount);
      var newBalance = currentBalance + reversalAmount;

      var updateRes = await supabase.from("members").update({ store_credit: newBalance }).eq("id", member.id);
      if (updateRes.error) throw updateRes.error;

      var insertRes = await supabase.from("store_credit_transactions").insert({
        company_id: companyId,
        member_id: member.id,
        amount: reversalAmount,
        type: "adjustment",
        note: "Reversal of " + typeLabel(tx.type) + " (" + formatCurrency(Math.abs(Number(tx.amount))) + " on " + formatWhen(tx.created_at) + ")",
        created_by: currentUserId || null,
      });
      if (insertRes.error) throw insertRes.error;

      var stampRes = await supabase.from("store_credit_transactions").update({
        reversed_at: new Date().toISOString(),
        reversed_by: currentUserId || null,
      }).eq("id", tx.id);
      if (stampRes.error) throw stampRes.error;

      setBalance(newBalance);
      if (onBalanceUpdated) onBalanceUpdated(newBalance);
      toast.success("Reversed " + formatCurrency(Math.abs(Number(tx.amount))) + " for " + member.first_name);
      await loadTransactions();
    } catch (err) {
      toast.error("Reversal failed: " + (err && err.message ? err.message : "Unknown error"));
    } finally {
      setReversingId(null);
    }
  };

  if (!member) return null;

  return (
    <Dialog open={open} onOpenChange={function (o) { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            {member.first_name} {member.last_name} — Credit
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 px-3 py-2">
          <span className="text-xs text-muted-foreground">Current balance</span>
          <span className="text-lg font-bold text-primary">{formatCurrency(balance)}</span>
        </div>

        {!canReverse && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              You can view this member's credit history, but only an owner or manager can reverse a transaction.
            </p>
          </div>
        )}

        <div className="max-h-80 overflow-y-auto space-y-1.5">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && transactions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No credit transactions yet</p>
          )}

          {!loading && transactions.map(function (tx) {
            var isPositive = Number(tx.amount) >= 0;
            var isReversed = !!tx.reversed_at;
            var isBusy = reversingId === tx.id;
            return (
              <div key={tx.id} className={"flex items-center justify-between gap-2 rounded-lg border p-2.5 " + (isReversed ? "opacity-50 border-border" : "border-border")}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{typeLabel(tx.type)}</p>
                  <p className="text-xs text-muted-foreground truncate">{formatWhen(tx.created_at)}</p>
                  {tx.note && <p className="text-[11px] text-muted-foreground/80 truncate">{tx.note}</p>}
                </div>
                <span className={"text-sm font-bold shrink-0 " + (isPositive ? "text-green-600" : "text-red-500")}>
                  {isPositive ? "+" : ""}{formatCurrency(Number(tx.amount))}
                </span>
                {isReversed ? (
                  <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-muted text-muted-foreground shrink-0">Reversed</span>
                ) : canReverse ? (
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs gap-1 shrink-0 text-red-500 border-red-500/30 hover:bg-red-500/10 hover:text-red-500"
                    disabled={isBusy}
                    onClick={function () { handleReverse(tx); }}
                    title="Reverse this transaction"
                  >
                    {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                    Reverse
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Reversing books an offsetting adjustment — the original transaction stays on record, marked as reversed.
        </p>
      </DialogContent>
    </Dialog>
  );
}
