import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

// Fast till-side registration for a walk-in who wants to become a member.
// Only the essentials are captured here (name + phone); the full profile
// (ID, FICA, photo, signature) can be completed later on the Members page.
// Creates the same record the Members page does, then hands it back so the
// POS can attach it to the current sale straight away.

function generateMembershipId() {
  return "MEM-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
}

function calculateExpiryDate(startDate, duration, customDays) {
  var d = new Date(startDate);
  switch (duration) {
    case "6_months": d.setMonth(d.getMonth() + 6); break;
    case "1_year": d.setFullYear(d.getFullYear() + 1); break;
    case "2_years": d.setFullYear(d.getFullYear() + 2); break;
    case "lifetime": d.setFullYear(d.getFullYear() + 100); break;
    case "custom": d.setDate(d.getDate() + (customDays || 365)); break;
    default: d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split("T")[0];
}

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

export default function QuickAddMember({ open, onOpenChange, companyId, storeId, storeSettings, initialName, onCreated }) {
  var [firstName, setFirstName] = useState("");
  var [lastName, setLastName] = useState("");
  var [phone, setPhone] = useState("");
  var [email, setEmail] = useState("");
  var [saving, setSaving] = useState(false);

  // Pre-fill from whatever the cashier already typed into the search box.
  useEffect(function () {
    if (!open) return;
    var parts = String(initialName || "").trim().split(/\s+/).filter(Boolean);
    var looksLikeName = parts.length > 0 && !/\d/.test(initialName || "") && String(initialName).indexOf("@") === -1;
    setFirstName(looksLikeName ? parts[0] : "");
    setLastName(looksLikeName ? parts.slice(1).join(" ") : "");
    setPhone(digitsOnly(initialName).length >= 7 ? String(initialName).trim() : "");
    setEmail("");
  }, [open]);

  var canSave = firstName.trim() && lastName.trim() && digitsOnly(phone).length >= 7 && !saving;

  var handleSave = async function () {
    if (!companyId) { toast.error("No company selected"); return; }
    if (!canSave) return;
    setSaving(true);
    try {
      // Block accidental duplicates: same phone number already registered.
      var phoneDigits = digitsOnly(phone);
      var dup = await supabase.from("members").select("id, first_name, last_name, phone")
        .eq("company_id", companyId).not("phone", "is", null).ilike("phone", "%" + phoneDigits.slice(-9) + "%").limit(5);
      var clash = (dup.data || []).find(function (m) { return digitsOnly(m.phone).slice(-9) === phoneDigits.slice(-9); });
      if (clash) {
        toast.error(clash.first_name + " " + clash.last_name + " is already registered with that number. Search for them instead.");
        setSaving(false);
        return;
      }

      var membershipId = generateMembershipId();
      var portalUrl = window.location.origin + "/#/member-portal/" + companyId + "?member=" + membershipId;
      var qrCode = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(portalUrl);
      var duration = storeSettings ? (storeSettings.membership_duration || "1_year") : "1_year";
      var customDays = storeSettings ? (storeSettings.membership_duration_days || 365) : 365;
      var startDate = new Date().toISOString().split("T")[0];

      var res = await supabase.from("members").insert({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        membership_type: "bronze",
        home_store_id: storeId || null,
        membership_start_date: startDate,
        expiry_date: calculateExpiryDate(startDate, duration, customDays),
        company_id: companyId,
        membership_id: membershipId,
        qr_code: qrCode,
        is_active: true,
        is_banned: false,
        registration_status: "approved",
        loyalty_points: 0,
        total_spend: 0,
        visit_count: 0,
        store_credit: 0,
        notes: "Registered at the till (walk-in). Complete ID/FICA on the Members page.",
      }).select().single();
      if (res.error) throw res.error;

      toast.success(res.data.first_name + " registered as a member");
      onOpenChange(false);
      if (onCreated) onCreated(res.data);
    } catch (err) {
      toast.error("Could not register member: " + (err && err.message ? err.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" /> Add Walk-in Member
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First Name *</Label>
              <Input value={firstName} onChange={function (e) { setFirstName(e.target.value); }} placeholder="First name" autoFocus />
            </div>
            <div>
              <Label>Last Name *</Label>
              <Input value={lastName} onChange={function (e) { setLastName(e.target.value); }} placeholder="Last name" />
            </div>
          </div>
          <div>
            <Label>Phone *</Label>
            <Input type="tel" value={phone} onChange={function (e) { setPhone(e.target.value); }} placeholder="e.g. 082 123 4567" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={function (e) { setEmail(e.target.value); }} placeholder="Optional" />
          </div>
          <p className="text-xs text-muted-foreground">
            Quick registration only. ID, FICA and signature can be completed later from Members.
          </p>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={function () { onOpenChange(false); }} disabled={saving}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={!canSave}>
              {saving ? "Saving..." : "Add & Select"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
