import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Leaf, ArrowRight, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function ResellerSignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const isSuccess = searchParams.get('success') === '1';

  const handleSignup = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email, password: form.password,
        options: { data: { full_name: form.full_name, is_reseller: true } },
      });
      if (authError) throw authError;

      const { error: resellerError } = await supabase.from('resellers').insert({
        user_id: authData.user.id, full_name: form.full_name, email: form.email, phone: form.phone, status: 'pending',
      });
      if (resellerError) throw resellerError;

      await supabase.auth.signOut();
      navigate('/reseller/signup?success=1', { replace: true });
    } catch (err) {
      console.error('Signup error:', err);
      if (err.message?.includes('already registered')) {
        toast.error('This email is already registered. Try signing in instead.');
      } else {
        toast.error(err.message || 'Signup failed');
      }
    } finally {
      setLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-gray-900 rounded-2xl shadow-lg border border-gray-800 p-8 text-center">
          <div className="w-16 h-16 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Application Submitted!</h2>
          <p className="text-gray-400 mb-6">Thanks for applying to become a Cannalife Co reseller. We will review your application and get back to you shortly.</p>
          <Link to="/reseller/login">
            <Button className="bg-green-600 hover:bg-green-700">Go to Login <ArrowRight className="w-4 h-4 ml-2" /></Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-900/30">
            <Leaf className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Become a Reseller</h1>
          <p className="text-gray-400 mt-2">Join the Cannalife Co reseller program and earn commissions</p>
        </div>
        <div className="bg-gray-900 rounded-2xl shadow-lg border border-gray-800 p-8">
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <Label className="text-gray-300">Full Name *</Label>
              <Input value={form.full_name} onChange={e => update('full_name', e.target.value)} placeholder="Your full name" required className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" />
            </div>
            <div>
              <Label className="text-gray-300">Email *</Label>
              <Input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="you@example.com" required className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" />
            </div>
            <div>
              <Label className="text-gray-300">Phone Number</Label>
              <Input value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="072 123 4567" className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" />
            </div>
            <div>
              <Label className="text-gray-300">Password *</Label>
              <Input type="password" value={form.password} onChange={e => update('password', e.target.value)} placeholder="Min 6 characters" required className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" />
            </div>
            <div>
              <Label className="text-gray-300">Confirm Password *</Label>
              <Input type="password" value={form.confirm} onChange={e => update('confirm', e.target.value)} placeholder="Repeat password" required className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" />
            </div>
            <Button type="submit" disabled={loading || !form.full_name || !form.email || !form.password} className="w-full bg-green-600 hover:bg-green-700 h-11 text-base">
              {loading ? 'Submitting...' : 'Apply Now'}{!loading && <ArrowRight className="w-4 h-4 ml-2" />}
            </Button>
          </form>
          <p className="text-center text-sm text-gray-500 mt-6">Already a reseller? <Link to="/reseller/login" className="text-green-500 hover:text-green-400 font-medium">Sign in</Link></p>
        </div>
      </div>
    </div>
  );
}
