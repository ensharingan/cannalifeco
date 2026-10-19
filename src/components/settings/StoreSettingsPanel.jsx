import { useState, useEffect } from "react";
import { supabase } from '@/api/supabaseClient';
import { useCompany } from "@/lib/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Settings, DollarSign } from "lucide-react";

/**
 * StoreSettingsPanel
 * 
 * Configures per-store settings like membership fee.
 * Drop this into the Settings page or as a tab within it.
 * 
 * Usage: <StoreSettingsPanel storeId={activeStoreId} />
 */
export default function StoreSettingsPanel({ storeId }) {
  const { companyId } = useCompany();
  const [settings, setSettings] = useState({
    membership_fee: 0,
    membership_fee_interval: "yearly",
    auto_add_membership_fee: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!storeId || !companyId) return;
    loadSettings();
  }, [storeId, companyId]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("store_settings")
        .select("*")
        .eq("store_id", storeId)
        .single();

      if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
      if (data) {
        setSettings({
          membership_fee: data.membership_fee || 0,
          membership_fee_interval: data.membership_fee_interval || "yearly",
          auto_add_membership_fee: data.auto_add_membership_fee || false,
        });
      }
    } catch (err) {
      console.error("Error loading store settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!storeId || !companyId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("store_settings")
        .upsert({
          store_id: storeId,
          company_id: companyId,
          membership_fee: settings.membership_fee,
          membership_fee_interval: settings.membership_fee_interval,
          auto_add_membership_fee: settings.auto_add_membership_fee,
          updated_at: new Date().toISOString(),
        }, { onConflict: "store_id" });

      if (error) throw error;
      toast.success("Store settings saved");
    } catch (err) {
      console.error("Error saving settings:", err);
      toast.error("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-6 text-muted-foreground text-sm">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5" />
        <h3 className="font-semibold">Store Settings</h3>
      </div>

      {/* Membership Fee Section */}
      <div className="space-y-4 border border-border rounded-lg p-4">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign className="w-4 h-4" />
          Membership Fee
        </h4>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Fee Amount</Label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={settings.membership_fee}
              onChange={(e) => setSettings((s) => ({ ...s, membership_fee: parseFloat(e.target.value) || 0 }))}
              placeholder="e.g. 4.20"
            />
          </div>
          <div>
            <Label>Fee Interval</Label>
            <Select
              value={settings.membership_fee_interval}
              onValueChange={(v) => setSettings((s) => ({ ...s, membership_fee_interval: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Once-off</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
          <div>
            <p className="text-sm font-medium">Auto-add to checkout</p>
            <p className="text-xs text-muted-foreground">
              Automatically add the membership fee at checkout for new members and expired memberships
            </p>
          </div>
          <Switch
            checked={settings.auto_add_membership_fee}
            onCheckedChange={(v) => setSettings((s) => ({ ...s, auto_add_membership_fee: v }))}
          />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
