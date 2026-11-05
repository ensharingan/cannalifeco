import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from '@/api/supabaseClient';
import { Plus, Search, Trash2, ClipboardList, Eye, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCompany } from "../lib/CompanyContext";

const statusStyle = {
  requested: "bg-blue-500/10 text-blue-600 border-blue-200",
  issued: "bg-violet-500/10 text-violet-600 border-violet-200",
  partial: "bg-amber-500/10 text-amber-600 border-amber-200",
  received: "bg-green-500/10 text-green-600 border-green-200",
  cancelled: "bg-red-500/10 text-red-600 border-red-200",
};
const statusLabel = { requested: "Waiting for stock room", issued: "Issued: store must receive", partial: "Part received", received: "Received", cancelled: "Cancelled" };
const MGR = ['owner', 'admin', 'manager', 'superadmin', 'head_office', 'supervisor'];
const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => Number(v) || 0;

async function loadAllProducts(companyId) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('products').select('id, name, sku, barcode, is_active')
      .eq('company_id', companyId).order('name').range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default function StockRequests() {
  const { companyId, role } = useCompany();
  const isMgr = MGR.includes(role);
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);     // { req, lines, qty: {lineId: n}, notes }
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);       // { req, lines }
  const [header, setHeader] = useState({ store_id: "", supplier_id: "", notes: "" });
  const [lines, setLines] = useState([]);
  const [prodSearch, setProdSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [filling, setFilling] = useState(false);
  const searchRef = useRef(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [r, s, st, p, mine] = await Promise.all([
        supabase.from('stock_requests').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(300),
        supabase.from('suppliers').select('id, name, is_internal').eq('company_id', companyId).eq('is_active', true).order('name'),
        supabase.from('stores').select('id, name, is_active').eq('company_id', companyId).order('name'),
        loadAllProducts(companyId),
        supabase.rpc('ws_my_stores'),
      ]);
      const allowed = new Set(mine.data || []);
      setRows(r.data || []);
      setSuppliers(s.data || []);
      setStores((st.data || []).filter(x => x.is_active !== false && allowed.has(x.id)));
      setProducts(p || []);
    } catch (e) { toast.error('Failed to load requests'); }
    finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const supName = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s.name])), [suppliers]);
  const storeName = useMemo(() => Object.fromEntries(stores.map(s => [s.id, s.name])), [stores]);
  const filtered = rows.filter(r => statusFilter === 'all' ? true : statusFilter === 'open' ? ['requested', 'issued', 'partial'].includes(r.status) : r.status === statusFilter);

  const newRequest = () => {
    const internal = suppliers.filter(s => s.is_internal);
    setHeader({
      store_id: stores.length === 1 ? stores[0].id : "",
      supplier_id: internal.length === 1 ? internal[0].id : "",
      notes: "",
    });
    setLines([]); setProdSearch(""); setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 150);
  };

  const matches = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p => p.is_active !== false && ((p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase() === q)).slice(0, 8);
  }, [prodSearch, products]);

  // Fill the request from this store's reorder levels: every product supplied by the chosen
  // supplier (e.g. Stox room) whose stock is at or below its reorder point, ordered at its
  // preferred quantity. Lines already on the request are kept, never overwritten.
  const fillFromReorder = async () => {
    if (!header.store_id || !header.supplier_id) return toast.error('Choose the store and who it is requested from first');
    setFilling(true);
    try {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('store_inventory')
          .select('product_id, stock_quantity, reorder_point, preferred_quantity')
          .eq('company_id', companyId).eq('store_id', header.store_id).eq('supplier_id', header.supplier_id)
          .gt('reorder_point', 0).order('product_id').range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const byId = Object.fromEntries(products.map(p => [p.id, p]));
      const low = rows.filter(r => num(r.stock_quantity) <= num(r.reorder_point) && byId[r.product_id] && byId[r.product_id].is_active !== false);
      if (!rows.length) return toast.info('No reorder levels are set for this store and supplier');
      if (!low.length) return toast.success('Nothing is at or below its reorder level');
      let added = 0, noPref = 0;
      setLines(ls => {
        const have = new Set(ls.map(l => l.product_id));
        const next = [...ls];
        for (const r of low) {
          if (have.has(r.product_id)) continue;
          const pref = num(r.preferred_quantity);
          if (!(pref > 0)) noPref++;
          const qty = pref > 0 ? pref : Math.max(1, num(r.reorder_point) - num(r.stock_quantity));
          const p = byId[r.product_id];
          next.push({ product_id: p.id, product_name: p.name, sku: p.sku, quantity: qty });
          added++;
        }
        return next;
      });
      setTimeout(() => toast.success(`${low.length} item${low.length === 1 ? '' : 's'} at or below reorder level added at their preferred quantity` + (noPref ? ` (${noPref} had no preferred quantity, so the gap to reorder level was used)` : '') + '. Check the quantities, then send.'), 0);
    } catch (e) { toast.error(e.message || 'Could not load reorder levels'); }
    finally { setFilling(false); }
  };

  const addProduct = (p) => {
    setLines(ls => {
      const i = ls.findIndex(l => l.product_id === p.id);
      if (i >= 0) { const c = [...ls]; c[i] = { ...c[i], quantity: num(c[i].quantity) + 1 }; return c; }
      return [...ls, { product_id: p.id, product_name: p.name, sku: p.sku, quantity: 1 }];
    });
    setProdSearch(""); searchRef.current?.focus();
  };
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = prodSearch.trim().toLowerCase();
    if (!q) return;
    const exact = products.find(p => (p.barcode || '').toLowerCase() === q || (p.sku || '').toLowerCase() === q);
    if (exact) addProduct(exact); else if (matches.length === 1) addProduct(matches[0]); else if (!matches.length) toast.error('No product found');
  };

  const send = async () => {
    if (!header.store_id) return toast.error('Choose the store that needs the stock');
    if (!header.supplier_id) return toast.error('Choose who the stock is requested from');
    if (!lines.length) return toast.error('Add at least one product');
    if (lines.some(l => !(num(l.quantity) > 0))) return toast.error('Every line needs a quantity above zero');
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('stock_request_save', {
        p_id: null, p_header: { ...header },
        p_lines: lines.map(l => ({ product_id: l.product_id, quantity: num(l.quantity) })),
      });
      if (error) throw error;
      toast.success(`${data.request_number} sent`);
      setOpen(false); load();
    } catch (e) { toast.error(e.message || 'Could not save the request'); }
    finally { setSaving(false); }
  };

  const openView = async (r) => {
    const { data, error } = await supabase.from('stock_request_lines').select('*').eq('request_id', r.id).order('product_name');
    if (error) return toast.error('Could not load lines');
    setView({ req: r, lines: data || [] });
  };

  const openIssue = async (r) => {
    const { data, error } = await supabase.from('stock_request_lines').select('*').eq('request_id', r.id).order('product_name');
    if (error) return toast.error('Could not load lines');
    setView(null);
    setIssue({ req: r, lines: data || [], qty: Object.fromEntries((data || []).map(l => [l.id, String(num(l.quantity))])), notes: "" });
  };

  const submitIssue = async () => {
    const lines = issue.lines.map(l => ({ line_id: l.id, issued_quantity: num(issue.qty[l.id]) }));
    if (lines.some(l => l.issued_quantity < 0)) return toast.error('Quantities cannot be negative');
    if (!lines.some(l => l.issued_quantity > 0)) return toast.error('Nothing to issue. Cancel the request instead');
    if (!window.confirm(`Issue ${issue.req.request_number} to ${storeName[issue.req.store_id]}? The store will have to receive exactly this.`)) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('stock_request_issue', { p_id: issue.req.id, p_lines: lines, p_notes: issue.notes });
      if (error) throw error;
      toast.success(`${data.request_number} issued: ${data.units} units`);
      setIssue(null); load();
    } catch (e) { toast.error(e.message || 'Could not issue'); }
    finally { setSaving(false); }
  };

  const cancelReq = async (r) => {
    const msg = `Cancel ${r.request_number}?`;
    if (!window.confirm(msg)) return;
    const { error } = await supabase.rpc('stock_request_cancel', { p_id: r.id });
    if (error) return toast.error(error.message);
    setView(null); load();
  };

  const printReq = () => {
    if (!view) return;
    const { req, lines: ls } = view;
    const w = window.open('', '_blank');
    if (!w) return toast.error('Allow pop-ups to print');
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    w.document.write(`<html><head><title>${esc(req.request_number)}</title><style>body{font-family:Arial,sans-serif;padding:24px;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:6px 8px;text-align:left}th:nth-child(n+2),td:nth-child(n+2){text-align:right;width:90px}h2{margin:0}</style></head><body>
      <h2>Stock request ${esc(req.request_number)}</h2>
      <p>Store: <b>${esc(storeName[req.store_id])}</b> &nbsp; From: <b>${esc(supName[req.supplier_id])}</b> &nbsp; Date: ${esc(req.requested_date)}</p>
      ${req.notes ? `<p>${esc(req.notes)}</p>` : ''}
      <table><tr><th>Description</th><th>Requested</th><th>Issued</th><th>Received</th></tr>
      ${ls.map(l => `<tr><td>${esc(l.product_name)}</td><td>${num(l.quantity)}</td><td>${l.issued_quantity == null ? '' : num(l.issued_quantity)}</td><td>${req.status === 'received' ? num(l.received_quantity) : ''}</td></tr>`).join('')}</table>
      <p style="margin-top:28px">Sent by: ____________________ &nbsp;&nbsp; Received by: ____________________</p>
      <script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="w-6 h-6" /> Stock Requests</h1>
          <p className="text-sm text-muted-foreground">Ask the stock room or a supplier for stock. When it arrives, receive it on a GRV against the request so nothing lands on the shelf unrecorded.</p>
        </div>
        <Button onClick={newRequest}><Plus className="w-4 h-4 mr-1" /> New request</Button>
      </div>

      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Waiting for stock</SelectItem>
          <SelectItem value="received">Received</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>

      <div className="border rounded-lg overflow-x-auto bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr><th className="p-3">Request</th><th className="p-3">Date</th><th className="p-3">Store</th><th className="p-3">Requested from</th><th className="p-3">Status</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nothing here</td></tr>
              : filtered.map(r => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-medium">{r.request_number}</td>
                  <td className="p-3">{r.requested_date}</td>
                  <td className="p-3">{storeName[r.store_id] || '-'}</td>
                  <td className="p-3">{supName[r.supplier_id] || '-'}</td>
                  <td className="p-3"><span className={cn("px-2 py-0.5 rounded-full border text-xs", statusStyle[r.status])}>{statusLabel[r.status]}</span></td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => openView(r)}><Eye className="w-4 h-4 mr-1" />View</Button>
                    {r.status === 'requested' && isMgr && <Button size="sm" onClick={() => openIssue(r)}><Truck className="w-4 h-4 mr-1" />Issue stock</Button>}
                    {r.status === 'issued' && <Button size="sm" onClick={() => navigate(`/goods-receiving?request=${r.id}`)}><Truck className="w-4 h-4 mr-1" />Receive</Button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New stock request</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Store that needs the stock</Label>
              <Select value={header.store_id} onValueChange={v => setHeader(h => ({ ...h, store_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Request from</Label>
              <Select value={header.supplier_id} onValueChange={v => setHeader(h => ({ ...h, supplier_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Stock room or supplier" /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <Button type="button" variant="outline" className="w-full gap-2" onClick={fillFromReorder} disabled={filling || !header.store_id || !header.supplier_id}>
            {filling ? 'Checking reorder levels...' : 'Fill from reorder levels (items at or below reorder point)'}
          </Button>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
            <Input ref={searchRef} className="pl-9 h-11" placeholder="Search product name / SKU, press Enter" value={prodSearch} onChange={e => setProdSearch(e.target.value)} onKeyDown={onSearchKey} />
            {matches.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-64 overflow-y-auto">
                {matches.map(p => <button key={p.id} type="button" onClick={() => addProduct(p)} className="w-full text-left px-3 py-2 hover:bg-muted flex justify-between gap-3 text-sm"><span>{p.name}</span><span className="text-muted-foreground">{p.sku || ''}</span></button>)}
              </div>
            )}
          </div>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr><th className="p-2">Product</th><th className="p-2 w-28">Qty</th><th className="p-2 w-10"></th></tr></thead>
              <tbody>
                {lines.length === 0 ? <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">Search to add the products you need</td></tr>
                  : lines.map((l, i) => (
                    <tr key={l.product_id} className="border-t">
                      <td className="p-2"><div className="font-medium">{l.product_name}</div><div className="text-xs text-muted-foreground">{l.sku}</div></td>
                      <td className="p-2"><Input type="number" min="0" step="any" value={l.quantity} onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} /></td>
                      <td className="p-2"><Button size="icon" variant="ghost" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}><Trash2 className="w-4 h-4 text-red-500" /></Button></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={header.notes} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button disabled={saving} onClick={send}>Send request</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!view} onOpenChange={o => { if (!o) setView(null); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          {view && (<>
            <DialogHeader><DialogTitle>{view.req.request_number}: {storeName[view.req.store_id]} from {supName[view.req.supplier_id]}</DialogTitle></DialogHeader>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-2">Product</th><th className="p-2 text-right">Requested</th><th className="p-2 text-right">Issued</th><th className="p-2 text-right">Received</th></tr></thead>
                <tbody>
                  {view.lines.map(l => {
                    const iss = l.issued_quantity == null ? null : num(l.issued_quantity);
                    const done = view.req.status === 'received';
                    const short = done && iss != null && num(l.received_quantity) < iss;
                    const notIssued = iss != null && iss < num(l.quantity);
                    return (
                      <tr key={l.id} className="border-t">
                        <td className="p-2">{l.product_name}{short && l.short_reason && <div className="text-xs text-amber-600">Short: {l.short_reason}</div>}</td>
                        <td className="p-2 text-right tabular-nums">{num(l.quantity)}</td>
                        <td className={cn("p-2 text-right tabular-nums", notIssued && "text-amber-600")}>{iss == null ? '-' : iss}</td>
                        <td className={cn("p-2 text-right tabular-nums", short && "text-red-500 font-medium")}>{done ? num(l.received_quantity) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={printReq}>Print</Button>
              {(view.req.status === 'requested' || (view.req.status === 'issued' && isMgr)) && <Button variant="outline" className="text-red-600" onClick={() => cancelReq(view.req)}>Cancel request</Button>}
              {view.req.status === 'requested' && isMgr && <Button onClick={() => openIssue(view.req)}>Issue stock</Button>}
              {view.req.status === 'issued' && <Button onClick={() => navigate(`/goods-receiving?request=${view.req.id}`)}>Receive stock</Button>}
            </div>
          </>)}
        </DialogContent>
      </Dialog>

      <Dialog open={!!issue} onOpenChange={o => { if (!o) setIssue(null); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          {issue && (<>
            <DialogHeader><DialogTitle>Issue {issue.req.request_number} to {storeName[issue.req.store_id]}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Enter what you are actually sending. The store can only receive up to this amount, so count it before you confirm. Use 0 for anything you cannot send.</p>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-2">Product</th><th className="p-2 text-right w-28">Requested</th><th className="p-2 w-32">Issuing</th></tr></thead>
                <tbody>
                  {issue.lines.map(l => (
                    <tr key={l.id} className="border-t">
                      <td className="p-2">{l.product_name}</td>
                      <td className="p-2 text-right tabular-nums">{num(l.quantity)}</td>
                      <td className="p-2"><Input type="number" min="0" max={num(l.quantity)} step="any" value={issue.qty[l.id]}
                        onChange={e => { let v = e.target.value; if (v !== '' && Number(v) > num(l.quantity)) v = String(num(l.quantity)); setIssue(s => ({ ...s, qty: { ...s.qty, [l.id]: v } })); }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={issue.notes} onChange={e => setIssue(s => ({ ...s, notes: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIssue(null)}>Close</Button>
              <Button disabled={saving} onClick={submitIssue}>Issue stock</Button>
            </div>
          </>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
