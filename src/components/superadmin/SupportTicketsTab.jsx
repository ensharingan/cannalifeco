import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, MessageSquare, CheckCircle, Clock, Inbox, X, AlertCircle, Send, Filter } from "lucide-react";

const STATUS_CONFIG = {
  open:        { label: "Open",        color: "bg-blue-500/10 text-blue-400 border-blue-500/20",    icon: Inbox },
  in_progress: { label: "In Progress", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: Clock },
  resolved:    { label: "Resolved",    color: "bg-green-500/10 text-green-400 border-green-500/20", icon: CheckCircle },
  closed:      { label: "Closed",      color: "bg-muted text-muted-foreground border-border",        icon: X },
};

const PRIORITY_CONFIG = {
  low:    { label: "Low",    color: "text-muted-foreground" },
  normal: { label: "Normal", color: "text-blue-400" },
  high:   { label: "High",   color: "text-amber-400" },
  urgent: { label: "🚨 Urgent", color: "text-red-400" },
};

export default function SupportTicketsTab() {
  const [tickets, setTickets] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [response, setResponse] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: ticketData }, { data: companyData }] = await Promise.all([
        supabase.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("companies").select("id, company_name, email"),
      ]);
      setTickets(ticketData || []);
      setCompanies(companyData || []);
    } catch (err) {
      toast.error("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateTicket = async (id, updates) => {
    try {
      const { error } = await supabase.from("support_tickets").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      toast.success("Ticket updated");
      load();
      if (selectedTicket?.id === id) setSelectedTicket(prev => ({ ...prev, ...updates }));
    } catch (err) {
      toast.error(err.message || "Failed to update ticket");
    }
  };

  const sendResponse = async () => {
    if (!response.trim()) { toast.error("Enter a response"); return; }
    setIsSaving(true);
    try {
      const { error } = await supabase.from("support_tickets").update({
        admin_response: response.trim(),
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", selectedTicket.id);
      if (error) throw error;
      toast.success("Response sent and ticket resolved");
      setResponse("");
      setSelectedTicket(null);
      load();
    } catch (err) {
      toast.error(err.message || "Failed to send response");
    } finally {
      setIsSaving(false);
    }
  };

  const getCompanyName = (companyId) => companies.find(c => c.id === companyId)?.company_name || "Unknown";

  const filtered = tickets.filter(t => {
    const matchSearch = !search || t.subject?.toLowerCase().includes(search.toLowerCase()) || getCompanyName(t.company_id).toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || t.status === filterStatus;
    const matchPriority = filterPriority === "all" || t.priority === filterPriority;
    return matchSearch && matchStatus && matchPriority;
  });

  // Stats
  const openCount = tickets.filter(t => t.status === "open").length;
  const urgentCount = tickets.filter(t => t.priority === "urgent" && t.status !== "resolved" && t.status !== "closed").length;
  const inProgressCount = tickets.filter(t => t.status === "in_progress").length;
  const resolvedCount = tickets.filter(t => t.status === "resolved").length;

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Open", value: openCount, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Urgent", value: urgentCount, color: "text-red-400", bg: "bg-red-500/10" },
          { label: "In Progress", value: inProgressCount, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Resolved", value: resolvedCount, color: "text-green-400", bg: "bg-green-500/10" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search tickets or company..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tickets table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide border-b border-border">
            <tr>
              <th className="px-4 py-3 text-left">Company</th>
              <th className="px-4 py-3 text-left">Subject</th>
              <th className="px-4 py-3 text-left hidden sm:table-cell">Category</th>
              <th className="px-4 py-3 text-left">Priority</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left hidden md:table-cell">Date</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(t => {
              const statusCfg = STATUS_CONFIG[t.status] || STATUS_CONFIG.open;
              const StatusIcon = statusCfg.icon;
              const priorityCfg = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.normal;
              return (
                <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{getCompanyName(t.company_id)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium truncate max-w-[180px]">{t.subject}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[180px]">{t.description}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{t.category}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${priorityCfg.color}`}>{priorityCfg.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium ${statusCfg.color}`}>
                      <StatusIcon className="w-3 h-3" />{statusCfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                    {new Date(t.created_at).toLocaleDateString("en-ZA")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { setSelectedTicket(t); setResponse(t.admin_response || ""); }}>
                      {t.status === "open" || t.status === "in_progress" ? "Respond" : "View"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{tickets.length === 0 ? "No support tickets yet" : "No tickets match your filters"}</p>
          </div>
        )}
      </div>

      {/* Ticket detail / respond dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Support Ticket</DialogTitle></DialogHeader>
          {selectedTicket && (() => {
            const statusCfg = STATUS_CONFIG[selectedTicket.status] || STATUS_CONFIG.open;
            const StatusIcon = statusCfg.icon;
            return (
              <div className="space-y-4">
                {/* Meta */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium ${statusCfg.color}`}>
                    <StatusIcon className="w-3 h-3" />{statusCfg.label}
                  </span>
                  <span className="text-xs bg-muted px-2 py-1 rounded-full">{selectedTicket.category}</span>
                  <span className={`text-xs font-medium ${(PRIORITY_CONFIG[selectedTicket.priority] || PRIORITY_CONFIG.normal).color}`}>
                    {(PRIORITY_CONFIG[selectedTicket.priority] || PRIORITY_CONFIG.normal).label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-xs text-muted-foreground">Company</span><p className="font-medium">{getCompanyName(selectedTicket.company_id)}</p></div>
                  <div><span className="text-xs text-muted-foreground">Submitted by</span><p className="font-medium">{selectedTicket.submitter_email || "—"}</p></div>
                  <div><span className="text-xs text-muted-foreground">Date</span><p>{new Date(selectedTicket.created_at).toLocaleDateString("en-ZA")}</p></div>
                  {selectedTicket.resolved_at && <div><span className="text-xs text-muted-foreground">Resolved</span><p>{new Date(selectedTicket.resolved_at).toLocaleDateString("en-ZA")}</p></div>}
                </div>

                <div>
                  <p className="font-semibold">{selectedTicket.subject}</p>
                  <div className="mt-2 bg-muted/30 rounded-lg p-3">
                    <p className="text-sm whitespace-pre-line">{selectedTicket.description}</p>
                  </div>
                </div>

                {/* Status update */}
                <div>
                  <Label>Update Status</Label>
                  <Select value={selectedTicket.status} onValueChange={v => updateTicket(selectedTicket.id, { status: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Response */}
                <div>
                  <Label>{selectedTicket.admin_response ? "Update Response" : "Send Response"}</Label>
                  <Textarea
                    value={response}
                    onChange={e => setResponse(e.target.value)}
                    placeholder="Type your response to the client..."
                    rows={5}
                    className="mt-1"
                  />
                </div>

                <Button onClick={sendResponse} disabled={isSaving || !response.trim()} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700">
                  <Send className="w-4 h-4" />
                  {isSaving ? "Sending..." : "Send Response & Mark Resolved"}
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
