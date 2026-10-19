import { useState, useEffect, useCallback } from "react";
import { supabase } from '@/api/supabaseClient';
import { Mail, Phone, ShieldCheck, UserPlus, Trash2, Copy, Key, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCompany } from "../lib/CompanyContext";

// Roles that operate a till. Historically some clubs were set up with 'staff'
// and some with 'cashier' — both belong on this page.
const TILL_ROLES = ['cashier', 'staff'];

// Store types a till user can be assigned to. A warehouse has no till and no
// walk-in trade, so opening a cash float against it is meaningless — it stays
// out of the assignment pickers. Note this is about the TYPE of location, not
// about restricting a user to one store: any cashier can still be assigned to
// as many trading stores as needed.
const TILL_STORE_TYPES = ['single', 'branch', 'franchise'];

function isTillStore(store) {
  return TILL_STORE_TYPES.indexOf((store && store.type) || 'single') !== -1;
}

const ROLE_BADGE = {
  cashier: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  staff:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

const PAGE = 1000;

// PostgREST caps unbounded selects at 1000 rows and truncates silently.
const fetchAllPaged = async (buildQuery) => {
  let all = [];
  let from = 0;
  for (let guard = 0; guard < 100; guard++) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    all = all.concat(batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return all;
};

const phoneToEmail = (phone) => {
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.startsWith('27') && digits.length > 9
    ? '0' + digits.slice(2)
    : digits;
  return `${normalized}@cannalife.sms`;
};

const isPhoneNumber = (input) => {
  const cleaned = input.replace(/\D/g, '');
  return cleaned.length >= 9 && /^\d+$/.test(cleaned);
};

function StoreMultiSelect({ stores, selected, onChange }) {
  const toggle = (id) =>
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  return (
    <div>
      <Label className="text-xs">Assigned Stores * (select all that apply)</Label>
      {stores.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-1">No active trading stores — create a store first</p>
      ) : (
        <div className="mt-1 space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
          {stores.map(s => (
            <label key={s.id} className="flex items-center gap-2 cursor-pointer text-sm py-1 px-1 rounded hover:bg-muted/50">
              <input
                type="checkbox"
                className="accent-primary"
                checked={selected.includes(s.id)}
                onChange={() => toggle(s.id)}
              />
              {s.name}
              {s.type && <span className="text-xs text-muted-foreground">({s.type})</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Cashiers() {
  const { companyId } = useCompany();
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [stores, setStores] = useState([]);
  const [storeAssignments, setStoreAssignments] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [showAddManual, setShowAddManual] = useState(false);
  const [credentialsDialog, setCredentialsDialog] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [accountForm, setAccountForm] = useState({
    full_name: "", identifier: "", password: "", pin: "", store_ids: []
  });
  const [manualForm, setManualForm] = useState({
    full_name: "", email: "", phone: "", pin: "", notes: "", store_ids: []
  });

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [cashierUsers, sessionData, profileData, storeData, assignmentData] = await Promise.all([
        fetchAllPaged(() => supabase
          .from('profiles').select('*')
          .eq('company_id', companyId)
          .in('role', TILL_ROLES)
          .order('full_name', { ascending: true })),
        fetchAllPaged(() => supabase
          .from('cashier_sessions').select('id, cashier_id, status, opening_time')
          .eq('company_id', companyId)
          .order('opening_time', { ascending: false })),
        fetchAllPaged(() => supabase
          .from('cashier_profiles').select('*')
          .eq('company_id', companyId)
          .order('full_name', { ascending: true })),
        fetchAllPaged(() => supabase
          .from('stores').select('id, name, type')
          .eq('company_id', companyId).eq('is_active', true)
          .order('name')),
        fetchAllPaged(() => supabase
          .from('cashier_store_assignments').select('cashier_id, store_id')
          .eq('company_id', companyId)
          .order('cashier_id')),
      ]);

      setUsers(cashierUsers || []);
      setSessions(sessionData || []);
      setProfiles(profileData || []);
      setStores(storeData || []);
      const map = {};
      for (const a of assignmentData || []) {
        if (!map[a.cashier_id]) map[a.cashier_id] = [];
        map[a.cashier_id].push(a.store_id);
      }
      setStoreAssignments(map);
    } catch (err) {
      console.error('Failed to load cashiers:', err);
      toast.error('Failed to load cashiers');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { if (companyId) load(); }, [companyId, load]);

  // Assignable stores exclude warehouses. `stores` keeps the full list so that
  // any pre-existing warehouse assignment still resolves to a name in the
  // tables below rather than rendering blank.
  const assignableStores = stores.filter(isTillStore);

  const getStoreNames = (storeIds) => {
    if (!storeIds?.length) return null;
    return storeIds.map(id => stores.find(s => s.id === id)?.name).filter(Boolean).join(', ');
  };

  const saveAssignments = async (cashierId, storeIds) => {
    await supabase.from('cashier_store_assignments').delete().eq('cashier_id', cashierId);
    if (storeIds.length) {
      await supabase.from('cashier_store_assignments').insert(
        storeIds.map(sid => ({ cashier_id: cashierId, store_id: sid, company_id: companyId }))
      );
    }
    await supabase.from('profiles').update({ store_id: storeIds[0] || null }).eq('id', cashierId);
  };

  const handleCreateAccount = async () => {
    if (!accountForm.identifier || !accountForm.password || !accountForm.full_name) {
      toast.error("Please fill in name, email/phone, and password");
      return;
    }
    if (!accountForm.store_ids.length) {
      toast.error("Please select at least one store");
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be logged in");

      const trimmed = accountForm.identifier.trim();
      const isPhone = isPhoneNumber(trimmed);
      const email = isPhone ? phoneToEmail(trimmed) : trimmed;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-cashier`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email,
            password: accountForm.password,
            full_name: accountForm.full_name,
            pin_code: accountForm.pin || null,
            phone: isPhone ? trimmed : null,
            store_id: accountForm.store_ids[0],
          }),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        const msg = result?.error || "Failed to create cashier";
        setFormError(msg);
        toast.error(msg);
        return;
      }

      await saveAssignments(result.user_id, accountForm.store_ids);

      setCredentialsDialog({
        identifier: trimmed,
        email,
        password: accountForm.password,
        full_name: accountForm.full_name,
        pin: accountForm.pin,
        isPhone,
        storeNames: getStoreNames(accountForm.store_ids),
        adopted: result.adopted || false,
      });

      setAccountForm({ full_name: "", identifier: "", password: "", pin: "", store_ids: [] });
      setFormError("");
      setShowCreateAccount(false);
      toast.success(result.adopted
        ? `${accountForm.full_name}'s existing login re-linked as cashier`
        : `Cashier account created for ${accountForm.full_name}`);
      await load();
    } catch (err) {
      console.error("Create cashier failed:", err);
      const msg = err.message || "Failed to create cashier";
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleCredentialsDone = () => setCredentialsDialog(null);

  const copyCredentials = () => {
    if (!credentialsDialog) return;
    const loginWith = credentialsDialog.isPhone
      ? `Phone: ${credentialsDialog.identifier}`
      : `Email: ${credentialsDialog.email}`;
    const text = `Canna Life Co POS Login\n\n${loginWith}\nPassword: ${credentialsDialog.password}${credentialsDialog.pin ? `\nPIN: ${credentialsDialog.pin}` : ''}${credentialsDialog.storeNames ? `\nStores: ${credentialsDialog.storeNames}` : ''}\n\nLogin at: ${window.location.origin}/#/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Credentials copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddManual = async () => {
    if (!manualForm.full_name.trim()) return;
    if (!manualForm.store_ids.length) {
      toast.error("Please select at least one store");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('cashier_profiles')
        .insert({ company_id: companyId, ...manualForm, store_id: manualForm.store_ids[0], is_active: true });
      if (error) throw error;
      toast.success(`Cashier "${manualForm.full_name}" added as PIN-only till user`);
      setManualForm({ full_name: "", email: "", phone: "", pin: "", notes: "", store_ids: [] });
      setShowAddManual(false);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to add cashier');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCashier = async (id, name) => {
    if (!confirm(`Remove ${name}'s cashier account? This will delete their login access permanently.`)) return;
    try {
      const { error } = await supabase.rpc('delete_cashier', { p_user_id: id });
      if (error) throw error;
      toast.success(`${name} has been removed`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to delete cashier');
    }
  };

  const handleDeleteProfile = async (id) => {
    if (!confirm('Remove this cashier profile?')) return;
    const { error } = await supabase.from('cashier_profiles').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Cashier removed');
    await load();
  };

  const displayIdentifier = (email) => {
    if (email?.endsWith('@cannalife.sms')) return email.replace('@cannalife.sms', '');
    if (email?.endsWith('@cashier.cannalife.co.za')) return email.replace('@cashier.cannalife.co.za', '');
    return email;
  };
  const isPhoneAccount = (email) =>
    email?.endsWith('@cannalife.sms') || email?.endsWith('@cashier.cannalife.co.za');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cashiers</h1>
          <p className="text-sm text-muted-foreground">
            {users.length} login account{users.length !== 1 ? 's' : ''} · {profiles.length} PIN-only
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAddManual(true)}>
            <Key className="w-4 h-4 mr-1" /> PIN-Only
          </Button>
          <Button size="sm" onClick={() => { setFormError(""); setShowCreateAccount(true); }}>
            <UserPlus className="w-4 h-4 mr-1" /> Create Account
          </Button>
        </div>
      </div>

      {/* Login Account Cashiers */}
      <div className="rounded-lg border bg-card">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Login Accounts
          </h2>
        </div>
        {users.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground text-center">No login cashiers yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="p-3 text-left font-medium">Name</th>
                <th className="p-3 text-left font-medium">Role</th>
                <th className="p-3 text-left font-medium">Login</th>
                <th className="p-3 text-left font-medium">Stores</th>
                <th className="p-3 text-left font-medium">Sessions</th>
                <th className="p-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map(c => {
                const assigned = storeAssignments[c.id] || (c.store_id ? [c.store_id] : []);
                const storeNames = getStoreNames(assigned);
                const totalSessions = sessions.filter(s => s.cashier_id === c.id).length;
                // cashier_sessions has no ended_at column — open shifts are status='open'.
                const openSession = sessions.find(s => s.cashier_id === c.id && s.status === 'open');
                const phoneAcc = isPhoneAccount(c.email);
                return (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="p-3 font-medium">{c.full_name || '—'}</td>
                    <td className="p-3">
                      <span className={cn(
                        'text-xs px-2 py-1 rounded-full border font-medium capitalize',
                        ROLE_BADGE[c.role] || 'bg-muted text-muted-foreground border-border'
                      )}>
                        {c.role}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        {phoneAcc ? <Phone className="w-3 h-3 text-blue-400" /> : <Mail className="w-3 h-3" />}
                        {displayIdentifier(c.email)}
                      </div>
                    </td>
                    <td className="p-3">
                      {storeNames ? (
                        <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-1 rounded-full">{storeNames}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">{totalSessions}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-xs px-2 py-1 rounded-full border font-medium',
                          openSession
                            ? 'bg-green-500/10 text-green-500 border-green-500/20'
                            : 'bg-muted text-muted-foreground border-border'
                        )}>
                          {openSession ? '🟢 On Shift' : 'Off'}
                        </span>
                        <button
                          onClick={() => handleDeleteCashier(c.id, c.full_name || c.email)}
                          className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                          title="Remove cashier"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* PIN-Only Cashiers */}
      <div className="rounded-lg border bg-card">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Key className="w-4 h-4" /> PIN-Only Till Users
          </h2>
        </div>
        {profiles.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground text-center">No PIN-only cashiers yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="p-3 text-left font-medium">Name</th>
                <th className="p-3 text-left font-medium">Store</th>
                <th className="p-3 text-left font-medium">PIN</th>
                <th className="p-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => {
                const storeName = stores.find(s => s.id === p.store_id)?.name;
                return (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="p-3 font-medium">{p.full_name}</td>
                    <td className="p-3">
                      {storeName
                        ? <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-1 rounded-full">{storeName}</span>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">{p.pin || '—'}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-xs px-2 py-1 rounded-full border font-medium',
                          p.is_active
                            ? 'bg-green-500/10 text-green-500 border-green-500/20'
                            : 'bg-red-500/10 text-red-500 border-red-500/20'
                        )}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <button onClick={() => handleDeleteProfile(p.id)}
                          className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Login Account Dialog */}
      <Dialog open={showCreateAccount} onOpenChange={(open) => { setShowCreateAccount(open); if (!open) setFormError(""); }}>
        <DialogContent aria-describedby="create-account-desc">
          <DialogHeader><DialogTitle>Create Cashier Login Account</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p id="create-account-desc" className="text-sm text-muted-foreground">
              Creates a full Canna Life Co login. Assign to one or more stores — if multiple, the cashier picks which store when opening their shift.
            </p>
            <div>
              <Label className="text-xs">Full Name *</Label>
              <Input placeholder="Jane Doe" value={accountForm.full_name}
                onChange={e => setAccountForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Email or Phone Number *</Label>
              <Input type="text" placeholder="jane@email.com or 071 234 5678"
                value={accountForm.identifier}
                onChange={e => { setAccountForm(f => ({ ...f, identifier: e.target.value })); setFormError(""); }} />
              {accountForm.identifier && isPhoneNumber(accountForm.identifier.trim()) && (
                <p className="text-xs text-blue-400 mt-1 flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Phone login — cashier types this number to sign in
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Password *</Label>
              <Input type="password" placeholder="Min 6 characters" autoComplete="new-password"
                value={accountForm.password}
                onChange={e => setAccountForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">PIN Code (optional)</Label>
              <Input placeholder="1234" value={accountForm.pin}
                onChange={e => setAccountForm(f => ({ ...f, pin: e.target.value }))} />
            </div>
            <StoreMultiSelect
              stores={assignableStores}
              selected={accountForm.store_ids}
              onChange={v => setAccountForm(f => ({ ...f, store_ids: v }))}
            />
            {formError && (
              <p className="text-sm text-red-500 rounded-md bg-red-500/10 px-3 py-2">{formError}</p>
            )}
            <Button onClick={handleCreateAccount}
              disabled={!accountForm.full_name || !accountForm.identifier || !accountForm.password || !accountForm.store_ids.length || saving}
              className="w-full gap-2">
              <UserPlus className="w-4 h-4" />
              {saving ? 'Creating...' : 'Create Login Account'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Credentials Dialog */}
      <Dialog open={!!credentialsDialog} onOpenChange={() => setCredentialsDialog(null)}>
        <DialogContent aria-describedby="creds-desc">
          <DialogHeader>
            <DialogTitle>{credentialsDialog?.adopted ? 'Cashier Login Re-linked' : 'Cashier Account Created'}</DialogTitle>
          </DialogHeader>
          {credentialsDialog && (
            <div className="space-y-4">
              {credentialsDialog.adopted && (
                <p id="creds-desc" className="text-xs text-amber-400 bg-amber-500/10 rounded px-3 py-2">
                  This login already existed and has been re-linked to your club. Password reset to what you entered.
                </p>
              )}
              {!credentialsDialog.adopted && <span id="creds-desc" className="sr-only">Cashier credentials</span>}
              <div className="p-4 rounded-lg bg-muted space-y-2 text-sm font-mono">
                <p><span className="text-muted-foreground">Name:</span> {credentialsDialog.full_name}</p>
                <p><span className="text-muted-foreground">{credentialsDialog.isPhone ? 'Phone:' : 'Email:'}</span> {credentialsDialog.identifier}</p>
                <p><span className="text-muted-foreground">Password:</span> {credentialsDialog.password}</p>
                {credentialsDialog.pin && <p><span className="text-muted-foreground">PIN:</span> {credentialsDialog.pin}</p>}
                {credentialsDialog.storeNames && <p><span className="text-muted-foreground">Stores:</span> {credentialsDialog.storeNames}</p>}
              </div>
              <p className="text-xs text-muted-foreground">
                {credentialsDialog.isPhone
                  ? 'The cashier signs in with their phone number and password.'
                  : 'Share these credentials with the cashier.'}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={copyCredentials}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy Credentials'}
                </Button>
                <Button className="flex-1" onClick={handleCredentialsDone}>Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add PIN-Only Cashier Dialog */}
      <Dialog open={showAddManual} onOpenChange={setShowAddManual}>
        <DialogContent aria-describedby="pin-only-desc">
          <DialogHeader><DialogTitle>Add PIN-Only Cashier</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p id="pin-only-desc" className="text-sm text-muted-foreground">
              PIN-only cashiers don't have a login account. They punch in their PIN at the till.
            </p>
            {[
              { field: 'full_name', label: 'Full Name *', placeholder: 'Jane Doe' },
              { field: 'email', label: 'Email', placeholder: 'jane@example.com' },
              { field: 'phone', label: 'Phone', placeholder: '071 234 5678' },
              { field: 'pin', label: 'PIN Code', placeholder: '1234' },
              { field: 'notes', label: 'Notes', placeholder: 'Optional notes' },
            ].map(({ field, label, placeholder }) => (
              <div key={field}>
                <Label className="text-xs">{label}</Label>
                <Input placeholder={placeholder} value={manualForm[field]}
                  onChange={e => setManualForm(f => ({ ...f, [field]: e.target.value }))} />
              </div>
            ))}
            <StoreMultiSelect
              stores={assignableStores}
              selected={manualForm.store_ids}
              onChange={v => setManualForm(f => ({ ...f, store_ids: v }))}
            />
            <Button onClick={handleAddManual}
              disabled={!manualForm.full_name.trim() || !manualForm.store_ids.length || saving}
              className="w-full gap-2">
              <UserPlus className="w-4 h-4" />
              {saving ? 'Saving...' : 'Add Cashier'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
