import React, { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Bell, AlertCircle, CheckCircle2, Clock, FileText,
  Ban, Loader2, TrendingUp, Package, Users, CreditCard, Wallet, CheckCheck,
} from 'lucide-react';

// Current pricing — R299 era is over
const PACKAGE_LABELS = {
  starter: { name: 'Starter', price: 499, cycle: '/mo' },
  growth:  { name: 'Growth',  price: 999, cycle: '/mo' },
};

/*
 * ─── COMPANY STATUS VALUES ──────────────────────────────────────────────
 * The only values that exist in companies.status:
 *
 *   trial · active · pending · pending_payment · suspended
 *
 * 'pending_approval' is NOT one of them. Every filter in the previous
 * version keyed off it, so the Pending tab was permanently empty, the
 * "Pending Approval" card read 0, and two real companies — Long Street
 * Budzone and Cafe Kush Kings 420 — were invisible on this screen with no
 * action available anywhere in the UI.
 */
const AWAITING_REVIEW = ['pending', 'pending_payment'];

const STATUS_BADGE = {
  pending:          { label: 'Pending Review',   color: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
  pending_payment:  { label: 'Awaiting Payment', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
  active:           { label: 'Active',           color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' },
  trial:            { label: 'Trial',            color: 'bg-purple-500/20 text-purple-400 border-purple-500/50' },
  overdue:          { label: 'Overdue',          color: 'bg-orange-500/20 text-orange-400 border-orange-500/50' },
  suspended:        { label: 'Suspended',        color: 'bg-red-500/20 text-red-400 border-red-500/50' },
  cancelled:        { label: 'Cancelled',        color: 'bg-slate-500/20 text-slate-400 border-slate-500/50' },
};

/*
 * ─── PAGINATED FETCH ────────────────────────────────────────────────────
 * PostgREST silently truncates at 1,000 rows. profiles is already at 333 and
 * climbs with every cashier added; invoices was hard-capped at 200, which
 * meant the "Total Collected" figure would quietly stop counting once you
 * crossed that. Page everything.
 */
async function fetchAllRows(table, select, options) {
  var opts = options || {};
  var pageSize = 1000;
  var maxRows = opts.maxRows || 50000;
  var all = [];
  var from = 0;

  while (from < maxRows) {
    var q = supabase.from(table).select(select || '*').range(from, from + pageSize - 1);
    if (opts.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending === true });
    var res = await q;
    if (res.error) throw new Error(table + ': ' + res.error.message);
    var rows = res.data || [];
    all = all.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/*
 * ─── PROTECTED COLUMN WRITES ────────────────────────────────────────────
 * status, package, subscription_status, subscription_plan, monthly_fee,
 * activated_at, suspended_at, grace_period_ends_at, next_payment_due,
 * last_payment_date, admin_notes and friends are no longer writable by the
 * `authenticated` role. They go through admin_patch_company(), which is
 * SECURITY DEFINER and re-checks that the caller is superadmin.
 *
 * Key absent  = leave unchanged
 * Key present with null = set to null
 */
async function adminPatchCompany(companyId, patch) {
  var res = await supabase.rpc('admin_patch_company', {
    p_company_id: companyId,
    p_patch: patch,
  });
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export default function SuperAdminClients() {
  var [companies, setCompanies] = useState([]);
  var [invoices, setInvoices] = useState([]);
  var [notifications, setNotifications] = useState([]);
  var [paystackCollected, setPaystackCollected] = useState(0);
  var [loading, setLoading] = useState(true);
  var [approveDialog, setApproveDialog] = useState(null);
  var [markPaidDialog, setMarkPaidDialog] = useState(null);
  var [manualPaymentDialog, setManualPaymentDialog] = useState(null);
  var [manualPaymentForm, setManualPaymentForm] = useState({ package: 'starter', price: '499', reference: '', notes: '' });
  var [processingId, setProcessingId] = useState(null);
  var [search, setSearch] = useState('');
  var [statusFilter, setStatusFilter] = useState('all');

  var loadData = async function() {
    setLoading(true);
    try {
      var results = await Promise.all([
        fetchAllRows('companies',     '*', { orderBy: 'created_at' }),
        fetchAllRows('profiles',      'id, email, full_name, role, company_id'),
        fetchAllRows('subscriptions', 'id, company_id, package, price_zar, billing_cycle, status, next_billing_date, last_payment_at, created_at'),
        fetchAllRows('invoices',      '*', { orderBy: 'created_at' }),
        fetchAllRows('payment_logs',  'amount, event'),
      ]);
      var companiesData = results[0];
      var profilesData  = results[1];
      var subsData      = results[2];
      var invoicesData  = results[3];
      var paymentLogs   = results[4];

      var notifsRes = await supabase.from('signup_notifications').select('*').eq('read', false).order('created_at', { ascending: false });

      var companiesWithRelations = companiesData.map(function(c) {
        return {
          ...c,
          profiles: profilesData.filter(function(p) { return p.company_id === c.id; }),
          subscriptions: subsData.filter(function(s) { return s.company_id === c.id; }),
        };
      });
      var invoicesWithCompany = invoicesData.map(function(inv) {
        var comp = companiesData.find(function(c) { return c.id === inv.company_id; });
        return { ...inv, companies: comp ? { company_name: comp.company_name } : null };
      });

      // Real money actually received through Paystack. The invoices table is a
      // manual module that only 13 records have ever touched — it is not a
      // record of collections and must not be presented as one.
      var collected = paymentLogs
        .filter(function(p) { return p.event === 'charge.success'; })
        .reduce(function(s, p) { return s + (Number(p.amount) || 0); }, 0);

      setCompanies(companiesWithRelations);
      setInvoices(invoicesWithCompany);
      setPaystackCollected(collected);
      setNotifications(notifsRes.data || []);
    } catch (err) {
      console.error('loadData error:', err);
    }
    setLoading(false);
  };

  useEffect(function() {
    loadData();
    var channel = supabase.channel('signup-notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signup_notifications' }, loadData)
      .subscribe();
    return function() { supabase.removeChannel(channel); };
  }, []);

  /*
   * At least one company carries two subscription rows. Taking [0] picked an
   * arbitrary one depending on row order. Prefer the active row, then the
   * most recently created.
   */
  var getSub = function(c) {
    var subs = c.subscriptions || [];
    if (subs.length === 0) return null;
    var active = subs.filter(function(s) { return s.status === 'active'; });
    var pool = active.length > 0 ? active : subs;
    return pool.slice().sort(function(a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    })[0];
  };

  var getPkgId = function(c) {
    var sub = getSub(c);
    return (sub && sub.package) || c.package || null;
  };

  /*
   * ─── THE R2,997 BUG ───────────────────────────────────────────────────
   * The previous version read:
   *
   *     if (sub && sub.price_zar) return Number(sub.price_zar);
   *     return PACKAGE_LABELS[pkgId].price || 499;
   *
   * price_zar = 0 is FALSY. Both comped Cannafrica records carry 0, so each
   * fell through and was billed at the R999 list price. The internal Canna Life Co
   * account has no subscription row at all and did the same. That is exactly
   * R2,997 of revenue that does not exist, and the whole reason this tab read
   * R19,665 while the Overview tab read R12,575.
   *
   * Returns null when there is no real, non-zero price. Callers decide what
   * to do with that — they must not substitute a list price.
   */
  var getSubPrice = function(c) {
    var sub = getSub(c);
    if (sub && sub.price_zar !== null && sub.price_zar !== undefined && Number(sub.price_zar) > 0) {
      return Number(sub.price_zar);
    }
    if (c.monthly_fee !== null && c.monthly_fee !== undefined && Number(c.monthly_fee) > 0) {
      return Number(c.monthly_fee);
    }
    return null; // comped, internal, or not yet priced
  };

  var listPriceFor = function(c) {
    var pkgId = getPkgId(c);
    return (pkgId && PACKAGE_LABELS[pkgId] && PACKAGE_LABELS[pkgId].price) || 0;
  };

  // ── Manual payment: create invoice + mark paid + activate in one step ──
  var saveManualPayment = async function() {
    if (!manualPaymentDialog) return;
    var c = manualPaymentDialog;
    if (!manualPaymentForm.reference.trim()) { alert('Please enter a payment reference'); return; }
    setProcessingId(c.id);
    try {
      var pkgId = manualPaymentForm.package;
      var price = Number(manualPaymentForm.price) || PACKAGE_LABELS[pkgId].price;
      var description = 'Canna Life Co ' + PACKAGE_LABELS[pkgId].name + ' - Monthly subscription';
      var today = new Date().toISOString().split('T')[0];
      var nb = new Date(); nb.setDate(nb.getDate() + 30);
      var nextBilling = nb.toISOString().split('T')[0];

      var existingSub = getSub(c);
      var subId = null;
      if (existingSub) {
        await supabase.from('subscriptions').update({
          status: 'active', package: pkgId, price_zar: price,
          billing_cycle: 'monthly',
          started_at: existingSub.started_at || new Date().toISOString(),
          next_billing_date: nextBilling,
          last_payment_at: new Date().toISOString(),
          last_payment_amount: price,
          last_payment_reference: manualPaymentForm.reference,
        }).eq('id', existingSub.id);
        subId = existingSub.id;
      } else {
        var { data: newSub, error: subErr } = await supabase.from('subscriptions').insert({
          company_id: c.id, status: 'active', package: pkgId, price_zar: price,
          billing_cycle: 'monthly', started_at: new Date().toISOString(), next_billing_date: nextBilling,
          last_payment_at: new Date().toISOString(), last_payment_amount: price,
          last_payment_reference: manualPaymentForm.reference,
        }).select().single();
        if (subErr) throw subErr;
        subId = newSub.id;
      }

      var { error: invErr } = await supabase.from('invoices').insert({
        company_id: c.id, amount_zar: price, description,
        due_date: today, status: 'paid', paid_date: today,
        payment_reference: manualPaymentForm.reference,
        subscription_id: subId || null,
        notes: manualPaymentForm.notes || null,
      });
      if (invErr) throw invErr;

      // Writes companies AND subscriptions in step. Previously `package`,
      // `subscription_status` and `monthly_fee` were only written to the
      // subscriptions table, which is what left companies drifting out of
      // sync and needing manual reconciliation.
      await adminPatchCompany(c.id, {
        status: 'active',
        package: pkgId,
        subscription_status: 'active',
        subscription_plan: pkgId,
        monthly_fee: price,
        activated_at: new Date().toISOString(),
        last_payment_date: today,
        next_payment_due: nextBilling,
        grace_period_ends_at: null,
        suspended_at: null,
      });

      await supabase.from('signup_notifications').update({ read: true }).eq('company_id', c.id);
      await loadData();
      setManualPaymentDialog(null);
      setManualPaymentForm({ package: 'starter', price: '499', reference: '', notes: '' });
    } catch (err) { alert('Error: ' + err.message); }
    setProcessingId(null);
  };

  var approveAndInvoice = async function(company, subscription) {
    setProcessingId(company.id);
    try {
      var dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 7);
      var pkgId = (subscription && subscription.package) || company.package || company.subscription_plan || 'starter';
      var pkg = PACKAGE_LABELS[pkgId] || PACKAGE_LABELS.starter;
      var existingPrice = subscription && Number(subscription.price_zar) > 0 ? Number(subscription.price_zar) : null;
      var price = existingPrice || pkg.price;
      var description = 'Canna Life Co ' + pkg.name + ' - Monthly subscription';
      var invoicePayload = {
        company_id: company.id, amount_zar: price, description,
        due_date: dueDate.toISOString().split('T')[0], status: 'pending',
      };
      if (subscription && subscription.id) invoicePayload.subscription_id = subscription.id;
      var { error: invError } = await supabase.from('invoices').insert(invoicePayload);
      if (invError) throw invError;

      await adminPatchCompany(company.id, {
        status: 'pending_payment',
        package: pkgId,
        subscription_plan: pkgId,
        monthly_fee: price,
        next_payment_due: dueDate.toISOString().split('T')[0],
      });

      await supabase.from('signup_notifications').update({ read: true }).eq('company_id', company.id);
      await loadData();
      setApproveDialog(null);
    } catch (err) { alert('Error: ' + err.message); }
    setProcessingId(null);
  };

  var markInvoicePaid = async function(invoice, reference) {
    setProcessingId(invoice.id);
    try {
      var today = new Date().toISOString().split('T')[0];
      await supabase.from('invoices').update({
        status: 'paid', paid_date: today, payment_reference: reference,
      }).eq('id', invoice.id);

      var pkgId = null;
      var nextBillingStr = null;
      if (invoice.subscription_id) {
        var { data: sub } = await supabase.from('subscriptions').select('*').eq('id', invoice.subscription_id).single();
        if (sub) {
          var nb2 = new Date(); nb2.setDate(nb2.getDate() + 30);
          nextBillingStr = nb2.toISOString().split('T')[0];
          pkgId = sub.package || null;
          await supabase.from('subscriptions').update({
            status: 'active', started_at: sub.started_at || new Date().toISOString(),
            next_billing_date: nextBillingStr,
            last_payment_at: new Date().toISOString(),
            last_payment_amount: Number(invoice.amount_zar) || null,
            last_payment_reference: reference,
          }).eq('id', sub.id);
        }
      }

      var patch = {
        status: 'active',
        subscription_status: 'active',
        activated_at: new Date().toISOString(),
        last_payment_date: today,
        grace_period_ends_at: null,
        suspended_at: null,
      };
      if (pkgId) { patch.package = pkgId; patch.subscription_plan = pkgId; }
      if (nextBillingStr) patch.next_payment_due = nextBillingStr;
      if (invoice.amount_zar) patch.monthly_fee = Number(invoice.amount_zar);

      await adminPatchCompany(invoice.company_id, patch);

      await loadData();
      setMarkPaidDialog(null);
    } catch (err) { alert('Error: ' + err.message); }
    setProcessingId(null);
  };

  var suspendCompany = async function(companyId) {
    if (!confirm('Suspend this company? They will be locked out immediately.')) return;
    try {
      await adminPatchCompany(companyId, {
        status: 'suspended',
        subscription_status: 'suspended',
        suspended_at: new Date().toISOString(),
      });
      await loadData();
    } catch (err) { alert('Suspend failed: ' + err.message); }
  };

  var reactivateCompany = async function(companyId) {
    try {
      await adminPatchCompany(companyId, {
        status: 'active',
        subscription_status: 'active',
        suspended_at: null,
        grace_period_ends_at: null,
      });
      await loadData();
    } catch (err) { alert('Reactivate failed: ' + err.message); }
  };

  // ── Derived stats ─────────────────────────────────────────────────────
  var activeCompanies = companies.filter(function(c) { return c.status === 'active'; });
  var trialCompanies  = companies.filter(function(c) { return c.status === 'trial'; });

  // Only companies with a REAL price count toward MRR. Comped and internal
  // accounts are counted separately so they stay visible without inflating.
  var billableActive = activeCompanies.filter(function(c) { return getSubPrice(c) !== null; });
  var compedActive   = activeCompanies.filter(function(c) { return getSubPrice(c) === null; });

  var starterActive = billableActive.filter(function(c) { return getPkgId(c) === 'starter'; });
  var growthActive  = billableActive.filter(function(c) { return getPkgId(c) === 'growth'; });
  var starterTrial  = trialCompanies.filter(function(c) { return getPkgId(c) === 'starter'; });
  var growthTrial   = trialCompanies.filter(function(c) { return getPkgId(c) === 'growth'; });

  var starterMRR = starterActive.reduce(function(s, c) { return s + getSubPrice(c); }, 0);
  var growthMRR  = growthActive.reduce(function(s, c) { return s + getSubPrice(c); }, 0);
  var totalMRR   = starterMRR + growthMRR;

  // What the same clubs would bill at today's rates — the legacy-pricing gap.
  var mrrAtCurrentRates = billableActive.reduce(function(s, c) { return s + listPriceFor(c); }, 0);
  var repricingGap = mrrAtCurrentRates - totalMRR;
  var legacyClients = billableActive.filter(function(c) {
    var list = listPriceFor(c);
    return list > 0 && getSubPrice(c) < list;
  });

  var paidInvoicesTotal    = invoices.filter(function(i) { return i.status === 'paid'; }).reduce(function(s, i) { return s + (Number(i.amount_zar) || 0); }, 0);
  var pendingInvoicesTotal = invoices.filter(function(i) { return i.status === 'pending'; }).reduce(function(s, i) { return s + (Number(i.amount_zar) || 0); }, 0);

  var stats = {
    pending: companies.filter(function(c) { return AWAITING_REVIEW.indexOf(c.status) !== -1; }).length,
    active:  activeCompanies.length,
    trial:   trialCompanies.length,
    suspended: companies.filter(function(c) { return c.status === 'suspended'; }).length,
    totalMRR, starterMRR, growthMRR,
    starterActive: starterActive.length, growthActive: growthActive.length,
    starterTrial: starterTrial.length, growthTrial: growthTrial.length,
    paidInvoicesTotal, pendingInvoicesTotal,
  };

  var pendingCompanies = companies.filter(function(c) { return AWAITING_REVIEW.indexOf(c.status) !== -1; });
  var filteredCompanies = companies.filter(function(c) {
    var matchStatus = statusFilter === 'all' || c.status === statusFilter;
    var matchSearch = !search ||
      (c.company_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  if (loading) return (
    <div className="flex items-center justify-center p-12">
      <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Client Management</h2>
          <p className="text-muted-foreground text-sm">Review signups, invoices &amp; subscriptions</p>
        </div>
        {notifications.length > 0 && (
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/50 gap-1">
            <Bell className="w-3 h-3" />
            {notifications.length} new signup{notifications.length > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Clock}        label="Awaiting Review" value={stats.pending}   color="amber"   />
        <StatCard icon={CheckCircle2} label="Active"          value={stats.active}    color="emerald" />
        <StatCard icon={Users}        label="On Trial"        value={stats.trial}     color="purple"  />
        <StatCard icon={AlertCircle}  label="Suspended"       value={stats.suspended} color="red"     />
      </div>

      {/* MRR breakdown */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> Revenue &amp; Package Breakdown
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Total MRR</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">R{totalMRR.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">/month · {billableActive.length} paying clients</p>
            {compedActive.length > 0 && (
              <p className="text-xs text-slate-400 mt-0.5">{compedActive.length} comped / internal, excluded</p>
            )}
            {repricingGap > 0 && (
              <p className="text-xs text-amber-400 mt-1">
                R{mrrAtCurrentRates.toLocaleString()} at current rates · R{repricingGap.toLocaleString()} legacy gap ({legacyClients.length} clients)
              </p>
            )}
          </div>
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Package className="w-3.5 h-3.5 text-blue-400" />
              <p className="text-xs font-semibold text-blue-400">Starter — R499/mo list</p>
            </div>
            <p className="text-xl font-bold">{stats.starterActive}</p>
            <p className="text-xs text-muted-foreground">active · R{starterMRR.toLocaleString()}/mo actual</p>
            {stats.starterTrial > 0 && <p className="text-xs text-purple-400 mt-0.5">{stats.starterTrial} on trial</p>}
          </div>
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Package className="w-3.5 h-3.5 text-primary" />
              <p className="text-xs font-semibold text-primary">Growth — R999/mo list</p>
            </div>
            <p className="text-xl font-bold">{stats.growthActive}</p>
            <p className="text-xs text-muted-foreground">active · R{growthMRR.toLocaleString()}/mo actual</p>
            {stats.growthTrial > 0 && <p className="text-xs text-purple-400 mt-0.5">{stats.growthTrial} on trial</p>}
          </div>
        </div>
      </div>

      {/* Payment stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-green-500/10"><Wallet className="w-5 h-5 text-green-400" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Collected via Paystack</p>
            <p className="text-xl font-bold text-green-400">R{paystackCollected.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">All successful charges</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-blue-500/10"><FileText className="w-5 h-5 text-blue-400" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Manual Invoices Paid</p>
            <p className="text-xl font-bold text-blue-400">R{paidInvoicesTotal.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{invoices.filter(function(i) { return i.status === 'paid'; }).length} invoices · EFT / manual only</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-amber-500/10"><CreditCard className="w-5 h-5 text-amber-400" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-xl font-bold text-amber-400">R{pendingInvoicesTotal.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{invoices.filter(function(i) { return i.status === 'pending'; }).length} pending invoices</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Awaiting Review ({pendingCompanies.length})</TabsTrigger>
          <TabsTrigger value="all">All Clients ({companies.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
        </TabsList>

        {/* PENDING */}
        <TabsContent value="pending" className="space-y-3">
          {pendingCompanies.length === 0 ? (
            <Card><CardContent className="text-center py-12 text-muted-foreground">No signups awaiting review.</CardContent></Card>
          ) : pendingCompanies.map(function(c) {
            var owner = (c.profiles && c.profiles.find(function(p) { return p.role === 'admin' || p.role === 'owner'; })) || (c.profiles && c.profiles[0]);
            var sub = getSub(c);
            var pkgId = getPkgId(c) || c.subscription_plan || 'starter';
            var pkg = PACKAGE_LABELS[pkgId] || PACKAGE_LABELS.starter;
            var badge = STATUS_BADGE[c.status] || STATUS_BADGE.pending;
            return (
              <Card key={c.id} className="border-amber-500/30">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      {c.logo_url && <img src={c.logo_url} alt="" className="w-12 h-12 rounded-lg object-cover border border-border flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-lg">{c.company_name}</h3>
                          <Badge className={badge.color}>{badge.label}</Badge>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-muted-foreground">
                          <div><span className="opacity-60">Owner:</span> <span className="text-foreground">{(owner && owner.full_name) || '—'}</span></div>
                          <div><span className="opacity-60">Email:</span> <span className="text-foreground">{(owner && owner.email) || c.email}</span></div>
                          <div><span className="opacity-60">Phone:</span> <span className="text-foreground">{c.owner_phone || c.phone || '—'}</span></div>
                        </div>
                        <div className="mt-3 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-3 py-1.5 text-sm">
                          <span className="text-emerald-400 font-medium">{pkg.name}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-foreground">R{pkg.price.toLocaleString()}/mo</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">Signed up {new Date(c.created_at).toLocaleDateString('en-ZA')}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 gap-1"
                        onClick={function() {
                          setManualPaymentForm({ package: pkgId, price: String(pkg.price), reference: '', notes: '' });
                          setManualPaymentDialog(c);
                        }}>
                        <CheckCheck className="w-4 h-4" /> Already Paid
                      </Button>
                      <Button className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={function() { setApproveDialog({ company: c, subscription: sub }); }}>
                        Approve &amp; Send Invoice
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ALL CLIENTS */}
        <TabsContent value="all" className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <Input placeholder="Search company or email..." value={search} onChange={function(e) { setSearch(e.target.value); }} className="max-w-xs" />
            <div className="flex gap-1 flex-wrap">
              {['all','active','trial','pending','pending_payment','suspended'].map(function(s) {
                var labels = { all: 'All', pending: 'Pending Review', pending_payment: 'Awaiting Payment' };
                return (
                  <button key={s} onClick={function() { setStatusFilter(s); }}
                    className={"px-3 py-1.5 rounded-lg text-xs font-medium transition-all " +
                      (statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                    {labels[s] || (s.charAt(0).toUpperCase() + s.slice(1))}
                  </button>
                );
              })}
            </div>
          </div>

          {filteredCompanies.map(function(c) {
            var owner = (c.profiles && c.profiles.find(function(p) { return p.role === 'admin' || p.role === 'owner'; })) || (c.profiles && c.profiles[0]);
            var sub = getSub(c);
            var pkgId = getPkgId(c);
            var pkg = pkgId ? (PACKAGE_LABELS[pkgId] || null) : null;
            var badge = STATUS_BADGE[c.status] || { label: c.status, color: 'bg-slate-500/20 text-slate-400 border-slate-500/50' };
            var companyInvoices = invoices.filter(function(inv) { return inv.company_id === c.id; });
            var lastPaid = companyInvoices.find(function(inv) { return inv.status === 'paid'; });
            var lastPaidDate = lastPaid && lastPaid.paid_date ? new Date(lastPaid.paid_date).toLocaleDateString('en-ZA') : null;
            var actualPrice = getSubPrice(c);
            var listPrice = listPriceFor(c);
            var isLegacy = actualPrice !== null && listPrice > 0 && actualPrice < listPrice;
            return (
              <Card key={c.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {c.logo_url && <img src={c.logo_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-border flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold">{c.company_name}</h3>
                          <Badge className={badge.color}>{badge.label}</Badge>
                          {pkg && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                              {pkg.name} · {actualPrice !== null ? 'R' + actualPrice.toLocaleString() + '/mo' : 'comped'}
                            </span>
                          )}
                          {isLegacy && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              legacy · list R{listPrice}
                            </span>
                          )}
                          {!c.package && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/30">
                              no package — features gated
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>{(owner && owner.email) || c.email}</span>
                          {(c.owner_phone || c.phone) && <span>{c.owner_phone || c.phone}</span>}
                          {sub && sub.next_billing_date && <span className="text-amber-400">Next billing: {new Date(sub.next_billing_date).toLocaleDateString('en-ZA')}</span>}
                          {lastPaidDate && <span className="text-green-400">Last paid: {lastPaidDate}</span>}
                          {companyInvoices.length > 0 && (
                            <span>{companyInvoices.filter(function(i) { return i.status === 'paid'; }).length} paid / {companyInvoices.filter(function(i) { return i.status === 'pending'; }).length} pending invoices</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0 flex-wrap">
                      {['trial','pending','pending_payment','suspended'].includes(c.status) && (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 gap-1"
                          onClick={function() {
                            var pid = getPkgId(c) || c.subscription_plan || 'starter';
                            var validPkg = PACKAGE_LABELS[pid] ? pid : 'starter';
                            setManualPaymentForm({ package: validPkg, price: String(PACKAGE_LABELS[validPkg].price), reference: '', notes: '' });
                            setManualPaymentDialog(c);
                          }}>
                          <CheckCheck className="w-4 h-4" /> Mark Paid
                        </Button>
                      )}
                      {c.status === 'active' && (
                        <Button size="sm" variant="outline" onClick={function() { suspendCompany(c.id); }}>
                          <Ban className="w-4 h-4 mr-1" /> Suspend
                        </Button>
                      )}
                      {c.status === 'suspended' && (
                        <Button size="sm" className="bg-emerald-600" onClick={function() { reactivateCompany(c.id); }}>Reactivate</Button>
                      )}
                      {c.status === 'pending_payment' && (
                        <Button size="sm" variant="outline" className="text-blue-400 border-blue-500/30"
                          onClick={function() {
                            var pendingInv = invoices.find(function(inv) { return inv.company_id === c.id && inv.status === 'pending'; });
                            if (pendingInv) setMarkPaidDialog(pendingInv);
                            else alert('No pending invoice for this client. Use "Mark Paid" to record the payment directly.');
                          }}>
                          Mark Invoice Paid
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filteredCompanies.length === 0 && (
            <Card><CardContent className="text-center py-10 text-muted-foreground">No companies match your filters.</CardContent></Card>
          )}
        </TabsContent>

        {/* INVOICES */}
        <TabsContent value="invoices" className="space-y-3">
          {invoices.length === 0 ? (
            <Card><CardContent className="text-center py-12 text-muted-foreground">No invoices yet.</CardContent></Card>
          ) : invoices.map(function(inv) {
            return (
              <Card key={inv.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <h3 className="font-mono font-semibold text-sm">{inv.invoice_number}</h3>
                        <Badge className={inv.status === 'paid' ? 'bg-emerald-500/20 text-emerald-400' : inv.status === 'overdue' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}>{inv.status}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{inv.companies && inv.companies.company_name} · {inv.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Issued: {new Date(inv.issued_date || inv.created_at).toLocaleDateString('en-ZA')}
                        {inv.due_date && <> · Due: {new Date(inv.due_date).toLocaleDateString('en-ZA')}</>}
                        {inv.paid_date && <> · <span className="text-green-400">Paid: {new Date(inv.paid_date).toLocaleDateString('en-ZA')}</span></>}
                        {inv.payment_reference && <> · Ref: <span className="font-mono">{inv.payment_reference}</span></>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold">R{Number(inv.amount_zar).toLocaleString()}</span>
                      {inv.status === 'pending' && (
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={function() { setMarkPaidDialog(inv); }}>
                          Mark as Paid
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      {/* MANUAL PAYMENT DIALOG */}
      <Dialog open={!!manualPaymentDialog} onOpenChange={function(open) { if (!open) setManualPaymentDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCheck className="w-5 h-5 text-green-400" /> Record Manual Payment
            </DialogTitle>
          </DialogHeader>
          {manualPaymentDialog && (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-4">
                <p className="font-semibold">{manualPaymentDialog.company_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{manualPaymentDialog.email}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground text-sm">What this does:</p>
                <p>✓ Creates a paid invoice for this client</p>
                <p>✓ Activates their subscription immediately</p>
                <p>✓ Sets company status to <span className="text-green-400 font-medium">active</span></p>
                <p>✓ Syncs package &amp; billing fields on the company record</p>
              </div>
              <div>
                <Label>Package</Label>
                <Select value={manualPaymentForm.package} onValueChange={function(v) {
                  setManualPaymentForm(function(p) { return { ...p, package: v, price: String(PACKAGE_LABELS[v].price) }; });
                }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter — R499/mo</SelectItem>
                    <SelectItem value="growth">Growth — R999/mo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount Paid (R)</Label>
                <Input type="number" value={manualPaymentForm.price}
                  onChange={function(e) { setManualPaymentForm(function(p) { return { ...p, price: e.target.value }; }); }}
                  className="mt-1" placeholder="499" />
                <p className="text-xs text-muted-foreground mt-1">Override if custom amount was agreed</p>
              </div>
              <div>
                <Label>Payment Reference / POP *</Label>
                <Input value={manualPaymentForm.reference}
                  onChange={function(e) { setManualPaymentForm(function(p) { return { ...p, reference: e.target.value }; }); }}
                  className="mt-1" placeholder="e.g. EFT ref, Paystack ID, POP filename" />
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Input value={manualPaymentForm.notes}
                  onChange={function(e) { setManualPaymentForm(function(p) { return { ...p, notes: e.target.value }; }); }}
                  className="mt-1" placeholder="e.g. Paid via EFT on 06/06/2026" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={function() { setManualPaymentDialog(null); }}>Cancel</Button>
                <Button className="bg-green-600 hover:bg-green-700 gap-2"
                  disabled={processingId === manualPaymentDialog.id || !manualPaymentForm.reference.trim()}
                  onClick={saveManualPayment}>
                  {processingId === manualPaymentDialog.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  <CheckCheck className="w-4 h-4" /> Confirm &amp; Activate
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* APPROVE DIALOG */}
      <Dialog open={!!approveDialog} onOpenChange={function(open) { if (!open) setApproveDialog(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve &amp; generate invoice</DialogTitle></DialogHeader>
          {approveDialog && (function() {
            var pkgId = (approveDialog.subscription && approveDialog.subscription.package) || approveDialog.company.package || approveDialog.company.subscription_plan || 'starter';
            var pkg = PACKAGE_LABELS[pkgId] || PACKAGE_LABELS.starter;
            var existing = approveDialog.subscription && Number(approveDialog.subscription.price_zar) > 0 ? Number(approveDialog.subscription.price_zar) : null;
            var price = existing || pkg.price;
            return (
              <div className="space-y-4">
                <div className="bg-muted border border-border rounded-lg p-4">
                  <p className="font-semibold">{approveDialog.company.company_name}</p>
                  <p className="text-sm text-muted-foreground mt-1">{pkg.name} · R{Number(price).toLocaleString()}/month</p>
                  {existing && existing < pkg.price && (
                    <p className="text-xs text-amber-400 mt-1">Legacy rate — list price is R{pkg.price}/mo</p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">This will create an invoice and set the company to "Awaiting Payment". The client will be blocked until you mark paid.</p>
                <DialogFooter>
                  <Button variant="outline" onClick={function() { setApproveDialog(null); }}>Cancel</Button>
                  <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={processingId === approveDialog.company.id}
                    onClick={function() { approveAndInvoice(approveDialog.company, approveDialog.subscription); }}>
                    {processingId === approveDialog.company.id && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Create Invoice
                  </Button>
                </DialogFooter>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* MARK PAID DIALOG */}
      <Dialog open={!!markPaidDialog} onOpenChange={function(open) { if (!open) setMarkPaidDialog(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark invoice as paid</DialogTitle></DialogHeader>
          {markPaidDialog && (
            <form onSubmit={function(e) { e.preventDefault(); markInvoicePaid(markPaidDialog, e.target.reference.value); }} className="space-y-4">
              <div className="bg-muted border border-border rounded-lg p-4">
                <p className="font-mono font-semibold">{markPaidDialog.invoice_number}</p>
                <p className="text-sm text-muted-foreground mt-1">{markPaidDialog.companies && markPaidDialog.companies.company_name} · R{Number(markPaidDialog.amount_zar).toLocaleString()}</p>
              </div>
              <div>
                <Label htmlFor="reference">Payment reference / POP</Label>
                <Input id="reference" name="reference" placeholder="e.g. EFT reference or POP filename" required />
              </div>
              <p className="text-sm text-muted-foreground">This will activate the company immediately and start their billing cycle.</p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={function() { setMarkPaidDialog(null); }}>Cancel</Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={!!processingId}>
                  {processingId && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Mark Paid &amp; Activate
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  var colorMap = { emerald: 'text-emerald-500', amber: 'text-amber-500', orange: 'text-orange-500', blue: 'text-blue-500', red: 'text-red-500', purple: 'text-purple-500' };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          <Icon className={"w-8 h-8 " + (colorMap[color] || 'text-primary')} />
        </div>
      </CardContent>
    </Card>
  );
}
