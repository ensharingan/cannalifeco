// src/lib/membershipFees.js
// Membership fee logic for clubs that charge a recurring joining/renewal fee.
// Driven entirely by companies.membership_fee_enabled — no hardcoded company IDs.

import { supabase } from '@/lib/supabase';

// ---------- date helpers (local-date safe, no timezone drift) ----------

export function toDateString(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

export function todayString() {
  return toDateString(new Date());
}

export function addDays(dateString, days) {
  var parts = String(dateString).split('-');
  var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

export function daysBetween(fromString, toString) {
  var a = new Date(fromString + 'T00:00:00');
  var b = new Date(toString + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ---------- settings ----------

export function getMembershipFeeSettings(company) {
  return {
    enabled: !!(company && company.membership_fee_enabled),
    amount: Number((company && company.membership_fee_amount) || 0),
    days: Number((company && company.membership_fee_days) || 30),
  };
}

// ---------- status ----------

export function isMembershipDue(member, settings) {
  if (!settings || !settings.enabled) return false;
  if (!member) return false;
  if (!member.membership_paid_until) return true;
  return member.membership_paid_until < todayString();
}

// Returns { due, label, tone, paidUntil, daysLeft }
// tone: 'due' | 'soon' | 'paid' | 'off'
export function getMembershipStatus(member, settings) {
  if (!settings || !settings.enabled) {
    return { due: false, label: '', tone: 'off', paidUntil: null, daysLeft: null };
  }

  if (!member || !member.membership_paid_until) {
    return { due: true, label: 'Fee due', tone: 'due', paidUntil: null, daysLeft: null };
  }

  var today = todayString();
  var paidUntil = member.membership_paid_until;
  var daysLeft = daysBetween(today, paidUntil);

  if (daysLeft < 0) {
    return {
      due: true,
      label: 'Overdue ' + Math.abs(daysLeft) + 'd',
      tone: 'due',
      paidUntil: paidUntil,
      daysLeft: daysLeft,
    };
  }

  if (daysLeft <= 3) {
    return {
      due: false,
      label: daysLeft === 0 ? 'Due today' : 'Due in ' + daysLeft + 'd',
      tone: 'soon',
      paidUntil: paidUntil,
      daysLeft: daysLeft,
    };
  }

  return {
    due: false,
    label: 'Paid to ' + paidUntil,
    tone: 'paid',
    paidUntil: paidUntil,
    daysLeft: daysLeft,
  };
}

// ---------- collection ----------

// options: { companyId, member, settings, amount?, storeId?, orderId?,
//            cashierSessionId?, paymentMethod?, collectedBy?, notes? }
// Renewing early stacks: the new period starts the day after the current one ends.
export async function collectMembershipFee(options) {
  var companyId = options.companyId;
  var member = options.member;
  var settings = options.settings;

  if (!companyId || !member || !member.id) {
    throw new Error('collectMembershipFee: companyId and member are required');
  }
  if (!settings || !settings.enabled) {
    throw new Error('Membership fees are not enabled for this club');
  }

  var today = todayString();
  var periodStart = today;

  if (member.membership_paid_until && member.membership_paid_until >= today) {
    periodStart = addDays(member.membership_paid_until, 1);
  }

  var periodEnd = addDays(periodStart, settings.days - 1);
  var amount = options.amount != null ? Number(options.amount) : settings.amount;

  var payload = {
    company_id: companyId,
    member_id: member.id,
    store_id: options.storeId || null,
    order_id: options.orderId || null,
    cashier_session_id: options.cashierSessionId || null,
    amount: amount,
    period_start: periodStart,
    period_end: periodEnd,
    payment_method: options.paymentMethod || 'cash',
    collected_by: options.collectedBy || null,
    notes: options.notes || null,
  };

  var inserted = await supabase
    .from('membership_fee_payments')
    .insert(payload)
    .select()
    .single();

  if (inserted.error) throw inserted.error;

  var updated = await supabase
    .from('members')
    .update({ membership_paid_until: periodEnd })
    .eq('id', member.id)
    .eq('company_id', companyId);

  if (updated.error) throw updated.error;

  return { payment: inserted.data, paidUntil: periodEnd, amount: amount };
}

// ---------- queries ----------

// Paginated — PostgREST silently caps unbounded selects at 1000 rows.
export async function fetchOverdueMembers(companyId) {
  var today = todayString();
  var all = [];
  var from = 0;
  var pageSize = 1000;

  while (true) {
    var page = await supabase
      .from('members')
      .select('id, membership_id, first_name, last_name, phone, membership_paid_until')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .or('membership_paid_until.is.null,membership_paid_until.lt.' + today)
      .order('membership_paid_until', { ascending: true, nullsFirst: true })
      .range(from, from + pageSize - 1);

    if (page.error) throw page.error;
    all = all.concat(page.data || []);
    if (!page.data || page.data.length < pageSize) break;
    from = from + pageSize;
  }

  return all;
}

export async function fetchMemberFeeHistory(companyId, memberId) {
  var result = await supabase
    .from('membership_fee_payments')
    .select('*')
    .eq('company_id', companyId)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });

  if (result.error) throw result.error;
  return result.data || [];
}

// Totals for a date range — feeds cash-up and reporting.
export async function fetchFeeTotals(companyId, fromDate, toDate, storeId) {
  var query = supabase
    .from('membership_fee_payments')
    .select('amount, payment_method, created_at, store_id')
    .eq('company_id', companyId)
    .gte('created_at', fromDate)
    .lte('created_at', toDate);

  if (storeId) query = query.eq('store_id', storeId);

  var result = await query;
  if (result.error) throw result.error;

  var rows = result.data || [];
  var totals = { count: rows.length, total: 0, cash: 0, card: 0, other: 0 };

  rows.forEach(function (row) {
    var amount = Number(row.amount || 0);
    totals.total += amount;
    if (row.payment_method === 'cash') totals.cash += amount;
    else if (row.payment_method === 'card') totals.card += amount;
    else totals.other += amount;
  });

  return totals;
}
