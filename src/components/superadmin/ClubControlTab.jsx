import { supabase } from '@/api/supabaseClient';
import { useState, useEffect, useMemo, useCallback } from "react";
import { Search, ArrowUpDown, RefreshCw, AlertTriangle } from "lucide-react";
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

/*
 * ─── CLUB CONTROL TAB ───────────────────────────────────────────────────
 * Live, sortable, filterable overview of every club on the platform —
 * status, plan, fee, stores, members, joined date — in one dense table.
 *
 * store_count / member_count come from admin_club_overview(), a
 * SECURITY DEFINER RPC. The `stores` and `members` tables are RLS-scoped
 * to `company_id = get_my_company_id()`, so a superadmin session cannot
 * read counts across every company directly — the RPC re-checks the
 * caller is superadmin/admin server-side and returns the aggregates.
 *
 * `companies` is passed in from the parent (already loaded there) so this
 * tab does not duplicate that fetch — it only adds the one extra RPC call
 * for the counts.
 */

const FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'active',    label: 'Active' },
  { key: 'trial',     label: 'Trial' },
  { key: 'overdue',   label: 'Overdue' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'pending',   label: 'Pending' },
  { key: 'mismatch',  label: '⚠ Plan mismatch' },
];

const STATUS_STYLE = {
  active:          'bg-green-500/10 text-green-400',
  trial:           'bg-blue-500/10 text-blue-400',
  overdue:         'bg-amber-500/10 text-amber-400',
  suspended:       'bg-red-500/10 text-red-400',
  pending:         'bg-muted text-muted-foreground',
  pending_payment: 'bg-muted text-muted-foreground',
  paused:          'bg-muted text-muted-foreground',
};

function normStatus(c) {
  var s = (c.subscription_status || c.status || '').toLowerCase();
  return s === 'pending_payment' ? 'pending' : (s || 'unknown');
}

function isMismatch(c) {
  if (c.package && c.subscription_plan && c.package !== c.subscription_plan) return true;
  if (c.subscription_plan === 'growth' && Number(c.monthly_fee || 0) === 499) return true;
  return false;
}

function fmtDate(s) {
  if (!s) return '—';
  var d = new Date(s);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMoney(v) {
  var n = Number(v || 0);
  return n === 0 ? '—' : 'R' + n.toLocaleString('en-ZA');
}

export default function ClubControlTab({ companies, onRefresh }) {
  var [counts, setCounts] = useState({});
  var [loadingCounts, setLoadingCounts] = useState(true);
  var [search, setSearch] = useState('');
  var [filter, setFilter] = useState('all');
  var [sortKey, setSortKey] = useState('created_at');
  var [sortDir, setSortDir] = useState(-1);
  var [refreshing, setRefreshing] = useState(false);

  var loadCounts = useCallback(async function () {
    setLoadingCounts(true);
    try {
      var res = await supabase.rpc('admin_club_overview');
      if (res.error) throw new Error(res.error.message);
      var map = {};
      (res.data || []).forEach(function (row) {
        map[row.company_id] = { stores: row.store_count, members: row.member_count };
      });
      setCounts(map);
    } catch (err) {
      toast.error('Could not load club counts: ' + err.message);
    } finally {
      setLoadingCounts(false);
    }
  }, []);

  useEffect(function () { loadCounts(); }, [loadCounts]);

  var handleRefresh = async function () {
    setRefreshing(true);
    try {
      if (onRefresh) await onRefresh();
      await loadCounts();
      toast.success('Club Control refreshed');
    } finally {
      setRefreshing(false);
    }
  };

  var rows = useMemo(function () {
    var list = (companies || []).map(function (c) {
      var count = counts[c.id] || { stores: 0, members: 0 };
      return Object.assign({}, c, { store_count: count.stores, member_count: count.members });
    });

    if (filter === 'mismatch') {
      list = list.filter(isMismatch);
    } else if (filter !== 'all') {
      list = list.filter(function (c) { return normStatus(c) === filter; });
    }

    if (search) {
      var t = search.toLowerCase();
      list = list.filter(function (c) {
        return (c.company_name || '').toLowerCase().includes(t) ||
               (c.trading_name || '').toLowerCase().includes(t);
      });
    }

    list.sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'monthly_fee' || sortKey === 'store_count' || sortKey === 'member_count') {
        av = Number(av || 0); bv = Number(bv || 0);
      } else if (sortKey === 'next_payment_due' || sortKey === 'created_at') {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      } else {
        av = (av || '').toString().toLowerCase();
        bv = (bv || '').toString().toLowerCase();
      }
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });

    return list;
  }, [companies, counts, filter, search, sortKey, sortDir]);

  var stats = useMemo(function () {
    var all = companies || [];
    var active = all.filter(function (c) { return normStatus(c) === 'active'; });
    var trial = all.filter(function (c) { return normStatus(c) === 'trial'; }).length;
    var overdue = all.filter(function (c) { return normStatus(c) === 'overdue'; }).length;
    var suspended = all.filter(function (c) { return normStatus(c) === 'suspended'; }).length;
    var mrr = active.reduce(function (sum, c) { return sum + Number(c.monthly_fee || 0); }, 0);
    return { total: all.length, active: active.length, trial: trial, overdue: overdue, suspended: suspended, mrr: mrr };
  }, [companies]);

  function toggleSort(key) {
    if (sortKey === key) { setSortDir(function (d) { return d * -1; }); }
    else { setSortKey(key); setSortDir(1); }
  }

  var columns = [
    { key: 'company_name',      label: 'Club' },
    { key: 'subscription_status', label: 'Status' },
    { key: 'subscription_plan', label: 'Plan' },
    { key: 'monthly_fee',       label: 'Fee', align: 'right' },
    { key: 'next_payment_due',  label: 'Next due' },
    { key: 'store_count',       label: 'Stores', align: 'right' },
    { key: 'member_count',      label: 'Members', align: 'right' },
    { key: 'created_at',        label: 'Joined' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <button onClick={function () { setFilter('all'); }} className={`text-left bg-card border rounded-xl p-4 transition-colors ${filter === 'all' ? 'border-primary/50' : 'border-border hover:border-primary/30'}`}>
          <p className="text-2xl font-bold">{stats.total}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Total clubs</p>
        </button>
        <button onClick={function () { setFilter('active'); }} className={`text-left bg-card border rounded-xl p-4 transition-colors ${filter === 'active' ? 'border-green-500/50' : 'border-border hover:border-green-500/30'}`}>
          <p className="text-2xl font-bold text-green-400">{stats.active}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Active</p>
        </button>
        <button onClick={function () { setFilter('trial'); }} className={`text-left bg-card border rounded-xl p-4 transition-colors ${filter === 'trial' ? 'border-blue-500/50' : 'border-border hover:border-blue-500/30'}`}>
          <p className="text-2xl font-bold text-blue-400">{stats.trial}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Trial</p>
        </button>
        <button onClick={function () { setFilter('overdue'); }} className={`text-left bg-card border rounded-xl p-4 transition-colors ${filter === 'overdue' ? 'border-amber-500/50' : 'border-border hover:border-amber-500/30'}`}>
          <p className="text-2xl font-bold text-amber-400">{stats.overdue}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Overdue</p>
        </button>
        <button onClick={function () { setFilter('suspended'); }} className={`text-left bg-card border rounded-xl p-4 transition-colors ${filter === 'suspended' ? 'border-red-500/50' : 'border-border hover:border-red-500/30'}`}>
          <p className="text-2xl font-bold text-red-400">{stats.suspended}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Suspended</p>
        </button>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-2xl font-bold text-primary">R{stats.mrr.toLocaleString('en-ZA')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">MRR (active only)</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder="Search club, trading name…" className="pl-10" />
        </div>
        {FILTERS.map(function (f) {
          var isOn = filter === f.key;
          return (
            <button key={f.key} onClick={function () { setFilter(f.key); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${isOn ? 'bg-primary/10 text-primary border-primary/30' : 'bg-card text-muted-foreground border-border hover:border-primary/30'}`}>
              {f.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">{rows.length} of {companies.length} clubs{loadingCounts ? ' · loading counts…' : ''}</span>
        <button onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30 text-muted-foreground border border-border text-xs font-medium hover:border-primary/30 hover:text-primary transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
            <tr>
              {columns.map(function (col) {
                return (
                  <th key={col.key} onClick={function () { toggleSort(col.key); }}
                    className={`px-4 py-3 cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'} ${sortKey === col.key ? 'text-primary' : ''}`}>
                    <span className="inline-flex items-center gap-1">{col.label}{sortKey === col.key && <ArrowUpDown className="w-3 h-3" />}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">No clubs match this filter</td></tr>
            ) : rows.map(function (c) {
              var status = normStatus(c);
              var mismatch = isMismatch(c);
              return (
                <tr key={c.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="font-medium flex items-center gap-1.5">
                      {c.company_name}
                      {mismatch && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" title="Plan/package mismatch — billing may not match plan" />}
                    </div>
                    {c.trading_name && c.trading_name !== c.company_name && (
                      <div className="text-xs text-muted-foreground mt-0.5">t/a {c.trading_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[status] || 'bg-muted text-muted-foreground'}`}>{status}</span>
                    {c.grace_period_ends_at && (
                      <div className="text-[10px] text-red-400 mt-1">grace ends {fmtDate(c.grace_period_ends_at)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground capitalize">
                    {c.subscription_plan || '—'}
                    {c.package && c.package !== c.subscription_plan && <span className="text-amber-400"> / pkg:{c.package}</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{fmtMoney(c.monthly_fee)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(c.next_payment_due)}</td>
                  <td className="px-4 py-3 text-right">{loadingCounts ? '…' : (c.store_count ?? 0)}</td>
                  <td className="px-4 py-3 text-right">{loadingCounts ? '…' : Number(c.member_count ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(c.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Store and member counts come from <code className="bg-muted px-1 py-0.5 rounded">admin_club_overview()</code>, a superadmin-only RPC.
        Plan mismatch flags a club where <code className="bg-muted px-1 py-0.5 rounded">package</code> differs from <code className="bg-muted px-1 py-0.5 rounded">subscription_plan</code>, or a growth-plan club still billed at the R499 starter rate.
      </p>
    </div>
  );
}
