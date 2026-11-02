import React, { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Truck, PackageOpen, History, Plus, Trash2, Search, AlertTriangle, Check } from "lucide-react";

const sel =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

const STATUS = {
  in_transit: { label: "In transit", cls: "bg-blue-500/15 text-blue-400" },
  received: { label: "Received", cls: "bg-emerald-500/15 text-emerald-400" },
  received_variance: { label: "Shortfall", cls: "bg-amber-500/15 text-amber-400" },
  variance_closed: { label: "Shortfall closed", cls: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
};

async function fetchAll(build) {
  let from = 0, out = [];
  for (;;) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}
const fmt = (d) => new Date(d).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });

export default function Transfers() {
  const [tab, setTab] = useState("incoming");
  const [cid, setCid] = useState(null);
  const [priv, setPriv] = useState(false);
  const [allStores, setAllStores] = useState([]);
  const [myStores, setMyStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [notes, setNotes] = useState([]);
  const [lineMap, setLineMap] = useState({});

  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const { data: prof } = await supabase.from("profiles").select("company_id,role").eq("id", u.user.id).single();
    const company = prof.company_id;
    setCid(company);
    setPriv(["owner", "admin", "superadmin", "head_office", "manager"].includes(prof.role));
    const [{ data: mine }, st, prods, tn] = await Promise.all([
      supabase.rpc("ws_my_stores"),
      supabase.from("stores").select("id,name,type").eq("company_id", company).eq("is_active", true).order("name"),
      fetchAll(() => supabase.from("products").select("id,name,sku,barcode").eq("company_id", company).eq("is_active", true).order("name")),
      supabase.from("stock_transfer_notes").select("*").eq("company_id", company).order("dispatched_at", { ascending: false }).limit(100),
    ]);
    setMyStores(mine || []);
    setAllStores(st.data || []);
    setProducts(prods);
    const list = tn.data || [];
    setNotes(list);
    if (list.length) {
      const { data: ls } = await supabase.from("stock_transfer_note_lines").select("*").in("transfer_id", list.map((n) => n.id));
      const m = {};
      (ls || []).forEach((l) => { (m[l.transfer_id] ||= []).push(l); });
      setLineMap(m);
    }
  }, []);
  useEffect(() => { load().catch((e) => toast.error(e.message)); }, [load]);

  const sName = (id) => allStores.find((s) => s.id === id)?.name || "—";
  const incoming = notes.filter((n) => n.status === "in_transit" && myStores.includes(n.to_store_id));
  const shortfalls = notes.filter((n) => n.status === "received_variance");

  const tabs = [
    { k: "incoming", label: `Incoming${incoming.length ? ` (${incoming.length})` : ""}`, icon: PackageOpen },
    { k: "new", label: "New transfer", icon: Truck },
    { k: "history", label: `History${shortfalls.length && priv ? ` · ${shortfalls.length} shortfall` : ""}`, icon: History },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Truck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Stock Transfers</h1>
          <p className="text-sm text-muted-foreground">Head office dispatches. Stock stays in transit until the store counts it in.</p>
        </div>
      </div>
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px ${tab === t.k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === "incoming" && <Incoming list={incoming} lineMap={lineMap} sName={sName} onDone={load} />}
      {tab === "new" && <NewTransfer cid={cid} stores={allStores} myStores={myStores} products={products} onDone={() => { load(); setTab("history"); }} />}
      {tab === "history" && <HistoryTab list={notes} lineMap={lineMap} sName={sName} priv={priv} myStores={myStores} onDone={load} />}
    </div>
  );
}

function Incoming({ list, lineMap, sName, onDone }) {
  const [open, setOpen] = useState(null);
  const [rec, setRec] = useState({});
  const [reason, setReason] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const start = (n) => {
    setOpen(n.id); setNote("");
    const r = {}; (lineMap[n.id] || []).forEach((l) => { r[l.id] = String(l.qty_sent); });
    setRec(r); setReason({});
  };
  const confirm = async (n) => {
    const lines = (lineMap[n.id] || []).map((l) => ({ line_id: l.id, qty_received: Number(rec[l.id] ?? l.qty_sent), reason: reason[l.id] || null }));
    setBusy(true);
    const { data, error } = await supabase.rpc("transfer_receive", { p_id: n.id, p_lines: lines, p_notes: note || null });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(data.variance ? `${data.transfer_number} received with shortfall — head office notified` : `${data.transfer_number} received`);
    setOpen(null); onDone();
  };

  if (!list.length) return <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">Nothing on the way to your store.</div>;
  return (
    <div className="space-y-3">
      {list.map((n) => (
        <div key={n.id} className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="font-medium text-foreground">{n.transfer_number} <span className="ml-2 rounded px-2 py-0.5 text-xs bg-blue-500/15 text-blue-400">In transit</span></div>
              <div className="text-xs text-muted-foreground">{sName(n.from_store_id)} → {sName(n.to_store_id)} · sent {fmt(n.dispatched_at)} · {(lineMap[n.id] || []).length} lines</div>
              {n.notes && <div className="text-xs text-muted-foreground mt-1">{n.notes}</div>}
            </div>
            {open !== n.id && <Button onClick={() => start(n)}>Receive stock</Button>}
          </div>
          {open === n.id && (
            <div className="border-t border-border p-4 space-y-3">
              <p className="text-xs text-muted-foreground">Count what is physically in the box. Anything less than sent needs a reason.</p>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="text-left py-1">Product</th><th className="w-20 text-right">Sent</th><th className="w-28 text-right">Received</th><th className="w-56 text-left pl-3">Reason if short</th></tr></thead>
                <tbody>
                  {(lineMap[n.id] || []).map((l) => {
                    const short = Number(rec[l.id]) < Number(l.qty_sent);
                    return (
                      <tr key={l.id} className="border-t border-border">
                        <td className="py-2 text-foreground">{l.product_name}</td>
                        <td className="text-right text-muted-foreground">{l.qty_sent}</td>
                        <td><Input type="number" min="0" max={l.qty_sent} step="any" className={`text-right ${short ? "border-amber-500" : ""}`} value={rec[l.id] ?? ""} onChange={(e) => setRec({ ...rec, [l.id]: e.target.value })} /></td>
                        <td className="pl-3">{short && <Input placeholder="Missing / damaged…" value={reason[l.id] || ""} onChange={(e) => setReason({ ...reason, [l.id]: e.target.value })} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Input placeholder="Receiving notes (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
                <Button onClick={() => confirm(n)} disabled={busy}><Check className="h-4 w-4 mr-1" />{busy ? "Saving…" : "Confirm received"}</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NewTransfer({ stores, myStores, products, onDone }) {
  const fromOptions = stores.filter((s) => myStores.includes(s.id));
  const [from, setFrom] = useState(fromOptions.find((s) => s.type === "warehouse")?.id || fromOptions[0]?.id || "");
  const [to, setTo] = useState("");
  const [avail, setAvail] = useState({});
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!from) return;
    supabase.from("store_inventory").select("product_id,stock_quantity").eq("store_id", from).limit(5000)
      .then(({ data }) => { const m = {}; (data || []).forEach((r) => { m[r.product_id] = Number(r.stock_quantity); }); setAvail(m); });
  }, [from]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return products.filter((p) => (p.name || "").toLowerCase().includes(t) || (p.sku || "").toLowerCase().includes(t) || (p.barcode || "") === t).slice(0, 8);
  }, [q, products]);

  const add = (p) => { setLines((ls) => ls.find((l) => l.product_id === p.id) ? ls : [...ls, { product_id: p.id, name: p.name, sku: p.sku, quantity: "" }]); setQ(""); };
  const setQty = (i, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: v } : l)));

  const send = async () => {
    if (!from || !to) return toast.error("Choose both stores");
    const payload = lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) }));
    if (!payload.length) return toast.error("Add quantities");
    setBusy(true);
    const { data, error } = await supabase.rpc("transfer_dispatch", { p_from: from, p_to: to, p_lines: payload, p_notes: note || null });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${data.transfer_number} dispatched — ${data.lines} lines now in transit`);
    onDone();
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs text-muted-foreground space-y-1">From
          <select className={sel} value={from} onChange={(e) => { setFrom(e.target.value); setLines([]); }}>
            {fromOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground space-y-1">To
          <select className={sel} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">— choose store —</option>
            {stores.filter((s) => s.id !== from).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search product, SKU or scan barcode…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && matches.length === 1) add(matches[0]); }} />
        {matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
            {matches.map((p) => (
              <button key={p.id} onClick={() => add(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted">
                <span className="text-foreground">{p.name}</span><span className="text-xs text-muted-foreground">{avail[p.id] ?? 0} on hand</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {lines.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="text-left py-1">Product</th><th className="w-24 text-right">On hand</th><th className="w-32 text-right">Send qty</th><th className="w-10" /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const over = Number(l.quantity) > (avail[l.product_id] ?? 0);
              return (
                <tr key={l.product_id} className="border-t border-border">
                  <td className="py-2 text-foreground">{l.name}<div className="text-xs text-muted-foreground">{l.sku}</div></td>
                  <td className="text-right text-muted-foreground">{avail[l.product_id] ?? 0}</td>
                  <td><Input type="number" min="0" step="any" className={`text-right ${over ? "border-amber-500" : ""}`} value={l.quantity} onChange={(e) => setQty(i, e.target.value)} /></td>
                  <td><Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Input placeholder="Notes / driver / vehicle (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-end"><Button onClick={send} disabled={busy || !lines.length}><Plus className="h-4 w-4 mr-1" />{busy ? "Dispatching…" : "Dispatch transfer"}</Button></div>
    </div>
  );
}

function HistoryTab({ list, lineMap, sName, priv, myStores, onDone }) {
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");
  const rows = list.filter((n) => filter === "all" || n.status === filter);

  const resolve = async (n, action) => {
    const { error } = await supabase.rpc("transfer_resolve_variance", { p_id: n.id, p_action: action });
    if (error) return toast.error(error.message);
    toast.success(action === "return_to_source" ? "Shortfall returned to source stock" : "Shortfall written off");
    onDone();
  };
  const cancel = async (n) => {
    const { error } = await supabase.rpc("transfer_cancel", { p_id: n.id });
    if (error) return toast.error(error.message);
    toast.success(`${n.transfer_number} cancelled, stock returned`);
    onDone();
  };

  return (
    <div className="space-y-3">
      <select className={sel + " max-w-xs"} value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="all">All statuses</option>
        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <div className="rounded-lg border border-border bg-card">
        {rows.map((n) => {
          const st = STATUS[n.status];
          return (
            <div key={n.id} className="border-b border-border last:border-0">
              <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setOpen(open === n.id ? null : n.id)}>
                <div>
                  <div className="font-medium text-foreground">{n.transfer_number} <span className={`ml-2 rounded px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span></div>
                  <div className="text-xs text-muted-foreground">{sName(n.from_store_id)} → {sName(n.to_store_id)} · {fmt(n.dispatched_at)}</div>
                </div>
                {n.status === "received_variance" && <AlertTriangle className="h-4 w-4 text-amber-400" />}
              </button>
              {open === n.id && (
                <div className="px-4 pb-4 space-y-3">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground"><tr><th className="text-left py-1">Product</th><th className="text-right">Sent</th><th className="text-right">Received</th><th className="text-left pl-3">Reason</th></tr></thead>
                    <tbody>
                      {(lineMap[n.id] || []).map((l) => (
                        <tr key={l.id} className="border-t border-border">
                          <td className="py-1.5 text-foreground">{l.product_name}</td>
                          <td className="text-right text-muted-foreground">{l.qty_sent}</td>
                          <td className={`text-right ${l.qty_received != null && l.qty_received < l.qty_sent ? "text-amber-400" : "text-foreground"}`}>{l.qty_received ?? "—"}</td>
                          <td className="pl-3 text-muted-foreground">{l.variance_reason || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {n.receive_notes && <div className="text-xs text-muted-foreground">Receiver note: {n.receive_notes}</div>}
                  <div className="flex gap-2">
                    {n.status === "received_variance" && priv && (<>
                      <Button size="sm" onClick={() => resolve(n, "return_to_source")}>Return shortfall to source</Button>
                      <Button size="sm" variant="outline" onClick={() => resolve(n, "write_off")}>Write off shortfall</Button>
                    </>)}
                    {n.status === "in_transit" && (priv || myStores.includes(n.from_store_id)) && (
                      <Button size="sm" variant="outline" onClick={() => cancel(n)}>Cancel &amp; return stock</Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <div className="p-8 text-center text-muted-foreground">No transfers.</div>}
      </div>
    </div>
  );
}
