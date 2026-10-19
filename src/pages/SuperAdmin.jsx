import { supabase } from '@/api/supabaseClient';
import { useState, useEffect, useCallback, useRef } from "react";
import { Navigate } from "react-router-dom";
import CompaniesTab from "../components/superadmin/CompaniesTab";
import MembersTab from "../components/superadmin/MembersTab";
import CRMTab from "../components/superadmin/CRMTab";
import ClubControlTab from "../components/superadmin/ClubControlTab";
import SuperAdminClients from "./superadmin/Clients";
import AddClientDialog from "../components/superadmin/AddClientDialog";
import SupportTicketsTab from "../components/superadmin/SupportTicketsTab";
import {
  Building2, Users, TrendingUp, DollarSign, AlertTriangle, PauseCircle,
  UserPlus, CreditCard, Eye, CheckCircle, XCircle, Search, Plus, Trash2,
  GraduationCap, Clock, Store, ShieldCheck, ShieldX, Package, X,
  ChevronRight, Activity, BarChart2, Mic, Volume2, Settings2, LayoutGrid,
  Send, Mail, RefreshCw, FileText, Receipt,
} from "lucide-react";
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

const TABS = [
  { key: "overview",   label: "Overview" },
  { key: "clubs",      label: "Club Control" },
  { key: "billing",    label: "Billing & Signups" },
  { key: "invoices",   label: "Manual Invoicing" },
  { key: "reminders",  label: "Billing Reminders" },
  { key: "companies",  label: "Companies" },
  { key: "members",    label: "Members" },
  { key: "crm",        label: "CRM / Leads" },
  { key: "resellers",  label: "Resellers" },
  { key: "suppliers",  label: "Suppliers" },
  { key: "support",    label: "Support" },
];

/*
 * ─── COMPANY STATUS VALUES ──────────────────────────────────────────────
 * These are the ONLY values that actually exist in companies.status:
 *
 *   trial 80 · active 35 · pending_payment 7 · suspended 2 · pending 2
 *
 * The previous version filtered on 'pending_approval', which does not exist
 * in the table at all. That is why the "New Signups" card read 0 while nine
 * companies were sitting unreviewed, and why JARVIS reported that all
 * accounts were in good standing.
 *
 * Paused is NOT a companies.status value — it only ever appears in
 * companies.subscription_status. Filtering c.status === 'paused' always
 * returned an empty array.
 */
const STATUS = {
  TRIAL:           'trial',
  ACTIVE:          'active',
  PENDING:         'pending',
  PENDING_PAYMENT: 'pending_payment',
  SUSPENDED:       'suspended',
};

// A signup needing attention is either 'pending' or 'pending_payment'.
const AWAITING_REVIEW = [STATUS.PENDING, STATUS.PENDING_PAYMENT];

// List (current) monthly rates. Shared by the MRR repricing-gap card and the
// Manual Invoicing amount auto-fill, so a price change only has one home.
const LIST = { starter: 499, growth: 999, onceoff: 0 };

const DEFAULT_TEMPLATE =
  'Hi {first_name}! 👋\n\n' +
  '🌿 Welcome to the Cannalife Co Partner Program!\n\n' +
  'Your goal is simple: *Make your first sale within 7 days.*\n\n' +
  '1️⃣ Watch the training video (15 min):\nhttps://youtu.be/t_vIGpB71Xg\n\n' +
  '2️⃣ Log into your Partner Portal:\nhttps://pos.cannalife.co.za/#/reseller/dashboard\n\n' +
  '3️⃣ Join our Partner WhatsApp Group:\nhttps://chat.whatsapp.com/KuOY7znkcaH8MhGNRCUVoj\n\n' +
  '🎯 Close your first sale in 7 days and earn a *R250 bonus!*\n\n' +
  "Let's go! 🚀\n\n" +
  '— Chevan | Cannalife Co';

/*
 * ─── PAGINATED FETCH ────────────────────────────────────────────────────
 * PostgREST silently truncates at 1,000 rows with no error. The previous
 * version passed .limit(1000) on members — there are 24,054 — so every
 * members-derived figure on this page was computed from the newest 1,000
 * rows and was quietly wrong.
 *
 * Anything that can exceed 1,000 rows must page through with .range().
 */
async function fetchAllRows(table, select, options) {
  var opts = options || {};
  var pageSize = 1000;
  var maxRows = opts.maxRows || 50000;
  var all = [];
  var from = 0;

  while (from < maxRows) {
    var q = supabase.from(table).select(select || '*').range(from, from + pageSize - 1);
    if (opts.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending === true });
    var res = await q;
    if (res.error) throw new Error(table + ': ' + res.error.message);
    var rows = res.data || [];
    all = all.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Exact count without transferring rows. Used for the stat cards so they stay
// correct even when the underlying table is far too large to load.
async function countRows(table, filters) {
  var q = supabase.from(table).select('*', { count: 'exact', head: true });
  var keys = Object.keys(filters || {});
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = filters[k];
    q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
  }
  var res = await q;
  if (res.error) return 0;
  return res.count || 0;
}

/*
 * ─── BILLING WRITE HELPER ───────────────────────────────────────────────
 * All plan / status / billing writes on `companies` go through the
 * admin_update_company_billing() RPC instead of a direct table update.
 *
 * The RPC is SECURITY DEFINER and re-checks that the caller is superadmin
 * or admin. This is what allows column-level UPDATE on billing fields to be
 * revoked from the `authenticated` role, which is what stops a club owner
 * (or cashier) self-upgrading their own package from the browser console.
 *
 * Pass only the fields being changed — NULL means "leave unchanged".
 */
async function updateCompanyBilling(companyId, fields) {
  var payload = Object.assign({ p_company_id: companyId }, fields || {});
  var res = await supabase.rpc('admin_update_company_billing', payload);
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/* ─── JARVIS Voice Briefing ─── */
/*
 * speechSynthesis.getVoices() is asynchronous on every browser. On a cold
 * page load it returns an empty array, so the previous version fell through
 * to voices[0] — usually a flat American default — and only picked the
 * intended voice if you pressed the button twice. Warm the list on mount and
 * listen for onvoiceschanged.
 */
function useJarvis() {
  var synth = window.speechSynthesis;
  var voicesRef = useRef([]);

  useEffect(function () {
    if (!synth) return;
    var refresh = function () { voicesRef.current = synth.getVoices() || []; };
    refresh();
    synth.onvoiceschanged = refresh;
    return function () { synth.onvoiceschanged = null; };
  }, []);

  // Ordered by how close each gets to a clipped British butler. Natural/Neural
  // voices first — they carry intonation far better than the legacy ones.
  var getBestVoice = function () {
    var voices = voicesRef.current.length ? voicesRef.current : (synth.getVoices() || []);
    var preferred = [
      'Microsoft Ryan Online (Natural) - English (United Kingdom)',
      'Microsoft Thomas Online (Natural) - English (United Kingdom)',
      'Google UK English Male',
      'Daniel (Enhanced)',
      'Daniel',
      'Arthur',
      'Oliver',
      'Alex',
    ];
    for (var i = 0; i < preferred.length; i++) {
      var exact = voices.find(function (v) { return v.name === preferred[i]; });
      if (exact) return exact;
    }
    var gbMale = voices.find(function (v) {
      return v.lang === 'en-GB' && !/female|samantha|karen|serena|fiona|moira/i.test(v.name);
    });
    if (gbMale) return gbMale;
    var gb = voices.find(function (v) { return v.lang === 'en-GB'; });
    if (gb) return gb;
    return voices.find(function (v) { return v.lang && v.lang.startsWith('en'); }) || voices[0] || null;
  };

  /*
   * Chrome cuts speech off after roughly 15 seconds unless the utterance is
   * broken up. Split on sentences and queue them — this also gives natural
   * pauses between lines instead of one long run-on.
   */
  var speak = function (text, onEnd) {
    if (!synth) { if (onEnd) onEnd(); return; }
    synth.cancel();

    var voice = getBestVoice();
    var chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
    var index = 0;

    var next = function () {
      if (index >= chunks.length) { if (onEnd) onEnd(); return; }
      var utt = new SpeechSynthesisUtterance(chunks[index].trim());
      utt.rate = 0.96;   // measured, not sluggish
      utt.pitch = 0.8;   // lower — reads as composed rather than cheerful
      utt.volume = 1;
      if (voice) utt.voice = voice;
      utt.onend = function () { index += 1; next(); };
      utt.onerror = function () { index += 1; next(); };
      synth.speak(utt);
    };
    next();
  };

  var stop = function () { if (synth) synth.cancel(); };
  var isSpeaking = function () { return synth ? synth.speaking : false; };
  return { speak, stop, isSpeaking };
}

function JarvisButton({ companies, subscriptions, leads, counts }) {
  var [speaking, setSpeaking] = useState(false);
  var jarvis = useJarvis();

  var buildBriefing = function () {
    var now = new Date();
    var hour = now.getHours();
    var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var day = now.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });

    var active  = companies.filter(function (c) { return c.status === STATUS.ACTIVE; }).length;
    var trial   = companies.filter(function (c) { return c.status === STATUS.TRIAL; }).length;
    var review  = companies.filter(function (c) { return AWAITING_REVIEW.indexOf(c.status) !== -1; }).length;
    var paused  = companies.filter(function (c) { return c.subscription_status === 'paused'; }).length;
    var overdue = companies.filter(function (c) { return c.subscription_status === 'overdue'; }).length;

    var mrr = subscriptions
      .filter(function (s) { return s.status === 'active'; })
      .reduce(function (sum, s) { return sum + (Number(s.price_zar) || 0); }, 0);

    var wonLeads = leads.filter(function (l) { return l.stage === 'won'; }).length;
    var pendingMembers = counts.pendingMembers;

    // "Cannalife Co" is read as Bud-if-eye by most engines. Spelled phonetically.
    var rands = function (n) { return n.toLocaleString('en-ZA') + ' rand'; };

    var lines = [];
    lines.push(greeting + ', sir. Cannalife Co systems online.');
    lines.push('Platform briefing for ' + day + '.');
    lines.push('Portfolio stands at ' + companies.length + ' clubs. ' + active + ' on paid subscriptions, ' + trial + ' still on trial.');
    lines.push('Monthly recurring revenue, ' + rands(mrr) + '.');

    if (review > 0) {
      lines.push(review + ' signup' + (review === 1 ? '' : 's') + ' awaiting your review, sir. I would attend to that first.');
    } else {
      lines.push('No signups awaiting review.');
    }

    if (overdue > 0) {
      lines.push('Flagging ' + overdue + ' account' + (overdue === 1 ? '' : 's') + ' overdue on payment. No service has been interrupted.');
    }

    if (paused > 0) {
      lines.push(paused + ' subscription' + (paused === 1 ? ' is' : 's are') + ' currently paused.');
    }

    if (pendingMembers > 0) {
      lines.push('Across all clubs, ' + pendingMembers.toLocaleString('en-ZA') + ' member registration' + (pendingMembers === 1 ? '' : 's') + ' await approval.');
    }

    lines.push('Pipeline holds ' + leads.length + ' leads' + (wonLeads > 0 ? ', ' + wonLeads + ' closed won' : '') + '.');
    lines.push('That is everything. I will be here if you need me.');

    return lines.join(' ');
  };

  var handleToggle = function () {
    if (jarvis.isSpeaking()) { jarvis.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    jarvis.speak(buildBriefing(), function () { setSpeaking(false); });
  };

  return (
    <button onClick={handleToggle} title={speaking ? "Stop briefing" : "Get JARVIS briefing"}
      className={"flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border " +
        (speaking ? "bg-primary/10 text-primary border-primary/30 animate-pulse" : "bg-muted/30 text-muted-foreground border-border hover:border-primary/30 hover:text-primary hover:bg-primary/5")}>
      {speaking ? <><Volume2 className="w-4 h-4" /> Speaking...</> : <><Mic className="w-4 h-4" /> Briefing</>}
    </button>
  );
}

function StatCard({ icon: Icon, label, value, color = "primary", onClick, subtitle }) {
  const colorMap = { primary: "bg-primary/10 text-primary", green: "bg-green-500/10 text-green-400", yellow: "bg-yellow-500/10 text-yellow-400", red: "bg-red-500/10 text-red-400", blue: "bg-blue-500/10 text-blue-400" };
  return (
    <div onClick={onClick} className={`bg-card border border-border rounded-xl p-5 flex gap-4 items-center transition-all ${onClick ? "cursor-pointer hover:border-primary/40 hover:bg-muted/20 group" : ""}`}>
      <div className={`p-3 rounded-lg ${colorMap[color]}`}><Icon className="w-5 h-5" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        {subtitle && <p className="text-xs text-primary mt-0.5">{subtitle}</p>}
      </div>
      {onClick && <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />}
    </div>
  );
}

function DrilldownPanel({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <h2 className="font-semibold text-base">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/40 text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
      </div>
    </div>
  );
}

export default function SuperAdmin() {
  const [user, setUser] = useState(null);
  const [profileRole, setProfileRole] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState("overview");
  const [companies, setCompanies] = useState([]);
  const [members, setMembers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [counts, setCounts] = useState({ pendingMembers: 0, totalMembers: 0 });
  const [pendingSignupCount, setPendingSignupCount] = useState(0);
  const [pendingResellerCount, setPendingResellerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAddClient, setShowAddClient] = useState(false);
  const [drilldown, setDrilldown] = useState(null);
  const [busyCompanyId, setBusyCompanyId] = useState(null);

  useEffect(() => {
    const init = async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user) {
        setUser(authData.user);
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', authData.user.id).single();
        if (profile) setProfileRole(profile.role);
      }
      setAuthChecked(true);
    };
    init();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      // companies / leads / subscriptions are all well under 1,000 rows, but
      // they are paged anyway so this does not silently break as you grow.
      const [compData, leadData, subData] = await Promise.all([
        fetchAllRows('companies',     '*', { orderBy: 'created_at' }),
        fetchAllRows('leads',         '*', { orderBy: 'created_at' }),
        fetchAllRows('subscriptions', '*', { orderBy: 'created_at' }),
      ]);
      setCompanies(compData);
      setLeads(leadData);
      setSubscriptions(subData);

      // Members: 24,000+ rows. Never load these for a stat card — count them
      // server-side instead. MembersTab receives a capped working set.
      const [pendingMembers, totalMembers, memberSample] = await Promise.all([
        countRows('members', { registration_status: 'pending' }),
        countRows('members', {}),
        fetchAllRows('members', '*', { orderBy: 'created_at', maxRows: 5000 }),
      ]);
      setCounts({ pendingMembers, totalMembers });
      setMembers(memberSample);

      // Signups awaiting review: 'pending' + 'pending_payment'.
      // 'pending_approval' was never a real value in this column.
      const signupCount = await countRows('companies', { status: AWAITING_REVIEW });
      setPendingSignupCount(signupCount);

      const resellerPending = await countRows('resellers', { status: 'pending' });
      setPendingResellerCount(resellerPending);
    } catch (err) { console.error(err); toast.error('Load failed: ' + err.message); } finally { setLoading(false); }
  };

  const isSuperadmin = profileRole === 'superadmin' || profileRole === 'admin';
  useEffect(() => { if (authChecked && isSuperadmin) load(); }, [authChecked, profileRole]);

  if (!authChecked) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;
  if (!isSuperadmin) return <Navigate to="/" replace />;

  const activeCompanies  = companies.filter(c => c.status === STATUS.ACTIVE);
  const trialCompanies   = companies.filter(c => c.status === STATUS.TRIAL);
  const reviewCompanies  = companies.filter(c => AWAITING_REVIEW.indexOf(c.status) !== -1);
  // Paused lives on subscription_status only — companies.status never holds it.
  const pausedCompanies  = companies.filter(c => c.subscription_status === 'paused');
  const overdueCompanies = companies.filter(c => c.subscription_status === 'overdue');
  const wonLeads = leads.filter(l => l.stage === "won");

  /*
   * MRR is summed from subscriptions.price_zar where the SUBSCRIPTION is
   * active — not where the company is. Comped accounts carry price_zar = 0
   * and internal accounts have no subscription row, so both drop out
   * naturally. This figure is the honest one; do not "fix" it upward by
   * substituting list prices for missing values.
   */
  const activeSubs = subscriptions.filter(s => s.status === "active");
  const mrr = activeSubs.reduce((sum, s) => sum + (Number(s.price_zar) || 0), 0);

  // What the same clubs would bill at current rates — the legacy-pricing gap.
  const mrrAtCurrentRates = activeSubs.reduce((sum, s) => sum + (LIST[s.package] || 0), 0);
  const repricingGap = mrrAtCurrentRates - mrr;

  const openDrilldown = (type) => {
    const configs = {
      total:   { title: `All Companies (${companies.length})`,              data: companies },
      active:  { title: `Active Subscriptions (${activeCompanies.length})`, data: activeCompanies },
      signups: { title: `Signups Awaiting Review (${reviewCompanies.length})`, data: reviewCompanies },
      paused:  { title: `Paused Accounts (${pausedCompanies.length})`,      data: pausedCompanies },
      overdue: { title: `Overdue Accounts (${overdueCompanies.length})`,    data: overdueCompanies },
      members: { title: `Pending Members (${counts.pendingMembers})`,       data: members.filter(m => m.registration_status === 'pending'), isMember: true },
      mrr:     { title: `Active Revenue — R${mrr.toLocaleString()}/mo`,     data: activeSubs, isSub: true },
    };
    const config = configs[type];
    if (config) setDrilldown({ type, ...config });
  };

  // Routed through admin_update_company_billing() — `status` is a protected
  // column and is no longer writable by a plain table update.
  const approveCompany = async (id) => {
    setBusyCompanyId(id);
    try {
      await updateCompanyBilling(id, { p_status: STATUS.ACTIVE });
      toast.success("Approved");
      await load();
      setDrilldown(null);
    } catch (err) {
      toast.error("Approve failed: " + err.message);
    } finally {
      setBusyCompanyId(null);
    }
  };

  const resumeCompany = async (id) => {
    setBusyCompanyId(id);
    try {
      await updateCompanyBilling(id, { p_status: STATUS.ACTIVE });
      toast.success("Resumed");
      await load();
      setDrilldown(null);
    } catch (err) {
      toast.error("Resume failed: " + err.message);
    } finally {
      setBusyCompanyId(null);
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Super Admin</h1><p className="text-sm text-muted-foreground">Multi-tenant control panel</p></div>
        <div className="flex items-center gap-2">
          {tab === "overview" && !loading && <JarvisButton companies={companies} subscriptions={subscriptions} leads={leads} counts={counts} />}
          <button onClick={() => setShowAddClient(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors">
            <UserPlus className="w-4 h-4" /> Add Client
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap border-b border-border">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-px flex items-center gap-2 ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
            {t.key === "billing" && pendingSignupCount > 0 && <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{pendingSignupCount}</span>}
            {t.key === "resellers" && pendingResellerCount > 0 && <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{pendingResellerCount}</span>}
          </button>
        ))}
      </div>

      {loading && tab !== "billing" && tab !== "resellers" ? (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
      ) : (
        <>
          {tab === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard icon={Building2}   label="Total Companies"      value={companies.length}          color="primary" subtitle={`${trialCompanies.length} on trial`} onClick={() => openDrilldown("total")} />
                <StatCard icon={TrendingUp}  label="Active Subscriptions" value={activeCompanies.length}    color="green"   subtitle="Click to view" onClick={() => openDrilldown("active")} />
                <StatCard icon={CreditCard}  label="Awaiting Review"      value={pendingSignupCount}        color="yellow"  subtitle="Pending / unpaid" onClick={() => openDrilldown("signups")} />
                <StatCard icon={PauseCircle} label="Paused"               value={pausedCompanies.length}    color="red"     subtitle="Click to view" onClick={() => openDrilldown("paused")} />
                <StatCard icon={UserPlus}    label="Pending Members"      value={counts.pendingMembers.toLocaleString()} color="blue" subtitle="Across all clubs" onClick={() => openDrilldown("members")} />
              </div>

              {pendingSignupCount > 0 && (
                <div className="bg-card border border-amber-500/30 rounded-xl p-5">
                  <div className="flex items-center justify-between">
                    <div><h2 className="font-semibold text-amber-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {pendingSignupCount} signup{pendingSignupCount > 1 ? 's' : ''} awaiting review</h2><p className="text-xs text-muted-foreground mt-1">Review and send invoices from the Billing tab</p></div>
                    <button onClick={() => setTab("billing")} className="px-4 py-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 text-sm font-medium hover:bg-amber-500/20 transition-colors">Review →</button>
                  </div>
                </div>
              )}

              {overdueCompanies.length > 0 && (
                <div className="bg-card border border-orange-500/30 rounded-xl p-5">
                  <div className="flex items-center justify-between">
                    <div><h2 className="font-semibold text-orange-400 flex items-center gap-2"><Clock className="w-4 h-4" /> {overdueCompanies.length} account{overdueCompanies.length > 1 ? 's' : ''} overdue</h2><p className="text-xs text-muted-foreground mt-1">Payment failed — service has not been interrupted</p></div>
                    <button onClick={() => openDrilldown("overdue")} className="px-4 py-2 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20 text-sm font-medium hover:bg-orange-500/20 transition-colors">View →</button>
                  </div>
                </div>
              )}

              {pendingResellerCount > 0 && (
                <div className="bg-card border border-green-500/30 rounded-xl p-5">
                  <div className="flex items-center justify-between">
                    <div><h2 className="font-semibold text-green-400 flex items-center gap-2"><Users className="w-4 h-4" /> {pendingResellerCount} reseller application{pendingResellerCount > 1 ? 's' : ''} pending</h2><p className="text-xs text-muted-foreground mt-1">Review and approve reseller applications</p></div>
                    <button onClick={() => setTab("resellers")} className="px-4 py-2 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 text-sm font-medium hover:bg-green-500/20 transition-colors">Review →</button>
                  </div>
                </div>
              )}

              <div className="bg-card border border-border rounded-xl p-5">
                <h2 className="font-semibold mb-4 flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /> Subscription Revenue</h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                  <div className="cursor-pointer hover:bg-muted/20 rounded-xl p-3 transition-colors" onClick={() => openDrilldown("mrr")}>
                    <p className="text-2xl font-bold text-green-400">R{mrr.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-1">Monthly Active MRR</p>
                    <p className="text-xs text-primary mt-0.5">{activeSubs.length} paying subs</p>
                  </div>
                  <div className="rounded-xl p-3">
                    <p className="text-2xl font-bold text-blue-400">R{mrrAtCurrentRates.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-1">At Current Rates</p>
                    <p className="text-xs text-amber-400 mt-0.5">{repricingGap > 0 ? `R${repricingGap.toLocaleString()} legacy gap` : 'No gap'}</p>
                  </div>
                  <div className="cursor-pointer hover:bg-muted/20 rounded-xl p-3 transition-colors" onClick={() => openDrilldown("paused")}>
                    <p className="text-2xl font-bold text-yellow-400">{pausedCompanies.length}</p>
                    <p className="text-xs text-muted-foreground mt-1">Paused Accounts</p>
                    <p className="text-xs text-primary mt-0.5">Click to view</p>
                  </div>
                  <div><p className="text-2xl font-bold text-primary">{wonLeads.length}</p><p className="text-xs text-muted-foreground mt-1">Won Leads (CRM)</p></div>
                </div>
              </div>

              {pausedCompanies.length > 0 && (
                <div className="bg-card border border-red-500/20 rounded-xl p-5">
                  <h2 className="font-semibold text-red-400 mb-3 flex items-center gap-2"><PauseCircle className="w-4 h-4" /> Paused Subscriptions</h2>
                  <div className="space-y-2">{pausedCompanies.map(c => (
                    <div key={c.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                      <div><p className="text-sm font-medium">{c.company_name}</p><p className="text-xs text-muted-foreground">{c.email} · {c.next_payment_due ? `Due: ${c.next_payment_due}` : "No payment date"}</p></div>
                      <button onClick={() => resumeCompany(c.id)} disabled={busyCompanyId === c.id} className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50">{busyCompanyId === c.id ? "Working..." : "Resume"}</button>
                    </div>
                  ))}</div>
                </div>
              )}
            </div>
          )}
          {tab === "clubs"     && <ClubControlTab companies={companies} onRefresh={load} />}
          {tab === "billing"   && <SuperAdminClients />}
          {tab === "invoices"  && <ManualInvoicingTab companies={companies} onRefresh={load} />}
          {tab === "reminders" && <BillingRemindersTab />}
          {tab === "companies" && <CompaniesTab companies={companies} onRefresh={load} />}
          {tab === "members"   && <MembersTab members={members} companies={companies} onRefresh={load} />}
          {tab === "crm"       && <CRMTab leads={leads} onRefresh={load} />}
          {tab === "resellers" && <ResellersTab />}
          {tab === "suppliers" && <SuppliersTab />}
          {tab === "support"   && <SupportTicketsTab />}
        </>
      )}

      {drilldown && (
        <DrilldownPanel title={drilldown.title} onClose={() => setDrilldown(null)}>
          {drilldown.isMember ? (
            <div className="space-y-2">
              {counts.pendingMembers > drilldown.data.length && (
                <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-2">
                  Showing {drilldown.data.length} of {counts.pendingMembers.toLocaleString()} pending. Open the Members tab for the full list.
                </p>
              )}
              {drilldown.data.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No pending members</p> : drilldown.data.map(m => (
                <div key={m.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2.5">
                  <div><p className="text-sm font-medium">{m.first_name} {m.last_name}</p><p className="text-xs text-muted-foreground">{m.membership_id} · {m.phone}</p></div>
                  <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString('en-ZA')}</span>
                </div>
              ))}
            </div>
          ) : drilldown.isSub ? (
            <div className="space-y-2">
              {drilldown.data.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No active subscriptions</p> : drilldown.data.map(s => {
                const company = companies.find(c => c.id === s.company_id);
                const list = LIST[s.package] || 0;
                const legacy = list > 0 && Number(s.price_zar) > 0 && Number(s.price_zar) < list;
                return (
                  <div key={s.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2.5">
                    <div><p className="text-sm font-medium">{company?.company_name || s.company_id}</p><p className="text-xs text-muted-foreground">{company?.email} · {s.package}</p></div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-400">R{(Number(s.price_zar) || 0).toLocaleString()}/mo</p>
                      {legacy && <p className="text-xs text-amber-400">legacy · list R{list}</p>}
                    </div>
                  </div>
                );
              })}
              <div className="mt-4 pt-4 border-t border-border space-y-1">
                <div className="flex justify-between text-sm font-semibold"><span>Total MRR</span><span className="text-green-400">R{mrr.toLocaleString()}/mo</span></div>
                <div className="flex justify-between text-xs text-muted-foreground"><span>At current rates</span><span>R{mrrAtCurrentRates.toLocaleString()}/mo</span></div>
                {repricingGap > 0 && <div className="flex justify-between text-xs text-amber-400"><span>Legacy pricing gap</span><span>R{repricingGap.toLocaleString()}/mo</span></div>}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {drilldown.data.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No companies</p> : drilldown.data.map(c => {
                const sub = subscriptions.find(s => s.company_id === c.id);
                const statusColor = {
                  active: "text-green-400 bg-green-500/10",
                  trial: "text-blue-400 bg-blue-500/10",
                  pending: "text-amber-400 bg-amber-500/10",
                  pending_payment: "text-amber-400 bg-amber-500/10",
                  suspended: "text-red-400 bg-red-500/10",
                }[c.status] || "text-muted-foreground bg-muted";
                return (
                  <div key={c.id} className="bg-muted/30 rounded-xl px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div><p className="text-sm font-semibold">{c.company_name}</p><p className="text-xs text-muted-foreground">{c.email} · {c.phone}</p></div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusColor}`}>{c.status}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span>Plan: <span className="font-medium text-foreground capitalize">{c.package || sub?.package || c.subscription_plan || "—"}</span></span>
                      <span>Fee: <span className="font-medium text-foreground">R{Number(c.monthly_fee || 0).toLocaleString()}</span></span>
                      <span>Joined: <span className="font-medium text-foreground">{new Date(c.created_at).toLocaleDateString('en-ZA')}</span></span>
                    </div>
                    {!c.package && <p className="text-xs text-amber-400">⚠ No package set — features are gated off for this club</p>}
                    {AWAITING_REVIEW.indexOf(c.status) !== -1 && <button onClick={() => approveCompany(c.id)} disabled={busyCompanyId === c.id} className="w-full mt-1 py-1.5 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-medium hover:bg-green-500/20 transition-colors disabled:opacity-50">{busyCompanyId === c.id ? "Working..." : "✓ Approve"}</button>}
                    {(c.subscription_status === "paused" || c.status === STATUS.SUSPENDED) && <button onClick={() => resumeCompany(c.id)} disabled={busyCompanyId === c.id} className="w-full mt-1 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50">{busyCompanyId === c.id ? "Working..." : "▶ Resume"}</button>}
                  </div>
                );
              })}
            </div>
          )}
        </DrilldownPanel>
      )}
      {showAddClient && <AddClientDialog onClose={() => setShowAddClient(false)} onSuccess={() => load()} />}
    </div>
  );
}

/* ─── MANUAL INVOICING TAB ────────────────────────────────────────────── */
/*
 * Paystack no longer auto-collects, so every invoice is created here by
 * hand and paid by EFT. This replaces one-off Word-doc tax invoices (the
 * kind previously built per client in Word/Zoho Sign) with the same
 * numbering the `invoices` table already uses in production —
 * generate_invoice_number() gives BUD-{year}-{4-digit-seq}, e.g.
 * BUD-2026-0021 — rather than a per-client ad hoc scheme.
 *
 * Two things live on this tab:
 *   - Trials past trial_ends_at with no invoice raised yet. The client is
 *     expected to email in asking to continue; once they do, raise and
 *     send the invoice from their row here. That does NOT activate them —
 *     it only sends the invoice and moves them to 'pending_payment', which
 *     is the existing "Awaiting Review" bucket the Billing tab already
 *     tracks. Activation happens once you've actually seen the money, via
 *     the same Approve action used everywhere else.
 *   - Every invoice ever raised, with Send / Resend and Mark Paid. Marking
 *     an invoice paid on a trial/pending company also offers one-click
 *     Activate, which rolls next_payment_due forward a month.
 *
 * All company-row writes go through updateCompanyBilling() (the
 * admin_update_company_billing RPC) — never a direct table update — for
 * the same reason the rest of this file does that.
 */
function ManualInvoicingTab({ companies, onRefresh }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [createFor, setCreateFor] = useState(null); // company object or null
  const [payFor, setPayFor] = useState(null); // invoice object or null

  const loadInvoices = useCallback(async function () {
    setLoading(true);
    try {
      const data = await fetchAllRows('invoices', '*', { orderBy: 'created_at', ascending: false });
      setInvoices(data);
    } catch (err) {
      toast.error('Failed to load invoices: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(function () { loadInvoices(); }, [loadInvoices]);

  const companyById = {};
  companies.forEach(function (c) { companyById[c.id] = c; });

  const todayISO = new Date().toISOString().slice(0, 10);

  // A trial counts as "expired, awaiting an invoice" once trial_ends_at has
  // passed and there is no invoice on file for it yet — once one exists,
  // it belongs in the ledger below instead, however old.
  const invoicedCompanyIds = new Set(invoices.map(function (inv) { return inv.company_id; }));
  const expiredTrials = companies.filter(function (c) {
    if (c.status !== STATUS.TRIAL) return false;
    if (!c.trial_ends_at) return false;
    if (String(c.trial_ends_at).slice(0, 10) > todayISO) return false;
    return !invoicedCompanyIds.has(c.id);
  }).sort(function (a, b) { return a.trial_ends_at < b.trial_ends_at ? -1 : 1; });

  const pendingInvoices = invoices.filter(function (inv) { return inv.status === 'pending'; });
  const outstandingTotal = pendingInvoices.reduce(function (sum, inv) { return sum + (Number(inv.amount_zar) || 0); }, 0);
  const paidThisMonth = invoices.filter(function (inv) {
    return inv.status === 'paid' && inv.paid_date && String(inv.paid_date).slice(0, 7) === todayISO.slice(0, 7);
  });
  const paidThisMonthTotal = paidThisMonth.reduce(function (sum, inv) { return sum + (Number(inv.amount_zar) || 0); }, 0);

  async function callSendInvoice(invoiceId) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await supabase.functions.invoke('send-invoice', {
      body: { invoice_id: invoiceId },
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (res.error) throw new Error(res.error.message || 'Send failed');
    if (res.data?.success === false) throw new Error(res.data.error || 'Send failed');
    return res.data;
  }

  // Creates the invoice row (invoice_number is the table default —
  // generate_invoice_number() — never set by hand here), sends it, and
  // moves the company to pending_payment so it shows on the existing
  // Billing "Awaiting Review" list. Does not activate anything.
  async function createAndSendInvoice(company, form) {
    setBusyId(company.id);
    try {
      const issuedISO = new Date().toISOString().slice(0, 10);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);
      const dueISO = dueDate.toISOString().slice(0, 10);

      const insertRes = await supabase.from('invoices').insert({
        company_id: company.id,
        amount_zar: Number(form.amount),
        description: form.description,
        status: 'pending',
        issued_date: issuedISO,
        due_date: dueISO,
      }).select().single();
      if (insertRes.error) throw insertRes.error;

      await callSendInvoice(insertRes.data.id);

      await updateCompanyBilling(company.id, {
        p_status: STATUS.PENDING_PAYMENT,
        p_package: form.package,
        p_monthly_fee: Number(form.amount),
        p_next_payment_due: dueISO,
      });

      toast.success('Invoice ' + insertRes.data.invoice_number + ' sent to ' + company.company_name);
      setCreateFor(null);
      await Promise.all([loadInvoices(), onRefresh()]);
    } catch (err) {
      toast.error('Failed: ' + err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function resendInvoice(invoice) {
    setBusyId(invoice.id);
    try {
      await callSendInvoice(invoice.id);
      toast.success('Resent ' + invoice.invoice_number);
      await loadInvoices();
    } catch (err) {
      toast.error('Resend failed: ' + err.message);
    } finally {
      setBusyId(null);
    }
  }

  // Marking paid never activates by itself — the club stays exactly where
  // its status already is. Activate is offered right there as a second,
  // deliberate step so a paid invoice on a company that's still mid-trial
  // (e.g. paid in advance) doesn't flip it live before you meant to.
  async function markPaid(invoice, paymentReference) {
    setBusyId(invoice.id);
    try {
      const paidISO = new Date().toISOString().slice(0, 10);
      const updateRes = await supabase.from('invoices').update({
        status: 'paid',
        paid_date: paidISO,
        payment_reference: paymentReference || null,
      }).eq('id', invoice.id);
      if (updateRes.error) throw updateRes.error;
      toast.success('Marked ' + invoice.invoice_number + ' paid');
      setPayFor(null);
      await loadInvoices();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function activateFromInvoice(invoice) {
    setBusyId(invoice.id);
    try {
      const nextDue = new Date();
      nextDue.setMonth(nextDue.getMonth() + 1);
      await updateCompanyBilling(invoice.company_id, {
        p_status: STATUS.ACTIVE,
        p_next_payment_due: nextDue.toISOString().slice(0, 10),
      });
      toast.success('Activated');
      await onRefresh();
    } catch (err) {
      toast.error('Activate failed: ' + err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={AlertTriangle} label="Trials Awaiting Invoice" value={expiredTrials.length} color="yellow" subtitle="expired, nothing sent yet" />
        <StatCard icon={Receipt}       label="Outstanding"             value={'R' + outstandingTotal.toLocaleString()} color="red" subtitle={pendingInvoices.length + ' pending'} />
        <StatCard icon={DollarSign}    label="Paid This Month"         value={'R' + paidThisMonthTotal.toLocaleString()} color="green" subtitle={paidThisMonth.length + ' invoices'} />
        <StatCard icon={FileText}      label="Total Invoices"          value={invoices.length} color="primary" />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" /> Trials Awaiting Invoice</h2>
          <p className="text-xs text-muted-foreground mt-1">Trial ended, no invoice raised yet. Wait for the client's email before sending one.</p>
        </div>
        {expiredTrials.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nothing waiting</p>
        ) : (
          <div className="divide-y divide-border">
            {expiredTrials.map(function (c) {
              const daysExpired = Math.max(0, Math.round((new Date(todayISO) - new Date(String(c.trial_ends_at).slice(0, 10))) / 86400000));
              return (
                <div key={c.id} className="flex items-center justify-between px-5 py-3 flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-medium">{c.company_name}</p>
                    <p className="text-xs text-muted-foreground">{c.billing_email || c.email || <span className="text-red-400">No email on file</span>} · trial ended {daysExpired}d ago</p>
                  </div>
                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={function () { setCreateFor(c); }} disabled={busyId === c.id}>
                    <Receipt className="w-3.5 h-3.5" /> Create & Send Invoice
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> All Invoices</h2>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={loadInvoices} disabled={loading}>
            <RefreshCw className={"w-3.5 h-3.5" + (loading ? " animate-spin" : "")} /> Refresh
          </Button>
        </div>
        {loading ? (
          <div className="py-12 text-center text-muted-foreground">Loading...</div>
        ) : invoices.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No invoices raised yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Invoice</th>
                <th className="px-4 py-3 text-left">Club</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Due</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Sent</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.map(function (inv) {
                const company = companyById[inv.company_id];
                const isBusy = busyId === inv.id;
                const companyStillPending = company && (company.status === STATUS.PENDING_PAYMENT || company.status === STATUS.TRIAL || company.status === STATUS.PENDING);
                return (
                  <tr key={inv.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="px-4 py-3 font-medium">{company?.company_name || inv.company_id}</td>
                    <td className="px-4 py-3 text-right font-semibold">R{Number(inv.amount_zar).toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.due_date || '—'}</td>
                    <td className="px-4 py-3">
                      {inv.status === 'paid' ? (
                        <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-400">Paid</span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-400">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{inv.sent_at ? new Date(inv.sent_at).toLocaleDateString('en-ZA') : 'Not sent'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={function () { resendInvoice(inv); }} disabled={isBusy}>
                          <Send className="w-3 h-3" /> {inv.sent_at ? 'Resend' : 'Send'}
                        </Button>
                        {inv.status !== 'paid' && (
                          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={function () { setPayFor(inv); }} disabled={isBusy}>
                            <CheckCircle className="w-3 h-3" /> Mark Paid
                          </Button>
                        )}
                        {inv.status === 'paid' && companyStillPending && (
                          <Button size="sm" className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={function () { activateFromInvoice(inv); }} disabled={isBusy}>
                            ▶ Activate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <CreateInvoiceDialog company={createFor} onClose={function () { setCreateFor(null); }} onSubmit={createAndSendInvoice} busy={!!busyId} />
      <MarkPaidDialog invoice={payFor} onClose={function () { setPayFor(null); }} onSubmit={markPaid} busy={!!busyId} />
    </div>
  );
}

function CreateInvoiceDialog({ company, onClose, onSubmit, busy }) {
  const [pkg, setPkg] = useState('starter');
  const [amount, setAmount] = useState('499');

  useEffect(function () {
    if (!company) return;
    const defaultPkg = company.package && LIST[company.package] != null ? company.package : 'starter';
    setPkg(defaultPkg);
    setAmount(String(company.monthly_fee || LIST[defaultPkg] || 499));
  }, [company]);

  if (!company) return null;
  const description = 'Cannalife Co POS - ' + (pkg === 'growth' ? 'Growth' : 'Starter') + ' Package (Monthly Subscription)';

  return (
    <Dialog open={!!company} onOpenChange={function (o) { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Create & Send Invoice — {company.company_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Package</Label>
            <Select value={pkg} onValueChange={function (v) { setPkg(v); setAmount(String(LIST[v] || 0)); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="starter">Starter — R{LIST.starter}/mo</SelectItem>
                <SelectItem value="growth">Growth — R{LIST.growth}/mo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Amount (R, VAT-inclusive)</Label>
            <Input type="number" value={amount} onChange={function (e) { setAmount(e.target.value); }} />
          </div>
          <p className="text-xs text-muted-foreground">Due in 7 days. Emailed immediately, and moves this club to Awaiting Review — it does not activate them.</p>
          <Button
            className="w-full bg-emerald-600 hover:bg-emerald-700"
            disabled={busy || !(Number(amount) > 0)}
            onClick={function () { onSubmit(company, { package: pkg, amount, description }); }}
          >
            {busy ? 'Sending...' : 'Create & Send'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MarkPaidDialog({ invoice, onClose, onSubmit, busy }) {
  const [reference, setReference] = useState('');

  useEffect(function () { setReference(''); }, [invoice]);

  if (!invoice) return null;
  return (
    <Dialog open={!!invoice} onOpenChange={function (o) { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Mark {invoice.invoice_number} Paid</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Payment reference (optional)</Label>
            <Input value={reference} onChange={function (e) { setReference(e.target.value); }} placeholder="e.g. EFT ref, POP filename" />
          </div>
          <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={function () { onSubmit(invoice, reference); }}>
            {busy ? 'Saving...' : 'Mark Paid'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── BILLING REMINDERS TAB ───────────────────────────────────────────── */
/*
 * Paystack collection was switched off — clients now pay by EFT and get
 * invoiced manually. This tab is the manual/semi-automatic replacement:
 *
 *   - A daily pg_cron job (06:00 UTC / 08:00 SAST) calls the
 *     `send-billing-reminders` edge function for every active company whose
 *     next_payment_due has arrived or passed, reminder_enabled is true, and
 *     that hasn't already been reminded today.
 *   - This tab shows exactly that same list so you can see what the daily
 *     run will do (or already did) and to send on demand — either the
 *     whole due list at once, or one club at a time.
 *   - Toggling "Reminders" off per club (e.g. for someone you're already
 *     handling personally) writes through admin_update_company_billing(),
 *     same as every other billing field — reminder_enabled isn't writable
 *     by a plain table update either.
 *
 * Nothing here suspends or blocks anyone — it only sends an email.
 */
function BillingRemindersTab() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const SELECT_COLS = 'id, company_name, email, billing_email, monthly_fee, next_payment_due, status, reminder_enabled, last_reminder_sent_at';

  const load = useCallback(async function () {
    setLoading(true);
    try {
      const data = await fetchAllRows('companies', SELECT_COLS, { orderBy: 'next_payment_due' });
      setCompanies(data.filter(function (c) { return c.status === 'active'; }));
    } catch (err) {
      toast.error('Failed to load: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(function () { load(); }, [load]);

  const todayISO = new Date().toISOString().slice(0, 10);

  const withComputed = companies.map(function (c) {
    const hasFee = Number(c.monthly_fee) > 0;
    const dueDate = c.next_payment_due ? String(c.next_payment_due).slice(0, 10) : null;
    const isDue = hasFee && !!dueDate && dueDate <= todayISO;
    const daysOverdue = dueDate ? Math.round((new Date(todayISO) - new Date(dueDate)) / 86400000) : 0;
    const remindedToday = c.last_reminder_sent_at && String(c.last_reminder_sent_at).slice(0, 10) === todayISO;
    const recipient = c.billing_email || c.email;
    return Object.assign({}, c, { hasFee, dueDate, isDue, daysOverdue, remindedToday, recipient });
  });

  const dueList = withComputed.filter(function (c) { return c.isDue && c.reminder_enabled; });
  const visible = (showAll ? withComputed : dueList).filter(function (c) {
    return !search || (c.company_name || '').toLowerCase().indexOf(search.toLowerCase()) !== -1;
  }).sort(function (a, b) { return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1; });

  const totalDueAmount = dueList.reduce(function (sum, c) { return sum + Number(c.monthly_fee || 0); }, 0);
  const missingEmailCount = dueList.filter(function (c) { return !c.recipient; }).length;

  async function callSendFunction(companyIds) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await supabase.functions.invoke('send-billing-reminders', {
      body: { company_ids: companyIds },
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (res.error) throw new Error(res.error.message || 'Send failed');
    return res.data;
  }

  async function sendOne(c) {
    if (!c.recipient) { toast.error(c.company_name + ' has no billing email on file'); return; }
    setBusyId(c.id);
    try {
      const result = await callSendFunction([c.id]);
      if (result?.failed?.length) throw new Error(result.failed[0].error || 'Send failed');
      toast.success('Reminder sent to ' + c.company_name);
      await load();
    } catch (err) {
      toast.error('Failed to send: ' + err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function sendAllDue() {
    const targets = dueList.filter(function (c) { return c.recipient; });
    if (targets.length === 0) { toast.error('Nothing to send'); return; }
    if (!confirm('Send invoice reminders to ' + targets.length + ' club' + (targets.length === 1 ? '' : 's') + ' now?')) return;
    setSendingAll(true);
    try {
      const result = await callSendFunction(targets.map(function (c) { return c.id; }));
      const sentCount = result?.sent?.length || 0;
      const failedCount = result?.failed?.length || 0;
      toast.success(sentCount + ' sent' + (failedCount ? ', ' + failedCount + ' failed' : ''));
      await load();
    } catch (err) {
      toast.error('Send failed: ' + err.message);
    } finally {
      setSendingAll(false);
    }
  }

  async function toggleReminder(c) {
    setBusyId(c.id);
    try {
      await updateCompanyBilling(c.id, { p_reminder_enabled: !c.reminder_enabled });
      toast.success((c.reminder_enabled ? 'Reminders turned off for ' : 'Reminders turned on for ') + c.company_name);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mail className="w-4 h-4" />
          Daily reminder run happens automatically at 08:00 (Africa/Johannesburg). Paystack no longer auto-collects — this is manual EFT invoicing.
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={load} disabled={loading}>
          <RefreshCw className={"w-3.5 h-3.5" + (loading ? " animate-spin" : "")} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={AlertTriangle} label="Due Today or Overdue" value={dueList.length} color="yellow" subtitle="reminders enabled" />
        <StatCard icon={DollarSign}    label="Total Due"            value={'R' + totalDueAmount.toLocaleString()} color="green" />
        <StatCard icon={Mail}          label="Missing Billing Email" value={missingEmailCount} color={missingEmailCount > 0 ? "red" : "primary"} subtitle={missingEmailCount > 0 ? "can't be reminded" : "all covered"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder="Search clubs..." className="pl-10" />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={function () { setShowAll(!showAll); }}
            className={"px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors " + (showAll ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground border-border hover:bg-muted/30")}
          >
            {showAll ? 'Showing all active clubs' : 'Showing due only'}
          </button>
          <Button onClick={sendAllDue} disabled={sendingAll || dueList.length === 0} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <Send className="w-4 h-4" /> {sendingAll ? 'Sending...' : `Send All Due (${dueList.length})`}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading...</div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground bg-card border border-border rounded-xl">
          {showAll ? 'No active clubs match your search' : 'Nothing due right now 🎉'}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Club</th>
                <th className="px-4 py-3 text-left">Billing Email</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Due Date</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Last Reminder</th>
                <th className="px-4 py-3 text-center">Reminders</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map(function (c) {
                return (
                  <tr key={c.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{c.company_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.recipient || <span className="text-red-400">No email on file</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {c.hasFee ? 'R' + Number(c.monthly_fee).toLocaleString() : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.dueDate || '—'}</td>
                    <td className="px-4 py-3">
                      {!c.hasFee ? (
                        <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">No fee set</span>
                      ) : c.isDue ? (
                        <span className="text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-400">
                          {c.daysOverdue > 0 ? c.daysOverdue + 'd overdue' : 'Due today'}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-400">Not due yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {c.last_reminder_sent_at ? new Date(c.last_reminder_sent_at).toLocaleDateString('en-ZA') : 'Never'}
                      {c.remindedToday && <span className="ml-1 text-primary">(today)</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={c.reminder_enabled} onCheckedChange={function () { toggleReminder(c); }} disabled={busyId === c.id} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={function () { sendOne(c); }} disabled={busyId === c.id || !c.recipient || !c.hasFee}>
                        <Send className="w-3.5 h-3.5" /> {busyId === c.id ? 'Sending...' : 'Send Now'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── RESELLERS TAB ─── */
function ResellersTab() {
  const [subTab, setSubTab] = useState('resellers');
  const SUB_TABS = [
    { key: 'resellers',   label: 'Resellers',   icon: Users },
    { key: 'leads',       label: 'Leads',       icon: TrendingUp },
    { key: 'commissions', label: 'Commissions', icon: DollarSign },
    { key: 'training',    label: 'Training',    icon: GraduationCap },
  ];
  return (
    <div>
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${subTab === t.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>
      {subTab === 'resellers'   && <ResellersSubTab />}
      {subTab === 'leads'       && <LeadsSubTab />}
      {subTab === 'commissions' && <CommissionsSubTab />}
      {subTab === 'training'    && <TrainingSubTab />}
    </div>
  );
}

/* ─── TEMPLATE EDITOR DIALOG ─── */
function TemplateEditorDialog({ open, onClose, template, onSave }) {
  var [value, setValue] = useState(template);
  var [saving, setSaving] = useState(false);

  useEffect(function() { setValue(template); }, [template, open]);

  async function handleSave() {
    setSaving(true);
    try {
      var { error } = await supabase.from('app_settings')
        .upsert({ key: 'reseller_welcome_template', value: { template: value }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      toast.success('Template saved');
      onSave(value);
      onClose();
    } catch (err) {
      toast.error('Save failed: ' + err.message);
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={function(o) { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Edit Welcome Message Template
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 py-0.5 rounded">{'{first_name}'}</code> where you want the reseller's first name inserted. Edit links and text freely.
          </p>
          <Textarea
            value={value}
            onChange={function(e) { setValue(e.target.value); }}
            rows={16}
            className="font-mono text-xs resize-none"
            placeholder="Enter welcome message..."
          />
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Template'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── RESELLERS SUB TAB ─── */
function ResellersSubTab() {
  const [resellers, setResellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(true);

  // Load template from DB
  useEffect(function() {
    async function loadTemplate() {
      try {
        var { data, error } = await supabase.from('app_settings').select('value').eq('key', 'reseller_welcome_template').single();
        if (data && data.value && data.value.template) {
          setTemplate(data.value.template);
        }
      } catch (_) {
        // table may not exist yet, use default
      } finally { setTemplateLoading(false); }
    }
    loadTemplate();
  }, []);

  var load = useCallback(async function() {
    try {
      var data = await fetchAllRows('resellers', '*', { orderBy: 'created_at' });
      setResellers(data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(function() { load(); }, [load]);

  async function updateStatus(id, status) {
    try {
      var { error } = await supabase.from('resellers').update({ status }).eq('id', id);
      if (error) throw error;
      toast.success('Reseller ' + status);
      load(); setDetail(null);
    } catch (err) { toast.error(err.message); }
  }

  async function updateRate(id, rate) {
    try {
      var { error } = await supabase.from('resellers').update({ commission_rate: rate }).eq('id', id);
      if (error) throw error;
      toast.success('Commission rate updated'); load();
    } catch (err) { toast.error(err.message); }
  }

  async function bulkApprove() {
    if (selected.length === 0) { toast.error('Select at least one reseller'); return; }
    setBulkApproving(true);
    try {
      var { error } = await supabase.from('resellers').update({ status: 'approved' }).in('id', selected);
      if (error) throw error;
      toast.success(selected.length + ' reseller(s) approved');
      setSelected([]); load();
    } catch (err) { toast.error(err.message); } finally { setBulkApproving(false); }
  }

  function buildWelcomeMessage(reseller) {
    var firstName = (reseller.full_name || '').split(' ')[0];
    return template.replace(/\{first_name\}/g, firstName);
  }

  function formatPhone(phone) {
    if (!phone) return '';
    var digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) {
      digits = '27' + digits.slice(1);
    }
    return digits;
  }

  function openWhatsApp(reseller) {
    var phone = formatPhone(reseller.phone);
    if (!phone) { toast.error('No phone number for ' + reseller.full_name); return; }
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(buildWelcomeMessage(reseller)), '_blank');
  }

  function copyWelcomeMessage(reseller) {
    navigator.clipboard.writeText(buildWelcomeMessage(reseller));
    toast.success('Welcome message copied!');
  }

  function toggleSelect(id) {
    setSelected(function(prev) { return prev.includes(id) ? prev.filter(function(x) { return x !== id; }) : prev.concat(id); });
  }

  var pending = resellers.filter(function(r) { return r.status === 'pending'; });
  var filtered = resellers.filter(function(r) {
    return !search || r.full_name?.toLowerCase().includes(search.toLowerCase()) || r.email?.toLowerCase().includes(search.toLowerCase());
  });
  var sc = { pending: 'bg-amber-500/10 text-amber-400', approved: 'bg-green-500/10 text-green-400', suspended: 'bg-red-500/10 text-red-400', rejected: 'bg-muted text-muted-foreground' };

  return (
    <div>
      {/* Template editor button */}
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={function() { setShowTemplateEditor(true); }}>
          <Settings2 className="w-3.5 h-3.5" /> Edit Welcome Message Template
        </Button>
      </div>

      {pending.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-semibold text-amber-400 text-sm">{pending.length} reseller{pending.length > 1 ? 's' : ''} pending approval</p>
            <p className="text-xs text-muted-foreground mt-0.5">Select and bulk approve, or approve individually</p>
          </div>
          <div className="flex gap-2">
            <button onClick={function() { setSelected(pending.map(function(r) { return r.id; })); }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors">
              Select All Pending
            </button>
            {selected.length > 0 && (
              <button onClick={bulkApprove} disabled={bulkApproving}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50">
                {bulkApproving ? 'Approving...' : 'Approve ' + selected.length + ' Selected'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Search resellers..." className="pl-10" />
      </div>

      {loading ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Rate</th>
                <th className="px-4 py-3 text-left">Joined</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(function(r) {
                var isSelected = selected.includes(r.id);
                return (
                  <tr key={r.id} className={'hover:bg-muted/20 ' + (isSelected ? 'bg-green-500/5' : '')}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={isSelected} onChange={function() { toggleSelect(r.id); }} className="rounded border-border" />
                    </td>
                    <td className="px-4 py-3 font-medium">{r.full_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.email}</td>
                    <td className="px-4 py-3"><span className={'px-2 py-1 rounded-full text-xs font-medium ' + (sc[r.status] || sc.pending)}>{r.status}</span></td>
                    <td className="px-4 py-3">{r.commission_rate || 10}%</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(r.created_at).toLocaleDateString('en-ZA')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {r.status === 'pending' && (
                          <button onClick={function() { updateStatus(r.id, 'approved'); }}
                            className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded-md transition-colors">
                            Approve
                          </button>
                        )}
                        {r.status === 'approved' && r.phone && (
                          <button onClick={function() { openWhatsApp(r); }}
                            className="px-2 py-1 text-xs bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-md transition-colors">
                            💬 Welcome
                          </button>
                        )}
                        {r.status === 'approved' && !r.phone && (
                          <button onClick={function() { copyWelcomeMessage(r); }}
                            className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors">
                            📋 Copy Msg
                          </button>
                        )}
                        <Button variant="ghost" size="sm" onClick={function() { setDetail(r); }}><Eye className="w-4 h-4" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Reseller detail dialog */}
      <Dialog open={!!detail} onOpenChange={function() { setDetail(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{detail?.full_name}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Email:</span> <span>{detail.email}</span></div>
                <div><span className="text-muted-foreground">Phone:</span> <span>{detail.phone || '—'}</span></div>
                <div><span className="text-muted-foreground">Bank:</span> <span>{detail.bank_name || '—'}</span></div>
                <div><span className="text-muted-foreground">Account:</span> <span>{detail.bank_account_number || '—'}</span></div>
                <div><span className="text-muted-foreground">Branch:</span> <span>{detail.bank_branch_code || '—'}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <span className="capitalize">{detail.status}</span></div>
              </div>
              <div>
                <Label>Commission Rate (%)</Label>
                <div className="flex gap-2">
                  <Input type="number" defaultValue={detail.commission_rate || 10} min={0} max={100} id="rate-input" />
                  <Button size="sm" onClick={function() { updateRate(detail.id, Number(document.getElementById('rate-input').value)); }} className="bg-emerald-600 hover:bg-emerald-700">Set</Button>
                </div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground">Welcome Message Preview</p>
                  <button onClick={function() { setShowTemplateEditor(true); setDetail(null); }} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Settings2 className="w-3 h-3" /> Edit Template
                  </button>
                </div>
                <p className="text-xs text-foreground whitespace-pre-line">{buildWelcomeMessage(detail)}</p>
              </div>
              <div className="flex gap-2 flex-wrap pt-2">
                {detail.status !== 'approved' && <Button size="sm" onClick={function() { updateStatus(detail.id, 'approved'); }} className="bg-green-600 hover:bg-green-700"><CheckCircle className="w-4 h-4 mr-1" /> Approve</Button>}
                {detail.status === 'approved' && detail.phone && (
                  <Button size="sm" onClick={function() { openWhatsApp(detail); }} className="bg-[#25D366] hover:bg-[#20bd5a] text-white">💬 Send WhatsApp</Button>
                )}
                <Button size="sm" variant="outline" onClick={function() { copyWelcomeMessage(detail); }}>📋 Copy Message</Button>
                {detail.status !== 'suspended' && <Button size="sm" variant="destructive" onClick={function() { updateStatus(detail.id, 'suspended'); }}><XCircle className="w-4 h-4 mr-1" /> Suspend</Button>}
                {detail.status === 'pending' && <Button size="sm" variant="outline" onClick={function() { updateStatus(detail.id, 'rejected'); }}>Reject</Button>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Template editor */}
      <TemplateEditorDialog
        open={showTemplateEditor}
        onClose={function() { setShowTemplateEditor(false); }}
        template={template}
        onSave={setTemplate}
      />
    </div>
  );
}

function LeadsSubTab() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const load = useCallback(async () => {
    try {
      const data = await fetchAllRows('reseller_leads', '*, resellers(full_name)', { orderBy: 'created_at' });
      setLeads(data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const updateStatus = async (id, status) => {
    try { const { error } = await supabase.from('reseller_leads').update({ status }).eq('id', id); if (error) throw error; toast.success(`Lead marked as ${status}`); load(); } catch (err) { toast.error(err.message); }
  };
  const filtered = leads.filter(l => !search || l.business_name?.toLowerCase().includes(search.toLowerCase()));
  const sc = { new: 'bg-blue-500/10 text-blue-400', contacted: 'bg-purple-500/10 text-purple-400', negotiating: 'bg-amber-500/10 text-amber-400', converted: 'bg-green-500/10 text-green-400', lost: 'bg-muted text-muted-foreground' };
  return (
    <div>
      <div className="relative mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads..." className="pl-10" /></div>
      {loading ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide"><tr><th className="px-4 py-3 text-left">Business</th><th className="px-4 py-3 text-left">Contact</th><th className="px-4 py-3 text-left">Reseller</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3"></th></tr></thead>
            <tbody className="divide-y divide-border">{filtered.map(l => (
              <tr key={l.id} className="hover:bg-muted/20"><td className="px-4 py-3 font-medium">{l.business_name}</td><td className="px-4 py-3 text-muted-foreground">{l.contact_name}</td><td className="px-4 py-3 text-muted-foreground">{l.resellers?.full_name || '—'}</td><td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${sc[l.status]}`}>{l.status}</span></td><td className="px-4 py-3 text-muted-foreground">{new Date(l.created_at).toLocaleDateString('en-ZA')}</td>
              <td className="px-4 py-3"><select value={l.status} onChange={e => updateStatus(l.id, e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-card"><option value="new">New</option><option value="contacted">Contacted</option><option value="negotiating">Negotiating</option><option value="converted">Converted</option><option value="lost">Lost</option></select></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CommissionsSubTab() {
  const [comms, setComms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ reseller_id: '', amount: '', description: '' });
  const [resellers, setResellers] = useState([]);
  const load = useCallback(async () => {
    try {
      const data = await fetchAllRows('reseller_commissions', '*, resellers(full_name), reseller_leads(business_name)', { orderBy: 'created_at' });
      setComms(data);
      const { data: r } = await supabase.from('resellers').select('id, full_name').eq('status', 'approved');
      setResellers(r || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const updateStatus = async (id, status) => {
    const updates = { status }; if (status === 'paid') updates.paid_at = new Date().toISOString();
    try { const { error } = await supabase.from('reseller_commissions').update(updates).eq('id', id); if (error) throw error; toast.success(`Commission ${status}`); load(); } catch (err) { toast.error(err.message); }
  };
  const handleAdd = async () => {
    if (!form.reseller_id || !form.amount) { toast.error('Reseller and amount required'); return; }
    setSaving(true);
    try { const { error } = await supabase.from('reseller_commissions').insert({ reseller_id: form.reseller_id, amount: Number(form.amount), description: form.description, status: 'pending' }); if (error) throw error; toast.success('Commission added'); setShowAdd(false); load(); setForm({ reseller_id: '', amount: '', description: '' }); } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };
  const sc = { pending: 'bg-amber-500/10 text-amber-400', approved: 'bg-blue-500/10 text-blue-400', paid: 'bg-green-500/10 text-green-400' };
  return (
    <div>
      <div className="flex justify-end mb-4"><Button onClick={() => setShowAdd(true)} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="w-4 h-4 mr-2" /> Add Commission</Button></div>
      {loading ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide"><tr><th className="px-4 py-3 text-left">Reseller</th><th className="px-4 py-3 text-left">Description</th><th className="px-4 py-3 text-left">Lead</th><th className="px-4 py-3 text-left">Amount</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody className="divide-y divide-border">{comms.map(c => (
              <tr key={c.id} className="hover:bg-muted/20"><td className="px-4 py-3 font-medium">{c.resellers?.full_name}</td><td className="px-4 py-3 text-muted-foreground">{c.description || '—'}</td><td className="px-4 py-3 text-muted-foreground">{c.reseller_leads?.business_name || '—'}</td><td className="px-4 py-3 font-semibold">R{Number(c.amount).toLocaleString()}</td><td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${sc[c.status]}`}>{c.status}</span></td>
              <td className="px-4 py-3"><select value={c.status} onChange={e => updateStatus(c.id, e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-card"><option value="pending">Pending</option><option value="approved">Approved</option><option value="paid">Paid</option></select></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Add Commission</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Reseller *</Label><select value={form.reseller_id} onChange={e => setForm(p => ({ ...p, reseller_id: e.target.value }))} className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm"><option value="">Select</option>{resellers.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select></div>
            <div><Label>Amount (R) *</Label><Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. Signup commission for Green Gardens" /></div>
            <Button onClick={handleAdd} disabled={saving || !form.reseller_id || !form.amount} className="w-full bg-emerald-600 hover:bg-emerald-700">{saving ? 'Adding...' : 'Add Commission'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TrainingSubTab() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [courseForm, setCourseForm] = useState({ title: '', description: '' });
  const load = useCallback(async () => {
    try { const { data, error } = await supabase.from('reseller_courses').select('*').order('sort_order'); if (error) throw error; setCourses(data || []); } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const addCourse = async () => {
    if (!courseForm.title) { toast.error('Title required'); return; }
    setSaving(true);
    try { const { error } = await supabase.from('reseller_courses').insert({ ...courseForm, sort_order: courses.length, is_published: true }); if (error) throw error; toast.success('Course added'); setShowAdd(false); setCourseForm({ title: '', description: '' }); load(); } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };
  const deleteCourse = async (id) => {
    if (!confirm('Delete this course?')) return;
    try { const { error } = await supabase.from('reseller_courses').delete().eq('id', id); if (error) throw error; toast.success('Course deleted'); load(); } catch (err) { toast.error(err.message); }
  };
  return (
    <div>
      <div className="flex justify-end mb-4"><Button onClick={() => setShowAdd(true)} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="w-4 h-4 mr-2" /> Add Course</Button></div>
      {loading ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : courses.length === 0 ? <div className="py-8 text-center text-muted-foreground">No courses yet</div> : (
        <div className="space-y-3">{courses.map(c => (
          <div key={c.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
            <div className="flex-1">
              <h3 className="font-semibold">{c.title}</h3>
              {c.description && <p className="text-sm text-muted-foreground mt-1">{c.description}</p>}
              {c.video_url && <p className="text-xs text-blue-400 mt-1 truncate max-w-md">{c.video_url}</p>}
              <span className={`text-xs mt-2 inline-block px-2 py-0.5 rounded-full ${c.is_published ? 'bg-green-500/10 text-green-400' : 'bg-muted text-muted-foreground'}`}>{c.is_published ? 'Published' : 'Draft'}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => deleteCourse(c.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}</div>
      )}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent><DialogHeader><DialogTitle>Add Course / Lesson</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={courseForm.title} onChange={e => setCourseForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. How to close your first sale" /></div>
            <div><Label>Description</Label><Textarea value={courseForm.description} onChange={e => setCourseForm(p => ({ ...p, description: e.target.value }))} rows={2} /></div>
            <Button onClick={addCourse} disabled={saving || !courseForm.title} className="w-full bg-emerald-600 hover:bg-emerald-700">{saving ? 'Adding...' : 'Add Course'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── SUPPLIERS TAB ─── */
function SuppliersTab() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const load = useCallback(async () => {
    try { const data = await fetchAllRows('marketplace_suppliers', '*', { orderBy: 'created_at' }); setSuppliers(data); } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const toggleVerify = async (id, currentStatus) => {
    try { const { error } = await supabase.from('marketplace_suppliers').update({ is_verified: !currentStatus }).eq('id', id); if (error) throw error; toast.success(currentStatus ? 'Supplier unverified' : 'Supplier verified'); load(); if (detail && detail.id === id) setDetail(prev => ({ ...prev, is_verified: !currentStatus })); } catch (err) { toast.error(err.message); }
  };
  const deleteSupplier = async (id) => {
    if (!confirm('Delete this supplier and all their products?')) return;
    try { await supabase.from('marketplace_products').delete().eq('supplier_id', id); const { error } = await supabase.from('marketplace_suppliers').delete().eq('id', id); if (error) throw error; toast.success('Supplier deleted'); setDetail(null); load(); } catch (err) { toast.error(err.message); }
  };
  const loadProducts = async (supplierId) => {
    setLoadingProducts(true);
    try { const { data } = await supabase.from('marketplace_products').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: false }); setProducts(data || []); } catch (_) { setProducts([]); } finally { setLoadingProducts(false); }
  };
  const openDetail = (s) => { setDetail(s); loadProducts(s.id); };
  const filtered = suppliers.filter(s => !search || (s.business_name || '').toLowerCase().includes(search.toLowerCase()) || (s.email || '').toLowerCase().includes(search.toLowerCase()));
  const pendingCount = suppliers.filter(s => !s.is_verified).length;
  const verifiedCount = suppliers.filter(s => s.is_verified).length;
  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 flex gap-3 items-center"><div className="p-2 rounded-lg bg-primary/10"><Store className="w-5 h-5 text-primary" /></div><div><p className="text-2xl font-bold">{suppliers.length}</p><p className="text-xs text-muted-foreground">Total Suppliers</p></div></div>
        <div className="bg-card border border-border rounded-xl p-4 flex gap-3 items-center"><div className="p-2 rounded-lg bg-green-500/10"><ShieldCheck className="w-5 h-5 text-green-500" /></div><div><p className="text-2xl font-bold">{verifiedCount}</p><p className="text-xs text-muted-foreground">Verified</p></div></div>
        <div className="bg-card border border-border rounded-xl p-4 flex gap-3 items-center"><div className="p-2 rounded-lg bg-amber-500/10"><Clock className="w-5 h-5 text-amber-500" /></div><div><p className="text-2xl font-bold">{pendingCount}</p><p className="text-xs text-muted-foreground">Pending</p></div></div>
      </div>
      <div className="relative mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search suppliers..." className="pl-10" /></div>
      {loading ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : suppliers.length === 0 ? <div className="py-8 text-center text-muted-foreground">No suppliers registered yet</div> : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide"><tr><th className="px-4 py-3 text-left">Business</th><th className="px-4 py-3 text-left">Contact</th><th className="px-4 py-3 text-left">Email</th><th className="px-4 py-3 text-left">Location</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Joined</th><th className="px-4 py-3"></th></tr></thead>
            <tbody className="divide-y divide-border">{filtered.map(s => (
              <tr key={s.id} className="hover:bg-muted/20"><td className="px-4 py-3 font-medium">{s.business_name}</td><td className="px-4 py-3 text-muted-foreground">{s.contact_name || '—'}</td><td className="px-4 py-3 text-muted-foreground">{s.email}</td><td className="px-4 py-3 text-muted-foreground">{s.location || '—'}</td>
              <td className="px-4 py-3">{s.is_verified ? <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">Verified</span> : <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400">Pending</span>}</td>
              <td className="px-4 py-3 text-muted-foreground">{new Date(s.created_at).toLocaleDateString('en-ZA')}</td><td className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => openDetail(s)}><Eye className="w-4 h-4" /></Button></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{detail?.business_name}</DialogTitle></DialogHeader>
          {detail && <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-muted-foreground">Contact:</span> <span>{detail.contact_name || '—'}</span></div><div><span className="text-muted-foreground">Email:</span> <span>{detail.email}</span></div><div><span className="text-muted-foreground">Phone:</span> <span>{detail.phone || '—'}</span></div><div><span className="text-muted-foreground">WhatsApp:</span> <span>{detail.whatsapp || '—'}</span></div><div><span className="text-muted-foreground">Location:</span> <span>{detail.location || '—'}</span></div><div><span className="text-muted-foreground">Joined:</span> <span>{new Date(detail.created_at).toLocaleDateString('en-ZA')}</span></div></div>
            {detail.description && <div className="rounded-lg bg-muted/30 p-3"><span className="text-muted-foreground text-xs">About</span><p className="text-sm mt-1">{detail.description}</p></div>}
            <div className="flex gap-2">{detail.is_verified ? <Button size="sm" variant="outline" onClick={() => toggleVerify(detail.id, true)} className="gap-1"><ShieldX className="w-4 h-4" /> Unverify</Button> : <Button size="sm" onClick={() => toggleVerify(detail.id, false)} className="bg-green-600 hover:bg-green-700 gap-1"><ShieldCheck className="w-4 h-4" /> Verify Supplier</Button>}<Button size="sm" variant="destructive" onClick={() => deleteSupplier(detail.id)} className="gap-1"><Trash2 className="w-4 h-4" /> Delete</Button></div>
            <div><h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Package className="w-4 h-4" /> Products ({products.length})</h3>
              {loadingProducts ? <div className="py-4 text-center text-muted-foreground">Loading products...</div> : products.length === 0 ? <div className="py-4 text-center text-muted-foreground">No products listed yet</div> : (
                <div className="rounded-lg border border-border overflow-hidden"><table className="w-full text-sm"><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-center">MOQ</th><th className="px-3 py-2 text-center">Status</th></tr></thead>
                <tbody className="divide-y divide-border">{products.map(p => (<tr key={p.id} className="hover:bg-muted/20"><td className="px-3 py-2"><div className="flex items-center gap-2">{p.image_url ? <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 rounded bg-muted flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>}<div><p className="font-medium text-xs">{p.name}</p>{p.description && <p className="text-xs text-muted-foreground truncate max-w-[180px]">{p.description}</p>}</div></div></td><td className="px-3 py-2"><span className="px-1.5 py-0.5 bg-muted rounded text-xs capitalize">{(p.category || 'other').replace(/_/g, ' ')}</span></td><td className="px-3 py-2 text-right font-medium">R{Number(p.price).toFixed(2)}<span className="text-xs text-muted-foreground ml-0.5">/{p.unit}</span></td><td className="px-3 py-2 text-center text-muted-foreground">{p.min_order_qty}</td><td className="px-3 py-2 text-center">{p.is_active ? <span className="text-xs text-green-500">Listed</span> : <span className="text-xs text-muted-foreground">Hidden</span>}</td></tr>))}</tbody></table></div>
              )}
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
