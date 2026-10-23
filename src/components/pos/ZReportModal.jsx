import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "../../lib/CompanyContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer, Loader2 } from "lucide-react";

var LEDGER_METHODS = ["account", "unpaid"];

function n(v) { var x = parseFloat(v); return isNaN(x) ? 0 : x; }
function money(v) { return "R" + n(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " "); }
function dateStr(d) { return d.toLocaleDateString("en-ZA", { year: "numeric", month: "2-digit", day: "2-digit" }); }
function timeStr(d) { return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }); }

function parseItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { var p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}

function prettyMethod(m) {
  var k = (m || "").toLowerCase();
  if (k === "card" || k === "card/eft") return "Card";
  if (k === "eft") return "EFT";
  if (k === "cash") return "Cash";
  if (k === "mobile") return "Mobile";
  if (k === "credit") return "Member Credit";
  if (!k) return "Other";
  return k.charAt(0).toUpperCase() + k.slice(1);
}

async function buildReport(sessionId, companyId) {
  var sRes = await supabase.from("cashier_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (sRes.error || !sRes.data) throw new Error("Session not found");
  var s = sRes.data;

  var res = await Promise.all([
    supabase.from("orders").select("id, order_number, total_amount, discount_amount, tax_amount, payment_method, credit_applied, items, created_at, status").eq("cashier_session_id", sessionId).eq("status", "completed").order("created_at", { ascending: true }),
    supabase.from("order_payments").select("amount, payment_method").eq("cashier_session_id", sessionId),
    supabase.from("refunds").select("total_amount, payment_method").eq("cashier_session_id", sessionId),
    supabase.from("till_cash_outs").select("amount").eq("cashier_session_id", sessionId),
    supabase.from("products").select("id, name, category").eq("company_id", companyId),
    supabase.from("cashier_sessions").select("id", { count: "exact", head: true }).eq("company_id", companyId).lte("opening_time", s.opening_time),
  ]);
  var orders = (res[0].data || []).filter(function (o) { return LEDGER_METHODS.indexOf((o.payment_method || "").toLowerCase()) === -1; });
  var tabPays = res[1].data || [];
  var refunds = res[2].data || [];
  var cashOuts = res[3].data || [];
  var catById = {};
  (res[4].data || []).forEach(function (p) { catById[p.id] = p.category || "Uncategorised"; });
  var reportNo = res[5].count || 1;

  var tenders = {};
  function addTender(k, v) { tenders[k] = (tenders[k] || 0) + v; }
  var discounts = 0, tax = 0, sales = 0;
  var products = {}, groups = {}, itemCount = 0;

  orders.forEach(function (o) {
    var total = n(o.total_amount), credit = n(o.credit_applied);
    var pm = (o.payment_method || "").toLowerCase();
    sales += total; tax += n(o.tax_amount); discounts += n(o.discount_amount);
    if (pm === "split") {
      if (credit > 0) addTender("Member Credit", credit);
      if (total - credit > 0) addTender("Card", total - credit);
    } else {
      addTender(prettyMethod(pm), total);
    }
    parseItems(o.items).forEach(function (it) {
      var q = n(it.quantity != null ? it.quantity : it.qty);
      var name = it.name || "Item";
      var grp = (it.product_id && catById[it.product_id]) || it.category || "Uncategorised";
      products[name] = (products[name] || 0) + q;
      groups[grp] = (groups[grp] || 0) + q;
      itemCount += q;
    });
  });

  var tabTotal = 0;
  tabPays.forEach(function (p) {
    var a = n(p.amount); tabTotal += a; addTender("Tab: " + prettyMethod(p.payment_method), a);
  });

  var totalTendered = 0;
  Object.keys(tenders).forEach(function (k) { totalTendered += tenders[k]; });
  var refundTotal = 0; refunds.forEach(function (r) { refundTotal += n(r.total_amount); });
  var cashOutTotal = 0; cashOuts.forEach(function (c) { cashOutTotal += n(c.amount); });

  var cashIn = (tenders["Cash"] || 0) + (tenders["Tab: Cash"] || 0);
  var opening = n(s.opening_float);
  var expected = s.expected_cash != null ? n(s.expected_cash) : opening + cashIn - cashOutTotal;
  var counted = s.status === "closed" && s.closing_float != null ? n(s.closing_float) : null;

  return {
    session: s, reportNo: reportNo, orders: orders,
    firstDoc: orders.length ? orders[0].order_number : null,
    lastDoc: orders.length ? orders[orders.length - 1].order_number : null,
    tenders: tenders, totalTendered: totalTendered, sales: sales,
    refundCount: refunds.length, refundTotal: refundTotal,
    cashOutTotal: cashOutTotal, discounts: discounts, tax: tax,
    opening: opening, expected: expected, counted: counted,
    variance: counted != null ? counted - expected : null,
    cardCounted: s.closing_card_total != null ? n(s.closing_card_total) : null,
    products: products, groups: groups, itemCount: itemCount,
  };
}

var PRINT_CSS = function (w) {
  return "@media print {" +
    " body * { visibility: hidden !important; }" +
    " #session-z-print, #session-z-print * { visibility: visible !important; }" +
    " #session-z-print { position: absolute; left: 0; top: 0; width: " + w + "mm; padding: 2mm 3mm; margin: 0; color: #000; background: #fff;" +
    " font-family: ui-monospace, Menlo, Consolas, 'Courier New', monospace; font-size: 11px; line-height: 1.35; }" +
    " @page { size: " + w + "mm auto; margin: 0; }" +
    "}";
};

function Line({ l, r, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: bold ? 700 : 400 }}>
      <span>{l}</span><span style={{ textAlign: "right" }}>{r}</span>
    </div>
  );
}
function Rule({ solid }) {
  return <div style={{ borderTop: (solid ? "2px solid" : "1px dashed") + " #000", margin: "5px 0" }} />;
}

function ReportBody({ rep, storeName, final }) {
  var s = rep.session;
  var now = new Date();
  var groupKeys = Object.keys(rep.groups).sort();
  var productKeys = Object.keys(rep.products).sort();
  return (
    <div>
      <div style={{ textAlign: "center", fontWeight: 700 }}>{storeName || "Z REPORT"}</div>
      <div style={{ textAlign: "center", fontWeight: 700 }}>{final ? "Z REPORT" : "X REPORT (day not closed)"}</div>
      <Rule />
      <Line l="Date" r={dateStr(now)} />
      <Line l="Time" r={timeStr(now)} />
      <Line l="Report #" r={rep.reportNo} />
      <Line l="Opened" r={dateStr(new Date(s.opening_time)) + " " + timeStr(new Date(s.opening_time))} />
      {s.closing_time && <Line l="Closed" r={dateStr(new Date(s.closing_time)) + " " + timeStr(new Date(s.closing_time))} />}
      <Rule />
      <Line l="From document" r={rep.firstDoc || "-"} />
      <Line l="To document" r={rep.lastDoc || "-"} />
      <Rule />
      <Line l="User sales" r={rep.orders.length} />
      <div>{s.cashier_name || "Cashier"}</div>
      <Line l="Sales total" r={money(rep.sales)} />
      <Rule />
      <div style={{ fontWeight: 700 }}>Tender totals</div>
      {Object.keys(rep.tenders).sort().map(function (k) { return <Line key={k} l={k} r={money(rep.tenders[k])} />; })}
      <Rule solid />
      <Line l="Total tendered" r={money(rep.totalTendered)} bold />
      <Rule />
      <Line l="Returns" r={rep.refundCount} />
      <Line l="Total returns" r={money(rep.refundTotal)} />
      <Line l="Discounts granted" r={money(rep.discounts)} />
      <Line l="Cash paid out" r={money(rep.cashOutTotal)} />
      <Rule />
      <Line l="Taxable total" r={money(rep.sales - rep.tax)} />
      <Line l="Tax" r={money(rep.tax)} />
      <Line l="Total" r={money(rep.sales)} bold />
      <Rule />
      <div style={{ fontWeight: 700 }}>Cash up</div>
      <Line l="Opening float" r={money(rep.opening)} />
      <Line l="Expected cash" r={money(rep.expected)} />
      {rep.counted != null && <Line l="Counted cash" r={money(rep.counted)} />}
      {rep.variance != null && <Line l={rep.variance < -0.005 ? "Short" : rep.variance > 0.005 ? "Over" : "Variance"} r={money(rep.variance)} bold />}
      {rep.cardCounted != null && <Line l="Card machine" r={money(rep.cardCounted)} />}
      <Rule solid />
      <div style={{ textAlign: "center", fontWeight: 700 }}>ITEMS REPORT</div>
      <Rule />
      <div style={{ fontWeight: 700 }}>PRODUCT GROUPS</div>
      {groupKeys.map(function (k) { return <Line key={k} l={k} r={rep.groups[k]} />; })}
      <Rule />
      <div style={{ fontWeight: 700 }}>PRODUCTS</div>
      {productKeys.map(function (k) { return <Line key={k} l={k} r={rep.products[k]} />; })}
      <Rule />
      <Line l="Items" r={rep.itemCount} bold />
      <div style={{ height: 24 }} />
    </div>
  );
}

export default function ZReportModal({ open, sessionId, onClose, final }) {
  var companyCtx = useCompany();
  var companyId = companyCtx.companyId;
  var stores = companyCtx.stores || [];
  var [rep, setRep] = useState(null);
  var [err, setErr] = useState(null);
  var [loading, setLoading] = useState(false);
  var [width, setWidth] = useState(80);

  useEffect(function () {
    if (!open || !sessionId || !companyId) return;
    var cancelled = false;
    setLoading(true); setErr(null); setRep(null);
    buildReport(sessionId, companyId).then(function (r) { if (!cancelled) setRep(r); })
      .catch(function (e) { if (!cancelled) setErr(e.message || "Failed to build report"); })
      .finally(function () { if (!cancelled) setLoading(false); });
    return function () { cancelled = true; };
  }, [open, sessionId, companyId]);

  var storeName = "";
  if (rep) {
    var st = stores.filter(function (x) { return x.id === rep.session.store_id; })[0];
    storeName = st ? st.name : (companyCtx.company && companyCtx.company.name) || "";
  }
  var isFinal = final !== undefined ? final : (rep && rep.session.status === "closed");

  return (
    <>
      <Dialog open={open} onOpenChange={function (o) { if (!o) onClose(); }}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isFinal ? "Z Report" : "Day End Report"}</DialogTitle></DialogHeader>
          {loading && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {err && <p className="text-sm text-red-500">{err}</p>}
          {rep && (
            <>
              <div className="rounded-md border bg-white text-black p-3" style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11 }}>
                <ReportBody rep={rep} storeName={storeName} final={isFinal} />
              </div>
              <div className="flex gap-2 items-center">
                <select value={width} onChange={function (e) { setWidth(Number(e.target.value)); }}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                  <option value={80}>80mm thermal</option>
                  <option value={58}>58mm thermal</option>
                </select>
                <Button className="flex-1 gap-2" onClick={function () { window.print(); }}>
                  <Printer className="w-4 h-4" /> Print
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {open && rep && createPortal(
        <div id="session-z-print" className="hidden print:block">
          <style>{PRINT_CSS(width)}</style>
          <ReportBody rep={rep} storeName={storeName} final={isFinal} />
        </div>,
        document.body
      )}
    </>
  );
}
