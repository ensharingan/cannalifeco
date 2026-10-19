import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useCompany } from '@/lib/CompanyContext';

/**
 * Reads the current company's pos_settings JSONB and its billing state.
 *
 * Both come off the same companies row, so they share one cached fetch rather
 * than each component hitting the table separately. Cached for 5 minutes so the
 * nav, the route guard and the billing banner all share it.
 *
 * Flags currently in use:
 *   hide_patients          - hides the Section 21 / Patients tab for the whole company
 *   cashier_hide_patients  - hides it from cashiers only (existing behaviour)
 *
 * Billing fields are written by the paystack-webhook function:
 *   subscription_status    - 'active' | 'overdue' | 'trial' | 'cancelled'
 *   grace_period_ends_at   - when an overdue account stops being given room
 *
 * price_zar comes from the linked subscriptions row and is the ONLY reliable
 * indicator of what a club actually pays. companies.package and
 * subscription_plan are wrong on dozens of accounts (signup defaults the plan
 * to 'growth' regardless of price), so anything money-related must read the
 * price, not the label.
 *
 * Usage:
 *   const { settings, billing, isLoading } = usePosSettings();
 *   if (settings.hide_patients) { ... }
 *   if (billing.subscription_status === 'overdue') { ... }
 */
export function usePosSettings() {
  const { companyId } = useCompany();

  const { data, isLoading } = useQuery({
    queryKey: ['pos_settings', companyId],
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select(
          'pos_settings, subscription_status, grace_period_ends_at, package, subscription_plan, subscriptions(price_zar, status, updated_at)'
        )
        .eq('id', companyId)
        .single();
      if (error) throw error;

      // A handful of companies carry more than one subscriptions row. Take the
      // most recently touched one, since that's the live billing arrangement.
      const subs = Array.isArray(data?.subscriptions) ? data.subscriptions.slice() : [];
      subs.sort((a, b) => {
        const at = a && a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bt = b && b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bt - at;
      });
      const current = subs.length > 0 ? subs[0] : null;

      return {
        settings: data?.pos_settings || {},
        billing: {
          subscription_status: data?.subscription_status || null,
          grace_period_ends_at: data?.grace_period_ends_at || null,
          package: data?.package || null,
          subscription_plan: data?.subscription_plan || null,
          price_zar: current && current.price_zar != null ? Number(current.price_zar) : null,
        },
      };
    },
  });

  return {
    settings: (data && data.settings) || {},
    billing: (data && data.billing) || {},
    isLoading: !!companyId && isLoading,
  };
}

export default usePosSettings;
