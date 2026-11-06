import { useState, useMemo, useEffect, useRef } from "react";
import { supabase } from '@/api/supabaseClient';
import { Trash2, ClipboardPaste, AlertTriangle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { parsePasteList, buildIndex, matchItem } from "@/lib/pasteList";

const num = (v) => Number(v) || 0;
const SEARCH = '__search__';
let uid = 0;

async function loadStoreInventory(companyId, storeId) {
  const out = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('store_inventory')
      .select('product_id, stock_quantity, reorder_point, preferred_quantity')
      .eq('company_id', companyId).eq('store_id', storeId).order('product_id').range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) out[r.product_id] = r;
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Paste a WhatsApp-style list ("Name +qty" under headings), check every line, fix quantities, send.
export default function PasteStockList({ open, onOpenChange, companyId, products, stores, suppliers, defaultStoreId, defaultSupplierId, onSent }) {
  const [text, setText] = useState("");
  const [groups, setGroups] = useState([]);   // { key, label, store_id, rows: [...] }
  const [warnings, setWarnings] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [inv, setInv] = useState({});         // store_id -> { product_id: row }
  const [sending, setSending] = useState(false);
  const index = useMemo(() => buildIndex(products), [products]);
  const byId = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const loadedInv = useRef(new Set());

  useEffect(() => { if (open) { setSupplierId(defaultSupplierId || ""); } }, [open, defaultSupplierId]);

  // Load each chosen store's stock + reorder levels so quantities can be sanity-checked.
  useEffect(() => {
    const ids = [...new Set(groups.map(g => g.store_id).filter(Boolean))].filter(id => !loadedInv.current.has(id));
    ids.forEach(async (id) => {
      loadedInv.current.add(id);
      try { const d = await loadStoreInventory(companyId, id); setInv(s => ({ ...s, [id]: d })); }
      catch { loadedInv.current.delete(id); }
    });
  }, [groups, companyId]);

  const read = () => {
    if (!text.trim()) return toast.error('Paste the list first');
    const { groups: gs, warnings: w } = parsePasteList(text, stores);
    if (!gs.length) return toast.error('No "name +qty" lines found');
    setWarnings(w);
    setGroups(gs.map(g => ({
      key: ++uid, label: g.label,
      store_id: g.store_id || (gs.length === 1 ? (defaultStoreId || "") : ""),
      rows: g.items.map(it => {
        const m = matchItem(it, index);
        return { id: ++uid, raw: it.raw, name: it.name, qty: String(it.qty), cat: it.cat, size: it.size, product_id: m.product_id, conf: m.conf, cands: m.cands, searching: false, q: "" };
      }),
    })));
  };

  const setRow = (gk, rid, patch) => setGroups(gs => gs.map(g => g.key !== gk ? g : { ...g, rows: g.rows.map(r => r.id === rid ? { ...r, ...patch } : r) }));
  const delRow = (gk, rid) => setGroups(gs => gs.map(g => g.key !== gk ? g : { ...g, rows: g.rows.filter(r => r.id !== rid) }).filter(g => g.rows.length));
  const setGroup = (gk, patch) => setGroups(gs => gs.map(g => g.key === gk ? { ...g, ...patch } : g));

  const searchMatches = (q) => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return products.filter(p => p.is_active !== false && ((p.name || '').toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s))).slice(0, 8);
  };

  const total = groups.reduce((a, g) => a + g.rows.length, 0);
  const unmatched = groups.reduce((a, g) => a + g.rows.filter(r => !r.product_id).length, 0);
  const badQty = groups.reduce((a, g) => a + g.rows.filter(r => !(num(r.qty) > 0)).length, 0);
  const noStore = groups.filter(g => !g.store_id).length;
  const canSend = total > 0 && !unmatched && !badQty && !noStore && !!supplierId && !sending;

  const send = async () => {
    if (!canSend) return;
    const summary = groups.map(g => {
      const merged = new Set(g.rows.map(r => r.product_id)).size;
      return `${stores.find(s => s.id === g.store_id)?.name}: ${merged} products`;
    }).join('\n');
    if (!window.confirm(`Send ${groups.length} stock request${groups.length === 1 ? '' : 's'}?\n\n${summary}`)) return;
    setSending(true);
    let remaining = [...groups];
    try {
      for (const g of groups) {
        const merged = {};
        for (const r of g.rows) merged[r.product_id] = (merged[r.product_id] || 0) + num(r.qty);   // same product twice -> one line
        const { data, error } = await supabase.rpc('stock_request_save', {
          p_id: null,
          p_header: { store_id: g.store_id, supplier_id: supplierId, notes: notes || "" },
          p_lines: Object.entries(merged).map(([product_id, quantity]) => ({ product_id, quantity })),
        });
        if (error) throw error;
        toast.success(`${data.request_number} sent`);
        remaining = remaining.filter(x => x.key !== g.key);
        setGroups(remaining);
      }
      setText(""); setGroups([]); onOpenChange(false); onSent?.();
    } catch (e) {
      toast.error((e.message || 'Could not save') + (remaining.length ? '. The remaining lists are still here to retry.' : ''));
      onSent?.();
    } finally { setSending(false); }
  };

  const close = () => { onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[94vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardPaste className="w-5 h-5" /> Paste stock list</DialogTitle></DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Request from</Label>
            <Select value={supplierId || undefined} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Stock room or supplier" /></SelectTrigger>
              <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes (optional, added to every request)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Paste the list (WhatsApp text is fine, several stores in one paste is fine)</Label>
          <Textarea rows={groups.length ? 4 : 10} value={text} onChange={e => setText(e.target.value)}
            placeholder={"NXT LVL\nPRE ROLL :\n420 +50\nBAGS :\nGH 10g\nChocolate diesel +3\n..."} className="font-mono text-xs" />
          <div className="flex justify-end mt-2">
            <Button onClick={read}>{groups.length ? 'Read list again' : 'Read list'}</Button>
          </div>
        </div>

        {warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">{w}</p>)}

        {groups.map(g => {
          const stInv = inv[g.store_id] || {};
          const seen = {};
          g.rows.forEach(r => { if (r.product_id) seen[r.product_id] = (seen[r.product_id] || 0) + 1; });
          return (
            <div key={g.key} className="border rounded-lg">
              <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/40 rounded-t-lg">
                <div className="font-semibold">{g.label || 'List'}</div>
                <div className="flex items-center gap-2 ml-auto">
                  <Label className="text-xs">Store that needs the stock</Label>
                  <Select value={g.store_id || undefined} onValueChange={v => setGroup(g.key, { store_id: v })}>
                    <SelectTrigger className={cn("w-64", !g.store_id && "border-red-400")}><SelectValue placeholder="Select store" /></SelectTrigger>
                    <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="p-2">Pasted as</th><th className="p-2">Matched product</th><th className="p-2 w-24">Qty</th><th className="p-2 w-20 text-right">In store</th><th className="p-2 w-24 text-right">Usual order</th><th className="p-2 w-10"></th></tr>
                  </thead>
                  <tbody>
                    {g.rows.map(r => {
                      const si = r.product_id ? stInv[r.product_id] : null;
                      const dup = r.product_id && seen[r.product_id] > 1;
                      const pref = si ? num(si.preferred_quantity) : 0;
                      const big = pref > 0 && num(r.qty) > pref * 2;
                      return (
                        <tr key={r.id} className={cn("border-t align-top", !r.product_id && "bg-red-500/5", r.conf === 'check' && r.product_id && "bg-amber-500/5")}>
                          <td className="p-2 whitespace-nowrap">
                            <div>{r.name}</div>
                            <div className="text-xs text-muted-foreground">{r.cat}{r.size ? ` ${r.size}g` : ''}</div>
                          </td>
                          <td className="p-2 min-w-[260px]">
                            {r.searching ? (
                              <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-3 text-muted-foreground" />
                                <Input autoFocus className="pl-8 h-9" placeholder="Search product name / SKU" value={r.q} onChange={e => setRow(g.key, r.id, { q: e.target.value })} />
                                {r.q.trim() && (
                                  <div className="absolute z-20 left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-56 overflow-y-auto">
                                    {searchMatches(r.q).map(p => (
                                      <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between gap-3"
                                        onClick={() => setRow(g.key, r.id, { product_id: p.id, conf: 'good', searching: false, q: "", cands: r.cands.some(c => c.id === p.id) ? r.cands : [{ id: p.id, name: p.name, sku: p.sku }, ...r.cands] })}>
                                        <span>{p.name}</span><span className="text-muted-foreground">{p.sku || ''}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <Select value={r.product_id || undefined} onValueChange={v => v === SEARCH ? setRow(g.key, r.id, { searching: true }) : setRow(g.key, r.id, { product_id: v, conf: 'good' })}>
                                <SelectTrigger className={cn("h-9", !r.product_id && "border-red-400")}><SelectValue placeholder="No match: pick or search" /></SelectTrigger>
                                <SelectContent>
                                  {r.product_id && !r.cands.some(c => c.id === r.product_id) && byId[r.product_id] && <SelectItem value={r.product_id}>{byId[r.product_id].name}</SelectItem>}
                                  {r.cands.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                  <SelectItem value={SEARCH}>Search another product...</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                            {r.conf === 'check' && r.product_id && !r.searching && <div className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Check this match</div>}
                            {dup && <div className="text-xs text-amber-600 mt-1">Listed more than once: quantities will be added together</div>}
                          </td>
                          <td className="p-2">
                            <Input type="number" min="0" step="any" className={cn("h-9", !(num(r.qty) > 0) && "border-red-400", big && "border-amber-400")} value={r.qty} onChange={e => setRow(g.key, r.id, { qty: e.target.value })} />
                            {big && <div className="text-xs text-amber-600 mt-1">Over 2x usual</div>}
                          </td>
                          <td className="p-2 text-right tabular-nums pt-4">{g.store_id ? (si ? num(si.stock_quantity) : '-') : ''}</td>
                          <td className="p-2 text-right tabular-nums pt-4">{si && pref > 0 ? pref : '-'}</td>
                          <td className="p-2"><Button size="icon" variant="ghost" onClick={() => delRow(g.key, r.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {groups.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {total} lines in {groups.length} request{groups.length === 1 ? '' : 's'}.
              {unmatched > 0 && <span className="text-red-500"> {unmatched} unmatched: pick the product or remove the line.</span>}
              {badQty > 0 && <span className="text-red-500"> {badQty} with no quantity.</span>}
              {noStore > 0 && <span className="text-red-500"> Choose a store for {noStore === 1 ? 'one list' : `${noStore} lists`}.</span>}
              {!supplierId && <span className="text-red-500"> Choose who to request from.</span>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={close}>Close</Button>
              <Button disabled={!canSend} onClick={send}>{sending ? 'Sending...' : `Send ${groups.length} request${groups.length === 1 ? '' : 's'}`}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
