// src/lib/accountingPdf.js
// One PDF writer for every accounting report. The accountant's brief was that
// "all of the above needs to be able to convert to PDF reports", so rather than
// each screen growing its own jsPDF code, they all call buildReportPdf() with
// columns and rows and get a consistent, printable document back.

import { jsPDF } from 'jspdf';
import { BRAND } from '@/lib/brand';

var PAGE_W = 210;
var MARGIN = 12;
var CONTENT_W = PAGE_W - MARGIN * 2;
var PAGE_BOTTOM = 282;

// jsPDF's built-in fonts are WinAnsi only: anything outside Latin-1 renders as
// a wrong glyph instead of throwing, so it has to be swapped out up front.
function safe(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[→⇒➡]/g, '-')
    .replace(/[←⇐]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[•‣]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...');
}

function money(value) {
  var n = Number(value || 0);
  if (!isFinite(n)) return '';
  return n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function header(doc, title, subtitle, companyName) {
  var rgb = BRAND.colors.primaryRgb;
  var dark = BRAND.colors.darkRgb;

  doc.setFillColor(dark[0], dark[1], dark[2]);
  doc.rect(0, 0, PAGE_W, 26, 'F');

  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(safe(BRAND.name), MARGIN, 11);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text(safe(title), MARGIN, 19);

  doc.setTextColor(165, 165, 165);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  if (companyName) doc.text(safe(companyName), PAGE_W - MARGIN, 11, { align: 'right' });
  if (subtitle) doc.text(safe(subtitle), MARGIN, 24);
  doc.text('Generated ' + new Date().toLocaleString('en-ZA'), PAGE_W - MARGIN, 24, { align: 'right' });

  return 34;
}

function footer(doc) {
  var pages = doc.internal.getNumberOfPages();
  for (var i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(safe(BRAND.poweredBy), MARGIN, 289);
    doc.text('Page ' + i + ' of ' + pages, PAGE_W - MARGIN, 289, { align: 'right' });
  }
}

/**
 * columns: [{ key, label, width (mm), align: 'left'|'right', type: 'money'|'text' }]
 * Widths that don't add up to the content width are scaled to fit, so a caller
 * can think in proportions and still get a table that fills the page.
 */
function normaliseColumns(columns) {
  var total = 0;
  for (var i = 0; i < columns.length; i++) total += Number(columns[i].width || 20);
  var scale = CONTENT_W / total;
  return columns.map(function (c) {
    return {
      key: c.key,
      label: c.label,
      align: c.align || (c.type === 'money' ? 'right' : 'left'),
      type: c.type || 'text',
      width: Number(c.width || 20) * scale,
    };
  });
}

function drawHeaderRow(doc, cols, y) {
  var rgb = BRAND.colors.primaryRgb;
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.rect(MARGIN, y - 4.5, CONTENT_W, 6.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  var x = MARGIN;
  for (var i = 0; i < cols.length; i++) {
    var c = cols[i];
    if (c.align === 'right') doc.text(safe(c.label), x + c.width - 1.5, y, { align: 'right' });
    else doc.text(safe(c.label), x + 1.5, y);
    x += c.width;
  }
  return y + 6;
}

function cellText(row, col) {
  var v = row[col.key];
  if (col.type === 'money') return v === null || v === undefined || v === '' ? '' : money(v);
  return v == null ? '' : String(v);
}

/**
 * @param {object} opts
 *   title, subtitle, companyName
 *   columns  — see normaliseColumns
 *   rows     — array of plain objects; a row with `__section` renders as a band,
 *              `__bold` renders emphasised, `__rule` draws a line above it.
 *   totals   — optional object rendered as a final emphasised row
 *   notes    — optional array of strings printed under the table
 *   landscape — boolean
 */
export function buildReportPdf(opts) {
  var landscape = !!opts.landscape;
  var doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });

  if (landscape) {
    PAGE_W = 297;
    CONTENT_W = PAGE_W - MARGIN * 2;
    PAGE_BOTTOM = 195;
  } else {
    PAGE_W = 210;
    CONTENT_W = PAGE_W - MARGIN * 2;
    PAGE_BOTTOM = 282;
  }

  var cols = normaliseColumns(opts.columns || []);
  var y = header(doc, opts.title, opts.subtitle, opts.companyName);
  y = drawHeaderRow(doc, cols, y);

  var rows = opts.rows || [];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];

    if (y > PAGE_BOTTOM) {
      doc.addPage();
      y = header(doc, opts.title, opts.subtitle, opts.companyName);
      y = drawHeaderRow(doc, cols, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
    }

    if (row.__section) {
      doc.setFillColor(238, 238, 238);
      doc.rect(MARGIN, y - 4, CONTENT_W, 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(40, 40, 40);
      doc.text(safe(row.__section), MARGIN + 1.5, y);
      doc.setFont('helvetica', 'normal');
      y += 6.5;
      continue;
    }

    if (row.__rule) {
      doc.setDrawColor(190, 190, 190);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y - 4, MARGIN + CONTENT_W, y - 4);
    }

    if (i % 2 === 1 && !row.__bold) {
      doc.setFillColor(248, 248, 248);
      doc.rect(MARGIN, y - 4, CONTENT_W, 5.5, 'F');
    }

    doc.setFont('helvetica', row.__bold ? 'bold' : 'normal');
    doc.setTextColor(30, 30, 30);

    var x = MARGIN;
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      var text = safe(cellText(row, col));
      var maxChars = Math.max(4, Math.floor(col.width / 1.45));
      if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '.';
      if (col.align === 'right') doc.text(text, x + col.width - 1.5, y, { align: 'right' });
      else doc.text(text, x + 1.5, y);
      x += col.width;
    }
    y += 5.5;
  }

  if (opts.totals) {
    if (y > PAGE_BOTTOM - 8) { doc.addPage(); y = header(doc, opts.title, opts.subtitle, opts.companyName); }
    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y - 4, MARGIN + CONTENT_W, y - 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    var tx = MARGIN;
    for (var t = 0; t < cols.length; t++) {
      var tc = cols[t];
      var tv = safe(cellText(opts.totals, tc));
      if (tc.align === 'right') doc.text(tv, tx + tc.width - 1.5, y + 1, { align: 'right' });
      else doc.text(tv, tx + 1.5, y + 1);
      tx += tc.width;
    }
    y += 8;
  }

  if (opts.notes && opts.notes.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(90, 90, 90);
    for (var n = 0; n < opts.notes.length; n++) {
      if (y > PAGE_BOTTOM) { doc.addPage(); y = header(doc, opts.title, opts.subtitle, opts.companyName); }
      doc.text(safe(opts.notes[n]), MARGIN, y);
      y += 4.5;
    }
  }

  footer(doc);
  return doc;
}

export function saveReportPdf(opts, filename) {
  var doc = buildReportPdf(opts);
  doc.save(filename || 'report.pdf');
}

/** Two-column summary block, used by the reconciliation and tax reports. */
export function buildSummaryPdf(opts) {
  var doc = new jsPDF({ unit: 'mm', format: 'a4' });
  PAGE_W = 210; CONTENT_W = PAGE_W - MARGIN * 2; PAGE_BOTTOM = 282;
  var y = header(doc, opts.title, opts.subtitle, opts.companyName);

  var pairs = opts.pairs || [];
  doc.setFontSize(9);
  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i];
    if (y > PAGE_BOTTOM) { doc.addPage(); y = header(doc, opts.title, opts.subtitle, opts.companyName); }
    if (p.rule) {
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, y - 4, MARGIN + CONTENT_W, y - 4);
    }
    doc.setFont('helvetica', p.bold ? 'bold' : 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(safe(p.label), MARGIN, y);
    doc.text(p.raw ? safe(p.value) : money(p.value), MARGIN + CONTENT_W, y, { align: 'right' });
    y += 6.5;
  }

  if (opts.columns && opts.rows && opts.rows.length) {
    y += 4;
    var cols = normaliseColumns(opts.columns);
    y = drawHeaderRow(doc, cols, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    for (var r = 0; r < opts.rows.length; r++) {
      if (y > PAGE_BOTTOM) {
        doc.addPage();
        y = header(doc, opts.title, opts.subtitle, opts.companyName);
        y = drawHeaderRow(doc, cols, y);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
      }
      var x = MARGIN;
      for (var c2 = 0; c2 < cols.length; c2++) {
        var col2 = cols[c2];
        var txt = safe(cellText(opts.rows[r], col2));
        var maxC = Math.max(4, Math.floor(col2.width / 1.45));
        if (txt.length > maxC) txt = txt.slice(0, maxC - 1) + '.';
        if (col2.align === 'right') doc.text(txt, x + col2.width - 1.5, y, { align: 'right' });
        else doc.text(txt, x + 1.5, y);
        x += col2.width;
      }
      y += 5.5;
    }
  }

  footer(doc);
  return doc;
}

export function saveSummaryPdf(opts, filename) {
  buildSummaryPdf(opts).save(filename || 'summary.pdf');
}
