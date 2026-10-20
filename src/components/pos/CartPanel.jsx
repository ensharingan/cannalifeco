import { useState, useEffect, useMemo } from "react";
import { Minus, Plus, Trash2, ShoppingCart, Wallet, CreditCard, Receipt, Banknote, Smartphone, ArrowLeftRight, User, Tag, CheckCircle2, Ticket, AlertTriangle, Lock, X, Percent, ChevronDown, ChevronUp, Link2, Copy, MessageCircle } from "lucide-react";
import { formatCurrency } from "../../lib/currency";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "../../lib/CompanyContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { openWhatsApp, memberWaNumber } from "../../lib/waPhone";
import { cn } from "@/lib/utils";

var MANAGER_ROLES = ["owner", "admin", "manager", "superadmin"];

// ── Per-line discounts ──
// A cart line may carry its own discount, either a flat rand amount or a
// percentage of that line. The maths lives here and is exported so POS.jsx
// snapshots exactly the same figures onto the order that the till showed.
// A line can never go below zero: a R50 discount on a R30 line takes R30.
export function lineGross(item) {
  return (Number(item.price) || 0) * (Number(item.qty) || 0);
}

export function lineDiscountAmount(item) {
  var gross = lineGross(item);
  var v = Number(item.line_discount) || 0;
  if (v <= 0 || gross <= 0) return 0;
  var amt = item.line_discount_type === "percentage"
    ? (gross * Math.min(v, 100)) / 100
    : v;
  return Math.min(amt, gross);
}

export function lineTotal(item) {
  return Math.max(0, lineGross(item) - lineDiscountAmount(item));
}

// ── Promotion engine ──
// Receives a cart whose prices are already net of any line discount, so a
// promo percentage comes off what the item is actually going for.
function applyPromotions(cart, promotions) {
  if (!promotions || !promotions.length || !cart.length) return [];
  var now = new Date();
  var subtotalAll = cart.reduce(function (s, i) { return s + i.price * i.qty; }, 0);

  var active = promotions.filter(function (p) {
    if (!p.is_active) return false;
    // Promos that carry a code are never applied automatically — the cashier
    // has to type the code in. Without this, a coded special would come off
    // every sale on its own and the code would be meaningless.
    if (p.code && String(p.code).trim() !== "") return false;
    if (p.start_date && new Date(p.start_date) > now) return false;
    if (p.end_date && new Date(p.end_date) < now) return false;
    if (p.minimum_spend && subtotalAll < p.minimum_spend) return false;
    if (p.max_uses && p.usage_count >= p.max_uses) return false;
    return true;
  });

  var results = [];

  active.forEach(function (promo) {
    var ids = promo.applicable_products;
    var hasProductFilter = ids && ids.length > 0;
    var appliesTo = (promo.applies_to || "all").toLowerCase();
    var matchingItems = cart.filter(function (item) {
      if (hasProductFilter) return ids.includes(item.product_id);
      if (appliesTo === "all") return true;
      if (appliesTo === "specific") return true;
      return (item.category || "").toLowerCase() === appliesTo;
    });

    if (!matchingItems.length) return;

    var matchingSubtotal = matchingItems.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
    var matchingQty = matchingItems.reduce(function (s, i) { return s + i.qty; }, 0);
    var discType = (promo.promo_type || promo.discount_type || "").toLowerCase();

    if (discType === "percentage_discount" || discType === "percentage") {
      var disc = (matchingSubtotal * (promo.discount_value || 0)) / 100;
      if (disc > 0) results.push({ promoId: promo.id, name: promo.name, discountAmount: disc, description: promo.discount_value + "% off" });
    } else if (discType === "fixed_discount" || discType === "fixed") {
      var fixedDisc = Math.min(promo.discount_value || 0, matchingSubtotal);
      if (fixedDisc > 0) results.push({ promoId: promo.id, name: promo.name, discountAmount: fixedDisc, description: formatCurrency(promo.discount_value) + " off" });
    } else if (discType === "bundle") {
      var bundleDisc = (matchingSubtotal * (promo.discount_value || 0)) / 100;
      if (bundleDisc > 0) results.push({ promoId: promo.id, name: promo.name, discountAmount: bundleDisc, description: "Bundle " + promo.discount_value + "% off" });
    } else if (discType === "buy_x_get_y") {
      var buyQty = promo.buy_quantity || 1;
      var getQty = promo.get_quantity || 1;
      if (matchingQty >= buyQty) {
        var sets = Math.floor(matchingQty / (buyQty + getQty));
        if (sets < 1) sets = Math.floor(matchingQty / buyQty);
        var sorted = matchingItems.slice().sort(function (a, b) { return a.price - b.price; });
        var freeUnits = sets * getQty;
        var freeVal = 0;
        for (var si = 0; si < sorted.length && freeUnits > 0; si++) {
          var take = Math.min(sorted[si].qty, freeUnits);
          freeVal += take * sorted[si].price;
          freeUnits -= take;
        }
        if (freeVal > 0) results.push({ promoId: promo.id, name: promo.name, discountAmount: freeVal, description: "Buy " + buyQty + " Get " + getQty + " Free" });
      }
    } else if (discType === "free_item") {
      if (matchingItems.length > 0) {
        var cheapest = matchingItems.slice().sort(function (a, b) { return a.price - b.price; })[0];
        results.push({ promoId: promo.id, name: promo.name, discountAmount: cheapest.price, description: "Free: " + cheapest.name });
      }
    }
  });

  return results;
}

// ── Split Payment Dialog ──
function SplitPaymentDialog({ open, onClose, grandTotal, onConfirm }) {
  var [cashAmt, setCashAmt] = useState("");
  var [cardAmt, setCardAmt] = useState("");
  var [eftAmt, setEftAmt] = useState("");
  var [mobileAmt, setMobileAmt] = useState("");

  // Card acts as the balancing field until the cashier edits it themselves.
  // Once touched, it stays exactly as typed and nothing overwrites it.
  var [cardTouched, setCardTouched] = useState(false);

  var cash = parseFloat(cashAmt) || 0;
  var card = parseFloat(cardAmt) || 0;
  var eft = parseFloat(eftAmt) || 0;
  var mobile = parseFloat(mobileAmt) || 0;
  var entered = cash + card + eft + mobile;
  var remaining = grandTotal - entered;
  var balanced = Math.abs(remaining) < 0.01;

  // Recalculate the untouched card field so it always covers what is left.
  // Previously this only ran while card was empty, so typing "70" filled
  // card from the first keystroke ("7" -> 163.00) and then never corrected
  // itself, leaving the split over by the difference.
  function rebalanceCard(nextCash, nextEft, nextMobile) {
    if (cardTouched) return;
    var others = (parseFloat(nextCash) || 0) + (parseFloat(nextEft) || 0) + (parseFloat(nextMobile) || 0);
    if (others <= 0 || others >= grandTotal) {
      setCardAmt("");
      return;
    }
    setCardAmt((grandTotal - others).toFixed(2));
  }

  function handleCashChange(val) {
    setCashAmt(val);
    rebalanceCard(val, eftAmt, mobileAmt);
  }

  function handleEftChange(val) {
    setEftAmt(val);
    rebalanceCard(cashAmt, val, mobileAmt);
  }

  function handleMobileChange(val) {
    setMobileAmt(val);
    rebalanceCard(cashAmt, eftAmt, val);
  }

  function handleCardChange(val) {
    setCardTouched(true);
    setCardAmt(val);
  }

  // Drop whatever is outstanding into the field the cashier picks.
  function fillRemaining(setter, current) {
    var shortfall = remaining + (parseFloat(current) || 0);
    if (shortfall <= 0) return;
    setter(shortfall.toFixed(2));
  }

  function handleConfirm() {
    var details = [];
    if (cash > 0) details.push({ method: "cash", amount: cash });
    if (card > 0) details.push({ method: "card", amount: card });
    if (eft > 0) details.push({ method: "eft", amount: eft });
    if (mobile > 0) details.push({ method: "mobile", amount: mobile });
    onConfirm(details);
  }

  // Reset when dialog opens
  useEffect(function () {
    if (open) {
      setCashAmt("");
      setCardAmt("");
      setEftAmt("");
      setMobileAmt("");
      setCardTouched(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={function (o) { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-primary" />
            Split Payment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Total due */}
          <div className="flex justify-between items-center bg-muted/60 rounded-xl px-4 py-3">
            <span className="text-sm text-muted-foreground">Total Due</span>
            <span className="text-xl font-bold">{formatCurrency(grandTotal)}</span>
          </div>

          {/* Payment fields */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                <Banknote className="w-4 h-4 text-green-600" />
              </div>
              <label className="text-sm font-medium w-16 shrink-0">Cash</label>
              <Input
                type="number" min={0} step="0.01"
                value={cashAmt}
                onChange={function (e) { handleCashChange(e.target.value); }}
                className="h-10 text-base font-semibold flex-1"
                placeholder="0.00"
                autoFocus
              />
              <Button
                type="button" size="sm" variant="ghost"
                className="h-10 px-2 text-xs shrink-0 text-muted-foreground"
                disabled={remaining <= 0.009}
                onClick={function () { fillRemaining(setCashAmt, cashAmt); }}
                title="Put the outstanding balance on cash"
              >
                Rest
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                <CreditCard className="w-4 h-4 text-blue-600" />
              </div>
              <label className="text-sm font-medium w-16 shrink-0">Card</label>
              <Input
                type="number" min={0} step="0.01"
                value={cardAmt}
                onChange={function (e) { handleCardChange(e.target.value); }}
                className="h-10 text-base font-semibold flex-1"
                placeholder="0.00"
              />
              <Button
                type="button" size="sm" variant="ghost"
                className="h-10 px-2 text-xs shrink-0 text-muted-foreground"
                disabled={remaining <= 0.009}
                onClick={function () { setCardTouched(true); fillRemaining(setCardAmt, cardAmt); }}
                title="Put the outstanding balance on card"
              >
                Rest
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                <Receipt className="w-4 h-4 text-purple-600" />
              </div>
              <label className="text-sm font-medium w-16 shrink-0">EFT</label>
              <Input
                type="number" min={0} step="0.01"
                value={eftAmt}
                onChange={function (e) { handleEftChange(e.target.value); }}
                className="h-10 text-base font-semibold flex-1"
                placeholder="0.00"
              />
              <Button
                type="button" size="sm" variant="ghost"
                className="h-10 px-2 text-xs shrink-0 text-muted-foreground"
                disabled={remaining <= 0.009}
                onClick={function () { fillRemaining(setEftAmt, eftAmt); }}
                title="Put the outstanding balance on EFT"
              >
                Rest
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                <Smartphone className="w-4 h-4 text-orange-600" />
              </div>
              <label className="text-sm font-medium w-16 shrink-0">Mobile</label>
              <Input
                type="number" min={0} step="0.01"
                value={mobileAmt}
                onChange={function (e) { handleMobileChange(e.target.value); }}
                className="h-10 text-base font-semibold flex-1"
                placeholder="0.00"
              />
              <Button
                type="button" size="sm" variant="ghost"
                className="h-10 px-2 text-xs shrink-0 text-muted-foreground"
                disabled={remaining <= 0.009}
                onClick={function () { fillRemaining(setMobileAmt, mobileAmt); }}
                title="Put the outstanding balance on mobile"
              >
                Rest
              </Button>
            </div>
          </div>

          {/* Running balance */}
          <div className={cn(
            "rounded-xl px-4 py-3 flex justify-between items-center transition-colors",
            balanced ? "bg-green-500/10 border border-green-500/30" : remaining > 0 ? "bg-amber-500/10 border border-amber-500/30" : "bg-red-500/10 border border-red-500/30"
          )}>
            {balanced ? (
              <>
                <span className="text-sm font-semibold text-green-600 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Balanced
                </span>
                <span className="text-sm font-bold text-green-600">{formatCurrency(grandTotal)}</span>
              </>
            ) : remaining > 0 ? (
              <>
                <span className="text-sm font-medium text-amber-600">Still needed</span>
                <span className="text-sm font-bold text-amber-600">{formatCurrency(remaining)}</span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium text-red-500">Over by</span>
                <span className="text-sm font-bold text-red-500">{formatCurrency(Math.abs(remaining))}</span>
              </>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold"
              disabled={!balanced || entered === 0}
              onClick={handleConfirm}
            >
              Confirm Split
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CartPanel({
  cart, onUpdateQty, onRemove, onClear,
  onUpdateLineDiscount,
  selectedMember, discount, setDiscount,
  paymentMethod, setPaymentMethod,
  onCheckout, isProcessing,
  onAddChangeToCredit,
  onApplyCredit,
  appliedCredit,
  storeSettings,
  promotions,
  selectedPromo,
  voucherMode,
  creditUnit,
  creditRate,
}) {
  var companyCtx = useCompany() || {};
  var company = companyCtx.company;
  // Same source POS.jsx already reads its flags from, so there is one copy of
  // the club's settings rather than a second fetch that can disagree with it.
  var posSettings = (company && company.pos_settings) || null;

  var [cashTendered, setCashTendered] = useState("");
  var [discountType, setDiscountType] = useState("percentage");
  var [discountInput, setDiscountInput] = useState("");
  var [showSplitDialog, setShowSplitDialog] = useState(false);
  var [confirmedSplitDetails, setConfirmedSplitDetails] = useState(null);
  var [editingQty, setEditingQty] = useState({});
  // Payment link: the link can be tweaked at the till; the sale only goes
  // through once the cashier confirms the money has arrived.
  var [linkOverride, setLinkOverride] = useState(null);
  var [linkPaid, setLinkPaid] = useState(false);

  // Which cart line is open for editing (qty + its own discount). One at a
  // time keeps the list short on a phone.
  var [expandedKey, setExpandedKey] = useState(null);
  // Raw text of a line discount while it is being typed, keyed by cart key,
  // so "2." doesn't get snapped to "2" mid-keystroke.
  var [editingDisc, setEditingDisc] = useState({});

  // Who is on the till. Managers keep manual discounts even when the club has
  // switched them off for cashiers.
  var [userRole, setUserRole] = useState(null);

  // Promo code state
  var [codeInput, setCodeInput] = useState("");
  var [appliedCode, setAppliedCode] = useState(null);
  var [checkingCode, setCheckingCode] = useState(false);

  var isVoucher = !!voucherMode;
  var unitLabel = creditUnit || "Voucher";
  var rate = creditRate && creditRate > 0 ? creditRate : 1;

  // In voucher mode every figure the member sees is expressed in voucher
  // units rather than rands, so nothing on screen reads as a cash price.
  var fmtCredit = function (rands) {
    var units = (Number(rands) || 0) / rate;
    return units.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + unitLabel;
  };
  var money = function (rands) { return isVoucher ? fmtCredit(rands) : formatCurrency(rands); };

  var isWalkIn = !selectedMember || selectedMember.is_walkin;

  useEffect(function () {
    var cancelled = false;
    async function loadRole() {
      try {
        var res = await supabase.rpc("get_my_profile");
        if (cancelled || res.error) return;
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if (row && row.role) setUserRole(row.role);
      } catch (err) {
        // Non-fatal — an unknown role is treated as a cashier, which is the
        // safer side of this particular fence.
      }
    }
    loadRole();
    return function () { cancelled = true; };
  }, []);

  var isManager = MANAGER_ROLES.indexOf(userRole) !== -1;
  // Only an explicit false switches manual discounts off. A club with no
  // pos_settings, or settings still loading, keeps the till exactly as it was.
  var discountsLocked = !isManager && posSettings != null && posSettings.cashier_can_discount === false;
  var canDiscount = !discountsLocked;

  // Gross is what the items list at; the line discounts come off first, and
  // every other discount (promo, code, manual) is worked out on what is left.
  var grossSubtotal = cart.reduce(function (sum, item) { return sum + lineGross(item); }, 0);
  var lineDiscountTotal = cart.reduce(function (sum, item) { return sum + lineDiscountAmount(item); }, 0);
  var subtotal = Math.max(0, grossSubtotal - lineDiscountTotal);

  // The promo engine works off unit price × qty, so hand it the cart with
  // each line's price already netted down by its own discount.
  var nettedCart = useMemo(function () {
    return cart.map(function (item) {
      var q = Number(item.qty) || 0;
      var net = lineTotal(item);
      return { ...item, price: q > 0 ? net / q : 0 };
    });
  }, [cart]);

  var appliedPromos = useMemo(function () {
    if (selectedPromo) return applyPromotions(nettedCart, [selectedPromo]);
    return applyPromotions(nettedCart, promotions || []);
  }, [nettedCart, promotions, selectedPromo]);
  var promoDiscount = appliedPromos.reduce(function (s, p) { return s + p.discountAmount; }, 0);

  var discountVal = canDiscount ? (parseFloat(discountInput) || 0) : 0;
  var manualDiscountAmount = !canDiscount ? 0 : (discountType === "percentage"
    ? (subtotal * discountVal) / 100
    : Math.min(discountVal, subtotal));

  // The code was validated server-side against the subtotal at the moment it
  // was entered. Recompute the rand value as the cart changes so the figure on
  // screen always matches what is actually in the basket.
  var codeDiscount = 0;
  if (appliedCode) {
    codeDiscount = appliedCode.discountType === "percentage"
      ? (subtotal * (appliedCode.discountValue || 0)) / 100
      : Math.min(appliedCode.discountValue || 0, subtotal);
  }

  // Everything that comes off after the line discounts, capped at what's left.
  var cartLevelDiscount = Math.min(promoDiscount + manualDiscountAmount + codeDiscount, subtotal);
  // What the order records as its discount: line discounts plus everything else.
  var totalDiscountAmount = lineDiscountTotal + cartLevelDiscount;
  var creditApplied = appliedCredit || 0;
  var total = Math.max(0, subtotal - cartLevelDiscount - creditApplied);

  var membershipFee = 0;
  if (!isWalkIn && storeSettings && storeSettings.auto_add_membership_fee && storeSettings.membership_fee && selectedMember) {
    var expiry = selectedMember.expiry_date ? new Date(selectedMember.expiry_date) : null;
    var isNewOrExpired = !expiry || expiry < new Date();
    if (isNewOrExpired) membershipFee = storeSettings.membership_fee || 0;
  }

  var grandTotal = total + membershipFee;

  // Voucher mode figures. The amount still owing after credit has to be zero,
  // because there is no other tender at this till.
  var memberCredit = selectedMember && !isWalkIn ? (Number(selectedMember.store_credit) || 0) : 0;
  var dueBeforeCredit = Math.max(0, subtotal - cartLevelDiscount) + membershipFee;
  var creditShortfall = isVoucher ? Math.max(0, dueBeforeCredit - memberCredit) : 0;
  var creditAfterSale = Math.max(0, memberCredit - creditApplied);

  // Tendered is OPTIONAL. A blank field means the customer paid the exact
  // amount — it must never block the sale. Only an amount that has actually
  // been typed, and is short, can stop checkout.
  var tenderedParsed = parseFloat(cashTendered);
  var hasTendered = String(cashTendered).trim() !== "" && !isNaN(tenderedParsed);
  var tendered = hasTendered ? tenderedParsed : 0;

  var change = paymentMethod === "cash" && hasTendered ? tendered - grandTotal : 0;
  // Treat anything within half a cent as exact change/short, so floating-point
  // remainders on weight sales (e.g. 0.77g × R130) don't read as a few cents short.
  var changePositive = change >= -0.005;

  // Voucher tills only ever settle against credit, so lock the tender rather
  // than leaving cash and card selectable in the dropdown.
  useEffect(function () {
    if (isVoucher && paymentMethod !== "credit") setPaymentMethod("credit");
  }, [isVoucher, paymentMethod, setPaymentMethod]);

  // Clear split confirmation when payment method changes or cart changes
  useEffect(function () {
    setConfirmedSplitDetails(null);
    setCashTendered("");
    setLinkPaid(false);
    setLinkOverride(null);
  }, [paymentMethod, cart]);

  // A finished (or cleared) sale must not leak its discounts into the next one.
  // The cart-level discount, promo code and line-editor state all live here in
  // the panel, so POS.jsx emptying the cart does not reach them. Reset whenever
  // the cart goes empty.
  useEffect(function () {
    if (cart.length > 0) return;
    setDiscountInput("");
    setDiscountType("percentage");
    setCodeInput("");
    setAppliedCode(null);
    setExpandedKey(null);
    setEditingDisc({});
    setEditingQty({});
  }, [cart.length]);

  // If the club switches discounts off mid-shift, drop anything already typed —
  // the cart-level field and every line discount alike.
  useEffect(function () {
    if (canDiscount) return;
    if (discountInput !== "") setDiscountInput("");
    if (typeof onUpdateLineDiscount === "function") {
      cart.forEach(function (item, idx) {
        if ((Number(item.line_discount) || 0) > 0) onUpdateLineDiscount(item._cart_key || idx, 0, item.line_discount_type || "rand");
      });
    }
  }, [canDiscount]);

  useEffect(function () {
    if (discountType === "percentage") {
      setDiscount(discountVal);
    } else {
      var pct = subtotal > 0 ? (manualDiscountAmount / subtotal) * 100 : 0;
      setDiscount(pct);
    }
  }, [discountType, discountInput, subtotal, canDiscount]);

  // Close the editor if its line leaves the cart.
  useEffect(function () {
    if (expandedKey === null) return;
    var stillThere = cart.some(function (item, idx) { return (item._cart_key || idx) === expandedKey; });
    if (!stillThere) setExpandedKey(null);
  }, [cart, expandedKey]);

  var handleExact = function () { setCashTendered(grandTotal.toFixed(2)); };

  var handleSplitConfirm = function (details) {
    setConfirmedSplitDetails(details);
    setShowSplitDialog(false);
  };

  // Promo codes are checked on the server so the rules (dates, minimum spend,
  // usage caps, tier) can't be sidestepped from the browser.
  var handleApplyCode = async function () {
    var code = String(codeInput || "").trim();
    if (!code) { toast.error("Enter a promo code"); return; }
    if (subtotal <= 0) { toast.error("Add items to the cart first"); return; }

    setCheckingCode(true);
    try {
      var res = await supabase.rpc("promo_code_validate", {
        p_code: code,
        p_subtotal: subtotal,
        p_member_id: !isWalkIn && selectedMember ? selectedMember.id : null,
      });

      if (res.error) { toast.error(res.error.message || "That code could not be applied"); return; }

      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row) { toast.error("That code could not be applied"); return; }

      setAppliedCode({
        promotionId: row.promotion_id,
        name: row.name,
        code: code.toUpperCase(),
        promoType: row.promo_type,
        discountType: row.discount_type,
        discountValue: Number(row.discount_value) || 0,
        discountAmount: Number(row.discount_amount) || 0,
      });
      setCodeInput("");
      toast.success(row.name + " applied");
    } catch (err) {
      toast.error(err.message || "That code could not be applied");
    } finally {
      setCheckingCode(false);
    }
  };

  var handleRemoveCode = function () {
    setAppliedCode(null);
    toast.success("Promo code removed");
  };

  var handleCodeKeyDown = function (e) {
    if (e.key === "Enter") { e.preventDefault(); handleApplyCode(); }
  };

  // Payment link. The club's link lives in Settings and may carry {amount} and
  // {ref} placeholders; without them it is used as typed.
  var linkTemplate = (posSettings && posSettings.payment_link_url) || "";
  var linkRef = "POS" + Date.now().toString(36).toUpperCase();
  var resolvedLink = linkTemplate
    .split("{amount}").join(Number(grandTotal || 0).toFixed(2))
    .split("{ref}").join(linkRef);
  var paymentLink = (linkOverride != null ? linkOverride : resolvedLink).trim();
  var linkValid = /^https?:\/\//i.test(paymentLink);
  var linkMessage = "Please pay " + formatCurrency(grandTotal) + " here: " + paymentLink;
  var copyLink = function () {
    if (navigator.clipboard) navigator.clipboard.writeText(paymentLink).then(function () { toast.success("Payment link copied"); });
  };
  var whatsappLink = function () {
    openWhatsApp(linkMessage, selectedMember ? memberWaNumber(selectedMember) : null);
  };

  var handleCheckout = function () {
    var paymentDetails;
    var effectiveMethod;

    if (isVoucher) {
      effectiveMethod = "credit";
      paymentDetails = [{ method: "credit", amount: creditApplied }];
    } else if (paymentMethod === "split") {
      effectiveMethod = "split";
      paymentDetails = confirmedSplitDetails;
    } else if (paymentMethod === "cash") {
      effectiveMethod = "cash";
      // Blank tendered = exact payment.
      paymentDetails = [{ method: "cash", amount: hasTendered ? tendered : grandTotal }];
    } else {
      effectiveMethod = paymentMethod;
      paymentDetails = [{ method: paymentMethod, amount: grandTotal }];
    }

    var checkoutData = {
      discountType: discountType,
      discountValue: discountVal,
      // All-in figure for orders.discount_amount: line discounts + promos +
      // code + manual.
      discountAmount: totalDiscountAmount,
      lineDiscountTotal: lineDiscountTotal,
      cartLevelDiscount: cartLevelDiscount,
      grossSubtotal: grossSubtotal,
      subtotal: subtotal,
      promoDiscount: promoDiscount,
      manualDiscountAmount: manualDiscountAmount,
      appliedPromos: appliedPromos,
      // Promo code details for POS.jsx to log against the order.
      codeDiscount: codeDiscount,
      promoCode: appliedCode
        ? {
            promotionId: appliedCode.promotionId,
            code: appliedCode.code,
            name: appliedCode.name,
            discountAmount: codeDiscount,
          }
        : null,
      membershipFee: membershipFee,
      paymentMethod: effectiveMethod,
      paymentDetails: paymentDetails,
      cashTendered: !isVoucher && paymentMethod === "cash" ? (hasTendered ? tendered : grandTotal) : null,
      change: !isVoucher && paymentMethod === "cash" && hasTendered ? Math.max(0, change) : 0,
      total: grandTotal,
    };
    onCheckout(checkoutData);
  };

  // Half-cent tolerance so weight-based floating-point totals don't block checkout.
  // A blank Tendered field is always OK — it means exact payment.
  var cashOk = grandTotal === 0
    || paymentMethod !== "cash"
    || !hasTendered
    || tendered >= grandTotal - 0.005;
  var splitOk = paymentMethod !== "split" || !!confirmedSplitDetails;

  // Voucher mode: the member has to be a real member holding enough credit,
  // and that credit has to have actually been applied.
  var voucherOk = !isVoucher || (
    !isWalkIn
    && creditShortfall <= 0.005
    && creditApplied > 0
    && grandTotal <= 0.005
  );

  var linkOk = paymentMethod !== "payment_link" || linkPaid;
  var canCheckout = cart.length > 0 && paymentMethod && !isProcessing && cashOk && splitOk && voucherOk && linkOk;

  var handleQtyChange = function (key, value) {
    setEditingQty(function (prev) { var n = { ...prev }; n[key] = value; return n; });
  };

  var handleQtyBlur = function (key) {
    var val = parseFloat(editingQty[key]);
    if (!isNaN(val) && val > 0) onUpdateQty(key, val);
    setEditingQty(function (prev) { var n = { ...prev }; delete n[key]; return n; });
  };

  var handleQtyKeyDown = function (e) {
    if (e.key === "Enter") e.target.blur();
  };

  // ── Line discount editing ──
  var toggleExpanded = function (key) {
    setExpandedKey(function (prev) { return prev === key ? null : key; });
  };

  var handleLineDiscChange = function (key, item, raw) {
    setEditingDisc(function (prev) { var n = { ...prev }; n[key] = raw; return n; });
    if (typeof onUpdateLineDiscount !== "function") return;
    var v = parseFloat(raw);
    if (isNaN(v) || v < 0) v = 0;
    onUpdateLineDiscount(key, v, item.line_discount_type || "rand");
  };

  var handleLineDiscBlur = function (key) {
    setEditingDisc(function (prev) { var n = { ...prev }; delete n[key]; return n; });
  };

  var handleLineDiscType = function (key, item, type) {
    if (typeof onUpdateLineDiscount !== "function") return;
    if ((item.line_discount_type || "rand") === type) return;
    // Switching R <-> % keeps the number typed but reads it in the new unit,
    // the same way the cart-level selector resets — except here the value is
    // cleared, because "10" meaning R10 vs 10% is too easy to mis-ring.
    setEditingDisc(function (prev) { var n = { ...prev }; delete n[key]; return n; });
    onUpdateLineDiscount(key, 0, type);
  };

  var handleLineDiscClear = function (key, item) {
    if (typeof onUpdateLineDiscount !== "function") return;
    setEditingDisc(function (prev) { var n = { ...prev }; delete n[key]; return n; });
    onUpdateLineDiscount(key, 0, item.line_discount_type || "rand");
  };

  var handleLineDiscKeyDown = function (e) {
    if (e.key === "Enter") e.target.blur();
  };

  // Cart empty. Still show who's selected — POS.jsx sets selectedMember the
  // instant Walk-in / a member is picked, well before anything is in the
  // basket, and previously this view ignored selectedMember entirely, so
  // choosing a customer looked like it did nothing until the first item was
  // added and the real header (below) finally rendered.
  if (cart.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {selectedMember && (
          <div className="flex items-center justify-between p-3 border-b border-border shrink-0">
            <span className="font-semibold text-sm flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              Cart (0)
            </span>
            <span className={"flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium " + (isWalkIn ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
              {isWalkIn ? <User className="w-3 h-3" /> : null}
              {isWalkIn ? "Walk-in" : selectedMember.first_name + " " + selectedMember.last_name}
            </span>
          </div>
        )}
        <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground py-12">
          <ShoppingCart className="w-12 h-12 mb-3 opacity-40" />
          <p className="text-sm">Cart is empty</p>
          <p className="text-xs mt-1">Add items from the menu</p>
        </div>
      </div>
    );
  }

  return (
    /* Only the item list scrolls. A second scroll container here could clip the
       checkout block and push part of the Charge button out of reach. */
    <div className="flex flex-col h-full overflow-hidden">
      {/* Cart header */}
      <div className="flex items-center justify-between p-3 border-b border-border shrink-0">
        <span className="font-semibold text-sm flex items-center gap-2">
          <ShoppingCart className="w-4 h-4" />
          Cart ({cart.length})
        </span>
        {selectedMember && (
          <span className={"flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium " + (isWalkIn ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
            {isWalkIn ? <User className="w-3 h-3" /> : null}
            {isWalkIn ? "Walk-in" : selectedMember.first_name + " " + selectedMember.last_name}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={onClear} className="text-xs text-red-500 hover:text-red-600">Clear</Button>
      </div>

      {/* Active promo badges */}
      {appliedPromos.length > 0 && (
        <div className="px-3 py-2 border-b border-border bg-green-500/5 space-y-1 shrink-0">
          {appliedPromos.map(function (p) {
            return (
              <div key={p.promoId} className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                <Tag className="w-3 h-3 shrink-0" />
                <span>{p.name}</span>
                <span className="text-green-500 opacity-80">— {p.description}</span>
                <span className="ml-auto text-green-600 font-bold">-{money(p.discountAmount)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
        {cart.map(function (item, idx) {
          var key = item._cart_key || idx;
          var gross = lineGross(item);
          var disc = lineDiscountAmount(item);
          var net = lineTotal(item);
          var discType = item.line_discount_type || "rand";
          var discVal = Number(item.line_discount) || 0;
          var isOpen = expandedKey === key;
          var discLabel = disc > 0
            ? (discType === "percentage" ? discVal + "% off" : money(disc) + " off")
            : null;

          return (
            <div key={key} className={cn("rounded-lg bg-muted/50 p-2 space-y-2", isOpen && "ring-1 ring-primary/30")}>
              <div className="flex items-center gap-2">
                {/* Tap the item to open its editor */}
                <button
                  type="button"
                  onClick={function () { toggleExpanded(key); }}
                  className="flex-1 min-w-0 text-left"
                  title={isOpen ? "Close" : "Edit quantity or discount"}
                >
                  <p className="text-sm font-medium truncate flex items-center gap-1">
                    <span className="truncate">{item.name}</span>
                    {isOpen
                      ? <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" />
                      : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />}
                  </p>
                  {item.product_type && <p className="text-xs text-muted-foreground">{item.product_type}</p>}
                  <p className="text-xs text-muted-foreground">
                    {money(item.price)} each
                    {discLabel && <span className="text-green-600 font-medium"> · {discLabel}</span>}
                  </p>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={function () {
                      var step = item.unit_weight === "g" ? 0.5 : 1;
                      var newQty = Math.max(0, item.qty - step);
                      if (newQty <= 0) { onRemove(key); } else { onUpdateQty(key, newQty); }
                    }}
                    className="w-7 h-7 rounded-full bg-background border border-border flex items-center justify-center hover:bg-accent transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number" step="0.1" min="0.1"
                    value={editingQty[key] !== undefined ? editingQty[key] : item.qty}
                    onChange={function (e) { handleQtyChange(key, e.target.value); }}
                    onBlur={function () { handleQtyBlur(key); }}
                    onKeyDown={handleQtyKeyDown}
                    onFocus={function (e) {
                      setEditingQty(function (prev) { var n = { ...prev }; n[key] = String(item.qty); return n; });
                      e.target.select();
                    }}
                    className="w-14 h-7 text-center text-sm font-semibold bg-background border border-border rounded [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={function () {
                      var step = item.unit_weight === "g" ? 0.5 : 1;
                      onUpdateQty(key, item.qty + step);
                    }}
                    className="w-7 h-7 rounded-full bg-background border border-border flex items-center justify-center hover:bg-accent transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <div className="w-20 text-right leading-tight">
                  {disc > 0 && (
                    <span className="block text-[11px] text-muted-foreground line-through">{money(gross)}</span>
                  )}
                  <span className={cn("text-sm font-semibold", disc > 0 && "text-green-600")}>{money(net)}</span>
                </div>
                <button type="button" onClick={function () { onRemove(key); }} className="text-muted-foreground hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Inline editor — discount on this line only */}
              {isOpen && (
                canDiscount ? (
                  <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                    <label className="text-xs text-muted-foreground w-14 shrink-0 flex items-center gap-1">
                      <Percent className="w-3 h-3" /> Discount
                    </label>
                    <div className="flex rounded-md border border-border overflow-hidden shrink-0">
                      <button
                        type="button"
                        onClick={function () { handleLineDiscType(key, item, "rand"); }}
                        className={cn(
                          "px-2.5 h-8 text-xs font-semibold transition-colors",
                          discType === "rand" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"
                        )}
                      >
                        R
                      </button>
                      <button
                        type="button"
                        onClick={function () { handleLineDiscType(key, item, "percentage"); }}
                        className={cn(
                          "px-2.5 h-8 text-xs font-semibold border-l border-border transition-colors",
                          discType === "percentage" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"
                        )}
                      >
                        %
                      </button>
                    </div>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={discType === "percentage" ? 100 : Math.max(0, gross)}
                      step={discType === "percentage" ? 1 : 5}
                      value={editingDisc[key] !== undefined ? editingDisc[key] : (discVal > 0 ? String(discVal) : "")}
                      onChange={function (e) { handleLineDiscChange(key, item, e.target.value); }}
                      onBlur={function () { handleLineDiscBlur(key); }}
                      onKeyDown={handleLineDiscKeyDown}
                      autoFocus
                      className="h-8 text-sm flex-1"
                      placeholder={discType === "percentage" ? "10" : "20"}
                    />
                    {disc > 0 && (
                      <button
                        type="button"
                        onClick={function () { handleLineDiscClear(key, item); }}
                        className="text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                        title="Remove this discount"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                    <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
                    <p className="text-xs text-muted-foreground">Item discounts are set by a manager or promo code.</p>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Checkout section */}
      <div className="p-3 border-t border-border space-y-2 shrink-0 bg-card relative z-20">

        {/* Promo code */}
        {appliedCode ? (
          <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2">
            <Ticket className="w-3.5 h-3.5 text-green-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-green-600 truncate">{appliedCode.code}</p>
              <p className="text-[11px] text-green-600/80 truncate">{appliedCode.name}</p>
            </div>
            <span className="text-xs font-bold text-green-600 shrink-0">-{money(codeDiscount)}</span>
            <button
              type="button"
              onClick={handleRemoveCode}
              className="text-green-600/70 hover:text-red-500 transition-colors shrink-0"
              title="Remove promo code"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-14 shrink-0">Promo</label>
            <Input
              value={codeInput}
              onChange={function (e) { setCodeInput(e.target.value.toUpperCase()); }}
              onKeyDown={handleCodeKeyDown}
              className="h-8 text-sm flex-1 uppercase"
              placeholder="Enter code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button
              type="button" variant="outline" size="sm"
              onClick={handleApplyCode}
              disabled={checkingCode || !String(codeInput).trim()}
              className="h-8 text-xs px-3 shrink-0"
            >
              {checkingCode ? "Checking" : "Apply"}
            </Button>
          </div>
        )}

        {/* Cart discount — on top of any item discounts. Hidden entirely when
            the club has locked it for cashiers. */}
        {canDiscount ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-14 shrink-0">Discount</label>
            <Select value={discountType} onValueChange={function (v) { setDiscountType(v); setDiscountInput(""); }}>
              <SelectTrigger className="h-8 text-xs w-16"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">%</SelectItem>
                <SelectItem value="rand">R</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" min={0} max={discountType === "percentage" ? 100 : subtotal}
              step={discountType === "percentage" ? 1 : 5}
              value={discountInput}
              onChange={function (e) { setDiscountInput(e.target.value); }}
              className="h-8 text-sm flex-1"
              placeholder={discountType === "percentage" ? "10" : "50"} />
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">Discounts are set by promo code. Ask a manager if a code is needed.</p>
          </div>
        )}

        {/* ── VOUCHER MODE ── credit is the only tender at this till ── */}
        {isVoucher ? (
          <div className="space-y-2">
            {isWalkIn ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Credit is held on a member profile, so a walk-in can't collect stock. Select the member first.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                      <Ticket className="w-3.5 h-3.5" /> Credit balance
                    </span>
                    <span className="text-sm font-bold text-primary">{fmtCredit(memberCredit)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>To redeem</span>
                    <span className="font-medium">{fmtCredit(dueBeforeCredit)}</span>
                  </div>
                  {creditApplied > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Remaining after collection</span>
                      <span className="font-semibold text-green-600">{fmtCredit(creditAfterSale)}</span>
                    </div>
                  )}
                </div>

                {creditShortfall > 0.005 ? (
                  <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Not enough credit — short by <span className="font-bold">{fmtCredit(creditShortfall)}</span>. Sell a voucher first, or remove items.
                    </p>
                  </div>
                ) : creditApplied <= 0 ? (
                  <Button variant="outline" size="sm" className="w-full h-10 text-sm border-primary/40 text-primary hover:bg-primary/5"
                    onClick={function () { onApplyCredit(dueBeforeCredit); }}>
                    <Wallet className="w-4 h-4 mr-1.5" />
                    Redeem {fmtCredit(dueBeforeCredit)}
                  </Button>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 rounded-xl border border-green-500/30 bg-green-500/10 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-xs font-semibold text-green-600">{fmtCredit(creditApplied)} redeemed</span>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {/* Store credit */}
            {!isWalkIn && selectedMember && (selectedMember.store_credit || 0) > 0 && !appliedCredit && (
              <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={onApplyCredit}>
                <Wallet className="w-3 h-3 mr-1" />
                Apply Store Credit ({formatCurrency(selectedMember.store_credit)})
              </Button>
            )}

            {/* Payment method */}
            <Select value={paymentMethod} onValueChange={function (v) {
              setPaymentMethod(v);
              setConfirmedSplitDetails(null);
            }}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Payment method" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash"><span className="flex items-center gap-2"><Banknote className="w-4 h-4" /> Cash</span></SelectItem>
                <SelectItem value="card"><span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Card</span></SelectItem>
                <SelectItem value="payment_link"><span className="flex items-center gap-2"><Link2 className="w-4 h-4" /> Payment Link</span></SelectItem>
              </SelectContent>
            </Select>

            {/* Payment link — QR, copy and WhatsApp; confirm once paid */}
            {paymentMethod === "payment_link" && cart.length > 0 && (
              <div className="rounded-lg border border-border p-3 space-y-2.5">
                <Input
                  value={linkOverride != null ? linkOverride : resolvedLink}
                  onChange={function (e) { setLinkOverride(e.target.value); setLinkPaid(false); }}
                  placeholder="Paste the payment link (https://...)"
                  className="h-9 text-xs"
                />
                {!linkTemplate && (
                  <p className="text-[11px] text-muted-foreground">No link saved yet. Add one under Settings → Company → Payment link, or paste it here.</p>
                )}
                {linkValid ? (
                  <>
                    <div className="flex justify-center">
                      <img
                        alt="Payment link QR code"
                        width={160} height={160}
                        className="rounded-md border border-border bg-white p-1"
                        src={"https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=4&data=" + encodeURIComponent(paymentLink)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={copyLink}>
                        <Copy className="w-3 h-3 mr-1" /> Copy link
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={whatsappLink}>
                        <MessageCircle className="w-3 h-3 mr-1" /> WhatsApp
                      </Button>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={linkPaid ? "default" : "outline"}
                      className="w-full h-9 text-xs"
                      onClick={function () { setLinkPaid(!linkPaid); }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> {linkPaid ? "Payment received" : "Tap when payment has been received"}
                    </Button>
                  </>
                ) : (
                  <p className="text-[11px] text-amber-600">Enter a link starting with https:// to show the QR code.</p>
                )}
              </div>
            )}

            {/* Split payment — enter amounts button */}
            {paymentMethod === "split" && (
              <div className="space-y-2">
                {confirmedSplitDetails ? (
                  /* Confirmed split summary */
                  <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-green-600 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Split confirmed
                      </span>
                      <button
                        onClick={function () { setShowSplitDialog(true); }}
                        className="text-xs text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                    {confirmedSplitDetails.map(function (d, i) {
                      var icons = { cash: "💵", card: "💳", eft: "🏦", mobile: "📱" };
                      return (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{icons[d.method] || "💰"} {d.method.charAt(0).toUpperCase() + d.method.slice(1)}</span>
                          <span className="font-semibold">{formatCurrency(d.amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Prompt to enter split amounts */
                  <Button
                    variant="outline"
                    className="w-full h-10 text-sm gap-2 border-dashed border-primary/40 text-primary hover:bg-primary/5"
                    onClick={function () { setShowSplitDialog(true); }}
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                    Enter Cash &amp; Card Amounts
                  </Button>
                )}
              </div>
            )}

            {/* Cash tendered (non-split) — optional, blank means exact */}
            {paymentMethod === "cash" && cart.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-14 shrink-0">Tendered</label>
                <Input type="number" min={0} step="0.01" value={cashTendered}
                  onChange={function (e) { setCashTendered(e.target.value); }}
                  className="h-8 text-sm flex-1" placeholder="Exact — only fill in to work out change" />
                <Button type="button" variant="outline" size="sm" onClick={handleExact} className="h-8 text-xs px-2 shrink-0">Exact</Button>
              </div>
            )}
          </>
        )}

        {/* Totals */}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span><span>{money(grossSubtotal)}</span>
          </div>
          {lineDiscountTotal > 0 && (
            <div className="flex justify-between text-green-500">
              <span>Item Discounts</span>
              <span>-{money(lineDiscountTotal)}</span>
            </div>
          )}
          {appliedPromos.map(function (p) {
            return (
              <div key={p.promoId} className="flex justify-between text-green-500 text-xs">
                <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{p.name}</span>
                <span>-{money(p.discountAmount)}</span>
              </div>
            );
          })}
          {codeDiscount > 0 && appliedCode && (
            <div className="flex justify-between text-green-500 text-xs">
              <span className="flex items-center gap-1"><Ticket className="w-3 h-3" />{appliedCode.code}</span>
              <span>-{money(codeDiscount)}</span>
            </div>
          )}
          {manualDiscountAmount > 0 && (
            <div className="flex justify-between text-green-500">
              <span>Cart Discount ({discountType === "percentage" ? discountVal + "%" : "" + discountVal})</span>
              <span>-{money(manualDiscountAmount)}</span>
            </div>
          )}
          {creditApplied > 0 && (
            <div className="flex justify-between text-blue-500">
              <span>{isVoucher ? "Redeemed" : "Store Credit"}</span><span>-{money(creditApplied)}</span>
            </div>
          )}
          {membershipFee > 0 && (
            <div className="flex justify-between text-amber-500">
              <span>Membership Fee</span><span>+{money(membershipFee)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base pt-1 border-t border-border">
            <span>{isVoucher ? "Value Redeemed" : "Total"}</span>
            <span>{isVoucher ? fmtCredit(creditApplied) : formatCurrency(grandTotal)}</span>
          </div>
          {!isVoucher && paymentMethod === "cash" && hasTendered && tendered > 0 && (
            <div className={cn("flex justify-between font-semibold pt-1 border-t border-border", changePositive ? "text-green-500" : "text-red-500")}>
              <span>{changePositive ? "Change" : "Short"}</span>
              <span>{changePositive ? formatCurrency(Math.max(0, change)) : "-" + formatCurrency(Math.abs(change))}</span>
            </div>
          )}
          {!isVoucher && paymentMethod === "unpaid" && (
            <div className="text-xs text-amber-500 bg-amber-500/10 rounded p-2">Open tab — member pays later.</div>
          )}
        </div>

        {/* Charge — full-width, tall tap target, above anything floating */}
        <Button
          type="button"
          onClick={handleCheckout}
          disabled={!canCheckout}
          size="lg"
          className="w-full h-14 text-base font-bold relative z-30 touch-manipulation select-none"
        >
          {isProcessing
            ? "Processing..."
            : isVoucher
              ? "Collect Stock — " + fmtCredit(creditApplied > 0 ? creditApplied : dueBeforeCredit)
              : paymentMethod === "unpaid"
                ? "Open Tab " + formatCurrency(grandTotal)
                : "Charge " + formatCurrency(grandTotal)}
        </Button>

        {!isVoucher && !isWalkIn && paymentMethod === "cash" && hasTendered && change > 0.005 && selectedMember && onAddChangeToCredit && (
          <Button variant="outline" size="sm" onClick={function () { onAddChangeToCredit(change); }} className="w-full text-xs h-8">
            <Wallet className="w-3 h-3 mr-1" /> Add {formatCurrency(change)} change to credit
          </Button>
        )}
      </div>

      {/* Split Payment Dialog */}
      <SplitPaymentDialog
        open={showSplitDialog}
        onClose={function () { setShowSplitDialog(false); }}
        grandTotal={grandTotal}
        onConfirm={handleSplitConfirm}
      />
    </div>
  );
}
