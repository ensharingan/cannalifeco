import { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { Check, Loader2, Upload, X, ExternalLink, Clock, CreditCard, ArrowRight, Sparkles, Handshake } from 'lucide-react';

// Partner referral codes arrive as ?ref=XXXXXXXX. We stash the code the moment
// the page loads rather than reading it at submit time: the visitor may sit on
// this form for a while, reload, or bounce through email verification, and the
// query string does not always survive that.
const REF_KEY = 'cannalife_referral_code';

function readReferralCode(searchParams) {
  // Canonical form, inside the hash: /#/signup?ref=CODE
  const fromHash = searchParams.get('ref');
  if (fromHash) return fromHash;
  // Fallback: someone put ?ref= before the '#'. HashRouter never sees that,
  // so read the raw location instead of losing the attribution.
  try {
    const fromSearch = new URLSearchParams(window.location.search).get('ref');
    if (fromSearch) return fromSearch;
  } catch (_) {}
  return '';
}

// ---------------------------------------------------------------------------
// Phone handling
//
// The Phone field used to accept literally any string, which is how we ended up
// with an email address and a person's name sitting in companies.phone (and
// then copied into the CRM by the push_trial_to_crm trigger). Everything below
// exists so that only a real South African number can reach the database.
// ---------------------------------------------------------------------------

// Characters a person might legitimately type while entering a phone number.
// Applied on every keystroke so letters and '@' simply never appear.
const PHONE_ALLOWED = /[^0-9+()\s-]/g;

function sanitisePhoneInput(value) {
  return value.replace(PHONE_ALLOWED, '').slice(0, 20);
}

// Normalise to the local SA format we store: 0XXXXXXXXX (10 digits).
// Returns '' when the input cannot be read as a valid SA number.
function normaliseSAPhone(raw) {
  if (!raw) return '';

  // Strip every separator. Keep a leading '+' only so we can spot +27.
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  // Drop a trunk zero written after the country code, e.g. +27(0)71 234 5678.
  const stripTrunkZero = (rest) => (rest.startsWith('0') ? rest.slice(1) : rest);

  let local = '';

  if (digits.startsWith('27') && (hasPlus || digits.length === 11 || digits.length === 12)) {
    // +27 71 234 5678  /  27712345678  /  +27(0)71 234 5678
    local = '0' + stripTrunkZero(digits.slice(2));
  } else if (digits.startsWith('0027')) {
    // 0027 71 234 5678 — international prefix typed out
    local = '0' + stripTrunkZero(digits.slice(4));
  } else if (digits.startsWith('0')) {
    // 071 234 5678
    local = digits;
  } else if (digits.length === 9) {
    // 71 234 5678 — leading zero omitted
    local = '0' + digits;
  } else {
    return '';
  }

  // SA numbers are 10 digits in local form and never start 00 or 01.
  if (local.length !== 10) return '';
  if (!/^0[1-8]\d{8}$/.test(local)) return '';

  return local;
}

// Pretty form for display on receipts and the CRM: 071 234 5678
function formatSAPhone(local) {
  if (!local || local.length !== 10) return local || '';
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

const PACKAGES = [
  {
    id: 'starter',
    name: 'Starter',
    price: 499,
    cycle: 'per month',
    billing_cycle: 'monthly',
    paymentLink: 'https://checkout.paycloud.africa/en-US/checkout?i=110001099&m=342600164487&tn=L4178876788110125318',
    features: ['Single store', 'Unlimited products', 'Member management', 'Loyalty system', 'Reports & analytics'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 999,
    cycle: 'per month',
    billing_cycle: 'monthly',
    popular: true,
    paymentLink: 'https://checkout.paycloud.africa/en-US/checkout?i=110001099&m=342600164487&tn=L4178876811310125319',
    features: ['Up to 5 stores', 'Everything in Starter', 'Multi-store inventory', 'Staff performance tracking', 'Priority support'],
  },
];

export default function Signup() {
  const [searchParams] = useSearchParams();
  const successFromUrl = searchParams.get('success') === '1';
  const emailFromUrl = searchParams.get('email') || '';

  const [selectedPackage, setSelectedPackage] = useState('growth');
  const [signupMode, setSignupMode] = useState('trial');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [referral, setReferral] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState('');
  const signingUp = useRef(false);
  const [form, setForm] = useState({
    company_name: '',
    owner_name: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
  });

  useEffect(() => {
    const code = readReferralCode(searchParams);
    if (code) {
      const clean = code.trim().toUpperCase();
      setReferral(clean);
      try { sessionStorage.setItem(REF_KEY, clean); } catch (_) {}
      return;
    }
    try {
      const saved = sessionStorage.getItem(REF_KEY);
      if (saved) setReferral(saved);
    } catch (_) {}
  }, [searchParams]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      // Filter on the way in — letters and '@' never make it into state.
      setForm({ ...form, phone: sanitisePhoneInput(value) });
      setPhoneError('');
    } else {
      setForm({ ...form, [name]: value });
    }
    setError('');
  };

  // Validate once the visitor leaves the field, so they get told immediately
  // rather than at submit time.
  const handlePhoneBlur = () => {
    if (!form.phone) { setPhoneError(''); return; }
    setPhoneError(normaliseSAPhone(form.phone) ? '' : 'Enter a valid SA number, e.g. 071 234 5678');
  };

  const handleLogoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be under 2MB');
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (signingUp.current) return;
    setError('');
    setPhoneError('');

    if (!form.email) { setError('Email is required'); return; }
    if (!form.phone) { setError('Phone number is required'); return; }

    // Hard gate: nothing that isn't a real SA number gets past this point.
    const phoneLocal = normaliseSAPhone(form.phone);
    if (!phoneLocal) {
      setPhoneError('Enter a valid SA number, e.g. 071 234 5678');
      setError('Please enter a valid South African phone number.');
      return;
    }

    if (form.password !== form.confirm_password) { setError('Passwords do not match'); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }

    // Single canonical value used for every write below.
    const phoneToStore = formatSAPhone(phoneLocal);

    setLoading(true);
    signingUp.current = true;

    try {
      const pkg = PACKAGES.find((p) => p.id === selectedPackage);

      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { full_name: form.owner_name, phone: phoneToStore } },
      });
      if (authError) throw authError;

      const userId = authData.user?.id;
      if (!userId) throw new Error('Account created — check your email for a verification link, then log in.');

      // 2. Wait for profile trigger to create the row
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 3. Create company via RPC
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('create_company_for_signup', {
          p_company_name: form.company_name,
          p_package: pkg.id,
          p_billing_cycle: pkg.billing_cycle,
          p_status: signupMode === 'trial' ? 'trial' : 'pending',
          p_trial_days: 7,
        });
      if (rpcError) throw new Error('Failed to create company: ' + rpcError.message);
      const companyId = rpcData;

      // 3b. Attribute this club to the referring partner.
      //
      // Order matters: attach_reseller_referral checks that the caller owns the
      // company (created_by = auth.uid()), so this has to run while we are still
      // signed in — i.e. before the signOut() further down and before any
      // redirect to PayCloud. It is also deliberately non-fatal: a bad or stale
      // referral code must never cost us the signup.
      if (referral && companyId) {
        try {
          const { data: attached, error: refError } = await supabase
            .rpc('attach_reseller_referral', { p_company_id: companyId, p_code: referral });
          if (refError) {
            console.error('Referral attach failed:', refError);
          } else if (attached === false) {
            console.warn('Referral code not matched, not approved, or company already attributed:', referral);
          } else {
            try { sessionStorage.removeItem(REF_KEY); } catch (_) {}
          }
        } catch (attachErr) {
          console.error('Referral attach threw:', attachErr);
        }
      }

      // 4. Upload logo (non-critical)
      if (logoFile && companyId) {
        try {
          const ext = logoFile.name.split('.').pop();
          const path = `${companyId}/logo.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from('company-assets')
            .upload(path, logoFile, { upsert: true });
          if (!uploadError) {
            const { data: urlData } = supabase.storage.from('company-assets').getPublicUrl(path);
            await supabase.from('companies').update({ logo_url: urlData.publicUrl }).eq('id', companyId);
          }
        } catch (_) {}
      }

      // 5. Update profile
      try {
        await supabase.from('profiles').update({ full_name: form.owner_name, phone: phoneToStore }).eq('id', userId);
      } catch (_) {}

      // 6. Save phone and email to company.
      //
      // owner_phone is written as well as phone: the push_trial_to_crm trigger
      // reads COALESCE(owner_phone, phone), so leaving owner_phone null meant it
      // always fell through to the unvalidated phone column.
      try {
        await supabase.from('companies').update({
          phone: phoneToStore,
          owner_phone: phoneToStore,
          email: form.email,
        }).eq('id', companyId);
      } catch (_) {}

      // 7. Signup notification (non-critical)
      try {
        await supabase.from('signup_notifications').insert([{
          owner_name: form.owner_name,
          company_name: form.company_name,
          email: form.email,
          phone: phoneToStore,
          package_name: pkg.name,
          package_price: pkg.price,
          billing_cycle: pkg.billing_cycle,
          signed_up_at: new Date().toISOString(),
          status: 'new',
        }]);
      } catch (_) {}

      // 8. Sign out
      await supabase.auth.signOut();

      // 9. Redirect
      if (signupMode === 'pay' && pkg.paymentLink) {
        window.location.href = pkg.paymentLink;
      } else {
        window.location.href = window.location.origin + '/#/signup?success=1&email=' + encodeURIComponent(form.email);
      }
    } catch (err) {
      console.error('Signup error:', err);
      setError(err.message || 'Something went wrong. Please try again.');
      try { await supabase.auth.signOut(); } catch (_) {}
    } finally {
      setLoading(false);
      signingUp.current = false;
    }
  };

  const selectedPkg = PACKAGES.find((p) => p.id === selectedPackage);

  if (successFromUrl) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
            <Check className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Account Created!</h1>
          <p className="text-slate-400">
            Check your email at <strong className="text-white">{emailFromUrl || 'your inbox'}</strong> for a verification link, then log in to start your 7-day free trial.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all"
          >
            Go to Login
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 py-8 px-4">
      <div className="max-w-6xl mx-auto">

        <div className="text-center mb-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Get started with Canna Life Co</h1>
          <p className="text-slate-400 text-base">Built for South African dispensaries and clubs</p>
          {referral && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
              <Handshake className="w-3.5 h-3.5" />
              Referred by partner {referral}
            </div>
          )}
        </div>

        <div className="max-w-3xl mx-auto mb-8">
          <div className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/60 px-5 py-3.5">
            <Clock className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-400">7-Day Free Trial on all plans</p>
              <p className="text-xs text-slate-400">Start using Canna Life Co immediately. No payment required upfront — pay only when you're ready.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto mb-10">
          {PACKAGES.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              onClick={() => setSelectedPackage(pkg.id)}
              className={`relative text-left rounded-xl border-2 p-5 transition-all duration-200 ${
                selectedPackage === pkg.id
                  ? 'border-emerald-500 bg-emerald-950/30 ring-1 ring-emerald-500/30'
                  : 'border-slate-700/50 bg-slate-900/40 hover:border-slate-600'
              }`}
            >
              {pkg.popular && (
                <span className="absolute -top-2.5 right-4 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                  Most Popular
                </span>
              )}
              <h3 className="text-base font-semibold text-white mb-2">{pkg.name}</h3>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-bold text-white">R{pkg.price.toLocaleString()}</span>
                <span className="text-sm text-slate-400">{pkg.cycle}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-4">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-2.5 h-2.5" /> 7-day free trial
                </span>
              </div>
              <div className="space-y-1.5">
                {pkg.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
              {pkg.paymentLink && (
                <div className="flex items-center gap-1 mt-4 pt-3 border-t border-slate-800/60 text-xs text-slate-500">
                  <ExternalLink className="w-3 h-3" />
                  Pay via PayCloud after trial
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/60 backdrop-blur-sm">
            <div className="p-6 pb-0">
              <h2 className="text-xl font-semibold text-white">Your details</h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Company logo (optional)</label>
                {logoPreview ? (
                  <div className="flex items-center gap-3">
                    <img src={logoPreview} alt="Logo" className="w-14 h-14 rounded-lg object-cover border border-slate-700" />
                    <button type="button" onClick={removeLogo} className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1">
                      <X className="w-3 h-3" /> Remove
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-slate-700 hover:border-slate-500 cursor-pointer transition-colors">
                    <Upload className="w-4 h-4 text-slate-500" />
                    <span className="text-sm text-slate-400">PNG, JPG, or SVG up to 2MB</span>
                    <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={handleLogoSelect} className="hidden" />
                  </label>
                )}
                <p className="text-xs text-slate-500 mt-1">Appears on receipts & dashboards.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="company_name" className="block text-sm font-medium text-slate-300 mb-1">Company name *</label>
                  <input id="company_name" name="company_name" required value={form.company_name} onChange={handleChange}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                    placeholder="e.g. Green Leaf Club" />
                </div>
                <div>
                  <label htmlFor="owner_name" className="block text-sm font-medium text-slate-300 mb-1">Your name *</label>
                  <input id="owner_name" name="owner_name" required value={form.owner_name} onChange={handleChange}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                    placeholder="Full name" />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1">Email *</label>
                  <input id="email" name="email" type="email" required value={form.email} onChange={handleChange}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                    placeholder="you@example.com" />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-slate-300 mb-1">Phone *</label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={20}
                    required
                    value={form.phone}
                    onChange={handleChange}
                    onBlur={handlePhoneBlur}
                    aria-invalid={phoneError ? 'true' : 'false'}
                    className={`w-full px-3 py-2.5 rounded-lg bg-slate-800 border text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 ${
                      phoneError
                        ? 'border-red-600 focus:ring-red-500/50 focus:border-red-500'
                        : 'border-slate-700 focus:ring-emerald-500/50 focus:border-emerald-500'
                    }`}
                    placeholder="071 234 5678" />
                  {phoneError ? (
                    <p className="text-xs text-red-400 mt-1">{phoneError}</p>
                  ) : (
                    <p className="text-xs text-slate-500 mt-1">Mobile or landline — we use this for support.</p>
                  )}
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1">Password *</label>
                  <input id="password" name="password" type="password" required value={form.password} onChange={handleChange}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                    placeholder="Min 6 characters" />
                </div>
                <div>
                  <label htmlFor="confirm_password" className="block text-sm font-medium text-slate-300 mb-1">Confirm password *</label>
                  <input id="confirm_password" name="confirm_password" type="password" required value={form.confirm_password} onChange={handleChange}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                    placeholder="Repeat password" />
                </div>
              </div>

              {error && (
                <div className="bg-red-950/50 border border-red-800/60 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
              )}

              {selectedPkg && (
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">Selected plan</p>
                      <p className="text-sm font-semibold text-white">
                        {selectedPkg.name} — R{selectedPkg.price.toLocaleString()} {selectedPkg.cycle}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSignupMode('trial')}
                      className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                        signupMode === 'trial'
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                          : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <Clock className="w-4 h-4" />
                      Start Free Trial
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignupMode('pay')}
                      className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                        signupMode === 'pay'
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                          : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <CreditCard className="w-4 h-4" />
                      Pay Now
                    </button>
                  </div>

                  <p className="text-xs text-slate-500 mt-2 text-center">
                    {signupMode === 'trial'
                      ? '7 days free — no payment required upfront'
                      : `You'll be redirected to PayCloud to pay R${selectedPkg.price.toLocaleString()}`
                    }
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating your account...
                  </>
                ) : signupMode === 'trial' ? (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Start 7-Day Free Trial
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    Sign Up & Pay via PayCloud
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <p className="text-center text-sm text-slate-500">
                Already have an account?{' '}
                <Link to="/login" className="text-emerald-400 hover:underline">Log in</Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
