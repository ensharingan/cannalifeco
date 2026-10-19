import { useState, useMemo, useRef, useEffect } from "react";
import { Upload, Download, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadTemplate, downloadTemplateXlsx, parseCsv, parseXlsx, validateRows, TEMPLATE_COLUMNS } from "@/lib/productImport";

const CHUNK = 100;

/**
 * Bulk product import from a CSV template.
 *  - New SKUs (or rows with no SKU) are created.
 *  - A SKU that already exists is UPDATED, and only the columns present in the file are touched.
 *  - Stock goes to the chosen store's store_inventory (the legacy products.stock_quantity is
 *    only used when the company has no stores), matching the Add Product form.
 */
export default function BulkProductImportDialog({
  open, onClose, companyId, products, stores, suppliers, defaultStoreId,
  categories, productTypes, onAddCategories, onAddTypes, onDone,
}) {
  const fileRef = useRef(null);
  const [filename, setFilename] = useState("");
  const [rawRows, setRawRows] = useState(null);
  const [storeId, setStoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) return;
    setFilename(""); setRawRows(null); setProgress(0); setBusy(false);
    setStoreId(defaultStoreId || (stores.length === 1 ? stores[0].id : ""));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const existingBySku = useMemo(() => {
    const m = new Map();
    for (const p of products) if (p.sku) m.set(String(p.sku).toLowerCase(), p);
    return m;
  }, [products]);

  const result = useMemo(
    () => (rawRows ? validateRows(rawRows, { existingBySku, suppliers }) : null),
    [rawRows, existingBySku, suppliers],
  );

  const good = result ? result.rows.filter(r => r.errors.length === 0) : [];
  const bad = result ? result.rows.filter(r => r.errors.length > 0) : [];
  const creates = good.filter(r => r.action === "create").length;
  const updates = good.filter(r => r.action === "update").length;
  const anyStock = good.some(r => r.data.stock_quantity !== null && r.data.stock_quantity !== undefined);
  const needsStore = stores.length > 0 && anyStock && !storeId;

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const isXlsx = /\.xlsx$/i.test(f.name);
      if (/\.xls$/i.test(f.name)) { toast.error("Old .xls files aren't supported — save as .xlsx or .csv"); return; }
      const rows = isXlsx ? await parseXlsx(f) : parseCsv(await f.text());
      setFilename(f.name);
      setRawRows(rows);
    } catch (err) {
      console.error("[bulk import] read failed", err);
      toast.error("Couldn't read that file — use the template as .xlsx or .csv");
    }
  };

  const runImport = async () => {
    if (!good.length) return;
    if (needsStore) { toast.error("Pick which store the stock quantities belong to"); return; }
    setBusy(true); setProgress(0);
    let created = 0, updated = 0, failed = 0;
    const failures = [];
    try {
      // Register any new categories / types first so the filters & form know about them.
      const newCats = [...new Set(good.map(r => r.data.category).filter(c => c && !categories.includes(c)))];
      const newTypes = [...new Set(good.map(r => r.data.product_type).filter(t => t && !productTypes.includes(t)))];
      if (newCats.length) await onAddCategories(newCats);
      if (newTypes.length) await onAddTypes(newTypes);

      let done = 0;
      for (let i = 0; i < good.length; i += CHUNK) {
        const chunk = good.slice(i, i + CHUNK);
        const inventory = [];

        // ── creates (bulk insert) ──
        const toCreate = chunk.filter(r => r.action === "create");
        if (toCreate.length) {
          const payload = toCreate.map(r => {
            const d = r.data;
            const stock = d.stock_quantity ?? 0;
            const o = {
              name: d.name, category: d.category || "other", sku: d.sku,
              price: d.price ?? 0, cost_price: d.cost_price ?? 0,
              stock_quantity: storeId ? 0 : stock,
              low_stock_threshold: d.low_stock_threshold ?? 5,
              description: d.description || "", product_type: d.product_type || "",
              thc_percentage: d.thc_percentage || null, cbd_percentage: d.cbd_percentage || null,
              strain_type: d.strain_type || null, is_active: d.is_active,
              is_aging_stock: false, is_bundle: false, price_tiers: [],
              company_id: companyId, supplier_id: d.supplier_id || null,
            };
            if (d.barcode) o.barcode = d.barcode; // omit → DB auto-generates a unique code
            return o;
          });
          const { data: inserted, error } = await supabase.from("products").insert(payload).select("id, sku, name");
          if (error) {
            // Fall back to row-by-row so one bad row doesn't sink the whole batch.
            for (let k = 0; k < payload.length; k++) {
              const { data: one, error: e1 } = await supabase.from("products").insert(payload[k]).select("id").single();
              if (e1) { failed++; failures.push(`Line ${toCreate[k].line}: ${e1.message}`); }
              else { created++; if (storeId) inventory.push(invRow(one.id, toCreate[k].data)); }
            }
          } else {
            created += inserted.length;
            if (storeId) inserted.forEach((p, k) => inventory.push(invRow(p.id, toCreate[k].data)));
          }
        }

        // ── updates (only columns present in the file) ──
        for (const r of chunk.filter(x => x.action === "update")) {
          const d = r.data, has = d._has;
          const u = {};
          if (has.name && d.name) u.name = d.name;
          if (has.category && d.category) u.category = d.category;
          if (has.price && d.price !== null) u.price = d.price;
          if (has.cost_price && d.cost_price !== null) u.cost_price = d.cost_price;
          if (has.low_stock_threshold && d.low_stock_threshold !== null) u.low_stock_threshold = d.low_stock_threshold;
          if (has.description) u.description = d.description;
          if (has.product_type) u.product_type = d.product_type;
          if (has.strain_type) u.strain_type = d.strain_type;
          if (has.thc_percentage) u.thc_percentage = d.thc_percentage || null;
          if (has.cbd_percentage) u.cbd_percentage = d.cbd_percentage || null;
          if (has.supplier && d.supplier_id) u.supplier_id = d.supplier_id;
          if (has.is_active) u.is_active = d.is_active;
          if (has.barcode && d.barcode) u.barcode = d.barcode;
          if (has.stock_quantity && d.stock_quantity !== null && !storeId) u.stock_quantity = d.stock_quantity;
          if (Object.keys(u).length) {
            const { error } = await supabase.from("products").update(u).eq("id", r.existingId).eq("company_id", companyId);
            if (error) { failed++; failures.push(`Line ${r.line}: ${error.message}`); continue; }
          }
          updated++;
          if (storeId && has.stock_quantity && d.stock_quantity !== null) inventory.push(invRow(r.existingId, d));
        }

        if (inventory.length) {
          const { error } = await supabase.from("store_inventory").upsert(inventory, { onConflict: "product_id,store_id" });
          if (error) { failures.push(`Stock for lines ${chunk[0].line}–${chunk[chunk.length - 1].line}: ${error.message}`); }
        }
        done += chunk.length;
        setProgress(Math.round((done / good.length) * 100));
      }

      const parts = [];
      if (created) parts.push(`${created} created`);
      if (updated) parts.push(`${updated} updated`);
      if (failed) parts.push(`${failed} failed`);
      if (failed || failures.length) {
        toast.error(`Import finished: ${parts.join(", ")}. ${failures[0] || ""}`);
        console.error("[bulk import] failures", failures);
      } else {
        toast.success(`Import complete: ${parts.join(", ")}`);
      }
      await onDone();
      if (!failed && !failures.length) onClose();
    } catch (err) {
      toast.error(err?.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  function invRow(productId, d) {
    return {
      product_id: productId, store_id: storeId, company_id: companyId,
      stock_quantity: Math.max(0, d.stock_quantity ?? 0),
      low_stock_threshold: Math.max(0, d.low_stock_threshold ?? 5),
    };
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Bulk upload products</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-2">
            <p>
              1. Download the template (.xlsx or .csv) and fill in one product per row (open it in Excel or Google Sheets, save as <b>.xlsx</b> or <b>CSV</b>).<br />
              2. Upload it here, check the preview, then import.
            </p>
            <p className="text-xs text-muted-foreground">
              Required: <b>name</b> and <b>price</b>. Rows whose <b>sku</b> already exists are <b>updated</b> (only the columns in your file);
              everything else is created. Leave <b>barcode</b> blank to auto-generate. <b>is_active</b> accepts yes/no.
              Category and type that don't exist yet are added automatically. <b>supplier</b> must match an existing supplier name.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button type="button" variant="outline" size="sm" onClick={() => downloadTemplateXlsx().catch(() => toast.error("Couldn't build the template"))}>
                <Download className="h-4 w-4 mr-1" /> Template (.xlsx)
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-1" /> Template (.csv)
              </Button>
              <Button type="button" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload className="h-4 w-4 mr-1" /> {filename ? "Choose a different file" : "Upload file"}
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onFile} />
            </div>
            <p className="text-[11px] text-muted-foreground font-mono break-all">Columns: {TEMPLATE_COLUMNS.join(", ")}</p>
          </div>

          {stores.length > 0 && (
            <div className="space-y-1">
              <Label>Stock quantities go to</Label>
              <Select value={storeId || "__none__"} onValueChange={v => setStoreId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Select a store —</SelectItem>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {needsStore && <p className="text-xs text-amber-600">Your file has stock quantities — pick the store they belong to.</p>}
            </div>
          )}

          {result && result.missingColumns.length > 0 && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <span>Missing required column{result.missingColumns.length > 1 ? "s" : ""}: <b>{result.missingColumns.join(", ")}</b>. Use the template headers.</span>
            </div>
          )}

          {result && result.rows.length > 0 && (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-4 w-4" /> {creates} to create</span>
                <span className="flex items-center gap-1 text-blue-500"><CheckCircle2 className="h-4 w-4" /> {updates} to update</span>
                {bad.length > 0 && <span className="flex items-center gap-1 text-red-500"><AlertTriangle className="h-4 w-4" /> {bad.length} with errors (skipped)</span>}
              </div>

              <div className="border border-border rounded-lg overflow-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left">
                      <th className="p-2">Line</th><th className="p-2">Action</th><th className="p-2">Name</th>
                      <th className="p-2">SKU</th><th className="p-2 text-right">Price</th><th className="p-2 text-right">Stock</th>
                      <th className="p-2">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 300).map(r => (
                      <tr key={r.line} className={r.errors.length ? "bg-red-500/5" : ""}>
                        <td className="p-2 text-muted-foreground">{r.line}</td>
                        <td className="p-2">{r.errors.length ? "skip" : r.action}</td>
                        <td className="p-2">{r.data.name || "—"}</td>
                        <td className="p-2 font-mono">{r.data.sku || "—"}</td>
                        <td className="p-2 text-right">{r.data.price ?? "—"}</td>
                        <td className="p-2 text-right">{r.data.stock_quantity ?? "—"}</td>
                        <td className="p-2">
                          {r.errors.map((e, i) => <div key={i} className="text-red-500">{e}</div>)}
                          {r.warnings.map((w, i) => <div key={i} className="text-amber-600">{w}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.rows.length > 300 && <p className="p-2 text-xs text-muted-foreground">Showing first 300 of {result.rows.length} rows.</p>}
              </div>
            </>
          )}

          {result && result.missingColumns.length === 0 && result.rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No product rows found in that file.</p>
          )}

          {busy && (
            <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: progress + "%" }} /></div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={runImport} disabled={busy || !good.length || needsStore}>
              {busy ? `Importing… ${progress}%` : good.length ? `Import ${good.length} product${good.length > 1 ? "s" : ""}` : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
