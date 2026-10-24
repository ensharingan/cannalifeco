import { useState, useEffect, useCallback } from "react";
import { supabase } from '@/api/supabaseClient';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCIES } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { KeyRound, Copy, QrCode, ExternalLink, Download, UserPlus, Users, Trash2, Shield, Mail, Star } from "lucide-react";

export default function Settings() {
  const { companyId, refresh: refreshCompany } = useCompany();
  const { profile } = useAuth();
  // Franchisee managers only get the Member Portal tab; company, team,
  // currency and supplier settings stay with owners / superadmins.
  const portalOnly = profile?.role === 'manager';
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [newSupplier, setNewSupplier] = useState({ name: "", contact_name: "", phone: "", email: "" });
  const [selectedCurrency, setSelectedCurrency] = useState(localStorage.getItem("currency_code") || "ZAR");

  const loadSuppliers = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error) setSuppliers(data || []);
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([
      supabase.from('companies').select('*').eq('id', companyId).single(),
      supabase.from('suppliers').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(50),
    ]).then(([{ data: companyData }, { data: suppliersData }]) => {
      if (companyData) {
        setCompany(companyData);
        setForm(companyData);
      }
      setSuppliers(suppliersData || []);
    }).finally(() => setLoading(false));
  }, [companyId]);

  const saveCompany = async () => {
    setIsSaving(true);
    try {
      if (company) {
        const { error } = await supabase.from('companies').update(form).eq('id', company.id);
        if (error) throw error;
      }
      await refreshCompany();
      toast.success("Company settings saved");
    } catch (err) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const addSupplier = async () => {
    if (!newSupplier.name.trim()) return;
    try {
      const { error } = await supabase.from('suppliers').insert({ ...newSupplier, company_id: companyId });
      if (error) throw error;
      toast.success("Supplier added");
      setNewSupplier({ name: "", contact_name: "", phone: "", email: "" });
      await loadSuppliers();
    } catch (err) {
      toast.error(err.message || 'Failed to add supplier');
    }
  };

  const deleteSupplier = async (id) => {
    try {
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw error;
      toast.success("Supplier removed");
      setSuppliers(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      toast.error(err.message || 'Failed to remove supplier');
    }
  };

  const saveCurrency = (code) => {
    setSelectedCurrency(code);
    localStorage.setItem("currency_code", code);
    toast.success("Currency updated");
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your company and team</p>
      </div>

      <Tabs defaultValue={portalOnly ? "portal" : "company"}>
        <TabsList className="flex-wrap">
          {!portalOnly && <TabsTrigger value="company">Company</TabsTrigger>}
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="portal">Member Portal</TabsTrigger>
        </TabsList>

        {/* Company tab */}
        <TabsContent value="company" className="space-y-4 mt-4">
          <div className="bg-card rounded-xl border border-border p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Company Name</Label><Input value={form.company_name || ""} onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))} /></div>
              <div><Label>Trading Name</Label><Input value={form.trading_name || ""} onChange={e => setForm(p => ({ ...p, trading_name: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Registration Number</Label><Input value={form.registration_number || ""} onChange={e => setForm(p => ({ ...p, registration_number: e.target.value }))} /></div>
              <div><Label>Phone</Label><Input value={form.phone || ""} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>VAT Number</Label>
                <Input
                  value={form.vat_number || ""}
                  onChange={e => setForm(p => ({ ...p, vat_number: e.target.value }))}
                  placeholder="e.g. 4123456789"
                />
                <p className="text-xs text-muted-foreground mt-1">Enter your SARS VAT number to enable the VAT Report. Leave blank if not VAT-registered.</p>
              </div>
              <div></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Email</Label><Input value={form.email || ""} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><Label>City</Label><Input value={form.city || ""} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} /></div>
            </div>
            <div><Label>Address</Label><Input value={form.address || ""} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></div>
            <div><Label>Country</Label><Input value={form.country || ""} onChange={e => setForm(p => ({ ...p, country: e.target.value }))} /></div>
            <div>
              <Label>Payment link</Label>
              <Input
                value={(form.pos_settings && form.pos_settings.payment_link_url) || ""}
                onChange={e => setForm(p => ({ ...p, pos_settings: { ...(p.pos_settings || {}), payment_link_url: e.target.value } }))}
                placeholder="https://pay.example.com/your-link?amount={amount}&ref={ref}"
              />
              <p className="text-xs text-muted-foreground mt-1">Shown at the till under Payment Link. {"{amount}"} and {"{ref}"} are filled in per sale; leave them out for a fixed link.</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="pr-4">
                <Label>Allow selling into negative stock</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Let cashiers complete sales even when stock is at or below zero. Stock will show negative so management can reconcile.</p>
              </div>
              <Switch
                checked={!!form.allow_negative_stock}
                onCheckedChange={v => setForm(p => ({ ...p, allow_negative_stock: v }))}
              />
            </div>
            <Button onClick={saveCompany} disabled={isSaving}>{isSaving ? "Saving..." : "Save Settings"}</Button>
          </div>
        </TabsContent>

        {/* Team tab */}
        <TabsContent value="team" className="space-y-4 mt-4">
          <TeamManagement companyId={companyId} />
        </TabsContent>

        {/* Member Portal tab */}
        <TabsContent value="portal" className="space-y-4 mt-4">
          <MemberPortalSettings companyId={companyId} companyName={company?.trading_name || company?.company_name || ''} />
        </TabsContent>

        {/* Currency tab */}
        <TabsContent value="currency" className="mt-4">
          <div className="bg-card rounded-xl border border-border p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-1">Currency</h3>
              <p className="text-xs text-muted-foreground mb-4">Select the currency used across your POS and reports.</p>
              <Label>Select Currency</Label>
              <Select value={selectedCurrency} onValueChange={saveCurrency}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {CURRENCIES.map(c => (
                    <SelectItem key={c.code} value={c.code}>
                      <span className="font-mono mr-2 text-primary">{c.symbol}</span>
                      {c.name} — {c.country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">Current currency</p>
              <p className="text-2xl font-bold text-primary mt-1">
                {CURRENCIES.find(c => c.code === selectedCurrency)?.symbol} — {selectedCurrency}
              </p>
              <p className="text-sm text-muted-foreground">{CURRENCIES.find(c => c.code === selectedCurrency)?.name}</p>
            </div>
          </div>
        </TabsContent>

        {/* Suppliers tab */}
        <TabsContent value="suppliers" className="space-y-4 mt-4">
          <div className="bg-card rounded-xl border border-border p-5 space-y-4">
            <h3 className="text-sm font-semibold">Add Supplier</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Name *" value={newSupplier.name} onChange={e => setNewSupplier(p => ({ ...p, name: e.target.value }))} />
              <Input placeholder="Contact Name" value={newSupplier.contact_name} onChange={e => setNewSupplier(p => ({ ...p, contact_name: e.target.value }))} />
              <Input placeholder="Phone" value={newSupplier.phone} onChange={e => setNewSupplier(p => ({ ...p, phone: e.target.value }))} />
              <Input placeholder="Email" value={newSupplier.email} onChange={e => setNewSupplier(p => ({ ...p, email: e.target.value }))} />
            </div>
            <Button onClick={addSupplier} disabled={!newSupplier.name.trim()} size="sm">Add Supplier</Button>
          </div>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Name</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Contact</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Phone</th>
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(s => (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="p-3 text-sm font-medium">{s.name}</td>
                    <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell">{s.contact_name}</td>
                    <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">{s.phone}</td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => deleteSupplier(s.id)} className="text-red-500 hover:text-red-600 text-xs">Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!suppliers.length && <p className="text-sm text-muted-foreground text-center py-8">No suppliers yet</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Team Management Component ─── */

function TeamManagement({ companyId }) {
  const { user, profile } = useAuth();
  // Franchisee managers can only add and manage staff and cashiers.
  const isManager = profile?.role === 'manager';
  const defaultRole = isManager ? 'staff' : 'manager';
  const [team, setTeam] = useState([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [newMember, setNewMember] = useState({ email: "", password: "", full_name: "", role: defaultRole });
  const [showForm, setShowForm] = useState(false);
  const [pinTarget, setPinTarget] = useState(null);
  const [pinValue, setPinValue] = useState("");
  const [pinSaving, setPinSaving] = useState(false);

  const savePin = async (clear) => {
    if (!pinTarget) return;
    if (!clear && !/^[0-9]{4}$/.test(pinValue)) { toast.error("PIN must be exactly 4 digits"); return; }
    setPinSaving(true);
    try {
      const { data, error } = await supabase.rpc('set_staff_pin', { p_user_id: pinTarget.id, p_pin: clear ? '' : pinValue });
      if (error) throw error;
      if (!data || !data.ok) throw new Error((data && data.error) || "Could not save PIN");
      toast.success(clear ? "PIN removed" : "PIN saved");
      setPinTarget(null);
      setPinValue("");
    } catch (err) {
      toast.error(err.message || "Could not save PIN");
    } finally {
      setPinSaving(false);
    }
  };

  const ROLE_LABELS = {
    superadmin: { label: "Super Admin", color: "text-red-500 bg-red-500/10" },
    owner:   { label: "Owner",   color: "text-yellow-500 bg-yellow-500/10" },
    manager: { label: "Manager", color: "text-blue-500 bg-blue-500/10" },
    staff:   { label: "Staff",   color: "text-purple-500 bg-purple-500/10" },
    cashier: { label: "Cashier", color: "text-green-500 bg-green-500/10" },
  };

  const loadTeam = useCallback(async () => {
    if (!companyId) return;
    setLoadingTeam(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setTeam(data || []);
    } catch (err) {
      toast.error("Failed to load team");
    } finally {
      setLoadingTeam(false);
    }
  }, [companyId]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  const handleAdd = async () => {
    if (!newMember.email.trim() || !newMember.password.trim()) { toast.error("Email and password are required"); return; }
    if (newMember.password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    setAdding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-team-member`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: newMember.email.trim().toLowerCase(),
          password: newMember.password,
          full_name: newMember.full_name.trim() || newMember.email.trim(),
          role: newMember.role,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create team member");
      toast.success(`${newMember.role.charAt(0).toUpperCase() + newMember.role.slice(1)} account created`);
      setNewMember({ email: "", password: "", full_name: "", role: defaultRole });
      setShowForm(false);
      await loadTeam();
    } catch (err) {
      toast.error(err.message || "Failed to create team member");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (memberId) => {
    if (memberId === user?.id) { toast.error("You can't remove yourself"); return; }
    if (!confirm("Remove this team member? They will lose access to the platform.")) return;
    setRemovingId(memberId);
    try {
      const { error } = await supabase.rpc('team_remove_member', { p_member: memberId });
      if (error) throw error;
      toast.success("Team member removed");
      setTeam(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      toast.error(err.message || "Failed to remove team member");
    } finally {
      setRemovingId(null);
    }
  };

  const handleChangeRole = async (memberId, newRole) => {
    if (memberId === user?.id) { toast.error("You can't change your own role"); return; }
    var target = team.find(m => m.id === memberId);
    var ownerCount = team.filter(m => m.role === 'owner').length;
    if (target && target.role === 'owner' && newRole !== 'owner' && ownerCount <= 1) {
      toast.error("This is the last owner — promote another owner before changing this one");
      return;
    }
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', memberId).eq('company_id', companyId);
      if (error) throw error;
      setTeam(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m));
      toast.success("Role updated");
    } catch (err) {
      toast.error(err.message || "Failed to update role");
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4" /> Team Members</h3>
            <p className="text-xs text-muted-foreground">Add co-owners, managers or staff who need access to the platform</p>
          </div>
          {!showForm && <Button size="sm" onClick={() => setShowForm(true)} className="gap-1"><UserPlus className="w-4 h-4" /> Add Member</Button>}
        </div>
        {showForm && (
          <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
            <h4 className="text-sm font-semibold">New Team Member</h4>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Full Name</Label><Input placeholder="e.g. John Smith" value={newMember.full_name} onChange={e => setNewMember(p => ({ ...p, full_name: e.target.value }))} /></div>
              <div>
                <Label>Role *</Label>
                <Select value={newMember.role} onValueChange={v => setNewMember(p => ({ ...p, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!isManager && <SelectItem value="owner">Owner — Full access + billing</SelectItem>}
                    {!isManager && <SelectItem value="manager">Manager — Full access</SelectItem>}
                    <SelectItem value="staff">Staff — Limited access</SelectItem>
                    <SelectItem value="cashier">Cashier — POS only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email *</Label><Input type="email" placeholder="manager@example.com" value={newMember.email} onChange={e => setNewMember(p => ({ ...p, email: e.target.value }))} /></div>
              <div><Label>Password *</Label><Input type="text" placeholder="Min 6 characters" value={newMember.password} onChange={e => setNewMember(p => ({ ...p, password: e.target.value }))} /></div>
            </div>
            {newMember.role === "owner" && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                <p className="text-xs text-yellow-400"><Shield className="w-3 h-3 inline mr-1" /><strong>Owner</strong> gets full access including billing, settings, and team management — the same as you. Only give this to a co-owner you fully trust.</p>
              </div>
            )}
            {newMember.role === "manager" && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                <p className="text-xs text-blue-400"><Shield className="w-3 h-3 inline mr-1" /><strong>Manager</strong> gets full access: Dashboard, POS, Products, Members, Orders, Inventory, Finances, and Settings.</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setNewMember({ email: "", password: "", full_name: "", role: defaultRole }); }}>Cancel</Button>
              <Button size="sm" onClick={handleAdd} disabled={adding || !newMember.email.trim() || !newMember.password.trim()}>{adding ? "Creating..." : "Create Account"}</Button>
            </div>
          </div>
        )}
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {loadingTeam ? (
          <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Name</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Email</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Role</th>
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {team.map(m => {
                const isMe = m.id === user?.id;
                const roleInfo = ROLE_LABELS[m.role] || { label: m.role, color: "text-muted-foreground bg-muted" };
                // Own row and internal super-admin rows are shown as a static badge (not editable here).
                const lockedRole = isMe || m.role === "superadmin" || (isManager && !["staff", "cashier"].includes(m.role));
                return (
                  <tr key={m.id} className="border-b border-border/50">
                    <td className="p-3">
                      <p className="text-sm font-medium">{m.full_name || "—"}{isMe && <span className="text-xs text-muted-foreground ml-1">(you)</span>}</p>
                      <p className="text-xs text-muted-foreground sm:hidden">{m.email}</p>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell">{m.email}</td>
                    <td className="p-3">
                      {lockedRole ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${roleInfo.color}`}>{roleInfo.label}</span>
                      ) : (
                        <Select value={m.role} onValueChange={v => handleChangeRole(m.id, v)}>
                          <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {!isManager && <SelectItem value="owner">Owner</SelectItem>}
                            {!isManager && <SelectItem value="manager">Manager</SelectItem>}
                            <SelectItem value="staff">Staff</SelectItem>
                            <SelectItem value="cashier">Cashier</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {["owner", "manager"].includes(m.role) && (
                        <Button variant="ghost" size="sm" onClick={() => { setPinTarget(m); setPinValue(""); }} className="text-xs gap-1">
                          <KeyRound className="w-3 h-3" /> PIN
                        </Button>
                      )}
                      {!isMe && m.role !== "superadmin" && !(isManager && !["staff", "cashier"].includes(m.role)) && (
                        <Button variant="ghost" size="sm" onClick={() => handleRemove(m.id)} disabled={removingId === m.id} className="text-red-500 hover:text-red-600 text-xs">
                          {removingId === m.id ? "..." : "Remove"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loadingTeam && team.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No team members found</p>}
      </div>
      <Dialog open={!!pinTarget} onOpenChange={(v) => { if (!v) { setPinTarget(null); setPinValue(""); } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Approval PIN</DialogTitle>
            <DialogDescription>
              4-digit PIN for {pinTarget?.full_name || pinTarget?.email}. Cashiers ask this person to enter it to approve refunds.
            </DialogDescription>
          </DialogHeader>
          <Input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pinValue}
            onChange={e => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="••••" className="text-center text-2xl tracking-[0.5em] h-12" />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => savePin(true)} disabled={pinSaving}>Remove PIN</Button>
            <Button className="flex-1" onClick={() => savePin(false)} disabled={pinSaving || pinValue.length !== 4}>{pinSaving ? "Saving..." : "Save PIN"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-blue-400 mb-2">Role Permissions</h3>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div><span className="font-medium text-yellow-400">Owner</span> — Full access including billing, settings and team management</div>
          <div><span className="font-medium text-blue-400">Manager</span> — Full access: Dashboard, POS, Products, Members, Orders, Inventory, Finances, Settings</div>
          <div><span className="font-medium text-purple-400">Staff</span> — POS, Members, Products, Orders</div>
          <div><span className="font-medium text-green-400">Cashier</span> — POS, Sales, Finances (record expenses only)</div>
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-3">Note: owner-only sections (Stores, Cashiers, Marketing, Staff Performance, Settings) are hidden from Managers. A co-owner must be given the <span className="text-yellow-400 font-medium">Owner</span> role to see everything you see.</p>
      </div>
    </div>
  );
}

/* ─── Member Portal Settings Component ─── */

function MemberPortalSettings({ companyId, companyName }) {
  const [copiedPortal, setCopiedPortal] = useState(false);
  const [copiedReg, setCopiedReg] = useState(false);

  const portalUrl = `${window.location.origin}/#/member-portal/${companyId}`;
  const registrationUrl = `${window.location.origin}/#/register?company=${companyId}`;
  const portalQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(portalUrl)}&bgcolor=0a0a0a&color=22c55e&margin=20`;
  const regQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(registrationUrl)}&bgcolor=0a0a0a&color=3b82f6&margin=20`;

  const copyLink = (url, type) => {
    navigator.clipboard.writeText(url).then(() => {
      if (type === "portal") { setCopiedPortal(true); setTimeout(() => setCopiedPortal(false), 2000); }
      else { setCopiedReg(true); setTimeout(() => setCopiedReg(false), 2000); }
      toast.success("Link copied!");
    }).catch(() => toast.error("Failed to copy"));
  };

  const downloadQR = (url, label) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(companyName || 'cannalife').replace(/\s+/g, '-').toLowerCase()}-${label}-qr.png`;
    link.click();
    toast.success("QR code downloaded");
  };

  const printQR = (qrImageUrl, title, subtitle) => {
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>${title} - ${companyName}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;font-family:Arial,sans-serif}.container{text-align:center;padding:40px}.logo{font-size:48px;margin-bottom:16px}h1{font-size:28px;color:#1a1a2e;margin:0 0 8px}p{font-size:14px;color:#666;margin:0 0 32px}img{width:280px;height:280px;border:2px solid #eee;border-radius:12px}.footer{font-size:10px;color:#ccc;margin-top:32px}</style></head><body><div class="container"><div class="logo">🌿</div><h1>${companyName||title}</h1><p>${subtitle}</p><img src="${qrImageUrl}" alt="QR Code"/><div class="footer">Powered by Canna Life Co</div></div><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><UserPlus className="w-5 h-5 text-blue-500" /></div>
          <div><h3 className="text-sm font-semibold">Member Registration</h3><p className="text-xs text-muted-foreground">New members scan this QR to self-register — no login needed</p></div>
        </div>
        <div className="flex flex-col sm:flex-row gap-6 items-center">
          <div className="bg-[#0a0a0a] rounded-xl p-4 border border-border"><img src={regQrUrl} alt="Registration QR Code" className="w-48 h-48 rounded-lg" /></div>
          <div className="flex-1 space-y-3">
            <p className="text-sm text-muted-foreground">Print or display this QR code at your entrance or counter. New visitors scan it to become a member instantly.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadQR(regQrUrl, 'registration')}><Download className="w-4 h-4 mr-1" /> Download</Button>
              <Button size="sm" variant="outline" onClick={() => printQR(regQrUrl, 'Member Registration', 'Scan to become a member')}>🖨️ Print</Button>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Registration Link</h4>
          <div className="flex gap-2">
            <div className="flex-1 bg-muted rounded-lg px-4 py-3 text-sm font-mono text-muted-foreground break-all select-all">{registrationUrl}</div>
            <Button variant="outline" onClick={() => copyLink(registrationUrl, "reg")} className="shrink-0"><Copy className="w-4 h-4 mr-1" />{copiedReg ? "Copied!" : "Copy"}</Button>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="outline" onClick={() => window.open(registrationUrl, '_blank')}><ExternalLink className="w-4 h-4 mr-1" /> Preview</Button>
            <Button size="sm" variant="outline" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Join ${companyName}! Register as a member here: ${registrationUrl}`)}`, '_blank')}>💬 Share via WhatsApp</Button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><QrCode className="w-5 h-5 text-green-500" /></div>
          <div><h3 className="text-sm font-semibold">Member Portal</h3><p className="text-xs text-muted-foreground">Existing members scan this to log in and view their membership</p></div>
        </div>
        <div className="flex flex-col sm:flex-row gap-6 items-center">
          <div className="bg-[#0a0a0a] rounded-xl p-4 border border-border"><img src={portalQrUrl} alt="Member Portal QR Code" className="w-48 h-48 rounded-lg" /></div>
          <div className="flex-1 space-y-3">
            <p className="text-sm text-muted-foreground">Display this QR at your counter. Members scan to view their membership card, loyalty points, and store menu.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadQR(portalQrUrl, 'portal')}><Download className="w-4 h-4 mr-1" /> Download</Button>
              <Button size="sm" variant="outline" onClick={() => printQR(portalQrUrl, 'Member Portal', 'Scan to access your membership')}>🖨️ Print</Button>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Portal Link</h4>
          <div className="flex gap-2">
            <div className="flex-1 bg-muted rounded-lg px-4 py-3 text-sm font-mono text-muted-foreground break-all select-all">{portalUrl}</div>
            <Button variant="outline" onClick={() => copyLink(portalUrl, "portal")} className="shrink-0"><Copy className="w-4 h-4 mr-1" />{copiedPortal ? "Copied!" : "Copy"}</Button>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="outline" onClick={() => window.open(portalUrl, '_blank')}><ExternalLink className="w-4 h-4 mr-1" /> Open Portal</Button>
            <Button size="sm" variant="outline" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Hey! Access your ${companyName} membership here: ${portalUrl}`)}`, '_blank')}>💬 Share via WhatsApp</Button>
          </div>
        </div>
      </div>

      <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-green-400 mb-2">What members can do</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>✅ Self-register via QR code (no app needed)</div>
          <div>✅ View their membership profile</div>
          <div>✅ See & download their membership card</div>
          <div>✅ Check loyalty points & store credit</div>
          <div>✅ Browse available menu / stock</div>
          <div>✅ Upload a profile photo</div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          <span className="text-blue-400 font-medium">Registration:</span> New members fill out a quick form — no login required.<br />
          <span className="text-green-400 font-medium">Portal login:</span> Existing members sign in with their <span className="font-medium">ID number + phone number</span>.
        </p>
      </div>
    </div>
  );
}
