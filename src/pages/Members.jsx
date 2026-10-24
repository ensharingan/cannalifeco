import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from '@/api/supabaseClient';
import { Plus, Search, Ban, Eye, Edit, QrCode, Wallet, ArrowDownLeft, ArrowUpRight, Upload, Trash2, Gift, Star, MapPin, CalendarClock, FileClock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../lib/currency";
import MemberForm, { EMPTY_FORM, initForm } from "../components/members/MemberForm";
import MemberCard from "../components/members/MemberCard";
import MemberCSVUpload from "../components/members/MemberCSVUpload";
import { useCompany } from "../lib/CompanyContext";

function generateMembershipId() {
  return "MEM-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
}

function getLoyaltySettings() {
  return {
    pointsPerUnit: Number(localStorage.getItem("loyalty_points_per_unit") || 1),
    minRedeem: Number(localStorage.getItem("loyalty_min_redeem") || 100),
    redeemValue: Number(localStorage.getItem("loyalty_redeem_value") || 0.10),
  };
}

// ── Draft rescue ────────────────────────────────────────────────────────────
// Capturing a member takes a few minutes and often involves a photo, an ID and
// a signature. Anything that unmounts this page mid-capture used to throw all
// of it away, so the in-progress form is mirrored to local storage.
var DRAFT_PREFIX = "cannalife_member_draft_v1";
var DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Fields the user actually types. Defaults like gender or nationality don't
// count as "started capturing", or an untouched form would look like a draft.
var DRAFT_CONTENT_FIELDS = [
  "first_name", "last_name", "email", "phone", "id_number", "address",
  "group_affiliation", "notes", "profile_image", "signature_image",
  "fica_id_document", "fica_proof_of_address", "fica_notes",
];

function draftKey(companyId) {
  return companyId ? DRAFT_PREFIX + ":" + companyId : null;
}

function formHasContent(form) {
  if (!form) return false;
  for (var i = 0; i < DRAFT_CONTENT_FIELDS.length; i++) {
    var v = form[DRAFT_CONTENT_FIELDS[i]];
    if (v && String(v).trim() !== "") return true;
  }
  return false;
}

function saveDraft(key, form) {
  if (!key) return;
  try {
    if (!formHasContent(form)) { window.localStorage.removeItem(key); return; }
    window.localStorage.setItem(key, JSON.stringify({ form: form, savedAt: Date.now() }));
  } catch (_) {}
}

function loadDraft(key) {
  if (!key) return null;
  try {
    var raw = window.localStorage.getItem(key);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !parsed.form) return null;
    if (!parsed.savedAt || (Date.now() - parsed.savedAt) > DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    if (!formHasContent(parsed.form)) return null;
    return parsed;
  } catch (_) { return null; }
}

function clearDraft(key) {
  if (!key) return;
  try { window.localStorage.removeItem(key); } catch (_) {}
}

function draftAgeLabel(savedAt) {
  var mins = Math.floor((Date.now() - savedAt) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  var hrs = Math.floor(mins / 60);
  return hrs + (hrs === 1 ? " hour ago" : " hours ago");
}

function calculateExpiryDate(startDate, duration, customDays) {
  if (!startDate) return null;
  var d = new Date(startDate);
  switch (duration) {
    case "6_months": d.setMonth(d.getMonth() + 6); break;
    case "1_year": d.setFullYear(d.getFullYear() + 1); break;
    case "2_years": d.setFullYear(d.getFullYear() + 2); break;
    case "lifetime": d.setFullYear(d.getFullYear() + 100); break;
    case "custom": d.setDate(d.getDate() + (customDays || 365)); break;
    default: d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split("T")[0];
}

function getMembershipStatus(expiryDate) {
  if (!expiryDate) return { label: "No expiry", color: "text-muted-foreground", expired: false };
  var now = new Date();
  var exp = new Date(expiryDate);
  var daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { label: "Expired " + Math.abs(daysLeft) + "d ago", color: "text-red-500", expired: true };
  if (daysLeft <= 30) return { label: daysLeft + "d left", color: "text-amber-500", expired: false };
  return { label: "Expires " + expiryDate, color: "text-muted-foreground", expired: false };
}

// Dynamic tier from thresholds
var TIER_DISPLAY = [
  { name: "Bronze",   icon: "🥉", color: "text-orange-500",  bg: "bg-orange-500/10" },
  { name: "Silver",   icon: "🥈", color: "text-slate-400",   bg: "bg-slate-400/10" },
  { name: "Gold",     icon: "🥇", color: "text-yellow-500",  bg: "bg-yellow-500/10" },
  { name: "Platinum", icon: "💎", color: "text-purple-500",  bg: "bg-purple-500/10" },
];

function getTierDisplay(points, thresholds) {
  var b = thresholds.bronze   ?? 0;
  var s = thresholds.silver   ?? 500;
  var g = thresholds.gold     ?? 1500;
  var p = thresholds.platinum ?? 5000;
  if (points >= p) return TIER_DISPLAY[3];
  if (points >= g) return TIER_DISPLAY[2];
  if (points >= s) return TIER_DISPLAY[1];
  return TIER_DISPLAY[0];
}

export default function Members() {
  var { companyId, activeStoreId } = useCompany();
  var [members, setMembers] = useState([]);
  var [loading, setLoading] = useState(true);
  var [searchTerm, setSearchTerm] = useState("");
  var [showForm, setShowForm] = useState(false);
  var [showUpload, setShowUpload] = useState(false);
  var [editMember, setEditMember] = useState(null);
  var [viewMember, setViewMember] = useState(null);
  var [creditTxns, setCreditTxns] = useState([]);
  var [loadingTxns, setLoadingTxns] = useState(false);
  var [isSaving, setIsSaving] = useState(false);
  var [filter, setFilter] = useState("all");
  var [showRegQR, setShowRegQR] = useState(false);
  var [deleteMember, setDeleteMember] = useState(null);
  var [deleteImpact, setDeleteImpact] = useState(null);
  var [isDeleting, setIsDeleting] = useState(false);
  var [showRedeem, setShowRedeem] = useState(false);
  var [redeemPoints, setRedeemPoints] = useState(0);
  var [isRedeeming, setIsRedeeming] = useState(false);
  var [storeSettings, setStoreSettings] = useState(null);
  var [thresholds, setThresholds] = useState({ bronze: 0, silver: 500, gold: 1500, platinum: 5000 });
  var [recoveredDraft, setRecoveredDraft] = useState(null);
  var registrationUrl = window.location.origin + "/#/register?company=" + companyId;

  // Cashiers don't get the self-registration QR next to Add Member. An unknown
  // role is treated as a cashier, which is the safer side of this fence.
  var [userRole, setUserRole] = useState(null);
  useEffect(function () {
    var cancelled = false;
    (async function () {
      try {
        var res = await supabase.rpc("get_my_profile");
        if (cancelled || res.error) return;
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if (row && row.role) setUserRole(row.role);
      } catch (err) { /* non-fatal */ }
    })();
    return function () { cancelled = true; };
  }, []);
  var canShowRegQR = ["owner", "admin", "manager", "superadmin"].indexOf(userRole) !== -1;

  var [newMemberForm, setNewMemberForm] = useState({ ...EMPTY_FORM });
  var [editMemberForm, setEditMemberForm] = useState({ ...EMPTY_FORM });

  // Only the very first load blanks the page. Later refreshes keep the current
  // view on screen — an early-return spinner closes any open dialog.
  var firstLoadDoneRef = useRef(false);
  var draftHydratedRef = useRef(null);

  var dKey = draftKey(companyId);

  // Pick up anything left behind by an interrupted capture.
  useEffect(function () {
    if (!dKey) return;
    if (draftHydratedRef.current === dKey) return;
    draftHydratedRef.current = dKey;
    var stored = loadDraft(dKey);
    if (!stored) return;
    setNewMemberForm(stored.form);
    setRecoveredDraft({ savedAt: stored.savedAt, name: ((stored.form.first_name || "") + " " + (stored.form.last_name || "")).trim() });
  }, [dKey]);

  // Mirror the in-progress capture as it is typed.
  useEffect(function () {
    if (!dKey) return;
    if (draftHydratedRef.current !== dKey) return;
    saveDraft(dKey, newMemberForm);
  }, [newMemberForm, dKey]);

  // Load thresholds from DB
  useEffect(function() {
    if (!companyId) return;
    supabase
      .from("companies")
      .select("loyalty_bronze, loyalty_silver, loyalty_gold, loyalty_platinum")
      .eq("id", companyId)
      .maybeSingle()
      .then(function({ data }) {
        if (data) {
          setThresholds({
            bronze:   data.loyalty_bronze   ?? 0,
            silver:   data.loyalty_silver   ?? 500,
            gold:     data.loyalty_gold     ?? 1500,
            platinum: data.loyalty_platinum ?? 5000,
          });
        }
      });
  }, [companyId]);

  useEffect(function () {
    if (!activeStoreId || !companyId) return;
    supabase.from("store_settings").select("*").eq("store_id", activeStoreId).maybeSingle()
      .then(function (res) { if (res.data) setStoreSettings(res.data); })
      .catch(function () { setStoreSettings(null); });
  }, [activeStoreId, companyId]);

  var loadMembers = useCallback(async function () {
    if (!companyId) return;
    if (!firstLoadDoneRef.current) setLoading(true);
    try {
      var pageSize = 1000;
      var page = 0;
      var allMembers = [];
      while (true) {
        var res = await supabase
          .from("members")
          .select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (res.error) throw res.error;
        if (!res.data || res.data.length === 0) break;
        allMembers = allMembers.concat(res.data);
        if (res.data.length < pageSize) break;
        page++;
      }
      setMembers(allMembers);
    } catch (err) {
      toast.error("Failed to load members");
      setMembers([]);
    } finally {
      firstLoadDoneRef.current = true;
      setLoading(false);
    }
  }, [companyId]);

  useEffect(function () { loadMembers(); }, [loadMembers]);

  var loadCreditTxns = async function (memberId) {
    setLoadingTxns(true);
    try {
      var res = await supabase
        .from("store_credit_transactions")
        .select("*")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (res.error) throw res.error;
      setCreditTxns(res.data || []);
    } catch (_) {
      setCreditTxns([]);
    } finally {
      setLoadingTxns(false);
    }
  };

  var handleViewMember = function (m) {
    setViewMember(m);
    setCreditTxns([]);
    loadCreditTxns(m.id);
  };

  var resumeDraft = function () {
    setRecoveredDraft(null);
    setShowForm(true);
  };

  var discardDraft = function () {
    clearDraft(dKey);
    setNewMemberForm({ ...EMPTY_FORM });
    setRecoveredDraft(null);
    toast.info("Draft discarded");
  };

  var handleCreate = async function (data) {
    setIsSaving(true);
    try {
      var membershipId = generateMembershipId();
      var memberPortalUrl = window.location.origin + "/#/member-portal/" + companyId + "?member=" + membershipId;
      var qrData = encodeURIComponent(memberPortalUrl);
      var qrCode = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + qrData;
      var duration = storeSettings ? (storeSettings.membership_duration || "1_year") : "1_year";
      var customDays = storeSettings ? (storeSettings.membership_duration_days || 365) : 365;
      var startDate = data.membership_start_date || new Date().toISOString().split("T")[0];
      var expiryDate = calculateExpiryDate(startDate, duration, customDays);
      // If the member signed in-store, the signature flow already set a future expiry — keep the later one.
      if (data.expiry_date && (!expiryDate || new Date(data.expiry_date) > new Date(expiryDate))) {
        expiryDate = data.expiry_date;
      }
      var res = await supabase.from("members").insert({
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email || null,
        phone: data.phone || null,
        gender: data.gender || null,
        id_type: data.id_type || null,
        id_number: data.id_number || null,
        nationality: data.nationality || null,
        address: data.address || null,
        membership_type: data.membership_type || "bronze",
        home_store_id: data.home_store_id || null,
        group_affiliation: data.group_affiliation || null,
        notes: data.notes || null,
        profile_image: data.profile_image || null,
        signature_image: data.signature_image || null,
        membership_start_date: startDate,
        expiry_date: expiryDate,
        company_id: companyId,
        membership_id: membershipId,
        qr_code: qrCode,
        is_active: true,
        is_banned: false,
        registration_status: "approved",
        loyalty_points: 0,
        total_spend: 0,
        visit_count: 0,
        store_credit: 0,
      }).select().single();
      if (res.error) throw res.error;

      // Link the audit signature row to the newly created member, if one was captured
      if (data.signature_image && res.data && res.data.id) {
        try {
          await supabase
            .from("member_contract_signatures")
            .update({ member_id: res.data.id })
            .eq("company_id", companyId)
            .is("member_id", null)
            .eq("signature_image", data.signature_image);
        } catch (e) { /* non-fatal */ }
      }

      toast.success("Member created — expires " + (expiryDate || "never"));
      setShowForm(false);
      clearDraft(dKey);
      setRecoveredDraft(null);
      setNewMemberForm({ ...EMPTY_FORM });
      loadMembers();
    } catch (err) {
      // The draft stays put, so a failed save never costs the capture.
      toast.error("Failed to create member: " + (err && err.message ? err.message : "Unknown error"));
    } finally {
      setIsSaving(false);
    }
  };

  var handleUpdate = async function (data) {
    setIsSaving(true);
    try {
      var updateData = {
        first_name: data.first_name,
        last_name: data.last_name,
        id_type: data.id_type || null,
        id_number: data.id_number || null,
        email: data.email || null,
        phone: data.phone || null,
        gender: data.gender || null,
        membership_start_date: data.membership_start_date || null,
        nationality: data.nationality || null,
        membership_type: data.membership_type || "bronze",
        home_store_id: data.home_store_id || null,
        group_affiliation: data.group_affiliation || null,
        address: data.address || null,
        notes: data.notes || null,
        profile_image: data.profile_image || null,
      };
      // Persist a newly captured signature and the expiry it produced
      if (data.signature_image) {
        updateData.signature_image = data.signature_image;
      }
      if (data.membership_start_date && data.membership_start_date !== editMember.membership_start_date) {
        var duration = storeSettings ? (storeSettings.membership_duration || "1_year") : "1_year";
        var customDays = storeSettings ? (storeSettings.membership_duration_days || 365) : 365;
        updateData.expiry_date = calculateExpiryDate(data.membership_start_date, duration, customDays);
      }
      // Signature renewal expiry wins if it's later
      if (data.expiry_date && (!updateData.expiry_date || new Date(data.expiry_date) > new Date(updateData.expiry_date))) {
        updateData.expiry_date = data.expiry_date;
      }
      var res = await supabase.from("members").update(updateData).eq("id", editMember.id);
      if (res.error) throw res.error;
      toast.success("Member updated");
      setEditMember(null);
      setEditMemberForm({ ...EMPTY_FORM });
      loadMembers();
    } catch (err) {
      toast.error("Failed to update member: " + (err && err.message ? err.message : "Unknown error"));
    } finally {
      setIsSaving(false);
    }
  };

  /*
   * ─── DELETE ───────────────────────────────────────────────────────────
   * The previous version deleted store_credit_transactions and
   * member_activities from the browser, THEN tried to delete the member.
   *
   * Two things were wrong with that:
   *
   * 1. It missed four other tables that reference members with NO ACTION —
   *    orders, refunds, vouchers and voucher_redemptions — so any member who
   *    had ever bought anything hit a 409 Conflict and could never be deleted.
   *
   * 2. Because the children were deleted first and there is no transaction
   *    across separate PostgREST calls, a failed member delete left the credit
   *    history and activity log already destroyed, with the member still
   *    present. Every failed attempt silently ate data.
   *
   * It now goes through delete_member_and_data(), which runs the whole thing
   * in one transaction: orders and refunds are DETACHED (member_id -> NULL) so
   * the sales survive as anonymous walk-ins, personal records are deleted, and
   * if anything fails the entire operation rolls back.
   */
  var openDeleteDialog = async function (m) {
    setDeleteMember(m);
    setDeleteImpact(null);
    try {
      var results = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("member_id", m.id),
        supabase.from("vouchers").select("id", { count: "exact", head: true }).eq("member_id", m.id),
        supabase.from("store_credit_transactions").select("id", { count: "exact", head: true }).eq("member_id", m.id),
      ]);
      setDeleteImpact({
        orders: results[0].count || 0,
        vouchers: results[1].count || 0,
        credits: results[2].count || 0,
      });
    } catch (_) {
      setDeleteImpact(null);
    }
  };

  var handleDelete = async function () {
    if (!deleteMember) return;
    setIsDeleting(true);
    try {
      var res = await supabase.rpc("delete_member_and_data", { p_member_id: deleteMember.id });
      if (res.error) throw res.error;

      var r = res.data || {};
      var name = deleteMember.first_name + " " + deleteMember.last_name;
      var detached = Number(r.orders_detached || 0);
      toast.success(
        name + " deleted" +
        (detached > 0 ? " — " + detached + " order" + (detached === 1 ? "" : "s") + " kept as anonymous sales" : "")
      );

      setDeleteMember(null);
      setDeleteImpact(null);
      loadMembers();
    } catch (err) {
      toast.error("Failed to delete member: " + (err && err.message ? err.message : "Unknown error"));
    } finally {
      setIsDeleting(false);
    }
  };

  var toggleBan = async function (member) {
    try {
      var res = await supabase.from("members").update({ is_banned: !member.is_banned }).eq("id", member.id);
      if (res.error) throw res.error;
      toast.success(member.is_banned ? "Member unbanned" : "Member banned");
      loadMembers();
    } catch (err) {
      toast.error("Failed: " + (err && err.message ? err.message : "Unknown error"));
    }
  };

  var openEdit = function (m) {
    setEditMember(m);
    setEditMemberForm(initForm(m));
  };

  var openRedeem = function () {
    var settings = getLoyaltySettings();
    setRedeemPoints(settings.minRedeem);
    setShowRedeem(true);
  };

  var handleRedeem = async function () {
    if (!viewMember || redeemPoints <= 0) return;
    var settings = getLoyaltySettings();
    var memberPoints = viewMember.loyalty_points || 0;
    if (redeemPoints < settings.minRedeem) { toast.error("Minimum redemption is " + settings.minRedeem + " points"); return; }
    if (redeemPoints > memberPoints) { toast.error("Not enough points. Available: " + memberPoints); return; }
    var creditAmount = redeemPoints * settings.redeemValue;
    var newPoints = memberPoints - redeemPoints;
    var newCredit = (viewMember.store_credit || 0) + creditAmount;
    setIsRedeeming(true);
    try {
      var res = await supabase.from("members").update({ loyalty_points: newPoints, store_credit: newCredit }).eq("id", viewMember.id);
      if (res.error) throw res.error;
      await supabase.from("store_credit_transactions").insert({
        company_id: companyId, member_id: viewMember.id, amount: creditAmount, type: "loyalty_redemption",
        note: "Redeemed " + redeemPoints + " loyalty points → " + formatCurrency(creditAmount) + " store credit",
      });
      await supabase.from("member_activities").insert({
        company_id: companyId, member_id: viewMember.id,
        member_name: viewMember.first_name + " " + viewMember.last_name,
        visit_date: new Date().toISOString(), spend_amount: 0, visit_type: "consultation",
        notes: "Redeemed " + redeemPoints + " pts → " + formatCurrency(creditAmount) + " credit",
      });
      setViewMember(function (prev) { return { ...prev, loyalty_points: newPoints, store_credit: newCredit }; });
      toast.success(redeemPoints + " points redeemed → " + formatCurrency(creditAmount) + " added to wallet");
      setShowRedeem(false);
      loadCreditTxns(viewMember.id);
      loadMembers();
    } catch (err) {
      toast.error("Failed to redeem: " + (err && err.message ? err.message : "Unknown error"));
    } finally {
      setIsRedeeming(false);
    }
  };

  var filtered = (members || []).filter(function (m) {
    var text = (m.first_name || "") + " " + (m.last_name || "") + " " + (m.membership_id || "") + " " + (m.email || "") + " " + (m.phone || "") + " " + (m.id_number || "");
    var matchSearch = text.toLowerCase().indexOf(searchTerm.toLowerCase()) >= 0;
    if (filter === "active") return matchSearch && m.is_active && !m.is_banned;
    if (filter === "banned") return matchSearch && m.is_banned;
    if (filter === "inactive") return matchSearch && !m.is_active;
    if (filter === "expired") { var status = getMembershipStatus(m.expiry_date); return matchSearch && status.expired; }
    return matchSearch;
  });

  if (loading && !firstLoadDoneRef.current) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  var loyaltySettings = getLoyaltySettings();
  var expiredCount = members.filter(function (m) { return getMembershipStatus(m.expiry_date).expired; }).length;

  return (
    <div className="p-4 lg:p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Members</h1>
          <p className="text-sm text-muted-foreground">
            {members.length} total members
            {expiredCount > 0 && <span className="text-red-500 ml-2">· {expiredCount} expired</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {canShowRegQR && (
            <Button variant="outline" onClick={function () { setShowRegQR(true); }} className="gap-2">
              <QrCode className="w-4 h-4" /> Registration QR
            </Button>
          )}
          {canShowRegQR && (
            <Button variant="outline" onClick={function () { setShowUpload(true); }} className="gap-2">
              <Upload className="w-4 h-4" /> Import CSV
            </Button>
          )}
          {canShowRegQR && (
            <Button onClick={function () { setShowForm(true); }} className="gap-2">
              <Plus className="w-4 h-4" /> Add Member
            </Button>
          )}
        </div>
      </div>

      {/* Unfinished capture found on this device */}
      {recoveredDraft && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <FileClock className="w-5 h-5 text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Unfinished member capture{recoveredDraft.name ? " — " + recoveredDraft.name : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Saved {draftAgeLabel(recoveredDraft.savedAt)}. Nothing was lost — pick up where you left off.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={discardDraft}>Discard</Button>
            <Button size="sm" onClick={resumeDraft}>Continue capture</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search members..." value={searchTerm} onChange={function (e) { setSearchTerm(e.target.value); }} className="pl-10" />
        </div>
        <div className="flex gap-2">
          {["all", "active", "inactive", "banned", "expired"].map(function (f) {
            return (
              <button key={f} onClick={function () { setFilter(f); }}
                className={cn("px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all",
                  filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >{f}{f === "expired" && expiredCount > 0 ? " (" + expiredCount + ")" : ""}</button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Member</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden sm:table-cell">ID</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Type</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Spend</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Credit</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function (m) {
                var memStatus = getMembershipStatus(m.expiry_date);
                var tier = getTierDisplay(m.loyalty_points || 0, thresholds);
                return (
                  <tr key={m.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                          {m.first_name ? m.first_name[0] : ""}{m.last_name ? m.last_name[0] : ""}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{m.first_name} {m.last_name}</p>
                          <p className="text-xs text-muted-foreground">{m.email || m.phone || ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell font-mono text-xs">{m.membership_id}</td>
                    <td className="p-3 hidden md:table-cell">
                      <span className="text-xs capitalize bg-muted px-2 py-1 rounded-full">{m.membership_type}</span>
                    </td>
                    <td className="p-3 text-sm font-medium hidden lg:table-cell">{formatCurrency(m.total_spend || 0)}</td>
                    <td className="p-3 hidden lg:table-cell">
                      {(m.store_credit || 0) > 0 ? (
                        <span className="text-xs font-semibold text-green-500">💳 {formatCurrency(m.store_credit)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="space-y-0.5">
                        <span className={cn("text-xs px-2 py-1 rounded-full border font-medium",
                          m.is_banned ? "bg-red-500/10 text-red-500 border-red-500/20"
                            : m.is_active ? "bg-green-500/10 text-green-500 border-green-500/20"
                            : "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                        )}>
                          {m.is_banned ? "Banned" : m.is_active ? "Active" : "Inactive"}
                        </span>
                        {memStatus.expired && (
                          <p className="text-[10px] text-red-500 font-medium">{memStatus.label}</p>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={function () { handleViewMember(m); }}><Eye className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={function () { openEdit(m); }}><Edit className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={function () { toggleBan(m); }}><Ban className={cn("w-4 h-4", m.is_banned && "text-red-500")} /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={function () { openDeleteDialog(m); }}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <p className="text-sm text-muted-foreground text-center py-12">No members found</p>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deleteMember} onOpenChange={function () { setDeleteMember(null); setDeleteImpact(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Member</DialogTitle></DialogHeader>
          {deleteMember && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Permanently delete{" "}
                <span className="font-semibold text-foreground">{deleteMember.first_name} {deleteMember.last_name}</span>?
                Their personal details, loyalty points, store credit and activity history will be removed. This cannot be undone.
              </p>

              <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
                <p><span className="text-muted-foreground">ID:</span> {deleteMember.membership_id}</p>
                <p><span className="text-muted-foreground">Phone:</span> {deleteMember.phone || "N/A"}</p>
                <p><span className="text-muted-foreground">Total Spend:</span> {formatCurrency(deleteMember.total_spend || 0)}</p>
              </div>

              {deleteImpact && (deleteImpact.orders > 0 || deleteImpact.vouchers > 0 || deleteImpact.credits > 0) && (
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs space-y-1">
                  <p className="font-medium text-blue-600 dark:text-blue-400">What happens to their records</p>
                  {deleteImpact.orders > 0 && (
                    <p className="text-muted-foreground">
                      · <span className="text-foreground font-medium">{deleteImpact.orders} order{deleteImpact.orders === 1 ? "" : "s"}</span> stay on your books as anonymous sales — your totals won't change
                    </p>
                  )}
                  {deleteImpact.credits > 0 && (
                    <p className="text-muted-foreground">· {deleteImpact.credits} credit transaction{deleteImpact.credits === 1 ? "" : "s"} removed</p>
                  )}
                  {deleteImpact.vouchers > 0 && (
                    <p className="text-muted-foreground">· {deleteImpact.vouchers} voucher{deleteImpact.vouchers === 1 ? "" : "s"} removed</p>
                  )}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={function () { setDeleteMember(null); setDeleteImpact(null); }} disabled={isDeleting}>Cancel</Button>
                <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? "Deleting..." : "Delete Member"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Registration QR */}
      <Dialog open={showRegQR} onOpenChange={setShowRegQR}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Member Registration QR Code</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <p className="text-sm text-muted-foreground text-center">Members scan this QR code to self-register.</p>
            <img src={"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=" + encodeURIComponent(registrationUrl)} alt="Registration QR Code" className="rounded-lg border border-border" />
            <p className="text-xs text-muted-foreground font-mono break-all text-center">{registrationUrl}</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* CSV Upload */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Import Members from CSV</DialogTitle></DialogHeader>
          <MemberCSVUpload onComplete={function () { setShowUpload(false); loadMembers(); }} />
        </DialogContent>
      </Dialog>

      {/* Create */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Member</DialogTitle></DialogHeader>
          {formHasContent(newMemberForm) && (
            <p className="text-[11px] text-muted-foreground -mt-2">
              Saved as you type on this device — closing this window won't lose it.
            </p>
          )}
          <MemberForm form={newMemberForm} setForm={setNewMemberForm} onSave={handleCreate} onCancel={function () { setShowForm(false); }} isSaving={isSaving} companyId={companyId} />
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editMember} onOpenChange={function () { setEditMember(null); setEditMemberForm({ ...EMPTY_FORM }); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Member</DialogTitle></DialogHeader>
          {editMember && (
            <MemberForm member={editMember} form={editMemberForm} setForm={setEditMemberForm} onSave={handleUpdate} onCancel={function () { setEditMember(null); setEditMemberForm({ ...EMPTY_FORM }); }} isSaving={isSaving} companyId={companyId} />
          )}
        </DialogContent>
      </Dialog>

      {/* View Member Profile */}
      <Dialog open={!!viewMember} onOpenChange={function () { setViewMember(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Member Profile</DialogTitle></DialogHeader>
          {viewMember && (function() {
            var tier = getTierDisplay(viewMember.loyalty_points || 0, thresholds);
            var memStatus = getMembershipStatus(viewMember.expiry_date);
            return (
              <div className="space-y-4">
                <MemberCard member={viewMember} />

                {/* Membership dates */}
                <div className={cn("rounded-xl border p-4 flex items-center gap-3",
                  memStatus.expired ? "border-red-500/30 bg-red-500/5" : "border-border bg-muted/20"
                )}>
                  <CalendarClock className={cn("w-5 h-5 shrink-0", memStatus.expired ? "text-red-500" : "text-primary")} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Membership Period</p>
                      <span className={cn("text-xs font-semibold", memStatus.color)}>{memStatus.label}</span>
                    </div>
                    <p className="text-sm font-medium mt-0.5">
                      {viewMember.membership_start_date || "N/A"} → {viewMember.expiry_date || "No expiry"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground text-xs">Email</span><p className="font-medium truncate">{viewMember.email || "N/A"}</p></div>
                  <div><span className="text-muted-foreground text-xs">Phone</span><p className="font-medium">{viewMember.phone || "N/A"}</p></div>
                  <div><span className="text-muted-foreground text-xs">ID Number</span><p className="font-medium font-mono">{viewMember.id_number ? viewMember.id_number.substring(0, 4) + " **** " + viewMember.id_number.substring(10) : "N/A"}</p></div>
                  <div><span className="text-muted-foreground text-xs">Gender</span><p className="font-medium capitalize">{viewMember.gender || "N/A"}</p></div>
                  <div><span className="text-muted-foreground text-xs">Nationality</span><p className="font-medium">{viewMember.nationality || "N/A"}</p></div>
                  <div>
                    <span className="text-muted-foreground text-xs">Loyalty Tier</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", tier.bg, tier.color)}>
                        {tier.icon} {tier.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{(viewMember.loyalty_points || 0).toLocaleString()} pts</span>
                    </div>
                  </div>
                  <div><span className="text-muted-foreground text-xs">Total Spend</span><p className="font-medium">{formatCurrency(viewMember.total_spend || 0)}</p></div>
                  <div><span className="text-muted-foreground text-xs">Visits</span><p className="font-medium">{viewMember.visit_count || 0}</p></div>
                  <div><span className="text-muted-foreground text-xs">Type</span><p className="font-medium capitalize">{viewMember.membership_type || "bronze"}</p></div>
                  <div><span className="text-muted-foreground text-xs">Group</span><p className="font-medium">{viewMember.group_affiliation || "N/A"}</p></div>
                </div>

                {viewMember.signature_image && (
                  <div className="rounded-lg bg-muted/30 p-3">
                    <span className="text-muted-foreground text-xs">Signature on file</span>
                    <img src={viewMember.signature_image} alt="Signature" className="h-16 mt-1 bg-white rounded border border-border p-1" />
                  </div>
                )}

                {viewMember.address && (
                  <div className="rounded-lg bg-muted/30 p-3 flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <span className="text-muted-foreground text-xs">Address</span>
                      <p className="text-sm font-medium">{viewMember.address}</p>
                    </div>
                  </div>
                )}

                {viewMember.notes && (
                  <div className="rounded-lg bg-muted/30 p-3">
                    <span className="text-muted-foreground text-xs">Notes</span>
                    <p className="text-sm">{viewMember.notes}</p>
                  </div>
                )}

                {/* Loyalty → Wallet Redemption */}
                {(viewMember.loyalty_points || 0) >= loyaltySettings.minRedeem && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Star className="w-4 h-4 text-primary" />
                        <div>
                          <p className="text-xs text-muted-foreground">Loyalty Points</p>
                          <p className="text-lg font-bold text-primary">{(viewMember.loyalty_points || 0).toLocaleString()} pts</p>
                        </div>
                      </div>
                      <Button size="sm" className="gap-1.5" onClick={openRedeem}>
                        <Gift className="w-3.5 h-3.5" /> Redeem to Wallet
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {loyaltySettings.minRedeem} pts minimum · {(1 / loyaltySettings.redeemValue).toFixed(0)} pts = {formatCurrency(1)}
                    </p>
                  </div>
                )}

                {(viewMember.loyalty_points || 0) > 0 && (viewMember.loyalty_points || 0) < loyaltySettings.minRedeem && (
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-2">
                      <Star className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Loyalty Points</p>
                        <p className="text-lg font-bold">{(viewMember.loyalty_points || 0).toLocaleString()} pts</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {loyaltySettings.minRedeem - (viewMember.loyalty_points || 0)} more points needed to redeem (min {loyaltySettings.minRedeem})
                    </p>
                  </div>
                )}

                {/* Store Credit Wallet */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center gap-3 p-4 bg-green-500/5 border-b border-border">
                    <div className="p-2 bg-green-500/10 rounded-lg">
                      <Wallet className="w-4 h-4 text-green-500" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground">Store Credit Balance</p>
                      <p className="text-xl font-bold text-green-500">{formatCurrency(viewMember.store_credit || 0)}</p>
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Transaction History</p>
                    {loadingTxns ? (
                      <div className="flex justify-center py-4">
                        <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                      </div>
                    ) : creditTxns.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No transactions yet</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {creditTxns.map(function (tx) {
                          var isCredit = tx.amount > 0;
                          return (
                            <div key={tx.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50">
                              <div className={cn("p-1.5 rounded-full shrink-0", isCredit ? "bg-green-500/10" : "bg-red-500/10")}>
                                {isCredit ? <ArrowDownLeft className="w-3 h-3 text-green-500" /> : <ArrowUpRight className="w-3 h-3 text-red-500" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{tx.note || tx.type}</p>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(tx.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                                </p>
                              </div>
                              <span className={cn("text-xs font-bold shrink-0", isCredit ? "text-green-500" : "text-red-500")}>
                                {isCredit ? "+" : ""}{formatCurrency(tx.amount)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Redeem Points Dialog */}
      <Dialog open={showRedeem} onOpenChange={setShowRedeem}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Redeem Points to Wallet</DialogTitle></DialogHeader>
          {viewMember && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium">{viewMember.first_name} {viewMember.last_name}</p>
                <p className="text-muted-foreground">Available: <span className="font-bold text-primary">{(viewMember.loyalty_points || 0).toLocaleString()} pts</span></p>
              </div>
              <div>
                <label className="text-sm font-medium">Points to redeem</label>
                <Input type="number" min={loyaltySettings.minRedeem} max={viewMember.loyalty_points || 0} value={redeemPoints} onChange={function (e) { setRedeemPoints(Number(e.target.value)); }} />
                <p className="text-xs text-muted-foreground mt-1">Min: {loyaltySettings.minRedeem} pts · Max: {(viewMember.loyalty_points || 0).toLocaleString()} pts</p>
              </div>
              <div className="p-3 bg-green-500/5 border border-green-500/20 rounded-lg">
                <p className="text-xs text-muted-foreground">Credit to add</p>
                <p className="text-xl font-bold text-green-500">{formatCurrency(redeemPoints * loyaltySettings.redeemValue)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Current wallet: {formatCurrency(viewMember.store_credit || 0)} → New: {formatCurrency((viewMember.store_credit || 0) + redeemPoints * loyaltySettings.redeemValue)}
                </p>
              </div>
              <Button onClick={handleRedeem} disabled={isRedeeming || redeemPoints < loyaltySettings.minRedeem || redeemPoints > (viewMember.loyalty_points || 0)} className="w-full gap-2">
                <Gift className="w-4 h-4" />
                {isRedeeming ? "Processing..." : "Redeem " + redeemPoints + " pts → " + formatCurrency(redeemPoints * loyaltySettings.redeemValue)}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
