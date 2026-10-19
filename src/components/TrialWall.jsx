import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useCompany } from '../lib/CompanyContext';
import { Clock, CreditCard, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PAYMENT_LINKS = {
  starter: 'https://paystack.shop/pay/deii2ufhtv',
  growth: 'https://paystack.shop/pay/1uyzfhgxnh',
};

const PLAN_PRICES = {
  starter: 499,
  growth: 999,
};

export default function TrialWall({ children }) {
  const { companyId } = useCompany();
  const [trialStatus, setTrialStatus] = useState('loading');
  const [trialInfo, setTrialInfo] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    const checkTrial = async () => {
      try {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (!sub) { setTrialStatus('paid'); return; }
        if (['active', 'paid', 'onceoff', 'lifetime'].includes(sub.status)) { setTrialStatus('paid'); return; }

        if (sub.status === 'trial') {
          const trialEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null;
          if (!trialEnd) {
            const { data: company } = await supabase.from('companies').select('trial_ends_at').eq('id', companyId).single();
            if (company?.trial_ends_at) {
              const companyTrialEnd = new Date(company.trial_ends_at);
              const daysLeft = Math.ceil((companyTrialEnd - new Date()) / (1000 * 60 * 60 * 24));
              setTrialInfo({ daysLeft: Math.max(0, daysLeft), endsAt: companyTrialEnd, package: sub.package });
              setTrialStatus(companyTrialEnd > new Date() ? 'active' : 'expired');
              return;
            }
          }
          if (trialEnd && trialEnd > new Date()) {
            const daysLeft = Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24));
            setTrialInfo({ daysLeft, endsAt: trialEnd, package: sub.package });
            setTrialStatus('active');
          } else if (trialEnd) {
            setTrialInfo({ daysLeft: 0, endsAt: trialEnd, package: sub.package });
            setTrialStatus('expired');
          } else {
            setTrialStatus('paid');
          }
          return;
        }

        setTrialInfo({ package: sub.package });
        setTrialStatus('expired');
      } catch (err) {
        console.error('Trial check failed:', err);
        setTrialStatus('paid');
      }
    };
    checkTrial();
  }, [companyId]);

  if (trialStatus === 'loading') return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );

  if (trialStatus === 'expired') {
    const pkg = trialInfo?.package || 'starter';
    const paymentLink = PAYMENT_LINKS[pkg] || PAYMENT_LINKS.starter;
    const price = PLAN_PRICES[pkg] || 499;

    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 flex items-center justify-center">
            <Clock className="w-8 h-8 text-red-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Your free trial has ended</h1>
            <p className="text-muted-foreground mt-2">
              Your 7-day free trial expired on {trialInfo?.endsAt
                ? new Date(trialInfo.endsAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
                : 'recently'}. Subscribe to continue using Canna Life Co.
            </p>
          </div>
          <div className="space-y-3">
            <a href={paymentLink} target="_blank" rel="noopener noreferrer" className="block">
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-6 text-base gap-2">
                <CreditCard className="w-5 h-5" />
                Subscribe Now — R{price}/month
              </Button>
            </a>
            <p className="text-xs text-muted-foreground">
              Payment processed securely via Paystack. Your data is safe and waiting.
            </p>
            <div className="border-t border-border pt-4 mt-4">
              <p className="text-sm text-muted-foreground mb-3">Need a different plan?</p>
              <div className="flex gap-2 justify-center">
                <a href={PAYMENT_LINKS.starter} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1">
                    <Zap className="w-3 h-3" /> Starter R499/mo
                  </Button>
                </a>
                <a href={PAYMENT_LINKS.growth} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1">
                    <Zap className="w-3 h-3" /> Growth R999/mo
                  </Button>
                </a>
              </div>
            </div>
            <button
              onClick={async () => { await supabase.auth.signOut(); window.location.href = '/'; }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (trialStatus === 'active' && trialInfo) {
    return (
      <>
        <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white text-center py-1.5 px-4 text-sm font-medium flex items-center justify-center gap-2">
          <Clock className="w-4 h-4" />
          <span>Free trial: {trialInfo.daysLeft} day{trialInfo.daysLeft !== 1 ? 's' : ''} remaining</span>
          <span className="mx-2 opacity-40">|</span>
          <a href={PAYMENT_LINKS[trialInfo.package] || PAYMENT_LINKS.starter} target="_blank" rel="noopener noreferrer"
            className="underline hover:no-underline font-semibold">
            Subscribe now
          </a>
        </div>
        <div className="pt-8">{children}</div>
      </>
    );
  }

  return <>{children}</>;
}
