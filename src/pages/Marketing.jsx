import { supabase } from '@/api/supabaseClient';
import { useState, useEffect } from "react";
import { Megaphone, Plus, Image, Send, Trash2, Users, Eye, EyeOff, MessageCircle, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCompany } from "../lib/CompanyContext";

const AUDIENCE_LABELS = {
  all: "All Members",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

const AUDIENCE_COLORS = {
  all: "bg-blue-500/10 text-blue-400",
  bronze: "bg-amber-500/10 text-amber-500",
  silver: "bg-slate-400/10 text-slate-300",
  gold: "bg-yellow-500/10 text-yellow-400",
  platinum: "bg-purple-500/10 text-purple-400",
};

const AUDIENCE_EMOJI = {
  all: "👥",
  bronze: "🥉",
  silver: "🥈",
  gold: "🥇",
  platinum: "💎",
};

// Build WhatsApp share URL from a notification
function buildWhatsAppUrl(n, companyName) {
  var lines = [];
  if (companyName) lines.push("*" + companyName + "*");
  lines.push("");
  lines.push("*" + (n.title || "") + "*");
  lines.push("");
  lines.push(n.message || "");
  if (n.image_url) {
    lines.push("");
    lines.push("🖼️ " + n.image_url);
  }
  var text = lines.join("\n");
  return "https://api.whatsapp.com/send?text=" + encodeURIComponent(text);
}

// Build WhatsApp broadcast URL for a composed form (before saving)
function buildWhatsAppPreviewUrl(form, companyName) {
  return buildWhatsAppUrl(form, companyName);
}

export default function Marketing() {
  var { companyId } = useCompany();
  var [notifications, setNotifications] = useState([]);
  var [loading, setLoading] = useState(true);
  var [showForm, setShowForm] = useState(false);
  var [isSaving, setIsSaving] = useState(false);
  var [uploadingImage, setUploadingImage] = useState(false);
  var [form, setForm] = useState({ title: "", message: "", image_url: "", target_audience: "all" });
  var [companyName, setCompanyName] = useState("");
  var [copiedId, setCopiedId] = useState(null);
  var [showWaPreview, setShowWaPreview] = useState(false);
  var [waText, setWaText] = useState("");

  var load = async function() {
    if (!companyId) return;
    try {
      var [notifRes, compRes] = await Promise.all([
        supabase.from("customer_notifications").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(100),
        supabase.from("companies").select("trading_name, company_name").eq("id", companyId).single(),
      ]);
      setNotifications(notifRes.data || []);
      if (compRes.data) setCompanyName(compRes.data.trading_name || compRes.data.company_name || "");
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(function() { load(); }, [companyId]);

  var handleImageUpload = async function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadingImage(true);
    var uploadPath = "uploads/" + Date.now() + "_" + file.name;
    await supabase.storage.from("documents").upload(uploadPath, file, { upsert: true });
    var file_url = "https://ngblyttszqhgkxmeacmp.supabase.co/storage/v1/object/public/documents/" + uploadPath;
    setForm(function(p) { return { ...p, image_url: file_url }; });
    setUploadingImage(false);
    toast.success("Image uploaded");
  };

  var handleSend = async function() {
    if (!form.title || !form.message) return;
    setIsSaving(true);
    try {
      var { data: { user } } = await supabase.auth.getUser();
      var { error } = await supabase.from("customer_notifications").insert({
        ...form,
        company_id: companyId,
        is_published: true,
        sent_by: user && user.email,
      });
      if (error) throw error;
      toast.success("Notification sent!");
      setShowForm(false);
      setForm({ title: "", message: "", image_url: "", target_audience: "all" });
      load();
    } catch (err) {
      toast.error(err.message || "Failed to send");
    } finally {
      setIsSaving(false);
    }
  };

  var handleSendAndWhatsApp = async function() {
    if (!form.title || !form.message) return;
    setIsSaving(true);
    try {
      var { data: { user } } = await supabase.auth.getUser();
      var { error } = await supabase.from("customer_notifications").insert({
        ...form,
        company_id: companyId,
        is_published: true,
        sent_by: user && user.email,
      });
      if (error) throw error;
      toast.success("Notification sent!");
      setShowForm(false);
      setForm({ title: "", message: "", image_url: "", target_audience: "all" });
      load();
      // Open WhatsApp
      window.open(buildWhatsAppPreviewUrl(form, companyName), "_blank");
    } catch (err) {
      toast.error(err.message || "Failed to send");
    } finally {
      setIsSaving(false);
    }
  };

  var handleDelete = async function(id) {
    var { error } = await supabase.from("customer_notifications").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success("Deleted");
    load();
  };

  var togglePublish = async function(n) {
    await supabase.from("customer_notifications").update({ is_published: !n.is_published }).eq("id", n.id);
    load();
  };

  var copyWaLink = function(n) {
    var url = buildWhatsAppUrl(n, companyName);
    navigator.clipboard.writeText(url).then(function() {
      setCopiedId(n.id);
      setTimeout(function() { setCopiedId(null); }, 2000);
      toast.success("WhatsApp link copied!");
    });
  };

  var openWa = function(n) {
    window.open(buildWhatsAppUrl(n, companyName), "_blank");
  };

  var openWaPreview = function() {
    if (!form.title && !form.message) return;
    var lines = [];
    if (companyName) lines.push("*" + companyName + "*");
    lines.push("");
    lines.push("*" + (form.title || "") + "*");
    lines.push("");
    lines.push(form.message || "");
    if (form.image_url) { lines.push(""); lines.push("🖼️ " + form.image_url); }
    setWaText(lines.join("\n"));
    setShowWaPreview(true);
  };

  var safeNotifications = notifications || [];

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketing & Notifications</h1>
          <p className="text-sm text-muted-foreground">Send messages to your customers via the Customer Portal or WhatsApp</p>
        </div>
        <Button onClick={function() { setShowForm(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> New Notification
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Total Sent</p>
          <p className="text-2xl font-bold">{safeNotifications.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Published</p>
          <p className="text-2xl font-bold text-primary">{safeNotifications.filter(function(n) { return n.is_published; }).length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">With Image</p>
          <p className="text-2xl font-bold">{safeNotifications.filter(function(n) { return n.image_url; }).length}</p>
        </div>
      </div>

      {/* Notifications list */}
      <div className="space-y-3">
        {safeNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Megaphone className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">No notifications sent yet</p>
          </div>
        ) : safeNotifications.map(function(n) {
          return (
            <div key={n.id} className="bg-card border border-border rounded-xl p-4 flex gap-4">
              {n.image_url && (
                <img src={n.image_url} alt="" className="w-20 h-20 object-cover rounded-lg shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-sm">{n.title}</h3>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* WhatsApp share */}
                    <button
                      onClick={function() { openWa(n); }}
                      className="p-1 text-green-500 hover:text-green-400 transition-colors"
                      title="Share on WhatsApp"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>
                    {/* Copy WA link */}
                    <button
                      onClick={function() { copyWaLink(n); }}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy WhatsApp link"
                    >
                      {copiedId === n.id
                        ? <Check className="w-4 h-4 text-green-500" />
                        : <Copy className="w-4 h-4" />
                      }
                    </button>
                    <button onClick={function() { togglePublish(n); }} className="text-muted-foreground hover:text-foreground p-1">
                      {n.is_published ? <Eye className="w-4 h-4 text-green-500" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button onClick={function() { handleDelete(n.id); }} className="text-muted-foreground hover:text-red-500 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{n.message}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("text-xs px-2 py-0.5 rounded-full", AUDIENCE_COLORS[n.target_audience] || AUDIENCE_COLORS.all)}>
                    {AUDIENCE_EMOJI[n.target_audience] || "👥"} {AUDIENCE_LABELS[n.target_audience] || n.target_audience}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleDateString()}</span>
                  {n.sent_by && <span className="text-xs text-muted-foreground">· by {n.sent_by}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* New Notification Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Notification</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input value={form.title} onChange={function(e) { setForm(function(p) { return { ...p, title: e.target.value }; }); }} placeholder="e.g. Weekend Special 🔥" />
            </div>
            <div>
              <Label>Message *</Label>
              <textarea
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm min-h-[100px] resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.message}
                onChange={function(e) { setForm(function(p) { return { ...p, message: e.target.value }; }); }}
                placeholder="Write your message here..."
              />
            </div>
            <div>
              <Label>Target Audience</Label>
              <Select value={form.target_audience} onValueChange={function(v) { setForm(function(p) { return { ...p, target_audience: v }; }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(AUDIENCE_LABELS).map(function([k, v]) {
                    return (
                      <SelectItem key={k} value={k}>
                        <span className="mr-1">{AUDIENCE_EMOJI[k]}</span> {v}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Image (optional)</Label>
              {form.image_url ? (
                <div className="relative mt-1">
                  <img src={form.image_url} alt="" className="w-full h-40 object-cover rounded-lg" />
                  <button onClick={function() { setForm(function(p) { return { ...p, image_url: "" }; }); }} className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">✕</button>
                </div>
              ) : (
                <label className="mt-1 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:border-primary/40 transition-colors">
                  <Image className="w-6 h-6 text-muted-foreground mb-1" />
                  <span className="text-xs text-muted-foreground">{uploadingImage ? "Uploading..." : "Click to upload image"}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
                </label>
              )}
            </div>

            {/* WhatsApp preview */}
            {(form.title || form.message) && (
              <button
                onClick={openWaPreview}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-green-500/30 bg-green-500/5 text-green-500 text-sm font-medium hover:bg-green-500/10 transition-colors"
              >
                <MessageCircle className="w-4 h-4" /> Preview WhatsApp Message
              </button>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={function() { setShowForm(false); }} className="flex-1">Cancel</Button>
              <Button
                onClick={handleSend}
                disabled={!form.title || !form.message || isSaving}
                variant="outline"
                className="flex-1 gap-2"
              >
                <Send className="w-4 h-4" /> {isSaving ? "Sending..." : "Portal Only"}
              </Button>
              <Button
                onClick={handleSendAndWhatsApp}
                disabled={!form.title || !form.message || isSaving}
                className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              >
                <MessageCircle className="w-4 h-4" /> Send + WhatsApp
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* WhatsApp preview dialog */}
      <Dialog open={showWaPreview} onOpenChange={setShowWaPreview}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageCircle className="w-4 h-4 text-green-500" /> WhatsApp Preview</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Bubble preview */}
            <div className="bg-[#DCF8C6] dark:bg-green-900/40 rounded-xl rounded-tl-none p-4 text-sm text-black dark:text-white font-sans whitespace-pre-wrap shadow-sm">
              {waText}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={function() {
                  navigator.clipboard.writeText("https://api.whatsapp.com/send?text=" + encodeURIComponent(waText));
                  toast.success("Link copied!");
                }}
              >
                <Copy className="w-4 h-4" /> Copy Link
              </Button>
              <Button
                className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={function() {
                  window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(waText), "_blank");
                }}
              >
                <MessageCircle className="w-4 h-4" /> Open WhatsApp
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">Opens WhatsApp with the message pre-filled. Select contacts or a group to send to.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
