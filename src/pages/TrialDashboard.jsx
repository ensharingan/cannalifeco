import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useCompany } from '../lib/CompanyContext';
import { Clock, CreditCard, Zap, CheckCircle, AlertTriangle, ArrowRight, Sparkles } from 'lucide-react';

const PAYMENT_LINKS = {
  starter: 'https://paystack.shop/pay/deii2ufhtv',
  growth: 'https://paystack.shop/pay/1uyzfhgxnh',
};

const PLAN_DETAILS = {
  starter: {
    name: 'Starter',
    price: 499,
    cycle: '/month',
    features: ['Single store', 'Unlimited products', 'Member management', 'Loyalty system', 'Reports & analytics'],
  },
  growth: {
    name: 'Growth',
    price: 999,
    cycle: '/month',
    features: ['Up to 5 stores', 'Everything in Starter', 'Multi-store inventory', 'Staff performance tracking', 'Priority support'],
  },
  onceoff: {
    name: 'Lifetime',
    price: 20000,
    cycle: ' once-off',
    features: ['Up to 5 stores', 'Everything in Growth', 'No monthly fees', 'Lifetime updates', 'Dedicated onboarding'],
  },
};

function CountdownBlock({ value, label }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-slate-800/80 border border-slate-700/50 flex items-center justify-center backdrop-blur-sm">
        <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums">{String(value).padStart(2, '0')}</span>
      </div>
      <span className="text-[10px] sm:text-xs text-slate-500 mt-1.5 uppercase tracking-widest">{label}</span>
    </div>
  );
}

export default function TrialDashboard() {
  const { companyId } = useCompany();
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [progressPercent, setProgressPercent] = useState(0);

  useEffect(() => {
    if (!companyId) return;
    const fetchSub = async () => {
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        setSubscription(data);
      } catch (err) {
        console.error('Failed to fetch subscription:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSub();
  }, [companyId]);

  useEffect(() => {
    if (!subscription?.trial_ends_at) return;
    const endDate = new Date(subscription.trial_ends_at);
    const startDate = new Date(subscription.created_at);
    const tick = () => {
      const now = new Date();
      const diff = endDate - now;
      const totalDuration = endDate - startDate;
      const elapsed = now - startDate;
      setProgressPercent(Math.min(100, Math.max(0, (elapsed / totalDuration) * 100)));
      if (diff <= 0) { setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 }); return; }
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [subscription]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!subscription || subscription.status !== 'trial') return null;

  const plan = PLAN_DETAILS[subscription.package] || PLAN_DETAILS.starter;
  const paymentLink = PAYMENT_LINKS[subscription.package] || PAYMENT_LINKS.starter;
  const isExpired = timeLeft.days === 0 && timeLeft.hours === 0 && timeLeft.minutes === 0 && timeLeft.seconds === 0;
  const isLastDay = timeLeft.days === 0 && !isExpired;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">

        <div className="text-center pt-4 pb-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-4">
            <Clock className="w-3 h-3" /> Free Trial Active
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">Welcome to Canna Life Co</h1>
          <p className="text-slate-400 text-sm">
            You're on the <span className="text-emerald-400 font-semibold">{plan.name}</span> plan trial
          </p>
        </div>

        <div className={`rounded-2xl border p-6 sm:p-8 ${
          isExpired ? 'bg-red-950/30 border-red-800/40' :
          isLastDay ? 'bg-amber-950/20 border-amber-700/40' :
          'bg-slate-900/60 border-slate-800/60'
        }`}>
          {isExpired ? (
            <div className="text-center space-y-4">
              <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
              <h2 className="text-xl font-bold text-white">Your trial has ended</h2>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Subscribe now to continue using Canna Life Co. Your data is safe — pick up right where you left off.
              </p>
              <a href={paymentLink} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]">
                <CreditCard className="w-4 h-4" />
                Subscribe Now — R{plan.price.toLocaleString()}{plan.cycle}
              </a>
            </div>
          ) : (
            <>
              <div className="text-center mb-6">
                <p className="text-slate-400 text-sm mb-1">{isLastDay ? '⚠️ Last day!' : 'Time remaining on your free trial'}</p>
              </div>
              <div className="flex items-center justify-center gap-3 sm:gap-4 mb-6">
                <CountdownBlock value={timeLeft.days} label="Days" />
                <span className="text-slate-600 text-2xl font-light mt-[-20px]">:</span>
                <CountdownBlock value={timeLeft.hours} label="Hours" />
                <span className="text-slate-600 text-2xl font-light mt-[-20px]">:</span>
                <CountdownBlock value={timeLeft.minutes} label="Min" />
                <span className="text-slate-600 text-2xl font-light mt-[-20px]">:</span>
                <CountdownBlock value={timeLeft.seconds} label="Sec" />
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-6">
                <div className={`h-full rounded-full transition-all duration-1000 ${isLastDay ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="text-center">
                <p className="text-slate-500 text-xs mb-4">{Math.ceil(7 - (progressPercent / 100) * 7)} of 7 days remaining</p>
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{plan.name} Plan</h3>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-white">R{plan.price.toLocaleString()}</span>
                <span className="text-slate-400 text-sm">{plan.cycle}</span>
              </div>
            </div>
            {!isExpired && (
              <a href={paymentLink} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all hover:scale-[1.02] active:scale-[0.98] shrink-0">
                <CreditCard className="w-3.5 h-3.5" /> Subscribe <ArrowRight className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          <div className="border-t border-slate-800/60 pt-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">What's included</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {plan.features.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />{f}
                </div>
              ))}
            </div>
          </div>
        </div>

        {!isExpired && (
          <div className="rounded-2xl border border-emerald-800/30 bg-emerald-950/20 p-5 text-center">
            <Sparkles className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-slate-300 mb-3">Ready to commit? Subscribe now and keep full access.</p>
            <a href={paymentLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]">
              Pay Now via Paystack <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        )}

        <p className="text-center text-xs text-slate-600 pb-4">Need help? Contact us at support@cannalife.co.za</p>
      </div>
    </div>
  );
}
