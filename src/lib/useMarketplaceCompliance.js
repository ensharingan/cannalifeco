// src/lib/useMarketplaceCompliance.js
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';

// Fallback list used when a supplier has no requirement rows of its own.
export var BASELINE_DOCS = [
  {
    doc_type: 'cipc',
    label: 'CIPC Registration Certificate',
    hint: 'Your company registration document from CIPC (CoR 14.3 or similar).',
    is_shared: true,
    template_path: null,
    expires: false,
    sort_order: 1,
  },
  {
    doc_type: 'director_id',
    label: 'Director / Owner ID Document',
    hint: 'A clear copy of the ID or passport of a listed director or the club owner.',
    is_shared: true,
    template_path: null,
    expires: false,
    sort_order: 2,
  },
  {
    doc_type: 'proof_of_address',
    label: 'Proof of Business Address',
    hint: 'Lease agreement, municipal bill or bank statement no older than 3 months.',
    is_shared: true,
    template_path: null,
    expires: false,
    sort_order: 3,
  },
];

// Kept for backwards compatibility with earlier imports.
export var REQUIRED_DOCS = BASELINE_DOCS;

/**
 * Compliance state for one club against one supplier.
 * Pass a supplierId to get that supplier's own requirement list.
 * Pass nothing to get the shared platform baseline.
 */
export function useMarketplaceCompliance(supplierId) {
  var auth = useAuth();
  var company = useCompany();
  var profile = auth.profile;
  var companyId = company.companyId || (profile ? profile.company_id : null);

  var [requirements, setRequirements] = useState(BASELINE_DOCS);
  var [documents, setDocuments] = useState([]);
  var [record, setRecord] = useState(null);
  var [status, setStatus] = useState('not_started');
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);

  var load = useCallback(function () {
    if (!companyId) {
      setLoading(false);
      return Promise.resolve();
    }
    setLoading(true);
    setError(null);

    var reqQuery = supplierId
      ? supabase
          .from('marketplace_supplier_requirements')
          .select('*')
          .eq('supplier_id', supplierId)
          .eq('is_required', true)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null });

    var compQuery = supabase
      .from('marketplace_compliance')
      .select('*')
      .eq('company_id', companyId);

    var docsQuery = supabase
      .from('compliance_documents')
      .select('*')
      .eq('company_id', companyId)
      .order('uploaded_at', { ascending: true });

    return Promise.all([reqQuery, compQuery, docsQuery]).then(function (results) {
      var reqs = results[0];
      var comp = results[1];
      var docs = results[2];

      if (reqs.error) throw reqs.error;
      if (comp.error) throw comp.error;
      if (docs.error) throw docs.error;

      var reqList = (reqs.data && reqs.data.length) ? reqs.data : BASELINE_DOCS;
      setRequirements(reqList);
      setDocuments(docs.data || []);

      var rows = comp.data || [];
      var match = null;
      var i;
      for (i = 0; i < rows.length; i++) {
        if (supplierId && reqs.data && reqs.data.length) {
          if (rows[i].supplier_id === supplierId) { match = rows[i]; break; }
        } else if (!rows[i].supplier_id) {
          match = rows[i]; break;
        }
      }

      setRecord(match);
      setStatus(match ? match.status : 'not_started');
      setLoading(false);
    }).catch(function (err) {
      console.error('[compliance] load failed', err);
      setError(err.message || 'Could not load compliance status.');
      setLoading(false);
    });
  }, [companyId, supplierId]);

  useEffect(function () { load(); }, [load]);

  // Resolve which uploaded document satisfies each requirement.
  function docFor(req) {
    var i;
    for (i = 0; i < documents.length; i++) {
      var d = documents[i];
      if (d.doc_type !== req.doc_type) continue;
      if (req.is_shared && !d.supplier_id) return d;
      if (!req.is_shared && supplierId && d.supplier_id === supplierId) return d;
      if (!req.is_shared && !supplierId && !d.supplier_id) return d;
    }
    return null;
  }

  var resolved = requirements.map(function (r) {
    return { req: r, doc: docFor(r) };
  });

  var approvedCount = resolved.filter(function (x) {
    return x.doc && x.doc.status === 'approved';
  }).length;

  var missing = resolved.filter(function (x) { return !x.doc; });

  return {
    companyId: companyId,
    supplierId: supplierId || null,
    requirements: requirements,
    resolved: resolved,
    documents: documents,
    docFor: docFor,
    status: status,
    isApproved: status === 'approved',
    record: record,
    approvedCount: approvedCount,
    totalRequired: requirements.length,
    missing: missing,
    loading: loading,
    error: error,
    reload: load,
  };
}

export default useMarketplaceCompliance;
