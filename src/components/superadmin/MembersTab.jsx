import { useState } from "react";
import { entities } from '@/api/entities';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Search, CheckCircle, XCircle } from "lucide-react";

const STATUS_STYLES = {
  approved: "bg-green-500/10 text-green-400 border-green-500/20",
  pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
};

export default function MembersTab({ members, companies, onRefresh }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const companyMap = Object.fromEntries(companies.map(c => [c.id, c.company_name]));

  const filtered = members.filter(m => {
    const matchSearch = `${m.first_name} ${m.last_name} ${m.email} ${m.membership_id}`.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || m.registration_status === filterStatus;
    return matchSearch && matchStatus;
  });

  const updateStatus = async (id, status) => {
    await entities.Member.update(id, { registration_status: status, is_active: status === "approved" });
    toast.success(`Member ${status}`);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search members..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex gap-2">
          {["all", "pending", "approved", "rejected"].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                filterStatus === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}>{s}</button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Member</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Company</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Type</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
              <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map(m => (
              <tr key={m.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="p-3">
                  <p className="font-medium">{m.first_name} {m.last_name}</p>
                  <p className="text-xs text-muted-foreground">{m.email || m.membership_id || "—"}</p>
                </td>
                <td className="p-3 hidden md:table-cell text-muted-foreground text-xs">{companyMap[m.company_id] || "—"}</td>
                <td className="p-3 hidden sm:table-cell capitalize text-muted-foreground text-xs">{m.membership_type || "—"}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full border font-medium capitalize ${STATUS_STYLES[m.registration_status] || "bg-muted text-muted-foreground border-border"}`}>
                    {m.registration_status || "—"}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex items-center justify-end gap-1">
                    {m.registration_status !== "approved" && (
                      <Button size="sm" variant="outline" onClick={() => updateStatus(m.id, "approved")} className="gap-1 h-7 text-xs text-green-400 border-green-500/30 hover:bg-green-500/10">
                        <CheckCircle className="w-3 h-3" /> Approve
                      </Button>
                    )}
                    {m.registration_status !== "rejected" && (
                      <Button size="sm" variant="outline" onClick={() => updateStatus(m.id, "rejected")} className="gap-1 h-7 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10">
                        <XCircle className="w-3 h-3" /> Reject
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">No members found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}