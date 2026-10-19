import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "../lib/CompanyContext";
import { useAuth } from "../lib/AuthContext";
import {
  BookOpen, PlayCircle, LifeBuoy, MessageSquare, Plus, ChevronDown, ChevronRight,
  CheckCircle, Clock, AlertCircle, X, Send, ExternalLink, Search, Tag, Inbox,
  Zap, Shield, BarChart2, Users, ShoppingCart, Package, Star, Settings
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

// ── Training Manual content ──
const MANUAL_SECTIONS = [
  {
    icon: Zap, title: "Getting Started", color: "text-emerald-400",
    articles: [
      { title: "Logging in & navigating Canna Life Co", content: "Open Canna Life Co at pos.cannalife.co.za. Enter your email and password. Select your Active Store from the dropdown at the top left. You'll land on the Dashboard which shows today's sales, revenue, and quick links to all sections." },
      { title: "Understanding your Dashboard", content: "The Dashboard shows today's sales performance, revenue vs expenses, recent orders, and activity. Use the left sidebar to navigate to POS, Members, Products, Inventory, Orders, Finances, Loyalty, Suppliers, and Settings." },
      { title: "User roles & what each can access", content: "Owner: Full access to all features including billing and settings.\nManager: POS, Members, Products, Inventory, Orders, Finances, Reports, Settings.\nStaff: POS, Members, Products, Orders.\nCashier: POS only." },
    ]
  },
  {
    icon: ShoppingCart, title: "Point of Sale (POS)", color: "text-blue-400",
    articles: [
      { title: "Processing a sale step by step", content: "1. Click POS in the left menu.\n2. Search for a product by name or scan its barcode.\n3. Tap the product to add it to the cart.\n4. Search and select the member before paying.\n5. Choose payment method: Cash, Card, or other.\n6. For cash — enter the amount tendered and Canna Life Co calculates change.\n7. Confirm the transaction. Receipt can be printed or sent digitally." },
      { title: "Linking a member to a sale", content: "Always link sales to a member for loyalty point tracking and records. Before confirming payment, search for the member by name or scan their QR code. Select the correct member from results. The sale will be linked to their profile and loyalty points will be added automatically." },
      { title: "Applying loyalty points at checkout", content: "During a sale, open the member's profile at the top of the POS. Check their available loyalty points. Apply points as a discount before confirming payment. Points will be deducted automatically once the sale is confirmed." },
      { title: "Processing refunds", content: "Go to Orders in the left menu. Find the original order using search or date filter. Click the order to open it. Select Refund and follow the prompts. Note: refunds may require manager approval depending on your store settings." },
    ]
  },
  {
    icon: Users, title: "Member Management", color: "text-purple-400",
    articles: [
      { title: "Adding a new member", content: "Click Members → New Intake Form. Fill in: full name, ID number, contact number, email, membership tier. Take a photo or scan their ID if required. Save the member profile — a unique QR code and membership ID will be generated automatically. Give the member their QR code card immediately." },
      { title: "Member check-in & QR codes", content: "At entry, open the POS or Members section. Scan the member's QR code using the device camera. Their profile will appear confirming membership status. If membership is expired, notify the member and follow your renewal procedure." },
      { title: "Membership tiers (Bronze, Silver, Gold, Platinum)", content: "Members are assigned tiers based on loyalty points. Bronze: 0+ pts. Silver: 500+ pts. Gold: 1500+ pts. Platinum: 5000+ pts. Each tier earns more points per purchase — configure multipliers in Settings → Loyalty." },
      { title: "Self-registration via QR code", content: "Go to Settings → Member Portal. Print or display the Registration QR code at your entrance. New visitors scan it with their phone camera, fill out a quick form, and become a member instantly — no app or staff required." },
    ]
  },
  {
    icon: Package, title: "Products & Inventory", color: "text-amber-400",
    articles: [
      { title: "Adding a new product", content: "Go to Products → Add Product. Fill in: name, description, SKU/barcode, category, price, stock quantity. Upload a product image. Save the product. It will appear in the POS search immediately." },
      { title: "Managing stock levels", content: "Go to Inventory in the left menu. View current stock for all products. Click on a product to update stock. Enter the new quantity or adjustment. Stock is tracked per store — make sure the correct Active Store is selected." },
      { title: "Receiving stock from a supplier", content: "Go to Suppliers → Click Receive Stock. Select the supplier, choose payment type (Cash, Terms, or Consignment). Enter invoice number and total. Add line items for each product received. Set the date received. Click Record Purchase Order." },
      { title: "Setting up low stock alerts", content: "In Inventory, click on any product. Set the Low Stock Threshold value. You will be notified when stock drops below this level. Check Inventory regularly and flag low stock items in your daily closing checklist." },
    ]
  },
  {
    icon: BarChart2, title: "Reports & Finance", color: "text-cyan-400",
    articles: [
      { title: "Viewing your sales reports", content: "Go to Reports or click Dashboard. Select a period: Daily, Weekly, Monthly, or Date Range. View: Total Revenue, Expenses, Net Profit, Number of Orders. Use the Revenue & Expenses chart to identify trends. Click Export PDF to download." },
      { title: "Recording expenses", content: "Go to Finances in the left menu. Click Add Expense. Enter the amount, category, description, and date. All expenses are tracked in real time and appear in your profit calculations." },
      { title: "End-of-day reconciliation", content: "Run the end-of-day sales report and Export PDF. Reconcile cash in the till against Canna Life Co totals. Log any expenses. Check inventory and flag low stock. Log out of all devices." },
    ]
  },
  {
    icon: Star, title: "Loyalty Programme", color: "text-yellow-400",
    articles: [
      { title: "How the loyalty system works", content: "Members earn points automatically on every purchase based on the points-per-rand rate you set. Points accumulate and unlock higher tiers. Configure earning rates per tier in Settings → Loyalty. Members can see their points in the Member Portal." },
      { title: "Configuring tier bonuses", content: "Go to Settings → Loyalty → Points Earning. Set a different points rate for each tier. Example: Bronze 1pt/R1, Silver 1.25pts/R1, Gold 1.5pts/R1, Platinum 2pts/R1. Save and changes take effect on the next purchase." },
      { title: "Redeeming points", content: "In the Loyalty section, find the member. Click Redeem. Enter the number of points to redeem. Points are deducted and the member receives store credit. Minimum redemption amount is set in Settings → Loyalty." },
    ]
  },
  {
    icon: Settings, title: "Settings & Team", color: "text-slate-400",
    articles: [
      { title: "Adding team members & cashiers", content: "Go to Settings → Team. Click Add Member. Enter their full name, email, password, and role. Click Create Account. They can log in immediately. Use the Cashiers section for cashier-specific accounts." },
      { title: "Setting up your Member Portal", content: "Go to Settings → Member Portal. You'll see two QR codes: one for new member registration and one for existing members to log in. Download, print, or share via WhatsApp. Members use their ID number + phone to log in." },
      { title: "Configuring loyalty settings", content: "Go to Settings → Loyalty. Toggle the loyalty programme on/off. Set points per rand per tier. Set minimum redemption amount. Set rand value per point. Adjust tier thresholds. All settings save instantly." },
    ]
  },
];

const TICKET_CATEGORIES = [
  "POS / Sales", "Members", "Products / Inventory", "Reports / Finance",
  "Loyalty", "Settings / Team", "Billing / Subscription", "Bug / Error", "Other"
];

const STATUS_CONFIG = {
  open:        { label: "Open",        color: "bg-blue-500/10 text-blue-400 border-blue-500/20",   icon: Inbox },
  in_progress: { label: "In Progress", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: Clock },
  resolved:    { label: "Resolved",    color: "bg-green-500/10 text-green-400 border-green-500/20", icon: CheckCircle },
  closed:      { label: "Closed",      color: "bg-muted text-muted-foreground border-border",        icon: X },
};

// Shareable link clients can be sent to log a ticket. They must be logged in;
// their club is taken from their own session, so one link works for every club.
const TICKET_LINK = "https://pos.cannalife.co.za/#/help?tab=tickets&new=1";

const PRIORITY_CONFIG = {
  low:    { label: "Low",       color: "text-muted-foreground" },
  normal: { label: "Normal",    color: "text-blue-400" },
  high:   { label: "High",      color: "text-amber-400" },
  urgent: { label: "🚨 Urgent", color: "text-red-400" },
};

// ── Floating Help Button ──
export function HelpButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xl shadow-emerald-900/50 flex items-center justify-center transition-all hover:scale-110 active:scale-95 group"
      title="Help & Support"
    >
      <LifeBuoy className="w-6 h-6 group-hover:rotate-12 transition-transform" />
    </button>
  );
}

// ── Main Help Center Page ──
export default function HelpCenter() {
  const { companyId } = useCompany();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("training");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedSection, setExpandedSection] = useState(null);
  const [expandedArticle, setExpandedArticle] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ticketForm, setTicketForm] = useState({ subject: "", category: "Other", priority: "normal", description: "" });
  const [selectedTicket, setSelectedTicket] = useState(null);

  // ── Role / admin state ──
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [roleResolved, setRoleResolved] = useState(false);
  const [companyMap, setCompanyMap] = useState({});
  const [adminSearch, setAdminSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [adminResponse, setAdminResponse] = useState("");
  const [isResponding, setIsResponding] = useState(false);

  // Deep link support: /#/help?tab=tickets&new=1
  // Query params live inside the hash because the app uses HashRouter.
  useEffect(() => {
    const applyDeepLink = () => {
      const hash = window.location.hash || "";
      const qIndex = hash.indexOf("?");
      if (qIndex === -1) return;
      const params = new URLSearchParams(hash.slice(qIndex + 1));
      if (params.get("tab") === "tickets") setActiveTab("tickets");
      if (params.get("new") === "1") {
        setActiveTab("tickets");
        setShowNewTicket(true);
      }
    };
    applyDeepLink();
    window.addEventListener("hashchange", applyDeepLink);
    return () => window.removeEventListener("hashchange", applyDeepLink);
  }, []);

  // Resolve role once on mount
  useEffect(() => {
    let cancelled = false;
    const resolveRole = async () => {
      try {
        const { data, error } = await supabase.rpc("get_my_profile");
        if (error) throw error;
        const profile = Array.isArray(data) ? data[0] : data;
        if (!cancelled) setIsSuperadmin(profile?.role === "superadmin");
      } catch (err) {
        if (!cancelled) setIsSuperadmin(false);
      } finally {
        if (!cancelled) setRoleResolved(true);
      }
    };
    resolveRole();
    return () => { cancelled = true; };
  }, []);

  // Load tickets
  useEffect(() => {
    if (activeTab !== "tickets" || !roleResolved) return;
    if (!isSuperadmin && !companyId) return;
    loadTickets();
  }, [activeTab, companyId, roleResolved, isSuperadmin]);

  const loadTickets = async () => {
    setLoadingTickets(true);
    try {
      let query = supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false });

      // Superadmins see every club's tickets; everyone else sees only their own company
      if (isSuperadmin) {
        query = query.limit(1000);
      } else {
        query = query.eq("company_id", companyId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setTickets(data || []);

      // Superadmin needs company names to label rows
      if (isSuperadmin) {
        const { data: companyData } = await supabase
          .from("companies")
          .select("id, company_name, trading_name")
          .limit(1000);
        const map = {};
        (companyData || []).forEach(c => {
          map[c.id] = c.company_name || c.trading_name || "Unknown";
        });
        setCompanyMap(map);
      }
    } catch (err) {
      toast.error("Failed to load tickets");
    } finally {
      setLoadingTickets(false);
    }
  };

  const submitTicket = async () => {
    if (!ticketForm.subject.trim() || !ticketForm.description.trim()) {
      toast.error("Subject and description are required");
      return;
    }
    setIsSaving(true);
    try {
      const { error } = await supabase.from("support_tickets").insert({
        company_id: companyId,
        submitted_by: user?.id,
        submitter_email: user?.email,
        subject: ticketForm.subject.trim(),
        category: ticketForm.category,
        priority: ticketForm.priority,
        description: ticketForm.description.trim(),
        status: "open",
      });
      if (error) throw error;
      toast.success("Support ticket submitted! We'll get back to you shortly.");
      setShowNewTicket(false);
      setTicketForm({ subject: "", category: "Other", priority: "normal", description: "" });
      loadTickets();
    } catch (err) {
      toast.error(err.message || "Failed to submit ticket");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Admin actions ──
  const getCompanyName = (id) => companyMap[id] || "Unknown";

  const updateTicketStatus = async (id, status) => {
    try {
      const patch = { status, updated_at: new Date().toISOString() };
      if (status === "resolved" || status === "closed") patch.resolved_at = new Date().toISOString();
      const { error } = await supabase.from("support_tickets").update(patch).eq("id", id);
      if (error) throw error;
      toast.success("Ticket updated");
      setSelectedTicket(prev => (prev && prev.id === id ? { ...prev, ...patch } : prev));
      loadTickets();
    } catch (err) {
      toast.error(err.message || "Failed to update ticket");
    }
  };

  const sendAdminResponse = async () => {
    if (!adminResponse.trim()) { toast.error("Enter a response"); return; }
    setIsResponding(true);
    try {
      const patch = {
        admin_response: adminResponse.trim(),
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("support_tickets").update(patch).eq("id", selectedTicket.id);
      if (error) throw error;
      toast.success("Response sent and ticket resolved");
      setAdminResponse("");
      setSelectedTicket(null);
      loadTickets();
    } catch (err) {
      toast.error(err.message || "Failed to send response");
    } finally {
      setIsResponding(false);
    }
  };

  const openTicket = (t) => {
    setSelectedTicket(t);
    setAdminResponse(t.admin_response || "");
  };

  // Admin filtering
  const adminFiltered = tickets.filter(t => {
    const term = adminSearch.trim().toLowerCase();
    const matchSearch = !term
      || (t.subject || "").toLowerCase().includes(term)
      || (t.description || "").toLowerCase().includes(term)
      || (t.submitter_email || "").toLowerCase().includes(term)
      || getCompanyName(t.company_id).toLowerCase().includes(term);
    const matchStatus = filterStatus === "all" || t.status === filterStatus;
    const matchPriority = filterPriority === "all" || t.priority === filterPriority;
    return matchSearch && matchStatus && matchPriority;
  });

  const openCount = tickets.filter(t => t.status === "open").length;
  const urgentCount = tickets.filter(t => t.priority === "urgent" && t.status !== "resolved" && t.status !== "closed").length;
  const inProgressCount = tickets.filter(t => t.status === "in_progress").length;
  const resolvedCount = tickets.filter(t => t.status === "resolved").length;

  // Search filtering (training manual)
  const searchResults = searchTerm.trim().length > 1
    ? MANUAL_SECTIONS.flatMap(section =>
        section.articles
          .filter(a => a.title.toLowerCase().includes(searchTerm.toLowerCase()) || a.content.toLowerCase().includes(searchTerm.toLowerCase()))
          .map(a => ({ ...a, sectionTitle: section.title, sectionColor: section.color }))
      )
    : [];

  return (
    <div className={`p-4 lg:p-6 space-y-6 animate-fade-in ${isSuperadmin && activeTab === "tickets" ? "max-w-6xl" : "max-w-4xl"}`}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <LifeBuoy className="w-6 h-6 text-emerald-500" /> Help & Support
          {isSuperadmin && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
              Admin
            </span>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">Training guides, video tutorials, and support tickets</p>
      </div>

      {/* Quick contact banner */}
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-medium text-emerald-400">Need urgent help?</p>
          <p className="text-xs text-muted-foreground">WhatsApp: +27 61 423 2317  ·  Email: support@cannalife.co.za</p>
        </div>
        <div className="flex gap-2">
          <a href="https://wa.me/27614232317" target="_blank" rel="noopener noreferrer">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1 text-xs">
              💬 WhatsApp Us
            </Button>
          </a>
          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => { setActiveTab("tickets"); setShowNewTicket(true); }}>
            <Plus className="w-3 h-3" /> Log Ticket
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: "training", label: "Training Manual", icon: BookOpen },
          { key: "videos",   label: "Video Tutorials", icon: PlayCircle },
          { key: "tickets",  label: isSuperadmin ? "All Tickets" : "Support Tickets", icon: MessageSquare },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* ── TRAINING MANUAL TAB ── */}
      {activeTab === "training" && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search training articles..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
          </div>

          {/* Search results */}
          {searchTerm.trim().length > 1 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{searchTerm}"</p>
              {searchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No articles found. Try a different search term.</p>
              ) : searchResults.map((a, i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-1 cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => { setSearchTerm(""); setExpandedSection(a.sectionTitle); setExpandedArticle(a.title); }}>
                  <p className={`text-xs font-medium ${a.sectionColor}`}>{a.sectionTitle}</p>
                  <p className="text-sm font-semibold">{a.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{a.content}</p>
                </div>
              ))}
            </div>
          )}

          {/* Manual sections */}
          {!searchTerm.trim() && (
            <div className="space-y-3">
              {MANUAL_SECTIONS.map(section => (
                <div key={section.title} className="bg-card border border-border rounded-xl overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                    onClick={() => setExpandedSection(expandedSection === section.title ? null : section.title)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg bg-muted/40`}><section.icon className={`w-4 h-4 ${section.color}`} /></div>
                      <div className="text-left">
                        <p className="text-sm font-semibold">{section.title}</p>
                        <p className="text-xs text-muted-foreground">{section.articles.length} articles</p>
                      </div>
                    </div>
                    {expandedSection === section.title ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {expandedSection === section.title && (
                    <div className="border-t border-border divide-y divide-border/50">
                      {section.articles.map(article => (
                        <div key={article.title}>
                          <button
                            className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/10 transition-colors text-left"
                            onClick={() => setExpandedArticle(expandedArticle === article.title ? null : article.title)}
                          >
                            <span className="text-sm">{article.title}</span>
                            {expandedArticle === article.title ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                          </button>
                          {expandedArticle === article.title && (
                            <div className="px-5 pb-4 pt-1">
                              <div className="bg-muted/20 rounded-lg p-4 text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                                {article.content}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── VIDEO TUTORIALS TAB ── */}
      {activeTab === "videos" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-sm">Getting Started with Canna Life Co</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Full walkthrough of the platform for new owners and staff</p>
            </div>
            <div className="aspect-video bg-muted/30 flex items-center justify-center">
              <iframe
                className="w-full h-full"
                src="https://www.youtube.com/embed/t_vIGpB71Xg"
                title="Canna Life Co Training Video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { title: "Processing your first sale", desc: "POS walkthrough from adding products to payment", tag: "POS" },
              { title: "Adding & managing members", desc: "Member registration, QR codes, and check-in", tag: "Members" },
              { title: "Setting up loyalty", desc: "Configure tiers, points, and redemption", tag: "Loyalty" },
              { title: "Running reports", desc: "Daily, weekly and monthly financial reports", tag: "Finance" },
            ].map(v => (
              <div key={v.title} className="bg-card border border-border rounded-xl p-4 flex items-start gap-3 opacity-60">
                <div className="w-10 h-10 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                  <PlayCircle className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{v.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{v.desc}</p>
                  <span className="inline-block mt-2 text-[10px] px-2 py-0.5 bg-muted rounded-full text-muted-foreground">{v.tag} · Coming soon</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SUPPORT TICKETS TAB — CLIENT VIEW ── */}
      {activeTab === "tickets" && !isSuperadmin && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{tickets.length} ticket{tickets.length !== 1 ? "s" : ""} submitted</p>
            <Button onClick={() => setShowNewTicket(true)} className="gap-2" size="sm">
              <Plus className="w-4 h-4" /> New Ticket
            </Button>
          </div>

          {loadingTickets ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-16 bg-card border border-border rounded-xl">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-30" />
              <p className="text-sm font-medium">No tickets yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Submit a support ticket if you need help</p>
              <Button size="sm" onClick={() => setShowNewTicket(true)} className="gap-1"><Plus className="w-3 h-3" /> Submit Ticket</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map(t => {
                const statusCfg = STATUS_CONFIG[t.status] || STATUS_CONFIG.open;
                const StatusIcon = statusCfg.icon;
                return (
                  <div key={t.id} className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-primary/30 transition-colors"
                    onClick={() => openTicket(t)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${statusCfg.color}`}>
                            <StatusIcon className="w-3 h-3" />{statusCfg.label}
                          </span>
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{t.category}</span>
                          {t.priority === "urgent" && <span className="text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">Urgent</span>}
                        </div>
                        <p className="text-sm font-semibold">{t.subject}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{t.description}</p>
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0">{new Date(t.created_at).toLocaleDateString("en-ZA")}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SUPPORT TICKETS TAB — SUPERADMIN VIEW ── */}
      {activeTab === "tickets" && isSuperadmin && (
        <div className="space-y-4">
          {/* Shareable client link */}
          <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium">Client ticket link</p>
              <p className="text-xs text-muted-foreground truncate">{TICKET_LINK}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(TICKET_LINK)
                  .then(() => toast.success("Link copied — paste it into WhatsApp"))
                  .catch(() => toast.error("Could not copy link"));
              }}
            >
              Copy Link
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Open", value: openCount, color: "text-blue-400" },
              { label: "Urgent", value: urgentCount, color: "text-red-400" },
              { label: "In Progress", value: inProgressCount, color: "text-amber-400" },
              { label: "Resolved", value: resolvedCount, color: "text-green-400" },
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
              <Input placeholder="Search club, subject or email..." value={adminSearch} onChange={e => setAdminSearch(e.target.value)} className="pl-10" />
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

          {loadingTickets ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left">Club</th>
                      <th className="px-4 py-3 text-left">Subject</th>
                      <th className="px-4 py-3 text-left hidden sm:table-cell">Category</th>
                      <th className="px-4 py-3 text-left">Priority</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left hidden md:table-cell">Date</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {adminFiltered.map(t => {
                      const statusCfg = STATUS_CONFIG[t.status] || STATUS_CONFIG.open;
                      const StatusIcon = statusCfg.icon;
                      const priorityCfg = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.normal;
                      const isHot = t.priority === "urgent" && t.status !== "resolved" && t.status !== "closed";
                      return (
                        <tr key={t.id} className={`hover:bg-muted/20 transition-colors ${isHot ? "bg-red-500/[0.04]" : ""}`}>
                          <td className="px-4 py-3 font-medium">{getCompanyName(t.company_id)}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium truncate max-w-[200px]">{t.subject}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{t.submitter_email}</p>
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
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => openTicket(t)}>
                              {t.status === "open" || t.status === "in_progress" ? "Respond" : "View"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {adminFiltered.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{tickets.length === 0 ? "No support tickets yet" : "No tickets match your filters"}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── New Ticket Dialog ── */}
      <Dialog open={showNewTicket} onOpenChange={setShowNewTicket}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Submit Support Ticket</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Subject *</Label>
              <Input value={ticketForm.subject} onChange={e => setTicketForm(p => ({ ...p, subject: e.target.value }))} placeholder="Brief description of your issue" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select value={ticketForm.category} onValueChange={v => setTicketForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TICKET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={ticketForm.priority} onValueChange={v => setTicketForm(p => ({ ...p, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">🚨 Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Description *</Label>
              <Textarea
                value={ticketForm.description}
                onChange={e => setTicketForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Describe the issue in detail. Include what you were doing, what happened, and any error messages you saw."
                rows={5}
              />
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
              💡 For urgent issues call WhatsApp: <span className="font-medium text-foreground">+27 61 423 2317</span>
            </div>
            <Button onClick={submitTicket} disabled={isSaving || !ticketForm.subject.trim() || !ticketForm.description.trim()} className="w-full gap-2">
              <Send className="w-4 h-4" />
              {isSaving ? "Submitting..." : "Submit Ticket"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Ticket Detail Dialog ── */}
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isSuperadmin ? "Support Ticket" : "Ticket Detail"}</DialogTitle></DialogHeader>
          {selectedTicket && (() => {
            const statusCfg = STATUS_CONFIG[selectedTicket.status] || STATUS_CONFIG.open;
            const StatusIcon = statusCfg.icon;
            const priorityCfg = PRIORITY_CONFIG[selectedTicket.priority] || PRIORITY_CONFIG.normal;
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium ${statusCfg.color}`}>
                    <StatusIcon className="w-3 h-3" />{statusCfg.label}
                  </span>
                  <span className="text-xs bg-muted px-2 py-1 rounded-full">{selectedTicket.category}</span>
                  <span className={`text-xs font-medium ${priorityCfg.color}`}>{priorityCfg.label}</span>
                </div>

                {isSuperadmin && (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground">Club</span>
                      <p className="font-medium">{getCompanyName(selectedTicket.company_id)}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Submitted by</span>
                      <p className="font-medium break-all">{selectedTicket.submitter_email || "—"}</p>
                    </div>
                  </div>
                )}

                <div>
                  <p className="font-semibold">{selectedTicket.subject}</p>
                  <p className="text-xs text-muted-foreground mt-1">Submitted {new Date(selectedTicket.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}</p>
                </div>

                <div className="bg-muted/30 rounded-lg p-4">
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="text-sm whitespace-pre-line">{selectedTicket.description}</p>
                </div>

                {selectedTicket.admin_response && (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
                    <p className="text-xs text-emerald-400 mb-1 font-medium">Canna Life Co Support Response</p>
                    <p className="text-sm whitespace-pre-line">{selectedTicket.admin_response}</p>
                  </div>
                )}

                {!selectedTicket.admin_response && !isSuperadmin && (
                  <p className="text-xs text-muted-foreground text-center py-2">Our team will respond shortly. For urgent issues WhatsApp +27 61 423 2317.</p>
                )}

                {/* Admin-only controls */}
                {isSuperadmin && (
                  <>
                    <div>
                      <Label>Update Status</Label>
                      <Select value={selectedTicket.status || "open"} onValueChange={v => updateTicketStatus(selectedTicket.id, v)}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>{selectedTicket.admin_response ? "Update Response" : "Send Response"}</Label>
                      <Textarea
                        value={adminResponse}
                        onChange={e => setAdminResponse(e.target.value)}
                        placeholder="Type your response to the club..."
                        rows={5}
                        className="mt-1"
                      />
                    </div>

                    <Button onClick={sendAdminResponse} disabled={isResponding || !adminResponse.trim()} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700">
                      <Send className="w-4 h-4" />
                      {isResponding ? "Sending..." : "Send Response & Mark Resolved"}
                    </Button>
                  </>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
