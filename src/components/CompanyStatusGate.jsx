import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { supabase } from '@/api/supabaseClient';
import { RefreshCw, LogOut } from 'lucide-react';

// CompanyStatusGate — Canna Life Co white-label build.
//
// The Budify original gates access on subscription state: trial countdown,
// overdue banner, expired-trial paywall, suspended screen, all pointing at
// Paystack. None of that applies here. Canna Life Co licenses the platform as a whole
// and bills its franchisees itself, so there is no per-club subscription for
// the app to check and nothing it could usefully wall someone out over. A
// franchisee locked out of their own till by a billing state Canna Life Co manages
// outside this system would be a support call, not a payment.
//
// What remains is the one check that is still real: does this user belong to a
// company? That is answered against the database rather than trusted from
// context, because a cold browser can resolve CompanyContext to null while the
// session is still restoring, and a wrongly-shown setup form lets an existing
// owner create a duplicate company.

const VERIFY_ATTEMPTS = 3;
const VERIFY_DELAY_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads company_id straight from the authenticated user's own profile row.
 * Returns { ok, companyId }:
 *   ok=false → no trustworthy answer (no session yet, network error, RLS
 *              error). Never treat this as "no company".
 *   ok=true, companyId=null → confirmed: this user genuinely has no company.
 */
async function readCompanyIdFromDb() {
  try {
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (userErr || !uid) return { ok: false, companyId: null };

    const { data, error } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', uid)
      .maybeSingle();

    if (error) return { ok: false, companyId: null };
    if (!data) return { ok: false, companyId: null };
    return { ok: true, companyId: data.company_id ?? null };
  } catch {
    return { ok: false, companyId: null };
  }
}

export default function CompanyStatusGate({ children }) {
  const { profile, isAuthenticated } = useAuth();
  const { companyId, company, loading: companyLoading } = useCompany();
  const navigate = useNavigate();
  const [gateState, setGateState] = useState({ status: 'loading' });
  const [verifiedCompanyId, setVerifiedCompanyId] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const verifyingRef = useRef(false);

  // Any of these is proof the user belongs to a company.
  const effectiveCompanyId =
    companyId || company?.id || profile?.company_id || verifiedCompanyId || null;

  const retry = useCallback(() => {
    setVerifiedCompanyId(null);
    setGateState({ status: 'loading' });
    setRetryToken((t) => t + 1);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.href = '/#/login';
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated || !profile?.id) {
      setGateState({ status: 'pass' });
      return;
    }

    // Superadmins run the platform — they never need a company of their own.
    if (profile?.role === 'superadmin') {
      setGateState({ status: 'pass' });
      return;
    }

    if (effectiveCompanyId) {
      setGateState({ status: 'pass' });
      return;
    }

    // Still resolving and nothing to go on yet — wait, don't decide.
    if (companyLoading) {
      setGateState({ status: 'loading' });
      return;
    }

    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setGateState({ status: 'loading' });

    (async () => {
      try {
        for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
          const { ok, companyId: dbId } = await readCompanyIdFromDb();
          if (cancelled) return;

          if (ok && dbId) {
            // CompanyContext was late. Self-heal and carry on.
            setVerifiedCompanyId(dbId);
            return;
          }
          if (ok && !dbId) {
            setGateState({ status: 'no_company' });
            return;
          }
          if (attempt < VERIFY_ATTEMPTS) await sleep(VERIFY_DELAY_MS);
        }
        // Never silently dump an existing owner on the setup form.
        if (!cancelled) setGateState({ status: 'unavailable' });
      } finally {
        verifyingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, profile, companyLoading, effectiveCompanyId, retryToken]);

  // Redirect from an effect, never during render.
  useEffect(() => {
    if (gateState.status === 'no_company') {
      navigate('/setup', { replace: true });
    }
  }, [gateState.status, navigate]);

  if (gateState.status === 'loading' || gateState.status === 'no_company') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (gateState.status === 'unavailable') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-slate-500/10 border border-slate-500/30 flex items-center justify-center mx-auto">
            <RefreshCw className="w-8 h-8 text-slate-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Can't load your store right now</h1>
            <p className="text-slate-400 text-sm leading-relaxed">
              Your login worked, but we couldn't reach your store details. This is usually a
              connection hiccup. Try again — your data is safe.
            </p>
          </div>
          <div className="space-y-3">
            <button
              onClick={retry}
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-base transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
            <button
              onClick={signOut}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-300 text-sm transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              Log out and back in
            </button>
          </div>
          <p className="text-xs text-slate-600">
            Still stuck? Contact support — don't create a new company.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
