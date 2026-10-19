import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import {
  Users, CheckCircle, XCircle, Clock, DollarSign, TrendingUp,
  UserCheck, UserX, Search, Building2, GraduationCap, Plus,
  Trash2, Edit, AlertCircle, Download
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

const PLAN_PRICES = { starter: 499, growth: 999 };

// ─── RESELLERS TAB ────────────────────────────────────────────

function ResellersTab() {
  const { user } = useAuth();
  const [resellers, setResellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editReseller, setEditReseller] = useState(null);
  const [saving, setSaving] = useState(false);

  var load = useCallback(async function() {
    try {
      var { data, error } = await supabase.from('resellers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setResellers(data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(function() { load(); }, [load]);

  async function updateStatus(id, status) {
    try {
      var updates = { status };
      if (status === 'approved') { updates.approved_at = new Date().toISOString(); updates.approved_by = user.id; }
      var { error } = await supabase.from('resellers').update(updates).eq('id', id);
      if (error) throw error;
      toast.success('Reseller ' + status);
      load();
    } catch (err) { toast.error(err.message); }
  }

  async function updateCommissionRate() {
    if (!editReseller) return;
    setSaving(true);
    try {
      var { error } = await supabase.from('resellers').update({ commission_rate: editReseller.commission_rate }).eq('id', editReseller.id);
      if (error) throw error;
      toast.success('Commission rate updated');
      setEditReseller(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  var filtered = resellers.filter(function(r) {
    var matchSearch = !search || r.full_name.toLowerCase().includes(search.toLowerCase()) || r.email.toLowerCase().includes(search.toLowerCase());
    var matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  var statusColors = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700', suspended: 'bg-red-100 text-red-700', rejected: 'bg-gray-100 text-gray-500' };

  return (
    <div>
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Search resellers..." className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : (
        <div className="space-y-3">
          {filtered.map(function(r) {
            return (
              <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{r.full_name}</h3>
                    <p className="text-sm text-gray-500">{r.email}</p>
                    {r.phone && <p className="text-xs text-gray-400 mt-1">{r.phone}</p>}
                  </div>
                  <span className={'px-2.5 py-1 rounded-full text-xs font-medium ' + (statusColors[r.status] || statusColors.pending)}>{r.status}</span>
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <span className="text-xs text-gray-400">Commission: <span className="font-medium text-gray-600">{r.commission_rate || 10}%</span></span>
                  <span className="text-xs text-gray-300">·</span>
                  <span className="text-xs text-gray-400">Applied: {new Date(r.created_at).toLocaleDateString('en-ZA')}</span>
                  {r.bank_name && <><span className="text-xs text-gray-300">·</span><span className="text-xs text-gray-400">Bank: {r.bank_name}</span></>}
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {r.status === 'pending' && (
                    <>
                      <Button size="sm" onClick={function() { updateStatus(r.id, 'approved'); }} className="bg-green-600 hover:bg-green-700"><UserCheck className="w-3.5 h-3.5 mr-1" /> Approve</Button>
                      <Button size="sm" variant="outline" onClick={function() { updateStatus(r.id, 'rejected'); }} className="text-red-600 hover:bg-red-50"><UserX className="w-3.5 h-3.5 mr-1" /> Reject</Button>
                    </>
                  )}
                  {r.status === 'approved' && (
                    <Button size="sm" variant="outline" onClick={function() { updateStatus(r.id, 'suspended'); }} className="text-red-600 hover:bg-red-50"><UserX className="w-3.5 h-3.5 mr-1" /> Suspend</Button>
                  )}
                  {r.status === 'suspended' && (
                    <Button size="sm" onClick={function() { updateStatus(r.id, 'approved'); }} className="bg-green-600 hover:bg-green-700"><UserCheck className="w-3.5 h-3.5 mr-1" /> Reactivate</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={function() { setEditReseller({ ...r }); }}><Edit className="w-3.5 h-3.5 mr-1" /> Edit Rate</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!editReseller} onOpenChange={function() { setEditReseller(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Commission Rate</DialogTitle></DialogHeader>
          {editReseller && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">{editReseller.full_name}</p>
              <div>
                <Label>Commission Rate (%)</Label>
                <Input type="number" value={editReseller.commission_rate} onChange={function(e) { setEditReseller(function(p) { return { ...p, commission_rate: e.target.value }; }); }} min="0" max="100" step="0.5" />
              </div>
              <Button onClick={updateCommissionRate} disabled={saving} className="w-full bg-green-600 hover:bg-green-700">{saving ? 'Saving...' : 'Update Rate'}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── LEADS TAB ────────────────────────────────────────────────

function LeadsTab() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  var load = useCallback(async function() {
    try {
      var { data, error } = await supabase.from('reseller_leads').select('*, resellers(full_name, email)').order('created_at', { ascending: false });
      if (error) throw error;
      setLeads(data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(function() { load(); }, [load]);

  async function updateLeadStatus(id, status) {
    try {
      var updates = { status };
      if (status === 'converted') updates.converted_at = new Date().toISOString();
      var { error } = await supabase.from('reseller_leads').update(updates).eq('id', id);
      if (error) throw error;
      toast.success('Lead marked as ' + status);
      load();
    } catch (err) { toast.error(err.message); }
  }

  var statusColors = { new: 'bg-blue-100 text-blue-700', contacted: 'bg-purple-100 text-purple-700', negotiating: 'bg-amber-100 text-amber-700', converted: 'bg-green-100 text-green-700', lost: 'bg-gray-100 text-gray-500' };
  var STATUSES = ['all', 'new', 'contacted', 'negotiating', 'converted', 'lost'];

  var filtered = leads.filter(function(l) {
    var matchStatus = statusFilter === 'all' || l.status === statusFilter;
    var matchSearch = !search || l.business_name?.toLowerCase().includes(search.toLowerCase()) || l.resellers?.full_name?.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div>
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Search leads or reseller..." className="pl-10" />
        </div>
      </div>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {STATUSES.map(function(s) {
          var count = s === 'all' ? leads.length : leads.filter(function(l) { return l.status === s; }).length;
          return (
            <button key={s} onClick={function() { setStatusFilter(s); }}
              className={'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ' + (statusFilter === s ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : (
        <div className="space-y-3">
          {filtered.map(function(lead) {
            return (
              <div key={lead.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">{lead.business_name}</h3>
                    <p className="text-sm text-gray-500">{lead.contact_name}</p>
                    <p className="text-xs text-gray-400 mt-1">Reseller: <span className="font-medium">{lead.resellers?.full_name || 'Unknown'}</span></p>
                    {lead.phone && <p className="text-xs text-gray-400">{lead.phone}</p>}
                  </div>
                  <span className={'px-2.5 py-1 rounded-full text-xs font-medium ' + (statusColors[lead.status] || statusColors.new)}>{lead.status}</span>
                </div>
                {lead.notes && <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2 mb-3">{lead.notes}</p>}
                <div className="flex gap-2 flex-wrap">
                  {lead.status === 'new' && <Button size="sm" variant="outline" onClick={function() { updateLeadStatus(lead.id, 'contacted'); }}>Mark Contacted</Button>}
                  {lead.status === 'contacted' && <Button size="sm" variant="outline" onClick={function() { updateLeadStatus(lead.id, 'negotiating'); }}>Negotiating</Button>}
                  {(lead.status === 'negotiating' || lead.status === 'contacted') && (
                    <>
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={function() { updateLeadStatus(lead.id, 'converted'); }}><CheckCircle className="w-3.5 h-3.5 mr-1" /> Convert</Button>
                      <Button size="sm" variant="outline" className="text-red-600" onClick={function() { updateLeadStatus(lead.id, 'lost'); }}>Mark Lost</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">No leads found.</div>}
        </div>
      )}
    </div>
  );
}

// ─── CLIENTS TAB ──────────────────────────────────────────────

function ClientsTab() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resellers, setResellers] = useState([]);

  var emptyForm = { reseller_id: '', business_name: '', contact_name: '', contact_email: '', contact_phone: '', plan: 'starter', monthly_amount: '499', payment_status: 'unpaid', notes: '' };
  var [form, setForm] = useState(emptyForm);

  var load = useCallback(async function() {
    try {
      var { data, error } = await supabase.from('reseller_clients').select('*, resellers(full_name)').order('created_at', { ascending: false });
      if (error) throw error;
      setClients(data || []);
      var { data: rd } = await supabase.from('resellers').select('id, full_name').eq('status', 'approved').order('full_name');
      setResellers(rd || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(function() { load(); }, [load]);

  function selectPlan(plan) {
    setForm(function(p) { return { ...p, plan: plan, monthly_amount: String(PLAN_PRICES[plan] || '') }; });
  }

  async function handleSave() {
    if (!form.business_name || !form.reseller_id) { toast.error('Business name and reseller are required'); return; }
    setSaving(true);
    try {
      var payload = { ...form, monthly_amount: Number(form.monthly_amount) || 0 };
      if (editClient) {
        var { error } = await supabase.from('reseller_clients').update(payload).eq('id', editClient.id);
        if (error) throw error;
        toast.success('Client updated');
      } else {
        var { error: e2 } = await supabase.from('reseller_clients').insert(payload);
        if (e2) throw e2;
        toast.success('Client added');
      }
      setShowForm(false); setEditClient(null); setForm(emptyForm); load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  function openEdit(client) {
    setEditClient(client);
    setForm({ reseller_id: client.reseller_id, business_name: client.business_name, contact_name: client.contact_name || '', contact_email: client.contact_email || '', contact_phone: client.contact_phone || '', plan: client.plan, monthly_amount: client.monthly_amount?.toString() || '', payment_status: client.payment_status, notes: client.notes || '' });
    setShowForm(true);
  }

  async function deleteClient(id) {
    if (!confirm('Delete this client?')) return;
    var { error } = await supabase.from('reseller_clients').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Client deleted'); load();
  }

  async function updatePayment(id, status) {
    var { error } = await supabase.from('reseller_clients').update({ payment_status: status }).eq('id', id);
    if (!error) { toast.success('Payment status updated'); load(); }
  }

  var paymentColors = { paid: 'bg-green-100 text-green-700', unpaid: 'bg-amber-100 text-amber-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500' };
  var summary = {
    total: clients.length,
    active: clients.filter(function(c) { return c.is_active; }).length,
    paid: clients.filter(function(c) { return c.payment_status === 'paid'; }).length,
    unpaid: clients.filter(function(c) { return c.payment_status === 'unpaid'; }).length,
    overdue: clients.filter(function(c) { return c.payment_status === 'overdue'; }).length,
    mrr: clients.filter(function(c) { return c.payment_status === 'paid'; }).reduce(function(s, c) { return s + Number(c.monthly_amount || 0); }, 0),
  };

  return (
    <div>
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {[
          { label: 'Total', value: summary.total, color: 'text-gray-900' },
          { label: 'Active', value: summary.active, color: 'text-blue-600' },
          { label: 'Paid', value: summary.paid, color: 'text-green-600' },
          { label: 'Unpaid', value: summary.unpaid, color: 'text-amber-600' },
          { label: 'Overdue', value: summary.overdue, color: 'text-red-600' },
          { label: 'MRR', value: 'R' + summary.mrr.toLocaleString(), color: 'text-green-600' },
        ].map(function(c) {
          return (
            <div key={c.label} className="bg-white rounded-lg border p-3 text-center">
              <p className="text-xs text-gray-400 uppercase">{c.label}</p>
              <p className={'text-xl font-bold ' + c.color}>{c.value}</p>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end mb-4">
        <Button onClick={function() { setEditClient(null); setForm(emptyForm); setShowForm(true); }} className="bg-green-600 hover:bg-green-700">
          <Plus className="w-4 h-4 mr-2" /> Add Client
        </Button>
      </div>

      {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : clients.length === 0 ? (
        <div className="text-center py-12"><Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No clients yet</p></div>
      ) : (
        <div className="space-y-3">
          {clients.map(function(c) {
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{c.business_name}</h3>
                    <p className="text-sm text-gray-500">{c.contact_name}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Reseller: <span className="font-medium">{c.resellers?.full_name || '—'}</span>
                      {' · '}Plan: <span className={'font-medium capitalize ' + (c.plan === 'growth' ? 'text-green-600' : 'text-blue-600')}>{c.plan}</span>
                      {' · '}R{Number(c.monthly_amount || 0).toLocaleString()}/mo
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={c.payment_status} onChange={function(e) { updatePayment(c.id, e.target.value); }}
                      className={'px-2.5 py-1 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none ' + (paymentColors[c.payment_status] || paymentColors.unpaid)}>
                      <option value="paid">paid</option>
                      <option value="unpaid">unpaid</option>
                      <option value="overdue">overdue</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </div>
                </div>
                {c.notes && <p className="text-xs text-gray-500 bg-gray-50 rounded p-2 mt-2">{c.notes}</p>}
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" onClick={function() { openEdit(c); }}><Edit className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={function() { deleteClient(c.id); }}><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={function(o) { if (!o) { setShowForm(false); setEditClient(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editClient ? 'Edit Client' : 'Add Client'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Reseller *</Label>
              <Select value={form.reseller_id} onValueChange={function(v) { setForm(function(p) { return { ...p, reseller_id: v }; }); }}>
                <SelectTrigger><SelectValue placeholder="Select reseller" /></SelectTrigger>
                <SelectContent>
                  {resellers.map(function(r) { return <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>; })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Business Name *</Label>
              <Input value={form.business_name} onChange={function(e) { setForm(function(p) { return { ...p, business_name: e.target.value }; }); }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contact Name</Label><Input value={form.contact_name} onChange={function(e) { setForm(function(p) { return { ...p, contact_name: e.target.value }; }); }} /></div>
              <div><Label>Contact Phone</Label><Input value={form.contact_phone} onChange={function(e) { setForm(function(p) { return { ...p, contact_phone: e.target.value }; }); }} /></div>
            </div>
            <div><Label>Contact Email</Label><Input value={form.contact_email} onChange={function(e) { setForm(function(p) { return { ...p, contact_email: e.target.value }; }); }} /></div>

            {/* Plan selector */}
            <div>
              <Label>Plan</Label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {[
                  { key: 'starter', label: 'Starter', price: 'R499/mo', desc: '1 store' },
                  { key: 'growth', label: 'Growth', price: 'R999/mo', desc: 'Up to 5 stores' },
                ].map(function(p) {
                  return (
                    <button key={p.key} type="button" onClick={function() { selectPlan(p.key); }}
                      className={'border-2 rounded-xl p-3 text-left transition-colors ' + (form.plan === p.key ? 'border-green-600 bg-green-50' : 'border-gray-200 hover:border-gray-300')}>
                      <p className={'font-semibold text-sm ' + (form.plan === p.key ? 'text-green-700' : 'text-gray-900')}>{p.label}</p>
                      <p className={'text-xs font-bold ' + (form.plan === p.key ? 'text-green-600' : 'text-gray-500')}>{p.price}</p>
                      <p className="text-xs text-gray-400">{p.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Monthly Amount (R)</Label>
                <Input type="number" value={form.monthly_amount} onChange={function(e) { setForm(function(p) { return { ...p, monthly_amount: e.target.value }; }); }} />
              </div>
              <div>
                <Label>Payment Status</Label>
                <Select value={form.payment_status} onValueChange={function(v) { setForm(function(p) { return { ...p, payment_status: v }; }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={function(e) { setForm(function(p) { return { ...p, notes: e.target.value }; }); }} rows={2} /></div>
            <Button onClick={handleSave} disabled={saving} className="w-full bg-green-600 hover:bg-green-700">{saving ? 'Saving...' : editClient ? 'Update Client' : 'Add Client'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── COMMISSIONS TAB ──────────────────────────────────────────

function CommissionsTab() {
  const { user } = useAuth();
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resellers, setResellers] = useState([]);
  const [form, setForm] = useState({ reseller_id: '', description: '', amount: '', type: 'once_off' });

  var load = useCallback(async function() {
    try {
      var { data, error } = await supabase.from('reseller_commissions').select('*, resellers(full_name), reseller_leads(business_name)').order('created_at', { ascending: false });
      if (error) throw error;
      setCommissions(data || []);
      var { data: rd } = await supabase.from('resellers').select('id, full_name').eq('status', 'approved');
      setResellers(rd || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(function() { load(); }, [load]);

  async function markPaid(id) {
    try {
      var { error } = await supabase.from('reseller_commissions').update({ status: 'paid', paid_at: new Date().toISOString(), paid_by: user.id }).eq('id', id);
      if (error) throw error;
      toast.success('Marked as paid'); load();
    } catch (err) { toast.error(err.message); }
  }

  async function addCommission() {
    if (!form.reseller_id || !form.amount) { toast.error('Reseller and amount required'); return; }
    setSaving(true);
    try {
      var { error } = await supabase.from('reseller_commissions').insert({ reseller_id: form.reseller_id, notes: form.description || 'Commission', amount: Number(form.amount), type: form.type, status: 'approved' });
      if (error) throw error;
      toast.success('Commission added'); setShowForm(false); setForm({ reseller_id: '', description: '', amount: '', type: 'once_off' }); load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  var statusColors = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700' };
  var totalPending = commissions.filter(function(c) { return c.status !== 'paid'; }).reduce(function(s, c) { return s + Number(c.amount); }, 0);
  var totalPaid = commissions.filter(function(c) { return c.status === 'paid'; }).reduce(function(s, c) { return s + Number(c.amount); }, 0);

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4 text-center">
          <p className="text-xs text-gray-400 uppercase mb-1">Pending Payout</p>
          <p className="text-2xl font-bold text-amber-600">R{totalPending.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg border p-4 text-center">
          <p className="text-xs text-gray-400 uppercase mb-1">Total Paid Out</p>
          <p className="text-2xl font-bold text-green-600">R{totalPaid.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex justify-end mb-4">
        <Button onClick={function() { setShowForm(true); }} className="bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2" /> Add Commission</Button>
      </div>

      {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : (
        <div className="space-y-3">
          {commissions.map(function(c) {
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{c.notes || 'Commission'}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {c.resellers?.full_name}
                    {c.reseller_leads?.business_name ? ' · ' + c.reseller_leads.business_name : ''}
                    {' · '}{new Date(c.created_at).toLocaleDateString('en-ZA')}
                    {' · '}<span className="capitalize">{c.type?.replace('_', '-') || 'once-off'}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-bold text-gray-900">R{Number(c.amount).toLocaleString()}</span>
                  <span className={'px-2.5 py-1 rounded-full text-xs font-medium ' + (statusColors[c.status] || statusColors.pending)}>{c.status}</span>
                  {c.status !== 'paid' && <Button size="sm" onClick={function() { markPaid(c.id); }} className="bg-green-600 hover:bg-green-700"><DollarSign className="w-3.5 h-3.5 mr-1" /> Pay</Button>}
                </div>
              </div>
            );
          })}
          {commissions.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">No commissions yet.</div>}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Commission</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Reseller *</Label>
              <Select value={form.reseller_id} onValueChange={function(v) { setForm(function(p) { return { ...p, reseller_id: v }; }); }}>
                <SelectTrigger><SelectValue placeholder="Select reseller" /></SelectTrigger>
                <SelectContent>{resellers.map(function(r) { return <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>; })}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={function(v) { setForm(function(p) { return { ...p, type: v }; }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="once_off">Once-off</SelectItem>
                  <SelectItem value="recurring">Recurring</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Input value={form.description} onChange={function(e) { setForm(function(p) { return { ...p, description: e.target.value }; }); }} placeholder="e.g. Referral — Green Leaf Vape" /></div>
            <div><Label>Amount (R) *</Label><Input type="number" value={form.amount} onChange={function(e) { setForm(function(p) { return { ...p, amount: e.target.value }; }); }} /></div>
            <Button onClick={addCommission} disabled={saving} className="w-full bg-green-600 hover:bg-green-700">{saving ? 'Adding...' : 'Add Commission'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── COURSES TAB ──────────────────────────────────────────────

function CoursesTab() {
  const { user } = useAuth();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editCourse, setEditCourse] = useState(null);
  const [showLessons, setShowLessons] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [lessonForm, setLessonForm] = useState(null);
  const [saving, setSaving] = useState(false);

  var emptyCourseFn = function() { return { title: '', description: '', is_published: false, sort_order: 0 }; };
  var emptyLessonFn = function() { return { title: '', content: '', video_url: '', pdf_url: '', sort_order: 0, duration_minutes: '' }; };
  var [courseForm, setCourseForm] = useState(emptyCourseFn());

  var load = useCallback(async function() {
    try {
      var { data, error } = await supabase.from('reseller_courses').select('*').order('sort_order');
      if (error) throw error;
      setCourses(data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(function() { load(); }, [load]);

  async function saveCourse() {
    if (!courseForm.title) { toast.error('Title required'); return; }
    setSaving(true);
    try {
      if (editCourse) {
        var { error } = await supabase.from('reseller_courses').update(courseForm).eq('id', editCourse.id);
        if (error) throw error;
        toast.success('Course updated');
      } else {
        var { error: e2 } = await supabase.from('reseller_courses').insert(courseForm);
        if (e2) throw e2;
        toast.success('Course created');
      }
      setShowForm(false); setEditCourse(null); setCourseForm(emptyCourseFn()); load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  async function deleteCourse(id) {
    if (!confirm('Delete this course?')) return;
    var { error } = await supabase.from('reseller_courses').delete().eq('id', id);
    if (!error) { toast.success('Deleted'); load(); }
  }

  async function openLessons(course) {
    setShowLessons(course);
    var { data } = await supabase.from('reseller_lesson_progress').select('*').eq('course_id', course.id);
    // For now show progress count — full lesson management uses the course video_url
    setLessons(data || []);
  }

  async function saveLesson() {
    if (!lessonForm?.title) { toast.error('Title required'); return; }
    setSaving(true);
    try {
      if (lessonForm.id) {
        var { error } = await supabase.from('reseller_courses').update({ title: lessonForm.title, description: lessonForm.content, video_url: lessonForm.video_url, sort_order: lessonForm.sort_order }).eq('id', lessonForm.id);
        if (error) throw error;
      } else {
        var { error: e2 } = await supabase.from('reseller_courses').insert({ title: lessonForm.title, description: lessonForm.content, video_url: lessonForm.video_url, sort_order: lessonForm.sort_order, is_published: true });
        if (e2) throw e2;
      }
      toast.success('Saved'); setLessonForm(null); load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  if (showLessons) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={function() { setShowLessons(null); }} className="text-sm text-green-600 hover:text-green-700">← Back to courses</button>
          <h3 className="font-semibold text-gray-900">{showLessons.title}</h3>
        </div>
        <div className="flex justify-end mb-4">
          <Button onClick={function() { setLessonForm(emptyLessonFn()); }} className="bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2" /> Add Lesson</Button>
        </div>
        <div className="space-y-2">
          {courses.filter(function(c) { return c.id !== showLessons.id; }).length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Each course is a lesson. Edit the course to update its video and content.</p>
          )}
          {courses.map(function(c, idx) {
            return (
              <div key={c.id} className="bg-white rounded-lg border p-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-gray-900">{idx + 1}. {c.title}</p>
                  <p className="text-xs text-gray-400">{c.video_url ? '· Video attached' : '· No video'}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={function() { setLessonForm({ id: c.id, title: c.title, content: c.description || '', video_url: c.video_url || '', sort_order: c.sort_order }); }}><Edit className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="text-red-500" onClick={function() { deleteCourse(c.id); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            );
          })}
        </div>

        <Dialog open={!!lessonForm} onOpenChange={function(o) { if (!o) setLessonForm(null); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{lessonForm?.id ? 'Edit Lesson' : 'Add Lesson'}</DialogTitle></DialogHeader>
            {lessonForm && (
              <div className="space-y-4">
                <div><Label>Title *</Label><Input value={lessonForm.title} onChange={function(e) { setLessonForm(function(p) { return { ...p, title: e.target.value }; }); }} /></div>
                <div><Label>Content / Description</Label><Textarea value={lessonForm.content} onChange={function(e) { setLessonForm(function(p) { return { ...p, content: e.target.value }; }); }} rows={4} /></div>
                <div><Label>Video URL (YouTube)</Label><Input value={lessonForm.video_url} onChange={function(e) { setLessonForm(function(p) { return { ...p, video_url: e.target.value }; }); }} placeholder="https://youtu.be/..." /></div>
                <div><Label>Sort Order</Label><Input type="number" value={lessonForm.sort_order} onChange={function(e) { setLessonForm(function(p) { return { ...p, sort_order: Number(e.target.value) }; }); }} /></div>
                <Button onClick={saveLesson} disabled={saving} className="w-full bg-green-600 hover:bg-green-700">{saving ? 'Saving...' : 'Save Lesson'}</Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={function() { setEditCourse(null); setCourseForm(emptyCourseFn()); setShowForm(true); }} className="bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2" /> New Course</Button>
      </div>
      {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : (
        <div className="space-y-3">
          {courses.map(function(c) {
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div><h3 className="font-semibold text-gray-900">{c.title}</h3>{c.description && <p className="text-sm text-gray-500 mt-1">{c.description}</p>}</div>
                  <span className={'px-2.5 py-1 rounded-full text-xs font-medium ' + (c.is_published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>{c.is_published ? 'Published' : 'Draft'}</span>
                </div>
                {c.video_url && <p className="text-xs text-blue-500 mt-1 truncate">{c.video_url}</p>}
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" onClick={function() { openLessons(c); }}><GraduationCap className="w-3.5 h-3.5 mr-1" /> Manage</Button>
                  <Button size="sm" variant="outline" onClick={function() { setEditCourse(c); setCourseForm({ title: c.title, description: c.description || '', is_published: c.is_published, sort_order: c.sort_order }); setShowForm(true); }}><Edit className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={function() { deleteCourse(c.id); }}><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={function(o) { if (!o) { setShowForm(false); setEditCourse(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editCourse ? 'Edit Course' : 'New Course'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Title *</Label><Input value={courseForm.title} onChange={function(e) { setCourseForm(function(p) { return { ...p, title: e.target.value }; }); }} /></div>
            <div><Label>Description</Label><Textarea value={courseForm.description} onChange={function(e) { setCourseForm(function(p) { return { ...p, description: e.target.value }; }); }} rows={3} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Sort Order</Label><Input type="number" value={courseForm.sort_order} onChange={function(e) { setCourseForm(function(p) { return { ...p, sort_order: Number(e.target.value) }; }); }} /></div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={courseForm.is_published} onChange={function(e) { setCourseForm(function(p) { return { ...p, is_published: e.target.checked }; }); }} className="rounded border-gray-300" />
                  <span className="text-sm font-medium">Published</span>
                </label>
              </div>
            </div>
            <Button onClick={saveCourse} disabled={saving} className="w-full bg-green-600 hover:bg-green-700">{saving ? 'Saving...' : editCourse ? 'Update Course' : 'Create Course'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── DOWNLOADS TAB ──────────────────────────────────────────

function DownloadsTab() {
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  var EMPTY = { name: '', description: '', category: 'Sales Materials', file_url: '', file_type: 'PDF', sort_order: 0, is_active: true };
  var [form, setForm] = useState(EMPTY);
  var CATEGORIES = ['Sales Materials', 'WhatsApp & Social', 'Demo Resources', 'Training'];
  var FILE_TYPES = ['PDF', 'DOC', 'ZIP', 'MP4', 'MP3', 'LINK'];

  var load = useCallback(async function() {
    var { data } = await supabase.from('reseller_downloads').select('*').order('sort_order');
    setDownloads(data || []);
    setLoading(false);
  }, []);

  useEffect(function() { load(); }, [load]);

  function openNew() { setForm(EMPTY); setEditing(null); setShowForm(true); }
  function openEdit(item) { setForm({ ...item }); setEditing(item.id); setShowForm(true); }

  async function save() {
    if (!form.name) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      if (editing) {
        var { error } = await supabase.from('reseller_downloads').update(form).eq('id', editing);
        if (error) throw error;
        toast.success('Updated');
      } else {
        var { error: e2 } = await supabase.from('reseller_downloads').insert(form);
        if (e2) throw e2;
        toast.success('Added');
      }
      setShowForm(false); setEditing(null); load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  async function toggleActive(id, val) {
    await supabase.from('reseller_downloads').update({ is_active: val }).eq('id', id);
    load();
  }

  async function deleteItem(id) {
    if (!confirm('Delete this download?')) return;
    await supabase.from('reseller_downloads').delete().eq('id', id);
    toast.success('Deleted'); load();
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={openNew} className="bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2" /> Add Download</Button>
      </div>
      {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : (
        <div className="space-y-3">
          {downloads.map(function(item) {
            return (
              <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 text-sm">{item.name}</p>
                    <span className={'px-2 py-0.5 rounded text-xs font-medium ' + (item.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>{item.is_active ? 'Active' : 'Hidden'}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{item.file_type}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{item.category}{item.description ? ' · ' + item.description : ''}</p>
                  {item.file_url ? (
                    <a href={item.file_url} target="_blank" rel="noreferrer" className="text-xs text-green-600 hover:underline mt-0.5 inline-block truncate max-w-sm">{item.file_url}</a>
                  ) : (
                    <p className="text-xs text-amber-500 mt-0.5">No URL — shows "Coming soon" to resellers</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={function() { toggleActive(item.id, !item.is_active); }}>{item.is_active ? 'Hide' : 'Show'}</Button>
                  <Button size="sm" variant="outline" onClick={function() { openEdit(item); }}><Edit className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={function() { deleteItem(item.id); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            );
          })}
          {downloads.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">No downloads yet.</div>}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={function(o) { if (!o) { setShowForm(false); setEditing(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit Download' : 'Add Download'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={form.name} onChange={function(e) { setForm(function(p) { return { ...p, name: e.target.value }; }); }} placeholder="e.g. Cannalife Co Brochure" /></div>
            <div><Label>Description</Label><Input value={form.description || ''} onChange={function(e) { setForm(function(p) { return { ...p, description: e.target.value }; }); }} placeholder="Short description shown to resellers" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={function(v) { setForm(function(p) { return { ...p, category: v }; }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(function(c) { return <SelectItem key={c} value={c}>{c}</SelectItem>; })}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>File Type</Label>
                <Select value={form.file_type} onValueChange={function(v) { setForm(function(p) { return { ...p, file_type: v }; }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FILE_TYPES.map(function(t) { return <SelectItem key={t} value={t}>{t}</SelectItem>; })}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>File URL</Label><Input value={form.file_url || ''} onChange={function(e) { setForm(function(p) { return { ...p, file_url: e.target.value }; }); }} placeholder="https://drive.google.com/... or YouTube link" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Sort Order</Label><Input type="number" value={form.sort_order} onChange={function(e) { setForm(function(p) { return { ...p, sort_order: Number(e.target.value) }; }); }} /></div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={function(e) { setForm(function(p) { return { ...p, is_active: e.target.checked }; }); }} className="rounded border-gray-300" />
                  <span className="text-sm font-medium">Visible to resellers</span>
                </label>
              </div>
            </div>
            <Button onClick={save} disabled={saving} className="w-full bg-green-600 hover:bg-green-700">{saving ? 'Saving...' : editing ? 'Update' : 'Add Download'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────

export default function AdminResellers() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reseller Program</h1>
        <p className="text-gray-500 text-sm mt-1">Manage resellers, leads, clients, commissions, training & downloads</p>
      </div>
      <Tabs defaultValue="resellers">
        <TabsList className="mb-6 w-full justify-start overflow-x-auto">
          <TabsTrigger value="resellers" className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Resellers</TabsTrigger>
          <TabsTrigger value="leads" className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4" /> Leads</TabsTrigger>
          <TabsTrigger value="clients" className="flex items-center gap-1.5"><Building2 className="w-4 h-4" /> Clients</TabsTrigger>
          <TabsTrigger value="commissions" className="flex items-center gap-1.5"><DollarSign className="w-4 h-4" /> Commissions</TabsTrigger>
          <TabsTrigger value="courses" className="flex items-center gap-1.5"><GraduationCap className="w-4 h-4" /> Training</TabsTrigger>
          <TabsTrigger value="downloads" className="flex items-center gap-1.5"><Download className="w-4 h-4" /> Downloads</TabsTrigger>
        </TabsList>
        <TabsContent value="resellers"><ResellersTab /></TabsContent>
        <TabsContent value="leads"><LeadsTab /></TabsContent>
        <TabsContent value="clients"><ClientsTab /></TabsContent>
        <TabsContent value="commissions"><CommissionsTab /></TabsContent>
        <TabsContent value="courses"><CoursesTab /></TabsContent>
        <TabsContent value="downloads"><DownloadsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
