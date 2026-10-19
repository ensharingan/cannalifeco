import { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useNavigate, Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Leaf, ArrowRight, ArrowLeft, Mail } from 'lucide-react';
import { toast } from 'sonner';

export default function ResellerLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: reseller, error: rErr } = await supabase.from('resellers').select('id, status').eq('user_id', data.user.id).maybeSingle();
      if (rErr) throw rErr;
      if (!reseller) { await supabase.auth.signOut(); toast.error('No reseller account found for this email'); return; }
      navigate('/reseller/dashboard');
    } catch (err) { console.error('Login error:', err); toast.error(err.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetEmail.trim()) { toast.error('Please enter your email'); return; }
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: window.location.origin + '/#/reset-password',
      });
      if (error) throw error;
      setResetSent(true);
      toast.success('Password reset email sent!');
    } catch (err) {
      toast.error(err.message || 'Failed to send reset email');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-900/30"><Leaf className="w-8 h-8 text-white" /></div>
          <h1 className="text-3xl font-bold text-white">Reseller Portal</h1>
          <p className="text-gray-400 mt-2">{showReset ? 'Reset your password' : 'Sign in to your reseller dashboard'}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl shadow-lg border border-gray-800 p-8">

          {/* Password Reset Form */}
          {showReset ? (
            resetSent ? (
              <div className="text-center py-4">
                <div className="w-14 h-14 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4"><Mail className="w-7 h-7 text-green-400" /></div>
                <h3 className="text-lg font-semibold text-white mb-2">Check your email</h3>
                <p className="text-gray-400 text-sm mb-6">We sent a password reset link to <span className="text-white font-medium">{resetEmail}</span>. Click the link in the email to set a new password.</p>
                <Button variant="outline" onClick={() => { setShowReset(false); setResetSent(false); setResetEmail(''); }} className="border-gray-700 text-gray-300 hover:bg-gray-800">
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back to login
                </Button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <p className="text-gray-400 text-sm">Enter your email address and we'll send you a link to reset your password.</p>
                <div><Label className="text-gray-300">Email</Label><Input type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="you@example.com" required className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" autoFocus /></div>
                <Button type="submit" disabled={resetLoading || !resetEmail} className="w-full bg-green-600 hover:bg-green-700 h-11 text-base">
                  {resetLoading ? 'Sending...' : 'Send Reset Link'}{!resetLoading && <Mail className="w-4 h-4 ml-2" />}
                </Button>
                <button type="button" onClick={() => setShowReset(false)} className="w-full text-center text-sm text-gray-500 hover:text-gray-300 mt-2 flex items-center justify-center gap-1">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to login
                </button>
              </form>
            )
          ) : (
            /* Login Form */
            <>
              <form onSubmit={handleLogin} className="space-y-4">
                <div><Label className="text-gray-300">Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" /></div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-gray-300">Password</Label>
                    <button type="button" onClick={() => { setShowReset(true); setResetEmail(email); }} className="text-xs text-green-500 hover:text-green-400">Forgot password?</button>
                  </div>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" required className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500" />
                </div>
                <Button type="submit" disabled={loading || !email || !password} className="w-full bg-green-600 hover:bg-green-700 h-11 text-base">
                  {loading ? 'Signing in...' : 'Sign In'}{!loading && <ArrowRight className="w-4 h-4 ml-2" />}
                </Button>
              </form>
              <p className="text-center text-sm text-gray-500 mt-6">Want to become a reseller?{' '}<Link to="/reseller/signup" className="text-green-500 hover:text-green-400 font-medium">Apply now</Link></p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
