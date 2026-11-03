import React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../lib/currency";
import {
  ArrowLeft, Search, ScanLine, Pause, Play, CheckCircle, Check,
  Trash2, EyeOff, AlertTriangle, History, ClipboardCheck, Download, Share2, RotateCcw,
} from "lucide-react";

var PAGE = 300;

export default function StockCountSession() {
  var { id } = useParams();
  var navigate = useNavigate();

  var [header, setHeader] = useState(null);
  var [summary, setSummary] = useState(null);
  var [items, setItems] = useState([]);
  var [recent, setRecent] = useState([]);
  var [filter, setFilter] = useState("all");
  var [search, setSearch] = useState("");
  var [category, setCategory] = useState("");
  var [catList, setCatList] = useState([]);
  var [code, setCode] = useState("");
  var [qty, setQty] = useState("1");
  var [quickScan, setQuickScan] = useState(false);
  var [busy, setBusy] = useState(false);
  var [loading, setLoading] = useState(true);
  var [fatal, setFatal] = useState("");
  var [showRecent, setShowRecent] = useState(false);

  var [inReview, setInReview] = useState(false);
  var [reviewFilter, setReviewFilter] = useState("unmatched");
  var [reviewRows, setReviewRows] = useState([]);
  var [checked, setChecked] = useState(function () { return new Set(); });
  var [uncountedMode, setUncountedMode] = useState("skip");
  var [applying, setApplying] = useState(false);
  var [suppliers, setSuppliers] = useState([]);
  var [recSupplier, setRecSupplier] = useState("");
  var [recording, setRecording] = useState(false);
  var [pendingDocs, setPendingDocs] = useState({ drafts: 0, transit: 0 });

  var codeRef = useRef(null);

  var refresh = useCallback(async function (nextFilter, nextSearch) {
    var f = nextFilter !== undefined ? nextFilter : filter;
    var s = nextSearch !== undefined ? nextSearch : search;
    var results = await Promise.all([
      supabase.rpc("stock_count_summary", { p_count_id: id }),
      supabase.rpc("stock_count_items_list", {
        p_count_id: id, p_filter: f, p_search: s || null, p_limit: PAGE, p_offset: 0,
        p_category: category || null,
      }),
      supabase.rpc("stock_count_recent", { p_count_id: id, p_limit: 15 }),
    ]);
    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    setSummary(results[0].data);
    setItems(results[1].data || []);
    setRecent(results[2].data || []);
  }, [id, filter, search, category]);

  useEffect(function () {
    var cancelled = false;
    (async function () {
      try {
        var res = await supabase.from("stock_counts")
          .select("id, name, status, store_id, blind, scope, category, categories, items_total, started_at")
          .eq("id", id).single();
        if (res.error) throw res.error;
        if (cancelled) return;
        setHeader(res.data);
        await refresh();
      } catch (e) {
        if (!cancelled) setFatal(e.message || "Could not open this count.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return function () { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(function () {
    if (loading || inReview) return;
    var t = setTimeout(function () {
      refresh().catch(function (e) { toast.error(e.message); });
    }, 250);
    return function () { clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, category]);

  // Category chips: the distinct categories on this count, in alphabetical order
  useEffect(function () {
    if (!id) return;
    supabase.from("stock_count_items").select("category").eq("count_id", id).limit(5000)
      .then(function (res) {
        if (res.error || !res.data) return;
        var seen = {};
        res.data.forEach(function (r) { seen[r.category || "Uncategorised"] = true; });
        setCatList(Object.keys(seen).sort());
      });
  }, [id, loading]);

  async function submitCount() {
    var value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      var res = await supabase.rpc("stock_count_scan", {
        p_count_id: id, p_code: value, p_qty: Number(qty || 1),
        p_mode: quickScan ? "add" : "set",
      });
      if (res.error) throw res.error;
      var data = res.data;

      if (data.status === "not_found") {
        toast.error('No product matches "' + value + '"');
      } else if (data.status === "ambiguous") {
        toast.error(data.matches + ' products match "' + value + '" — be more specific');
      } else {
        toast.success(data.product_name + ": " + Number(data.counted_qty));
        if (navigator.vibrate) navigator.vibrate(30);
        setCode("");
        if (!quickScan) setQty("1");
        await refresh();
      }
    } catch (e) {
      toast.error(e.message || "Could not record that count.");
    } finally {
      setBusy(false);
      if (codeRef.current) codeRef.current.focus();
    }
  }

  async function setLine(productId, value) {
    try {
      var parsed = value === "" ? null : Number(value);
      if (parsed !== null && (isNaN(parsed) || parsed < 0)) return;
      var res = await supabase.rpc("stock_count_set", {
        p_count_id: id, p_product_id: productId, p_counted: parsed,
      });
      if (res.error) throw res.error;
      await refresh();
    } catch (e) {
      toast.error(e.message || "Could not save that line.");
    }
  }

  async function setStatus(status) {
    try {
      var res = await supabase.rpc("stock_count_set_status", { p_count_id: id, p_status: status });
      if (res.error) throw res.error;
      setHeader(function (h) { return { ...h, status: status }; });
      await refresh();
    } catch (e) { toast.error(e.message); }
  }

  var loadReview = useCallback(async function (f) {
    var res = await supabase.rpc("stock_count_items_list", {
      p_count_id: id, p_filter: f, p_search: null, p_limit: 2000, p_offset: 0,
    });
    if (res.error) throw res.error;
    setReviewRows(res.data || []);
    var sum = await supabase.rpc("stock_count_summary", { p_count_id: id });
    setSummary(sum.data);
  }, [id]);

  // Store-friendly PDF: product, what the system expects, what was counted, and a plain "3 over" / "2 short"
  async function buildVarianceFile() {
    var all = [];
    for (var off = 0; ; off += 1000) {
      var res = await supabase.rpc("stock_count_items_list", {
        p_count_id: id, p_filter: "variance", p_search: null, p_limit: 1000, p_offset: off,
      });
      if (res.error) throw res.error;
      all = all.concat(res.data || []);
      if (!res.data || res.data.length < 1000) break;
    }
    if (!all.length) return null;
    var st = await supabase.from("stores").select("name").eq("id", header.store_id).single();
    var storeName = st.data ? st.data.name : "";
    var mod = await import("jspdf");
    var doc = new mod.jsPDF({ unit: "mm", format: "a4" });
    var clean = function (t) { return String(t == null ? "" : t).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\xFF]/g, ""); };
    var fmt = function (v) { var x = Number(v); return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100); };
    var M = 14, W = 210, y = 0;
    var over = all.filter(function (r) { return Number(r.variance) > 0; }).length;
    var short = all.length - over;

    doc.setFont("helvetica", "bold"); doc.setFontSize(17);
    doc.text("Stock count variances", M, 18);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
    doc.text(clean("Store: " + storeName), M, 26);
    doc.text(clean("Count: " + header.name), M, 32);
    doc.text("Date: " + new Date().toLocaleDateString("en-ZA"), M, 38);
    doc.setFont("helvetica", "bold");
    doc.text(all.length + " product(s) do not match: " + over + " over, " + short + " short", M, 46);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(90);
    var note = doc.splitTextToSize("System = what the system says should be in the store. Counted = what was counted. OVER means more was counted than the system has (usually stock that came in without being received on the system). SHORT means less was counted. Please check these items.", W - 2 * M);
    doc.text(note, M, 52);
    doc.setTextColor(0);
    y = 52 + note.length * 4.6 + 4;

    var head = function () {
      doc.setFillColor(235, 235, 235); doc.rect(M, y - 5, W - 2 * M, 8, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text("Product", M + 2, y);
      doc.text("System", 140, y, { align: "right" });
      doc.text("Counted", 162, y, { align: "right" });
      doc.text("Difference", 168, y);
      y += 7; doc.setFont("helvetica", "normal");
    };
    head();
    all.forEach(function (r, i) {
      var lines = doc.splitTextToSize(clean(r.product_name), 100);
      var h = Math.max(7, lines.length * 4.8 + 2.4);
      if (y + h > 280) { doc.addPage(); y = 16; head(); }
      if (i % 2 === 1) { doc.setFillColor(247, 247, 247); doc.rect(M, y - 4.8, W - 2 * M, h, "F"); }
      var d = Number(r.variance);
      doc.setFontSize(10); doc.setTextColor(0);
      doc.text(lines, M + 2, y);
      doc.text(fmt(r.expected_qty), 140, y, { align: "right" });
      doc.text(fmt(r.counted_qty), 162, y, { align: "right" });
      doc.setFont("helvetica", "bold");
      if (d > 0) doc.setTextColor(180, 110, 0); else doc.setTextColor(200, 30, 30);
      doc.text(fmt(Math.abs(d)) + (d > 0 ? " over" : " short"), 168, y);
      doc.setFont("helvetica", "normal"); doc.setTextColor(0);
      y += h;
    });
    var pages = doc.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFontSize(8.5); doc.setTextColor(120);
      doc.text("Page " + p + " of " + pages, W - M, 290, { align: "right" });
    }
    var safe = (storeName + " variances " + new Date().toISOString().slice(0, 10)).replace(/[^a-z0-9]+/gi, "-");
    return new File([doc.output("blob")], safe + ".pdf", { type: "application/pdf" });
  }

  async function downloadVariances(share) {
    try {
      var file = await buildVarianceFile();
      if (!file) { toast.info("No variances in this count"); return; }
      if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "Stock count variances" }); } catch (e) { /* cancelled */ }
        return;
      }
      var url = URL.createObjectURL(file);
      var a = document.createElement("a");
      a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) { toast.error(e.message || "Could not build the variance file."); }
  }

  async function reopenCount() {
    var reason = window.prompt("Reopen this count so it can be changed? The stock changes it made are taken back, then you can recount and complete it again.\n\nReason (required):");
    if (reason === null) return;
    if (!reason.trim()) { toast.error("Give a reason to reopen the count"); return; }
    try {
      var res = await supabase.rpc("stock_count_reopen", { p_count_id: id, p_reason: reason.trim() });
      if (res.error) throw res.error;
      toast.success("Count reopened. " + (res.data.reversed_lines || 0) + " stock changes taken back.");
      setHeader(function (h) { return { ...h, status: "in_progress" }; });
      await refresh();
    } catch (e) { toast.error(e.message || "Could not reopen the count."); }
  }

  async function loadReceiptContext() {
    try {
      var sup = await supabase.from("suppliers").select("id, name, is_internal").eq("is_active", true).order("name");
      var list = sup.data || [];
      setSuppliers(list);
      setRecSupplier(function (cur) {
        if (cur) return cur;
        var internal = list.filter(function (s) { return s.is_internal; });
        return internal.length === 1 ? internal[0].id : "";
      });
      var sid = header && header.store_id;
      if (sid) {
        var d = await supabase.from("goods_received_notes").select("id", { count: "exact", head: true }).eq("store_id", sid).eq("status", "draft");
        var t = await supabase.from("stock_transfer_notes").select("id", { count: "exact", head: true }).eq("to_store_id", sid).eq("status", "dispatched");
        setPendingDocs({ drafts: d.count || 0, transit: t.count || 0 });
      }
    } catch (e) { /* the warning is optional */ }
  }

  async function openReview() {
    try {
      await loadReview(reviewFilter);
      setChecked(new Set());
      setInReview(true);
      loadReceiptContext();
    } catch (e) { toast.error(e.message); }
  }

  async function recordReceipts() {
    if (!recSupplier) { toast.error("Choose where the stock came from"); return; }
    var ids = Array.from(checked);
    var overIds = ids.length ? reviewRows.filter(function (r) { return ids.indexOf(r.product_id) >= 0 && Number(r.variance) > 0; }).map(function (r) { return r.product_id; }) : null;
    if (ids.length && !overIds.length) { toast.error("None of the selected products are over"); return; }
    var n = overIds ? overIds.length : summary.over;
    if (!window.confirm("Post a GRV for " + n + " over product(s)? This adds the extra units to stock as received, so the count no longer shows them as over.")) return;
    setRecording(true);
    try {
      var res = await supabase.rpc("stock_count_record_receipts", {
        p_count_id: id, p_supplier_id: recSupplier, p_product_ids: overIds, p_notes: null,
      });
      if (res.error) throw res.error;
      toast.success(res.data.grn_number + " posted: " + res.data.units + " units across " + res.data.items + " products");
      setChecked(new Set());
      await loadReview(reviewFilter);
    } catch (e) {
      toast.error(e.message || "Could not record the receipt.");
    } finally { setRecording(false); }
  }

  async function switchReviewTab(f) {
    setReviewFilter(f);
    setChecked(new Set());
    try { await loadReview(f); } catch (e) { toast.error(e.message); }
  }

  async function toggleExcluded(excluded) {
    if (!checked.size) return;
    try {
      var res = await supabase.rpc("stock_count_set_excluded", {
        p_count_id: id, p_product_ids: Array.from(checked), p_excluded: excluded,
      });
      if (res.error) throw res.error;
      setChecked(new Set());
      await loadReview(reviewFilter);
    } catch (e) { toast.error(e.message); }
  }

  async function submitForApproval() {
    if (!window.confirm("Submit this count for approval? You will not be able to change it afterwards.")) return;
    setBusy(true);
    try {
      var res = await supabase.rpc("stock_count_submit", { p_count_id: id });
      if (res.error) throw res.error;
      toast.success("Count submitted - a manager will approve it.");
      setHeader(function (h) { return { ...h, status: "submitted" }; });
      await refresh();
    } catch (e) {
      toast.error(e.message || "Could not submit the count.");
    } finally { setBusy(false); }
  }

  async function applyCount() {
    setApplying(true);
    try {
      var res = await supabase.rpc("stock_count_apply", {
        p_count_id: id, p_uncounted: uncountedMode, p_notes: null,
      });
      if (res.error) throw res.error;
      toast.success(res.data.applied + " products updated");
      navigate("/stock-counts");
    } catch (e) {
      toast.error(e.message || "Could not apply the count.");
    } finally { setApplying(false); }
  }

  async function discardCount() {
    if (!window.confirm("Discard this count? Nothing will be written to stock.")) return;
    try {
      var res = await supabase.rpc("stock_count_cancel", { p_count_id: id, p_notes: null });
      if (res.error) throw res.error;
      navigate("/stock-counts");
    } catch (e) { toast.error(e.message); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!header) {
    return <div className="max-w-3xl mx-auto p-6 text-sm text-red-500">{fatal || "Count not found."}</div>;
  }

  var canApply = summary && summary.can_apply;
  var masked = summary && summary.blind && !canApply;
  var closed = header.status === "completed" || header.status === "cancelled";
  var live = header.status === "in_progress";
  var submitted = header.status === "submitted";

  var num = function (v) { return v === null || v === undefined ? "—" : Number(v); };

  // ───────────────────────── REVIEW ─────────────────────────
  if (inReview) {
    var tabs = [
      ["uncounted", "Uncounted (" + (summary.uncounted || 0) + ")"],
      ["unmatched", "Unmatched (" + (summary.unmatched || 0) + ")"],
      ["over", "Over (" + (summary.over || 0) + ")"],
      ["short", "Short (" + (summary.short || 0) + ")"],
      ["matched", "Matched (" + (summary.matched || 0) + ")"],
      ["excluded", "Excluded (" + (summary.excluded || 0) + ")"],
      ["all", "All (" + (summary.total || 0) + ")"],
    ];
    var blurbs = {
      uncounted: "These were never counted. They keep their current stock unless you set them to zero.",
      unmatched: "What you counted is more or less than expected. Worth a second look before you complete.",
      over: "More on the shelf than the system expects. This is almost always stock that arrived without a GRV. Record it as received below, or investigate first.",
      short: "Less on the shelf than the system expects: sales not captured, damage, theft or a miscount.",
      matched: "These match the system exactly. Nothing will change.",
      excluded: "Excluded products are left out of the update entirely.",
      all: "Everything in this count.",
    };

    return (
      <div className="max-w-6xl mx-auto w-full px-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={function () { setInReview(false); }}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground truncate">{header.name}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Check the differences, then keep counting or complete the count.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={function () { downloadVariances(false); }}><Download className="w-4 h-4" /> Variances PDF</Button>
            {typeof navigator !== "undefined" && typeof navigator.canShare === "function" && (
              <Button variant="outline" className="gap-2" onClick={function () { downloadVariances(true); }}><Share2 className="w-4 h-4" /> Share</Button>
            )}
            <Button variant="outline" onClick={discardCount}>Discard</Button>
            <Button variant="outline" onClick={function () { setInReview(false); }}>Continue counting</Button>
            <Button className="gap-2 font-semibold" disabled={applying} onClick={applyCount}>
              <CheckCircle className="w-4 h-4" />{applying ? "Completing..." : "Complete"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 border border-border px-4 py-3 mb-3">
          <span className="text-sm text-muted-foreground">
            {summary.counted || 0} of {summary.total || 0} counted
          </span>
          <span className="text-sm font-semibold text-foreground">
            Stock value change:{" "}
            <span className={Number(summary.var_value) < 0 ? "text-red-500" : "text-green-500"}>
              {formatCurrency(summary.var_value || 0)}
            </span>
          </span>
        </div>

        {(pendingDocs.drafts > 0 || pendingDocs.transit > 0) && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 mb-3 text-sm text-amber-600 dark:text-amber-400">
            <span className="font-medium">Sort these out before completing:</span>{" "}
            {pendingDocs.drafts > 0 && <span>{pendingDocs.drafts} draft GRV(s) not posted (that stock shows as over). </span>}
            {pendingDocs.transit > 0 && <span>{pendingDocs.transit} transfer(s) in transit to this store not received yet (that stock shows as short).</span>}
          </div>
        )}

        {(summary.over || 0) > 0 && (
          <div className="rounded-lg border border-border bg-card p-3 mb-3">
            <div className="text-sm font-medium text-foreground">
              {summary.over} product(s) are over by {Number(summary.over_units || 0)} unit(s) in total
              {Number(summary.received_units || 0) > 0 ? " (" + Number(summary.received_units) + " already recorded as received)" : ""}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Stock that came in without a GRV. Post it as received so it is on the books with a GRV number, then complete the count. Tick products to record only those, or leave all unticked to record every over product.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={recSupplier} onChange={function (e) { setRecSupplier(e.target.value); }}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm">
                <option value="">Received from...</option>
                {suppliers.map(function (s) { return <option key={s.id} value={s.id}>{s.name}</option>; })}
              </select>
              <Button size="sm" disabled={recording || !recSupplier} onClick={recordReceipts}>
                {recording ? "Posting..." : (checked.size ? "Record " + checked.size + " selected as received" : "Record all over as received")}
              </Button>
            </div>
          </div>
        )}

        {(summary.uncounted || 0) > 0 && (
          <label className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 mb-4 cursor-pointer">
            <input type="checkbox" className="mt-0.5 w-4 h-4 accent-amber-500"
              checked={uncountedMode === "zero"}
              onChange={function (e) { setUncountedMode(e.target.checked ? "zero" : "skip"); }} />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4" /> Set the {summary.uncounted} uncounted products to zero
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Leave this off and uncounted products keep their current stock.
              </span>
            </span>
          </label>
        )}

        <div className="flex flex-wrap gap-5 border-b border-border mb-2">
          {tabs.map(function (t) {
            return (
              <button key={t[0]} onClick={function () { switchReviewTab(t[0]); }}
                className={cn("-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors",
                  reviewFilter === t[0]
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t[1]}
              </button>
            );
          })}
        </div>

        <p className="py-3 text-sm text-muted-foreground">{blurbs[reviewFilter]}</p>

        {checked.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-foreground text-background px-4 py-2.5 text-sm mb-3">
            <span>{checked.size} selected</span>
            <button onClick={function () { toggleExcluded(true); }}
              className="rounded bg-background/15 px-3 py-1.5 font-medium hover:bg-background/25">
              Exclude from update
            </button>
            <button onClick={function () { toggleExcluded(false); }}
              className="rounded bg-background/15 px-3 py-1.5 font-medium hover:bg-background/25">
              Put back in
            </button>
            <button onClick={function () { setChecked(new Set()); }} className="ml-auto opacity-70 hover:opacity-100">
              Clear
            </button>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 py-2.5 px-3">
                  <input type="checkbox" className="w-4 h-4 accent-primary"
                    checked={reviewRows.length > 0 && checked.size === reviewRows.length}
                    onChange={function (e) {
                      setChecked(e.target.checked ? new Set(reviewRows.map(function (r) { return r.product_id; })) : new Set());
                    }} />
                </th>
                <th className="py-2.5 text-left font-semibold">Product</th>
                <th className="w-24 py-2.5 text-right font-semibold">Expected</th>
                <th className="w-24 py-2.5 text-right font-semibold">Counted</th>
                <th className="w-20 py-2.5 text-right font-semibold">Units</th>
                <th className="w-32 py-2.5 pr-4 text-right font-semibold">Value</th>
              </tr>
            </thead>
            <tbody>
              {reviewRows.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">Nothing in this list.</td></tr>
              )}
              {reviewRows.map(function (r) {
                var d = r.variance === null ? null : Number(r.variance);
                return (
                  <tr key={r.product_id} className={cn("border-b border-border/50 last:border-0", r.excluded && "opacity-50")}>
                    <td className="py-3 px-3">
                      <input type="checkbox" className="w-4 h-4 accent-primary"
                        checked={checked.has(r.product_id)}
                        onChange={function (e) {
                          var next = new Set(checked);
                          if (e.target.checked) next.add(r.product_id); else next.delete(r.product_id);
                          setChecked(next);
                        }} />
                    </td>
                    <td className="py-3">
                      <div className="font-medium text-foreground">{r.product_name}</div>
                      <div className="text-xs text-muted-foreground">{r.sku || r.barcode || ""}</div>
                    </td>
                    <td className="py-3 text-right tabular-nums text-muted-foreground">{num(r.expected_qty)}</td>
                    <td className="py-3 text-right tabular-nums font-medium text-foreground">{num(r.counted_qty)}</td>
                    <td className={cn("py-3 text-right tabular-nums font-semibold",
                      d === null || d === 0 ? "text-muted-foreground" : d > 0 ? "text-green-500" : "text-red-500")}>
                      {d === null ? "—" : d > 0 ? "+" + d : d}
                    </td>
                    <td className={cn("py-3 pr-4 text-right tabular-nums",
                      Number(r.value_variance) < 0 ? "text-red-500" : "text-muted-foreground")}>
                      {r.value_variance === null ? "—" : formatCurrency(r.value_variance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ───────────────────────── COUNTING ─────────────────────────
  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={function () { navigate("/stock-counts"); }}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground truncate">{header.name}</h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
              <span>{summary.counted || 0} of {summary.total || 0} counted</span>
              {header.scope === "category" && <span>{(header.categories && header.categories.length > 1) ? "Categories" : "Category"}: {header.categories && header.categories.length ? header.categories.join(", ") : header.category}</span>}
              {masked && (
                <span className="inline-flex items-center gap-1"><EyeOff className="w-3 h-3" /> Blind count</span>
              )}
            </p>
          </div>
        </div>

        {canApply && (closed || submitted) && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={function () { downloadVariances(false); }}><Download className="w-4 h-4" /> Variances PDF</Button>
            {typeof navigator !== "undefined" && typeof navigator.canShare === "function" && (
              <Button variant="outline" className="gap-2" onClick={function () { downloadVariances(true); }}><Share2 className="w-4 h-4" /> Share</Button>
            )}
            {header.status === "completed" && (
              <Button className="gap-2 font-semibold" onClick={reopenCount}><RotateCcw className="w-4 h-4" /> Reopen count</Button>
            )}
          </div>
        )}

        {!closed && (
          <div className="flex flex-wrap gap-2">
            {canApply && live && (
              <Button variant="outline" className="gap-2" onClick={function () { downloadVariances(false); }}><Download className="w-4 h-4" /> Variances PDF</Button>
            )}
            <Button variant="outline" className="gap-2 lg:hidden" onClick={function () { setShowRecent(!showRecent); }}>
              <History className="w-4 h-4" /> Last counted
            </Button>
            {live ? (
              <Button variant="outline" className="gap-2" onClick={function () { setStatus("paused"); }}>
                <Pause className="w-4 h-4" /> Pause
              </Button>
            ) : (submitted && !canApply) ? null : (
              <Button variant="outline" className="gap-2" onClick={function () { setStatus("in_progress"); }}>
                <Play className="w-4 h-4" /> {submitted ? "Send back for counting" : "Resume"}
              </Button>
            )}
            {!canApply && !submitted && (
              <Button className="gap-2 font-semibold" disabled={busy} onClick={submitForApproval}>
                <CheckCircle className="w-4 h-4" /> Close &amp; submit
              </Button>
            )}
            {canApply && (
              <Button className="gap-2 font-semibold" onClick={openReview}>
                <ClipboardCheck className="w-4 h-4" /> Review
              </Button>
            )}
          </div>
        )}
      </div>

      {!live && !closed && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {submitted
              ? (canApply ? "Submitted for approval. Review it and complete it to update stock." : "Submitted - waiting for a manager to approve it.")
              : "This count is paused. Resume it to keep counting."}
          </p>
        </div>
      )}

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          {live && (
            <div className="rounded-xl border border-border bg-card p-3 mb-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Scan a barcode or search by name / SKU
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input ref={codeRef} value={code} autoFocus placeholder="Scan or type a product"
                      className="pl-10 h-11 text-base"
                      onChange={function (e) { setCode(e.target.value); }}
                      onKeyDown={function (e) { if (e.key === "Enter") { e.preventDefault(); submitCount(); } }} />
                  </div>
                </div>

                <div className="w-24">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Quantity</label>
                  <Input value={qty} inputMode="decimal" className="h-11 text-base text-center"
                    onChange={function (e) { setQty(e.target.value); }} />
                </div>

                <Button className="h-11 px-6 font-semibold" disabled={busy || !code.trim()} onClick={submitCount}>
                  {busy ? "..." : "Count"}
                </Button>

                <button onClick={function () { setQuickScan(!quickScan); setQty("1"); if (codeRef.current) codeRef.current.focus(); }}
                  className="flex items-center gap-2 h-11 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <span className={cn("flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
                    quickScan ? "bg-primary" : "bg-muted")}>
                    <span className={cn("h-5 w-5 rounded-full bg-background transition-transform", quickScan && "translate-x-5")} />
                  </span>
                  <ScanLine className="w-4 h-4" /> Quick scan
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {quickScan
                  ? "Quick scan adds to the running total each time you scan — good for counting one unit at a time."
                  : "Each entry replaces the count for that product. Turn on Quick scan to add instead."}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-6 border-b border-border mb-2">
            {[
              ["all", "All (" + (summary.total || 0) + ")"],
              ["counted", "Counted (" + (summary.counted || 0) + ")"],
              ["uncounted", "Uncounted (" + (summary.uncounted || 0) + ")"],
            ].concat(summary.variances === null || summary.variances === undefined ? [] : [
              ["variance", "Variances (" + summary.variances + ")"],
              ["over", "Over (" + (summary.over || 0) + ")"],
              ["short", "Short (" + (summary.short || 0) + ")"],
            ]).map(function (t) {
              return (
                <button key={t[0]} onClick={function () { setFilter(t[0]); }}
                  className={cn("-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors",
                    filter === t[0]
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground")}>
                  {t[1]}
                </button>
              );
            })}
            <Input value={search} placeholder="Filter this list" className="ml-auto mb-2 w-44 h-8 text-sm"
              onChange={function (e) { setSearch(e.target.value); }} />
          </div>

          {catList.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
              {[["", "All categories"]].concat(catList.map(function (c) { return [c === "Uncategorised" ? "" : c, c]; })).map(function (c, idx) {
                if (idx > 0 && c[1] === "Uncategorised") return null;
                var on = category === c[0];
                return (
                  <button key={c[1]} onClick={function () { setCategory(c[0]); }}
                    className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                    {c[1]}
                  </button>
                );
              })}
            </div>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className={cn("grid gap-3 px-3 py-2.5 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground",
              masked ? "grid-cols-[24px_1fr_auto]" : "grid-cols-[24px_1fr_auto_auto]")}>
              <span />
              <span>Product</span>
              {!masked && <span className="w-20 text-right">Expected</span>}
              <span className="w-24 text-right">Counted</span>
            </div>

            {items.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">Nothing to show here.</div>
            )}

            {items.map(function (r, i) {
              var showHead = !["variance","over","short"].includes(filter) &&
                (i === 0 || (items[i - 1].category || "") !== (r.category || ""));
              var diff = r.variance === null || r.variance === undefined ? null : Number(r.variance);
              var isCounted = r.counted_qty !== null && r.counted_qty !== undefined;
              return (
                <React.Fragment key={r.product_id}>
                {showHead && (
                  <div className="px-3 py-1.5 bg-muted/60 border-b border-border text-xs font-semibold uppercase tracking-wide text-foreground">
                    {r.category || "Uncategorised"}
                  </div>
                )}
                <div
                  className={cn("grid items-center gap-3 px-3 py-3 border-b border-border/50 last:border-0 transition-colors",
                    masked ? "grid-cols-[24px_1fr_auto]" : "grid-cols-[24px_1fr_auto_auto]",
                    isCounted && "bg-primary/[0.04]",
                    r.excluded && "opacity-50")}>
                  <span>
                    {isCounted
                      ? <Check className="w-4 h-4 text-primary" />
                      : <span className="block w-3.5 h-3.5 rounded-full border border-border" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{r.product_name}</div>
                    <div className="text-xs text-muted-foreground">{r.sku || r.barcode || ""}</div>
                  </div>
                  {!masked && (
                    <div className="w-20 text-right text-sm tabular-nums text-muted-foreground">{num(r.expected_qty)}</div>
                  )}
                  <div className="w-24 flex items-center justify-end gap-2">
                    {diff !== null && diff !== 0 && (
                      <span className={cn("text-xs font-semibold tabular-nums", diff > 0 ? "text-green-500" : "text-red-500")}>
                        {diff > 0 ? "+" + diff : diff}
                      </span>
                    )}
                    <Input
                      key={r.product_id + "-" + (r.counted_qty === null || r.counted_qty === undefined ? "x" : r.counted_qty)}
                      defaultValue={r.counted_qty === null || r.counted_qty === undefined ? "" : r.counted_qty}
                      disabled={!live} inputMode="decimal" placeholder="—"
                      className="w-16 h-9 text-right text-sm"
                      onBlur={function (e) {
                        var v = e.target.value.trim();
                        var current = r.counted_qty === null || r.counted_qty === undefined ? "" : String(Number(r.counted_qty));
                        if (v !== current) setLine(r.product_id, v);
                      }}
                      onKeyDown={function (e) { if (e.key === "Enter") e.currentTarget.blur(); }} />
                  </div>
                </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <aside className={cn("w-72 shrink-0", showRecent ? "block" : "hidden", "lg:block")}>
          <div className="sticky top-4 rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-sm font-semibold text-foreground">
              Your last counted items
            </div>
            {recent.length === 0 ? (
              <p className="px-4 py-6 text-xs text-muted-foreground">
                Items you count appear here one by one, so you can check your last entries.
              </p>
            ) : (
              <ul className="max-h-[60vh] overflow-y-auto">
                {recent.map(function (r) {
                  return (
                    <li key={r.product_id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0">
                      <span className="w-8 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
                        {Number(r.counted_qty)}
                      </span>
                      <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">{r.product_name}</span>
                      {live && (
                        <button onClick={function () { setLine(r.product_id, ""); }} title="Clear this count"
                          className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
