// Bulk product import — CSV template, parser and row validation.
// Pure functions (no React / Supabase) so the rules live in one place.

export const TEMPLATE_COLUMNS = [
  "name", "category", "sku", "barcode", "price", "cost_price",
  "stock_quantity", "low_stock_threshold", "product_type", "strain_type",
  "thc_percentage", "cbd_percentage", "supplier", "description", "is_active",
];

const TEMPLATE_EXAMPLES = [
  ["Blue Dream 3.5g", "flower", "FLW-001", "", "120", "60", "25", "5", "Indoor", "hybrid", "22", "0.5", "", "Sweet berry aroma", "yes"],
  ["Gummy Bears 10pk", "edibles", "EDB-001", "", "150", "80", "40", "10", "Edibles", "", "", "", "", "", "yes"],
];

const STRAINS = ["indica", "sativa", "hybrid", "cbd"];

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildTemplateCsv() {
  const rows = [TEMPLATE_COLUMNS, ...TEMPLATE_EXAMPLES];
  return rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadTemplate() {
  // BOM so Excel opens it as UTF-8.
  const blob = new Blob(["﻿" + buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "product-import-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadTemplateXlsx() {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const header = TEMPLATE_COLUMNS.map(h => ({ value: h, fontWeight: "bold" }));
  const numCols = new Set(["price", "cost_price", "stock_quantity", "low_stock_threshold", "thc_percentage", "cbd_percentage"]);
  const body = TEMPLATE_EXAMPLES.map(r => r.map((v, i) =>
    numCols.has(TEMPLATE_COLUMNS[i]) && v !== "" ? Number(v) : (v === "" ? null : String(v))));
  await writeExcelFile([header, ...body], { columns: TEMPLATE_COLUMNS.map(() => ({ width: 18 })) })
    .toFile("product-import-template.xlsx");
}

/** Read the first sheet of an .xlsx file into string arrays (same shape as parseCsv). */
export async function parseXlsx(file) {
  const { readSheet } = await import("read-excel-file/browser");
  const data = await readSheet(file);
  const rows = (data || []).map(r => (r || []).map(c => {
    if (c === null || c === undefined) return "";
    if (c instanceof Date) return c.toISOString().slice(0, 10);
    if (typeof c === "boolean") return c ? "yes" : "no";
    return String(c);
  }));
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

/** Parse CSV text into an array of string arrays. Handles quotes, CRLF, BOM,
 *  and comma / semicolon / tab delimiters (Excel in South Africa often saves ';'). */
export function parseCsv(text) {
  text = String(text || "").replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

const norm = s => String(s || "").trim().toLowerCase().replace(/[\s\-]+/g, "_");

const HEADER_ALIASES = {
  name: ["name", "product", "product_name"],
  category: ["category"],
  sku: ["sku", "code", "product_code"],
  barcode: ["barcode", "ean", "upc"],
  price: ["price", "selling_price", "sell_price", "retail_price"],
  cost_price: ["cost_price", "cost", "buy_price"],
  stock_quantity: ["stock_quantity", "stock", "qty", "quantity", "opening_stock"],
  low_stock_threshold: ["low_stock_threshold", "low_stock", "reorder_level", "min_stock"],
  product_type: ["product_type", "type"],
  strain_type: ["strain_type", "strain"],
  thc_percentage: ["thc_percentage", "thc", "thc_%"],
  cbd_percentage: ["cbd_percentage", "cbd", "cbd_%"],
  supplier: ["supplier", "supplier_name"],
  description: ["description", "notes"],
  is_active: ["is_active", "active"],
};

function parseNum(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  // strip currency symbols/spaces, allow comma decimal
  let s = String(v).trim().replace(/[Rr$\s]/g, "");
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseBool(v, dflt = true) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return dflt;
  if (["yes", "y", "true", "1", "active"].includes(s)) return true;
  if (["no", "n", "false", "0", "inactive"].includes(s)) return false;
  return dflt;
}

/**
 * Turn raw CSV rows into validated product rows.
 * ctx: { existingBySku: Map(lowerSku -> product), suppliers: [{id,name}] }
 * Returns { rows: [{line, data, errors, warnings, action}], missingColumns }
 */
export function validateRows(rawRows, ctx) {
  if (!rawRows.length) return { rows: [], missingColumns: ["name", "category", "price"] };
  const headers = rawRows[0].map(norm);
  const idx = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = headers.findIndex(h => aliases.includes(h));
    if (i !== -1) idx[key] = i;
  }
  const missingColumns = ["name", "price"].filter(k => idx[k] === undefined);
  if (missingColumns.length) return { rows: [], missingColumns };

  const get = (r, k) => (idx[k] === undefined ? "" : String(r[idx[k]] ?? "").trim());
  const supplierByName = new Map((ctx.suppliers || []).map(s => [norm(s.name), s.id]));
  const seenSkus = new Set();
  const out = [];

  for (let n = 1; n < rawRows.length; n++) {
    const r = rawRows[n];
    const errors = [], warnings = [];
    const name = get(r, "name");
    const sku = get(r, "sku");
    const existing = sku ? ctx.existingBySku.get(sku.toLowerCase()) : null;

    if (!name && !existing) errors.push("Name is required");

    const price = parseNum(get(r, "price"));
    if (price === null) { if (!existing) errors.push("Price is required"); }
    else if (Number.isNaN(price) || price < 0) errors.push("Price must be a number ≥ 0");

    const cost = parseNum(get(r, "cost_price"));
    if (Number.isNaN(cost) || (cost !== null && cost < 0)) errors.push("Cost price must be a number ≥ 0");

    const stock = parseNum(get(r, "stock_quantity"));
    if (Number.isNaN(stock) || (stock !== null && stock < 0)) errors.push("Stock must be a number ≥ 0");

    const low = parseNum(get(r, "low_stock_threshold"));
    if (Number.isNaN(low) || (low !== null && low < 0)) errors.push("Low-stock threshold must be a number ≥ 0");

    const thc = parseNum(get(r, "thc_percentage"));
    const cbd = parseNum(get(r, "cbd_percentage"));
    if (Number.isNaN(thc)) errors.push("THC must be a number");
    if (Number.isNaN(cbd)) errors.push("CBD must be a number");

    let strain = get(r, "strain_type").toLowerCase();
    if (strain && !STRAINS.includes(strain)) { warnings.push(`Strain "${strain}" is not indica/sativa/hybrid/cbd — kept as typed`); }

    if (sku) {
      const k = sku.toLowerCase();
      if (seenSkus.has(k)) errors.push(`Duplicate SKU "${sku}" in this file`);
      seenSkus.add(k);
    }

    let supplier_id = null;
    const supplierName = get(r, "supplier");
    if (supplierName) {
      supplier_id = supplierByName.get(norm(supplierName)) || null;
      if (!supplier_id) warnings.push(`Supplier "${supplierName}" not found — left blank`);
    }

    const category = norm(get(r, "category")) || (existing ? existing.category : "other");

    out.push({
      line: n + 1,
      action: existing ? "update" : "create",
      existingId: existing ? existing.id : null,
      errors, warnings,
      data: {
        name, category, sku: sku || null,
        barcode: get(r, "barcode"),
        price, cost_price: cost, stock_quantity: stock, low_stock_threshold: low,
        product_type: get(r, "product_type"),
        strain_type: strain || null,
        thc_percentage: thc, cbd_percentage: cbd,
        supplier_id,
        description: get(r, "description"),
        is_active: parseBool(get(r, "is_active"), true),
        _has: Object.fromEntries(Object.keys(idx).map(k => [k, true])),
      },
    });
  }
  return { rows: out, missingColumns: [] };
}
