// src/pages/MarketplaceCompliance.jsx
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ShieldCheck, ShieldAlert, Clock, Upload, FileText, Trash2,
  CheckCircle2, XCircle, ArrowLeft, Lock, Eye, Download, Store, Users
} from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { useMarketplaceCompliance } from '@/lib/useMarketplaceCompliance';

var ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';
var MAX_BYTES = 10 * 1024 * 1024;

export default function MarketplaceCompliance() {
  var navigate = useNavigate();
  var auth = useAuth();
  var params = useSearchParams()[0];

  var [supplierId, setSupplierId] = useState(params.get('supplier') || '');
  var [suppliers, setSuppliers] = useState([]);
  var [busy, setBusy] = useState(null);
  var [message, setMessage] = useState(null);
  var [expiryDraft, setExpiryDraft] = useState({});

  var compliance = useMarketplaceCompliance(supplierId || undefined);

  useEffect(function () {
    supabase
      .from('marketplace_suppliers')
      .select('id, business_name')
      .eq('is_active', true)
      .order('business_name')
      .then(function (res) {
        if (res.error) return;
        setSuppliers(res.data || []);
      });
  }, []);

  function notify(type, text) {
    setMessage({ type: type, text: text });
    setTimeout(function () { setMessage(null); }, 6000);
  }

  function handleUpload(req, file) {
    if (!file) return;

    if (file.size > MAX_BYTES) {
      notify('error', 'That file is larger than 10 MB. Please compress it and try again.');
      return;
    }

    var companyId = compliance.companyId;
    if (!companyId) {
      notify('error', 'No company linked to your account.');
      return;
    }

    if (req.expires && !expiryDraft[req.doc_type]) {
      notify('error', 'Please enter the expiry date before uploading this document.');
      return;
    }

    setBusy(req.doc_type);

    var scope = req.is_shared ? 'shared' : (supplierId || 'shared');
    var ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
    var path = companyId + '/' + scope + '/' + req.doc_type + '-' + Date.now() + '.' + ext;

    supabase.storage
      .from('compliance-docs')
      .upload(path, file, { cacheControl: '3600', upsert: false })
      .then(function (res) {
        if (res.error) throw res.error;

        return supabase.from('compliance_documents').insert({
          company_id: companyId,
          supplier_id: req.is_shared ? null : (supplierId || null),
          doc_type: req.doc_type,
          file_path: path,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          status: 'pending',
          expires_at: req.expires ? expiryDraft[req.doc_type] : null,
          uploaded_by: auth.user ? auth.user.id : null,
        });
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return compliance.reload();
      })
      .then(function () {
        setBusy(null);
        notify('success', 'Document uploaded. Our team will review it shortly.');
      })
      .catch(function (err) {
        console.error('[compliance] upload failed', err);
        setBusy(null);
        notify('error', err.message || 'Upload failed. Please try again.');
      });
  }

  function handleRemove(doc) {
    if (doc.status === 'approved') return;
    if (!window.confirm('Remove this document and upload a different one?')) return;

    setBusy(doc.doc_type);

    supabase.storage
      .from('compliance-docs')
      .remove([doc.file_path])
      .then(function () {
        return supabase.from('compliance_documents').delete().eq('id', doc.id);
      })
      .then(function (res) {
        if (res && res.error) throw res.error;
        return compliance.reload();
      })
      .then(function () {
        setBusy(null);
        notify('success', 'Document removed.');
      })
      .catch(function (err) {
        console.error('[compliance] remove failed', err);
        setBusy(null);
        notify('error', err.message || 'Could not remove that document.');
      });
  }

  function handleView(doc) {
    supabase.storage
      .from('compliance-docs')
      .createSignedUrl(doc.file_path, 60)
      .then(function (res) {
        if (res.error) throw res.error;
        window.open(res.data.signedUrl, '_blank', 'noopener');
      })
      .catch(function () {
        notify('error', 'Could not open that document.');
      });
  }

  function handleTemplate(req) {
    var res = supabase.storage.from('documents').getPublicUrl(req.template_path);
    if (res && res.data && res.data.publicUrl) {
      window.open(res.data.publicUrl, '_blank', 'noopener');
    } else {
      notify('error', 'Template not available. Please contact support.');
    }
  }

  var supplierName = '';
  var i;
  for (i = 0; i < suppliers.length; i++) {
    if (suppliers[i].id === supplierId) supplierName = suppliers[i].business_name;
  }

  var statusCard = {
    not_started: {
      icon: Lock, tone: 'border-amber-500/30 bg-amber-500/10', accent: 'text-amber-400',
      title: 'Verification not started',
      body: 'Upload the documents below to unlock ordering.',
    },
    pending_review: {
      icon: Clock, tone: 'border-blue-500/30 bg-blue-500/10', accent: 'text-blue-400',
      title: 'Under review',
      body: 'All documents received. Our compliance team typically reviews within 1–2 business days.',
    },
    approved: {
      icon: ShieldCheck, tone: 'border-green-500/30 bg-green-500/10', accent: 'text-green-400',
      title: 'Verified',
      body: 'Your store is verified and can order from this supplier.',
    },
    rejected: {
      icon: ShieldAlert, tone: 'border-red-500/30 bg-red-500/10', accent: 'text-red-400',
      title: 'Action required',
      body: 'One or more documents could not be verified. See the notes below and re-upload.',
    },
  }[compliance.status] || {
    icon: Lock, tone: 'border-amber-500/30 bg-amber-500/10', accent: 'text-amber-400',
    title: 'Verification not started',
    body: 'Upload the documents below to unlock ordering.',
  };

  var StatusIcon = statusCard.icon;
  var pct = compliance.totalRequired
    ? (compliance.approvedCount / compliance.totalRequired) * 100
    : 0;

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={function () { navigate('/marketplace'); }}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Marketplace Verification</h1>
          <p className="text-sm text-muted-foreground">
            Required before your store can order from suppliers
          </p>
        </div>
      </div>

      {suppliers.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
            <Store className="w-3.5 h-3.5" /> Verifying for
          </label>
          <select
            value={supplierId}
            onChange={function (e) { setSupplierId(e.target.value); }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="">General verification (all suppliers)</option>
            {suppliers.map(function (s) {
              return <option key={s.id} value={s.id}>{s.business_name}</option>;
            })}
          </select>
          <p className="text-[11px] text-muted-foreground mt-2">
            Each supplier sets its own requirements. Documents marked
            <span className="text-primary"> shared </span>
            are uploaded once and count toward every supplier.
          </p>
        </div>
      )}

      {message && (
        <div className={
          'rounded-lg border px-4 py-3 text-sm ' +
          (message.type === 'success'
            ? 'border-green-500/30 bg-green-500/10 text-green-300'
            : 'border-red-500/30 bg-red-500/10 text-red-300')
        }>
          {message.text}
        </div>
      )}

      <div className={'rounded-xl border p-5 ' + statusCard.tone}>
        <div className="flex items-start gap-4">
          <StatusIcon className={'w-8 h-8 shrink-0 ' + statusCard.accent} />
          <div className="flex-1 min-w-0">
            <p className={'font-semibold ' + statusCard.accent}>
              {statusCard.title}
              {supplierName ? ' — ' + supplierName : ''}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{statusCard.body}</p>
            {compliance.record && compliance.record.rejection_reason && (
              <p className="text-sm text-red-300 mt-2">{compliance.record.rejection_reason}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-green-500 transition-all duration-500" style={{ width: pct + '%' }} />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {compliance.approvedCount} of {compliance.totalRequired} verified
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {compliance.resolved.map(function (item) {
          var req = item.req;
          var doc = item.doc;
          var isBusy = busy === req.doc_type;

          return (
            <div key={req.doc_type} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{req.label}</p>
                    {req.is_shared && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        <Users className="w-3 h-3" /> Shared
                      </span>
                    )}
                    {doc && doc.status === 'approved' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-400">
                        <CheckCircle2 className="w-3 h-3" /> Verified
                      </span>
                    )}
                    {doc && doc.status === 'pending' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-400">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    )}
                    {doc && doc.status === 'rejected' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">
                        <XCircle className="w-3 h-3" /> Rejected
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground mt-1">{req.hint}</p>

                  {doc && (
                    <p className="text-xs text-muted-foreground mt-2 truncate">{doc.file_name}</p>
                  )}
                  {doc && doc.expires_at && (
                    <p className="text-xs text-muted-foreground mt-1">Expires {doc.expires_at}</p>
                  )}
                  {doc && doc.status === 'rejected' && doc.review_notes && (
                    <p className="text-xs text-red-300 mt-1">Reason: {doc.review_notes}</p>
                  )}

                  {!doc && req.expires && (
                    <div className="mt-3">
                      <label className="text-[11px] text-muted-foreground block mb-1">
                        Expiry date
                      </label>
                      <input
                        type="date"
                        value={expiryDraft[req.doc_type] || ''}
                        onChange={function (e) {
                          var next = Object.assign({}, expiryDraft);
                          next[req.doc_type] = e.target.value;
                          setExpiryDraft(next);
                        }}
                        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {req.template_path && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={function () { handleTemplate(req); }}
                      >
                        <Download className="w-3.5 h-3.5 mr-1.5" /> Download template
                      </Button>
                    )}

                    {!doc && (
                      <label className={
                        'inline-flex items-center gap-2 cursor-pointer rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors ' +
                        (isBusy ? 'opacity-50 pointer-events-none' : '')
                      }>
                        <Upload className="w-3.5 h-3.5" />
                        {isBusy ? 'Uploading…' : (req.template_path ? 'Upload signed copy' : 'Upload file')}
                        <input
                          type="file"
                          accept={ACCEPT}
                          className="hidden"
                          disabled={isBusy}
                          onChange={function (e) {
                            handleUpload(req, e.target.files[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}

                    {doc && (
                      <Button size="sm" variant="outline" onClick={function () { handleView(doc); }}>
                        <Eye className="w-3.5 h-3.5 mr-1.5" /> View
                      </Button>
                    )}

                    {doc && doc.status !== 'approved' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={function () { handleRemove(doc); }}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Replace
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Documents are stored in an encrypted, private location and are visible only to your store
        and the Cannalife Co compliance team. They are used solely to verify your eligibility to trade on
        the marketplace, in line with POPIA. Contact privacy@cannalife.co.za with any questions or to
        request deletion.
      </p>
    </div>
  );
}
