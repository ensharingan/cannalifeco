// src/pages/SuperAdminCompliance.jsx
import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, ShieldAlert, Clock, Lock, Eye, CheckCircle2,
  XCircle, RefreshCw, Building2, Search, Store
} from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';

var DOC_LABELS = {
  cipc: 'CIPC Registration Certificate',
  director_id: 'Director / Owner ID',
  proof_of_address: 'Proof of Business Address',
  nda: 'Signed Non-Disclosure Agreement',
  onboarding_agreement: 'Signed Onboarding Agreement',
  section21_approval: 'SAHPRA Section 21 Approval',
  other: 'Other Document',
};

var FILTERS = [
  { key: 'pending_review', label: 'Awaiting Review', icon: Clock },
  { key: 'rejected', label: 'Rejected', icon: ShieldAlert },
  { key: 'approved', label: 'Verified', icon: ShieldCheck },
  { key: 'not_started', label: 'Not Started', icon: Lock },
  { key: 'all', label: 'All', icon: Building2 },
];

export default function SuperAdminCompliance() {
  var auth = useAuth();
  var [rows, setRows] = useState([]);
  var [docs, setDocs] = useState({});
  var [filter, setFilter] = useState('pending_review');
  var [search, setSearch] = useState('');
  var [loading, setLoading] = useState(true);
  var [busy, setBusy] = useState(null);
  var [expanded, setExpanded] = useState(null);

  var load = useCallback(function () {
    setLoading(true);

    var q = supabase
      .from('marketplace_compliance')
      .select('*, companies!inner(id, company_name, trading_name, email, phone, owner_phone), marketplace_suppliers(id, business_name)')
      .order('submitted_at', { ascending: true, nullsFirst: false })
      .range(0, 999);

    if (filter !== 'all') q = q.eq('status', filter);

    q.then(function (res) {
      if (res.error) throw res.error;
      setRows(res.data || []);
      setLoading(false);
    }).catch(function (err) {
      console.error('[admin compliance] load failed', err);
      setLoading(false);
    });
  }, [filter]);

  useEffect(function () { load(); }, [load]);

  function keyFor(row) {
    return row.company_id + ':' + (row.supplier_id || 'shared');
  }

  function loadDocs(row) {
    var k = keyFor(row);
    if (docs[k]) return;

    var q = supabase
      .from('compliance_documents')
      .select('*')
      .eq('company_id', row.company_id);

    q.then(function (res) {
      if (res.error) throw res.error;
      var all = res.data || [];
      // Show shared docs plus any belonging to this supplier
      var list = all.filter(function (d) {
        return !d.supplier_id || d.supplier_id === row.supplier_id;
      });
      setDocs(function (prev) {
        var next = Object.assign({}, prev);
        next[k] = list;
        return next;
      });
    }).catch(function (err) { console.error('[admin compliance] docs failed', err); });
  }

  function toggle(row) {
    var k = keyFor(row);
    if (expanded === k) {
      setExpanded(null);
    } else {
      setExpanded(k);
      loadDocs(row);
    }
  }

  function refreshDocs(row) {
    var k = keyFor(row);
    return supabase
      .from('compliance_documents')
      .select('*')
      .eq('company_id', row.company_id)
      .then(function (res) {
        if (res.error) throw res.error;
        var list = (res.data || []).filter(function (d) {
          return !d.supplier_id || d.supplier_id === row.supplier_id;
        });
        setDocs(function (prev) {
          var next = Object.assign({}, prev);
          next[k] = list;
          return next;
        });
      });
  }

  function viewDoc(doc) {
    supabase.storage
      .from('compliance-docs')
      .createSignedUrl(doc.file_path, 120)
      .then(function (res) {
        if (res.error) throw res.error;
        window.open(res.data.signedUrl, '_blank', 'noopener');
      })
      .catch(function () { alert('Could not open document.'); });
  }

  function decide(row, doc, newStatus) {
    var notes = null;
    if (newStatus === 'rejected') {
      notes = window.prompt('Reason for rejection (shown to the store):', '');
      if (notes === null) return;
    }

    setBusy(doc.id);

    supabase
      .from('compliance_documents')
      .update({
        status: newStatus,
        review_notes: notes,
        reviewed_by: auth.user ? auth.user.id : null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', doc.id)
      .then(function (res) {
        if (res.error) throw res.error;
        return refreshDocs(row);
      })
      .then(function () {
        setBusy(null);
        load();
      })
      .catch(function (err) {
        console.error('[admin compliance] decide failed', err);
        setBusy(null);
        alert(err.message || 'Could not save that decision.');
      });
  }

  function approveAll(row) {
    var k = keyFor(row);
    var list = docs[k] || [];
    var pending = list.filter(function (d) { return d.status !== 'approved'; });
    if (!pending.length) return;
    if (!window.confirm('Approve all ' + pending.length + ' document(s) and verify this store?')) return;

    setBusy(k);

    var ids = pending.map(function (d) { return d.id; });

    supabase
      .from('compliance_documents')
      .update({
        status: 'approved',
        review_notes: null,
        reviewed_by: auth.user ? auth.user.id : null,
        reviewed_at: new Date().toISOString(),
      })
      .in('id', ids)
      .then(function (res) {
        if (res.error) throw res.error;
        return refreshDocs(row);
      })
      .then(function () {
        setBusy(null);
        load();
      })
      .catch(function (err) {
        console.error('[admin compliance] approve all failed', err);
        setBusy(null);
        alert(err.message || 'Could not approve.');
      });
  }

  var term = search.trim().toLowerCase();
  var visible = rows.filter(function (r) {
    if (!term) return true;
    var c = r.companies || {};
    var s = r.marketplace_suppliers || {};
    return (
      (c.company_name || '').toLowerCase().indexOf(term) !== -1 ||
      (c.trading_name || '').toLowerCase().indexOf(term) !== -1 ||
      (c.email || '').toLowerCase().indexOf(term) !== -1 ||
      (s.business_name || '').toLowerCase().indexOf(term) !== -1
    );
  });

  var badge = {
    approved: 'bg-green-500/15 text-green-400',
    pending_review: 'bg-blue-500/15 text-blue-400',
    rejected: 'bg-red-500/15 text-red-400',
    not_started: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Marketplace Compliance</h1>
          <p className="text-sm text-muted-foreground">
            Verify store documents before granting ordering access
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={'w-4 h-4 mr-2 ' + (loading ? 'animate-spin' : '')} />
          Refresh
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(function (f) {
          var Icon = f.icon;
          return (
            <button
              key={f.key}
              onClick={function () { setFilter(f.key); setExpanded(null); }}
              className={
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ' +
                (filter === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted')
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={function (e) { setSearch(e.target.value); }}
          placeholder="Search store, email or supplier…"
          className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && !visible.length && (
        <p className="text-sm text-muted-foreground py-8 text-center">No stores in this category.</p>
      )}

      <div className="space-y-2">
        {visible.map(function (row) {
          var c = row.companies || {};
          var sup = row.marketplace_suppliers;
          var name = c.trading_name || c.company_name || 'Unnamed store';
          var k = keyFor(row);
          var list = docs[k] || [];
          var isOpen = expanded === k;

          return (
            <div key={row.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={function () { toggle(row); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
              >
                <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{name}</p>
                  <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                    {sup ? (
                      <>
                        <Store className="w-3 h-3" />
                        {sup.business_name}
                      </>
                    ) : (
                      'General verification'
                    )}
                    <span className="opacity-50">·</span>
                    {c.email || c.owner_phone || c.phone || '—'}
                  </p>
                </div>
                <span className={'rounded-full px-2 py-0.5 text-[11px] font-medium ' + (badge[row.status] || badge.not_started)}>
                  {row.status.replace('_', ' ')}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-border px-4 py-3 space-y-3">
                  {!list.length && (
                    <p className="text-xs text-muted-foreground">No documents uploaded yet.</p>
                  )}

                  {list.map(function (doc) {
                    return (
                      <div key={doc.id} className="flex items-start gap-3 rounded-lg bg-muted/20 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">
                            {DOC_LABELS[doc.doc_type] || doc.doc_type}
                            {!doc.supplier_id && (
                              <span className="ml-1.5 text-[10px] text-primary">shared</span>
                            )}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">{doc.file_name}</p>
                          {doc.expires_at && (
                            <p className="text-[11px] text-amber-400">Expires {doc.expires_at}</p>
                          )}
                          {doc.review_notes && (
                            <p className="text-[11px] text-red-300 mt-1">{doc.review_notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="sm" variant="ghost" onClick={function () { viewDoc(doc); }}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === doc.id || doc.status === 'approved'}
                            className="text-green-400 hover:bg-green-500/10"
                            onClick={function () { decide(row, doc, 'approved'); }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === doc.id}
                            className="text-red-400 hover:bg-red-500/10"
                            onClick={function () { decide(row, doc, 'rejected'); }}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {list.length > 0 && row.status !== 'approved' && (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={busy === k}
                      onClick={function () { approveAll(row); }}
                    >
                      <ShieldCheck className="w-4 h-4 mr-2" />
                      Approve all &amp; verify store
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
