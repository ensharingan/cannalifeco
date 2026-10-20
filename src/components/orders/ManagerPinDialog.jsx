import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck } from "lucide-react";

const APPROVER_ROLES = ["owner", "manager", "superadmin"];

/**
 * Asks for a manager's (or owner's) 4-digit PIN before a sensitive action.
 * onApproved receives { user_id, full_name, role } of the approver.
 */
export default function ManagerPinDialog({ open, onOpenChange, companyId, title, description, onApproved }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (open) { setPin(""); setError(""); } }, [open]);

  const submit = async () => {
    if (!/^[0-9]{4}$/.test(pin)) { setError("Enter the 4-digit manager PIN."); return; }
    setBusy(true);
    setError("");
    try {
      const { data, error: rpcErr } = await supabase.rpc("verify_staff_pin", { p_company_id: companyId, p_pin: pin });
      if (rpcErr) throw rpcErr;
      if (!data || !data.ok) { setError((data && data.error) || "PIN not recognised."); setPin(""); return; }
      if (APPROVER_ROLES.indexOf(data.role) === -1) { setError("That PIN does not belong to a manager."); setPin(""); return; }
      onApproved({ user_id: data.user_id, full_name: data.full_name, role: data.role });
    } catch (e) {
      setError((e && e.message) || "Could not verify PIN.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> {title || "Manager approval"}</DialogTitle>
          <DialogDescription>{description || "A manager must enter their PIN to continue."}</DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={4}
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="••••"
          className="text-center text-2xl tracking-[0.5em] h-12"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" onClick={submit} disabled={busy || pin.length !== 4}>{busy ? "Checking..." : "Approve"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
