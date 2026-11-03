// src/lib/receiptPdf.js
// Slips for 80mm thermal rolls (HPRT TP80x etc).
// Same idea as PrintLabels.jsx: composite on a canvas, drop into a PDF whose page is
// exactly 80mm wide x content height. Prints 1:1 (no browser scaling, no blank tail).
//
//   openReceiptPdf({ lines, logo })     -> opens PDF in a new tab (print at 100%)
//   downloadReceiptPdf({ lines }, name) -> saves the file
//
// lines = array of:
//   { t: "center", text, size: "big"|"body", bold }
//   { t: "row", left, right, size, bold }       // right-aligned value, left wraps
//   { t: "text", text, bold }                   // left aligned, wraps
//   { t: "rule" }                               // dashed divider
//   { t: "gap" }

import { jsPDF } from "jspdf";

const PAGE_W_MM = 80;
const MARGIN_MM = 4; // 72mm printable
const SCALE = 8;     // px per mm = 203dpi, the native resolution of HPRT TP80x heads (no driver resampling)
const FONT = "Helvetica, Arial, sans-serif";

// 76mm DOT-MATRIX (impact) printers such as the Xprinter XP-76C. They are not 203dpi thermal heads:
// the driver offers 160x72 / 160x144 dpi, 63.5mm printable. Resampling a 203dpi slip onto that grid
// produces doubled, squashed lines. In this mode the slip is drawn on the printer's own grid
// (160 dpi across, 72 dpi down), binarised, and printed 1:1. Opt-in per device:
//   localStorage.setItem("receipt_printer_mode", "dotmatrix76")   (clear it to go back to normal)
const DM_PAGE_W_MM = 63.5;
const DM_MARGIN_MM = 0.5;
const DM_DPI_X = 160;
const DM_DPI_Y = 72;
const DM_SCALE = DM_DPI_X / 25.4; // px per mm while laying out (square pixels), squashed vertically at the end

// Per-device receipt mode: "dotmatrix76" (76mm impact printers) or "thermal72" (80mm-paper thermal printers whose
// driver only prints 72mm, e.g. XP-80C "80(72.1) x 297 mm": build the slip at exactly 72mm so Chrome/the driver
// never rescale it). Set once by opening the POS with ?receipt=thermal72 (or ?receipt=off to clear).
function getReceiptMode() {
  try {
    const q = new URLSearchParams(window.location.search).get("receipt");
    if (q === "off") localStorage.removeItem("receipt_printer_mode");
    else if (q === "thermal72" || q === "dotmatrix76") localStorage.setItem("receipt_printer_mode", q);
    return localStorage.getItem("receipt_printer_mode");
  } catch (e) { return null; }
}
export function isDotMatrixMode() { return getReceiptMode() === "dotmatrix76"; }
const T72_PAGE_W_MM = 72;
const T72_MARGIN_MM = 1;

function wrap(ctx, text, maxW) {
  const words = String(text == null ? "" : text).split(/\s+/);
  const out = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

function loadImage(src) {
  return new Promise((res) => {
    if (!src) return res(null);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

async function renderCanvas(spec, dm, bw, t72) {
  const S = dm ? DM_SCALE : SCALE;
  const pageW = dm ? DM_PAGE_W_MM : (t72 ? T72_PAGE_W_MM : PAGE_W_MM);
  const margin = dm ? DM_MARGIN_MM : (t72 ? T72_MARGIN_MM : MARGIN_MM);
  const wPx = Math.round(pageW * S);
  const padPx = margin * S;
  const innerW = wPx - padPx * 2;
  const body = Math.round(3.6 * S); // ~10pt
  const big = Math.round(4.6 * S);
  const lh = (px) => Math.round(px * 1.35);

  const tall = document.createElement("canvas");
  tall.width = wPx;
  tall.height = 600 * S; // 600mm scratch height; cropped below
  const ctx = tall.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, tall.width, tall.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  let y = padPx;

  const logo = await loadImage(spec.logo);
  if (logo) {
    const lw = Math.min(innerW * 0.7, logo.width);
    const lhh = lw * (logo.height / logo.width);
    ctx.drawImage(logo, (wPx - lw) / 2, y, lw, lhh);
    y += lhh + S;
  }

  const textTop = Math.ceil(y);

  for (const ln of spec.lines || []) {
    const px = ln.size === "big" ? big : body;
    const font = (bold) => `${bold ? "bold " : ""}${px}px ${FONT}`;

    if (ln.t === "gap") { y += S; continue; }

    if (ln.t === "rule") {
      y += S * 0.5;
      const dash = S * 0.9;
      for (let x = padPx; x < wPx - padPx; x += dash * 2) {
        ctx.fillRect(x, y, Math.min(dash, wPx - padPx - x), Math.max(2, S * 0.15));
      }
      y += S * 1.1;
      continue;
    }

    if (ln.t === "center") {
      ctx.font = font(ln.bold != null ? !!ln.bold : ln.size === "big");
      ctx.textAlign = "center";
      for (const l of wrap(ctx, ln.text, innerW)) { ctx.fillText(l, wPx / 2, y); y += lh(px); }
      continue;
    }

    if (ln.t === "text") {
      ctx.font = font(!!ln.bold);
      ctx.textAlign = "left";
      for (const l of wrap(ctx, ln.text, innerW)) { ctx.fillText(l, padPx, y); y += lh(px); }
      continue;
    }

    if (ln.t === "row") {
      ctx.font = font(!!ln.bold);
      const right = String(ln.right == null ? "" : ln.right);
      const rightW = ctx.measureText(right).width;
      const lines = wrap(ctx, ln.left, Math.max(innerW - rightW - S, innerW * 0.4));
      lines.forEach((l, i) => {
        ctx.textAlign = "left";
        ctx.fillText(l, padPx, y);
        if (i === 0) { ctx.textAlign = "right"; ctx.fillText(right, wPx - padPx, y); }
        y += lh(px);
      });
    }
  }

  y += padPx * 1.5; // tail so the cutter does not clip the last line

  const layoutH = Math.ceil(y);
  const out = document.createElement("canvas");
  out.width = wPx;
  if (!dm) {
    out.height = layoutH;
    const c2 = out.getContext("2d");
    c2.drawImage(tall, 0, 0, wPx, layoutH, 0, 0, wPx, layoutH);
    if (bw && layoutH > textTop) {
      // Thermal heads are 1-bit. Grey anti-aliased text gets dithered into scattered dots by some
      // Windows drivers (eroded, speckled slips), so force pure black/white below the logo.
      const id = c2.getImageData(0, textTop, wPx, layoutH - textTop);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = id.data[i] * 0.3 + id.data[i + 1] * 0.59 + id.data[i + 2] * 0.11 < 200 ? 0 : 255;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = 255;
      }
      c2.putImageData(id, 0, textTop);
    }
    return out;
  }
  // Dot-matrix: squash vertically to the printer's 72 dpi row pitch, then force pure black/white
  out.height = Math.max(1, Math.round(layoutH * (DM_DPI_Y / DM_DPI_X)));
  const octx = out.getContext("2d");
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, out.width, out.height);
  octx.imageSmoothingEnabled = true;
  octx.drawImage(tall, 0, 0, wPx, layoutH, 0, 0, wPx, out.height);
  const id = octx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = id.data[i] * 0.3 + id.data[i + 1] * 0.59 + id.data[i + 2] * 0.11 < 215 ? 0 : 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  octx.putImageData(id, 0, 0);
  out._hMm = layoutH / S; // real printed height in mm
  return out;
}

export async function buildReceiptPdf(spec) {
  const canvas = await renderCanvas(spec);
  const hMm = canvas.height / SCALE;
  // jsPDF swaps width/height to force the chosen orientation. A short slip (height < 80mm)
  // in "portrait" therefore came out only ~75mm wide and clipped the right edge, so the
  // orientation must follow the real shape (same rule PrintLabels.jsx uses).
  const orientation = PAGE_W_MM >= hMm ? "l" : "p";
  const doc = new jsPDF({ unit: "mm", orientation, format: [PAGE_W_MM, hMm] });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pw, ph);
  return doc;
}

// Direct print: no new tab, no PDF viewer. Renders the slip as one image in a hidden
// iframe sized exactly 80mm x content height and calls print(). With Chrome started
// using --kiosk-printing and the HPRT set as the Windows default printer, this prints
// straight to the printer with no dialog.
export async function printReceipt(spec) {
  const mode = getReceiptMode();
  const dm = mode === "dotmatrix76";
  const t72 = mode === "thermal72";
  const canvas = await renderCanvas(spec, dm, true, t72);
  const src = canvas.toDataURL("image/png");
  const wMm = dm ? DM_PAGE_W_MM : (t72 ? T72_PAGE_W_MM : PAGE_W_MM);
  const imgH = dm ? "height:" + canvas._hMm.toFixed(2) + "mm" : "height:auto";

  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(
      '<!doctype html><html><head><meta charset="utf-8"><style>' +
      "@page{margin:0}" +
      "html,body{margin:0;padding:0;width:" + wMm + "mm;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      "img{display:block;width:" + wMm + "mm;" + imgH + (dm ? ";image-rendering:pixelated" : "") + "}" +
      '</style></head><body><img id="slip" src="' + src + '"></body></html>'
    );
    doc.close();

    const img = doc.getElementById("slip");
    const go = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        resolve();
      } catch (e) {
        reject(e);
      }
      setTimeout(() => iframe.remove(), 60000);
    };
    if (img.complete) go();
    else {
      img.onload = go;
      img.onerror = () => reject(new Error("Slip image failed to load"));
    }
  });
}

export async function openReceiptPdf(spec) {
  // Open the tab synchronously so popup blockers allow it, then point it at the PDF.
  const win = window.open("", "_blank");
  try {
    const doc = await buildReceiptPdf(spec);
    const url = URL.createObjectURL(doc.output("blob"));
    if (win) win.location.href = url;
    else window.open(url, "_blank");
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

export async function downloadReceiptPdf(spec, name) {
  const doc = await buildReceiptPdf(spec);
  doc.save((name || "receipt") + ".pdf");
}
