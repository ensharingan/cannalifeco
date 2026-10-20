import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from '@/api/supabaseClient';
import { Eye, Search, RotateCcw, Filter, Download, TrendingUp, ShoppingCart, CreditCard, Banknote, Receipt, Users, ChevronDown, ChevronRight, Wallet, Store, AlertTriangle, ShoppingBag, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";
import { useAuth } from "@/lib/AuthContext";
import ReceiptModal from "../components/pos/ReceiptModal";
import ManagerPinDialog from "../components/orders/ManagerPinDialog";

const statusColors = {
  completed: "bg-green-500/10 text-green-500 border-green-500/20",
  pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  cancelled: "bg-red-500/10 text-red-500 border-red-500/20",
  refunded: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  unpaid: "bg-orange-500/10 text-orange-500 border-orange-500/20",
};

// A store id that cannot match any row. Used to force an empty result rather
// than letting a missing filter fall through to "every store".
const NO_STORE = "00000000-0000-0000-0000-000000000000";

// Tender names as they appear in payment_details, and how they read on screen.
const PAYMENT_LABELS = {
  cash: "Cash",
  card: "Card",
  eft: "EFT",
  mobile: "Mobile",
  voucher: "Voucher",
  store_credit: "Store credit",
  credit: "Store credit",
  account: "Account / Tab",
  split: "Other",
};

function toLocalDateStr(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function parseItems(items) {
  if (!items) return [];
  if (typeof items === 'string') {
    try { return JSON.parse(items); } catch { return []; }
  }
  return items;
}

function getPaymentGroup(method) {
  var m = (method || '').toLowerCase().trim();
  if (m === 'cash') return 'cash';
  if (['card', 'eft', 'mobile', 'credit card', 'debit card'].includes(m)) return 'card';
  if (m === 'split') return 'split';
  if (['store_credit', 'store credit', 'credit'].includes(m)) return 'store_credit';
  return 'other';
}

/* ─── Split tenders ──────────────────────────────────────────────────
 *
 * orders.payment_details is a jsonb column that holds a STRING, not an
 * object — the value is double-encoded at rest, the same way orders.items is:
 *
 *   payment_details::text  ->  "\"[{\\\"method\\\":\\\"cash\\\",\\\"amount\\\":10},…]\""
 *
 * PostgREST unwraps one layer on the way out, so the client normally receives
 * a plain string that needs ONE JSON.parse. paymentLegs unwraps up to two
 * layers anyway, so it doesn't matter whether a row arrives single- or
 * double-encoded, already parsed, or keyed by method.
 *
 * Live data uses cash, card, eft and mobile as leg methods (plus a handful of
 * legs wrongly written as "split" by the POS — those render as "Other" rather
 * than vanishing).
 */
function paymentLegs(paymentDetails) {
  if (!paymentDetails) return [];

  var value = paymentDetails;
  for (var i = 0; i < 2; i++) {
    if (typeof value !== 'string') break;
    try { value = JSON.parse(value); } catch (_) { return []; }
  }

  if (Array.isArray(value)) {
    return value
      .map(function (leg) {
        return {
          method: String((leg && (leg.method || leg.type)) || '').toLowerCase().trim(),
          amount: parseFloat(leg && (leg.amount != null ? leg.amount : leg.value)) || 0,
        };
      })
      .filter(function (leg) { return leg.method !== ''; });
  }

  // Tolerate an object shape such as { cash: 10, card: 46.2 }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .map(function (key) {
        return { method: key.toLowerCase().trim(), amount: parseFloat(value[key]) || 0 };
      })
      .filter(function (leg) { return leg.amount !== 0; });
  }

  return [];
}

function paymentLabel(method) {
  return PAYMENT_LABELS[method] || (method ? method.toUpperCase() : 'Unknown');
}

// "Cash R10.00 + Card R46.20" — for tight spaces like the table cell.
function splitSummary(order) {
  var legs = paymentLegs(order && order.payment_details);
  if (legs.length < 2) return '';
  return legs.map(function (leg) {
    return paymentLabel(leg.method) + ' ' + formatCurrency(leg.amount);
  }).join(' + ');
}

// Split orders carry the real cash/card breakdown in payment_details.
// Fall back to a 50/50 guess only if that data is missing.
function splitCashCard(order) {
  var amount = parseFloat(order.total_amount) || 0;
  var legs = paymentLegs(order.payment_details);

  if (legs.length) {
    var cash = 0, card = 0;
    for (var i = 0; i < legs.length; i++) {
      if (legs[i].method === 'cash') cash += legs[i].amount;
      else card += legs[i].amount;
    }
    return { cash: cash, card: card };
  }

  return { cash: amount / 2, card: amount / 2 };
}

/* ─── Daily Sales Summary (cash vs card per day) ────────────────── */

function DailySalesSummary({ orders }) {
  var days = useMemo(function () {
    var completed = orders.filter(function (o) { return o.status === 'completed'; });
    var byDate = {};

    for (var o of completed) {
      var dateStr = toLocalDateStr(new Date(o.created_at));
      if (!byDate[dateStr]) byDate[dateStr] = { cash: 0, card: 0, orders: 0, refunds: 0 };
      var amount = parseFloat(o.total_amount) || 0;
      var group = getPaymentGroup(o.payment_method);
      if (group === 'cash') byDate[dateStr].cash += amount;
      else if (group === 'card') byDate[dateStr].card += amount;
      else if (group === 'split') { var sp = splitCashCard(o); byDate[dateStr].cash += sp.cash; byDate[dateStr].card += sp.card; }
      byDate[dateStr].refunds += refundedAmount(o);
      byDate[dateStr].orders += 1;
    }

    return Object.entries(byDate)
      .sort(function ([a], [b]) { return b.localeCompare(a); })
      .map(function ([date, d]) {
        return {
          date,
          dateLabel: new Date(date + 'T00:00').toLocaleDateString('en-ZA', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
          }),
          cash: d.cash,
          card: d.card,
          refunds: d.refunds,
          total: d.cash + d.card - d.refunds,
          orders: d.orders,
        };
      });
  }, [orders]);

  if (days.length === 0) return null;

  var anyRefunds = days.some(function (d) { return d.refunds > 0; });

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Daily Sales Summary</h3>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Cash
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> Card
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Date</th>
              <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Orders</th>
              <th className="text-right p-3 text-xs font-semibold text-green-500">Cash</th>
              <th className="text-right p-3 text-xs font-semibold text-yellow-500">Card</th>
              {anyRefunds && <th className="text-right p-3 text-xs font-semibold text-blue-400">Refunds</th>}
              <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Net</th>
            </tr>
          </thead>
          <tbody>
            {days.map(function (d) {
              return (
                <tr key={d.date} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="p-3 text-sm font-medium">{d.dateLabel}</td>
                  <td className="p-3 text-right text-sm text-muted-foreground">{d.orders}</td>
                  <td className="p-3 text-right text-sm font-semibold text-green-500">{formatCurrency(d.cash)}</td>
                  <td className="p-3 text-right text-sm font-semibold text-yellow-500">{formatCurrency(d.card)}</td>
                  {anyRefunds && (
                    <td className="p-3 text-right text-sm font-semibold text-blue-400">
                      {d.refunds > 0 ? '-' + formatCurrency(d.refunds) : '—'}
                    </td>
                  )}
                  <td className="p-3 text-right text-sm font-bold">{formatCurrency(d.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// How much of an order has been handed back. Legacy refunds carry no
// refund_total, so a status of 'refunded' still counts as the whole order.
function refundedAmount(order) {
  var recorded = parseFloat(order.refund_total) || 0;
  if (recorded > 0) return recorded;
  if (order.status === 'refunded') return parseFloat(order.total_amount) || 0;
  return 0;
}

function isFullyRefunded(order) {
  if (order.status === 'refunded') return true;
  if (order.refund_status === 'full') return true;
  var total = parseFloat(order.total_amount) || 0;
  return total > 0 && refundedAmount(order) >= total - 0.005;
}

function isPartlyRefunded(order) {
  return !isFullyRefunded(order) && refundedAmount(order) > 0;
}

/* ─── Customer Daily Purchases View ─────────────────────────────── */

function CustomerDailyView({ orders, search }) {
  var [expandedKeys, setExpandedKeys] = useState(new Set());

  var grouped = useMemo(function () {
    var completed = orders.filter(function (o) { return o.status === 'completed'; });
    var byDate = {};

    for (var o of completed) {
      var dateStr = toLocalDateStr(new Date(o.created_at));
      if (!byDate[dateStr]) byDate[dateStr] = {};
      var memberKey = o.member_name || 'Walk-in';
      if (search && !memberKey.toLowerCase().includes(search.toLowerCase())) continue;
      if (!byDate[dateStr][memberKey]) {
        byDate[dateStr][memberKey] = { orders: [], total: 0, items: 0 };
      }
      byDate[dateStr][memberKey].orders.push(o);
      byDate[dateStr][memberKey].total += (parseFloat(o.total_amount) || 0) - refundedAmount(o);
      var parsedItems = parseItems(o.items);
      byDate[dateStr][memberKey].items += parsedItems.reduce(function (s, i) { return s + (i.quantity || 0); }, 0);
    }

    return Object.entries(byDate)
      .sort(function ([a], [b]) { return b.localeCompare(a); })
      .map(function ([date, members]) {
        return {
          date,
          dateLabel: new Date(date + 'T00:00').toLocaleDateString('en-ZA', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
          }),
          members: Object.entries(members)
            .sort(function ([, a], [, b]) { return b.total - a.total; })
            .map(function ([name, data]) { return { name, ...data }; }),
          dayTotal: Object.values(members).reduce(function (s, m) { return s + m.total; }, 0),
          dayCustomers: Object.keys(members).length,
        };
      });
  }, [orders, search]);

  function toggleExpand(key) {
    setExpandedKeys(function (prev) {
      var next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (grouped.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        {search ? 'No customers match your search' : 'No completed orders found'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {grouped.map(function (day) {
        return (
          <div key={day.date} className="rounded-xl border border-border overflow-hidden">
            <div className="bg-muted/50 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">{day.dateLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {day.dayCustomers} customer{day.dayCustomers !== 1 ? 's' : ''} · {formatCurrency(day.dayTotal)}
                </p>
              </div>
            </div>
            <div className="divide-y">
              {day.members.map(function (member) {
                var key = day.date + '::' + member.name;
                var isExpanded = expandedKeys.has(key);
                return (
                  <div key={key}>
                    <button
                      onClick={function () { toggleExpand(key); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      }
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">
                          {(member.name || '?')[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{member.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {member.orders.length} order{member.orders.length !== 1 ? 's' : ''} · {member.items} item{member.items !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <span className="text-sm font-bold">{formatCurrency(member.total)}</span>
                    </button>
                    {isExpanded && (
                      <div className="bg-muted/10 border-t border-border/50">
                        {member.orders.map(function (order) {
                          var items = parseItems(order.items);
                          var legSummary = splitSummary(order);
                          return (
                            <div key={order.id} className="px-4 py-3 ml-11 border-b border-border/30 last:border-0">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs text-muted-foreground">#{order.order_number || order.id?.slice(0, 8)}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(order.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border font-medium capitalize', statusColors[order.status] || 'bg-muted text-muted-foreground')}>
                                    {order.status}
                                  </span>
                                  {refundedAmount(order) > 0 && order.status !== 'refunded' && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium bg-blue-500/10 text-blue-400 border-blue-500/20">
                                      -{formatCurrency(refundedAmount(order))} refunded
                                    </span>
                                  )}
                                  <span className="text-xs capitalize text-muted-foreground">
                                    {order.payment_method}
                                    {legSummary && (
                                      <span className="normal-case"> ({legSummary})</span>
                                    )}
                                  </span>
                                </div>
                                <span className="text-sm font-semibold">{formatCurrency(order.total_amount)}</span>
                              </div>
                              {items.length > 0 && (
                                <div className="space-y-0.5">
                                  {items.map(function (item, i) {
                                    return (
                                      <div key={i} className="flex justify-between text-xs text-muted-foreground">
                                        <span>{item.name}{item.quantity > 1 && <span className="ml-1">× {item.quantity}</span>}</span>
                                        <span>{formatCurrency(item.price * item.quantity)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Main Orders Page ───────────────────────────────────────────── */

export default function Orders() {
  var { companyId, company } = useCompany();
  var { profile } = useAuth();

  var role = (profile && profile.role) || 'cashier';
  var isCashier = role === 'cashier' || role === 'staff';
  var profileStoreId = (profile && profile.store_id) || null;

  // Per-club POS flags. Absent key = off, so clubs without pos_settings behave
  // exactly as before.
  var ps = (company && company.pos_settings) || {};
  var hideTotals = isCashier && !!ps.hide_totals_from_cashiers;
  var historyLimit = (isCashier && Number(ps.cashier_history_limit) > 0)
    ? Number(ps.cashier_history_limit) : null;
  var canRefund = !isCashier || ps.cashier_can_refund !== false;
  var alwaysRestock = !!ps.refund_always_restock;

  var [orders, setOrders] = useState([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState("");
  var [viewOrder, setViewOrder] = useState(null);
  var [reprintReceipt, setReprintReceipt] = useState(null);
  var [statusFilter, setStatusFilter] = useState("all");
  var [preordersOnly, setPreordersOnly] = useState(false);
  var [showRefund, setShowRefund] = useState(false);
  var [refundOrder, setRefundOrder] = useState(null);
  var [refundType, setRefundType] = useState(alwaysRestock ? "return" : "full");
  var [refundMethod, setRefundMethod] = useState("cash");
  var [refundSession, setRefundSession] = useState(null);
  var [refundSessionChecked, setRefundSessionChecked] = useState(false);
  var [isRefunding, setIsRefunding] = useState(false);
  var [viewMode, setViewMode] = useState("orders");

  // ── Which store is this person allowed to see? ───────────────────────
  //
  // The open till session decides. A cashier works wherever they open the
  // day, so the session is the only thing that reliably knows the branch —
  // profiles.store_id is unset for a third of cashiers and was never kept up
  // to date when someone covered a shift elsewhere.
  //
  // Session first, profile as a fallback, and NOTHING if neither answers.
  // The previous version fell through to "all" when both were empty, which
  // showed a cashier every branch's takings under whichever store name sorted
  // first alphabetically.
  var [sessionStoreId, setSessionStoreId] = useState(null);
  var [sessionResolved, setSessionResolved] = useState(false);

  useEffect(function () {
    if (!companyId) return;
    var cancelled = false;

    var readSession = async function () {
      try {
        var authRes = await supabase.auth.getUser();
        var user = authRes.data ? authRes.data.user : null;
        if (!user) { if (!cancelled) { setSessionStoreId(null); setSessionResolved(true); } return; }
        var res = await supabase
          .from('cashier_sessions')
          .select('store_id')
          .eq('company_id', companyId)
          .eq('cashier_id', user.id)
          .eq('status', 'open')
          .order('opening_time', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        setSessionStoreId(res.data && res.data.store_id ? res.data.store_id : null);
      } catch (_) {
        if (!cancelled) setSessionStoreId(null);
      } finally {
        if (!cancelled) setSessionResolved(true);
      }
    };

    readSession();

    // Opening or closing a till mid-shift changes which branch this page is
    // reporting, so follow it live rather than needing a refresh.
    var channel = supabase.channel('orders-session-scope')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'cashier_sessions',
        filter: 'company_id=eq.' + companyId,
      }, function () { readSession(); })
      .subscribe();

    return function () { cancelled = true; supabase.removeChannel(channel); };
  }, [companyId]);

  var lockedStoreId = isCashier ? (sessionStoreId || profileStoreId) : null;
  // Cashier with no open till and no assigned store: show nothing and say why.
  var cashierUnscoped = isCashier && sessionResolved && !lockedStoreId;

  // Store filter — cashiers never control this
  var [stores, setStores] = useState([]);
  var [storeFilter, setStoreFilter] = useState("all");

  // Other filters
  // Default to TODAY so the page opens on the day's takings, not all-time
  var _todayStr = toLocalDateStr(new Date());
  var [dateFrom, setDateFrom] = useState(_todayStr);
  var [dateTo, setDateTo] = useState(_todayStr);
  var [cashierFilter, setCashierFilter] = useState("all");
  var [productFilter, setProductFilter] = useState("");
  var [showFilters, setShowFilters] = useState(false);
  var [cashiers, setCashiers] = useState([]);

  // Totals-hidden cashiers must not reach the By Customer view either — it
  // shows per-day takings.
  useEffect(function () {
    if (hideTotals && viewMode !== 'orders') setViewMode('orders');
  }, [hideTotals, viewMode]);

  // Load stores. A scoped cashier only ever needs their own store record; an
  // unscoped one gets none, so no name can be painted on an unfiltered list.
  var loadStores = useCallback(async function () {
    if (!companyId) return;
    if (isCashier && !sessionResolved) return;
    try {
      if (isCashier && !lockedStoreId) { setStores([]); return; }
      var query = supabase
        .from('stores')
        .select('id, name, type')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('name');
      if (isCashier && lockedStoreId) query = query.eq('id', lockedStoreId);
      var { data } = await query;
      setStores(data || []);
    } catch (err) {
      console.error('Failed to load stores:', err);
    }
  }, [companyId, isCashier, lockedStoreId, sessionResolved]);

  var setDatePreset = function (preset) {
    var today = new Date();
    var todayStr = toLocalDateStr(today);
    switch (preset) {
      case 'today':
        setDateFrom(todayStr); setDateTo(todayStr); break;
      case 'yesterday': {
        var y = new Date(today); y.setDate(y.getDate() - 1);
        var yStr = toLocalDateStr(y);
        setDateFrom(yStr); setDateTo(yStr); break;
      }
      case 'week': {
        var w = new Date(today); w.setDate(w.getDate() - 7);
        setDateFrom(toLocalDateStr(w)); setDateTo(todayStr); break;
      }
      case 'month': {
        var mo = new Date(today); mo.setDate(mo.getDate() - 30);
        setDateFrom(toLocalDateStr(mo)); setDateTo(todayStr); break;
      }
      case 'all': setDateFrom(""); setDateTo(""); break;
      default: break;
    }
  };

  var loadCashiers = useCallback(async function () {
    if (!companyId || isCashier) return;
    try {
      var { data: sessions } = await supabase
        .from('cashier_sessions')
        .select('cashier_id, cashier_name')
        .eq('company_id', companyId);
      if (sessions) {
        var unique = {};
        sessions.forEach(function (s) {
          if (s.cashier_id && s.cashier_name) unique[s.cashier_id] = s.cashier_name;
        });
        setCashiers(Object.entries(unique).map(function ([id, name]) { return { id, name }; }));
      }
    } catch (err) {
      console.error('Failed to load cashiers:', err);
    }
  }, [companyId, isCashier]);

  var loadOrders = useCallback(async function () {
    if (!companyId) return;
    // Don't fire until we know whether this person has a till open, or the
    // first run would go out unscoped and briefly render every store.
    if (isCashier && !sessionResolved) return;

    setLoading(true);
    try {
      // Fail CLOSED. A cashier with no resolvable store gets a filter that
      // matches nothing, never a missing filter.
      var effectiveStore = isCashier
        ? (lockedStoreId || NO_STORE)
        : storeFilter;

      // Page past PostgREST's 1000-row-per-request cap.
      var PAGE = 1000;
      var from = 0;
      var allRows = [];
      while (from < 50000) {
        var pageQuery = supabase
          .from('orders')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);

        if (dateFrom) pageQuery = pageQuery.gte('created_at', dateFrom + 'T00:00:00');
        if (dateTo) pageQuery = pageQuery.lte('created_at', dateTo + 'T23:59:59');
        if (effectiveStore && effectiveStore !== 'all') pageQuery = pageQuery.eq('store_id', effectiveStore);

        var { data: pageData, error: pageError } = await pageQuery;
        if (pageError) throw pageError;
        if (!pageData || pageData.length === 0) break;
        allRows = allRows.concat(pageData);
        if (pageData.length < PAGE) break;
        from += PAGE;
      }

      var filteredData = allRows;

      if (!isCashier && cashierFilter !== 'all') {
        var { data: cashierSessions } = await supabase
          .from('cashier_sessions')
          .select('id')
          .eq('cashier_id', cashierFilter)
          .eq('company_id', companyId);
        var sessionIds = new Set((cashierSessions || []).map(function (s) { return s.id; }));
        filteredData = filteredData.filter(function (o) {
          return sessionIds.has(o.cashier_session_id);
        });
      }

      setOrders(filteredData);
    } catch (err) {
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [companyId, dateFrom, dateTo, cashierFilter, storeFilter, isCashier, lockedStoreId, sessionResolved]);

  useEffect(function () { loadOrders(); }, [loadOrders]);
  useEffect(function () { loadCashiers(); }, [loadCashiers]);
  useEffect(function () { loadStores(); }, [loadStores]);

  // Pre-orders never touch stock or payment when placed (see
  // portal_create_preorder), so cancelling one is a plain status flip — there
  // is nothing to reverse. Fulfilling one is NOT handled here: staff ring the
  // actual sale through the normal POS checkout when the member collects
  // (that's the only place the weight-tier/bundle stock math lives), then
  // come back and cancel this placeholder so it drops off the pending count.
  var handleCancelPreorder = async function (order) {
    try {
      var { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
      if (error) throw error;
      toast.success('Pre-order cancelled');
      await loadOrders();
    } catch (err) {
      toast.error(err.message || 'Failed to cancel pre-order');
    }
  };

  /* ─── Refunds ──────────────────────────────────────────────────────
   *
   * The money has to come out of the till that is actually open NOW, not the
   * session that rang the sale up — a customer who returns something tomorrow
   * is paid from tomorrow's drawer. process_refund records the refund against
   * the session we pass here, returns the stock, reverses the batch/consignment
   * allocation and writes orders.refund_total. It deliberately does NOT flip
   * orders.status, so the original sale stays in the session that earned it.
   */
  // Cashiers and staff need a manager's PIN before a refund can be started.
  var [pinOrder, setPinOrder] = useState(null);
  var openRefund = function (order) {
    if (isCashier) { setPinOrder(order); return; }
    openRefundNow(order);
  };

  var openRefundNow = async function (order) {
    setRefundOrder(order);
    setRefundType(alwaysRestock ? 'return' : 'full');
    // A split sale has no single tender to reverse, so default to cash and let
    // the operator pick — the breakdown is shown in the dialog to guide them.
    setRefundMethod('cash');
    setRefundSession(null);
    setRefundSessionChecked(false);
    setShowRefund(true);

    // Find the till currently open at this order's branch. Prefer this user's
    // own session, otherwise any open session at that store.
    try {
      var authRes = await supabase.auth.getUser();
      var user = authRes.data ? authRes.data.user : null;

      var mine = null;
      if (user) {
        var mineRes = await supabase
          .from('cashier_sessions')
          .select('id, cashier_name, store_id')
          .eq('company_id', companyId)
          .eq('cashier_id', user.id)
          .eq('status', 'open')
          .order('opening_time', { ascending: false })
          .limit(1)
          .maybeSingle();
        mine = mineRes.data || null;
      }

      if (mine && (!order.store_id || mine.store_id === order.store_id)) {
        setRefundSession(mine);
      } else {
        var anyRes = await supabase
          .from('cashier_sessions')
          .select('id, cashier_name, store_id')
          .eq('company_id', companyId)
          .eq('status', 'open')
          .eq('store_id', order.store_id)
          .order('opening_time', { ascending: false })
          .limit(1)
          .maybeSingle();
        setRefundSession(anyRes.data || null);
      }
    } catch (_) {
      setRefundSession(null);
    } finally {
      setRefundSessionChecked(true);
    }
  };

  var handleRefund = async function () {
    if (!refundOrder) return;
    var shouldRestock = alwaysRestock ? true : refundType === 'return';
    setIsRefunding(true);
    try {
      var { data, error } = await supabase.rpc('process_refund', {
        p_order_id: refundOrder.id,
        p_cashier_session_id: refundSession ? refundSession.id : null,
        p_payment_method: refundMethod,
        p_items: null,                 // whole remaining balance
        p_restock: shouldRestock,
        p_notes: null,
        p_refunded_by: (profile && profile.id) || null,
      });
      if (error) throw error;

      var amount = data && data.amount ? data.amount : refundOrder.total_amount;
      var methodLabel = refundMethod === 'store_credit'
        ? 'added to store credit'
        : refundMethod === 'card' ? 'refunded to card' : 'paid from the till';

      toast.success(
        formatCurrency(amount) + ' ' + methodLabel +
        (shouldRestock ? ' · stock returned' : ' · stock NOT returned')
      );

      setShowRefund(false);
      setRefundOrder(null);
      await loadOrders();
    } catch (err) {
      // The RPC raises tagged errors — show the readable half.
      var msg = (err && err.message) || 'Failed to process refund';
      if (msg.indexOf('REFUND_NO_MEMBER') === 0) msg = 'Store credit needs a member on the sale. Refund this walk-in as cash or card.';
      else if (msg.indexOf('REFUND_ALREADY_FULL') === 0) msg = 'This order has already been fully refunded.';
      else if (msg.indexOf(':') > -1 && msg.indexOf('REFUND_') === 0) msg = msg.split(':').slice(1).join(':').trim();
      toast.error(msg);
    } finally {
      setIsRefunding(false);
    }
  };

  var filtered = useMemo(function () {
    return orders.filter(function (o) {
      if (statusFilter === 'refunded') {
        if (!(o.status === 'refunded' || refundedAmount(o) > 0)) return false;
      } else if (statusFilter !== 'all' && o.status !== statusFilter) {
        return false;
      }
      if (preordersOnly && o.order_type !== 'pre_order') return false;
      if (search && !(o.member_name || '').toLowerCase().includes(search.toLowerCase())) return false;
      if (productFilter) {
        var items = parseItems(o.items);
        if (!items.some(function (item) { return (item.name || '').toLowerCase().includes(productFilter.toLowerCase()); })) return false;
      }
      return true;
    });
  }, [orders, statusFilter, preordersOnly, search, productFilter]);

  // What actually renders in the table — capped for cashiers when configured.
  var visible = useMemo(function () {
    return historyLimit ? filtered.slice(0, historyLimit) : filtered;
  }, [filtered, historyLimit]);

  var stats = useMemo(function () {
    var completed = filtered.filter(function (o) { return o.status === 'completed'; });
    var grossRevenue = completed.reduce(function (sum, o) { return sum + (parseFloat(o.total_amount) || 0); }, 0);
    var refundTotal = completed.reduce(function (sum, o) { return sum + refundedAmount(o); }, 0);
    var totalRevenue = grossRevenue - refundTotal;
    var cashSales = 0, cardSales = 0, storeCreditRedeemed = 0, storeCreditOrders = 0;

    completed.forEach(function (o) {
      var amount = parseFloat(o.total_amount) || 0;
      var creditApplied = parseFloat(o.credit_applied) || 0;
      var group = getPaymentGroup(o.payment_method);
      if (group === 'cash') cashSales += amount;
      else if (group === 'card') cardSales += amount;
      else if (group === 'split') { var sp = splitCashCard(o); cashSales += sp.cash; cardSales += sp.card; }
      if (creditApplied > 0) { storeCreditRedeemed += creditApplied; storeCreditOrders += 1; }
      else if (group === 'store_credit') { storeCreditRedeemed += amount; storeCreditOrders += 1; }
    });

    var netCount = completed.length || 1;
    var itemsSold = 0;
    completed.forEach(function (o) {
      var items = parseItems(o.items);
      items.forEach(function (item) { itemsSold += item.quantity || 0; });
    });

    return {
      totalOrders: filtered.length,
      completedOrders: completed.length,
      grossRevenue, totalRevenue, refundTotal,
      cashSales, cardSales,
      storeCreditRedeemed, storeCreditOrders,
      avgOrder: completed.length ? totalRevenue / netCount : 0,
      itemsSold,
      uniqueCustomers: new Set(completed.map(function (o) { return o.member_name || 'Walk-in'; })).size,
      refunded: filtered.filter(function (o) { return o.status === 'refunded' || refundedAmount(o) > 0; }).length,
    };
  }, [filtered]);

  // The name shown on the badge, taken from the store actually being
  // filtered on — never from whichever store sorted first.
  var scopedStoreName = useMemo(function () {
    if (!lockedStoreId) return null;
    for (var i = 0; i < stores.length; i++) {
      if (stores[i].id === lockedStoreId) return stores[i].name;
    }
    return null;
  }, [stores, lockedStoreId]);

  // For owners and managers: say plainly when the figures span every branch,
  // rather than leaving a store name on screen that doesn't match the totals.
  var viewingAllStores = !isCashier && storeFilter === 'all' && stores.length > 1;

  var handleExport = function () {
    if (!filtered.length) return toast.error('No orders to export');
    // Cash and Card columns are filled for every row, not just splits, so the
    // sheet can be totalled straight into a cash-up.
    var headers = ['Order ID', 'Member', 'Payment', 'Cash', 'Card', 'Status', 'Total', 'Refunded', 'Net', 'Credit Applied', 'Date', 'Items'];
    var rows = filtered.map(function (o) {
      var items = parseItems(o.items);
      var itemStr = items.map(function (i) { return i.name + ' x' + i.quantity; }).join('; ');
      var total = parseFloat(o.total_amount || 0);
      var refunded = refundedAmount(o);
      var group = getPaymentGroup(o.payment_method);
      var cashPart = 0, cardPart = 0;
      if (group === 'cash') cashPart = total;
      else if (group === 'card') cardPart = total;
      else if (group === 'split') { var sp = splitCashCard(o); cashPart = sp.cash; cardPart = sp.card; }
      return [
        o.order_number || o.id?.slice(0, 8), o.member_name || 'Walk-in', o.payment_method,
        cashPart.toFixed(2), cardPart.toFixed(2),
        o.status,
        total.toFixed(2), refunded.toFixed(2), (total - refunded).toFixed(2),
        parseFloat(o.credit_applied || 0).toFixed(2),
        new Date(o.created_at).toLocaleString('en-ZA'), '"' + itemStr + '"',
      ];
    });
    var csv = [headers.join(','), ...rows.map(function (r) { return r.join(','); })].join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'orders_' + toLocalDateStr(new Date()) + '.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success('Orders exported');
  };

  var clearFilters = function () {
    var t = toLocalDateStr(new Date());
    setSearch(""); setStatusFilter("all"); setPreordersOnly(false); setDateFrom(t); setDateTo(t);
    setCashierFilter("all"); setProductFilter("");
    if (!isCashier) setStoreFilter("all");
  };

  var _today = toLocalDateStr(new Date());
  var isTodayOnly = dateFrom === _today && dateTo === _today;
  var hasActiveFilters = search || statusFilter !== 'all' || preordersOnly || !isTodayOnly || cashierFilter !== 'all' || productFilter || (!isCashier && storeFilter !== 'all');

  // Human label for the period currently in view
  var periodLabel = isTodayOnly
    ? 'Today'
    : (!dateFrom && !dateTo)
      ? 'All time'
      : (dateFrom === dateTo)
        ? new Date(dateFrom + 'T00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
        : (dateFrom || '…') + ' → ' + (dateTo || '…');

  var refundMemberId = refundOrder ? refundOrder.member_id : null;
  var refundRemaining = refundOrder
    ? (parseFloat(refundOrder.total_amount) || 0) - refundedAmount(refundOrder)
    : 0;
  var refundLegs = refundOrder ? paymentLegs(refundOrder.payment_details) : [];

  // Tender breakdown for the order open in the details dialog.
  var viewLegs = viewOrder ? paymentLegs(viewOrder.payment_details) : [];
  var viewLegTotal = viewLegs.reduce(function (sum, leg) { return sum + leg.amount; }, 0);
  var viewLegMismatch = viewLegs.length > 1
    && Math.abs(viewLegTotal - (parseFloat(viewOrder && viewOrder.total_amount) || 0)) > 0.01;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sales & Orders</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{periodLabel}</span>
            {!hideTotals && !cashierUnscoped && (
              <>
                {' · '}{stats.totalOrders} orders · {formatCurrency(stats.totalRevenue)} revenue
                {stats.uniqueCustomers > 0 && ' · ' + stats.uniqueCustomers + ' customers'}
              </>
            )}
            {hideTotals && historyLimit && ' · last ' + historyLimit + ' transactions'}
          </p>
        </div>
        {!hideTotals && !cashierUnscoped && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={function () { setShowFilters(!showFilters); }}>
              <Filter className="w-4 h-4" />
              Filters
              {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-primary" />}
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
              <Download className="w-4 h-4" />
              Export
            </Button>
          </div>
        )}
      </div>

      {/* No till open and no store on file — nothing can be scoped, so nothing
          is shown. Previously this state silently displayed every branch. */}
      {cashierUnscoped && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              Open your till to see today's sales
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              This page shows the sales for the store where your till is open. Head to the POS
              screen and open the day, then come back. If your till is already open, ask a manager
              to check that a store is set on your account.
            </p>
          </div>
        </div>
      )}

      {/* Store Filter Pills — owners and managers only */}
      {!isCashier && stores.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Store className="w-4 h-4 text-muted-foreground shrink-0" />
          <button
            onClick={function () { setStoreFilter('all'); }}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
              storeFilter === 'all'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground border-transparent hover:border-border'
            )}
          >
            All Stores
          </button>
          {stores.map(function (store) {
            return (
              <button
                key={store.id}
                onClick={function () { setStoreFilter(store.id); }}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
                  storeFilter === store.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-transparent hover:border-border'
                )}
              >
                {store.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Badge. Only ever rendered for a store the query is actually filtered
          on, so the name and the numbers below it always agree. */}
      {scopedStoreName && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
            <Store className="w-3.5 h-3.5" />
            {scopedStoreName}
            {sessionStoreId && <span className="opacity-70">· till open here</span>}
          </span>
        </div>
      )}

      {viewingAllStores && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
            <Store className="w-3.5 h-3.5" />
            All {stores.length} stores combined
          </span>
        </div>
      )}

      {!cashierUnscoped && (
        <>
          {/* Summary Cards — hidden when the club hides takings from cashiers */}
          {!hideTotals && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="w-4 h-4" /><span className="text-xs font-medium">Revenue</span>
                </div>
                <p className="text-xl font-bold">{formatCurrency(stats.totalRevenue)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.completedOrders} completed
                  {stats.refundTotal > 0 && ' · -' + formatCurrency(stats.refundTotal) + ' refunded'}
                </p>
              </div>
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 text-green-500 mb-1">
                  <Banknote className="w-4 h-4" /><span className="text-xs font-medium">Cash</span>
                </div>
                <p className="text-xl font-bold text-green-500">{formatCurrency(stats.cashSales)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.grossRevenue ? Math.round((stats.cashSales / stats.grossRevenue) * 100) : 0}% of sales
                </p>
              </div>
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 text-yellow-500 mb-1">
                  <CreditCard className="w-4 h-4" /><span className="text-xs font-medium">Card / EFT</span>
                </div>
                <p className="text-xl font-bold text-yellow-500">{formatCurrency(stats.cardSales)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.grossRevenue ? Math.round((stats.cardSales / stats.grossRevenue) * 100) : 0}% of sales
                </p>
              </div>
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Wallet className="w-4 h-4" /><span className="text-xs font-medium">Store Credit</span>
                </div>
                <p className="text-xl font-bold">{formatCurrency(stats.storeCreditRedeemed)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.storeCreditOrders} redemption{stats.storeCreditOrders !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <ShoppingCart className="w-4 h-4" /><span className="text-xs font-medium">Avg Order</span>
                </div>
                <p className="text-xl font-bold">{formatCurrency(stats.avgOrder)}</p>
                <p className="text-xs text-muted-foreground mt-1">{stats.itemsSold} items sold</p>
              </div>
            </div>
          )}

          {/* Daily Sales Summary — same visibility rule as the cards */}
          {!hideTotals && <DailySalesSummary orders={filtered} />}

          {/* Filters Panel */}
          {!hideTotals && showFilters && (
            <div className="bg-card rounded-xl border border-border p-4 space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Filters</h3>
                {hasActiveFilters && (
                  <button onClick={clearFilters} className="text-xs text-primary hover:underline">Clear all</button>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Quick Date</Label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { key: 'today', label: 'Today' },
                    { key: 'yesterday', label: 'Yesterday' },
                    { key: 'week', label: 'Last 7 Days' },
                    { key: 'month', label: 'Last 30 Days' },
                    { key: 'all', label: 'All Time' },
                  ].map(function (p) {
                    return (
                      <button key={p.key} onClick={function () { setDatePreset(p.key); }}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                          (!dateFrom && !dateTo && p.key === 'all') || (dateFrom === toLocalDateStr(new Date()) && dateTo === toLocalDateStr(new Date()) && p.key === 'today')
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        )}>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">From</Label>
                  <Input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value); }} className="text-sm" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
                  <Input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value); }} className="text-sm" />
                </div>
                {/* Cashiers cannot pick another cashier — that would show
                    somebody else's takings for the same store. */}
                {!isCashier && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Cashier</Label>
                    <Select value={cashierFilter} onValueChange={setCashierFilter}>
                      <SelectTrigger className="text-sm"><SelectValue placeholder="All Cashiers" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Cashiers</SelectItem>
                        {cashiers.map(function (c) {
                          return <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Product</Label>
                  <Input
                    placeholder="Search product name..."
                    value={productFilter}
                    onChange={function (e) { setProductFilter(e.target.value); }}
                    className="text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* View Mode Toggle + Search + Status */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by member..." value={search} onChange={function (e) { setSearch(e.target.value); }} className="pl-10" />
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              {!hideTotals && (
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={function () { setViewMode('orders'); }}
                    className={cn('px-3 py-2 text-xs font-medium transition-all flex items-center gap-1.5',
                      viewMode === 'orders' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <Receipt className="w-3.5 h-3.5" /> Orders
                  </button>
                  <button
                    onClick={function () { setViewMode('customers'); }}
                    className={cn('px-3 py-2 text-xs font-medium transition-all flex items-center gap-1.5',
                      viewMode === 'customers' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <Users className="w-3.5 h-3.5" /> By Customer
                  </button>
                </div>
              )}
              {viewMode === 'orders' && (
                ['all', 'pending', 'completed', 'unpaid', 'cancelled', 'refunded'].map(function (s) {
                  return (
                    <button key={s} onClick={function () { setStatusFilter(s); }}
                      className={cn('px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all',
                        statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      )}>
                      {s === 'all' ? (hideTotals ? 'All' : 'All (' + orders.length + ')') : s}
                    </button>
                  );
                })
              )}
              {viewMode === 'orders' && (
                <button
                  onClick={function () { setPreordersOnly(!preordersOnly); }}
                  className={cn('px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5',
                    preordersOnly ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  <ShoppingBag className="w-3.5 h-3.5" /> Pre-Orders
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          {viewMode === 'customers' ? (
            <CustomerDailyView orders={filtered} search={search} />
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Order</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Member</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Items</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Payment</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Date</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
                      <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Total</th>
                      <th className="text-right p-3 text-xs font-semibold text-muted-foreground"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(function (o) {
                      var items = parseItems(o.items);
                      var itemSummary = items.length > 0
                        ? items.map(function (i) { return i.name + (i.quantity > 1 ? ' ×' + i.quantity : ''); }).join(', ')
                        : '—';
                      var payGroup = getPaymentGroup(o.payment_method);
                      var payClass = payGroup === 'cash'
                        ? 'text-green-500'
                        : payGroup === 'card'
                          ? 'text-yellow-500'
                          : 'text-muted-foreground';
                      var legSummary = payGroup === 'split' ? splitSummary(o) : '';
                      var fullyRefunded = isFullyRefunded(o);
                      var partlyRefunded = isPartlyRefunded(o);
                      return (
                        <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="p-3 font-mono text-xs text-muted-foreground">{o.order_number || o.id?.slice(0, 8)}</td>
                          <td className="p-3 text-sm font-medium">
                            <div className="flex items-center gap-1.5">
                              {o.member_name || 'Walk-in'}
                              {o.order_type === 'pre_order' && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 font-medium">
                                  <ShoppingBag className="w-2.5 h-2.5" />pre-order
                                </span>
                              )}
                              {parseFloat(o.credit_applied) > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-500 border border-purple-500/20 font-medium">
                                  <Wallet className="w-2.5 h-2.5" />credit
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground hidden lg:table-cell max-w-[200px] truncate" title={itemSummary}>
                            {itemSummary}
                          </td>
                          {/* Split sales show what actually went into each tender,
                              so a cash-up doesn't need the row opened. */}
                          <td className={cn("p-3 text-sm capitalize hidden md:table-cell font-medium", payClass)}>
                            {o.payment_method}
                            {legSummary && (
                              <span className="block text-[11px] font-normal normal-case text-muted-foreground">
                                {legSummary}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground hidden md:table-cell">
                            {new Date(o.created_at).toLocaleString('en-ZA', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={cn('text-xs px-2 py-1 rounded-full border font-medium', statusColors[o.status] || 'bg-muted text-muted-foreground')}>
                                {o.status}
                              </span>
                              {o.status !== 'refunded' && fullyRefunded && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium bg-blue-500/10 text-blue-400 border-blue-500/20">
                                  refunded
                                </span>
                              )}
                              {partlyRefunded && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium bg-blue-500/10 text-blue-400 border-blue-500/20">
                                  -{formatCurrency(refundedAmount(o))}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-right text-sm font-bold">{formatCurrency(o.total_amount)}</td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {o.order_type === 'pre_order' && o.status === 'pending' && (
                                <button onClick={function () { handleCancelPreorder(o); }} className="text-muted-foreground hover:text-red-500 transition-colors" title="Cancel pre-order">
                                  <XCircle className="w-4 h-4" />
                                </button>
                              )}
                              {canRefund && o.status === 'completed' && !fullyRefunded && (
                                <button onClick={function () { openRefund(o); }} className="text-muted-foreground hover:text-blue-500 transition-colors" title="Refund / return">
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              )}
                              <button onClick={function () { setViewOrder(o); }} className="text-muted-foreground hover:text-foreground transition-colors">
                                <Eye className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!visible.length && (
                <p className="text-sm text-muted-foreground text-center py-12">
                  {hasActiveFilters ? 'No orders match your filters' : 'No orders found'}
                </p>
              )}
              {historyLimit && filtered.length > historyLimit && (
                <p className="text-xs text-muted-foreground text-center py-3 border-t border-border">
                  Showing the last {historyLimit} transactions
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* View Order Dialog */}
      <Dialog open={!!viewOrder} onOpenChange={function () { setViewOrder(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Order Details</DialogTitle></DialogHeader>
          {viewOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Order ID</span><br /><span className="font-mono text-xs">{viewOrder.id?.slice(0, 12)}</span></div>
                <div>
                  <span className="text-muted-foreground">Member</span><br />
                  {viewOrder.member_name || 'Walk-in'}
                  {viewOrder.order_type === 'pre_order' && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 font-medium align-middle">
                      <ShoppingBag className="w-2.5 h-2.5" />pre-order
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Payment</span><br />
                  <span className="capitalize">{viewOrder.payment_method}</span>
                  {viewLegs.length > 1 && (
                    <span className="block text-xs text-muted-foreground">
                      {viewLegs.map(function (leg) {
                        return paymentLabel(leg.method) + ' ' + formatCurrency(leg.amount);
                      }).join(' + ')}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span><br />
                  <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium capitalize', statusColors[viewOrder.status])}>
                    {viewOrder.status}
                  </span>
                </div>
                <div><span className="text-muted-foreground">Date</span><br />{new Date(viewOrder.created_at).toLocaleString('en-ZA')}</div>
                {viewOrder.discount_amount > 0 && (
                  <div><span className="text-muted-foreground">Discount</span><br />{formatCurrency(viewOrder.discount_amount)}</div>
                )}
                {viewOrder.credit_applied > 0 && (
                  <div>
                    <span className="text-muted-foreground">Store Credit Applied</span><br />
                    <span className="text-purple-500 font-semibold">-{formatCurrency(viewOrder.credit_applied)}</span>
                  </div>
                )}
                {refundedAmount(viewOrder) > 0 && (
                  <div>
                    <span className="text-muted-foreground">Refunded</span><br />
                    <span className="text-blue-400 font-semibold">-{formatCurrency(refundedAmount(viewOrder))}</span>
                  </div>
                )}
              </div>
              {viewOrder.items && (
                <div>
                  <p className="text-sm font-semibold mb-2">Items</p>
                  <div className="space-y-1">
                    {parseItems(viewOrder.items).map(function (item, i) {
                      return (
                        <div key={i} className="flex justify-between text-sm py-1.5 border-b border-border/50">
                          <div><span className="font-medium">{item.name}</span><span className="text-muted-foreground ml-1">× {item.quantity}</span></div>
                          <span className="font-medium">{formatCurrency(item.price * item.quantity)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* How the sale was tendered. Only shown when more than one tender
                  was used — a straight cash or card sale already says so above. */}
              {viewLegs.length > 1 && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Payment breakdown
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {viewLegs.map(function (leg, i) {
                      var isCash = leg.method === 'cash';
                      return (
                        <div key={leg.method + '-' + i} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            {isCash
                              ? <Banknote className="w-3.5 h-3.5 text-green-500" />
                              : <CreditCard className="w-3.5 h-3.5 text-yellow-500" />}
                            {paymentLabel(leg.method)}
                          </span>
                          <span className={cn('font-medium tabular-nums', isCash ? 'text-green-500' : 'text-yellow-500')}>
                            {formatCurrency(leg.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm">
                    <span className="text-muted-foreground">Tendered</span>
                    <span className="font-semibold tabular-nums">{formatCurrency(viewLegTotal)}</span>
                  </div>
                  {viewLegMismatch && (
                    <p className="mt-2 text-xs text-amber-500">
                      Tendered total does not match the order total of {formatCurrency(viewOrder.total_amount)}.
                    </p>
                  )}
                </div>
              )}

              {viewOrder.notes && (
                <div className="p-3 bg-muted rounded-lg text-sm">
                  <span className="text-muted-foreground text-xs">
                    {viewOrder.order_type === 'pre_order' ? 'Pickup notes: ' : 'Notes: '}
                  </span>
                  {viewOrder.notes}
                </div>
              )}
              <div className="flex justify-between font-bold text-lg border-t border-border pt-3">
                <span>Total</span><span>{formatCurrency(viewOrder.total_amount)}</span>
              </div>
              {viewOrder.status !== 'cancelled' && (
                <Button variant="outline" className="w-full gap-2" onClick={function () {
                  var o = viewOrder;
                  var st = stores.find(function (s) { return s.id === o.store_id; });
                  setReprintReceipt({
                    kind: 'sale',
                    reprint: true,
                    order: o,
                    items: parseItems(o.items),
                    storeName: st ? st.name : (scopedStoreName || 'Canna GQ'),
                  });
                }}>
                  <Receipt className="w-4 h-4" /> Reprint Slip
                </Button>
              )}
              {canRefund && viewOrder.status === 'completed' && !isFullyRefunded(viewOrder) && (
                <Button variant="outline" className="w-full gap-2" onClick={function () {
                  var o = viewOrder;
                  setViewOrder(null);
                  openRefund(o);
                }}>
                  <RotateCcw className="w-4 h-4" /> Process Refund / Return
                </Button>
              )}
              {viewOrder.order_type === 'pre_order' && viewOrder.status === 'pending' && (
                <Button variant="outline" className="w-full gap-2 text-red-500 hover:text-red-600" onClick={function () {
                  handleCancelPreorder(viewOrder); setViewOrder(null);
                }}>
                  <XCircle className="w-4 h-4" /> Cancel Pre-Order
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reprint slip — same modal the till uses, so print/WhatsApp behave identically */}
      <ReceiptModal receipt={reprintReceipt} onClose={function () { setReprintReceipt(null); }} />

      {/* Refund Dialog */}
      <ManagerPinDialog
        open={!!pinOrder}
        onOpenChange={function (v) { if (!v) setPinOrder(null); }}
        companyId={companyId}
        title="Manager approval for refund"
        description="Ask a manager to enter their PIN to process this refund."
        onApproved={function (approver) {
          var o = pinOrder;
          setPinOrder(null);
          toast.success("Approved by " + (approver.full_name || "manager"));
          if (o) openRefundNow(o);
        }}
      />

      <Dialog open={showRefund} onOpenChange={setShowRefund}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{alwaysRestock ? 'Return & Restock' : 'Refund / Return'}</DialogTitle></DialogHeader>
          {refundOrder && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium">{refundOrder.member_name || 'Walk-in'}</p>
                <p className="text-muted-foreground">
                  {formatCurrency(refundRemaining)} · {new Date(refundOrder.created_at).toLocaleString('en-ZA', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
                {refundedAmount(refundOrder) > 0 && (
                  <p className="text-xs text-blue-400 mt-1">
                    {formatCurrency(refundedAmount(refundOrder))} already refunded on this order
                  </p>
                )}
                {/* Say how it was paid, so the operator can match the refund to
                    the original tenders instead of guessing. */}
                {refundLegs.length > 1 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Paid as {refundLegs.map(function (leg) {
                      return paymentLabel(leg.method) + ' ' + formatCurrency(leg.amount);
                    }).join(' + ')}
                  </p>
                )}
              </div>

              {/* How the member gets their money back. This decides whether the
                  cash comes out of the drawer, goes back to the card machine,
                  or is held as credit on the member's account. */}
              <div>
                <Label>Refund as</Label>
                <Select value={refundMethod} onValueChange={setRefundMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">💵 Cash from the till</SelectItem>
                    <SelectItem value="card">💳 Back to card / EFT</SelectItem>
                    <SelectItem value="store_credit" disabled={!refundMemberId}>
                      👛 Store credit{!refundMemberId ? ' (member sales only)' : ''}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {!refundMemberId && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    This was a walk-in sale, so there is no account to credit.
                  </p>
                )}
                {refundLegs.length > 1 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    This was a split payment. The whole refund goes out on the one
                    method chosen here — process it twice if it has to go back the
                    way it came in.
                  </p>
                )}
              </div>

              {/* Clubs that always restock don't get the choice — non-stock
                  refunds are handled through Cash Out instead. */}
              {!alwaysRestock && (
                <div>
                  <Label>Stock</Label>
                  <Select value={refundType} onValueChange={setRefundType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="return">📦 Return &amp; Restock</SelectItem>
                      <SelectItem value="full">💸 Refund Only (no stock return)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Which till this comes out of. A refund is paid from the drawer
                  that is open NOW, not the one that rang up the sale. */}
              {refundSessionChecked && refundMethod !== 'store_credit' && (
                refundSession ? (
                  <p className="text-xs text-muted-foreground">
                    Recorded against the open till
                    {refundSession.cashier_name ? ' (' + refundSession.cashier_name + ')' : ''}, so it
                    comes off tonight's cash-up.
                  </p>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      No till is open at this branch, so this refund will not appear on any cash-up.
                      Open the till first if the money is leaving the drawer.
                    </p>
                  </div>
                )
              )}

              <p className="text-xs text-muted-foreground">
                {(alwaysRestock || refundType === 'return')
                  ? 'Items go back into this branch\'s stock and any consignment owed to the supplier is reduced.'
                  : 'Stock will NOT be returned — use this for damaged or unsellable goods.'}
              </p>

              <Button onClick={handleRefund} disabled={isRefunding} className="w-full gap-2">
                <RotateCcw className="w-4 h-4" />
                {isRefunding ? 'Processing...' : 'Refund ' + formatCurrency(refundRemaining)}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
