import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Phone,
  Mail,
  Calendar,
  Clock,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Check,
  Building2,
  Package,
  Eye,
} from "lucide-react";

const STAGES = [
  {
    key: "trial",
    label: "Trial",
    color: "bg-cyan-500/10 border-cyan-500/30 text-cyan-400",
    dot: "bg-cyan-400",
  },
  {
    key: "new",
    label: "New",
    color: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    dot: "bg-blue-400",
  },
  {
    key: "contacted",
    label: "Contacted",
    color: "bg-purple-500/10 border-purple-500/30 text-purple-400",
    dot: "bg-purple-400",
  },
  {
    key: "demo_scheduled",
    label: "Demo Scheduled",
    color: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
    dot: "bg-yellow-400",
  },
  {
    key: "proposal_sent",
    label: "Proposal Sent",
    color: "bg-orange-500/10 border-orange-500/30 text-orange-400",
    dot: "bg-orange-400",
  },
  {
    key: "negotiation",
    label: "Negotiation",
    color: "bg-pink-500/10 border-pink-500/30 text-pink-400",
    dot: "bg-pink-400",
  },
  {
    key: "won",
    label: "Won",
    color: "bg-green-500/10 border-green-500/30 text-green-400",
    dot: "bg-green-400",
  },
  {
    key: "lost",
    label: "Lost",
    color: "bg-muted border-border text-muted-foreground",
    dot: "bg-gray-400",
  },
];

const EMPTY = {
  company_name: "",
  contact_name: "",
  name: "",
  email: "",
  phone: "",
  source: "website",
  stage: "new",
  plan_interest: "starter",
  notes: "",
  next_follow_up: "",
  estimated_value: "",
  reseller_id: null,
};

function getTrialDays(trialEndsAt) {
  if (!trialEndsAt) return null;
  const now = new Date();
  const end = new Date(trialEndsAt);
  const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  return diff;
}

function TrialBadge({ trialEndsAt }) {
  const days = getTrialDays(trialEndsAt);
  if (days === null) return null;

  let cls = "text-xs font-bold px-2 py-0.5 rounded-full ";
  if (days <= 0) cls += "bg-red-500/20 text-red-400 animate-pulse";
  else if (days <= 3) cls += "bg-red-500/20 text-red-400";
  else if (days <= 7) cls += "bg-amber-500/20 text-amber-400";
  else cls += "bg-cyan-500/20 text-cyan-400";

  return (
    <span className={cls}>
      {days <= 0 ? "Expired" : `${days}d left`}
    </span>
  );
}

function ResellerCombobox({ value, onChange, resellers }) {
  const [open, setOpen] = useState(false);
  const selected = resellers.find((r) => r.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full h-9 justify-between font-normal text-sm"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.full_name : "No reseller (direct)"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search resellers..." />
          <CommandList>
            <CommandEmpty>No reseller found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__direct__"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check className={cn("h-4 w-4", value ? "opacity-0" : "opacity-100")} />
                No reseller (direct)
              </CommandItem>
              {resellers.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.full_name}
                  onSelect={() => {
                    onChange(r.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === r.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{r.full_name}</span>
                  {r.status && r.status !== "approved" && (
                    <span className="ml-auto text-[10px] text-muted-foreground capitalize">
                      {r.status}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LeadCard({ lead, onEdit, onDelete, onStageChange, onView }) {
  const isTrial = lead.stage === "trial";

  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-2 hover:border-primary/30 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">
            {lead.company_name || lead.name || "Unknown"}
          </p>
          {lead.contact_name && lead.contact_name !== lead.company_name && (
            <p className="text-xs text-muted-foreground truncate">
              {lead.contact_name}
            </p>
          )}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onView && (
            <button
              onClick={() => onView(lead)}
              className="p-1 rounded hover:bg-muted transition-colors"
            >
              <Eye className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={() => onEdit(lead)}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </button>
          <button
            onClick={() => onDelete(lead.id)}
            className="p-1 rounded hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3 h-3 text-red-400" />
          </button>
        </div>
      </div>

      {/* Trial days badge */}
      {isTrial && lead.trial_ends_at && (
        <TrialBadge trialEndsAt={lead.trial_ends_at} />
      )}

      {/* Reseller attribution */}
      {lead.resellers?.full_name && (
        <p className="text-xs text-emerald-400 truncate">
          via {lead.resellers.full_name}
        </p>
      )}

      {/* Package / plan */}
      {lead.plan_interest && (
        <div className="flex items-center gap-1">
          <Package className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground capitalize">
            {lead.plan_interest}
          </span>
        </div>
      )}

      {/* Subscription status for trial leads */}
      {isTrial && lead.subscription_status && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
          {lead.subscription_status.replace("_", " ")}
        </span>
      )}

      {lead.estimated_value > 0 && (
        <p className="text-xs font-medium text-primary">
          R{Number(lead.estimated_value).toLocaleString()}/mo
        </p>
      )}

      <div className="flex flex-wrap gap-1 items-center">
        {lead.email && (
          <a
            href={`mailto:${lead.email}`}
            className="p-1 rounded hover:bg-muted transition-colors"
            title={lead.email}
          >
            <Mail className="w-3 h-3 text-muted-foreground" />
          </a>
        )}
        {(lead.phone || lead.owner_phone) && (
          <a
            href={`tel:${lead.owner_phone || lead.phone}`}
            className="p-1 rounded hover:bg-muted transition-colors"
            title={lead.owner_phone || lead.phone}
          >
            <Phone className="w-3 h-3 text-muted-foreground" />
          </a>
        )}
        {lead.next_follow_up && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="w-3 h-3" />
            {new Date(lead.next_follow_up).toLocaleDateString("en-ZA", {
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
      </div>

      <select
        value={lead.stage}
        onChange={(e) => onStageChange(lead.id, e.target.value)}
        className="w-full text-xs bg-muted border border-border rounded px-2 py-1"
      >
        {STAGES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function CRMTab() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [viewLead, setViewLead] = useState(null);
  const [filterStage, setFilterStage] = useState("all");
  const [filterReseller, setFilterReseller] = useState("all");
  const [allResellers, setAllResellers] = useState([]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("leads")
        .select("*, resellers(full_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setLeads(data || []);
    } catch (err) {
      console.error("Failed to load leads:", err);
      toast.error("Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("resellers")
        .select("id, full_name, status")
        .order("full_name", { ascending: true });
      if (error) {
        console.error("Failed to load resellers:", error);
        return;
      }
      setAllResellers(data || []);
    })();
  }, []);

  const save = async () => {
    if (!form.company_name.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSaving(true);
    try {
      const data = {
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim() || null,
        name: form.contact_name.trim() || form.company_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        source: form.source,
        stage: form.stage,
        plan_interest: form.plan_interest || null,
        notes: form.notes.trim() || null,
        next_follow_up: form.next_follow_up || null,
        estimated_value: form.estimated_value
          ? Number(form.estimated_value)
          : 0,
        reseller_id: form.reseller_id || null,
        updated_at: new Date().toISOString(),
      };

      if (editing) {
        const { error } = await supabase
          .from("leads")
          .update(data)
          .eq("id", editing);
        if (error) throw error;
        toast.success("Lead updated");
      } else {
        const { error } = await supabase.from("leads").insert(data);
        if (error) throw error;
        toast.success("Lead added");
      }

      setShowForm(false);
      setForm(EMPTY);
      setEditing(null);
      fetchLeads();
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Failed to save lead");
    } finally {
      setSaving(false);
    }
  };

  const deleteLead = async (id) => {
    if (!window.confirm("Delete this lead?")) return;
    try {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
      toast.success("Lead removed");
      fetchLeads();
    } catch (err) {
      toast.error("Failed to delete");
    }
  };

  const changeStage = async (id, stage) => {
    try {
      const { error } = await supabase
        .from("leads")
        .update({ stage, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, stage } : l))
      );
    } catch (err) {
      toast.error("Failed to update stage");
    }
  };

  const openEdit = (lead) => {
    setForm({
      company_name: lead.company_name || "",
      contact_name: lead.contact_name || lead.name || "",
      name: lead.name || "",
      email: lead.email || "",
      phone: lead.owner_phone || lead.phone || "",
      source: lead.source || "website",
      stage: lead.stage || "new",
      plan_interest: lead.plan_interest || "starter",
      notes: lead.notes || "",
      next_follow_up: lead.next_follow_up || "",
      estimated_value: lead.estimated_value || "",
      reseller_id: lead.reseller_id || null,
    });
    setEditing(lead.id);
    setShowForm(true);
  };

  // Partners with at least one lead on this board, for the filter dropdown
  const partners = Object.values(
    leads.reduce((acc, l) => {
      if (l.reseller_id && l.resellers?.full_name) {
        acc[l.reseller_id] = { id: l.reseller_id, name: l.resellers.full_name };
      }
      return acc;
    }, {})
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Filter leads
  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      (l.company_name || "").toLowerCase().includes(q) ||
      (l.name || "").toLowerCase().includes(q) ||
      (l.email || "").toLowerCase().includes(q) ||
      (l.phone || "").toLowerCase().includes(q);
    const matchStage = filterStage === "all" || l.stage === filterStage;
    const matchReseller =
      filterReseller === "all" ||
      (filterReseller === "direct" ? !l.reseller_id : l.reseller_id === filterReseller);
    return matchSearch && matchStage && matchReseller;
  });

  // Stats
  const trialLeads = leads.filter((l) => l.stage === "trial");
  const expiringCount = trialLeads.filter((l) => {
    const d = getTrialDays(l.trial_ends_at);
    return d !== null && d <= 3 && d > 0;
  }).length;
  const expiredCount = trialLeads.filter((l) => {
    const d = getTrialDays(l.trial_ends_at);
    return d !== null && d <= 0;
  }).length;

  return (
    <div className="space-y-4">
      {/* Trial alerts banner */}
      {(expiringCount > 0 || expiredCount > 0) && (
        <div className="flex flex-wrap gap-3">
          {expiredCount > 0 && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-semibold">{expiredCount}</span> trial(s)
              expired
            </div>
          )}
          {expiringCount > 0 && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-sm text-amber-400">
              <Clock className="w-4 h-4" />
              <span className="font-semibold">{expiringCount}</span> trial(s)
              expiring within 3 days
            </div>
          )}
        </div>
      )}

      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className="pl-9"
            />
          </div>
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="all">All Stages</option>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {partners.length > 0 && (
            <select
              value={filterReseller}
              onChange={(e) => setFilterReseller(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="all">Everyone</option>
              <option value="direct">Direct (no partner)</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLeads}
            disabled={loading}
          >
            <RefreshCw
              className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setForm(EMPTY);
              setEditing(null);
              setShowForm(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> Add Lead
          </Button>
        </div>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading pipeline...
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 min-w-[1200px]">
            {STAGES.map((stage) => {
              const stageLeads = filtered.filter(
                (l) => l.stage === stage.key
              );
              // Sort trial leads: expired first, then by days remaining
              const sorted =
                stage.key === "trial"
                  ? [...stageLeads].sort((a, b) => {
                      const da = getTrialDays(a.trial_ends_at) ?? 999;
                      const db = getTrialDays(b.trial_ends_at) ?? 999;
                      return da - db;
                    })
                  : stageLeads;

              return (
                <div key={stage.key} className="min-w-[180px]">
                  <div
                    className={`flex items-center justify-between px-2 py-1.5 rounded-lg border mb-2 ${stage.color}`}
                  >
                    <span className="text-xs font-semibold">{stage.label}</span>
                    <span className="text-xs font-bold">
                      {stageLeads.length}
                    </span>
                  </div>
                  <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                    {sorted.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onEdit={openEdit}
                        onDelete={deleteLead}
                        onStageChange={changeStage}
                        onView={setViewLead}
                      />
                    ))}
                    {stageLeads.length === 0 && (
                      <div className="border border-dashed border-border rounded-lg p-3 text-center text-xs text-muted-foreground">
                        Empty
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Lead" : "New Lead"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              { field: "company_name", label: "Company Name *", colSpan: 2 },
              { field: "contact_name", label: "Contact Person" },
              { field: "phone", label: "Phone" },
              { field: "email", label: "Email", colSpan: 2 },
              {
                field: "next_follow_up",
                label: "Follow-up Date",
                type: "date",
              },
              {
                field: "estimated_value",
                label: "Est. Monthly Value (R)",
                type: "number",
              },
            ].map(({ field, label, colSpan, type }) => (
              <div key={field} className={colSpan === 2 ? "col-span-2" : ""}>
                <Label className="text-xs">{label}</Label>
                <Input
                  type={type || "text"}
                  value={form[field]}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [field]: e.target.value }))
                  }
                />
              </div>
            ))}
            <div>
              <Label className="text-xs">Stage</Label>
              <select
                value={form.stage}
                onChange={(e) =>
                  setForm((f) => ({ ...f, stage: e.target.value }))
                }
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Plan Interest</Label>
              <select
                value={form.plan_interest}
                onChange={(e) =>
                  setForm((f) => ({ ...f, plan_interest: e.target.value }))
                }
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {["starter", "growth", "lifetime"].map((p) => (
                  <option key={p} value={p} className="capitalize">
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Source</Label>
              <select
                value={form.source}
                onChange={(e) =>
                  setForm((f) => ({ ...f, source: e.target.value }))
                }
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {[
                  "referral",
                  "website",
                  "social_media",
                  "cold_outreach",
                  "event",
                  "signup",
                  "reseller",
                  "other",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Reseller / Partner</Label>
              <ResellerCombobox
                value={form.reseller_id}
                onChange={(id) => setForm((f) => ({ ...f, reseller_id: id }))}
                resellers={allResellers}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Notes</Label>
              <textarea
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                className="w-full h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>
          <Button
            onClick={save}
            disabled={saving || !form.company_name.trim()}
            className="w-full"
          >
            {saving ? "Saving..." : editing ? "Update Lead" : "Add Lead"}
          </Button>
        </DialogContent>
      </Dialog>

      {/* View Lead Detail Dialog */}
      <Dialog open={!!viewLead} onOpenChange={() => setViewLead(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {viewLead?.company_name || viewLead?.name || "Lead Details"}
            </DialogTitle>
          </DialogHeader>
          {viewLead && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Contact</p>
                  <p>{viewLead.contact_name || viewLead.name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Stage</p>
                  <p className="capitalize">{viewLead.stage}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p>
                    {viewLead.email ? (
                      <a
                        href={`mailto:${viewLead.email}`}
                        className="text-primary hover:underline"
                      >
                        {viewLead.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p>
                    {viewLead.owner_phone || viewLead.phone ? (
                      <a
                        href={`tel:${viewLead.owner_phone || viewLead.phone}`}
                        className="text-primary hover:underline"
                      >
                        {viewLead.owner_phone || viewLead.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Plan</p>
                  <p className="capitalize">
                    {viewLead.plan_interest || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Source</p>
                  <p className="capitalize">
                    {(viewLead.source || "—").replace("_", " ")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Reseller</p>
                  <p>{viewLead.resellers?.full_name || "Direct"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Est. Monthly Value
                  </p>
                  <p>
                    {viewLead.estimated_value
                      ? `R${Number(viewLead.estimated_value).toLocaleString()}`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Follow-up</p>
                  <p>
                    {viewLead.next_follow_up
                      ? new Date(viewLead.next_follow_up).toLocaleDateString(
                          "en-ZA"
                        )
                      : "—"}
                  </p>
                </div>
                {viewLead.stage === "trial" && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Trial Ends
                      </p>
                      <p>
                        {viewLead.trial_ends_at
                          ? new Date(
                              viewLead.trial_ends_at
                            ).toLocaleDateString("en-ZA")
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Days Remaining
                      </p>
                      <TrialBadge trialEndsAt={viewLead.trial_ends_at} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Subscription Status
                      </p>
                      <p className="capitalize">
                        {(viewLead.subscription_status || "—").replace(
                          "_",
                          " "
                        )}
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p>
                    {new Date(viewLead.created_at).toLocaleDateString("en-ZA")}
                  </p>
                </div>
              </div>
              {viewLead.notes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm bg-muted rounded-lg p-3 whitespace-pre-wrap">
                    {viewLead.notes}
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    openEdit(viewLead);
                    setViewLead(null);
                  }}
                >
                  <Pencil className="w-4 h-4 mr-1" /> Edit
                </Button>
                {(viewLead.owner_phone || viewLead.phone) && (
                  <Button variant="outline" className="flex-1" asChild>
                    <a
                      href={`https://wa.me/${(viewLead.owner_phone || viewLead.phone).replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Phone className="w-4 h-4 mr-1" /> WhatsApp
                    </a>
                  </Button>
                )}
                {viewLead.email && (
                  <Button variant="outline" className="flex-1" asChild>
                    <a href={`mailto:${viewLead.email}`}>
                      <Mail className="w-4 h-4 mr-1" /> Email
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
