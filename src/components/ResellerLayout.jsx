import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useResellerAuth } from '@/lib/ResellerAuthContext';
import { useState } from 'react';
import {
  LayoutDashboard, Users, DollarSign, GraduationCap, UserCircle,
  LogOut, Menu, X, Leaf, Lock, Clock, Trophy, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const NAV_ITEMS = [
  { path: '/reseller/dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
  { path: '/reseller/leads',       label: 'My Leads',    icon: Users },
  { path: '/reseller/commissions', label: 'Commissions', icon: DollarSign },
  { path: '/reseller/leaderboard', label: 'Leaderboard', icon: Trophy },
  { path: '/reseller/training',    label: 'Training',    icon: GraduationCap },
  { path: '/reseller/downloads',   label: 'Downloads',   icon: Download },
  { path: '/reseller/profile',     label: 'My Profile',  icon: UserCircle },
];

export default function ResellerLayout() {
  const { reseller, signOut, isApproved } = useResellerAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => { await signOut(); navigate('/reseller/login'); };

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-gray-900 border-r border-gray-800">
        <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-800">
          <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center"><Leaf className="w-5 h-5 text-white" /></div>
          <div><h1 className="font-bold text-lg text-white">Canna Life Co</h1><p className="text-[10px] text-gray-500 -mt-1 tracking-wider uppercase">Reseller Portal</p></div>
        </div>
        {reseller && <div className="px-4 pt-4 pb-2"><StatusBadge status={reseller.status} /></div>}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const active = location.pathname === item.path;
            const locked = !isApproved && item.path !== '/reseller/profile' && item.path !== '/reseller/dashboard';
            return (
              <Link key={item.path} to={locked ? '#' : item.path} onClick={e => locked && e.preventDefault()}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-green-600/20 text-green-400' : locked ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}>
                <item.icon className="w-5 h-5 flex-shrink-0" /><span className="flex-1">{item.label}</span>{locked && <Lock className="w-3.5 h-3.5" />}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-green-900/40 flex items-center justify-center text-green-400 font-semibold text-sm">{reseller?.full_name?.charAt(0) || '?'}</div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-200 truncate">{reseller?.full_name}</p><p className="text-xs text-gray-500 truncate">{reseller?.email}</p></div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="w-full justify-start text-gray-500 hover:text-red-400 hover:bg-red-900/20"><LogOut className="w-4 h-4 mr-2" /> Sign Out</Button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2"><div className="w-7 h-7 bg-green-600 rounded-lg flex items-center justify-center"><Leaf className="w-4 h-4 text-white" /></div><span className="font-bold text-white">Canna Life Co</span></div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="text-gray-400">{mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button>
      </div>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMobileOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-gray-900 shadow-xl pt-16" onClick={e => e.stopPropagation()}>
            {reseller && <div className="px-4 pb-2"><StatusBadge status={reseller.status} /></div>}
            <nav className="px-3 py-4 space-y-1">
              {NAV_ITEMS.map(item => {
                const active = location.pathname === item.path;
                const locked = !isApproved && item.path !== '/reseller/profile' && item.path !== '/reseller/dashboard';
                return (<Link key={item.path} to={locked ? '#' : item.path} onClick={e => { if (locked) { e.preventDefault(); return; } setMobileOpen(false); }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${active ? 'bg-green-600/20 text-green-400' : locked ? 'text-gray-600' : 'text-gray-400'}`}>
                  <item.icon className="w-5 h-5" /><span className="flex-1">{item.label}</span>{locked && <Lock className="w-3.5 h-3.5" />}</Link>);
              })}
            </nav>
            <div className="p-4 border-t border-gray-800"><Button variant="ghost" size="sm" onClick={handleSignOut} className="w-full justify-start text-gray-500"><LogOut className="w-4 h-4 mr-2" /> Sign Out</Button></div>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto md:pt-0 pt-14"><div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto"><Outlet /></div></main>
    </div>
  );
}

function StatusBadge({ status }) {
  const config = {
    pending:  { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-800', icon: Clock,  label: 'Pending Approval' },
    approved: { bg: 'bg-green-900/30',  text: 'text-green-400',  border: 'border-green-800',  icon: Leaf,  label: 'Active Reseller' },
    suspended:{ bg: 'bg-red-900/30',    text: 'text-red-400',    border: 'border-red-800',    icon: Lock,  label: 'Account Suspended' },
    rejected: { bg: 'bg-gray-800',      text: 'text-gray-400',   border: 'border-gray-700',   icon: X,     label: 'Application Rejected' },
  };
  const c = config[status] || config.pending;
  return (<div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${c.bg} ${c.border}`}><c.icon className={`w-4 h-4 ${c.text}`} /><span className={`text-xs font-medium ${c.text}`}>{c.label}</span></div>);
}
