import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "@/lib/CompanyContext";
import {
  FileText, Printer, Download, RefreshCw, AlertTriangle, Calendar
} from "lucide-react";

// SA VAT is 15%. Prices are treated as VAT-inclusive, so the VAT portion
// of an inclusive amount is amount * 15 / 115.
var VAT_RATE = 0.15;
var VAT_FRACTION = 15 / 115;

function formatZAR(n) {
  var v = Number(n || 0);
  return "" + v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toDateInput(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// Paginated fetch that works around PostgREST's silent 1000-row cap.
// buildQuery must return a FRESH query builder each call.
async function fetchAllPaged(buildQuery) {
  var pageSize = 1000;
  var from = 0;
  var all = [];
  while (true) {
    var res = await buildQuery().range(from, from + pageSize - 1);
    if (res.error) throw res.error;
    var rows = res.data || [];
    all = all.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export default function VatReport() {
  var ctx = useCompany();
  var company = ctx ? ctx.company : null;
  var companyId = ctx ? ctx.companyId : null;

  var hasVat = company && company.vat_number && String(company.vat_number).trim() !== "";

  // Default period: current calendar month to today.
  var now = new Date();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  var [fromDate, setFromDate] = useState(toDateInput(monthStart));
  var [toDate, setToDate] = useState(toDateInput(now));
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState(null);

  var [grossSales, setGrossSales] = useState(0);
  var [refunds, setRefunds] = useState(0);
  var [orderCount, setOrderCount] = useState(0);
  var [expenseGroups, setExpenseGroups] = useState([]); // [{category, total, included}]

  var setPreset = function (which) {
    var d = new Date();
    var start;
    var end;
    if (which === "this_month") {
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      end = d;
    } else if (which === "last_month") {
      start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      end = new Date(d.getFullYear(), d.getMonth(), 0);
    } else if (which === "two_month") {
      // current + previous calendar month
      start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      end = d;
    }
    if (start && end) {
      setFromDate(toDateInput(start));
      setToDate(toDateInput(end));
    }
  };

  var loadData = useCallback(async function () {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      var fromISO = new Date(fromDate + "T00:00:00").toISOString();
      var toISO = new Date(toDate + "T23:59:59.999").toISOString();

      // --- Sales (output VAT base) ---
      var orders = await fetchAllPaged(function () {
        return supabase
          .from("orders")
          .select("total_amount, refund_total, status, created_at")
          .eq("company_id", companyId)
          .eq("status", "completed")
          .gte("created_at", fromISO)
          .lte("created_at", toISO);
      });

      var gross = 0;
      var refundSum = 0;
      for (var i = 0; i < orders.length; i++) {
        gross += Number(orders[i].total_amount || 0);
        refundSum += Number(orders[i].refund_total || 0);
      }
      setGrossSales(gross);
      setRefunds(refundSum);
      setOrderCount(orders.length);

      // --- Expenses (deemed input VAT), grouped by category ---
      var expenses = await fetchAllPaged(function () {
        return supabase
          .from("expenses")
          .select("amount, category, expense_category, date")
          .eq("company_id", companyId)
          .gte("date", fromDate)
          .lte("date", toDate);
      });

      var map = {};
      for (var j = 0; j < expenses.length; j++) {
        var ex = expenses[j];
        var cat = ex.category || ex.expense_category || "Uncategorised";
        if (!map[cat]) map[cat] = 0;
        map[cat] += Number(ex.amount || 0);
      }
      var groups = [];
      var keys = Object.keys(map).sort();
      for (var k = 0; k < keys.length; k++) {
        groups.push({ category: keys[k], total: map[keys[k]], included: true });
      }
      setExpenseGroups(groups);
    } catch (err) {
      console.error("VAT report error:", err);
      setError(err.message || "Failed to load VAT data.");
    } finally {
      setLoading(false);
    }
  }, [companyId, fromDate, toDate]);

  useEffect(function () {
    if (hasVat && companyId) {
      loadData();
    }
  }, [hasVat, companyId, loadData]);

  var toggleCategory = function (index) {
    setExpenseGroups(function (prev) {
      var next = prev.slice();
      next[index] = Object.assign({}, next[index], { included: !next[index].included });
      return next;
    });
  };

  // --- Derived totals ---
  var netSales = grossSales - refunds;
  var outputVat = netSales * VAT_FRACTION;

  var includedExpenses = 0;
  for (var e = 0; e < expenseGroups.length; e++) {
    if (expenseGroups[e].included) includedExpenses += expenseGroups[e].total;
  }
  var inputVat = includedExpenses * VAT_FRACTION;
  var netVat = outputVat - inputVat;

  var downloadCsv = function () {
    var lines = [];
    lines.push(["Cannalife Co VAT Report"]);
    lines.push([company ? company.company_name : ""]);
    lines.push(["VAT Number", company ? company.vat_number : ""]);
    lines.push(["Period", fromDate + " to " + toDate]);
    lines.push([]);
    lines.push(["OUTPUT VAT (on sales)"]);
    lines.push(["Gross sales (incl VAT)", grossSales.toFixed(2)]);
    lines.push(["Refunds", refunds.toFixed(2)]);
    lines.push(["Net sales (incl VAT)", netSales.toFixed(2)]);
    lines.push(["Output VAT (15/115)", outputVat.toFixed(2)]);
    lines.push([]);
    lines.push(["INPUT VAT (on expenses, deemed VAT-inclusive)"]);
    lines.push(["Category", "Amount (incl VAT)", "Included", "Deemed VAT"]);
    for (var i = 0; i < expenseGroups.length; i++) {
      var g = expenseGroups[i];
      lines.push([
        g.category,
        g.total.toFixed(2),
        g.included ? "Yes" : "No",
        g.included ? (g.total * VAT_FRACTION).toFixed(2) : "0.00"
      ]);
    }
    lines.push(["Total input VAT", "", "", inputVat.toFixed(2)]);
    lines.push([]);
    lines.push(["NET VAT", (netVat).toFixed(2), netVat >= 0 ? "Payable to SARS" : "Refundable"]);

    var csv = lines.map(function (row) {
      return row.map(function (c) {
        var s = String(c == null ? "" : c);
        if (s.indexOf(",") >= 0 || s.indexOf('"') >= 0) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(",");
    }).join("\n");

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "vat-report-" + fromDate + "-to-" + toDate + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- Gate: no VAT number, no report ---
  if (!hasVat) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <FileText className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-xl font-semibold mb-2">VAT Reporting</h1>
          <p className="text-muted-foreground">
            VAT reporting activates once a VAT number is added for this company in Settings.
            Add your SARS VAT number there and this report will become available.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6" /> VAT Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {company.company_name} &middot; VAT No. {company.vat_number}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted/40 transition-colors"
          >
            <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} /> Refresh
          </button>
          <button
            onClick={downloadCsv}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted/40 transition-colors"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          <button
            onClick={function () { window.print(); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="rounded-lg border border-border bg-card p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">From</label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <input
                type="date"
                value={fromDate}
                onChange={function (e) { setFromDate(e.target.value); }}
                className="bg-transparent text-sm outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">To</label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <input
                type="date"
                value={toDate}
                onChange={function (e) { setToDate(e.target.value); }}
                className="bg-transparent text-sm outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={function () { setPreset("this_month"); }} className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted/40">This month</button>
            <button onClick={function () { setPreset("last_month"); }} className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted/40">Last month</button>
            <button onClick={function () { setPreset("two_month"); }} className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted/40">2-month period</button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Output VAT (sales)</p>
          <p className="text-2xl font-bold mt-2">{formatZAR(outputVat)}</p>
          <p className="text-xs text-muted-foreground mt-1">{orderCount} completed orders</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Input VAT (expenses)</p>
          <p className="text-2xl font-bold mt-2">{formatZAR(inputVat)}</p>
          <p className="text-xs text-muted-foreground mt-1">estimated, VAT-inclusive</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Net VAT {netVat >= 0 ? "payable" : "refundable"}
          </p>
          <p className={"text-2xl font-bold mt-2 " + (netVat >= 0 ? "text-foreground" : "text-green-600")}>
            {formatZAR(Math.abs(netVat))}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{netVat >= 0 ? "owed to SARS" : "claim from SARS"}</p>
        </div>
      </div>

      {/* Sales breakdown */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4">Output VAT — Sales</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Gross sales (incl VAT)</span><span>{formatZAR(grossSales)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Less refunds</span><span>-{formatZAR(refunds)}</span></div>
          <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">Net sales (incl VAT)</span><span>{formatZAR(netSales)}</span></div>
          <div className="flex justify-between font-semibold"><span>Output VAT (15/115)</span><span>{formatZAR(outputVat)}</span></div>
        </div>
      </div>

      {/* Expenses breakdown */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-1">Input VAT — Expenses</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Amounts treated as VAT-inclusive. Untick any category that does not carry VAT (e.g. salaries, bank charges, exempt items).
        </p>
        {expenseGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No expenses recorded for this period.</p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-12 text-xs font-medium text-muted-foreground uppercase tracking-wide pb-2 border-b border-border">
              <div className="col-span-1 print:hidden"></div>
              <div className="col-span-6">Category</div>
              <div className="col-span-3 text-right">Amount</div>
              <div className="col-span-2 text-right">Deemed VAT</div>
            </div>
            {expenseGroups.map(function (g, idx) {
              return (
                <div key={g.category} className="grid grid-cols-12 items-center py-2 text-sm border-b border-border/50">
                  <div className="col-span-1 print:hidden">
                    <input
                      type="checkbox"
                      checked={g.included}
                      onChange={function () { toggleCategory(idx); }}
                      className="w-4 h-4 accent-primary"
                    />
                  </div>
                  <div className="col-span-6">{g.category}</div>
                  <div className="col-span-3 text-right">{formatZAR(g.total)}</div>
                  <div className="col-span-2 text-right">{g.included ? formatZAR(g.total * VAT_FRACTION) : "—"}</div>
                </div>
              );
            })}
            <div className="grid grid-cols-12 items-center pt-3 text-sm font-semibold">
              <div className="col-span-1 print:hidden"></div>
              <div className="col-span-6">Total input VAT</div>
              <div className="col-span-3 text-right">{formatZAR(includedExpenses)}</div>
              <div className="col-span-2 text-right">{formatZAR(inputVat)}</div>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Figures are computed from POS sales and recorded expenses using the standard 15/115 inclusive method.
        This is an operational summary to assist your VAT return — confirm final figures with your accountant or against your SARS filing.
      </p>
    </div>
  );
}
