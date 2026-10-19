import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "@/lib/CompanyContext";
import { Download, Calendar, TrendingUp, CreditCard, Banknote, Smartphone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

function fmt(val) {
  return "" + Number(val || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtDate(str) {
  var d = new Date(str);
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" });
}

export default function PaymentBreakdownReport() {
  var today = new Date().toISOString().slice(0, 10);
  var firstOfMonth = today.slice(0, 8) + "01";

  var { selectedStore } = useCompany();
  var [dateFrom, setDateFrom] = useState(firstOfMonth);
  var [dateTo, setDateTo] = useState(today);
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(false);
  var [totals, setTotals] = useState({ cash: 0, card: 0, eft: 0, mobile: 0, split: 0, other: 0, total: 0, orders: 0 });

  async function load() {
    setLoading(true);
    var query = supabase
      .from("orders")
      .select("created_at, payment_method, total_amount, store_id")
      .eq("status", "completed")
      .gte("created_at", dateFrom + "T00:00:00")
      .lte("created_at", dateTo + "T23:59:59")
      .order("created_at", { ascending: true });

    if (selectedStore) query = query.eq("store_id", selectedStore);

    var { data, error } = await query;
    setLoading(false);
    if (error || !data) return;

    // Group by date
    var byDate = {};
    data.forEach(function(o) {
      var day = o.created_at.slice(0, 10);
      if (!byDate[day]) byDate[day] = { date: day, cash: 0, card: 0, eft: 0, mobile: 0, split: 0, other: 0, total: 0, orders: 0 };
      var amt = Number(o.total_amount) || 0;
      var pm = (o.payment_method || "").toLowerCase();
      if (pm === "cash") byDate[day].cash += amt;
      else if (pm === "card") byDate[day].card += amt;
      else if (pm === "eft") byDate[day].eft += amt;
      else if (pm === "mobile" || pm === "mobile money" || pm === "mobile_money") byDate[day].mobile += amt;
      else if (pm === "split") byDate[day].split += amt;
      else byDate[day].other += amt;
      byDate[day].total += amt;
      byDate[day].orders += 1;
    });

    var sorted = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    setRows(sorted);

    var t = { cash: 0, card: 0, eft: 0, mobile: 0, split: 0, other: 0, total: 0, orders: 0 };
    sorted.forEach(function(r) {
      t.cash += r.cash; t.card += r.card; t.eft += r.eft;
      t.mobile += r.mobile; t.split += r.split; t.other += r.other;
      t.total += r.total; t.orders += r.orders;
    });
    setTotals(t);
  }

  useEffect(function() { load(); }, [selectedStore]);

  function exportCSV() {
    var headers = ["Date","Cash","Card","EFT","Mobile","Split","Other","Total","Orders"];
    var csvRows = [headers.join(",")];
    rows.forEach(function(r) {
      csvRows.push([
        r.date,
        r.cash.toFixed(2), r.card.toFixed(2), r.eft.toFixed(2),
        r.mobile.toFixed(2), r.split.toFixed(2), r.other.toFixed(2),
        r.total.toFixed(2), r.orders
      ].join(","));
    });
    csvRows.push(["TOTAL",
      totals.cash.toFixed(2), totals.card.toFixed(2), totals.eft.toFixed(2),
      totals.mobile.toFixed(2), totals.split.toFixed(2), totals.other.toFixed(2),
      totals.total.toFixed(2), totals.orders
    ].join(","));
    var blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "payment-breakdown-" + dateFrom + "-to-" + dateTo + ".csv";
    a.click(); URL.revokeObjectURL(url);
  }

  var hasMobile = totals.mobile > 0;
  var hasSplit = totals.split > 0;
  var hasOther = totals.other > 0;

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payment Breakdown</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Daily cash · card · EFT split</p>
        </div>
        <Button onClick={exportCSV} variant="outline" size="sm" className="gap-2 self-start">
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 bg-card border border-border rounded-xl p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">From</label>
          <input
            type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-input rounded-lg px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">To</label>
          <input
            type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-input rounded-lg px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Button onClick={load} size="sm" className="gap-2">
          <RefreshCw className="w-4 h-4" /> Apply
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-green-500/10">
            <Banknote className="w-4 h-4 text-green-500" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Cash</p>
            <p className="text-lg font-bold text-foreground truncate">{fmt(totals.cash)}</p>
            <p className="text-xs text-muted-foreground">{totals.total > 0 ? Math.round(totals.cash / totals.total * 100) : 0}% of sales</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <CreditCard className="w-4 h-4 text-blue-500" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Card</p>
            <p className="text-lg font-bold text-foreground truncate">{fmt(totals.card)}</p>
            <p className="text-xs text-muted-foreground">{totals.total > 0 ? Math.round(totals.card / totals.total * 100) : 0}% of sales</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <TrendingUp className="w-4 h-4 text-purple-500" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">EFT</p>
            <p className="text-lg font-bold text-foreground truncate">{fmt(totals.eft)}</p>
            <p className="text-xs text-muted-foreground">{totals.total > 0 ? Math.round(totals.eft / totals.total * 100) : 0}% of sales</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-orange-500/10">
            <Calendar className="w-4 h-4 text-orange-500" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-lg font-bold text-foreground truncate">{fmt(totals.total)}</p>
            <p className="text-xs text-muted-foreground">{totals.orders} orders</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No orders in this date range</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-right px-4 py-3 font-medium text-green-600">Cash</th>
                  <th className="text-right px-4 py-3 font-medium text-blue-600">Card</th>
                  <th className="text-right px-4 py-3 font-medium text-purple-600">EFT</th>
                  {hasMobile && <th className="text-right px-4 py-3 font-medium text-pink-600">Mobile</th>}
                  {hasSplit && <th className="text-right px-4 py-3 font-medium text-yellow-600">Split</th>}
                  {hasOther && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Other</th>}
                  <th className="text-right px-4 py-3 font-medium text-foreground">Total</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Orders</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(function(r, i) {
                  return (
                    <tr key={r.date} className={"border-b border-border/50 hover:bg-muted/20 transition-colors " + (i % 2 === 0 ? "" : "bg-muted/10")}>
                      <td className="px-4 py-3 font-medium text-foreground">{fmtDate(r.date)}</td>
                      <td className="px-4 py-3 text-right text-green-600 font-medium">{r.cash > 0 ? fmt(r.cash) : <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="px-4 py-3 text-right text-blue-600 font-medium">{r.card > 0 ? fmt(r.card) : <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="px-4 py-3 text-right text-purple-600 font-medium">{r.eft > 0 ? fmt(r.eft) : <span className="text-muted-foreground/40">—</span>}</td>
                      {hasMobile && <td className="px-4 py-3 text-right text-pink-600 font-medium">{r.mobile > 0 ? fmt(r.mobile) : <span className="text-muted-foreground/40">—</span>}</td>}
                      {hasSplit && <td className="px-4 py-3 text-right text-yellow-600 font-medium">{r.split > 0 ? fmt(r.split) : <span className="text-muted-foreground/40">—</span>}</td>}
                      {hasOther && <td className="px-4 py-3 text-right text-muted-foreground">{r.other > 0 ? fmt(r.other) : <span className="text-muted-foreground/40">—</span>}</td>}
                      <td className="px-4 py-3 text-right font-bold text-foreground">{fmt(r.total)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{r.orders}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40">
                  <td className="px-4 py-3 font-bold text-foreground">TOTAL</td>
                  <td className="px-4 py-3 text-right font-bold text-green-600">{fmt(totals.cash)}</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-600">{fmt(totals.card)}</td>
                  <td className="px-4 py-3 text-right font-bold text-purple-600">{fmt(totals.eft)}</td>
                  {hasMobile && <td className="px-4 py-3 text-right font-bold text-pink-600">{fmt(totals.mobile)}</td>}
                  {hasSplit && <td className="px-4 py-3 text-right font-bold text-yellow-600">{fmt(totals.split)}</td>}
                  {hasOther && <td className="px-4 py-3 text-right font-bold text-muted-foreground">{fmt(totals.other)}</td>}
                  <td className="px-4 py-3 text-right font-bold text-foreground">{fmt(totals.total)}</td>
                  <td className="px-4 py-3 text-right font-bold text-muted-foreground">{totals.orders}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
