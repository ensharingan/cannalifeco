import { useRef, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, MessageCircle, Phone } from "lucide-react";
import { formatCurrency, formatAmount } from "../../lib/currency";
import { supabase } from "@/api/supabaseClient";
import { openWhatsApp as sendWhatsApp, normaliseWaNumber } from "@/lib/waPhone";
import { printReceipt } from "@/lib/receiptPdf";

function parsePaymentDetails(paymentDetails) {
  if (!paymentDetails) return null;
  try {
    return typeof paymentDetails === "string" ? JSON.parse(paymentDetails) : paymentDetails;
  } catch (_) { return null; }
}

function formatPaymentLabel(method, paymentDetails, fmt) {
  fmt = fmt || formatAmount;
  if (method !== "split") return method ? method.charAt(0).toUpperCase() + method.slice(1) : "—";
  var details = parsePaymentDetails(paymentDetails);
  if (!details || !details.length) return "Split";
  return details.map(function (p) {
    var label = p.method.charAt(0).toUpperCase() + p.method.slice(1);
    return label + " " + fmt(p.amount);
  }).join(" + ");
}

/**
 * Defined at module scope on purpose.
 * Declaring this inside ReceiptModal makes React treat it as a brand new
 * component type on every render, which unmounts and remounts the input
 * and drops keyboard focus after each character typed.
 */
function NumberRow(props) {
  var resolved = normaliseWaNumber(props.value);

  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center gap-2">
        <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Input
          value={props.value}
          onChange={function (e) { props.onChange(e.target.value); }}
          placeholder={props.lookingUp ? "Looking up number..." : "WhatsApp number (e.g. 082 123 4567)"}
          className="h-8 text-xs"
          inputMode="tel"
          autoComplete="tel"
        />
      </div>
      <p className="text-[11px] text-muted-foreground pl-6">
        {resolved
          ? "Sends straight to +" + resolved
          : props.value
            ? "That number does not look complete yet."
            : "Add a number to send directly, or leave blank to pick a contact."}
      </p>
    </div>
  );
}

export default function ReceiptModal({ receipt, onClose }) {
  var receiptRef = useRef(null);

  // Number the receipt will be sent to. Resolved from the member record
  // where one exists, otherwise typed in by the cashier for walk-ins.
  var [phone, setPhone] = useState("");
  var [lookingUp, setLookingUp] = useState(false);

  var memberId = receipt && receipt.order ? receipt.order.member_id : null;
  var voucherMemberId = receipt && receipt.voucher ? receipt.voucher.memberId : null;
  var lookupId = memberId || voucherMemberId || null;

  useEffect(function () {
    if (!receipt) return;

    var direct =
      (receipt.member && (receipt.member.phone || receipt.member.whatsapp)) ||
      receipt.phone ||
      (receipt.voucher && receipt.voucher.memberPhone) ||
      null;

    if (direct) {
      setPhone(direct);
      return;
    }

    if (!lookupId) {
      setPhone("");
      return;
    }

    setLookingUp(true);
    supabase
      .from("members")
      .select("phone")
      .eq("id", lookupId)
      .maybeSingle()
      .then(function (res) {
        setLookingUp(false);
        if (res.error) {
          console.error("[receipt] member lookup failed", res.error);
          return;
        }
        if (res.data && res.data.phone) setPhone(res.data.phone);
      });
  }, [receipt, lookupId]);

  if (!receipt) return null;

  var kind = receipt.kind || "sale";
  var storeName = receipt.storeName || "CannaHub";
  var unitLabel = receipt.creditUnit || "Voucher";
  var rate = receipt.creditRate && receipt.creditRate > 0 ? receipt.creditRate : 1;

  var fmtCredit = function (rands) {
    var units = (Number(rands) || 0) / rate;
    return units.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + unitLabel;
  };

  // Prints as a PDF sized exactly to the 80mm roll (see lib/receiptPdf.js), so the
  // HPRT printer cannot rescale it and there is no blank paper after the slip.
  var handlePrint = function () {
    var lines = [];
    var rule = { t: "rule" };
    var stamp = function (d) { return new Date(d || Date.now()).toLocaleString("en-ZA"); };
    var o = receipt.order || {};
    var its = receipt.items || [];
    var refNo = o.id ? (o.order_number || String(o.id).slice(0, 8).toUpperCase()) : "";

    if (receipt.reprint) lines.push({ t: "center", text: "*** REPRINT ***", bold: true });
    lines.push({ t: "center", text: storeName, size: "big" });

    if (kind === "voucher_purchase") {
      var pv = receipt.voucher || {};
      lines.push({ t: "center", text: "VOUCHER PURCHASE RECEIPT", bold: true });
      lines.push({ t: "center", text: stamp(receipt.createdAt) });
      lines.push(rule);
      lines.push({ t: "row", left: "Member", right: pv.memberName || "—" });
      lines.push({ t: "row", left: "Voucher Number", right: pv.voucherNumber || "—" });
      lines.push({ t: "row", left: "Amount Paid", right: formatAmount(pv.amountPaid || 0) });
      lines.push({ t: "row", left: "Available Credit", right: fmtCredit(pv.availableCredit || 0), bold: true });
      lines.push(rule);
      lines.push({ t: "text", text: "This voucher can be redeemed for eligible products at a later date. No stock has been issued with this transaction." });
    } else if (kind === "stock_collection") {
      var rd = receipt.redemption || {};
      var usedV = rd.vouchersUsed || [];
      var qtyTotal = its.reduce(function (s, i) { return s + (Number(i.quantity) || 0); }, 0);
      lines.push({ t: "center", text: "STOCK COLLECTION RECEIPT", bold: true });
      lines.push({ t: "center", text: stamp(o.created_at) });
      if (refNo) lines.push({ t: "center", text: "Ref #" + refNo });
      lines.push(rule);
      lines.push({ t: "row", left: "Member", right: o.member_name || "—" });
      lines.push({ t: "row", left: "Voucher Number", right: usedV.length ? usedV.map(function (u) { return u.voucher_number; }).join(", ") : "—" });
      lines.push(rule);
      lines.push({ t: "text", text: "PRODUCTS COLLECTED", bold: true });
      its.forEach(function (i) { lines.push({ t: "row", left: i.name, right: "Qty " + i.quantity, bold: true }); });
      lines.push({ t: "row", left: "Total Quantity", right: String(qtyTotal) });
      lines.push(rule);
      if (usedV.length > 1) {
        usedV.forEach(function (u) { lines.push({ t: "row", left: "  " + u.voucher_number, right: fmtCredit(u.amount) }); });
      }
      lines.push({ t: "row", left: "Value Redeemed", right: fmtCredit(rd.valueRedeemed || 0), bold: true });
      lines.push({ t: "row", left: "Remaining Credit", right: fmtCredit(rd.remainingCredit || 0), bold: true });
      lines.push(rule);
      lines.push({ t: "center", text: "Thank you for your visit!", bold: false });
    } else {
      lines.push({ t: "center", text: stamp(o.created_at) });
      if (refNo) lines.push({ t: "center", text: "Order #" + refNo });
      lines.push(rule);
      lines.push({ t: "row", left: "Customer", right: o.member_name || "Walk-in" });
      if (o.payment_method === "split") {
        lines.push({ t: "row", left: "Payment", right: "Split" });
        var legs = parsePaymentDetails(o.payment_details) || [];
        legs.forEach(function (p) {
          lines.push({ t: "row", left: "  " + p.method.charAt(0).toUpperCase() + p.method.slice(1), right: formatAmount(p.amount) });
        });
      } else {
        lines.push({ t: "row", left: "Payment", right: formatPaymentLabel(o.payment_method, o.payment_details) });
      }
      lines.push(rule);
      lines.push({ t: "text", text: "ITEMS", bold: true });
      its.forEach(function (i) {
        lines.push({ t: "row", left: i.name + " x" + i.quantity, right: formatAmount(i.price * i.quantity), bold: true });
      });
      lines.push(rule);
      if (o.discount_amount > 0) lines.push({ t: "row", left: "Discount", right: "-" + formatAmount(o.discount_amount) });
      lines.push({ t: "row", left: "TOTAL", right: formatAmount(o.total_amount), size: "big", bold: true });
      lines.push({ t: "gap" });
      lines.push({ t: "center", text: "Thank you for your visit!", bold: false });
    }

    printReceipt({ lines: lines }).catch(function (e) {
      console.error("[receipt] print failed", e);
      alert("Could not print the receipt. Check the console for details.");
    });
  };

  var openWhatsApp = function (text) {
    sendWhatsApp(text, phone);
  };

  // ── SLIP 1 — Voucher Purchase ──────────────────────────────────────────
  if (kind === "voucher_purchase") {
    var v = receipt.voucher || {};
    var vDate = new Date(receipt.createdAt || Date.now());

    var voucherText = [
      "*" + storeName + "*",
      "*VOUCHER PURCHASE RECEIPT*",
      vDate.toLocaleString("en-ZA"),
      "",
      "Member: " + (v.memberName || "—"),
      "Voucher Number: " + (v.voucherNumber || "—"),
      "Amount Paid: " + formatCurrency(v.amountPaid || 0),
      "Available Credit: " + fmtCredit(v.availableCredit || 0),
      "",
      "This voucher can be redeemed for eligible products at a later date. No stock has been issued with this transaction.",
    ].join("\n");

    return (
      <Dialog open={!!receipt} onOpenChange={onClose}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Voucher Purchase</DialogTitle>
          </DialogHeader>

          <div ref={receiptRef} className="bg-muted/40 rounded-xl p-4 font-mono text-xs space-y-1 border border-border">
            <h2 className="text-center text-sm font-bold mb-1">{storeName}</h2>
            <p className="text-center font-bold text-[11px] tracking-wide">VOUCHER PURCHASE RECEIPT</p>
            <p className="text-center text-muted-foreground text-[11px]">{vDate.toLocaleString("en-ZA")}</p>

            <div className="border-t border-dashed border-border my-2" />

            <div className="flex justify-between"><span>Member</span><span className="font-medium text-right">{v.memberName || "—"}</span></div>
            <div className="flex justify-between"><span>Voucher Number</span><span className="font-medium">{v.voucherNumber || "—"}</span></div>
            <div className="flex justify-between"><span>Amount Paid</span><span className="font-medium">{formatAmount(v.amountPaid || 0)}</span></div>
            <div className="flex justify-between font-bold text-sm pt-1">
              <span>Available Credit</span><span>{fmtCredit(v.availableCredit || 0)}</span>
            </div>

            <div className="border-t border-dashed border-border my-2" />

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              This voucher can be redeemed for eligible products at a later date. No stock has been issued with this transaction.
            </p>
          </div>

          <NumberRow value={phone} onChange={setPhone} lookingUp={lookingUp} />

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 gap-2" onClick={handlePrint}>
              <Printer className="w-4 h-4" /> Print
            </Button>
            <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white" onClick={function () { openWhatsApp(voucherText); }}>
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClose}>Done</Button>
        </DialogContent>
      </Dialog>
    );
  }

  var order = receipt.order;
  var items = receipt.items || [];
  var paymentLabel = formatPaymentLabel(order.payment_method, order.payment_details, formatCurrency);

  // ── SLIP 2 — Stock Collection ──────────────────────────────────────────
  if (kind === "stock_collection") {
    var r = receipt.redemption || {};
    var used = r.vouchersUsed || [];
    var voucherNumbers = used.length
      ? used.map(function (u) { return u.voucher_number; }).join(", ")
      : "—";
    var totalQty = items.reduce(function (s, i) { return s + (Number(i.quantity) || 0); }, 0);
    var cDate = new Date(order.created_at || Date.now());

    var collectionText = [
      "*" + storeName + "*",
      "*STOCK COLLECTION RECEIPT*",
      cDate.toLocaleString("en-ZA"),
      "",
      "Member: " + (order.member_name || "—"),
      "Voucher Number: " + voucherNumbers,
      "",
      "*Products Collected:*",
      ...items.map(function (i) { return "• " + i.name + " — Qty " + i.quantity; }),
      "",
      "Value Redeemed: " + fmtCredit(r.valueRedeemed || 0),
      "Remaining Credit: " + fmtCredit(r.remainingCredit || 0),
    ].join("\n");

    return (
      <Dialog open={!!receipt} onOpenChange={onClose}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Stock Collection</DialogTitle>
          </DialogHeader>

          <div ref={receiptRef} className="bg-muted/40 rounded-xl p-4 font-mono text-xs space-y-1 border border-border">
            <h2 className="text-center text-sm font-bold mb-1">{storeName}</h2>
            <p className="text-center font-bold text-[11px] tracking-wide">STOCK COLLECTION RECEIPT</p>
            <p className="text-center text-muted-foreground text-[11px]">{cDate.toLocaleString("en-ZA")}</p>
            <p className="text-center text-muted-foreground text-[11px]">Ref #{(order.order_number || (order.id ? order.id.slice(0, 8).toUpperCase() : ""))}</p>

            <div className="border-t border-dashed border-border my-2" />

            <div className="flex justify-between"><span>Member</span><span className="font-medium text-right">{order.member_name || "—"}</span></div>
            <div className="flex justify-between gap-2">
              <span className="shrink-0">Voucher Number</span>
              <span className="font-medium text-right break-all">{voucherNumbers}</span>
            </div>

            <div className="border-t border-dashed border-border my-2" />

            <p className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Products Collected</p>
            {items.map(function (item, i) {
              return (
                <div key={i} className="flex justify-between">
                  <span className="truncate flex-1 pr-2">{item.name}</span>
                  <span className="whitespace-nowrap">Qty {item.quantity}</span>
                </div>
              );
            })}
            <div className="flex justify-between text-muted-foreground pt-1">
              <span>Total Quantity</span><span>{totalQty}</span>
            </div>

            <div className="border-t border-dashed border-border my-2" />

            {used.length > 1 && used.map(function (u, i) {
              return (
                <div key={i} className="flex justify-between text-muted-foreground text-[11px]">
                  <span>↳ {u.voucher_number}</span><span>{fmtCredit(u.amount)}</span>
                </div>
              );
            })}

            <div className="flex justify-between font-bold text-sm">
              <span>Value Redeemed</span><span>{fmtCredit(r.valueRedeemed || 0)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Remaining Credit</span><span>{fmtCredit(r.remainingCredit || 0)}</span>
            </div>

            <div className="border-t border-dashed border-border my-2" />
            <p className="text-center text-muted-foreground text-[11px]">Thank you for your visit!</p>
          </div>

          <NumberRow value={phone} onChange={setPhone} lookingUp={lookingUp} />

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 gap-2" onClick={handlePrint}>
              <Printer className="w-4 h-4" /> Print
            </Button>
            <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white" onClick={function () { openWhatsApp(collectionText); }}>
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClose}>Done</Button>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Standard sale receipt ──────────────────────────────────────────────
  var paymentLines = [];
  if (order.payment_method === "split") {
    var details = parsePaymentDetails(order.payment_details);
    if (details && details.length) {
      paymentLines = details.map(function (p) {
        var label = p.method.charAt(0).toUpperCase() + p.method.slice(1);
        return "  " + label + ": " + formatCurrency(p.amount);
      });
    }
  }

  var receiptText = [
    "\uD83C\uDF3F *" + storeName + "*",
    "\uD83D\uDCCB Order: #" + ((order.order_number || (order.id ? order.id.slice(0, 8).toUpperCase() : ""))),
    "\uD83D\uDCC5 " + new Date(order.created_at).toLocaleString("en-ZA"),
    "\uD83D\uDC64 " + (order.member_name || "Walk-in Customer"),
    "",
    "*Items:*",
    ...items.map(function (i) { return "• " + i.name + " x" + i.quantity + " — " + formatCurrency(i.price * i.quantity); }),
    "",
    ...(order.discount_amount > 0 ? ["\uD83D\uDC9A Discount: -" + formatCurrency(order.discount_amount)] : []),
    "\uD83D\uDCB3 Payment: " + paymentLabel,
    ...paymentLines,
    "",
    "*TOTAL: " + formatCurrency(order.total_amount) + "*",
    "",
    "Thank you for your visit! \uD83D\uDE4F",
  ].join("\n");

  return (
    <Dialog open={!!receipt} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Receipt</DialogTitle>
        </DialogHeader>

        {/* Receipt preview */}
        <div ref={receiptRef} className="bg-muted/40 rounded-xl p-4 font-mono text-xs space-y-1 border border-border">
          <h2 className="text-center text-sm font-bold mb-1">🌿 {storeName}</h2>
          <p className="text-center text-muted-foreground text-[11px]">{new Date(order.created_at).toLocaleString("en-ZA")}</p>
          <p className="text-center text-muted-foreground text-[11px]">Order #{(order.order_number || (order.id ? order.id.slice(0, 8).toUpperCase() : ""))}</p>

          <div className="border-t border-dashed border-border my-2" />

          <div className="flex justify-between"><span>Customer</span><span className="font-medium">{order.member_name || "Walk-in"}</span></div>

          {/* Payment — single line for normal, multi-line breakdown for split */}
          {order.payment_method !== "split" ? (
            <div className="flex justify-between">
              <span>Payment</span>
              <span className="capitalize">{paymentLabel}</span>
            </div>
          ) : (
            <div>
              <div className="flex justify-between">
                <span>Payment</span>
                <span className="font-medium text-primary">Split</span>
              </div>
              {parsePaymentDetails(order.payment_details) && parsePaymentDetails(order.payment_details).map(function (p, idx) {
                var label = p.method.charAt(0).toUpperCase() + p.method.slice(1);
                return (
                  <div key={idx} className="flex justify-between pl-3 text-muted-foreground">
                    <span>↳ {label}</span>
                    <span>{formatAmount(p.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-dashed border-border my-2" />

          <p className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Items</p>
          {items.map(function (item, i) {
            return (
              <div key={i} className="flex justify-between">
                <span className="truncate flex-1 pr-2">{item.name} ×{item.quantity}</span>
                <span className="whitespace-nowrap">{formatAmount(item.price * item.quantity)}</span>
              </div>
            );
          })}

          <div className="border-t border-dashed border-border my-2" />

          {order.discount_amount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Discount</span><span>-{formatAmount(order.discount_amount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-sm">
            <span>TOTAL</span><span>{formatAmount(order.total_amount)}</span>
          </div>

          <div className="border-t border-dashed border-border my-2" />
          <p className="text-center text-muted-foreground text-[11px]">Thank you for your visit! 🙏</p>
        </div>

        <NumberRow value={phone} onChange={setPhone} lookingUp={lookingUp} />

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1 gap-2" onClick={handlePrint}>
            <Printer className="w-4 h-4" /> Print
          </Button>
          <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white" onClick={function () { openWhatsApp(receiptText); }}>
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </Button>
        </div>
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClose}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}
