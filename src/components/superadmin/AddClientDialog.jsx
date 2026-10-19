import { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserPlus, Loader2, Check, Copy, ExternalLink, X, Send } from 'lucide-react';

const PACKAGES = [
  { id: 'starter', name: 'Starter', price: 299, cycle: 'R299/mo' },
  { id: 'growth', name: 'Growth', price: 499, cycle: 'R499/mo' },
  { id: 'onceoff', name: 'Lifetime', price: 20000, cycle: 'R20,000 once-off' },
];

export default function AddClientDialog({ onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState('');
  const [form, setForm] = useState({
    company_name: '',
    owner_name: '',
    email: '',
    phone: '',
    package: 'starter',
    send_payment_link: true,
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.company_name || !form.email || !form.owner_name) {
      setError('Company name, owner name, and email are required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || 'https://ngblyttszqhgkxmeacmp.supabase.co'}/functions/v1/create-client`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(form),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create client');
      }

      setResult(data);
      if (onSuccess) onSuccess(data);
    } catch (err) {
      console.error('Create client error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const selectedPkg = PACKAGES.find(p => p.id === form.package);

  // Success state
  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-lg w-full space-y-5" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-400">
              <Check className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Client Created!</h2>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3 text-sm">
            <div className="bg-slate-800 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Company</span>
                <span className="text-white font-medium">{form.company_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email</span>
                <span className="text-white">{result.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Package</span>
                <span className="text-white">{selectedPkg?.name} ({selectedPkg?.cycle})</span>
              </div>
            </div>

            {/* Temp password */}
            <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg p-4">
              <p className="text-amber-400 text-xs font-medium mb-2">Temporary Login Credentials</p>
              <div className="flex items-center justify-between mb-1">
                <span className="text-slate-300">Email: <strong>{result.email}</strong></span>
                <button onClick={() => copyToClipboard(result.email, 'email')} className="text-slate-400 hover:text-white">
                  {copied === 'email' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Password: <strong>{result.temp_password}</strong></span>
                <button onClick={() => copyToClipboard(result.temp_password, 'password')} className="text-slate-400 hover:text-white">
                  {copied === 'password' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Payment link */}
            <div className="bg-slate-800 rounded-lg p-4">
              <p className="text-slate-400 text-xs mb-2">Payment Link</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={result.payment_link}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                />
                <button
                  onClick={() => copyToClipboard(result.payment_link, 'link')}
                  className="shrink-0 text-slate-400 hover:text-white"
                >
                  {copied === 'link' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
                <a href={result.payment_link} target="_blank" rel="noopener noreferrer" className="shrink-0 text-slate-400 hover:text-white">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>

            {result.email_sent && (
              <div className="flex items-center gap-2 text-emerald-400 text-xs">
                <Send className="w-3.5 h-3.5" />
                Welcome email with payment link sent to {result.email}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Close
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                const msg = `Welcome to Cannalife Co! 🌿\n\nYour account has been created.\n\nLogin: ${result.email}\nPassword: ${result.temp_password}\n\nComplete your payment here:\n${result.payment_link}\n\nThen log in at pos.cannalife.co.za`;
                copyToClipboard(msg, 'whatsapp');
              }}
            >
              {copied === 'whatsapp' ? (
                <><Check className="w-4 h-4" /> Copied!</>
              ) : (
                <><Copy className="w-4 h-4" /> Copy for WhatsApp</>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Form state
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">Add New Client</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="company_name" className="text-slate-300 text-sm">Company name *</Label>
              <Input id="company_name" name="company_name" required value={form.company_name} onChange={handleChange}
                className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="e.g. Green Leaf Club" />
            </div>
            <div>
              <Label htmlFor="owner_name" className="text-slate-300 text-sm">Owner name *</Label>
              <Input id="owner_name" name="owner_name" required value={form.owner_name} onChange={handleChange}
                className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="Full name" />
            </div>
            <div>
              <Label htmlFor="email" className="text-slate-300 text-sm">Email *</Label>
              <Input id="email" name="email" type="email" required value={form.email} onChange={handleChange}
                className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="client@email.com" />
            </div>
            <div>
              <Label htmlFor="phone" className="text-slate-300 text-sm">Phone</Label>
              <Input id="phone" name="phone" type="tel" value={form.phone} onChange={handleChange}
                className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="071 234 5678" />
            </div>
          </div>

          {/* Package selection */}
          <div>
            <Label className="text-slate-300 text-sm mb-2 block">Package</Label>
            <div className="grid grid-cols-3 gap-2">
              {PACKAGES.map(pkg => (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, package: pkg.id }))}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    form.package === pkg.id
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-slate-700 bg-slate-800 hover:border-slate-600'
                  }`}
                >
                  <p className="text-sm font-medium text-white">{pkg.name}</p>
                  <p className="text-xs text-slate-400">{pkg.cycle}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Send email toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="send_payment_link"
              checked={form.send_payment_link}
              onChange={handleChange}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
            />
            <span className="text-sm text-slate-300">Send welcome email with payment link</span>
          </label>

          {error && (
            <div className="bg-red-950/50 border border-red-800/60 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
              ) : (
                <><UserPlus className="w-4 h-4" /> Create Client</>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
