import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ClipboardCheck, Plus, Store as StoreIcon, EyeOff, ChevronRight } from "lucide-react";

var MANAGER_ROLES = ["owner", "admin", "manager", "superadmin"];

var STATUS_STYLES = {
  in_progress: "bg-green-500/10 text-green-500",
  paused: "bg-amber-500/10 text-amber-500",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-red-500/10 text-red-500",
};

var STATUS_LABELS = {
  in_progress: "In progress",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

function timeAgo(ts) {
  if (!ts) return "";
  var s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return s + " seconds ago";
  if (s < 3600) return Math.floor(s / 60) + " minutes ago";
  if (s < 86400) return Math.floor(s / 3600) + " hours ago";
  return Math.floor(s / 86400) + " days ago";
}

export default function StockCounts() {
  var navigate = useNavigate();

  var [profile, setProfile] = useState(null);
  var [stores, setStores] = useState([]);
  var [counts, setCounts] = useState([]);
  var [categories, setCategories] = useState([]);
  var [tab, setTab] = useState("due");
  var [loading, setLoading] = useState(true);

  var [showNew, setShowNew] = useState(false);
  var [creating, setCreating] = useState(false);
  var [form, setForm] = useState({ store_id: "", scope: "all", category: "", blind: true, name: "" });

  var isManager = profile && MANAGER_ROLES.indexOf(profile.role) !== -1;

  var loadCounts = useCallback(async function (who) {
    if (!who) return;
    var res = await supabase.from("stock_counts")
      .select("id, name, status, store_id, items_total, blind, scope, category, started_at, updated_at, completed_at")
      .eq("company_id", who.company_id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (res.error) { toast.error(res.error.message); return; }
    setCounts(res.data || []);
  }, []);

  useEffect(function () {
    var cancelled = false;

    (async function () {
      try {
        var auth = await supabase.auth.getUser();
        var user = auth.data ? auth.data.user : null;
        if (!user) throw new Error("Please sign in again.");

        var pRes = await supabase.from("profiles")
          .select("id, role, company_id, store_id, full_name").eq("id", user.id).single();
        if (pRes.error) throw pRes.error;
        if (cancelled) return;
        var prof = pRes.data;
        setProfile(prof);

        var storeList = [];
        if (MANAGER_ROLES.indexOf(prof.role) !== -1) {
          var sRes = await supabase.from("stores").select("id, name")
            .eq("company_id", prof.company_id).eq("is_active", true).order("name");
          storeList = sRes.data || [];
        } else {
          var aRes = await supabase.rpc("get_my_store_assignments");
          storeList = (aRes.data || []).map(function (s) { return { id: s.store_id, name: s.store_name }; });
          if (!storeList.length && prof.store_id) {
            var oRes = await supabase.from("stores").select("id, name").eq("id", prof.store_id).single();
            if (oRes.data) storeList = [oRes.data];
          }
        }
        if (cancelled) return;
        setStores(storeList);
        setForm(function (f) { return { ...f, store_id: storeList[0] ? storeList[0].id : "" }; });

        var cRes = await supabase.from("products").select("category")
          .eq("company_id", prof.company_id).not("category", "is", null);
        if (!cancelled) {
          var seen = {};
          (cRes.data || []).forEach(function (c) { if (c.category) seen[c.category] = true; });
          setCategories(Object.keys(seen).sort());
        }

        await loadCounts(prof);
      } catch (e) {
        if (!cancelled) toast.error(e.message || "Could not load stock counts.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return function () { cancelled = true; };
  }, [loadCounts]);

  var storeName = function (id) {
    for (var i = 0; i < stores.length; i++) { if (stores[i].id === id) return stores[i].name; }
    return "—";
  };

  var visible = useMemo(function () {
    return counts.filter(function (c) {
      if (tab === "due") return c.status === "in_progress" || c.status === "paused";
      if (tab === "completed") return c.status === "completed";
      return c.status === "cancelled";
    });
  }, [counts, tab]);

  var dueCount = counts.filter(function (c) {
    return c.status === "in_progress" || c.status === "paused";
  }).length;

  async function createCount() {
    if (!form.store_id) { toast.error("Pick a store first."); return; }
    setCreating(true);
    try {
      var res = await supabase.rpc("stock_count_create", {
        p_store_id: form.store_id,
        p_name: form.name || null,
        p_scope: form.scope,
        p_category: form.scope === "category" ? (form.category || null) : null,
        p_blind: isManager ? form.blind : true,
      });
      if (res.error) throw res.error;
      setShowNew(false);
      navigate("/stock-counts/" + res.data);
    } catch (e) {
      toast.error(e.message || "Could not start the count.");
    } finally { setCreating(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Stock counts</h1>
            <p className="text-sm text-muted-foreground">
              Count the stock on your shelves so the POS matches the room.
            </p>
          </div>
        </div>
        {stores.length > 0 && (
          <Button className="gap-2 font-semibold" onClick={function () { setShowNew(true); }}>
            <Plus className="w-4 h-4" /> Start a count
          </Button>
        )}
      </div>

      {stores.length === 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 mb-4 text-sm text-amber-600 dark:text-amber-400">
          You are not assigned to a store yet, so there is nothing to count. Ask your manager to add you to a store.
        </div>
      )}

      <div className="flex gap-6 border-b border-border mb-2">
        {[
          ["due", "Due (" + dueCount + ")"],
          ["completed", "Completed"],
          ["cancelled", "Cancelled"],
        ].map(function (t) {
          return (
            <button key={t[0]} onClick={function () { setTab(t[0]); }}
              className={cn("-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors",
                tab === t[0]
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t[1]}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {visible.length === 0 && (
          <div className="py-14 text-center text-sm text-muted-foreground">
            {tab === "due" ? "No counts open. Start one when you are ready to count." : "Nothing here yet."}
          </div>
        )}

        {visible.map(function (c) {
          return (
            <button key={c.id} onClick={function () { navigate("/stock-counts/" + c.id); }}
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground truncate">{c.name}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[c.status])}>
                    {STATUS_LABELS[c.status]}
                  </span>
                  {c.blind && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      <EyeOff className="w-3 h-3" /> Blind
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                  <span className="inline-flex items-center gap-1">
                    <StoreIcon className="w-3 h-3" /> {storeName(c.store_id)}
                  </span>
                  <span>{c.items_total} items</span>
                  {c.scope === "category" && <span>Category: {c.category}</span>}
                  <span>{timeAgo(c.updated_at)}</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>

      <Dialog open={showNew} onOpenChange={function (open) { if (!open) setShowNew(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-primary" /> Start a count
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Store</label>
              <Select value={form.store_id} onValueChange={function (v) { setForm({ ...form, store_id: v }); }}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Pick a store" /></SelectTrigger>
                <SelectContent>
                  {stores.map(function (s) {
                    return <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">What to count</label>
              <Select value={form.scope} onValueChange={function (v) { setForm({ ...form, scope: v }); }}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everything in the store</SelectItem>
                  <SelectItem value="category">One category</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.scope === "category" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <Select value={form.category} onValueChange={function (v) { setForm({ ...form, category: v }); }}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Pick a category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(function (c) {
                      return <SelectItem key={c} value={c}>{c}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name (optional)</label>
              <Input value={form.name} placeholder="Friday morning count"
                onChange={function (e) { setForm({ ...form, name: e.target.value }); }} />
            </div>

            {isManager ? (
              <button onClick={function () { setForm({ ...form, blind: !form.blind }); }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border p-3 text-left hover:bg-muted/40 transition-colors">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">Blind count</span>
                  <span className="block text-xs text-muted-foreground">
                    Counters cannot see the system quantity while counting.
                  </span>
                </span>
                <span className={cn("flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
                  form.blind ? "bg-primary" : "bg-muted")}>
                  <span className={cn("h-5 w-5 rounded-full bg-background transition-transform", form.blind && "translate-x-5")} />
                </span>
              </button>
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
                <EyeOff className="w-4 h-4 shrink-0 mt-0.5" />
                You will count blind — the system quantity stays hidden, and a manager applies the result.
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={function () { setShowNew(false); }}>Cancel</Button>
              <Button className="flex-1 font-semibold"
                disabled={creating || !form.store_id || (form.scope === "category" && !form.category)}
                onClick={createCount}>
                {creating ? "Starting..." : "Start counting"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
