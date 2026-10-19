import { jsPDF } from "jspdf";

// jsPDF's built-in fonts (helvetica/times/courier) only support WinAnsi
// encoding — roughly Latin-1. Characters outside that (arrows, curly quotes,
// bullets) render as garbled glyphs instead of throwing, so they slip through
// silently until someone spots it in a printed report. Replace the common
// offenders with WinAnsi-safe equivalents before anything reaches doc.text().
function sanitizeForPdf(value) {
  if (value == null) return value;
  return String(value)
    .replace(/[\u2192\u21D2\u27A1]/g, "-")   // →, ⇒, ➡
    .replace(/[\u2190\u21D0]/g, "-")          // ←, ⇐
    .replace(/[\u2018\u2019]/g, "'")          // ‘ ’
    .replace(/[\u201C\u201D]/g, '"')          // “ ”
    .replace(/[\u2022\u2023]/g, "-")          // • ‣
    .replace(/\u2026/g, "...");               // …
}

// Strain display helper — matches Inventory.jsx and InventoryAnalytics.jsx so a
// product reads the same in the PDF as it does on screen and in the CSV.
function formatStrain(value) {
  if (!value) return "—";
  const v = String(value).trim();
  if (!v) return "—";
  if (v.toLowerCase() === "cbd") return "CBD";
  if (v.toLowerCase() === "n/a") return "N/A";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

function formatCategory(value) {
  if (!value) return "—";
  return String(value).replace(/_/g, " ");
}

function addHeader(doc, title, subtitle) {
  doc.setFillColor(20, 20, 20);
  doc.rect(0, 0, 210, 28, "F");
  doc.setTextColor(80, 200, 120);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Cannalife Co", 14, 12);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.text(sanitizeForPdf(title), 14, 21);
  doc.setTextColor(150, 150, 150);
  doc.setFontSize(9);
  doc.text(sanitizeForPdf(subtitle), 14, 26.5);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 196, 26.5, { align: "right" });
  return 36;
}

function addSectionTitle(doc, text, y) {
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(80, 200, 120);
  doc.text(text.toUpperCase(), 14, y);
  doc.setDrawColor(80, 200, 120);
  doc.setLineWidth(0.3);
  doc.line(14, y + 1.5, 196, y + 1.5);
  return y + 7;
}

function addTable(doc, headers, rows, y, colWidths) {
  const rowH = 7;
  const pageH = 285;

  // Header row
  doc.setFillColor(30, 30, 30);
  doc.rect(14, y - 5, 182, 7, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(200, 200, 200);
  let x = 16;
  headers.forEach((h, i) => {
    doc.text(sanitizeForPdf(h), x, y);
    x += colWidths[i];
  });
  // Every data row's shading rect spans from (its own y - 4) to (+3), 7mm
  // tall — that's what makes consecutive rows tile without gaps. The header
  // rect uses a different offset (y - 5, also 7mm tall), so its bottom edge
  // sits at header_y + 2. For row 0's rect to start exactly there instead of
  // cutting into the header, row 0's y needs to be header_y + 6, not + 3 —
  // the old value left row 0's rect starting 3mm too early, painting over
  // the bottom two-thirds of the header text.
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(220, 220, 220);

  rows.forEach((row, ri) => {
    if (y > pageH) {
      doc.addPage();
      // New page inherits the dark background, otherwise light text lands on white.
      doc.setFillColor(10, 10, 10);
      doc.rect(0, 0, 210, 297, "F");
      doc.setFont("helvetica", "normal");
      doc.setTextColor(220, 220, 220);
      y = 20;
    }
    if (ri % 2 === 0) {
      doc.setFillColor(18, 18, 18);
      doc.rect(14, y - 4, 182, rowH, "F");
    }
    x = 16;
    row.forEach((cell, i) => {
      doc.text(sanitizeForPdf(cell ?? "-"), x, y);
      x += colWidths[i];
    });
    y += rowH;
  });

  return y + 4;
}

function addKpiRow(doc, kpis, y) {
  const w = 182 / kpis.length;
  kpis.forEach((k, i) => {
    const rx = 14 + i * w;
    doc.setFillColor(25, 25, 25);
    doc.rect(rx, y, w - 2, 16, "F");
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(140, 140, 140);
    doc.text(k.label, rx + 3, y + 6);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(k.value, rx + 3, y + 13);
  });
  return y + 22;
}

export function exportReportsPDF({ periodLabel, totalRevenue, totalExpenses, netProfit, totalOrders, avgOrder, topProducts, paymentBreakdown, chartData }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, 210, 297, "F");

  let y = addHeader(doc, "Sales & Financial Report", periodLabel);

  y = addSectionTitle(doc, "Key Performance Indicators", y);
  y = addKpiRow(doc, [
    { label: "Revenue", value: `${totalRevenue.toFixed(2)}` },
    { label: "Expenses", value: `${totalExpenses.toFixed(2)}` },
    { label: "Net Profit", value: `${netProfit.toFixed(2)}` },
    { label: "Orders", value: String(totalOrders) },
    { label: "Avg Order", value: `${avgOrder.toFixed(2)}` },
  ], y);

  y += 4;
  y = addSectionTitle(doc, "Revenue & Expense Summary", y);
  y = addTable(doc,
    ["Period", "Revenue", "Expenses", "Orders"],
    // No cap here — the KPI totals above cover the whole period, so the table
    // has to as well or the two silently disagree (e.g. a 26-day range only
    // showing its last 20 rows while "Revenue" still totals all 26 days).
    // addTable already paginates onto new pages when it runs out of room.
    chartData.map(d => [d.name, d.revenue.toFixed(2), d.expenses.toFixed(2), d.orders]),
    y, [50, 45, 45, 40]
  );

  y += 4;
  y = addSectionTitle(doc, "Top Products by Revenue", y);
  y = addTable(doc,
    ["Product", "Units Sold", "Revenue"],
    topProducts.map(p => [p.name?.slice(0, 35), p.qty, p.revenue.toFixed(2)]),
    y, [100, 40, 40]
  );

  y += 4;
  y = addSectionTitle(doc, "Payment Method Breakdown", y);
  y = addTable(doc,
    ["Method", "Revenue"],
    Object.entries(paymentBreakdown).sort((a, b) => b[1] - a[1]).map(([m, v]) => [m, v.toFixed(2)]),
    y, [100, 80]
  );

  doc.save(`cannalife-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function exportInventoryPDF({ products, lowStock, agingStock, topSellers }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, 210, 297, "F");

  let y = addHeader(doc, "Inventory Analytics Report", `Generated on ${new Date().toLocaleDateString()}`);

  // How many products carry a strain type — surfaces the tagging gap on the
  // report itself, so a club can see what still needs classifying.
  const list = products || [];
  const tagged = list.filter(p => p.strain_type && String(p.strain_type).trim()).length;

  y = addSectionTitle(doc, "Summary", y);
  y = addKpiRow(doc, [
    { label: "Total Products", value: String(list.length) },
    { label: "Strain Tagged", value: `${tagged}/${list.length}` },
    { label: "Low Stock", value: String(lowStock.length) },
    { label: "Aging Stock", value: String(agingStock.length) },
    { label: "Top Seller", value: topSellers[0]?.name?.slice(0, 14) || "—" },
  ], y);

  // Units and revenue grouped by strain type, built from the top sellers we were
  // handed (the only rows carrying sales figures).
  const byStrain = {};
  (topSellers || []).forEach(p => {
    const label = formatStrain(p.strain_type);
    if (!byStrain[label]) byStrain[label] = { label, sold: 0, revenue: 0 };
    byStrain[label].sold += p.sold || 0;
    byStrain[label].revenue += p.revenue || 0;
  });
  const strainRows = Object.keys(byStrain)
    .map(k => byStrain[k])
    .filter(r => r.sold > 0)
    .sort((a, b) => b.sold - a.sold);

  if (strainRows.length > 0) {
    y += 4;
    y = addSectionTitle(doc, "Sales by Strain Type", y);
    y = addTable(doc,
      ["Strain Type", "Units Sold", "Revenue"],
      strainRows.map(r => [r.label, r.sold, r.revenue.toFixed(2)]),
      y, [80, 50, 50]
    );
  }

  y += 4;
  y = addSectionTitle(doc, "Top Selling Products", y);
  y = addTable(doc,
    ["Product", "Category", "Strain", "Units Sold", "Revenue"],
    topSellers.map(p => [
      p.name?.slice(0, 26),
      formatCategory(p.category),
      formatStrain(p.strain_type),
      p.sold,
      p.revenue?.toFixed(2),
    ]),
    y, [62, 34, 26, 30, 30]
  );

  y += 4;
  y = addSectionTitle(doc, "Low Stock Alerts & Restock Suggestions", y);
  y = addTable(doc,
    ["Product", "Strain", "Current", "Daily Rate", "Days Left", "Reorder"],
    lowStock.map(p => [
      p.name?.slice(0, 22),
      formatStrain(p.strain_type),
      p.stock_quantity,
      p.dailyRate?.toFixed(1) || "—",
      p.daysUntilEmpty ?? "—",
      p.suggestedReorder ?? "—",
    ]),
    y, [52, 24, 27, 26, 26, 27]
  );

  y += 4;
  y = addSectionTitle(doc, "Aging / Slow-Moving Stock", y);
  y = addTable(doc,
    ["Product", "Category", "Strain", "In Stock", "Units Sold"],
    agingStock.map(p => [
      p.name?.slice(0, 26),
      formatCategory(p.category),
      formatStrain(p.strain_type),
      p.stock_quantity,
      p.sold,
    ]),
    y, [62, 34, 26, 30, 30]
  );

  doc.save(`cannalife-inventory-${new Date().toISOString().slice(0, 10)}.pdf`);
}
