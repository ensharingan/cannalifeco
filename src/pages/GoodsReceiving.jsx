import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { supabase } from '@/api/supabaseClient';
import { useSearchParams } from "react-router-dom";
import { Plus, Search, Trash2, Upload, Truck, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";

const statusColors = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  posted: "bg-green-500/10 text-green-600 border-green-200",
  cancelled: "bg-red-500/10 text-red-600 border-red-200",
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyHeader = () => ({ supplier_id: "", store_id: "", received_date: today(), delivery_note_no: "", notes: "", request_id: "", short_reasons: {} });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function loadAllProducts(companyId) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, barcode, cost_price, vat_type, is_active')
      .eq('company_id', companyId)
      .order('name')
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default function GoodsReceiving() {
  const { companyId, role } = useCompany();
  const isMgr = ['owner', 'admin', 'manager', 'superadmin', 'head_office', 'supervisor'].includes(role);
  const [grns, setGrns] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [grnNumber, setGrnNumber] = useState("");
  const [header, setHeader] = useState(emptyHeader());
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [prodSearch, setProdSearch] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const searchRef = useRef(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [g, s, st, p, mine, rq] = await Promise.all([
        supabase.from('goods_received_notes').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(300),
        supabase.from('suppliers').select('id, name, vat_registered, is_internal').eq('company_id', companyId).order('name'),
        supabase.from('stores').select('id, name, type, is_active').eq('company_id', companyId).order('name'),
        loadAllProducts(companyId),
        supabase.rpc('ws_my_stores'),
        supabase.from('stock_requests').select('id, request_number, store_id, supplier_id, status, requested_date').eq('company_id', companyId).eq('status', 'issued').order('created_at', { ascending: false }),
      ]);
      const allowed = new Set(mine.data || []);
      setRequests(rq.data || []);
      setGrns(g.data || []);
      setSuppliers(s.data || []);
      setStores((st.data || []).filter(x => x.is_active !== false && allowed.has(x.id)));
      setProducts(p || []);
    } catch (err) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const supplierById = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s])), [suppliers]);
  const storeById = useMemo(() => Object.fromEntries(stores.map(s => [s.id, s])), [stores]);
  const productById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const supplier = supplierById[header.supplier_id];
  const vatReg = !!supplier?.vat_registered;
  // Internal sources (e.g. the stock room) send stock with no invoice: no prices, VAT or delivery note
  const simple = !!supplier?.is_internal;
  const staleDrafts = useMemo(() => grns.filter(g => g.status === 'draft' && g.received_date && g.received_date < today()), [grns]);
  const lastKey = 'grv_last_receive';
  const readLast = () => { try { return JSON.parse(localStorage.getItem(lastKey) || '{}'); } catch { return {}; } };
  const writeLast = (v) => { try { localStorage.setItem(lastKey, JSON.stringify(v)); } catch { /* ignore */ } };

  const lineVat = (l) => {
    const vt = l.vat_type || productById[l.product_id]?.vat_type || 'standard';
    return vatReg && vt === 'standard' ? r2(r2(l.quantity * l.unit_cost) * 0.15) : 0;
  };
  const totals = useMemo(() => {
    const live = lines.filter(l => !l.gone);
    const ex = live.reduce((s, l) => s + r2((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)), 0);
    const vat = live.reduce((s, l) => s + lineVat(l), 0);
    return { ex: r2(ex), vat: r2(vat), inc: r2(ex + vat) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, vatReg, productById]);

  const filtered = grns.filter(g => {
    if (statusFilter !== 'all' && g.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (g.grn_number || '').toLowerCase().includes(q)
      || (g.delivery_note_no || '').toLowerCase().includes(q)
      || (supplierById[g.supplier_id]?.name || '').toLowerCase().includes(q);
  });

  const newGrv = () => {
    setEditingId(null); setReadOnly(false); setGrnNumber("");
    const last = readLast();
    const storeId = stores.length === 1 ? stores[0].id : (stores.some(s => s.id === last.store_id) ? last.store_id : "");
    const supId = suppliers.some(s => s.id === last.supplier_id) ? last.supplier_id : "";
    setHeader({ ...emptyHeader(), store_id: storeId, supplier_id: supId });
    setLines([]); setProdSearch(""); setShowPaste(false); setPasteText("");
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 150);
  };

  // Fill the GRV from a stock request: only what is still due
  const applyRequest = async (reqId) => {
    if (!reqId) { setHeader(h => ({ ...h, request_id: "" })); return; }
    const req = requests.find(r => r.id === reqId);
    const { data, error } = await supabase.from('stock_request_lines').select('*').eq('request_id', reqId).order('product_name');
    if (error || !req) { toast.error('Could not load that request'); return; }
    setHeader(h => ({ ...h, request_id: reqId, store_id: req.store_id, supplier_id: req.supplier_id, short_reasons: {} }));
    setLines((data || []).filter(l => Number(l.issued_quantity) > 0).map(l => {
      const p = productById[l.product_id];
      return { product_id: l.product_id, product_name: l.product_name, sku: l.sku, quantity: Number(l.issued_quantity), max: Number(l.issued_quantity), requested: Number(l.quantity), gone: false, unit_cost: Number(p?.cost_price) || 0, vat_type: p?.vat_type || 'standard' };
    }));
    toast.success(`${req.request_number} loaded: this is what the stock room issued. Lower a quantity only if less arrived.`);
  };

  // Arriving from Stock Requests > Receive
  const reqParam = searchParams.get('request');
  useEffect(() => {
    if (!reqParam || loading || !requests.length || !products.length) return;
    newGrv();
    applyRequest(reqParam);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqParam, loading, requests.length, products.length]);

  const openGrv = async (g) => {
    const { data, error } = await supabase.from('grn_lines').select('*').eq('grn_id', g.id).order('created_at');
    if (error) { toast.error('Could not load lines'); return; }
    setEditingId(g.id); setReadOnly(g.status !== 'draft'); setGrnNumber(g.grn_number);
    setHeader({
      supplier_id: g.supplier_id || "", store_id: g.store_id || "",
      received_date: g.received_date || today(), delivery_note_no: g.delivery_note_no || "", notes: g.notes || "", request_id: g.request_id || "", short_reasons: g.short_reasons || {},
    });
    let reqLines = [];
    if (g.request_id) {
      const rq = await supabase.from('stock_request_lines').select('*').eq('request_id', g.request_id).order('product_name');
      reqLines = rq.data || [];
    }
    const have = new Set((data || []).map(l => l.product_id));
    const base = (data || []).map(l => {
      const rl = reqLines.find(x => x.product_id === l.product_id);
      return {
        product_id: l.product_id, product_name: l.product_name, sku: l.sku,
        quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), vat_type: l.vat_type,
        ...(rl ? { max: Number(rl.issued_quantity), requested: Number(rl.quantity), gone: false } : {}),
      };
    });
    const missing = reqLines.filter(rl => Number(rl.issued_quantity) > 0 && !have.has(rl.product_id)).map(rl => ({
      product_id: rl.product_id, product_name: rl.product_name, sku: rl.sku, quantity: 0,
      max: Number(rl.issued_quantity), requested: Number(rl.quantity), gone: true, unit_cost: 0,
    }));
    setLines([...base, ...missing]);
    setProdSearch(""); setShowPaste(false);
    setOpen(true);
  };

  const addProduct = (p) => {
    setLines(ls => {
      const i = ls.findIndex(l => l.product_id === p.id);
      if (i >= 0) { const c = [...ls]; c[i] = { ...c[i], quantity: Number(c[i].quantity) + 1 }; return c; }
      return [...ls, { product_id: p.id, product_name: p.name, sku: p.sku, quantity: 1, unit_cost: Number(p.cost_price) || 0, vat_type: p.vat_type || 'standard' }];
    });
    setProdSearch("");
    searchRef.current?.focus();
  };

  const matches = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p => p.is_active !== false && (
      (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase() === q
    )).slice(0, 8);
  }, [prodSearch, products]);

  // Enter on an exact SKU/barcode adds it straight away (scanner friendly)
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = prodSearch.trim().toLowerCase();
    if (!q) return;
    const exact = products.find(p => (p.barcode || '').toLowerCase() === q || (p.sku || '').toLowerCase() === q);
    if (exact) addProduct(exact);
    else if (matches.length === 1) addProduct(matches[0]);
    else if (matches.length === 0) toast.error('No product found');
  };

  const setLine = (i, k, v) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const removeLine = (i) => setLines(ls => ls.filter((_, idx) => idx !== i));

  // Paste lines: "SKU or barcode, qty, cost" (cost optional); tab, comma or semicolon separated
  const importPaste = () => {
    const rows = pasteText.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    const missed = [];
    const add = [];
    rows.forEach(r => {
      const [code, qty, cost] = r.split(/[\t,;]/).map(x => x.trim());
      if (!code || /^(sku|barcode|code)$/i.test(code)) return;
      const p = products.find(x => (x.sku || '').toLowerCase() === code.toLowerCase() || (x.barcode || '').toLowerCase() === code.toLowerCase());
      const q = Number(qty);
      if (!p || !(q > 0)) { missed.push(r); return; }
      add.push({ product_id: p.id, product_name: p.name, sku: p.sku, quantity: q, unit_cost: cost !== undefined && cost !== '' && !isNaN(Number(cost)) ? Number(cost) : (Number(p.cost_price) || 0), vat_type: p.vat_type || 'standard' });
    });
    setLines(ls => {
      const c = [...ls];
      add.forEach(a => {
        const i = c.findIndex(l => l.product_id === a.product_id);
        if (i >= 0) c[i] = { ...c[i], quantity: Number(c[i].quantity) + a.quantity, unit_cost: a.unit_cost };
        else c.push(a);
      });
      return c;
    });
    if (add.length) toast.success(`${add.length} line(s) added`);
    if (missed.length) { toast.error(`${missed.length} line(s) not matched`); setPasteText(missed.join('\n')); }
    else { setPasteText(""); setShowPaste(false); }
  };

  const save = async (post) => {
    if (!header.supplier_id) return toast.error('Choose a supplier');
    if (!header.store_id) return toast.error('Choose the store receiving the stock');
    const active = lines.filter(l => !l.gone);
    if (active.length === 0) return toast.error(header.request_id ? 'Nothing was received. Cancel the request instead.' : 'Add at least one product');
    if (active.some(l => !(Number(l.quantity) > 0))) return toast.error('Every line needs a quantity above zero');
    const reasons = {};
    if (header.request_id) {
      for (const l of lines) {
        const short = l.gone || Number(l.quantity) < l.max;
        const why = (header.short_reasons?.[l.product_id] || '').trim();
        if (short && !why) return toast.error(`${l.product_name}: issued ${l.max}, received ${l.gone ? 0 : l.quantity}. Say why it is short`);
        if (short) reasons[l.product_id] = why;
      }
    } else if (simple && !isMgr) {
      return toast.error('Stock room stock is received against a request the stock room has issued. Pick the request first');
    }
    if (post && !window.confirm(`Post ${grnNumber || 'this GRV'} and add stock to ${storeById[header.store_id]?.name || 'the store'}? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('grv_save', {
        p_grn_id: editingId,
        p_header: { ...header, short_reasons: reasons },
        p_lines: active.map(l => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) || 0, vat_type: l.vat_type || productById[l.product_id]?.vat_type || 'standard' })),
        p_post: !!post,
      });
      if (error) throw error;
      writeLast({ store_id: header.store_id, supplier_id: header.supplier_id });
      toast.success(post ? `${data?.grn_number} posted: stock added` : `${data?.grn_number} saved as draft`);
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not save GRV');
    } finally {
      setSaving(false);
    }
  };

  const cancelDraft = async (g) => {
    if (!window.confirm(`Cancel draft ${g.grn_number}?`)) return;
    const { error } = await supabase.rpc('grv_cancel', { p_grn_id: g.id });
    if (error) return toast.error(error.message);
    toast.success('Cancelled');
    load();
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="w-6 h-6" /> Goods Received (GRV)</h1>
          <p className="text-sm text-muted-foreground">Capture every delivery the day it arrives, including stock from the stock room. Posting a GRV adds the quantities to stock, so counts stay accurate.</p>
        </div>
        <Button onClick={newGrv}><Plus className="w-4 h-4 mr-1" /> New GRV</Button>
      </div>

      {staleDrafts.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          {staleDrafts.length} draft GRV{staleDrafts.length > 1 ? 's are' : ' is'} from an earlier day and not posted yet. That stock is physically in the store but not in the system, so it will show as over on a stock count. Open and post {staleDrafts.length > 1 ? 'them' : 'it'}.
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search GRV no., supplier, delivery note" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-x-auto bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3">GRV</th><th className="p-3">Date</th><th className="p-3">Supplier</th>
              <th className="p-3">Store</th><th className="p-3">Delivery note</th>
              <th className="p-3 text-right">Total incl.</th><th className="p-3">Status</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No goods received notes yet</td></tr>
            ) : filtered.map(g => (
              <tr key={g.id} className="border-t hover:bg-muted/30">
                <td className="p-3 font-medium">{g.grn_number}{g.source === 'count_found' && <span className="ml-2 px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-600 text-[10px] font-normal">Found on count</span>}</td>
                <td className="p-3">{g.received_date}</td>
                <td className="p-3">{supplierById[g.supplier_id]?.name || '-'}</td>
                <td className="p-3">{storeById[g.store_id]?.name || '-'}</td>
                <td className="p-3">{g.delivery_note_no || '-'}</td>
                <td className="p-3 text-right">{formatCurrency(g.total_incl || 0)}</td>
                <td className="p-3"><span className={cn("px-2 py-0.5 rounded-full border text-xs capitalize", statusColors[g.status])}>{g.status}</span></td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => openGrv(g)}><Eye className="w-4 h-4 mr-1" />{g.status === 'draft' ? 'Edit' : 'View'}</Button>
                  {g.status === 'draft' && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => cancelDraft(g)}>Cancel</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{grnNumber ? `${grnNumber}${readOnly ? ' (posted)' : ' (draft)'}` : 'New goods received note'}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>Supplier</Label>
              <Select disabled={readOnly} value={header.supplier_id} onValueChange={v => setHeader(h => ({ ...h, supplier_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              {header.supplier_id && simple && <p className="text-xs text-muted-foreground mt-1">Internal source: just scan and enter quantities. No prices or VAT needed.</p>}
              {header.supplier_id && !simple && <p className="text-xs text-muted-foreground mt-1">{vatReg ? 'VAT registered: 15% VAT added on lines set to VAT. Change a line to Zero rated or Non-VAT in the VAT column.' : 'Not VAT registered: no VAT is charged on any line'}</p>}
            </div>
            <div>
              <Label>Receiving store</Label>
              <Select disabled={readOnly} value={header.store_id} onValueChange={v => setHeader(h => ({ ...h, store_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date received</Label>
              <Input type="date" disabled={readOnly} value={header.received_date} onChange={e => setHeader(h => ({ ...h, received_date: e.target.value }))} />
            </div>
            <div>
              <Label>{simple ? 'Reference (optional)' : 'Supplier delivery note no.'}</Label>
              <Input disabled={readOnly} value={header.delivery_note_no} onChange={e => setHeader(h => ({ ...h, delivery_note_no: e.target.value }))} />
            </div>
          </div>

          {!readOnly && simple && !isMgr && !header.request_id && requests.length === 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
              There is nothing issued to this store yet. Stock room stock can only be received once the stock room has issued your request (Stock Requests).
            </div>
          )}
          {!readOnly && (requests.length > 0 || header.request_id) && (
            <div className="max-w-md">
              <Label>Stock request issued by the stock room{simple && !isMgr ? ' (required)' : ' (optional)'}</Label>
              <Select value={header.request_id || "none"} onValueChange={v => applyRequest(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="No request" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No request</SelectItem>
                  {requests.filter(r => !header.store_id || r.store_id === header.store_id).map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.request_number} · {storeById[r.store_id]?.name} · {supplierById[r.supplier_id]?.name}{r.status === 'partial' ? ' (part received)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!readOnly && header.request_id && (
            <p className="text-sm text-muted-foreground">These lines are what the stock room issued. You can only lower a quantity (say why), never raise it.</p>
          )}
          {!readOnly && !header.request_id && (
            <div className="space-y-2">
              <div className="flex gap-2 items-start">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
                  <Input ref={searchRef} className="pl-9 h-11" placeholder="Scan barcode or search product name / SKU, press Enter" value={prodSearch}
                    onChange={e => setProdSearch(e.target.value)} onKeyDown={onSearchKey} />
                  {matches.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-64 overflow-y-auto">
                      {matches.map(p => (
                        <button key={p.id} type="button" onClick={() => addProduct(p)} className="w-full text-left px-3 py-2 hover:bg-muted flex justify-between gap-3 text-sm">
                          <span>{p.name}</span><span className="text-muted-foreground">{p.sku || p.barcode || ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button type="button" variant="outline" className="h-11" onClick={() => setShowPaste(s => !s)}><Upload className="w-4 h-4 mr-1" /> Paste list</Button>
              </div>
              {showPaste && (
                <div className="border rounded-md p-3 space-y-2 bg-muted/30">
                  <p className="text-xs text-muted-foreground">One product per line: SKU or barcode, quantity, unit cost (cost optional). Paste straight from Excel.</p>
                  <textarea className="w-full border rounded-md p-2 text-sm font-mono h-28 bg-background" value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={"SKU001, 24, 85.50\n6001234567890, 12"} />
                  <Button type="button" size="sm" onClick={importPaste}>Add to GRV</Button>
                </div>
              )}
            </div>
          )}

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr><th className="p-2">Product</th><th className="p-2 w-28">Qty</th>{!simple && <><th className="p-2 w-32">Unit cost (excl.)</th><th className="p-2 w-44 text-right">VAT</th><th className="p-2 w-32 text-right">Line total</th></>}<th className="p-2 w-10"></th></tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={simple ? 3 : 6} className="p-6 text-center text-muted-foreground">Scan or search to add products</td></tr>
                ) : lines.map((l, i) => (
                  <Fragment key={l.product_id}>
                  <tr className={cn("border-t", l.gone && "opacity-60")}>
                    <td className="p-2"><div className="font-medium">{l.product_name}</div><div className="text-xs text-muted-foreground">{l.sku}{l.max != null ? ` · requested ${l.requested}, issued ${l.max}` : ''}</div></td>
                    <td className="p-2"><Input type="number" min="0" step="any" max={l.max} disabled={readOnly || l.gone} value={l.gone ? 0 : l.quantity} onChange={e => {
                      let v = e.target.value;
                      if (l.max != null && v !== '' && Number(v) > l.max) v = String(l.max);
                      setLine(i, 'quantity', v);
                    }} /></td>
                    {!simple && <><td className="p-2"><Input type="number" min="0" step="0.01" disabled={readOnly} value={l.unit_cost} onChange={e => setLine(i, 'unit_cost', e.target.value)} /></td>
                    <td className="p-2 text-right">
                      <Select disabled={readOnly} value={l.vat_type || productById[l.product_id]?.vat_type || 'standard'} onValueChange={v => setLine(i, 'vat_type', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">VAT (15%)</SelectItem>
                          <SelectItem value="zero_rated">Zero rated (0%)</SelectItem>
                          <SelectItem value="exempt">Non-VAT</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="text-xs text-muted-foreground mt-1">{formatCurrency(lineVat(l))}</div>
                    </td>
                    <td className="p-2 text-right">{formatCurrency(r2((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)))}</td></>}
                    <td className="p-2">{!readOnly && (l.max != null
                      ? <Button size="sm" variant="ghost" className="text-xs" onClick={() => setLine(i, 'gone', !l.gone)}>{l.gone ? 'Restore' : 'Not received'}</Button>
                      : <Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-red-500" /></Button>)}</td>
                  </tr>
                  {l.max != null && (l.gone || Number(l.quantity) < l.max) && (
                    <tr>
                      <td colSpan={simple ? 3 : 6} className="px-2 pb-2">
                        <Input disabled={readOnly} className="h-8 text-xs border-amber-500/50" placeholder={`Issued ${l.max}, received ${l.gone ? 0 : (l.quantity || 0)}. Why is it short? (required)`}
                          value={header.short_reasons?.[l.product_id] || ''}
                          onChange={e => setHeader(h => ({ ...h, short_reasons: { ...(h.short_reasons || {}), [l.product_id]: e.target.value } }))} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
            <div className="flex-1">
              <Label>Notes</Label>
              <Input disabled={readOnly} value={header.notes} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))} />
            </div>
            <div className={cn("text-sm text-right space-y-0.5 min-w-[220px]", simple && "hidden")}>
              <div className="flex justify-between gap-6"><span className="text-muted-foreground">Total excl. VAT</span><span>{formatCurrency(totals.ex)}</span></div>
              <div className="flex justify-between gap-6"><span className="text-muted-foreground">VAT</span><span>{formatCurrency(totals.vat)}</span></div>
              <div className="flex justify-between gap-6 font-semibold text-base"><span>Total incl. VAT</span><span>{formatCurrency(totals.inc)}</span></div>
            </div>
          </div>

          {!readOnly && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={saving} onClick={() => save(false)}>Save draft</Button>
              <Button disabled={saving} onClick={() => save(true)}>Post and add stock</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
