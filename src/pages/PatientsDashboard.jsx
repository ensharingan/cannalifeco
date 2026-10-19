import { useState, useEffect, useCallback } from "react";
import { supabase } from '@/api/supabaseClient';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Search, Eye, Users, Clock, CheckCircle2, XCircle, Trash2, Edit } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompany } from "../lib/CompanyContext";

const statusColors = {
  Pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  Submitted: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Approved: "bg-green-500/10 text-green-400 border-green-500/20",
  Rejected: "bg-red-500/10 text-red-400 border-red-500/20",
};

export default function PatientsDashboard() {
  const { companyId } = useCompany();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState(null);
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setPatients(data || []);
    } catch (err) {
      toast.error('Failed to load patients');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = patients.filter(p => {
    const name = `${p.first_name} ${p.surname} ${p.email} ${p.patient_id} ${p.diagnosis || ""}`.toLowerCase();
    if (search && !name.includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && p.application_status !== statusFilter) return false;
    if (dateFrom && new Date(p.created_at) < new Date(dateFrom)) return false;
    if (dateTo && new Date(p.created_at) > new Date(dateTo)) return false;
    return true;
  });

  const counts = {
    total: patients.length,
    pending: patients.filter(p => p.application_status === "Pending" || p.application_status === "Submitted").length,
    approved: patients.filter(p => p.application_status === "Approved").length,
    rejected: patients.filter(p => p.application_status === "Rejected").length,
  };

  const openDetail = (p) => {
    setSelected(p);
    setEditNotes(p.notes || "");
    setEditStatus(p.application_status || "Pending");
    setEditMode(false);
    setEditForm({
      first_name: p.first_name || "",
      surname: p.surname || "",
      email: p.email || "",
      phone_number: p.phone_number || "",
      diagnosis: p.diagnosis || "",
      current_treatment: p.current_treatment || "",
    });
  };

  const saveChanges = async () => {
    setSaving(true);
    try {
      const updateData = { notes: editNotes, application_status: editStatus };
      if (editMode) {
        Object.assign(updateData, editForm);
      }
      const { error } = await supabase
        .from('patients')
        .update(updateData)
        .eq('id', selected.id);
      if (error) throw error;
      toast.success("Patient record updated");
      setSelected(null);
      setEditMode(false);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to update patient');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (patient) => {
    if (!confirm(`Delete patient ${patient.patient_id} (${patient.first_name} ${patient.surname})? This cannot be undone.`)) return;
    try {
      const { error } = await supabase
        .from('patients')
        .delete()
        .eq('id', patient.id);
      if (error) throw error;
      toast.success(`Patient ${patient.patient_id} deleted`);
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to delete patient');
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Section 21 Patients</h1>
        <p className="text-sm text-muted-foreground">{patients.length} total applications</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total", value: counts.total, icon: Users, color: "text-blue-400" },
          { label: "Pending / Submitted", value: counts.pending, icon: Clock, color: "text-yellow-400" },
          { label: "Approved", value: counts.approved, icon: CheckCircle2, color: "text-green-400" },
          { label: "Rejected", value: counts.rejected, icon: XCircle, color: "text-red-400" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <s.icon className={cn("w-8 h-8", s.color)} />
            <div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search name, email, patient ID, diagnosis..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {["Pending","Submitted","Approved","Rejected"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" placeholder="From" />
        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" placeholder="To" />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Patient ID</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Full Name</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Email</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Phone</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Date Submitted</th>
                <th className="p-3 text-right text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="p-3 font-mono text-xs text-primary font-semibold">{p.patient_id || "—"}</td>
                  <td className="p-3 text-sm font-medium">{p.title} {p.first_name} {p.surname}</td>
                  <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">{p.email}</td>
                  <td className="p-3 text-sm text-muted-foreground hidden lg:table-cell">{p.phone_number}</td>
                  <td className="p-3">
                    <span className={cn("text-xs px-2 py-1 rounded-full border font-medium", statusColors[p.application_status] || statusColors.Pending)}>
                      {p.application_status || "Pending"}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground hidden md:table-cell">
                    {new Date(p.submission_timestamp || p.created_at).toLocaleString('en-ZA')}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openDetail(p)} className="p-1 text-muted-foreground hover:text-foreground" title="View">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(p)} className="p-1 text-muted-foreground hover:text-red-500" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && <p className="text-sm text-muted-foreground text-center py-12">No patients found</p>}
      </div>

      {/* Detail / Edit modal */}
      <Dialog open={!!selected} onOpenChange={() => { setSelected(null); setEditMode(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Patient: {selected?.patient_id}</DialogTitle>
              {selected && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => setEditMode(!editMode)}
                  >
                    <Edit className="w-3 h-3" />
                    {editMode ? "Cancel Edit" : "Edit Details"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    onClick={() => handleDelete(selected)}
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          {selected && (
            <div className="space-y-6">
              {editMode ? (
                <div className="space-y-3 bg-muted/30 rounded-lg p-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Edit Patient Details</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">First Name</Label>
                      <Input value={editForm.first_name} onChange={e => setEditForm(f => ({ ...f, first_name: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Surname</Label>
                      <Input value={editForm.surname} onChange={e => setEditForm(f => ({ ...f, surname: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input value={editForm.phone_number} onChange={e => setEditForm(f => ({ ...f, phone_number: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Diagnosis</Label>
                    <Textarea rows={2} value={editForm.diagnosis} onChange={e => setEditForm(f => ({ ...f, diagnosis: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Current Treatment</Label>
                    <Textarea rows={2} value={editForm.current_treatment} onChange={e => setEditForm(f => ({ ...f, current_treatment: e.target.value }))} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Detail label="Full Name" value={`${selected.title || ""} ${selected.first_name} ${selected.surname}`} />
                    <Detail label="ID Number" value={selected.id_number} />
                    <Detail label="Email" value={selected.email} />
                    <Detail label="Phone" value={selected.phone_number} />
                    <Detail label="Age" value={selected.age} />
                    <Detail label="Gender" value={selected.gender} />
                    <Detail label="Weight" value={selected.weight ? `${selected.weight} kg` : "—"} />
                    <Detail label="Height" value={selected.height ? `${selected.height} cm` : "—"} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Diagnosis</p>
                    <p className="text-sm bg-muted rounded-lg p-3">{selected.diagnosis}</p>
                  </div>
                  {selected.current_treatment && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Current Treatment</p>
                      <p className="text-sm bg-muted rounded-lg p-3">{selected.current_treatment}</p>
                    </div>
                  )}
                  {selected.digital_signature_url && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Signature</p>
                      <img src={selected.digital_signature_url} alt="Signature" className="border border-border rounded-lg bg-white p-2 max-h-24" />
                    </div>
                  )}
                  {selected.id_upload_url && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">ID Document</p>
                      <a href={selected.id_upload_url} target="_blank" rel="noreferrer" className="text-primary text-sm underline">View Document</a>
                    </div>
                  )}
                </>
              )}

              {/* Admin actions — always visible */}
              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-sm font-semibold">Admin Actions</p>
                <div>
                  <Label>Status</Label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Pending","Submitted","Approved","Rejected"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea rows={3} value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Add notes about this patient..." />
                </div>
                <Button onClick={saveChanges} disabled={saving} className="w-full">
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value || "—"}</p>
    </div>
  );
}
