import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Shield, CheckCircle, Clock, XCircle, Eye, Download, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export default function POPIASettings() {
  var [requests, setRequests] = useState([]);
  var [loading, setLoading] = useState(true);
  var [selectedRequest, setSelectedRequest] = useState(null);
  var [responseNotes, setResponseNotes] = useState("");
  var [filter, setFilter] = useState("all");

  useEffect(function () {
    loadRequests();
  }, []);

  var loadRequests = async function () {
    setLoading(true);
    try {
      var res = await supabase.from("data_subject_requests").select("*").order("created_at", { ascending: false });
      setRequests(res.data || []);
    } catch (_) {
      toast.error("Failed to load requests");
    } finally {
      setLoading(false);
    }
  };

  var updateStatus = async function (id, newStatus) {
    try {
      var updateData = { status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === "completed" || newStatus === "rejected") {
        updateData.responded_at = new Date().toISOString();
        updateData.response_notes = responseNotes || null;
      }
      var res = await supabase.from("data_subject_requests").update(updateData).eq("id", id);
      if (res.error) throw res.error;
      toast.success("Request updated to " + newStatus);
      setSelectedRequest(null);
      setResponseNotes("");
      loadRequests();
    } catch (err) {
      toast.error("Failed to update: " + (err.message || "Unknown error"));
    }
  };

  var filteredRequests = requests.filter(function (r) {
    if (filter === "all") return true;
    return r.status === filter;
  });

  var statusIcon = function (status) {
    if (status === "completed") return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (status === "in_progress") return <Clock className="w-4 h-4 text-yellow-500" />;
    if (status === "rejected") return <XCircle className="w-4 h-4 text-red-500" />;
    return <Clock className="w-4 h-4 text-blue-500" />;
  };

  var statusBadge = function (status) {
    var colors = {
      pending: "bg-blue-500/10 text-blue-500",
      in_progress: "bg-yellow-500/10 text-yellow-500",
      completed: "bg-green-500/10 text-green-500",
      rejected: "bg-red-500/10 text-red-500",
    };
    return (
      <span className={"inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium " + (colors[status] || "bg-muted text-muted-foreground")}>
        {statusIcon(status)}
        {status.replace("_", " ")}
      </span>
    );
  };

  var typeLabel = function (type) {
    var labels = { access: "Access Data", correction: "Correct Data", deletion: "Delete Data", objection: "Object to Processing", portability: "Export Data" };
    return labels[type] || type;
  };

  var pendingCount = requests.filter(function (r) { return r.status === "pending"; }).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-green-600" />
          <div>
            <h2 className="text-lg font-bold">POPIA Compliance</h2>
            <p className="text-sm text-muted-foreground">Manage data subject requests and compliance settings</p>
          </div>
        </div>
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 bg-yellow-500/10 text-yellow-600 px-3 py-1.5 rounded-full text-sm font-medium">
            <AlertTriangle className="w-4 h-4" />
            {pendingCount} pending request{pendingCount !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <a href="/#/privacy" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-green-600/30 hover:bg-green-600/5 transition-colors">
          <Shield className="w-5 h-5 text-green-600" />
          <div>
            <p className="text-sm font-medium">Privacy Policy</p>
            <p className="text-xs text-muted-foreground">View public page</p>
          </div>
        </a>
        <a href="/#/terms" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-green-600/30 hover:bg-green-600/5 transition-colors">
          <Shield className="w-5 h-5 text-green-600" />
          <div>
            <p className="text-sm font-medium">Terms of Service</p>
            <p className="text-xs text-muted-foreground">View public page</p>
          </div>
        </a>
        <a href="/#/data-request" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-green-600/30 hover:bg-green-600/5 transition-colors">
          <Shield className="w-5 h-5 text-green-600" />
          <div>
            <p className="text-sm font-medium">Data Request Form</p>
            <p className="text-xs text-muted-foreground">Public submission form</p>
          </div>
        </a>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {["all", "pending", "in_progress", "completed", "rejected"].map(function (f) {
          var label = f === "all" ? "All (" + requests.length + ")" : f.replace("_", " ") + " (" + requests.filter(function (r) { return r.status === f; }).length + ")";
          return (
            <button key={f} onClick={function () { setFilter(f); }}
              className={"px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors " +
                (filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {label}
            </button>
          );
        })}
      </div>

      {/* Requests Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No data subject requests</p>
          <p className="text-sm mt-1">Requests submitted via the public form will appear here</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRequests.map(function (req) {
                return (
                  <tr key={req.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground">{new Date(req.created_at).toLocaleDateString("en-ZA")}</td>
                    <td className="px-4 py-3 font-medium">{req.requester_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{req.requester_email}</td>
                    <td className="px-4 py-3">{typeLabel(req.request_type)}</td>
                    <td className="px-4 py-3">{statusBadge(req.status)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={function () { setSelectedRequest(req); setResponseNotes(req.response_notes || ""); }}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Request Detail Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={function (open) { if (!open) { setSelectedRequest(null); setResponseNotes(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-600" />
              Data Subject Request
            </DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Name</p>
                  <p className="font-medium">{selectedRequest.requester_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Email</p>
                  <p className="font-medium">{selectedRequest.requester_email}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Phone</p>
                  <p className="font-medium">{selectedRequest.requester_phone || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Type</p>
                  <p className="font-medium">{typeLabel(selectedRequest.request_type)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  {statusBadge(selectedRequest.status)}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Submitted</p>
                  <p className="font-medium">{new Date(selectedRequest.created_at).toLocaleString("en-ZA")}</p>
                </div>
              </div>

              {selectedRequest.description && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Description</p>
                  <p className="text-sm bg-muted/50 rounded-lg p-3">{selectedRequest.description}</p>
                </div>
              )}

              {selectedRequest.responded_at && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Responded: {new Date(selectedRequest.responded_at).toLocaleString("en-ZA")}</p>
                  {selectedRequest.response_notes && (
                    <p className="text-sm bg-muted/50 rounded-lg p-3">{selectedRequest.response_notes}</p>
                  )}
                </div>
              )}

              {(selectedRequest.status === "pending" || selectedRequest.status === "in_progress") && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <div className="space-y-2">
                    <Label>Response Notes</Label>
                    <Textarea value={responseNotes} onChange={function (e) { setResponseNotes(e.target.value); }}
                      placeholder="Document your response and actions taken..." rows={3} />
                  </div>
                  <div className="flex gap-2">
                    {selectedRequest.status === "pending" && (
                      <Button variant="outline" onClick={function () { updateStatus(selectedRequest.id, "in_progress"); }} className="flex-1">
                        <Clock className="w-4 h-4 mr-2" /> Mark In Progress
                      </Button>
                    )}
                    <Button onClick={function () { updateStatus(selectedRequest.id, "completed"); }} className="flex-1 bg-green-600 hover:bg-green-700">
                      <CheckCircle className="w-4 h-4 mr-2" /> Complete
                    </Button>
                    <Button variant="destructive" onClick={function () { updateStatus(selectedRequest.id, "rejected"); }}>
                      <XCircle className="w-4 h-4 mr-2" /> Reject
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">POPIA requires a response within 30 days of receiving the request.</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
