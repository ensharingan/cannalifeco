import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from '@/api/supabaseClient';
import { Plus, Search, Trash2, Printer, ArrowRightLeft, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCompany } from "../lib/CompanyContext";

const today = () => new Date().toISOString().slice(0, 10);
const emptyHeader = () => ({ from_store_id: "", to_store_id: "", transfer_date: today(), dispatched_by_name: "", driver_name: "", vehicle_reg: "", notes: "" });
const STATUS_LABEL = { dispatched: 'In transit', received: 'Received', received_variance: 'Shortfall', variance_closed: 'Shortfall closed', cancelled: 'Cancelled' };
const STATUS_CLS = {
  dispatched: "bg-blue-500/10 text-blue-500 border-blue-500/30", received: "bg-green-500/10 text-green-500 border-green-500/30",
  received_variance: "bg-amber-500/10 text-amber-500 border-amber-500/30", variance_closed: "bg-muted text-muted-foreground border-border", cancelled: "bg-muted text-muted-foreground border-border",
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function StockTransfers() {
  const { companyId } = useCompany();
  const [notes, setNotes] = useState([]);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState({});          // product_id -> qty at source store
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [header, setHeader] = useState(emptyHeader());
  const [lines, setLines] = useState([]);
  const [prodSearch, setProdSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const searchRef = useRef(null);
  const { role } = useCompany();
  const isMgr = ['owner', 'admin', 'manager', 'superadmin', 'head_office', 'supervisor'].includes(role);
  const [myStores, setMyStores] = useState([]);
  const [rcv, setRcv] = useState(null);            // { note, lines, counts, reasons, name, notes }
  const [detail, setDetail] = useState(null);      // { note, lines }

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [n, s, mine] = await Promise.all([
      supabase.from('stock_transfer_notes').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(300),
      supabase.from('stores').select('id, name').eq('company_id', companyId).order('name'),
      supabase.rpc('ws_my_stores'),
    ]);
    setNotes(n.data || []); setStores(s.data || []); setMyStores(mine.data || []);
    setLoading(false);
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  // Stock at the source store, plus the products that have any (only those can be sent)
  useEffect(() => {
    if (!header.from_store_id) { setStock({}); setProducts([]); return; }
    (async () => {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from('store_inventory').select('product_id, stock_quantity, products(id, name, sku, barcode)')
          .eq('store_id', header.from_store_id).gt('stock_quantity', 0).range(from, from + 999);
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      setStock(Object.fromEntries(rows.map(r => [r.product_id, Number(r.stock_quantity)])));
      setProducts(rows.map(r => r.products).filter(Boolean));
    })();
  }, [header.from_store_id]);

  const stName = useMemo(() => Object.fromEntries(stores.map(s => [s.id, s.name])), [stores]);

  const matches = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase() === q).slice(0, 8);
  }, [prodSearch, products]);

  const addProduct = (p) => {
    setLines(ls => ls.some(l => l.product_id === p.id) ? ls.map(l => l.product_id === p.id ? { ...l, quantity: Number(l.quantity) + 1 } : l)
      : [...ls, { product_id: p.id, product_name: p.name, sku: p.sku, quantity: 1 }]);
    setProdSearch(""); searchRef.current?.focus();
  };

  const printNote = async (n) => {
    const { data } = await supabase.from('stock_transfer_note_lines').select('*').eq('note_id', n.id).order('product_name');
    const w = window.open('', '_blank');
    if (!w) return toast.error('Allow pop-ups to print');
    const rows = (data || []).map(l => `<tr><td>${esc(l.sku)}</td><td>${esc(l.product_name)}</td><td style="text-align:right">${l.quantity}</td></tr>`).join('');
    const sig = (label, extra) => `<div style="flex:1;margin:0 12px"><div style="border-bottom:1px solid #000;height:46px"></div><div style="font-size:12px;margin-top:4px">${label}${extra ? '<br>' + esc(extra) : ''}</div></div>`;
    w.document.write(`<html><head><title>${esc(n.transfer_number)}</title><style>body{font-family:Arial;padding:28px;font-size:14px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left}</style></head><body>
      <h2 style="margin:0">Inter-store Delivery Note</h2><h3 style="margin:4px 0 14px">${esc(n.transfer_number)}</h3>
      <table style="margin:0"><tr><td><b>From:</b> ${esc(stName[n.from_store_id])}</td><td><b>To:</b> ${esc(stName[n.to_store_id])}</td></tr>
      <tr><td><b>Date:</b> ${esc(n.transfer_date)}</td><td><b>Driver / vehicle:</b> ${esc(n.driver_name)} ${esc(n.vehicle_reg)}</td></tr></table>
      <table><tr><th>SKU</th><th>Product</th><th style="text-align:right">Qty</th></tr>${rows}</table>
      <p>${esc(n.notes)}</p>
      <div style="display:flex;margin-top:50px">${sig('Dispatched by (name and signature)', n.dispatched_by_name)}${sig('Driver (signature)', n.driver_name)}${sig('Received by (name and signature)', n.received_by_name)}</div>
      <div style="display:flex;margin-top:30px">${sig('Date and time received', n.received_at ? new Date(n.received_at).toLocaleString('en-ZA') : '')}</div>
      </body></html>`);
    w.document.close(); w.print();
  };

  const save = async () => {
    if (!header.from_store_id || !header.to_store_id) return toast.error('Choose both stores');
    if (header.from_store_id === header.to_store_id) return toast.error('Source and destination must be different');
    if (lines.length === 0) return toast.error('Add at least one product');
    if (!window.confirm(`Dispatch stock from ${stName[header.from_store_id]} to ${stName[header.to_store_id]}? It leaves ${stName[header.from_store_id]} now and lands at ${stName[header.to_store_id]} when they confirm the count.`)) return;
    setSaving(true);
    const { data, error } = await supabase.rpc('transfer_create', {
      p_header: header, p_lines: lines.map(l => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${data.transfer_number} created`);
    setOpen(false);
    await load();
    const { data: n } = await supabase.from('stock_transfer_notes').select('*').eq('id', data.id).single();
    if (n) printNote(n);
  };

  const openReceive = async (n) => {
    const { data } = await supabase.from('stock_transfer_note_lines').select('*').eq('note_id', n.id).order('product_name');
    const counts = {}; (data || []).forEach(l => { counts[l.id] = String(l.quantity); });
    setRcv({ note: n, lines: data || [], counts, reasons: {}, name: "", notes: "" });
  };
  const confirmReceive = async () => {
    const { note, lines: ls, counts, reasons, name, notes: rn } = rcv;
    if (!name.trim()) return toast.error('Enter the name of the person receiving');
    const payload = ls.map(l => ({ line_id: l.id, received_quantity: Number(counts[l.id]), reason: reasons[l.id] || null }));
    if (payload.some(x => isNaN(x.received_quantity))) return toast.error('Count every product');
    setSaving(true);
    const { data, error } = await supabase.rpc('transfer_receive', { p_id: note.id, p_name: name, p_lines: payload, p_notes: rn || null });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(data.variance ? `${note.transfer_number} received with a shortfall: a manager has to resolve it` : `${note.transfer_number} received, stock added`);
    setRcv(null); load();
  };
  const openDetail = async (n) => {
    const { data } = await supabase.from('stock_transfer_note_lines').select('*').eq('note_id', n.id).order('product_name');
    setDetail({ note: n, lines: data || [] });
  };
  const resolve = async (n, action) => {
    const { error } = await supabase.rpc('transfer_resolve_variance', { p_id: n.id, p_action: action });
    if (error) return toast.error(error.message);
    toast.success(action === 'return_to_source' ? 'Shortfall returned to the sending store' : 'Shortfall written off');
    setDetail(null); load();
  };
  const cancelNote = async (n) => {
    if (!window.confirm(`Cancel ${n.transfer_number} and put the stock back at ${stName[n.from_store_id]}?`)) return;
    const { error } = await supabase.rpc('transfer_cancel', { p_id: n.id });
    if (error) return toast.error(error.message);
    toast.success('Cancelled, stock returned'); load();
  };

  const q = search.toLowerCase();
  const filtered = notes.filter(n => !q || n.transfer_number.toLowerCase().includes(q) || (stName[n.from_store_id] || '').toLowerCase().includes(q) || (stName[n.to_store_id] || '').toLowerCase().includes(q));

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ArrowRightLeft className="w-6 h-6" /> Stock Transfers</h1>
          <p className="text-sm text-muted-foreground">Dispatch stock to another store and print the delivery note. Stock only lands at the receiving store once they count it in.</p>
        </div>
        <Button onClick={() => { setHeader(emptyHeader()); setLines([]); setProdSearch(""); setOpen(true); }}><Plus className="w-4 h-4 mr-1" /> New transfer</Button>
      </div>
      <div className="relative max-w-md"><Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search transfer no. or store" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="border rounded-lg overflow-x-auto bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left"><tr><th className="p-3">Transfer</th><th className="p-3">Date</th><th className="p-3">From</th><th className="p-3">To</th><th className="p-3">Driver</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No transfers yet</td></tr>
              : filtered.map(n => (
                <tr key={n.id} className="border-t">
                  <td className="p-3 font-medium">{n.transfer_number}</td><td className="p-3">{n.transfer_date}</td>
                  <td className="p-3">{stName[n.from_store_id]}</td><td className="p-3">{stName[n.to_store_id]}</td><td className="p-3">{n.driver_name || '-'}</td>
                  <td className="p-3"><span className={cn("px-2 py-0.5 rounded-full border text-xs", STATUS_CLS[n.status])}>{STATUS_LABEL[n.status]}{n.received_by_name ? ` · ${n.received_by_name}` : ''}</span></td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => printNote(n)}><Printer className="w-4 h-4 mr-1" /> Delivery note</Button>
                    <Button size="sm" variant="ghost" onClick={() => openDetail(n)}>View</Button>
                    {n.status === 'dispatched' && myStores.includes(n.to_store_id) && <Button size="sm" onClick={() => openReceive(n)}>Receive stock</Button>}
                    {n.status === 'dispatched' && myStores.includes(n.from_store_id) && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => cancelNote(n)}>Cancel</Button>}
                    {n.status === 'received_variance' && isMgr && <Button size="sm" variant="outline" onClick={() => openDetail(n)}><AlertTriangle className="w-4 h-4 mr-1 text-amber-500" />Resolve shortfall</Button>}
                  </td>
                </tr>))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New stock transfer</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>From store</Label>
              <Select value={header.from_store_id} onValueChange={v => { setHeader(h => ({ ...h, from_store_id: v })); setLines([]); }}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{stores.filter(s => myStores.includes(s.id)).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>To store</Label>
              <Select value={header.to_store_id} onValueChange={v => setHeader(h => ({ ...h, to_store_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{stores.filter(s => s.id !== header.from_store_id).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Date</Label><Input type="date" value={header.transfer_date} onChange={e => setHeader(h => ({ ...h, transfer_date: e.target.value }))} /></div>
            <div><Label>Dispatched by</Label><Input value={header.dispatched_by_name} onChange={e => setHeader(h => ({ ...h, dispatched_by_name: e.target.value }))} /></div>
            <div><Label>Driver / courier</Label><Input value={header.driver_name} onChange={e => setHeader(h => ({ ...h, driver_name: e.target.value }))} /></div>
            <div><Label>Vehicle reg.</Label><Input value={header.vehicle_reg} onChange={e => setHeader(h => ({ ...h, vehicle_reg: e.target.value }))} /></div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
            <Input ref={searchRef} disabled={!header.from_store_id} className="pl-9 h-11" placeholder={header.from_store_id ? "Search product in stock at the source store" : "Choose the source store first"} value={prodSearch} onChange={e => setProdSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && matches.length === 1) { e.preventDefault(); addProduct(matches[0]); } }} />
            {matches.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-64 overflow-y-auto">
                {matches.map(p => <button key={p.id} type="button" onClick={() => addProduct(p)} className="w-full text-left px-3 py-2 hover:bg-muted flex justify-between gap-3 text-sm"><span>{p.name}</span><span className="text-muted-foreground">{stock[p.id]} in stock</span></button>)}
              </div>)}
          </div>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr><th className="p-2">Product</th><th className="p-2 w-24">Available</th><th className="p-2 w-28">Send</th><th className="p-2 w-10"></th></tr></thead>
              <tbody>
                {lines.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Search to add products</td></tr>
                  : lines.map((l, i) => (
                    <tr key={l.product_id} className="border-t">
                      <td className="p-2"><div className="font-medium">{l.product_name}</div><div className="text-xs text-muted-foreground">{l.sku}</div></td>
                      <td className="p-2">{stock[l.product_id] ?? 0}</td>
                      <td className="p-2"><Input type="number" min="0" step="any" className={Number(l.quantity) > (stock[l.product_id] || 0) ? "border-amber-500" : ""} value={l.quantity} onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} /></td>
                      <td className="p-2"><Button size="icon" variant="ghost" onClick={() => setLines(ls => ls.filter((_, x) => x !== i))}><Trash2 className="w-4 h-4 text-red-500" /></Button></td>
                    </tr>))}
              </tbody>
            </table>
          </div>
          <div><Label>Notes</Label><Input value={header.notes} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))} /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Close</Button><Button disabled={saving} onClick={save}>Dispatch and print delivery note</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rcv} onOpenChange={o => !o && setRcv(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Receive {rcv?.note.transfer_number} at {rcv && stName[rcv.note.to_store_id]}</DialogTitle></DialogHeader>
          {rcv && (<>
            <p className="text-sm text-muted-foreground">Count what is physically in the delivery. If a count is lower than sent, say why. Stock is added to your store only for what you count.</p>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-2">Product</th><th className="p-2 w-20 text-right">Sent</th><th className="p-2 w-28">Counted</th><th className="p-2">Reason if short</th></tr></thead>
                <tbody>
                  {rcv.lines.map(l => {
                    const short = Number(rcv.counts[l.id]) < Number(l.quantity);
                    return (
                      <tr key={l.id} className="border-t">
                        <td className="p-2"><div className="font-medium">{l.product_name}</div><div className="text-xs text-muted-foreground">{l.sku}</div></td>
                        <td className="p-2 text-right">{l.quantity}</td>
                        <td className="p-2"><Input type="number" min="0" max={l.quantity} step="any" className={short ? "border-amber-500" : ""} value={rcv.counts[l.id]} onChange={e => setRcv(r => ({ ...r, counts: { ...r.counts, [l.id]: e.target.value } }))} /></td>
                        <td className="p-2">{short && <Input placeholder="Missing / damaged..." value={rcv.reasons[l.id] || ""} onChange={e => setRcv(r => ({ ...r, reasons: { ...r.reasons, [l.id]: e.target.value } }))} />}</td>
                      </tr>);
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>Received by (name)</Label><Input value={rcv.name} onChange={e => setRcv(r => ({ ...r, name: e.target.value }))} /></div>
              <div><Label>Notes</Label><Input value={rcv.notes} onChange={e => setRcv(r => ({ ...r, notes: e.target.value }))} /></div>
            </div>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRcv(null)}>Close</Button><Button disabled={saving} onClick={confirmReceive}>Confirm and add stock</Button></div>
          </>)}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{detail?.note.transfer_number} · {detail && STATUS_LABEL[detail.note.status]}</DialogTitle></DialogHeader>
          {detail && (<>
            <p className="text-sm text-muted-foreground">{stName[detail.note.from_store_id]} to {stName[detail.note.to_store_id]}{detail.note.driver_name ? ` · driver ${detail.note.driver_name}` : ''}{detail.note.vehicle_reg ? ` · ${detail.note.vehicle_reg}` : ''}</p>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-2">Product</th><th className="p-2 text-right">Sent</th><th className="p-2 text-right">Counted</th><th className="p-2">Reason</th></tr></thead>
                <tbody>{detail.lines.map(l => (
                  <tr key={l.id} className="border-t">
                    <td className="p-2">{l.product_name}</td><td className="p-2 text-right">{l.quantity}</td>
                    <td className={cn("p-2 text-right", l.received_quantity != null && Number(l.received_quantity) < Number(l.quantity) && "text-amber-500 font-medium")}>{l.received_quantity ?? '-'}</td>
                    <td className="p-2 text-muted-foreground">{l.variance_reason || ''}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            {detail.note.receive_notes && <p className="text-sm text-muted-foreground">Receiver note: {detail.note.receive_notes}</p>}
            {detail.note.status === 'received_variance' && isMgr && (
              <div className="flex gap-2 justify-end">
                <Button onClick={() => resolve(detail.note, 'return_to_source')}>Return shortfall to {stName[detail.note.from_store_id]}</Button>
                <Button variant="outline" onClick={() => resolve(detail.note, 'write_off')}>Write off shortfall</Button>
              </div>)}
          </>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
