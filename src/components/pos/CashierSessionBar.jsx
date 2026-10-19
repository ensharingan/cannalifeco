import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "../../lib/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PlayCircle, StopCircle, AlertTriangle, Store, CheckCircle2, TrendingUp, TrendingDown, Receipt } from "lucide-react";
import { formatCurrency } from "../../lib/currency";

// A warehouse has no till and no walk-in trade, so a cash float can't be
// counted against it. It stays out of the session picker for every role —
// this is about the type of location, not about restricting who works where.
const TILL_STORE_TYPES = ['single', 'branch', 'franchise'];

function isTillStore(type) {
  return TILL_STORE_TYPES.indexOf((type || 'single').toLowerCase()) !== -1;
}

export default function CashierSessionBar({ onSessionChange }) {
  const { companyId, stores: ctxStores, activeStoreId } = useCompany();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // Open Day
  const [showOpen, setShowOpen] = useState(false);
  const [float, setFloat] = useState("");
  const [saving, setSaving] = useState(false);

  // Store picker
  const [assignedStores, setAssignedStores] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [needStorePick, setNeedStorePick] = useState(false);

  // Close Day
  const [showClose, setShowClose] = useState(false);
  const [closingFloat, setClosingFloat] = useState("");
  const [closingCard, setClosingCard] = useState("");
  // The count stays blind, but the result no longer disappears into the
  // database unseen — this holds the reconciliation to show back afterwards.
  const [closeResult, setCloseResult] = useState(null);

  const loadSession = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("cashier_sessions")
        .select("*")
        .eq("company_id", companyId)
        .eq("cashier_id", user.id)
        .eq("status", "open")
        .order("opening_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      setSession(data || null);
      if (onSessionChange) onSessionChange(data || null);
    } catch (_) {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, onSessionChange]);

  useEffect(() => { loadSession(); }, [loadSession]);

  const storeNameFor = (id) => {
    if (!id) return null;
    const fromCtx = (ctxStores || []).find(s => s.id === id);
    if (fromCtx) return fromCtx.name;
    const fromList = assignedStores.find(s => s.store_id === id);
    return fromList ? fromList.store_name : null;
  };

  // ── Open Day click ──────────────────────────────────────────────────────────
  const handleOpenDayClick = async () => {
    let list = [];

    // Cashiers created through the Cashiers page have rows here.
    try {
      const { data: assigned, error } = await supabase.rpc("get_my_store_assignments");
      if (!error && assigned && assigned.length) {
        list = assigned.map(s => ({
          store_id: s.store_id, store_name: s.store_name, store_type: s.store_type,
        }));
      }
    } catch (_) { /* fall through to company stores */ }

    // Owners and managers have no assignment rows. Falling back to the company's
    // own stores stops sessions being opened with store_id = null, which breaks
    // per-store cash-up and reporting.
    if (!list.length) {
      let companyStores = (ctxStores || []).filter(s => s.is_active !== false);
      if (!companyStores.length && companyId) {
        const { data } = await supabase
          .from("stores").select("id, name, type")
          .eq("company_id", companyId).eq("is_active", true).order("name");
        companyStores = data || [];
      }
      list = companyStores.map(s => ({
        store_id: s.id, store_name: s.name, store_type: s.type,
      }));
    }

    // Drop warehouses from whichever path produced the list.
    list = list.filter(s => isTillStore(s.store_type));

    setAssignedStores(list);

    if (list.length === 0) {
      setSelectedStoreId("");
      setNeedStorePick(false);
    } else if (list.length === 1) {
      setSelectedStoreId(list[0].store_id);
      setNeedStorePick(false);
    } else {
      // Default to whatever store is currently active in the selector.
      const preferred = list.find(s => s.store_id === activeStoreId);
      setSelectedStoreId(preferred ? preferred.store_id : list[0].store_id);
      setNeedStorePick(true);
    }

    setFloat("");
    setShowOpen(true);
  };

  // ── Actually open the session ───────────────────────────────────────────────
  const openSession = async () => {
    if (needStorePick && !selectedStoreId) {
      toast.error("Please select a store");
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

      const storeId = selectedStoreId || null;

      const { data, error } = await supabase
        .from("cashier_sessions")
        .insert({
          company_id: companyId,
          cashier_id: user.id,
          cashier_name: profile?.full_name || user.email,
          store_id: storeId,
          opening_float: parseFloat(float) || 0,
          status: "open",
          opening_time: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      setSession(data);
      if (onSessionChange) onSessionChange(data);
      setShowOpen(false);
      setFloat("");
      const name = storeNameFor(storeId);
      toast.success(name ? `Session opened at ${name}` : "Session opened! Great work!");
    } catch (err) {
      toast.error(err.message || "Failed to open session");
    } finally {
      setSaving(false);
    }
  };

  // ── Close Day ───────────────────────────────────────────────────────────────
  const closeSession = async () => {
    if (!session) return;
    if (closingFloat === "") { toast.error("Enter the cash you counted in the drawer"); return; }
    setSaving(true);
    try {
      const actual = parseFloat(closingFloat);
      const cardTotal = closingCard !== "" ? parseFloat(closingCard) : null;
      const sessionId = session.id;

      const { error } = await supabase
        .from("cashier_sessions")
        .update({
          closing_time: new Date().toISOString(),
          closing_float: actual,
          closing_card_total: cardTotal,
          status: "closed",
        })
        .eq("id", sessionId);

      if (error) throw error;

      // The database works out expected cash and card on close. Read it straight
      // back so the cashier sees the same numbers that were just stored, instead
      // of a variance nobody ever looks at.
      let summary = null;
      try {
        const { data: sum, error: sumErr } = await supabase
          // Database function names are NOT rebranded — they are shared platform
          // objects cloned from Budify, so the licensee build must call them by
          // their real names.
          .rpc("budify_session_summary", { p_session: sessionId });
        if (!sumErr) summary = sum;
      } catch (_) { /* reconciliation is informational — never block the close */ }

      setCloseResult(summary || { closing_float: actual, closing_card: cardTotal });
      setSession(null);
      if (onSessionChange) onSessionChange(null);
      toast.success("Session closed");
    } catch (err) {
      toast.error(err.message || "Failed to close session");
    } finally {
      setSaving(false);
    }
  };

  const dismissClose = () => {
    setShowClose(false);
    setCloseResult(null);
    setClosingFloat("");
    setClosingCard("");
  };

  if (loading) return null;

  const openStoreName = session ? storeNameFor(session.store_id) : null;

  const num = (v) => (v === null || v === undefined ? null : Number(v));

  const renderVarianceRow = (label, expected, counted, variance) => {
    const v = num(variance);
    if (v === null) return null;
    const isOver = v > 0.004;
    const isShort = v < -0.004;
    const tone = isShort
      ? "text-red-600 dark:text-red-400"
      : isOver
        ? "text-amber-600 dark:text-amber-400"
        : "text-green-600 dark:text-green-400";
    return (
      <div className="rounded-lg border border-border p-3 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">System expected</span>
          <span className="font-medium">{formatCurrency(num(expected) || 0)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">You counted</span>
          <span className="font-medium">{formatCurrency(num(counted) || 0)}</span>
        </div>
        <div className={`flex items-center justify-between text-sm font-semibold pt-1.5 border-t border-border ${tone}`}>
          <span className="flex items-center gap-1.5">
            {isShort ? <TrendingDown className="w-3.5 h-3.5" /> : isOver ? <TrendingUp className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {isShort ? "Short" : isOver ? "Over" : "Balanced"}
          </span>
          <span>{v === 0 ? formatCurrency(0) : (v > 0 ? "+" : "") + formatCurrency(v)}</span>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* ── Status bar ── */}
      <div className={`flex items-center gap-3 px-4 py-2 border-b ${
        session ? "bg-green-500/5 border-green-500/20" : "bg-yellow-500/5 border-yellow-500/20"
      }`}>
        <div className={`w-2 h-2 rounded-full ${session ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
        {session ? (
          <>
            <span className="text-xs font-medium text-green-700 dark:text-green-400">
              Session Open since {new Date(session.opening_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            </span>
            {openStoreName && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Store className="w-3 h-3" /> {openStoreName}
              </span>
            )}
            {!session.store_id && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                <AlertTriangle className="w-3 h-3" /> No store on this session
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              · Float: {formatCurrency(session.opening_float || 0)}
            </span>
            <div className="ml-auto">
              <Button size="sm" variant="destructive" className="h-7 text-xs gap-1"
                onClick={() => { setClosingFloat(""); setClosingCard(""); setCloseResult(null); setShowClose(true); }}>
                <StopCircle className="w-3.5 h-3.5" /> Close Day
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400">No active session</span>
            <div className="ml-auto">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={handleOpenDayClick}>
                <PlayCircle className="w-3.5 h-3.5" /> Open Day
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ── Open Session Dialog ── */}
      <Dialog open={showOpen} onOpenChange={setShowOpen}>
        <DialogContent className="max-w-sm" aria-describedby="open-session-desc">
          <DialogHeader><DialogTitle>Open Cashier Session</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p id="open-session-desc" className="text-sm text-muted-foreground">
              Count your opening cash float before starting.
            </p>

            {/* Store picker — shown whenever more than one store is available */}
            {needStorePick && (
              <div>
                <Label className="text-xs">Which store are you working at today? *</Label>
                <div className="mt-1 space-y-1">
                  {assignedStores.map(s => (
                    <label key={s.store_id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedStoreId === s.store_id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted/50"
                      }`}>
                      <input
                        type="radio"
                        name="store_pick"
                        className="accent-primary"
                        checked={selectedStoreId === s.store_id}
                        onChange={() => setSelectedStoreId(s.store_id)}
                      />
                      <div>
                        <p className="font-medium text-sm">{s.store_name}</p>
                        {s.store_type && <p className="text-xs text-muted-foreground">{s.store_type}</p>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Single store — confirm which one, so nobody trades on the wrong till */}
            {!needStorePick && selectedStoreId && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                <Store className="w-3.5 h-3.5 shrink-0" />
                Opening at <span className="font-medium text-foreground">{storeNameFor(selectedStoreId)}</span>
              </div>
            )}

            {/* No store at all — warn rather than fail silently */}
            {!selectedStoreId && (
              <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>No active store found for this club. The session will open without one, and sales won't be attributed to a store.</span>
              </div>
            )}

            <div>
              <Label>Opening Cash Float</Label>
              <Input
                type="number"
                step="0.01"
                value={float}
                onChange={e => setFloat(e.target.value)}
                placeholder="0.00"
                autoFocus={!needStorePick}
              />
            </div>

            <Button onClick={openSession} disabled={saving || (needStorePick && !selectedStoreId)} className="w-full gap-2">
              <PlayCircle className="w-4 h-4" />
              {saving ? "Opening..." : "Open Session"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Close Day Dialog ── */}
      {/* Still a blind count: nothing is revealed until the drawer is entered. */}
      <Dialog open={showClose} onOpenChange={(open) => { if (!open) dismissClose(); }}>
        <DialogContent className="max-w-sm" aria-describedby="close-session-desc">
          <DialogHeader>
            <DialogTitle>{closeResult ? "Day Closed" : "Close Cashier Session"}</DialogTitle>
          </DialogHeader>

          {!closeResult ? (
            <div className="space-y-4">
              <p id="close-session-desc" className="text-sm text-muted-foreground">
                Count your drawer and card machine, then enter the totals below.
              </p>
              <div>
                <Label>Cash in Drawer</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={closingFloat}
                  onChange={e => setClosingFloat(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Everything in the drawer, including your opening float and any tab payments taken in cash.
                </p>
              </div>
              <div>
                <Label>Cards</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={closingCard}
                  onChange={e => setClosingCard(e.target.value)}
                  placeholder="0.00"
                />
                <p className="text-xs text-muted-foreground mt-1">Total off the card machine for your shift.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={dismissClose}>Cancel</Button>
                <Button variant="destructive" className="flex-1 gap-2" onClick={closeSession} disabled={saving}>
                  <StopCircle className="w-4 h-4" />
                  {saving ? "Closing..." : "Close Session"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {renderVarianceRow(
                "Cash",
                closeResult.expected_cash,
                closeResult.closing_float,
                closeResult.expected_cash !== undefined && closeResult.closing_float !== undefined
                  ? Number(closeResult.closing_float || 0) - Number(closeResult.expected_cash || 0)
                  : closeResult.cash_variance
              )}

              {closeResult.closing_card !== null && closeResult.closing_card !== undefined && (
                renderVarianceRow(
                  "Card machine",
                  closeResult.expected_card,
                  closeResult.closing_card,
                  Number(closeResult.closing_card || 0) - Number(closeResult.expected_card || 0)
                )
              )}

              {/* Where the expected cash came from. Without this, a variance
                  driven by tab settlements looks like missing money. */}
              {closeResult.opening_float !== undefined && (
                <div className="rounded-lg bg-muted/40 p-3 space-y-1 text-xs">
                  <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Cash breakdown</p>
                  <div className="flex justify-between"><span className="text-muted-foreground">Opening float</span><span>{formatCurrency(Number(closeResult.opening_float) || 0)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Cash sales</span><span>{formatCurrency(Number(closeResult.cash_sales) || 0)}</span></div>
                  {Number(closeResult.tab_cash) > 0 && (
                    <div className="flex justify-between text-amber-600 dark:text-amber-400">
                      <span className="flex items-center gap-1"><Receipt className="w-3 h-3" /> Tab payments (cash)</span>
                      <span>{formatCurrency(Number(closeResult.tab_cash))}</span>
                    </div>
                  )}
                  {Number(closeResult.cash_outs) > 0 && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Cash taken out</span><span>−{formatCurrency(Number(closeResult.cash_outs))}</span></div>
                  )}
                  <div className="flex justify-between font-semibold pt-1.5 border-t border-border">
                    <span>Expected in drawer</span><span>{formatCurrency(Number(closeResult.expected_cash) || 0)}</span>
                  </div>
                  {Number(closeResult.unpaid_total) > 0 && (
                    <p className="pt-1.5 text-amber-600 dark:text-amber-400">
                      {formatCurrency(Number(closeResult.unpaid_total))} still on open tabs — not expected in the drawer.
                    </p>
                  )}
                </div>
              )}

              <Button className="w-full" onClick={dismissClose}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
