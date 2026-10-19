// src/pages/PrintLabels.jsx
// Pick products, choose how many labels of each, then generate a print-ready PDF.
//
// Why a PDF instead of window.print():
//   Cheap thermal printers (Munbyn / Xprinter / 4BARCODE) on macOS ignore CSS @page
//   sizing, so browser printing scales/overlaps labels. A PDF sized to the exact label
//   dimensions can't be rescaled — it prints 1:1 at 100% scale. Reliable.
//
// Each label is composited on an offscreen <canvas> (name + barcode + price all
// drawn together) and then dropped into the PDF as a single image. Earlier this
// rotated the barcode image and the jsPDF text separately (doc.text(..., {angle:180}))
// — jsPDF's text positioning math for angle + align:"center" + baseline:"top" drifts,
// which is why product names were sliding sideways into the neighbouring label on the
// A4 sheet. Compositing everything on a canvas first means centering/truncation use
// the canvas's own (accurate) text metrics, and "rotate 180" is just one canvas
// rotation of the whole finished label — no more per-element rotation math to get wrong.
//
// Rotate 180°:
//   Thermal rolls feed in a fixed direction, so labels can come out upside-down.
//   The toggle rotates the whole label (barcode + name + price) as one image,
//   so you never have to reload the roll the other way. Default on.
//
// Requires: npm install jsbarcode jspdf
//
// Route to register in your router:
//   <Route path="/print-labels" element={<PrintLabels />} />

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";
import { Button } from "@/components/ui/button";
import { Search, Printer, Download, Barcode as BarcodeIcon } from "lucide-react";

// Label size presets. perPage 1 = one thermal label per page; A4 = grid of stickers.
// bc = barcode render options; showName drops the product name on tiny labels.
const PRESETS = {
  thermal_40x16: {
    label: "Thermal 40 × 16 mm",
    w: 40, h: 16, perPage: 1,
    showName: false,
    // no digits under the barcode (they smear first); wide bars survive heat
    bc: { width: 4, height: 60, fontSize: 12, digits: false, margin: 8 },
  },
  thermal_50x30: {
    label: "Thermal 50 × 30 mm",
    w: 50, h: 30, perPage: 1,
    showName: true,
    bc: { width: 1.8, height: 60, fontSize: 16 },
  },
  thermal_58x40: {
    label: "Thermal 58 × 40 mm",
    w: 58, h: 40, perPage: 1,
    showName: true,
    bc: { width: 2, height: 70, fontSize: 18 },
  },
  thermal_80x62: {
    label: "Thermal 80 × 62 mm (Xprinter)",
    w: 80, h: 62, perPage: 1,
    showName: true,
    bc: { width: 2.6, height: 90, fontSize: 22 },
  },
  a4_sheet: {
    label: "A4 sticker sheet (3-up)",
    w: 63, h: 30, perPage: 24,
    showName: true,
    bc: { width: 1.8, height: 60, fontSize: 16 },
  },
};

// px-per-mm used to rasterise each label. 12 ≈ 300dpi at these label sizes —
// sharp on a sticker sheet without producing huge PDF images.
const SCALE = 12;

// ---- Render a barcode to an offscreen canvas (not yet flipped — the whole
// label gets flipped once, as a unit, at the end of buildLabelCanvas). ----
function makeBarcodeCanvas(value, opts) {
  if (!value) return null;
  const canvas = document.createElement("canvas");
  const showDigits = opts.digits !== false;
  try {
    JsBarcode(canvas, String(value), {
      format: "CODE128", // auto-optimises to Code C for digit pairs
      width: opts.width,
      height: opts.height,
      fontSize: opts.fontSize,
      margin: opts.margin != null ? opts.margin : 6, // quiet zone
      displayValue: showDigits,
      textMargin: 2,
      background: "#ffffff",
      lineColor: "#000000",
    });
    return canvas;
  } catch (e) {
    return null; // invalid barcode value for CODE128
  }
}

// Truncate text to fit maxW px at the canvas ctx's current font, adding an ellipsis.
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

// Compose one label (name + barcode + price) onto a single canvas at SCALE px/mm,
// centred, then rotate the whole thing 180° if needed. Returns a PNG data URL.
function buildLabelCanvas(p, size, flip) {
  const small = size.perPage === 1 && size.h <= 16;
  const padMm = small ? 0.8 : 1.5;

  const wPx = Math.round(size.w * SCALE);
  const hPx = Math.round(size.h * SCALE);
  const padPx = padMm * SCALE;
  const innerW = wPx - padPx * 2;

  const canvas = document.createElement("canvas");
  canvas.width = wPx;
  canvas.height = hPx;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, wPx, hPx);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";

  let top = padPx;

  // Name (optional)
  if (size.showName && p.name) {
    const fontPx = Math.round((small ? 5 : 7) * SCALE * 0.6);
    ctx.font = `bold ${fontPx}px Helvetica, Arial, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(fitText(ctx, p.name, innerW), wPx / 2, top);
    top += fontPx * 1.5;
  }

  // Reserve space for price at the bottom
  const priceFontPx = Math.round((small ? 7 : 9) * SCALE * 0.6);
  const priceH = p.price != null ? priceFontPx * 1.6 : 0;
  const bcTop = top;
  const bcBottom = hPx - padPx - priceH;
  const bcH = Math.max(padPx * 3, bcBottom - bcTop);

  // Barcode, centred in its reserved area
  const bcCanvas = makeBarcodeCanvas(p.barcode, size.bc);
  if (bcCanvas) {
    const aspect = bcCanvas.width / bcCanvas.height;
    let imgW, imgH;
    if (small) {
      // Fill the whole barcode area: widest possible bars + full height.
      imgW = innerW;
      imgH = bcH;
    } else {
      imgW = innerW;
      imgH = imgW / aspect;
      if (imgH > bcH) { imgH = bcH; imgW = imgH * aspect; }
    }
    const imgX = (wPx - imgW) / 2;
    const imgY = bcTop + (bcH - imgH) / 2;
    ctx.drawImage(bcCanvas, imgX, imgY, imgW, imgH);
  } else {
    const fontPx = Math.round(6 * SCALE * 0.6);
    ctx.font = `${fontPx}px Helvetica, Arial, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.barcode || "no barcode"), wPx / 2, bcTop + bcH / 2);
  }

  // Price
  if (p.price != null) {
    ctx.font = `bold ${priceFontPx}px Helvetica, Arial, sans-serif`;
    ctx.textBaseline = "bottom";
    const str = "R" + Number(p.price).toFixed(2) + (p.unit_weight ? " / " + p.unit_weight : "");
    ctx.fillText(str, wPx / 2, hPx - padPx);
  }

  if (!flip) return canvas.toDataURL("image/png");

  // Rotate the finished label 180° as a single unit — no per-element rotation math.
  const flipped = document.createElement("canvas");
  flipped.width = wPx;
  flipped.height = hPx;
  const fctx = flipped.getContext("2d");
  fctx.translate(wPx, hPx);
  fctx.rotate(Math.PI);
  fctx.drawImage(canvas, 0, 0);
  return flipped.toDataURL("image/png");
}

function buildPdf(labels, size, flip) {
  if (size.perPage === 1) {
    // One label per page, sized exactly to the label.
    const orientation = size.w >= size.h ? "l" : "p";
    const doc = new jsPDF({ unit: "mm", orientation, format: [size.w, size.h] });
    labels.forEach((p, i) => {
      if (i > 0) doc.addPage([size.w, size.h], orientation);
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const dataUrl = buildLabelCanvas(p, size, flip);
      doc.addImage(dataUrl, "PNG", 0, 0, pw, ph);
    });
    return doc;
  }

  // A4 grid of stickers.
  const doc = new jsPDF({ unit: "mm", orientation: "p", format: "a4" });
  const pageW = 210, pageH = 297, margin = 8, gap = 2;
  const cols = Math.max(1, Math.floor((pageW - 2 * margin + gap) / (size.w + gap)));
  const rows = Math.max(1, Math.floor((pageH - 2 * margin + gap) / (size.h + gap)));
  const perPage = cols * rows;

  labels.forEach((p, i) => {
    const slot = i % perPage;
    if (i > 0 && slot === 0) doc.addPage();
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = margin + col * (size.w + gap);
    const y = margin + row * (size.h + gap);
    const dataUrl = buildLabelCanvas(p, size, flip);
    doc.addImage(dataUrl, "PNG", x, y, size.w, size.h);
  });
  return doc;
}

export default function PrintLabels() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState({});          // { productId: number }
  const [preset, setPreset] = useState("thermal_80x62");
  const [flip, setFlip] = useState(true);      // rotate 180° to match roll feed
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    (async () => {
      // is_active = true + RLS company scoping means this only ever returns the
      // logged-in club's own active products — no inactive/discontinued items,
      // and never another club's products.
      const { data, error } = await supabase
        .from("products")
        .select("id, name, barcode, price, unit_weight, category")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (error) console.error("Failed to load products:", error);
      else setProducts(data || []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.barcode || "").includes(q) ||
        (p.category || "").toLowerCase().includes(q)
    );
  }, [products, search]);

  function setQuantity(id, value) {
    const n = Math.max(0, parseInt(value, 10) || 0);
    setQty((prev) => ({ ...prev, [id]: n }));
  }

  const labels = useMemo(() => {
    const out = [];
    for (const p of products) {
      const n = qty[p.id] || 0;
      for (let i = 0; i < n; i++) out.push(p);
    }
    return out;
  }, [products, qty]);

  const totalLabels = labels.length;
  const size = PRESETS[preset];

  // mode: "open" -> new tab (Cmd+P from there);  "download" -> save file (open in Preview)
  function handleGenerate(mode) {
    if (totalLabels === 0) return;
    setBuilding(true);
    // Let the button state paint before the (synchronous) PDF build.
    setTimeout(() => {
      try {
        const doc = buildPdf(labels, size, flip);
        if (mode === "download") {
          doc.save(`labels-${preset}-${totalLabels}.pdf`);
        } else {
          const url = URL.createObjectURL(doc.output("blob"));
          window.open(url, "_blank");
        }
      } catch (e) {
        console.error("PDF build failed:", e);
        alert("Could not build the label PDF. Check the console for details.");
      } finally {
        setBuilding(false);
      }
    }, 30);
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center gap-2 mb-1">
        <BarcodeIcon className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold">Print Barcode Labels</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Set a quantity next to each product, pick your label size, then generate the PDF.
        Print it at <span className="font-medium">100% scale</span> (no "fit to page").
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products, category or barcode…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </div>

        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          {Object.entries(PRESETS).map(([key, v]) => (
            <option key={key} value={key}>{v.label}</option>
          ))}
        </select>

        <label
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm cursor-pointer select-none whitespace-nowrap"
          title="Flip the label 180° so it comes off the roll the right way up"
        >
          <input
            type="checkbox"
            checked={flip}
            onChange={(e) => setFlip(e.target.checked)}
            className="accent-primary"
          />
          Rotate 180°
        </label>

        <Button onClick={() => handleGenerate("open")} disabled={totalLabels === 0 || building}>
          <Printer className="w-4 h-4 mr-2" />
          {building ? "Building…" : `Open PDF${totalLabels > 0 ? ` (${totalLabels})` : ""}`}
        </Button>

        <Button
          variant="outline"
          onClick={() => handleGenerate("download")}
          disabled={totalLabels === 0 || building}
          title="Download the PDF, then open it in Preview to print at 100% scale"
        >
          <Download className="w-4 h-4 mr-2" />
          Download
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading products…</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {filtered.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.barcode} · {p.category || "—"}
                  {p.price != null ? ` · R${Number(p.price).toFixed(2)}` : ""}
                </p>
              </div>
              <input
                type="number"
                min="0"
                value={qty[p.id] || ""}
                onChange={(e) => setQuantity(p.id, e.target.value)}
                placeholder="0"
                className="w-20 px-2 py-1 rounded-md border border-border bg-background text-sm text-center"
              />
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground px-3 py-4">No products match.</p>
          )}
        </div>
      )}
    </div>
  );
}
