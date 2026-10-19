import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import {
  Star, Gift, Award, Search, ChevronUp, Plus, Edit, Trash2, Settings, Users, Sparkles, Zap,
  TrendingUp, RotateCcw, Calendar,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";
import { CURRENCIES } from "../lib/currency";

// Static tier style config — only colours/icons, no thresholds
const TIER_STYLES = [
  { key: "bronze",   name: "Bronze",   color: "text-orange-600", bg: "bg-orange-100",  icon: "🥉" },
  { key: "silver",   name: "Silver",   color: "text-slate-500",  bg: "bg-slate-100",   icon: "🥈" },
  { key: "gold",     name: "Gold",     color: "text-yellow-500", bg: "bg-yellow-100",  icon: "🥇" },
  { key: "platinum", name: "Platinum", color: "text-purple-600", bg: "bg-purple-100",  icon: "💎" },
];

// Build dynamic tiers from saved thresholds
function buildTiers(thresholds) {
  var b = thresholds.bronze   ?? 0;
  var s = thresholds.silver   ?? 500;
  var g = thresholds.gold     ?? 1500;
  var p = thresholds.platinum ?? 5000;
  return [
    { ...TIER_STYLES[0], min: b, max: s - 1 },
    { ...TIER_STYLES[1], min: s, max: g - 1 },
    { ...TIER_STYLES[2], min: g, max: p - 1 },
    { ...TIER_STYLES[3], min: p, max: Infinity },
  ];
}

function getTierFromThresholds(points, thresholds) {
  var tiers = buildTiers(thresholds);
  return tiers.find(t => points >= t.min && points <= t.max) || tiers[0];
}

function TierBadge({ points, thresholds }) {
  var tier = getTierFromThresholds(points, thresholds || {});
  return (
    <span className={cn("text-xs px-2 py-1 rounded-full font-semibold", tier.bg, tier.color)}>
      {tier.icon} {tier.name}
    </span>
  );
}

// Anniversary helpers
function getNextAnniversary(createdAt) {
  if (!createdAt) return null;
  var signup = new Date(createdAt);
  var now = new Date();
  var next = new Date(now.getFullYear(), signup.getMonth(), signup.getDate());
  if (next <= now) next.setFullYear(next.getFullYear() + 1);
  return next;
}

function formatAnniversary(createdAt) {
  var next = getNextAnniversary(createdAt);
  if (!next) return "—";
  var diff = Math.round((next - new Date()) / (1000 * 60 * 60 * 24));
  var dateStr = next.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
  if (diff === 0) return dateStr + " (today!)";
  if (diff === 1) return dateStr + " (tomorrow)";
  if (diff <= 14) return dateStr + " (" + diff + "d)";
  return dateStr;
}

function isAnniversaryToday(createdAt) {
  if (!createdAt) return false;
  var signup = new Date(createdAt);
  var now = new Date();
  return (
    signup.getMonth() === now.getMonth() &&
    signup.getDate() === now.getDate() &&
    now.getFullYear() > signup.getFullYear()
  );
}

/* ─── Program Form Dialog ─── */
function ProgramFormDialog({ open, onOpenChange, program, companyId, onSaved }) {
  var [name, setName] = useState("");
  var [description, setDescription] = useState("");
  var [pointsPerRand, setPointsPerRand] = useState(1);
  var [isActive, setIsActive] = useState(true);
  var [saving, setSaving] = useState(false);

  useEffect(function() {
    if (open) {
      setName(program?.name || "");
      setDescription(program?.description || "");
      setPointsPerRand(program?.points_per_rand ?? 1);
      setIsActive(program?.is_active !== false);
    }
  }, [open, program]);

  var handleSave = async function() {
    if (!name.trim()) { toast.error("Program name is required"); return; }
    setSaving(true);
    try {
      if (program) {
        var { error } = await supabase.from("loyalty_programs").update({
          name: name.trim(), description: description.trim() || null,
          points_per_rand: pointsPerRand, is_active: isActive,
          updated_at: new Date().toISOString(),
        }).eq("id", program.id);
        if (error) throw error;
        toast.success("Program updated");
      } else {
        var { error: insertError } = await supabase.from("loyalty_programs").insert({
          company_id: companyId, name: name.trim(),
          description: description.trim() || null,
          points_per_rand: pointsPerRand, is_active: isActive,
        });
        if (insertError) throw insertError;
        toast.success("Program created");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message || "Failed to save program");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{program ? "Edit Loyalty Program" : "Create Loyalty Program"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Program Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Gold Membership" autoFocus />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the program benefits..." rows={3} />
          </div>
          <div>
            <Label>Points per South African Rand</Label>
            <Input type="number" min={0.1} step={0.1} value={pointsPerRand} onChange={e => setPointsPerRand(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground mt-1">Members earn this many points for every Rand spent</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>Active</Label>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={!name.trim() || saving} className="flex-1">
              {saving ? "Saving..." : program ? "Update Program" : "Create Program"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Loyalty Settings Panel ─── */
function LoyaltySettingsPanel({ companyId, onSaved }) {
  var selectedCurrency = localStorage.getItem("currency_code") || "ZAR";
  var currencySymbol = (CURRENCIES.find(c => c.code === selectedCurrency) || {}).symbol || "";

  var [loyalty, setLoyalty] = useState({
    enabled: true,
    points_per_unit: 1,
    bronze_points: 1,
    silver_points: 1.25,
    gold_points: 1.5,
    platinum_points: 2,
    min_redeem: 100,
    redeem_value: 0.10,
    bronze_threshold: 0,
    silver_threshold: 500,
    gold_threshold: 1500,
    platinum_threshold: 5000,
    annual_reset: false,
  });
  var [multipliers, setMultipliers] = useState({
    bronze: 1.0, silver: 1.25, gold: 1.5, platinum: 2.0,
  });
  var [saving, setSaving] = useState(false);
  var [loaded, setLoaded] = useState(false);
  var [previewPoints, setPreviewPoints] = useState(500);

  useEffect(function() {
    if (!companyId) return;
    supabase.from("companies").select("*").eq("id", companyId).single().then(function({ data }) {
      if (data) {
        setLoyalty({
          enabled: data.loyalty_enabled !== false,
          points_per_unit: data.loyalty_points_per_unit ?? 1,
          bronze_points: data.loyalty_bronze_points ?? 1,
          silver_points: data.loyalty_silver_points ?? 1.25,
          gold_points: data.loyalty_gold_points ?? 1.5,
          platinum_points: data.loyalty_platinum_points ?? 2,
          min_redeem: data.loyalty_min_redeem ?? 100,
          redeem_value: data.loyalty_redeem_value ?? 0.10,
          bronze_threshold: data.loyalty_bronze ?? 0,
          silver_threshold: data.loyalty_silver ?? 500,
          gold_threshold: data.loyalty_gold ?? 1500,
          platinum_threshold: data.loyalty_platinum ?? 5000,
          annual_reset: data.loyalty_annual_reset === true,
        });
        setMultipliers({
          bronze:   data.loyalty_bronze_multiplier   ?? 1.0,
          silver:   data.loyalty_silver_multiplier   ?? 1.25,
          gold:     data.loyalty_gold_multiplier     ?? 1.5,
          platinum: data.loyalty_platinum_multiplier ?? 2.0,
        });
      }
      setLoaded(true);
    });
  }, [companyId]);

  var save = async function() {
    setSaving(true);
    try {
      var { error } = await supabase.from("companies").update({
        loyalty_enabled:             loyalty.enabled,
        loyalty_points_per_unit:     loyalty.points_per_unit,
        loyalty_bronze_points:       loyalty.bronze_points,
        loyalty_silver_points:       loyalty.silver_points,
        loyalty_gold_points:         loyalty.gold_points,
        loyalty_platinum_points:     loyalty.platinum_points,
        loyalty_min_redeem:          loyalty.min_redeem,
        loyalty_redeem_value:        loyalty.redeem_value,
        loyalty_bronze:              loyalty.bronze_threshold,
        loyalty_silver:              loyalty.silver_threshold,
        loyalty_gold:                loyalty.gold_threshold,
        loyalty_platinum:            loyalty.platinum_threshold,
        loyalty_annual_reset:        loyalty.annual_reset,
        loyalty_bronze_multiplier:   multipliers.bronze,
        loyalty_silver_multiplier:   multipliers.silver,
        loyalty_gold_multiplier:     multipliers.gold,
        loyalty_platinum_multiplier: multipliers.platinum,
      }).eq("id", companyId);
      if (error) throw error;
      localStorage.setItem("loyalty_points_per_unit", loyalty.points_per_unit);
      localStorage.setItem("loyalty_min_redeem", loyalty.min_redeem);
      localStorage.setItem("loyalty_redeem_value", loyalty.redeem_value);
      localStorage.setItem("loyalty_bronze", loyalty.bronze_threshold);
      localStorage.setItem("loyalty_silver", loyalty.silver_threshold);
      localStorage.setItem("loyalty_gold", loyalty.gold_threshold);
      localStorage.setItem("loyalty_platinum", loyalty.platinum_threshold);
      toast.success("Loyalty settings saved");
      // Notify parent to reload thresholds so tier badges update
      if (onSaved) onSaved();
    } catch (err) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  var previewRandValue = previewPoints >= loyalty.min_redeem
    ? (previewPoints * loyalty.redeem_value).toFixed(2)
    : null;

  var getPreviewTier = function(pts) {
    if (pts >= loyalty.platinum_threshold) return { label: "Platinum", color: "text-purple-400", emoji: "💎" };
    if (pts >= loyalty.gold_threshold)     return { label: "Gold",     color: "text-yellow-400", emoji: "🥇" };
    if (pts >= loyalty.silver_threshold)   return { label: "Silver",   color: "text-slate-300",  emoji: "🥈" };
    return { label: "Bronze", color: "text-amber-500", emoji: "🥉" };
  };
  var previewTier = getPreviewTier(previewPoints);

  return (
    <div className="space-y-4">

      {/* Enable / Disable */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Loyalty Program</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loyalty.enabled ? "Members earn points on purchases and can redeem for store credit." : "Loyalty is disabled — members won't earn points."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn("text-xs font-medium", loyalty.enabled ? "text-green-500" : "text-muted-foreground")}>
              {loyalty.enabled ? "Active" : "Disabled"}
            </span>
            <Switch checked={loyalty.enabled} onCheckedChange={v => setLoyalty(p => ({ ...p, enabled: v }))} />
          </div>
        </div>
      </div>

      {loyalty.enabled && (
        <>
          {/* Tier Multipliers */}
          <div className="bg-card rounded-xl border border-border p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-400" />
              <h3 className="font-semibold text-sm">Tier Bonus Multipliers</h3>
            </div>
            <p className="text-xs text-muted-foreground">Higher tiers earn more points per purchase. A 1.5× multiplier means a Gold member earns 50% more than the base rate.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {TIER_STYLES.map(t => (
                <div key={t.key} className={cn("rounded-xl border p-3 space-y-2", t.bg, "border-transparent")}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{t.icon}</span>
                    <span className={cn("text-xs font-semibold", t.color)}>{t.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number" min={0.1} step={0.05}
                      value={multipliers[t.key]}
                      onChange={e => setMultipliers(p => ({ ...p, [t.key]: Number(e.target.value) }))}
                      className="h-8 text-sm bg-background border-border"
                    />
                    <span className="text-xs text-muted-foreground">×</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {multipliers[t.key] === 1 ? "Base rate" : ((multipliers[t.key] - 1) * 100).toFixed(0) + "% bonus"}
                  </p>
                </div>
              ))}
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Example: </span>
              Base rate 1 pt per 1.00 · 100 purchase →{" "}
              {TIER_STYLES.map((t, i) => (
                <span key={t.key}>{t.icon} {t.name}: <span className="font-semibold text-foreground">{(100 * multipliers[t.key]).toFixed(0)} pts</span>{i < TIER_STYLES.length - 1 ? " · " : ""}</span>
              ))}
            </div>
          </div>

          {/* Points Redemption */}
          <div className="bg-card rounded-xl border border-border p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-400" />
              <h3 className="text-sm font-semibold">Points Redemption</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Minimum points to redeem</Label>
                <Input
                  type="number" min={0}
                  value={loyalty.min_redeem}
                  onChange={e => setLoyalty(p => ({ ...p, min_redeem: Number(e.target.value) }))}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">Members need at least this many points before redeeming</p>
              </div>
              <div>
                <Label>Rand value per point</Label>
                <Input
                  type="number" min={0} step={0.01}
                  value={loyalty.redeem_value}
                  onChange={e => setLoyalty(p => ({ ...p, redeem_value: Number(e.target.value) }))}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">e.g. 0.10 = 10 pts = {currencySymbol}1.00</p>
              </div>
            </div>
            <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Points → Rand Calculator</p>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <Label className="text-xs">Enter points to preview</Label>
                  <Input type="number" min={0} value={previewPoints} onChange={e => setPreviewPoints(Number(e.target.value))} className="mt-1" placeholder="e.g. 500" />
                </div>
                <div className="text-2xl text-muted-foreground pt-5">=</div>
                <div className="flex-1 bg-card rounded-lg p-3 border border-border text-center">
                  {previewRandValue !== null ? (
                    <>
                      <p className="text-2xl font-bold text-green-400">{currencySymbol}{previewRandValue}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">store credit</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-red-400">Below minimum</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Need {loyalty.min_redeem} pts</p>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
                <span>Tier: <span className={cn("font-semibold", previewTier.color)}>{previewTier.emoji} {previewTier.label}</span></span>
                <span>Min redeem: {loyalty.min_redeem} pts = {currencySymbol}{(loyalty.min_redeem * loyalty.redeem_value).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Tier Thresholds */}
          <div className="bg-card rounded-xl border border-border p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Tier Thresholds</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Set the minimum points required to reach each tier. Members are automatically promoted.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { key: "bronze_threshold",   label: "Bronze",   emoji: "🥉", color: "text-amber-500",  bg: "bg-amber-500/10 border-amber-500/30" },
                { key: "silver_threshold",   label: "Silver",   emoji: "🥈", color: "text-slate-300",  bg: "bg-slate-400/10 border-slate-400/30" },
                { key: "gold_threshold",     label: "Gold",     emoji: "🥇", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30" },
                { key: "platinum_threshold", label: "Platinum", emoji: "💎", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/30" },
              ].map(function({ key, label, emoji, color, bg }) {
                return (
                  <div key={key} className={cn("rounded-xl border p-3 space-y-2", bg)}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{emoji}</span>
                      <span className={cn("text-xs font-semibold", color)}>{label}</span>
                    </div>
                    <Input
                      type="number" min={0}
                      value={loyalty[key]}
                      onChange={e => setLoyalty(p => ({ ...p, [key]: Number(e.target.value) }))}
                      className="bg-background border-border h-8 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">{loyalty[key]} pts min</p>
                  </div>
                );
              })}
            </div>
            <div className="bg-muted/30 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Progression Preview</p>
              <div className="flex items-center gap-1 text-xs overflow-x-auto pb-1">
                {[
                  { label: "Bronze",   pts: loyalty.bronze_threshold,   dot: "bg-amber-500" },
                  { label: "Silver",   pts: loyalty.silver_threshold,   dot: "bg-slate-400" },
                  { label: "Gold",     pts: loyalty.gold_threshold,     dot: "bg-yellow-400" },
                  { label: "Platinum", pts: loyalty.platinum_threshold, dot: "bg-purple-400" },
                ].map(function(tier, i, arr) {
                  return (
                    <div key={tier.label} className="flex items-center gap-1 shrink-0">
                      <div className={cn("w-2 h-2 rounded-full", tier.dot)} />
                      <span className={cn("font-medium", tier.dot.replace("bg-", "text-"))}>{tier.label}</span>
                      <span className="text-muted-foreground">({tier.pts}+)</span>
                      {i < arr.length - 1 && <span className="text-muted-foreground mx-1">→</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Annual Reset */}
          <div className="bg-card rounded-xl border border-border p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-blue-400" />
                <div>
                  <h3 className="text-sm font-semibold">Annual Points Reset</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically reset each member's points to 0 and return them to Bronze on their 1-year membership anniversary.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-4">
                <span className={cn("text-xs font-medium", loyalty.annual_reset ? "text-blue-400" : "text-muted-foreground")}>
                  {loyalty.annual_reset ? "On" : "Off"}
                </span>
                <Switch checked={loyalty.annual_reset} onCheckedChange={v => setLoyalty(p => ({ ...p, annual_reset: v }))} />
              </div>
            </div>
            {loyalty.annual_reset && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300 space-y-1">
                <p>✅ Resets run automatically at 2am UTC daily via a Supabase Edge Function cron.</p>
                <p>✅ Only members who joined exactly 1+ year ago (same day/month) are reset each day.</p>
                <p>✅ Each reset is logged in member activity history.</p>
                <p>🔵 The "Next Reset" column in the Members tab shows each member's upcoming anniversary.</p>
              </div>
            )}
          </div>
        </>
      )}

      <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
        {saving ? "Saving..." : "Save Loyalty Settings"}
      </Button>
    </div>
  );
}

/* ─── Main Loyalty Page ─── */
export default function Loyalty() {
  var { companyId } = useCompany();
  var [members, setMembers] = useState([]);
  var [programs, setPrograms] = useState([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState("");
  var [redeemMember, setRedeemMember] = useState(null);
  var [redeemPoints, setRedeemPoints] = useState(100);
  var [isSaving, setIsSaving] = useState(false);
  var [addMember, setAddMember] = useState(null);
  var [addPoints, setAddPoints] = useState(50);
  var [showProgramForm, setShowProgramForm] = useState(false);
  var [editProgram, setEditProgram] = useState(null);
  var [tab, setTab] = useState("members");
  var [annualResetEnabled, setAnnualResetEnabled] = useState(false);

  // Live thresholds — loaded from DB, updated when settings are saved
  var [thresholds, setThresholds] = useState({
    bronze: 0, silver: 500, gold: 1500, platinum: 5000,
  });

  var loadCompanySettings = useCallback(async function() {
    if (!companyId) return;
    var { data } = await supabase
      .from("companies")
      .select("loyalty_annual_reset, loyalty_bronze, loyalty_silver, loyalty_gold, loyalty_platinum")
      .eq("id", companyId)
      .single();
    if (data) {
      setAnnualResetEnabled(data.loyalty_annual_reset === true);
      setThresholds({
        bronze:   data.loyalty_bronze   ?? 0,
        silver:   data.loyalty_silver   ?? 500,
        gold:     data.loyalty_gold     ?? 1500,
        platinum: data.loyalty_platinum ?? 5000,
      });
    }
  }, [companyId]);

  var loadPrograms = useCallback(async function() {
    if (!companyId) return;
    try {
      var { data, error } = await supabase.from("loyalty_programs").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error;
      setPrograms(data || []);
    } catch (_) {}
  }, [companyId]);

  var load = useCallback(async function() {
    if (!companyId) return;
    setLoading(true);
    try {
      var { data, error } = await supabase
        .from("members")
        .select("*")
        .eq("company_id", companyId)
        .order("loyalty_points", { ascending: false })
        .limit(200);
      if (error) throw error;
      setMembers(data || []);
    } catch (err) {
      toast.error("Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(function() {
    if (companyId) { load(); loadPrograms(); loadCompanySettings(); }
  }, [companyId, load, loadPrograms, loadCompanySettings]);

  // Tiers derived from live thresholds
  var tiers = buildTiers(thresholds);

  var handleRedeem = async function() {
    if (!redeemMember || redeemPoints <= 0) return;
    if (redeemPoints > redeemMember.loyalty_points) { toast.error("Insufficient points"); return; }
    setIsSaving(true);
    try {
      var { error } = await supabase.from("members").update({ loyalty_points: redeemMember.loyalty_points - redeemPoints }).eq("id", redeemMember.id);
      if (error) throw error;
      await supabase.from("member_activities").insert({
        company_id: companyId, member_id: redeemMember.id,
        member_name: redeemMember.first_name + " " + redeemMember.last_name,
        visit_date: new Date().toISOString(), spend_amount: 0,
        visit_type: "consultation", notes: "Redeemed " + redeemPoints + " loyalty points",
      });
      toast.success("Redeemed " + redeemPoints + " points from " + redeemMember.first_name);
      setRedeemMember(null);
      await load();
    } catch (err) {
      toast.error(err.message || "Failed to redeem points");
    } finally {
      setIsSaving(false);
    }
  };

  var handleAddPoints = async function() {
    if (!addMember || addPoints <= 0) return;
    setIsSaving(true);
    try {
      var { error } = await supabase.from("members").update({ loyalty_points: (addMember.loyalty_points || 0) + addPoints }).eq("id", addMember.id);
      if (error) throw error;
      toast.success("Added " + addPoints + " points to " + addMember.first_name);
      setAddMember(null);
      await load();
    } catch (err) {
      toast.error(err.message || "Failed to add points");
    } finally {
      setIsSaving(false);
    }
  };

  var handleDeleteProgram = async function(prog) {
    var assigned = members.filter(m => m.loyalty_program_id === prog.id).length;
    if (!confirm(assigned > 0 ? "Delete \"" + prog.name + "\"? " + assigned + " member(s) will be unlinked." : "Delete \"" + prog.name + "\"?")) return;
    try {
      if (assigned > 0) await supabase.from("members").update({ loyalty_program_id: null }).eq("loyalty_program_id", prog.id);
      var { error } = await supabase.from("loyalty_programs").delete().eq("id", prog.id);
      if (error) throw error;
      toast.success("Program deleted");
      await loadPrograms(); await load();
    } catch (err) {
      toast.error(err?.message || "Failed to delete program");
    }
  };

  var handleAssignProgram = async function(memberId, programId) {
    try {
      var { error } = await supabase.from("members").update({ loyalty_program_id: programId || null }).eq("id", memberId);
      if (error) throw error;
      toast.success("Program assigned");
      await load();
    } catch (err) {
      toast.error("Failed to assign program");
    }
  };

  var filtered = members.filter(m =>
    (m.first_name + " " + m.last_name + " " + m.membership_id).toLowerCase().includes(search.toLowerCase())
  );
  var totalPoints = members.reduce((s, m) => s + (m.loyalty_points || 0), 0);

  // Tier counts using live thresholds
  var tierCounts = tiers.map(t => ({
    ...t,
    count: members.filter(m => (m.loyalty_points || 0) >= t.min && (m.loyalty_points || 0) <= t.max).length,
  }));

  var programMap = {};
  for (var p of programs) programMap[p.id] = p;

  var anniversaryToday = members.filter(m => isAnniversaryToday(m.created_at));

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Loyalty Program</h1>
          <p className="text-sm text-muted-foreground">Manage programs, member points and tier rewards</p>
        </div>
        <Button onClick={() => { setEditProgram(null); setShowProgramForm(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Program
        </Button>
      </div>

      {/* Anniversary alert */}
      {annualResetEnabled && anniversaryToday.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex items-center gap-3">
          <RotateCcw className="w-5 h-5 text-blue-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-300">
              {anniversaryToday.length} member{anniversaryToday.length > 1 ? "s" : ""} reset today
            </p>
            <p className="text-xs text-blue-400 mt-0.5">
              {anniversaryToday.map(m => m.first_name + " " + m.last_name).join(", ")} — points cleared to 0, returned to Bronze
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: "programs", label: "Programs",     icon: Settings, count: programs.length },
          { key: "members",  label: "Members",      icon: Users,    count: members.length },
          { key: "tiers",    label: "Tier Bonuses", icon: Zap,      count: null },
          { key: "settings", label: "Settings",     icon: Star,     count: null },
        ].map(t => (
          <button key={t.key}
            className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors", tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            onClick={() => setTab(t.key)}
          >
            <t.icon className="inline h-4 w-4 mr-1 -mt-0.5" />
            {t.label}{t.count !== null ? " (" + t.count + ")" : ""}
          </button>
        ))}
      </div>

      {/* ─── PROGRAMS TAB ─── */}
      {tab === "programs" && (
        <div className="space-y-4">
          {programs.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <Sparkles className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">No loyalty programs yet</p>
              <Button onClick={() => { setEditProgram(null); setShowProgramForm(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Create Your First Program
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {programs.map(prog => {
                var memberCount = members.filter(m => m.loyalty_program_id === prog.id).length;
                return (
                  <div key={prog.id} className={cn("rounded-xl border p-5 space-y-3 transition-colors", prog.is_active ? "bg-card border-border" : "bg-muted/30 border-border/50 opacity-70")}>
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-base">{prog.name}</h3>
                        {!prog.is_active && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">Inactive</span>}
                      </div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditProgram(prog); setShowProgramForm(true); }}><Edit className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDeleteProgram(prog)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    {prog.description && <p className="text-sm text-muted-foreground line-clamp-2">{prog.description}</p>}
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1.5"><Star className="h-4 w-4 text-primary" /><span className="font-semibold">{prog.points_per_rand}</span><span className="text-muted-foreground">pts/R</span></div>
                      <div className="flex items-center gap-1.5"><Users className="h-4 w-4 text-muted-foreground" /><span className="font-semibold">{memberCount}</span><span className="text-muted-foreground">member{memberCount !== 1 ? "s" : ""}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TIER BONUSES TAB ─── */}
      {tab === "tiers" && (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Award className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Tier Requirements</h3>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {tiers.map(t => (
                <div key={t.name} className="text-sm">
                  <p className={cn("font-semibold", t.color)}>{t.icon} {t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.max === Infinity ? t.min.toLocaleString() + "+ pts" : t.min.toLocaleString() + " – " + t.max.toLocaleString() + " pts"}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Edit thresholds in the <button className="text-primary font-medium underline" onClick={() => setTab("settings")}>Settings tab</button>.
            </p>
          </div>
        </div>
      )}

      {/* ─── SETTINGS TAB ─── */}
      {tab === "settings" && (
        <LoyaltySettingsPanel
          companyId={companyId}
          onSaved={loadCompanySettings}
        />
      )}

      {/* ─── MEMBERS TAB ─── */}
      {tab === "members" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {tierCounts.map(t => (
              <div key={t.name} className={cn("rounded-xl border p-4 flex items-center gap-3", t.bg, "border-transparent")}>
                <span className="text-2xl">{t.icon}</span>
                <div>
                  <p className={cn("text-xs font-semibold", t.color)}>{t.name}</p>
                  <p className="text-2xl font-bold">{t.count}</p>
                  <p className="text-xs text-muted-foreground">{t.min.toLocaleString()}+ pts</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-xl"><Star className="w-6 h-6 text-primary" /></div>
            <div>
              <p className="text-sm text-muted-foreground">Total Points Issued</p>
              <p className="text-3xl font-bold">{totalPoints.toLocaleString()}</p>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-sm">Member Points</h3>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search members..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-8 text-sm" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground">#</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Member</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Tier</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Program</th>
                    <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Points</th>
                    <th className="text-right p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Total Spend</th>
                    {annualResetEnabled && (
                      <th className="text-right p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Next Reset</th>
                    )}
                    <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m, idx) => {
                    var prog = m.loyalty_program_id ? programMap[m.loyalty_program_id] : null;
                    var anniversaryIsToday = isAnniversaryToday(m.created_at);
                    return (
                      <tr key={m.id} className={cn("border-b border-border/50 hover:bg-muted/20 transition-colors", anniversaryIsToday && annualResetEnabled && "bg-blue-500/5")}>
                        <td className="p-3 text-sm text-muted-foreground font-mono">{idx + 1}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">{m.first_name?.[0]}{m.last_name?.[0]}</div>
                            <div>
                              <p className="text-sm font-medium">{m.first_name} {m.last_name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{m.membership_id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 hidden sm:table-cell">
                          <TierBadge points={m.loyalty_points || 0} thresholds={thresholds} />
                        </td>
                        <td className="p-3 hidden md:table-cell">
                          <Select value={m.loyalty_program_id || "__none__"} onValueChange={v => handleAssignProgram(m.id, v === "__none__" ? null : v)}>
                            <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— None —</SelectItem>
                              {programs.filter(p => p.is_active).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-3 text-right font-bold text-primary">
                          {(m.loyalty_points || 0).toLocaleString()}
                          {prog && <span className="block text-xs font-normal text-muted-foreground">{prog.points_per_rand} pts/R</span>}
                        </td>
                        <td className="p-3 text-right text-sm text-muted-foreground hidden md:table-cell">{formatCurrency(m.total_spend || 0)}</td>
                        {annualResetEnabled && (
                          <td className="p-3 text-right hidden lg:table-cell">
                            {anniversaryIsToday ? (
                              <span className="text-xs text-blue-400 font-semibold flex items-center justify-end gap-1">
                                <RotateCcw className="w-3 h-3" /> Reset today
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                                <Calendar className="w-3 h-3" />
                                {formatAnniversary(m.created_at)}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setAddMember(m); setAddPoints(50); }}><ChevronUp className="w-3 h-3" /> Add</Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setRedeemMember(m); setRedeemPoints(100); }}><Gift className="w-3 h-3" /> Redeem</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!filtered.length && <p className="text-sm text-muted-foreground text-center py-10">No members found</p>}
          </div>
        </>
      )}

      {/* Dialogs */}
      <ProgramFormDialog
        open={showProgramForm}
        onOpenChange={v => { setShowProgramForm(v); if (!v) setEditProgram(null); }}
        program={editProgram}
        companyId={companyId}
        onSaved={() => { loadPrograms(); load(); }}
      />

      <Dialog open={!!redeemMember} onOpenChange={() => setRedeemMember(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Redeem Points</DialogTitle></DialogHeader>
          {redeemMember && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium">{redeemMember.first_name} {redeemMember.last_name}</p>
                <p className="text-muted-foreground">Available: <span className="font-bold text-primary">{(redeemMember.loyalty_points || 0).toLocaleString()} pts</span></p>
              </div>
              <div><Label>Points to Redeem</Label><Input type="number" min={1} max={redeemMember.loyalty_points} value={redeemPoints} onChange={e => setRedeemPoints(Number(e.target.value))} /></div>
              <Button onClick={handleRedeem} disabled={isSaving || redeemPoints <= 0 || redeemPoints > redeemMember.loyalty_points} className="w-full gap-2">
                <Gift className="w-4 h-4" />{isSaving ? "Processing..." : "Redeem " + redeemPoints + " Points"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!addMember} onOpenChange={() => setAddMember(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Points</DialogTitle></DialogHeader>
          {addMember && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium">{addMember.first_name} {addMember.last_name}</p>
                <p className="text-muted-foreground">Current: <span className="font-bold text-primary">{(addMember.loyalty_points || 0).toLocaleString()} pts</span></p>
              </div>
              <div><Label>Points to Add</Label><Input type="number" min={1} value={addPoints} onChange={e => setAddPoints(Number(e.target.value))} /></div>
              <Button onClick={handleAddPoints} disabled={isSaving || addPoints <= 0} className="w-full gap-2">
                <Star className="w-4 h-4" />{isSaving ? "Saving..." : "Add " + addPoints + " Points"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
