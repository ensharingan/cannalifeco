import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useResellerAuth } from '@/lib/ResellerAuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Save, UserCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function ResellerProfile() {
  const { reseller, refreshReseller } = useResellerAuth();
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', bank_name: '', bank_account_number: '', bank_branch_code: '', bank_account_type: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (reseller) setForm({
      full_name: reseller.full_name || '', email: reseller.email || '', phone: reseller.phone || '',
      bank_name: reseller.bank_name || '', bank_account_number: reseller.bank_account_number || '',
      bank_branch_code: reseller.bank_branch_code || '', bank_account_type: reseller.bank_account_type || '',
    });
  }, [reseller]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('resellers').update({
        full_name: form.full_name, phone: form.phone, bank_name: form.bank_name,
        bank_account_number: form.bank_account_number, bank_branch_code: form.bank_branch_code,
        bank_account_type: form.bank_account_type,
      }).eq('id', reseller.id);
      if (error) throw error;
      await refreshReseller();
      toast.success('Profile updated!');
    } catch (err) { toast.error(err.message || 'Failed to save'); } finally { setSaving(false); }
  };

  const SA_BANKS = ['ABSA', 'Capitec', 'FNB', 'Nedbank', 'Standard Bank', 'TymeBank', 'African Bank', 'Discovery Bank', 'Investec'];

  return (
    <div>
      <div className="mb-6"><h1 className="text-2xl font-bold text-white">My Profile</h1><p className="text-gray-400 text-sm mt-1">Manage your personal and banking details</p></div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <div className="flex items-center gap-3 mb-5"><UserCircle className="w-5 h-5 text-green-400" /><h3 className="font-semibold text-white">Personal Information</h3></div>
          <div className="space-y-4">
            <div><Label className="text-gray-300">Full Name</Label><Input value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} className="bg-gray-800 border-gray-700 text-white" /></div>
            <div><Label className="text-gray-300">Email</Label><Input value={form.email} disabled className="bg-gray-800/50 border-gray-700 text-gray-500" /><p className="text-xs text-gray-600 mt-1">Email cannot be changed</p></div>
            <div><Label className="text-gray-300">Phone Number</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="072 123 4567" className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" /></div>
          </div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <div className="flex items-center gap-3 mb-5"><span className="text-green-400 font-bold text-lg">R</span><h3 className="font-semibold text-white">Banking Details</h3></div>
          <p className="text-xs text-gray-500 mb-4">Required for commission payouts</p>
          <div className="space-y-4">
            <div><Label className="text-gray-300">Bank</Label><select value={form.bank_name} onChange={e => setForm(p => ({ ...p, bank_name: e.target.value }))} className="w-full h-10 rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-white"><option value="">Select bank</option>{SA_BANKS.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
            <div><Label className="text-gray-300">Account Number</Label><Input value={form.bank_account_number} onChange={e => setForm(p => ({ ...p, bank_account_number: e.target.value }))} placeholder="Account number" className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-gray-300">Branch Code</Label><Input value={form.bank_branch_code} onChange={e => setForm(p => ({ ...p, bank_branch_code: e.target.value }))} placeholder="e.g. 250655" className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" /></div>
              <div><Label className="text-gray-300">Account Type</Label><select value={form.bank_account_type} onChange={e => setForm(p => ({ ...p, bank_account_type: e.target.value }))} className="w-full h-10 rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-white"><option value="">Select</option><option value="cheque">Cheque</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select></div>
            </div>
          </div>
          <div className="mt-4 px-3 py-2 rounded-lg bg-green-900/20 border border-green-800"><p className="text-xs text-green-400">Commission rate: <span className="font-bold">{reseller?.commission_rate || 10}%</span> — set by admin</p></div>
        </div>
      </div>
      <div className="mt-6 flex justify-end"><Button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700"><Save className="w-4 h-4 mr-2" />{saving ? 'Saving...' : 'Save Changes'}</Button></div>
    </div>
  );
}
