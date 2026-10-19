import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useResellerAuth } from '@/lib/ResellerAuthContext';
import { DollarSign, Clock, CheckCircle, TrendingUp } from 'lucide-react';

export default function ResellerCommissions() {
  const { reseller } = useResellerAuth();
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!reseller?.id) return;
    try {
      const { data, error } = await supabase.from('reseller_commissions').select('*, reseller_leads(business_name)').eq('reseller_id', reseller.id).order('created_at', { ascending: false });
      if (error) throw error;
      setCommissions(data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [reseller?.id]);

  useEffect(() => { load(); }, [load]);

  const totals = commissions.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + Number(c.amount); a.total += Number(c.amount); return a; }, { pending: 0, approved: 0, paid: 0, total: 0 });
  const cards = [
    { label: 'Total Earned', value: totals.total, icon: TrendingUp, bg: 'bg-green-900/30', ic: 'text-green-400' },
    { label: 'Paid Out', value: totals.paid, icon: DollarSign, bg: 'bg-green-900/30', ic: 'text-green-400' },
    { label: 'Approved', value: totals.approved, icon: CheckCircle, bg: 'bg-blue-900/30', ic: 'text-blue-400' },
    { label: 'Pending', value: totals.pending, icon: Clock, bg: 'bg-amber-900/30', ic: 'text-amber-400' },
  ];
  const sc = { pending: 'bg-amber-900/40 text-amber-400', approved: 'bg-blue-900/40 text-blue-400', paid: 'bg-green-900/40 text-green-400' };

  return (
    <div>
      <div className="mb-6"><h1 className="text-2xl font-bold text-white">Commissions</h1><p className="text-gray-400 text-sm mt-1">Your commission rate: <span className="font-semibold text-green-400">{reseller?.commission_rate || 10}%</span></p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(c => (<div key={c.label} className="bg-gray-900 rounded-xl border border-gray-800 p-4"><div className="flex items-center justify-between mb-3"><span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{c.label}</span><div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.bg}`}><c.icon className={`w-4 h-4 ${c.ic}`} /></div></div><p className="text-2xl font-bold text-white">R{c.value.toLocaleString()}</p></div>))}
      </div>
      <div className="bg-gray-900 rounded-xl border border-gray-800">
        <div className="px-5 py-4 border-b border-gray-800"><h3 className="font-semibold text-white">Commission History</h3></div>
        {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : commissions.length === 0 ? (
          <div className="p-8 text-center"><DollarSign className="w-12 h-12 text-gray-700 mx-auto mb-3" /><p className="text-gray-500">No commissions yet</p></div>
        ) : (
          <div className="divide-y divide-gray-800">{commissions.map(c => (
            <div key={c.id} className="px-5 py-4 flex items-center justify-between">
              <div><p className="font-medium text-gray-200 text-sm">{c.description}</p><div className="flex items-center gap-3 mt-1">{c.reseller_leads?.business_name && <span className="text-xs text-gray-500">{c.reseller_leads.business_name}</span>}<span className="text-xs text-gray-500">{new Date(c.created_at).toLocaleDateString()}</span>{c.paid_at && <span className="text-xs text-green-400">Paid {new Date(c.paid_at).toLocaleDateString()}</span>}</div></div>
              <div className="flex items-center gap-3"><span className="font-bold text-white">R{Number(c.amount).toLocaleString()}</span><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${sc[c.status]}`}>{c.status}</span></div>
            </div>
          ))}</div>
        )}
      </div>
    </div>
  );
}
