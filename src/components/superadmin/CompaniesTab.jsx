import { useState } from "react";
import { supabase } from '@/api/supabaseClient';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle, PauseCircle, PlayCircle, DollarSign, ExternalLink, Search, Trash2, TrendingUp, Package, CreditCard, AlertTriangle } from "lucide-react";

const STATUS_STYLES = {
  active:           "bg-green-500/10 text-green-400 border-green-500/20",
  trial:            "bg-blue-500/10 text-blue-400 border-blue-500/20",
  paused:           "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  pending_approval: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  pending_payment:  "bg-blue-500/10 text-blue-400 border-blue-500/20",
  inactive:         "bg-muted text-muted-foreground border-border",
  expired:          "bg-red-500/10 text-red-400 border-red-500/20",
};

const PLAN_PRICES = {
  starter: 499,
  growth:  999,
  onceoff: 20000,
};

const PLAN_LABELS = {
  starter: { label: "Starter", color: "text-blue-400",    bg: "bg-blue-500/10"   },
  growth:  { label: "Growth",  color: "text-primary",     bg: "bg-primary/10"    },
  onceoff: { label: "Lifetime",color: "text-amber-400",   bg: "bg-amber-500/10"  },
};

const nextMonthStr = () => {
  var d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

const isPast = (dateStr) => dateStr && new Date(dateStr) < new Date();

const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
};

/*
 * ─── PROTECTED COLUMN WRITES ────────────────────────────────────────────
 * subscription_status, subscription_approved, status, package, monthly_fee,
 * last_payment_date, next_payment_due, admin_notes, suspended_at,
 * grace_period_ends_at etc. are no longer writable by the `authenticated`
 * role. They go through admin_patch_company(), which is SECURITY DEFINER
 * and re-checks that the caller is superadmin.
 *
 * This replaces the previous entities.Company.update() calls, which issued
 * a plain table UPDATE and now fail with "permission denied for table".
 */
async function adminPatchCompany(companyId, patch) {
  var res = await supabase.rpc('admin_patch_company', {
    p_company_id: companyId,
    p_patch: patch,
  });
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export default function CompaniesTab({ companies, onRefresh }) {
  var [search, setSearch] = useState("");
  var [statusFilter, setStatusFilter] = useState("all");
  var [selected, setSelected] = useState(null);
  var [notes, setNotes] = useState("");
  var [saving, setSaving] = useState(false);
  var [deleteTarget, setDeleteTarget] = useState(null);
  var [deleting, setDeleting] = useState(false);
  var [confirmText, setConfirmText] = useState("");

  var filtered = companies.filter(function(c) {
    var matchSearch = (c.company_name + " " + c.email + " " + c.city).toLowerCase().includes(search.toLowerCase());
    var matchStatus = statusFilter === "all" || c.subscription_status === statusFilter || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Summary stats
  var activeCount   = companies.filter(function(c) { return c.subscription_status === "active" || c.status === "active"; }).length;
  var trialCount    = companies.filter(function(c) { return c.subscription_status === "trial" || c.status === "trial"; }).length;
  var overdueCount  = companies.filter(function(c) { return isPast(c.next_payment_due) && (c.subscription_status === "active"); }).length;

  var totalMRR = companies
    .filter(function(c) { return c.subscription_status === "active" || c.status === "active"; })
    .reduce(function(sum, c) {
      var plan = (c.subscription_plan || c.package || "").toLowerCase();
      return sum + (PLAN_PRICES[plan] || 0);
    }, 0);

  var update = async function(id, data, msg) {
    setSaving(true);
    try {
      await adminPatchCompany(id, data);
      toast.success(msg);
      onRefresh();
      setSelected(null);
    } catch (err) {
      toast.error("Update failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  var markPayment = function(c) {
    return update(c.id, {
      last_payment_date: new Date().toISOString().slice(0, 10),
      next_payment_due: nextMonthStr(),
      subscription_status: "active",
    }, "Payment marked as collected");
  };

  var approve = function(c) {
    return update(c.id, { subscription_status: "active", subscription_approved: true }, "Company approved");
  };

  var pause = function(c) {
    return update(c.id, { subscription_status: "paused" }, "Subscription paused");
  };

  var resume = function(c) {
    return update(c.id, { subscription_status: "active" }, "Subscription resumed");
  };

  var saveNotes = function(c) {
    return update(c.id, { admin_notes: notes }, "Notes saved");
  };

  var handleDelete = async function() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      var { error } = await supabase.rpc('delete_company_and_data', { p_company_id: deleteTarget.id });
      if (error) throw error;
      toast.success('"' + deleteTarget.company_name + '" and all related data deleted');
      setDeleteTarget(null);
      setConfirmText("");
      onRefresh();
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error('Delete failed: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  var openInApp = function(c) {
    localStorage.setItem("sa_override_company", c.id);
    window.open("/", "_blank");
  };

  return (
    <div className="space-y-4">

      {/* Summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/10"><TrendingUp className="w-4 h-4 text-green-400" /></div>
          <div>
            <p className="text-xs text-muted-foreground">MRR</p>
            <p className="text-lg font-bold text-green-400">R{totalMRR.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10"><Package className="w-4 h-4 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="text-lg font-bold">{activeCount}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10"><CreditCard className="w-4 h-4 text-blue-400" /></div>
          <div>
            <p className="text-xs text-muted-foreground">On Trial</p>
            <p className="text-lg font-bold">{trialCount}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
          <div className={"p-2 rounded-lg " + (overdueCount > 0 ? "bg-red-500/10" : "bg-muted")}><AlertTriangle className={"w-4 h-4 " + (overdueCount > 0 ? "text-red-400" : "text-muted-foreground")} /></div>
          <div>
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className={"text-lg font-bold " + (overdueCount > 0 ? "text-red-400" : "")}>{overdueCount}</p>
          </div>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search companies..." value={search} onChange={function(e) { setSearch(e.target.value); }} className="pl-10" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {["all","active","trial","paused","pending_approval","pending_payment"].map(function(s) {
            return (
              <button key={s} onClick={function() { setStatusFilter(s); }}
                className={"px-3 py-1.5 rounded-lg text-xs font-medium transition-all " +
                  (statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                {s === "all" ? "All (" + companies.length + ")" :
                 s === "pending_approval" ? "Pending" :
                 s === "pending_payment" ? "Awaiting Payment" :
                 s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Company</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Plan</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Last Payment</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Next Due</th>
              <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(function(c) {
              var plan = (c.subscription_plan || c.package || "").toLowerCase();
              var planInfo = PLAN_LABELS[plan] || null;
              var planPrice = PLAN_PRICES[plan] || null;
              var days = daysUntil(c.next_payment_due);
              var overdue = isPast(c.next_payment_due) && (c.subscription_status === "active");
              var dueSoon = days !== null && days >= 0 && days <= 7;

              return (
                <tr key={c.id} className={"border-b border-border/50 hover:bg-muted/20 transition-colors " + (overdue ? "bg-red-500/5" : "")}>
                  <td className="p-3">
                    <p className="font-medium">{c.company_name}</p>
                    <p className="text-xs text-muted-foreground">{c.email || c.city || "—"}</p>
                  </td>
                  <td className="p-3 hidden md:table-cell">
                    {planInfo ? (
                      <div className="flex flex-col gap-0.5">
                        <span className={"text-xs font-semibold px-2 py-0.5 rounded-full w-fit " + planInfo.bg + " " + planInfo.color}>
                          {planInfo.label}
                        </span>
                        {planPrice && (
                          <span className="text-xs text-muted-foreground">
                            R{planPrice.toLocaleString()}{plan === "onceoff" ? " once" : "/mo"}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground capitalize">{c.subscription_plan || "—"}</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={"text-xs px-2 py-1 rounded-full border font-medium capitalize " + (STATUS_STYLES[c.subscription_status] || STATUS_STYLES[c.status] || STATUS_STYLES.inactive)}>
                      {(c.subscription_status || c.status || "inactive").replace("_", " ")}
                    </span>
                  </td>
                  <td className="p-3 hidden lg:table-cell">
                    {c.last_payment_date ? (
                      <div>
                        <p className="text-sm text-green-400 font-medium">{c.last_payment_date}</p>
                        {planPrice && plan !== "onceoff" && (
                          <p className="text-xs text-muted-foreground">R{planPrice.toLocaleString()}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3 hidden lg:table-cell">
                    {c.next_payment_due ? (
                      <div>
                        <p className={"text-sm font-medium " + (overdue ? "text-red-400" : dueSoon ? "text-amber-400" : "text-muted-foreground")}>
                          {c.next_payment_due}
                        </p>
                        {overdue && <p className="text-xs text-red-400">Overdue {Math.abs(days)}d</p>}
                        {dueSoon && !overdue && <p className="text-xs text-amber-400">Due in {days}d</p>}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      {(c.subscription_status === "pending_approval" || c.status === "pending_approval") && (
                        <Button size="sm" variant="outline" disabled={saving} onClick={function() { approve(c); }} className="gap-1 h-7 text-xs text-green-400 border-green-500/30 hover:bg-green-500/10">
                          <CheckCircle className="w-3 h-3" /> Approve
                        </Button>
                      )}
                      {(c.subscription_status === "paused" || c.status === "paused") ? (
                        <Button size="sm" variant="outline" disabled={saving} onClick={function() { resume(c); }} className="gap-1 h-7 text-xs text-green-400 border-green-500/30 hover:bg-green-500/10">
                          <PlayCircle className="w-3 h-3" /> Resume
                        </Button>
                      ) : (c.subscription_status === "active" || c.status === "active") ? (
                        <Button size="sm" variant="outline" disabled={saving} onClick={function() { pause(c); }} className="gap-1 h-7 text-xs text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10">
                          <PauseCircle className="w-3 h-3" /> Pause
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" disabled={saving} onClick={function() { markPayment(c); }} className={"gap-1 h-7 text-xs " + (overdue ? "text-red-400 border-red-500/30 hover:bg-red-500/10" : "")} title="Mark payment collected">
                        <DollarSign className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={function() { setSelected(c); setNotes(c.admin_notes || ""); }} className="h-7 text-xs">
                        Notes
                      </Button>
                      <Button size="sm" variant="outline" onClick={function() { openInApp(c); }} className="h-7 text-xs gap-1" title="View as this company">
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={function() { setDeleteTarget(c); setConfirmText(""); }}
                        className="h-7 text-xs gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10" title="Delete company">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">No companies found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Notes Dialog */}
      <Dialog open={!!selected} onOpenChange={function() { setSelected(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Admin Notes — {selected && selected.company_name}</DialogTitle></DialogHeader>
          <textarea
            className="w-full h-28 rounded-lg border border-input bg-transparent p-3 text-sm resize-none"
            placeholder="Internal notes about this company..."
            value={notes}
            onChange={function(e) { setNotes(e.target.value); }}
          />
          <Button onClick={function() { saveNotes(selected); }} disabled={saving} className="w-full">Save Notes</Button>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={function() { setDeleteTarget(null); setConfirmText(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> Delete Company
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-4 text-sm">
              <p className="text-red-300 font-medium mb-2">This will permanently delete:</p>
              <ul className="text-red-300/80 space-y-1 text-xs list-disc list-inside">
                <li><strong>{deleteTarget && deleteTarget.company_name}</strong> and all company data</li>
                <li>All subscriptions, stores, members, products, orders</li>
                <li>All user accounts linked to this company</li>
              </ul>
              <p className="text-red-400 font-semibold mt-3">This cannot be undone.</p>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1.5">
                Type <strong className="text-white">DELETE</strong> to confirm
              </label>
              <Input value={confirmText} onChange={function(e) { setConfirmText(e.target.value); }} placeholder="DELETE" className="border-red-800/40 focus:border-red-500" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={function() { setDeleteTarget(null); setConfirmText(""); }}>Cancel</Button>
              <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" disabled={confirmText !== "DELETE" || deleting} onClick={handleDelete}>
                {deleting ? "Deleting..." : "Delete Forever"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
