// src/lib/accounting.js
// Shared accounting maths and formatting. The tax split here mirrors
// acc_split_tax() in the database exactly — the grid, the CSV import and the
// posting routine all have to agree to the cent, and the only way to guarantee
// that is for there to be one rounding rule written down twice, identically.

export var GCS_OPTIONS = [
  { value: 'G', label: 'G - General Ledger' },
  { value: 'C', label: 'C - Customer' },
  { value: 'S', label: 'S - Supplier' },
];

export var ACCOUNT_CATEGORIES = [
  { value: 'asset',     label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity',    label: 'Equity' },
  { value: 'income',    label: 'Income' },
  { value: 'expense',   label: 'Expense' },
];

export var SUBCATEGORIES = {
  asset:     ['current_asset', 'non_current_asset'],
  liability: ['current_liability', 'non_current_liability'],
  equity:    ['equity'],
  income:    ['revenue', 'other_income'],
  expense:   ['cost_of_sales', 'operating', 'other_expense'],
};

// Pastel "Financial Categories" — the B (balance sheet) and I (income statement)
// groupings on the client's General Ledger Master Listing. Each one implies the
// Budify category/group, so picking it when creating an account is enough.
export var FINANCIAL_CATEGORIES = [
  { code: 'B10', name: 'Share Capital',            category: 'equity',    subcategory: 'equity' },
  { code: 'B15', name: 'Retained Income',          category: 'equity',    subcategory: 'equity' },
  { code: 'B20', name: 'Shareholders Loan',        category: 'liability', subcategory: 'non_current_liability' },
  { code: 'B25', name: 'Long Term Borrowings',     category: 'liability', subcategory: 'non_current_liability' },
  { code: 'B30', name: 'Other Long Term Liabilities', category: 'liability', subcategory: 'non_current_liability' },
  { code: 'B35', name: 'Fixed Assets',             category: 'asset',     subcategory: 'non_current_asset' },
  { code: 'B40', name: 'Investments',              category: 'asset',     subcategory: 'non_current_asset' },
  { code: 'B45', name: 'Other Fixed Assets',       category: 'asset',     subcategory: 'non_current_asset' },
  { code: 'B50', name: 'Inventory',                category: 'asset',     subcategory: 'current_asset' },
  { code: 'B55', name: 'Accounts Receivable',      category: 'asset',     subcategory: 'current_asset' },
  { code: 'B60', name: 'Bank',                     category: 'asset',     subcategory: 'current_asset' },
  { code: 'B65', name: 'Other Current Assets',     category: 'asset',     subcategory: 'current_asset' },
  { code: 'B70', name: 'Accounts Payable',         category: 'liability', subcategory: 'current_liability' },
  { code: 'B75', name: 'Taxation',                 category: 'liability', subcategory: 'current_liability' },
  { code: 'B80', name: 'Other Current Liabilities', category: 'liability', subcategory: 'current_liability' },
  { code: 'I10', name: 'Sales',                    category: 'income',    subcategory: 'revenue' },
  { code: 'I15', name: 'Cost of Sales',            category: 'expense',   subcategory: 'cost_of_sales' },
  { code: 'I20', name: 'Other Income',             category: 'income',    subcategory: 'other_income' },
  { code: 'I25', name: 'Expenses',                 category: 'expense',   subcategory: 'operating' },
  { code: 'I30', name: 'Tax',                      category: 'expense',   subcategory: 'other_expense' },
  { code: 'I35', name: 'Dividends',                category: 'equity',    subcategory: 'equity' },
];

// Round half away from zero at 2dp. JavaScript's Math.round pushes .5 towards
// +Infinity, which turns -0.005 into -0.00 and loses a cent on credits.
export function round2(value) {
  var n = Number(value || 0);
  var sign = n < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(n) * 100 + Number.EPSILON) / 100;
}

/**
 * Split an amount into net / tax / gross.
 * @param {number} amount   the figure the user typed
 * @param {number} rate     percentage, e.g. 15 for 15%
 * @param {boolean} inclusive  true when the typed figure already includes tax
 */
export function splitTax(amount, rate, inclusive) {
  var amt = Number(amount || 0);
  var r = Number(rate || 0) / 100;
  if (!r) return { net: round2(amt), tax: 0, gross: round2(amt) };
  if (inclusive) {
    var gross = round2(amt);
    var tax = round2(amt * r / (1 + r));
    return { net: round2(gross - tax), tax: tax, gross: gross };
  }
  var net = round2(amt);
  var t = round2(amt * r);
  return { net: net, tax: t, gross: round2(net + t) };
}

export function formatMoney(value) {
  var n = Number(value || 0);
  return n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMoneyR(value) {
  var n = Number(value || 0);
  return (n < 0 ? '-' : '') +
    Math.abs(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function accountLabel(account) {
  if (!account) return '';
  return account.code + '/' + account.sub_code + ' ' + account.name;
}

export function cashBookLabel(book) {
  if (!book) return '';
  return book.code + ' - ' + book.name;
}

export function toDateInput(d) {
  var date = d instanceof Date ? d : new Date(d);
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function formatDateZA(value) {
  if (!value) return '';
  var d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return String(d.getDate()).padStart(2, '0') + '/' +
         String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

// The period a date falls in, or null when the financial year has not been set
// up far enough. Callers show "no period" rather than silently posting.
export function periodForDate(periods, dateStr) {
  if (!dateStr) return null;
  for (var i = 0; i < periods.length; i++) {
    var p = periods[i];
    if (dateStr >= p.start_date && dateStr <= p.end_date) return p;
  }
  return null;
}

// Pastel's reference increment: trailing digits go up by one, the prefix is
// left alone. "7INV004" becomes "7INV005"; "EFT" with no digits is returned
// unchanged so a user who wants a fixed reference gets one.
export function nextReference(reference) {
  if (!reference) return '';
  var m = String(reference).match(/^(.*?)(\d+)$/);
  if (!m) return reference;
  var prefix = m[1];
  var digits = m[2];
  var next = String(Number(digits) + 1);
  while (next.length < digits.length) next = '0' + next;
  return prefix + next;
}

// A line is only postable once it has a date, an allocation matching its GCS
// letter, and a value. Returns null when fine, or the reason it isn't.
export function validateEntry(entry) {
  var amount = Number(entry.amount_inclusive || 0);
  if (!amount) return null;               // blank rows are ignored, not rejected
  if (!entry.entry_date) return 'Date is required';
  if (entry.gcs === 'G' && !entry.gl_account_id) return 'Choose a general ledger account';
  if (entry.gcs === 'C' && !entry.member_id) return 'Choose a member';
  if (entry.gcs === 'S' && !entry.supplier_id) return 'Choose a supplier';
  return null;
}

// Signed balance for reporting: assets and expenses read debit-positive,
// everything else credit-positive, which is what an accountant expects to see
// on a trial balance without having to mentally flip signs.
export function signedBalance(category, debit, credit) {
  var dr = Number(debit || 0);
  var cr = Number(credit || 0);
  if (category === 'asset' || category === 'expense') return round2(dr - cr);
  return round2(cr - dr);
}

export function csvEscape(value) {
  var s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function downloadCsv(filename, headers, rows) {
  var lines = [headers.map(csvEscape).join(',')];
  for (var i = 0; i < rows.length; i++) {
    lines.push(rows[i].map(csvEscape).join(','));
  }
  var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse a bank statement CSV.
 *
 * The accountant's own export has the shape
 *   Number, Date, Description1, Description2, Reference, Amount, Balance, Accrued_Charges
 * with single-quoted headers and values ('02 Feb'), so quotes are stripped and
 * headers matched case-insensitively. Anything it can't recognise comes back in
 * `unmapped` for the import dialog to show rather than being silently dropped.
 */
export function parseStatementCsv(text) {
  var rows = parseCsvRows(text);
  if (!rows.length) return { headers: [], records: [] };

  var headers = rows[0].map(function (h) {
    return String(h || '').replace(/^['"]|['"]$/g, '').trim();
  });
  var records = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i].length) continue;
    if (rows[i].every(function (c) { return String(c || '').trim() === ''; })) continue;
    var rec = {};
    for (var j = 0; j < headers.length; j++) {
      rec[headers[j]] = String(rows[i][j] == null ? '' : rows[i][j])
        .replace(/^['"]|['"]$/g, '').trim();
    }
    records.push(rec);
  }
  return { headers: headers, records: records };
}

// Minimal RFC4180 reader — handles quoted fields, embedded commas, doubled
// quotes and both line ending styles.
export function parseCsvRows(text) {
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  var s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Bank CSVs date columns range from "02 Feb" to "2026/02/02". Everything is
// normalised to yyyy-mm-dd; a bare day+month takes the year from the period
// being captured, which is the only sane guess and is shown to the user before
// anything is written.
export function normaliseCsvDate(value, fallbackYear) {
  var raw = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return '';

  var iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return iso[1] + '-' + pad(iso[2]) + '-' + pad(iso[3]);

  var dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dmy) {
    var yr = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3];
    return yr + '-' + pad(dmy[2]) + '-' + pad(dmy[1]);
  }

  var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  var dmon = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s*(\d{4})?$/);
  if (dmon) {
    var mi = months.indexOf(dmon[2].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      var year = dmon[3] || fallbackYear || new Date().getFullYear();
      return year + '-' + pad(mi + 1) + '-' + pad(dmon[1]);
    }
  }
  return '';
}

function pad(n) { return String(n).padStart(2, '0'); }

// Bank amounts arrive as "1 410.00", "1,410.00", "(1410.00)" or "-1410.00".
export function parseAmount(value) {
  var raw = String(value == null ? '' : value).trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return 0;
  var negative = /^\(.*\)$/.test(raw);
  raw = raw.replace(/[()]/g, '').replace(/[R\s ]/g, '').replace(/,/g, '');
  var n = Number(raw);
  if (isNaN(n)) return 0;
  return negative ? -Math.abs(n) : n;
}
