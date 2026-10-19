import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import cannalifeLogo from '../cannalife-logo.png';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');

    if (tokenHash && type === 'recovery') {
      // Exchange the token hash for a session
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        .then(({ data, error }) => {
          if (error) {
            console.error('Token verification failed:', error);
            setValidSession(false);
          } else {
            setValidSession(true);
          }
          setChecking(false);
        });
    } else {
      // No token in URL — check if there's already an active recovery session
      supabase.auth.getSession().then(({ data: { session } }) => {
        setValidSession(!!session);
        setChecking(false);
      });
    }
  }, []);

  const handleReset = async () => {
    if (!password || password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success('Password updated successfully');
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!validSession) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-4xl">🔗</div>
          <h1 className="text-xl font-bold text-gray-900">Invalid or expired link</h1>
          <p className="text-sm text-gray-500">This password reset link is no longer valid. Please request a new one.</p>
          <Button onClick={() => navigate('/login')} className="w-full">
            Back to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <img src={cannalifeLogo} alt="Cannalife Co POS" className="h-16 w-auto mx-auto mb-2" />
          <h1 className="text-2xl font-bold text-gray-900">Set new password</h1>
          <p className="text-sm text-gray-500">Enter a new password for your account</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-xs text-gray-600">New Password</label>
            <Input
              type="password"
              placeholder="Min 8 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="bg-white border-gray-300 text-gray-900"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-600">Confirm Password</label>
            <Input
              type="password"
              placeholder="Repeat password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleReset()}
              className="bg-white border-gray-300 text-gray-900"
            />
          </div>
          <Button
            onClick={handleReset}
            disabled={loading || !password || !confirm}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </Button>
        </div>
      </div>
    </div>
  );
}
