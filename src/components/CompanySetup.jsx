import { useState } from "react";
import { supabase } from '@/api/supabaseClient';
import { useCompany } from "../lib/CompanyContext";
import { useAuth } from "@/lib/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Building2 } from "lucide-react";
import { toast } from "sonner";

export default function CompanySetup() {
  const { refresh } = useCompany();
  const { user } = useAuth();
  const [form, setForm] = useState({
    company_name: "",
    phone: "",
    email: "",
    city: "",
    country: "South Africa",
  });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.company_name.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSaving(true);
    try {
      // Create the company
      const { data: newCompany, error: companyError } = await supabase
        .from('companies')
        .insert({
          ...form,
          created_by: user?.id || null,
          status: 'pending_approval',
        })
        .select()
        .single();

      if (companyError) throw companyError;

      // Link the profile to the new company
      if (user?.id && newCompany?.id) {
        await supabase
          .from('profiles')
          .update({ company_id: newCompany.id, role: 'owner' })
          .eq('id', user.id);
      }

      await refresh();
      toast.success("Company created! Welcome to Canna Life Co.");
    } catch (err) {
      console.error('Company setup error:', err);
      toast.error(err.message || "Failed to create company");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-6 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Set Up Your Company</h1>
          <p className="text-sm text-muted-foreground">
            Create your company profile to get started with Canna Life Co.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <Label>Company Name *</Label>
            <Input
              className="mt-1"
              placeholder="e.g. Green Leaf Dispensary"
              value={form.company_name}
              onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>City</Label>
              <Input
                className="mt-1"
                value={form.city}
                onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
              />
            </div>
            <div>
              <Label>Country</Label>
              <Input
                className="mt-1"
                value={form.country}
                onChange={e => setForm(p => ({ ...p, country: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              className="mt-1"
              value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              className="mt-1"
              value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
            />
          </div>
          <Button
            className="w-full"
            onClick={handleCreate}
            disabled={saving || !form.company_name.trim()}
          >
            {saving ? "Creating..." : "Create Company & Get Started"}
          </Button>
        </div>
      </div>
    </div>
  );
}
