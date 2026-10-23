import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from '@/api/supabaseClient';
import { Clock, Filter, Banknote, CreditCard, TrendingUp, Wallet } from "lucide-react";
import { formatCurrency } from "../lib/currency";
import { cn } from "@/lib/utils";
import { useCompany } from "../lib/CompanyContext";
import { useAuth } from "@/lib/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import ZReportModal from "../components/pos/ZReportModal";

// Methods settled through the order_payments ledger rather than on the order
// row itself. Excluded here so tab money isn't counted twice.
var LEDGER_METHODS = ['account', 'unpaid'];

function toLocalDateStr(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function emptyStat() {
  return { orders: 0, sales: 0, cash: 0, card: 0, credit: 0, tabPayments: 0, cashOut: 0 };
}

// Reconciliation figures for a session. Prefers the snapshot frozen at close
// (expected_cash / cash_variance) and falls back to a live compute for sessions
// closed before the snapshot columns existed.
function reconcile(session, stat) {
  var st = stat || {};
  var expected = (session.expected_cash != null)
    ? Number(session.expected_cash)
    : ((parseFloat(session.opening_float) || 0) + (st.cash || 0));
  var counted = (session.status === 'closed' && session.closing_float != null)
    ? Number(session.closing_float)
    : null;
  var variance = (session.cash_variance != null)
    ? Number(session.cash_variance)
    : (counted != null ? counted - expected : null);
  return { expected: expected, counted: counted, variance: variance };
}

// What the cashier physically declared at close of day.
function declared(session, stat) {
  var cash = session.closing_float != null ? Number(session.closing_float) : null;
  var card = session.closing_card_total != null ? Number(session.closing_card_total) : null;
  var cashOut = (stat && stat.cashOut) || 0;
  var any = cash != null || card != null || cashOut > 0;
  return {
    cash: cash, card: card, cashOut: cashOut,
    total: any ? ((cash || 0) + (card || 0) + cashOut) : null,
  };
}

export default function CashierSessions() {
  var { companyId, company } = useCompany();
  var { user, profile } = useAuth();

  var role = (profile && profile.role) || 'cashier';
  var isCashier = role === 'cashier';
  var myId = (user && user.id) || (profile && profile.id) || null;

  // Per-club POS flags. Absent key = off.
  var ps = (company && company.pos_settings) || {};
  var hideSessionTotals = isCashier && !!ps.hide_session_totals;
  var historyLimit = (isCashier && Number(ps.cashier_history_limit) > 0)
    ? Number(ps.cashier_history_limit) : null;

  var [sessions, setSessions] = useState([]);
  var [orderStats, setOrderStats] = useState({});
  var [zSession, setZSession] = useState(null);
  var [loading, setLoading] = useState(true);

  // Visibility is capped at the last 7 days
  var _today = new Date();
  var _weekAgo = new Date(); _weekAgo.setDate(_weekAgo.getDate() - 7);
  var _todayStr = toLocalDateStr(_today);
  var _weekAgoStr = toLocalDateStr(_weekAgo);

  var [dateFrom, setDateFrom] = useState(_weekAgoStr);
  var [dateTo, setDateTo] = useState(_todayStr);
  var [cashierFilter, setCashierFilter] = useState("all");
  var [statusFilter, setStatusFilter] = useState("all");
  var [showFilters, setShowFilters] = useState(false);

  var setDatePreset = function (preset) {
    var today = new Date();
    var todayStr = toLocalDateStr(today);
    switch (preset) {
      case 'today': setDateFrom(todayStr); setDateTo(todayStr); break;
      case 'yesterday': {
        var y = new Date(today); y.setDate(y.getDate() - 1);
        setDateFrom(toLocalDateStr(y)); setDateTo(toLocalDateStr(y)); break;
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

  var load = useCallback(async function () {
    if (!companyId) return;
    // A cashier with no resolvable id should see nothing rather than everything
    if (isCashier && !myId) { setSessions([]); setOrderStats({}); setLoading(false); return; }
    setLoading(true);
    try {
      var sessionQuery = supabase
        .from('cashier_sessions')
        .select('*')
        .eq('company_id', companyId)
        .order('opening_time', { ascending: false })
        .limit(200);
      // Hard floor: never query past the last 7 days
      var floorDate = new Date(); floorDate.setDate(floorDate.getDate() - 7);
      var floorStr = toLocalDateStr(floorDate);
      var effectiveFrom = dateFrom && dateFrom > floorStr ? dateFrom : floorStr;
      sessionQuery = sessionQuery.gte('opening_time', effectiveFrom + 'T00:00:00');
      if (dateTo) sessionQuery = sessionQuery.lte('opening_time', dateTo + 'T23:59:59');
      // Cashiers are hard-locked to their own sessions
      if (isCashier && myId) sessionQuery = sessionQuery.eq('cashier_id', myId);

      var sessRes = await sessionQuery;
      if (sessRes.error) throw sessRes.error;
      var loadedSessions = sessRes.data || [];
      setSessions(loadedSessions);

      if (!loadedSessions.length) {
        setOrderStats({});
        setLoading(false);
        return;
      }

      // Calculate live to avoid stale stored totals
      var sessionIds = loadedSessions.map(function (s) { return s.id; });

      var results = await Promise.all([
        supabase
          .from('orders')
          .select('cashier_session_id, total_amount, payment_method, credit_applied, status')
          .eq('company_id', companyId)
          .eq('status', 'completed')
          .in('cashier_session_id', sessionIds),
        // Tab payments belong to the till that physically took the money, which
        // may not be the session the tab was rung up on.
        supabase
          .from('order_payments')
          .select('cashier_session_id, amount, payment_method')
          .eq('company_id', companyId)
          .in('cashier_session_id', sessionIds),
        // Money paid out of the drawer during the shift.
        supabase
          .from('till_cash_outs')
          .select('cashier_session_id, amount')
          .eq('company_id', companyId)
          .in('cashier_session_id', sessionIds),
      ]);

      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;

      var map = {};

      (results[0].data || []).forEach(function (o) {
        var sid = o.cashier_session_id;
        if (!sid) return;
        var pm = (o.payment_method || '').toLowerCase();
        if (LEDGER_METHODS.indexOf(pm) !== -1) return; // counted via the ledger instead
        if (!map[sid]) map[sid] = emptyStat();
        map[sid].orders += 1;
        map[sid].sales += parseFloat(o.total_amount) || 0;
        map[sid].credit += parseFloat(o.credit_applied) || 0;
        if (pm === 'cash') {
          map[sid].cash += parseFloat(o.total_amount) || 0;
        } else if (pm === 'card' || pm === 'eft' || pm === 'card/eft') {
          map[sid].card += parseFloat(o.total_amount) || 0;
        } else if (pm === 'split') {
          var creditPart = parseFloat(o.credit_applied) || 0;
          var cardPart = (parseFloat(o.total_amount) || 0) - creditPart;
          map[sid].card += cardPart > 0 ? cardPart : 0;
        }
      });

      (results[1].data || []).forEach(function (p) {
        var sid = p.cashier_session_id;
        if (!sid) return;
        if (!map[sid]) map[sid] = emptyStat();
        var amount = parseFloat(p.amount) || 0;
        var pm = (p.payment_method || '').toLowerCase();
        map[sid].sales += amount;
        map[sid].tabPayments += amount;
        if (pm === 'cash') {
          map[sid].cash += amount;
        } else if (pm === 'card' || pm === 'eft' || pm === 'card/eft' || pm === 'mobile') {
          map[sid].card += amount;
        }
      });

      if (!results[2].error) {
        (results[2].data || []).forEach(function (c) {
          var sid = c.cashier_session_id;
          if (!sid) return;
          if (!map[sid]) map[sid] = emptyStat();
          map[sid].cashOut += parseFloat(c.amount) || 0;
        });
      }

      setOrderStats(map);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId, dateFrom, dateTo, isCashier, myId]);

  useEffect(function () { load(); }, [load]);

  var cashierOptions = useMemo(function () {
    var unique = {};
    sessions.forEach(function (s) {
      if (s.cashier_id && s.cashier_name) unique[s.cashier_id] = s.cashier_name;
    });
    return Object.entries(unique).map(function ([id, name]) { return { id, name }; });
  }, [sessions]);

  var filtered = useMemo(function () {
    var list = sessions.filter(function (s) {
      // Cashiers can only ever match themselves; the dropdown is hidden for them
      if (!isCashier && cashierFilter !== 'all' && s.cashier_id !== cashierFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      return true;
    });
    return historyLimit ? list.slice(0, historyLimit) : list;
  }, [sessions, cashierFilter, statusFilter, isCashier, historyLimit]);

  var stats = useMemo(function () {
    var totalSales = 0, totalOrders = 0, cashSales = 0, cardSales = 0, creditRedeemed = 0, tabPayments = 0, variance = 0;
    filtered.forEach(function (s) {
      var st = orderStats[s.id] || {};
      totalSales += st.sales || 0;
      totalOrders += st.orders || 0;
      cashSales += st.cash || 0;
      cardSales += st.card || 0;
      creditRedeemed += st.credit || 0;
      tabPayments += st.tabPayments || 0;
      if (s.status === 'closed') {
        var r = reconcile(s, st);
        if (r.variance != null) variance += r.variance;
      }
    });
    var openNow = filtered.filter(function (s) { return s.status === 'open'; }).length;
    var closed = filtered.filter(function (s) { return s.status === 'closed'; }).length;
    return { totalSales, totalOrders, cashSales, cardSales, creditRedeemed, tabPayments, variance, openNow, closed, total: filtered.length };
  }, [filtered, orderStats]);

  var isDefaultWindow = dateFrom === _weekAgoStr && dateTo === _todayStr;
  var hasActiveFilters = !isDefaultWindow || (!isCashier && cashierFilter !== 'all') || statusFilter !== 'all';
  var clearFilters = function () { setDateFrom(_weekAgoStr); setDateTo(_todayStr); setCashierFilter("all"); setStatusFilter("all"); };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  var openSessions = filtered.filter(function (s) { return s.status === 'open'; });

  return (
    <div className="p-4 lg:p-6 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isCashier ? 'My Sessions' : 'Cashier Sessions'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} session{stats.total !== 1 ? 's' : ''}
            {!hideSessionTotals && ' · ' + formatCurrency(stats.totalSales) + ' total taken'}
            {hideSessionTotals && historyLimit && ' · last ' + historyLimit + ' cash-ups'}
          </p>
        </div>
        {!hideSessionTotals && (
          <Button variant="outline" size="sm" className="gap-2 self-start" onClick={function () { setShowFilters(!showFilters); }}>
            <Filter className="w-4 h-4" />
            Filters
            {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-primary" />}
          </Button>
        )}
      </div>

      {/* Summary Cards — cash/card/variance are management-only. When the club
          hides session totals, cashiers see only how many shifts are open. */}
      <div className={cn("grid gap-3", hideSessionTotals ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-5")}>
        {!hideSessionTotals && (
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-medium">Total Taken</span>
            </div>
            <p className="text-xl font-bold">{formatCurrency(stats.totalSales)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.totalOrders} orders
              {stats.tabPayments > 0 ? ' · incl. ' + formatCurrency(stats.tabPayments) + ' tabs' : ''}
            </p>
          </div>
        )}
        {!isCashier && (
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 text-green-500 mb-1">
              <Banknote className="w-4 h-4" />
              <span className="text-xs font-medium">Cash</span>
            </div>
            <p className="text-xl font-bold text-green-500">{formatCurrency(stats.cashSales)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.totalSales ? Math.round((stats.cashSales / stats.totalSales) * 100) : 0}% of takings
            </p>
          </div>
        )}
        {!isCashier && (
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 text-yellow-500 mb-1">
              <CreditCard className="w-4 h-4" />
              <span className="text-xs font-medium">Card</span>
            </div>
            <p className="text-xl font-bold text-yellow-500">{formatCurrency(stats.cardSales)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.totalSales ? Math.round((stats.cardSales / stats.totalSales) * 100) : 0}% of takings
            </p>
          </div>
        )}
        {!isCashier && (
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Wallet className="w-4 h-4" />
              <span className="text-xs font-medium">Cash Variance</span>
            </div>
            <p className={cn("text-xl font-bold",
              Math.abs(stats.variance) < 0.005 ? "text-green-500" : stats.variance < 0 ? "text-red-500" : "text-amber-500"
            )}>
              {stats.variance < -0.005 ? "-" : ""}{formatCurrency(Math.abs(stats.variance))}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {Math.abs(stats.variance) < 0.005 ? "balanced" : stats.variance < 0 ? "short across sessions" : "over across sessions"}
            </p>
          </div>
        )}
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Clock className="w-4 h-4" />
            <span className="text-xs font-medium">Active Now</span>
          </div>
          <p className="text-xl font-bold">{stats.openNow}</p>
          <p className="text-xs text-muted-foreground mt-1">{stats.closed} closed</p>
        </div>
      </div>

      {/* Filters Panel */}
      {!hideSessionTotals && showFilters && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Filters</h3>
            {hasActiveFilters && <button onClick={clearFilters} className="text-xs text-primary hover:underline">Clear all</button>}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Quick Date</Label>
            <div className="flex gap-2 flex-wrap">
              {[
                { key: 'today', label: 'Today' },
                { key: 'yesterday', label: 'Yesterday' },
                { key: 'week', label: 'Last 7 Days' },
              ].map(function (p) {
                return (
                  <button key={p.key} onClick={function () { setDatePreset(p.key); }}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                      (dateFrom === _weekAgoStr && dateTo === _todayStr && p.key === 'week') ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
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
            {/* Cashier dropdown hidden for cashiers — they only ever see themselves */}
            {!isCashier && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Cashier</Label>
                <Select value={cashierFilter} onValueChange={setCashierFilter}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="All Cashiers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Cashiers</SelectItem>
                    {cashierOptions.map(function (c) { return <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>; })}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Active Sessions */}
      {openSessions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-green-600 mb-3">🟢 Currently Open</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {openSessions.map(function (s) {
              var st = orderStats[s.id] || {};
              return <SessionCard key={s.id} session={s} stats={st} isCashier={isCashier} hideTotals={hideSessionTotals} />;
            })}
          </div>
        </div>
      )}

      {/* Session History Table */}
      <div>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground">Session History</h2>
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Cashier</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Opened</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Closed</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Orders</th>
                  {/* Declared at close of day — what the cashier counted */}
                  <th className="text-right p-3 text-xs font-semibold text-green-500">Cash</th>
                  <th className="text-right p-3 text-xs font-semibold text-yellow-500">Card</th>
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Cash Out</th>
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Total</th>
                  {!hideSessionTotals && <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Taken</th>}
                  {!isCashier && <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Cash-up</th>}
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
                  <th className="p-3"></th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (s) {
                  var st = orderStats[s.id] || {};
                  var rec = reconcile(s, st);
                  var dec = declared(s, st);
                  return (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                            {s.cashier_name ? s.cashier_name[0] : '?'}
                          </div>
                          <span className="text-sm font-medium">{s.cashier_name || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {new Date(s.opening_time || s.created_at).toLocaleString('en-ZA', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
                        {s.closing_time ? new Date(s.closing_time).toLocaleString('en-ZA', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="p-3 text-sm">{st.orders || 0}</td>

                      <td className="p-3 text-right text-sm font-medium text-green-500">
                        {dec.cash != null ? formatCurrency(dec.cash) : <span className="text-muted-foreground font-normal">—</span>}
                      </td>
                      <td className="p-3 text-right text-sm font-medium text-yellow-500">
                        {dec.card != null ? formatCurrency(dec.card) : <span className="text-muted-foreground font-normal">—</span>}
                      </td>
                      <td className="p-3 text-right text-sm text-muted-foreground hidden md:table-cell">
                        {dec.cashOut > 0 ? formatCurrency(dec.cashOut) : '—'}
                      </td>
                      <td className="p-3 text-right text-sm font-bold">
                        {dec.total != null ? formatCurrency(dec.total) : <span className="text-muted-foreground font-normal">—</span>}
                      </td>

                      {!hideSessionTotals && (
                        <td className="p-3 text-sm font-bold">{formatCurrency(st.sales || 0)}</td>
                      )}
                      {!isCashier && (
                        <td className="p-3 text-xs">
                          {s.status === 'closed' && rec.counted != null ? (
                            <div>
                              <div className="text-muted-foreground">
                                {formatCurrency(rec.counted)} <span className="opacity-60">/ {formatCurrency(rec.expected)} exp</span>
                              </div>
                              {rec.variance != null && (
                                Math.abs(rec.variance) < 0.005
                                  ? <div className="text-green-500 font-medium">Balanced</div>
                                  : <div className={rec.variance < 0 ? "text-red-500 font-medium" : "text-amber-500 font-medium"}>
                                      {rec.variance < 0 ? "Short " : "Over "}{formatCurrency(Math.abs(rec.variance))}
                                    </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      <td className="p-3">
                        <span className={cn('text-xs px-2 py-1 rounded-full border font-medium',
                          s.status === 'open'
                            ? 'bg-green-500/10 text-green-500 border-green-500/20'
                            : 'bg-muted text-muted-foreground border-border'
                        )}>{s.status}</span>
                      </td>
                      <td className="p-3">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={function () { setZSession(s); }}>
                          {s.status === 'closed' ? 'Z Report' : 'Day End'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <p className="text-sm text-muted-foreground text-center py-10">
              {hasActiveFilters ? 'No sessions match your filters' : 'No sessions recorded yet'}
            </p>
          )}
          {historyLimit && sessions.length > historyLimit && (
            <p className="text-xs text-muted-foreground text-center py-3 border-t border-border">
              Showing the last {historyLimit} cash-ups
            </p>
          )}
        </div>
      </div>
      <ZReportModal open={!!zSession} sessionId={zSession ? zSession.id : null} onClose={function () { setZSession(null); }} />
    </div>
  );
}

function SessionCard({ session, stats, isCashier, hideTotals }) {
  var duration = Math.floor((new Date() - new Date(session.opening_time || session.created_at)) / 3600000);
  return (
    <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-sm font-semibold">{session.cashier_name}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          <span className="block">Opened</span>
          <span className="text-foreground font-medium">
            {new Date(session.opening_time || session.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })} · {duration}h ago
          </span>
        </div>
        <div>
          <span className="block">Float</span>
          <span className="text-foreground font-medium">{formatCurrency(session.opening_float || 0)}</span>
        </div>
        {!hideTotals && (
          <div>
            <span className="block">Taken</span>
            <span className="text-foreground font-medium">{formatCurrency(stats.sales || 0)}</span>
          </div>
        )}
        <div>
          <span className="block">Orders</span>
          <span className="text-foreground font-medium">{stats.orders || 0}</span>
        </div>
        {!isCashier && (
          <div>
            <span className="block">Cash / Card</span>
            <span className="text-foreground font-medium">
              <span className="text-green-500">{formatCurrency(stats.cash || 0)}</span> / <span className="text-yellow-500">{formatCurrency(stats.card || 0)}</span>
            </span>
          </div>
        )}
        {(stats.cashOut || 0) > 0 && (
          <div>
            <span className="block">Cash Out</span>
            <span className="text-foreground font-medium">{formatCurrency(stats.cashOut)}</span>
          </div>
        )}
        {!hideTotals && (stats.tabPayments || 0) > 0 && (
          <div>
            <span className="block">Tab Payments</span>
            <span className="text-purple-400 font-medium">{formatCurrency(stats.tabPayments)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
