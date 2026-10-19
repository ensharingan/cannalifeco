// src/api/accounting.js
// Data access for the accounting module. Every posting goes through an RPC so
// the validation, the double entry and the batch status change happen in one
// database transaction — a half-posted batch is not a state this app can reach.

import { supabase } from './supabaseClient';
import { fetchAll } from '@/lib/fetchAll';

function unwrap(res) {
  if (res.error) throw res.error;
  return res.data;
}

// ─── Reference data ─────────────────────────────────────────────────────────

export async function listAccounts(companyId, opts) {
  var includeInactive = opts && opts.includeInactive;
  return fetchAll(function () {
    var q = supabase.from('gl_accounts').select('*').eq('company_id', companyId);
    if (!includeInactive) q = q.eq('active', true);
    return q.order('code', { ascending: true }).order('sub_code', { ascending: true });
  });
}

export async function listTaxTypes(companyId) {
  return fetchAll(function () {
    return supabase.from('tax_types').select('*')
      .eq('company_id', companyId).eq('active', true)
      .order('code', { ascending: true });
  });
}

export async function listPeriods(companyId) {
  return fetchAll(function () {
    return supabase.from('accounting_periods').select('*')
      .eq('company_id', companyId)
      .order('start_date', { ascending: true });
  });
}

export async function listFinancialYears(companyId) {
  return fetchAll(function () {
    return supabase.from('financial_years').select('*')
      .eq('company_id', companyId).order('start_date', { ascending: false });
  });
}

export async function getSettings(companyId) {
  var res = await supabase.from('accounting_settings').select('*')
    .eq('company_id', companyId).maybeSingle();
  if (res.error) throw res.error;
  return res.data;
}

export async function saveSettings(companyId, patch) {
  return unwrap(await supabase.from('accounting_settings')
    .upsert(Object.assign({ company_id: companyId, updated_at: new Date().toISOString() }, patch),
            { onConflict: 'company_id' })
    .select().single());
}

export async function bootstrapCompany(companyId, yearStart) {
  return unwrap(await supabase.rpc('acc_bootstrap_company', {
    p_company: companyId,
    p_year_start: yearStart || null,
  }));
}

// ─── Chart of accounts ──────────────────────────────────────────────────────

export async function createAccount(payload) {
  return unwrap(await supabase.from('gl_accounts').insert(payload).select().single());
}

export async function updateAccount(id, patch) {
  return unwrap(await supabase.from('gl_accounts')
    .update(Object.assign({}, patch, { updated_at: new Date().toISOString() }))
    .eq('id', id).select().single());
}

// ─── Cash books ─────────────────────────────────────────────────────────────

export async function listCashBooks(companyId) {
  return fetchAll(function () {
    return supabase.from('cash_books').select('*, gl_account:gl_accounts(id, code, sub_code, name)')
      .eq('company_id', companyId).eq('active', true)
      .order('code', { ascending: true });
  });
}

export async function createCashBook(payload) {
  return unwrap(await supabase.from('cash_books').insert(payload).select().single());
}

export async function updateCashBook(id, patch) {
  return unwrap(await supabase.from('cash_books')
    .update(Object.assign({}, patch, { updated_at: new Date().toISOString() }))
    .eq('id', id).select().single());
}

/** Posted book balance for a cash book, optionally as at a date. */
export async function cashBookBalance(cashBookId, toDate) {
  var res = await supabase.rpc('acc_cash_book_balance', {
    p_cash_book: cashBookId,
    p_to_date: toDate || null,
  });
  if (res.error) throw res.error;
  return Number(res.data || 0);
}

// ─── Cash book batches ──────────────────────────────────────────────────────

/**
 * The open batch for a cash book, created on demand. A user who walks away
 * mid-capture comes back to the same batch rather than starting again, which
 * is what "Batch..." does in Pastel.
 */
export async function getOrCreateOpenBatch(companyId, cashBookId, periodId) {
  var existing = await supabase.from('cash_book_batches').select('*')
    .eq('company_id', companyId).eq('cash_book_id', cashBookId).eq('status', 'open')
    .order('created_at', { ascending: false }).limit(1);
  if (existing.error) throw existing.error;
  if (existing.data && existing.data.length) return existing.data[0];

  var userRes = await supabase.auth.getUser();
  var uid = userRes.data && userRes.data.user ? userRes.data.user.id : null;

  return unwrap(await supabase.from('cash_book_batches').insert({
    company_id: companyId,
    cash_book_id: cashBookId,
    period_id: periodId || null,
    created_by: uid,
  }).select().single());
}

export async function listBatchEntries(batchId) {
  return fetchAll(function () {
    return supabase.from('cash_book_entries').select('*')
      .eq('batch_id', batchId)
      .order('side', { ascending: true })
      .order('line_no', { ascending: true });
  });
}

export async function saveEntry(entry) {
  if (entry.id) {
    var id = entry.id;
    var patch = Object.assign({}, entry, { updated_at: new Date().toISOString() });
    delete patch.id;
    return unwrap(await supabase.from('cash_book_entries').update(patch).eq('id', id).select().single());
  }
  return unwrap(await supabase.from('cash_book_entries').insert(entry).select().single());
}

export async function deleteEntry(id) {
  var res = await supabase.from('cash_book_entries').delete().eq('id', id);
  if (res.error) throw res.error;
}

export async function insertEntries(rows) {
  if (!rows.length) return [];
  return unwrap(await supabase.from('cash_book_entries').insert(rows).select());
}

export async function postCashBookBatch(batchId) {
  var res = await supabase.rpc('acc_post_cash_book_batch', { p_batch_id: batchId });
  if (res.error) throw res.error;
  return (res.data && res.data[0]) || { lines_posted: 0 };
}

export async function logImport(payload) {
  var res = await supabase.from('cash_book_imports').insert(payload);
  if (res.error) throw res.error;
}

// ─── Bank reconciliation ────────────────────────────────────────────────────

/** Posted, unreconciled cash book entries up to a date — the matching list. */
export async function unreconciledEntries(companyId, cashBookId, upToDate) {
  return fetchAll(function () {
    return supabase.from('cash_book_entries')
      .select('*')
      .eq('company_id', companyId)
      .eq('cash_book_id', cashBookId)
      .eq('posted', true)
      .eq('reconciled', false)
      .lte('entry_date', upToDate)
      .order('entry_date', { ascending: true });
  });
}

export async function createReconciliation(payload) {
  return unwrap(await supabase.from('bank_reconciliations').insert(payload).select().single());
}

export async function saveReconciliationLines(rows) {
  if (!rows.length) return [];
  return unwrap(await supabase.from('bank_reconciliation_lines')
    .upsert(rows, { onConflict: 'reconciliation_id,cash_book_entry_id' }).select());
}

export async function updateReconciliation(reconId) {
  var res = await supabase.rpc('acc_update_reconciliation', { p_recon: reconId });
  if (res.error) throw res.error;
  return res.data;
}

export async function listReconciliations(companyId, cashBookId) {
  return fetchAll(function () {
    var q = supabase.from('bank_reconciliations').select('*').eq('company_id', companyId);
    if (cashBookId) q = q.eq('cash_book_id', cashBookId);
    return q.order('statement_date', { ascending: false });
  });
}

// ─── General journals ───────────────────────────────────────────────────────

export async function listJournalBatches(companyId) {
  return fetchAll(function () {
    return supabase.from('journal_batches').select('*')
      .eq('company_id', companyId).neq('status', 'deleted')
      .order('created_at', { ascending: false });
  });
}

export async function createJournalBatch(payload) {
  return unwrap(await supabase.from('journal_batches').insert(payload).select().single());
}

export async function listJournalEntries(batchId) {
  return fetchAll(function () {
    return supabase.from('journal_entries').select('*')
      .eq('batch_id', batchId).order('line_no', { ascending: true });
  });
}

export async function saveJournalEntry(entry) {
  if (entry.id) {
    var id = entry.id;
    var patch = Object.assign({}, entry);
    delete patch.id;
    return unwrap(await supabase.from('journal_entries').update(patch).eq('id', id).select().single());
  }
  return unwrap(await supabase.from('journal_entries').insert(entry).select().single());
}

export async function deleteJournalEntry(id) {
  var res = await supabase.from('journal_entries').delete().eq('id', id);
  if (res.error) throw res.error;
}

export async function postJournalBatch(batchId) {
  var res = await supabase.rpc('acc_post_journal_batch', { p_batch_id: batchId });
  if (res.error) throw res.error;
  return (res.data && res.data[0]) || { lines_posted: 0 };
}

// ─── Inventory journals and interstore transfers ────────────────────────────

export async function listInventoryBatches(companyId, batchType) {
  return fetchAll(function () {
    var q = supabase.from('inventory_journal_batches').select('*')
      .eq('company_id', companyId).neq('status', 'deleted');
    if (batchType) q = q.eq('batch_type', batchType);
    return q.order('created_at', { ascending: false });
  });
}

export async function createInventoryBatch(payload) {
  return unwrap(await supabase.from('inventory_journal_batches').insert(payload).select().single());
}

export async function updateInventoryBatch(id, patch) {
  return unwrap(await supabase.from('inventory_journal_batches')
    .update(patch).eq('id', id).select().single());
}

export async function listInventoryEntries(batchId) {
  return fetchAll(function () {
    return supabase.from('inventory_journal_entries').select('*')
      .eq('batch_id', batchId).order('line_no', { ascending: true });
  });
}

export async function saveInventoryEntry(entry) {
  if (entry.id) {
    var id = entry.id;
    var patch = Object.assign({}, entry);
    delete patch.id;
    return unwrap(await supabase.from('inventory_journal_entries').update(patch).eq('id', id).select().single());
  }
  return unwrap(await supabase.from('inventory_journal_entries').insert(entry).select().single());
}

export async function deleteInventoryEntry(id) {
  var res = await supabase.from('inventory_journal_entries').delete().eq('id', id);
  if (res.error) throw res.error;
}

export async function postInventoryBatch(batchId) {
  var res = await supabase.rpc('acc_post_inventory_journal', { p_batch_id: batchId });
  if (res.error) throw res.error;
  return (res.data && res.data[0]) || { lines_posted: 0 };
}

// ─── Reporting ──────────────────────────────────────────────────────────────

export async function trialBalance(companyId, fromDate, toDate) {
  var res = await supabase.rpc('acc_trial_balance', {
    p_company: companyId, p_from: fromDate || null, p_to: toDate || null,
  });
  if (res.error) throw res.error;
  return res.data || [];
}

export async function taxReport(companyId, fromDate, toDate) {
  var res = await supabase.rpc('acc_tax_report', {
    p_company: companyId, p_from: fromDate, p_to: toDate,
  });
  if (res.error) throw res.error;
  return res.data || [];
}

export async function ledgerTransactions(companyId, filters) {
  var f = filters || {};
  return fetchAll(function () {
    var q = supabase.from('gl_transactions')
      .select('*, account:gl_accounts(code, sub_code, name, category)')
      .eq('company_id', companyId);
    if (f.accountId) q = q.eq('gl_account_id', f.accountId);
    if (f.from) q = q.gte('txn_date', f.from);
    if (f.to) q = q.lte('txn_date', f.to);
    if (f.storeId && f.storeId !== 'all') q = q.eq('store_id', f.storeId);
    if (f.sourceType) q = q.eq('source_type', f.sourceType);
    return q.order('txn_date', { ascending: true }).order('created_at', { ascending: true });
  });
}

// ─── Tax periods ────────────────────────────────────────────────────────────

export async function listTaxPeriods(companyId) {
  return fetchAll(function () {
    return supabase.from('tax_periods').select('*')
      .eq('company_id', companyId).order('start_date', { ascending: false });
  });
}

export async function createTaxPeriod(payload) {
  return unwrap(await supabase.from('tax_periods').insert(payload).select().single());
}

export async function closeTaxPeriod(id) {
  var res = await supabase.rpc('acc_close_tax_period', { p_tax_period: id });
  if (res.error) throw res.error;
  return res.data;
}

// ─── Parties (members and suppliers) for GCS allocation ─────────────────────

export async function listMembers(companyId) {
  return fetchAll(function () {
    return supabase.from('members').select('id, full_name, member_number')
      .eq('company_id', companyId).order('full_name', { ascending: true });
  });
}

export async function listSuppliers(companyId) {
  return fetchAll(function () {
    return supabase.from('suppliers').select('id, name')
      .eq('company_id', companyId).order('name', { ascending: true });
  });
}

export async function listStores(companyId) {
  return fetchAll(function () {
    return supabase.from('stores').select('id, name, is_active')
      .eq('company_id', companyId).order('name', { ascending: true });
  });
}

export async function listProducts(companyId) {
  return fetchAll(function () {
    return supabase.from('products').select('id, name, sku, cost_price')
      .eq('company_id', companyId).order('name', { ascending: true });
  });
}

export async function storeInventoryFor(companyId, productIds) {
  if (!productIds.length) return [];
  return fetchAll(function () {
    return supabase.from('store_inventory').select('product_id, store_id, stock_quantity')
      .eq('company_id', companyId).in('product_id', productIds.slice(0, 200));
  });
}
