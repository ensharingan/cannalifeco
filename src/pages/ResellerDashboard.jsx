import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useResellerAuth } from '@/lib/ResellerAuthContext';
import { Users, DollarSign, GraduationCap, TrendingUp, Clock, CheckCircle, AlertCircle } from 'lucide-react';

export default function ResellerDashboard() {
  const { reseller, isApproved, isPending, isSuspended } = useResellerAuth();
  const [stats, setStats] = useState({ leads: 0, converted: 0, pendingComm: 0, paidComm: 0, coursesCompleted: 0, totalCourses: 0 });
  const [recentLeads, setRecentLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    if (!reseller?.id) return;
    try {
      const { data: leads } = await supabase.from('reseller_leads').select('id, status').eq('reseller_id', reseller.id);
      const converted = leads?.filter(l => l.status === 'converted').length || 0;
      const { data: comms } = await supabase.from('reseller_commissions').select('amount, status').eq('reseller_id', reseller.id);
      const pendingComm = comms?.filter(c => c.status === 'pending' || c.status === 'approved').reduce((s, c) => s + Number(c.amount), 0) || 0;
      const paidComm = comms?.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.amount), 0) || 0;
      const { count: totalCourses } = await supabase.from('reseller_courses').select('id', { count: 'exact', head: true }).eq('is_published', true);
      const { count: completedLessons } = await supabase.from('reseller_lesson_progress').select('id', { count: 'exact', head: true }).eq('reseller_id', reseller.id).eq('completed', true);
      setStats({ leads: leads?.length || 0, converted, pendingComm, paidComm, coursesCompleted: completedLessons || 0, totalCourses: totalCourses || 0 });
      const { data: recent } = await supabase.from('reseller_leads').select('*').eq('reseller_id', reseller.id).order('created_at', { ascending: false }).limit(5);
      setRecentLeads(recent || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [reseller?.id]);

  useEffect(() => { loadStats(); }, [loadStats]);

  if (isPending) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-20 h-20 bg-amber-900/30 rounded-full flex items-center justify-center mb-6"><Clock className="w-10 h-10 text-amber-400" /></div>
      <h2 className="text-2xl font-bold text-white mb-2">Application Under Review</h2>
      <p className="text-gray-400 max-w-md">Your reseller application is being reviewed. You'll be notified once approved.</p>
    </div>
  );
  if (isSuspended) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-20 h-20 bg-red-900/30 rounded-full flex items-center justify-center mb-6"><AlertCircle className="w-10 h-10 text-red-400" /></div>
      <h2 className="text-2xl font-bold text-white mb-2">Account Suspended</h2>
      <p className="text-gray-400 max-w-md">Your reseller account has been suspended. Please contact support.</p>
    </div>
  );

  const cards = [
    { label: 'Total Leads', value: stats.leads, icon: Users, bg: 'bg-blue-900/30', ic: 'text-blue-400' },
    { label: 'Converted', value: stats.converted, icon: CheckCircle, bg: 'bg-green-900/30', ic: 'text-green-400' },
    { label: 'Pending Commission', value: `R${stats.pendingComm.toLocaleString()}`, icon: DollarSign, bg: 'bg-amber-900/30', ic: 'text-amber-400' },
    { label: 'Total Earned', value: `R${stats.paidComm.toLocaleString()}`, icon: TrendingUp, bg: 'bg-green-900/30', ic: 'text-green-400' },
  ];
  const sc = { new: 'bg-blue-900/40 text-blue-400', contacted: 'bg-purple-900/40 text-purple-400', negotiating: 'bg-amber-900/40 text-amber-400', converted: 'bg-green-900/40 text-green-400', lost: 'bg-gray-800 text-gray-500' };

  return (
    <div>
      <div className="mb-6"><h1 className="text-2xl font-bold text-white">Welcome back, {reseller?.full_name?.split(' ')[0]}</h1></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(c => (
          <div key={c.label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3"><span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{c.label}</span><div className={`w-8 h-8 ${c.bg} rounded-lg flex items-center justify-center`}><c.icon className={`w-4 h-4 ${c.ic}`} /></div></div>
            <p className="text-2xl font-bold text-white">{loading ? '...' : c.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-6">
        <div className="flex items-center gap-3 mb-3"><GraduationCap className="w-5 h-5 text-green-400" /><h3 className="font-semibold text-white">Training Progress</h3></div>
        <div className="flex items-center gap-4"><div className="flex-1 bg-gray-800 rounded-full h-3"><div className="bg-green-500 rounded-full h-3 transition-all" style={{ width: stats.totalCourses ? `${(stats.coursesCompleted / stats.totalCourses) * 100}%` : '0%' }} /></div><span className="text-sm font-medium text-gray-400">{stats.coursesCompleted}/{stats.totalCourses} lessons</span></div>
      </div>
      <div className="bg-gray-900 rounded-xl border border-gray-800">
        <div className="px-5 py-4 border-b border-gray-800"><h3 className="font-semibold text-white">Recent Leads</h3></div>
        {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : recentLeads.length === 0 ? <div className="p-8 text-center text-gray-500">No leads yet. Start referring businesses!</div> : (
          <div className="divide-y divide-gray-800">{recentLeads.map(lead => (
            <div key={lead.id} className="px-5 py-3 flex items-center justify-between">
              <div><p className="font-medium text-gray-200 text-sm">{lead.business_name}</p><p className="text-xs text-gray-500">{lead.contact_name} · {new Date(lead.created_at).toLocaleDateString()}</p></div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${sc[lead.status]}`}>{lead.status}</span>
            </div>
          ))}</div>
        )}
      </div>
    </div>
  );
}
