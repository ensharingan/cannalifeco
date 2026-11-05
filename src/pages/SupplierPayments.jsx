import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useCompany } from "../lib/CompanyContext";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrency } from "../lib/currency";
import {
  DollarSign, Plus, Search, Eye, CreditCard, Truck, AlertTriangle,
  CheckCircle, Clock, Receipt, Wallet, Trash2, Edit, Phone, Mail, Users, Package, XCircle,
  Warehouse, PackageCheck, Copy, Send, MessageCircle, ClipboardList
} from "lucide-react";

const STATUS_STYLES = {
  unpaid:       "bg-red-500/10 text-red-400 border-red-500/20",
  partial:      "bg-amber-500/10 text-amber-400 border-amber-500/20",
  paid:         "bg-green-500/10 text-green-400 border-green-500/20",
  consignment:  "bg-purple-500/10 text-purple-400 border-purple-500/20",
  ordered:      "bg-sky-500/10 text-sky-400 border-sky-500/20",
  cancelled:    "bg-muted text-muted-foreground border-border",
};

const STATUS_ICONS = {
  unpaid: AlertTriangle, partial: Clock, paid: CheckCircle,
  consignment: Package, cancelled: XCircle, ordered: ClipboardList,
};

const today = () => new Date().toISOString().split("T")[0];

// Safely unwrap items — the column has historically been stored as a JSON string
const parseItems = (raw) => {
  let v = raw;
  try {
    if (typeof v === "string") v = JSON.parse(v);
    if (typeof v === "string") v = JSON.parse(v); // double-encoded legacy rows
  } catch (_) { return []; }
  return Array.isArray(v) ? v : [];
};

export default function SupplierPayments() {
  const { companyId, activeStoreId, company, stores, role } = useCompany();
  const { profile } = useAuth();
  // Reorder lists are drawn up by named people only (profiles.extra_pages has 'reorder_list'), plus owners/admins.
  const canReorder = ['owner', 'admin', 'superadmin'].includes(role) || (Array.isArray(profile?.extra_pages) && profile.extra_pages.includes('reorder_list'));
  const [suppliers, setSuppliers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [activeTab, setActiveTab] = useState("suppliers");

  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [editSupplier, setEditSupplier] = useState(null);
  const [showNewOrder, setShowNewOrder] = useState(false);
  // 'receive' = record a delivery (original flow); 'order' = raise an order to send to the supplier
  const [orderMode, setOrderMode] = useState("receive");
  const [receivingPoId, setReceivingPoId] = useState(null);
  const [reorderLoading, setReorderLoading] = useState(false);
  // Bulk reorder: one draft PO per supplier for a store, from reorder point + preferred quantity
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStoreId, setBulkStoreId] = useState("");
  const [bulkPlan, setBulkPlan] = useState(null); // { groups: [{supplier_id, supplier_name, lines: [...]}], noSupplier: [...], onOrder: n }
  const [bulkBusy, setBulkBusy] = useState(false);
  const autoFillKey = useRef("");
  const [showPayment, setShowPayment] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Stock application state
  const [applyingStockId, setApplyingStockId] = useState(null);

  // Edit order state
  const [editOrder, setEditOrder] = useState(null);
  const [editOrderForm, setEditOrderForm] = useState({});
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  // Copy PO to other stores state
  const [copyOrder, setCopyOrder] = useState(null);
  const [copyStoreIds, setCopyStoreIds] = useState([]);
  const [isCopying, setIsCopying] = useState(false);

  // Write-off state
  const [writeOffOrder, setWriteOffOrder] = useState(null);
  const [writeOffReason, setWriteOffReason] = useState("");
  const [isWritingOff, setIsWritingOff] = useState(false);

  const emptySupplierForm = { name: "", contact_name: "", phone: "", email: "", address: "", notes: "", vat_number: "", registration_number: "" };
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);

  const emptyOrderForm = { supplier_id: "", store_id: "", order_number: "", invoice_total: "", notes: "", items: [], payment_type: "terms", order_date: today(), update_stock: true, short_resolution: "credit" };
  const [orderForm, setOrderForm] = useState(emptyOrderForm);
  const [itemForm, setItemForm] = useState({ product_name: "", quantity: "", cost_price: "" });

  const emptyPayForm = { supplier_id: "", purchase_order_id: "none", amount: "", payment_method: "cash", reference: "", notes: "", payment_date: today() };
  const [payForm, setPayForm] = useState(emptyPayForm);

  const [products, setProducts] = useState([]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [s, o, p, pr] = await Promise.all([
        supabase.from("suppliers").select("*").eq("company_id", companyId).order("name"),
        supabase.from("supplier_purchase_orders").select("*, suppliers(name)").eq("company_id", companyId).order("received_at", { ascending: false }).limit(200),
        supabase.from("supplier_payments").select("*, suppliers(name), supplier_purchase_orders(order_number)").eq("company_id", companyId).order("paid_at", { ascending: false }).limit(500),
        supabase.from("products").select("id, name, cost_price").eq("company_id", companyId).order("name").limit(1000),
      ]);
      setSuppliers(s.data || []);
      setOrders(o.data || []);
      setPayments(p.data || []);
      setProducts(pr.data || []);
    } catch (err) {
      toast.error("Failed to load supplier data");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Stats
  const totalOwed = orders.filter(o => o.status !== "cancelled" && o.status !== "consignment" && o.status !== "ordered").reduce((s, o) => s + (o.invoice_total || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalOutstanding = totalOwed - totalPaid;
  const unpaidCount = orders.filter(o => o.status === "unpaid" || o.status === "partial").length;
  const consignmentCount = orders.filter(o => o.status === "consignment").length;

  // ── Apply received stock to inventory ──
  // Batch-tracked companies (companies.batch_tracking_enabled) get real batches
  // — per-line cost, batch code, consignment amount owed — via receive_stock_batch.
  // Everyone else keeps the original whole-order apply_purchase_order_stock path
  // unchanged, so nothing changes for existing (non-batch) clients.
  const applyStockToInventory = async (order, opts) => {
    const silent = opts && opts.silent;
    setApplyingStockId(order.id);
    try {
      const batchTracked = !!(company && company.batch_tracking_enabled);

      if (batchTracked) {
        if (order.stock_applied) {
          if (!silent) toast.info("This order's stock was already added to inventory");
          return { ok: false, reason: "already_applied" };
        }

        const storeId = order.store_id || (stores[0] && stores[0].id) || null;
        if (!storeId) {
          toast.error("No store available to receive stock into — add a store first");
          return null;
        }

        const lineItems = parseItems(order.items);
        const userId = (await supabase.auth.getUser()).data.user?.id || null;
        let applied = 0;
        const skippedNames = [];

        for (const item of lineItems) {
          const qty = Number(item.received_quantity ?? item.quantity) || 0;
          if (!item.product_id || qty <= 0) {
            if (item.product_name) skippedNames.push(item.product_name);
            continue;
          }
          const { error: batchErr } = await supabase.rpc("receive_stock_batch", {
            p_company_id: order.company_id,
            p_store_id: storeId,
            p_product_id: item.product_id,
            p_quantity: qty,
            p_cost_price: Number(item.cost_price) || 0,
            p_supplier_id: order.supplier_id,
            p_purchase_order_id: order.id,
            p_payment_type: order.payment_type || "cash",
            p_received_at: order.received_at || new Date().toISOString(),
            p_notes: order.notes || null,
            p_created_by: userId,
          });
          if (batchErr) throw batchErr;
          applied += 1;
        }

        const { error: flagErr } = await supabase
          .from("supplier_purchase_orders")
          .update({ stock_applied: true, stock_applied_at: new Date().toISOString() })
          .eq("id", order.id);
        if (flagErr) throw flagErr;

        if (applied > 0) {
          toast.success(`${applied} line item${applied === 1 ? "" : "s"} added to inventory as batches`);
        }
        if (skippedNames.length > 0) {
          toast.warning(`${skippedNames.length} item${skippedNames.length === 1 ? "" : "s"} skipped — no matching product: ${skippedNames.join(", ")}`);
        }
        if (applied === 0 && skippedNames.length === 0 && !silent) {
          toast.info("Nothing to add — this order has no line items");
        }

        setOrders(prev => prev.map(x => x.id === order.id ? { ...x, stock_applied: true, stock_applied_at: new Date().toISOString() } : x));
        setShowDetail(prev => (prev && prev.id === order.id) ? { ...prev, stock_applied: true, stock_applied_at: new Date().toISOString() } : prev);

        return { ok: true, applied_count: applied };
      }

      const { data, error } = await supabase.rpc("apply_purchase_order_stock", { p_po_id: order.id });
      if (error) throw error;

      const result = data || {};

      if (result.ok === false && result.reason === "already_applied") {
        if (!silent) toast.info("This order's stock was already added to inventory");
        return result;
      }

      const applied = result.applied_count || 0;
      const skipped = (result.skipped || []).length;

      if (applied > 0) {
        toast.success(`${applied} line item${applied === 1 ? "" : "s"} added to inventory`);
      }
      if (skipped > 0) {
        const names = (result.skipped || []).map(x => x.product_name).filter(Boolean).join(", ");
        toast.warning(`${skipped} item${skipped === 1 ? "" : "s"} skipped — no matching product: ${names}`);
      }
      if (applied === 0 && skipped === 0 && !silent) {
        toast.info("Nothing to add — this order has no line items");
      }

      // reflect the new state locally without a full reload
      setOrders(prev => prev.map(x => x.id === order.id ? { ...x, stock_applied: true, stock_applied_at: new Date().toISOString() } : x));
      setShowDetail(prev => (prev && prev.id === order.id) ? { ...prev, stock_applied: true, stock_applied_at: new Date().toISOString() } : prev);

      return result;
    } catch (err) {
      toast.error(err.message || "Failed to update inventory");
      return null;
    } finally {
      setApplyingStockId(null);
    }
  };

  // ── Copy a PO to other stores ──
  // Creates one new PO per selected store with the same supplier + line items.
  // Safe by design: stock is NOT applied and no payment is recorded — each store
  // adds its stock via "Add Received Stock to Inventory" when the goods arrive.
  // Copies are never marked paid (consignment stays consignment, everything else
  // starts unpaid), so nothing is double-counted in what you owe the supplier.
  const openCopyOrder = (order) => {
    setCopyOrder(order);
    setCopyStoreIds([]);
  };

  const toggleCopyStore = (id) => {
    setCopyStoreIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const saveCopyOrder = async () => {
    if (!copyOrder || copyStoreIds.length === 0) { toast.error("Select at least one store"); return; }
    setIsCopying(true);
    try {
      const srcItems = parseItems(copyOrder.items).map(i => ({ ...i, received_quantity: Number(i.quantity) || 0 }));
      const userId = (await supabase.auth.getUser()).data.user?.id || null;
      const isConsignment = copyOrder.status === "consignment" || copyOrder.payment_type === "consignment";
      const targets = stores.filter(s => copyStoreIds.includes(s.id));
      const rows = targets.map(s => ({
        company_id: companyId,
        supplier_id: copyOrder.supplier_id,
        store_id: s.id,
        order_number: copyOrder.order_number ? `${copyOrder.order_number}-${s.code || s.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase()}` : null,
        invoice_total: copyOrder.invoice_total,
        calculated_total: copyOrder.calculated_total,
        items: JSON.stringify(srcItems),
        notes: [copyOrder.notes, `[Copied from PO ${copyOrder.order_number || copyOrder.id.slice(0, 8)}]`].filter(Boolean).join("\n"),
        payment_type: isConsignment ? "consignment" : (copyOrder.payment_type === "cash" ? "terms" : (copyOrder.payment_type || "terms")),
        status: isConsignment ? "consignment" : "unpaid",
        amount_paid: 0,
        received_at: new Date().toISOString(),
        created_by: userId,
      }));
      const { error } = await supabase.from("supplier_purchase_orders").insert(rows);
      if (error) throw error;
      toast.success(`PO copied to ${rows.length} store${rows.length > 1 ? "s" : ""} — add stock at each store when it arrives`);
      setCopyOrder(null);
      setCopyStoreIds([]);
      load();
    } catch (err) {
      toast.error(err.message || "Failed to copy order");
    } finally {
      setIsCopying(false);
    }
  };

  // ── Write-off ──
  const openWriteOff = (order) => {
    setWriteOffOrder(order);
    setWriteOffReason("");
  };

  const saveWriteOff = async () => {
    if (!writeOffReason.trim()) { toast.error("Please enter a reason for the write-off"); return; }
    setIsWritingOff(true);
    try {
      const timestamp = new Date().toLocaleDateString("en-ZA");
      const appendedNotes = [
        writeOffOrder.notes,
        `[WRITE-OFF ${timestamp}] ${writeOffReason}`,
      ].filter(Boolean).join("\n");

      const { error } = await supabase
        .from("supplier_purchase_orders")
        .update({
          status: "cancelled",
          notes: appendedNotes,
          amount_paid: 0,
        })
        .eq("id", writeOffOrder.id);

      if (error) throw error;
      toast.success("PO written off — no payment owed. Stock remains in inventory.");
      setWriteOffOrder(null);
      setWriteOffReason("");
      load();
    } catch (err) {
      toast.error(err.message || "Failed to write off order");
    } finally {
      setIsWritingOff(false);
    }
  };

  // Supplier CRUD
  const saveSupplier = async () => {
    if (!supplierForm.name.trim()) { toast.error("Supplier name is required"); return; }
    setIsSaving(true);
    try {
      const payload = {
        name: supplierForm.name,
        contact_name: supplierForm.contact_name || null,
        phone: supplierForm.phone || null,
        email: supplierForm.email || null,
        address: supplierForm.address || null,
        notes: supplierForm.notes || null,
        vat_number: supplierForm.vat_number || null,
        registration_number: supplierForm.registration_number || null,
      };
      if (editSupplier) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", editSupplier.id);
        if (error) throw error;
        toast.success("Supplier updated");
      } else {
        const { error } = await supabase.from("suppliers").insert({ ...payload, company_id: companyId, is_active: true });
        if (error) throw error;
        toast.success("Supplier added");
      }
      setShowNewSupplier(false);
      setEditSupplier(null);
      setSupplierForm(emptySupplierForm);
      load();
    } catch (err) {
      toast.error(err.message || "Failed to save supplier");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSupplier = async (id) => {
    if (!confirm("Delete this supplier? This cannot be undone.")) return;
    try {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;
      toast.success("Supplier deleted");
      load();
    } catch (err) {
      toast.error(err.message || "Failed to delete");
    }
  };

  const openEditSupplier = (s) => {
    setEditSupplier(s);
    setSupplierForm({
      name: s.name || "", contact_name: s.contact_name || s.contact_person || "",
      phone: s.phone || "", email: s.email || "", address: s.address || "",
      notes: s.notes || "", vat_number: s.vat_number || "",
      registration_number: s.registration_number || "",
    });
    setShowNewSupplier(true);
  };

  const openEditOrder = (o) => {
    setEditOrder(o);
    setEditOrderForm({
      order_number: o.order_number || "",
      invoice_total: o.invoice_total || "",
      notes: o.notes || "",
      status: o.status || "unpaid",
      payment_type: o.payment_type || "terms",
      received_at: o.received_at ? o.received_at.split("T")[0] : today(),
    });
  };

  const saveEditOrder = async () => {
    if (!editOrderForm.invoice_total) { toast.error("Invoice total is required"); return; }
    setIsSavingOrder(true);
    try {
      const { error } = await supabase.from("supplier_purchase_orders").update({
        order_number: editOrderForm.order_number || null,
        invoice_total: Number(editOrderForm.invoice_total),
        notes: editOrderForm.notes || null,
        status: editOrderForm.status,
        payment_type: editOrderForm.payment_type,
        received_at: new Date(editOrderForm.received_at).toISOString(),
      }).eq("id", editOrder.id);
      if (error) throw error;
      toast.success("Order updated");
      setEditOrder(null);
      load();
    } catch (err) {
      toast.error(err.message || "Failed to update order");
    } finally {
      setIsSavingOrder(false);
    }
  };

  const addItem = () => {
    if (!itemForm.product_name.trim() || !itemForm.quantity || (orderMode !== "order" && !itemForm.cost_price)) {
      toast.error(orderMode === "order" ? "Fill in product and quantity" : "Fill in product, quantity and cost price"); return;
    }
    // Resolve to a real product so stock lands on the right record
    const typed = itemForm.product_name.trim().toLowerCase();
    const match = products.find(p => (p.name || "").trim().toLowerCase() === typed);

    const newItem = {
      product_id: match ? match.id : null,
      product_name: match ? match.name : itemForm.product_name.trim(),
      quantity: Number(itemForm.quantity),
      cost_price: Number(itemForm.cost_price) || 0,
      line_total: Number(itemForm.quantity) * (Number(itemForm.cost_price) || 0),
        received_quantity: Number(itemForm.quantity),
    };

    if (!match) {
      toast.warning(`"${newItem.product_name}" isn't in your product list — it won't be added to stock`);
    }

    setOrderForm(prev => {
      const items = [...prev.items, newItem];
      const calcTotal = items.reduce((s, i) => s + i.line_total, 0);
      return { ...prev, items, invoice_total: calcTotal.toFixed(2) };
    });
    setItemForm({ product_name: "", quantity: "", cost_price: "" });
  };

  const setReceived = (idx, val) => {
    setOrderForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => i === idx
        ? { ...it, received_quantity: val === "" ? "" : Math.max(0, Math.min(Number(val), it.quantity)) }
        : it),
    }));
  };

  const removeItem = (idx) => {
    setOrderForm(prev => {
      const items = prev.items.filter((_, i) => i !== idx);
      const calcTotal = items.reduce((s, i) => s + i.line_total, 0);
      return { ...prev, items, invoice_total: calcTotal.toFixed(2) };
    });
  };

  // ── Auto-fill a supplier order from reorder levels ──
  // Everything this store takes from this supplier that is at or below its reorder point,
  // at its preferred quantity (gap to reorder point if none). The user then deletes or edits
  // lines before saving. Lines the user typed in themselves are kept.
  const fillOrderFromReorder = async (supplierId, storeId) => {
    if (!canReorder || !supplierId || !storeId) return;
    setReorderLoading(true);
    try {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("store_inventory")
          .select("product_id, stock_quantity, reorder_point, preferred_quantity, cost_price")
          .eq("company_id", companyId).eq("store_id", storeId).eq("supplier_id", supplierId)
          .gt("reorder_point", 0).order("product_id").range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const byId = Object.fromEntries(products.map(p => [p.id, p]));
      const low = rows.filter(r => Number(r.stock_quantity) <= Number(r.reorder_point) && byId[r.product_id]);
      const auto = low.map(r => {
        const p = byId[r.product_id];
        const pref = Number(r.preferred_quantity) || 0;
        const qty = pref > 0 ? pref : Math.max(1, (Number(r.reorder_point) || 0) - (Number(r.stock_quantity) || 0));
        const cost = Number(r.cost_price) || Number(p.cost_price) || 0;
        return { product_id: p.id, product_name: p.name, quantity: qty, cost_price: cost, line_total: qty * cost, received_quantity: 0, _auto: true };
      });
      setOrderForm(prev => ({ ...prev, items: [...prev.items.filter(i => !i._auto), ...auto.filter(a => !prev.items.some(i => !i._auto && i.product_id === a.product_id))] }));
      if (!rows.length) toast.info("No reorder levels are set for this store and supplier. Add items by hand.");
      else if (!auto.length) toast.success("Nothing is at or below its reorder level for this supplier.");
      else toast.success(`${auto.length} item${auto.length === 1 ? "" : "s"} at or below reorder level loaded. Delete or edit what you are not ordering, then create the order.`);
    } catch (e) { toast.error(e.message || "Could not load reorder levels"); }
    finally { setReorderLoading(false); }
  };

  // Load automatically as soon as both supplier and store are chosen on a new order
  useEffect(() => {
    if (!showNewOrder || orderMode !== "order" || !canReorder) { if (!showNewOrder) autoFillKey.current = ""; return; }
    if (!orderForm.supplier_id || !orderForm.store_id || !products.length) return;
    const key = orderForm.supplier_id + "|" + orderForm.store_id;
    if (autoFillKey.current === key) return;
    autoFillKey.current = key;
    fillOrderFromReorder(orderForm.supplier_id, orderForm.store_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewOrder, orderMode, orderForm.supplier_id, orderForm.store_id, products.length, canReorder]);

  // ── Bulk reorder (all suppliers for one store) ──
  const buildBulkPlan = async (storeId) => {
    if (!canReorder || !storeId) return;
    setBulkBusy(true); setBulkPlan(null);
    try {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("store_inventory")
          .select("product_id, supplier_id, stock_quantity, reorder_point, preferred_quantity, cost_price")
          .eq("company_id", companyId).eq("store_id", storeId)
          .gt("reorder_point", 0).order("product_id").range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      // Products already on an open (ordered, not yet received) PO for this store are skipped so we never double-order.
      const { data: open, error: oErr } = await supabase.from("supplier_purchase_orders")
        .select("items").eq("company_id", companyId).eq("store_id", storeId).eq("status", "ordered");
      if (oErr) throw oErr;
      const onOrder = new Set();
      (open || []).forEach(o => parseItems(o.items).forEach(i => { if (i.product_id) onOrder.add(i.product_id); }));

      const byId = Object.fromEntries(products.map(p => [p.id, p]));
      const supById = Object.fromEntries(suppliers.map(x => [x.id, x]));
      const low = rows.filter(r => byId[r.product_id] && Number(r.stock_quantity) <= Number(r.reorder_point));
      let skipped = 0;
      const groups = {}; const noSupplier = [];
      low.forEach(r => {
        const p = byId[r.product_id];
        const pref = Number(r.preferred_quantity) || 0;
        const qty = pref > 0 ? pref : Math.max(1, (Number(r.reorder_point) || 0) - (Number(r.stock_quantity) || 0));
        const cost = Number(r.cost_price) || Number(p.cost_price) || 0;
        const line = { product_id: p.id, product_name: p.name, quantity: qty, cost_price: cost, line_total: qty * cost, received_quantity: 0, stock: Number(r.stock_quantity) || 0, reorder_point: Number(r.reorder_point) || 0 };
        if (onOrder.has(p.id)) { skipped++; return; }
        if (!r.supplier_id || !supById[r.supplier_id]) { noSupplier.push(line); return; }
        (groups[r.supplier_id] = groups[r.supplier_id] || { supplier_id: r.supplier_id, supplier_name: supById[r.supplier_id].name, lines: [] }).lines.push(line);
      });
      const list = Object.values(groups).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
      list.forEach(g => g.lines.sort((a, b) => a.product_name.localeCompare(b.product_name)));
      noSupplier.sort((a, b) => a.product_name.localeCompare(b.product_name));
      setBulkPlan({ groups: list, noSupplier, onOrder: skipped, withLevels: rows.length });
    } catch (e) { toast.error(e.message || "Could not build the reorder"); }
    finally { setBulkBusy(false); }
  };

  const removeBulkLine = (supplierId, productId) => setBulkPlan(prev => prev && ({
    ...prev,
    groups: prev.groups.map(g => g.supplier_id === supplierId ? { ...g, lines: g.lines.filter(l => l.product_id !== productId) } : g).filter(g => g.lines.length),
  }));
  const setBulkQty = (supplierId, productId, val) => setBulkPlan(prev => prev && ({
    ...prev,
    groups: prev.groups.map(g => g.supplier_id !== supplierId ? g : { ...g, lines: g.lines.map(l => l.product_id !== productId ? l : { ...l, quantity: val === "" ? "" : Math.max(0, Number(val)), line_total: (val === "" ? 0 : Math.max(0, Number(val))) * (Number(l.cost_price) || 0) }) }),
  }));

  const createBulkOrders = async () => {
    if (!bulkPlan || !bulkStoreId) return;
    const groups = bulkPlan.groups.map(g => ({ ...g, lines: g.lines.filter(l => Number(l.quantity) > 0) })).filter(g => g.lines.length);
    if (!groups.length) { toast.error("Nothing to order"); return; }
    setBulkBusy(true);
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id || null;
      const rows = groups.map(g => {
        const total = g.lines.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0);
        return {
          company_id: companyId, supplier_id: g.supplier_id, store_id: bulkStoreId,
          order_number: newPoNumber(), invoice_total: total, calculated_total: total,
          items: JSON.stringify(g.lines.map(({ stock, reorder_point, ...l }) => ({ ...l, received_quantity: 0 }))),
          notes: "Auto-generated from reorder levels", payment_type: "terms", status: "ordered",
          amount_paid: 0, stock_applied: false, created_by: uid,
        };
      });
      const { error } = await supabase.from("supplier_purchase_orders").insert(rows);
      if (error) throw error;
      toast.success(`${rows.length} purchase order${rows.length === 1 ? "" : "s"} created. Send each one to its supplier from the Orders list.`);
      setBulkOpen(false); setBulkPlan(null);
      load();
    } catch (e) { toast.error(e.message || "Could not create the orders"); }
    finally { setBulkBusy(false); }
  };

  const setOrderQty = (idx, val) => {
    setOrderForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => i === idx
        ? { ...it, quantity: val === "" ? "" : Math.max(0, Number(val)), line_total: (val === "" ? 0 : Math.max(0, Number(val))) * (Number(it.cost_price) || 0) }
        : it),
    }));
  };

  // ── Order-first helpers ──
  const newPoNumber = () => {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `PO-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  };

  const openNewSupplierOrder = () => {
    setOrderMode("order");
    setReceivingPoId(null);
    autoFillKey.current = "";
    setOrderForm({ ...emptyOrderForm, order_number: newPoNumber(), store_id: activeStoreId || (stores[0] && stores[0].id) || "" });
    setShowNewOrder(true);
  };

  // Receive stock against an order that was already raised: prefill from the PO
  const openReceiveOrder = (o) => {
    const items = parseItems(o.items).map(i => ({ ...i, received_quantity: Number(i.quantity) || 0 }));
    setOrderMode("receive");
    setReceivingPoId(o.id);
    setOrderForm({
      ...emptyOrderForm,
      supplier_id: o.supplier_id,
      store_id: o.store_id || "",
      order_number: o.order_number || "",
      invoice_total: items.reduce((sum, i) => sum + (Number(i.line_total) || 0), 0).toFixed(2),
      notes: o.notes || "",
      items,
      payment_type: o.payment_type && o.payment_type !== "consignment" ? o.payment_type : "terms",
    });
    setShowNewOrder(true);
  };

  const buildOrderText = (o) => {
    const supplier = suppliers.find(s => s.id === o.supplier_id);
    const store = stores.find(s => s.id === o.store_id);
    const items = parseItems(o.items);
    const lines = items.map(i => `• ${i.quantity} × ${i.product_name}`);
    return [
      `*Purchase Order ${o.order_number || o.id.slice(0, 8)}*`,
      company?.name ? `From: ${company.name}` : null,
      supplier?.name ? `To: ${supplier.name}` : null,
      store?.name ? `Deliver to: ${store.name}` : null,
      o.expected_date ? `Needed by: ${o.expected_date}` : null,
      "",
      ...lines,
      o.notes ? `\nNotes: ${o.notes}` : null,
      "",
      "Please confirm availability and delivery date. Thank you.",
    ].filter(x => x !== null).join("\n");
  };

  const markSent = async (o, via) => {
    const sent_at = new Date().toISOString();
    const { error } = await supabase.from("supplier_purchase_orders").update({ sent_at, sent_via: via }).eq("id", o.id);
    if (error) { toast.error("Sent, but could not mark it as sent: " + error.message); return; }
    setOrders(prev => prev.map(x => x.id === o.id ? { ...x, sent_at, sent_via: via } : x));
  };

  const sendOrderWhatsApp = async (o) => {
    const supplier = suppliers.find(s => s.id === o.supplier_id);
    let phone = String(supplier?.phone || "").replace(/[^0-9]/g, "");
    if (!phone) { toast.error("This supplier has no phone number — add one on the Suppliers tab"); return; }
    if (phone.startsWith("0")) phone = "27" + phone.slice(1);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildOrderText(o))}`, "_blank");
    await markSent(o, "whatsapp");
  };

  const sendOrderEmail = async (o) => {
    const supplier = suppliers.find(s => s.id === o.supplier_id);
    if (!supplier?.email) { toast.error("This supplier has no email — add one on the Suppliers tab"); return; }
    window.location.href = `mailto:${supplier.email}?subject=${encodeURIComponent("Purchase Order " + (o.order_number || ""))}&body=${encodeURIComponent(buildOrderText(o).replace(/\*/g, ""))}`;
    await markSent(o, "email");
  };

  const copyOrderText = async (o) => {
    try { await navigator.clipboard.writeText(buildOrderText(o)); toast.success("Order copied — paste it anywhere"); await markSent(o, "copied"); }
    catch (_) { toast.error("Could not copy"); }
  };

  const cancelOrderedPo = async (o) => {
    if (!window.confirm(`Cancel order ${o.order_number || o.id.slice(0, 8)}? Nothing has been received or owed on it.`)) return;
    const { error } = await supabase.from("supplier_purchase_orders").update({ status: "cancelled" }).eq("id", o.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Order cancelled");
    load();
  };

  const saveSupplierOrder = async () => {
    if (!orderForm.supplier_id || !orderForm.store_id) { toast.error("Select a supplier and a delivery store"); return; }
    let items = orderForm.items;
    if (itemForm.product_name.trim() && itemForm.quantity) {
      const typed = itemForm.product_name.trim().toLowerCase();
      const match = products.find(p => (p.name || "").trim().toLowerCase() === typed);
      items = [...items, {
        product_id: match ? match.id : null,
        product_name: match ? match.name : itemForm.product_name.trim(),
        quantity: Number(itemForm.quantity),
        cost_price: Number(itemForm.cost_price) || 0,
        line_total: Number(itemForm.quantity) * (Number(itemForm.cost_price) || 0),
        received_quantity: 0,
      }];
    }
    items = items.filter(i => Number(i.quantity) > 0);
    if (items.length === 0) { toast.error("Add at least one item to order"); return; }
    setIsSaving(true);
    try {
      const calcTotal = items.reduce((sum, i) => sum + (Number(i.line_total) || 0), 0);
      const { data: created, error } = await supabase.from("supplier_purchase_orders").insert({
        company_id: companyId,
        supplier_id: orderForm.supplier_id,
        store_id: orderForm.store_id,
        order_number: orderForm.order_number || newPoNumber(),
        invoice_total: calcTotal,
        calculated_total: calcTotal,
        items: JSON.stringify(items.filter(i => Number(i.quantity) > 0).map(({ _auto, ...i }) => ({ ...i, received_quantity: 0 }))),
        notes: orderForm.notes || null,
        payment_type: "terms",
        status: "ordered",
        amount_paid: 0,
        stock_applied: false,
        expected_date: orderForm.expected_date || null,
        created_by: (await supabase.auth.getUser()).data.user?.id || null,
      }).select().single();
      if (error) throw error;
      toast.success(`Order ${created.order_number} created — send it to the supplier from the list`);
      setShowNewOrder(false);
      setOrderForm(emptyOrderForm);
      setItemForm({ product_name: "", quantity: "", cost_price: "" });
      load();
    } catch (err) {
      toast.error(err.message || "Failed to create order");
    } finally {
      setIsSaving(false);
    }
  };

  const saveOrder = async () => {
    if (orderMode === "order") return saveSupplierOrder();
    if (!orderForm.supplier_id || !orderForm.store_id) {
      toast.error("Select a supplier and a receiving store"); return;
    }

    // If a line item was typed but "+ Add Item" was never clicked, commit it now
    // instead of silently saving the order without it (this is how a previous
    // order got saved with a R10,000 invoice total and zero line items).
    let items = orderForm.items;
    if (itemForm.product_name.trim() && itemForm.quantity && itemForm.cost_price) {
      const typed = itemForm.product_name.trim().toLowerCase();
      const match = products.find(p => (p.name || "").trim().toLowerCase() === typed);
      items = [...items, {
        product_id: match ? match.id : null,
        product_name: match ? match.name : itemForm.product_name.trim(),
        quantity: Number(itemForm.quantity),
        cost_price: Number(itemForm.cost_price),
        line_total: Number(itemForm.quantity) * Number(itemForm.cost_price),
        received_quantity: Number(itemForm.quantity),
      }];
    }

    const calcTotal = items.reduce((s, i) => s + i.line_total, 0);
    const invoiceTotal = Number(orderForm.invoice_total) || calcTotal;

    if (orderForm.update_stock && items.length === 0) {
      toast.error('Add at least one line item, or turn off "Add these quantities to inventory"');
      return;
    }
    if (!invoiceTotal) {
      toast.error("Enter an invoice total or add line items so it can be calculated"); return;
    }

    setIsSaving(true);
    try {
      const isCash = orderForm.payment_type === "cash";
      const isConsignment = orderForm.payment_type === "consignment";

      const payload = {
        company_id: companyId,
        supplier_id: orderForm.supplier_id,
        store_id: orderForm.store_id,
        order_number: orderForm.order_number || null,
        invoice_total: invoiceTotal,
        calculated_total: calcTotal,
        items: JSON.stringify(items.map(i => ({ ...i, received_quantity: i.received_quantity === "" ? 0 : Number(i.received_quantity ?? i.quantity) }))),
        notes: orderForm.notes || null,
        payment_type: orderForm.payment_type,
        status: isConsignment ? "consignment" : isCash ? "paid" : "unpaid",
        amount_paid: isCash ? invoiceTotal : 0,
        received_at: orderForm.order_date ? new Date(orderForm.order_date).toISOString() : new Date().toISOString(),
        created_by: (await supabase.auth.getUser()).data.user?.id || null,
      };

      let created, error;
      if (receivingPoId) {
        // Receiving against a PO that was already raised: update it, never create a second one.
        // Guard on status so a double-click can't receive the same order twice.
        const { received_at, created_by, company_id, ...changes } = payload;
        const res = await supabase.from("supplier_purchase_orders")
          .update({ ...changes, received_at })
          .eq("id", receivingPoId).eq("status", "ordered")
          .select().maybeSingle();
        created = res.data; error = res.error;
        if (!error && !created) throw new Error("This order was already received or cancelled — refresh the list");
      } else {
        const res = await supabase.from("supplier_purchase_orders").insert(payload).select().single();
        created = res.data; error = res.error;
      }
      if (error) throw error;

      if (isCash) {
        await supabase.from("supplier_payments").insert({
          company_id: companyId,
          supplier_id: orderForm.supplier_id,
          purchase_order_id: created?.id || null,
          amount: invoiceTotal,
          payment_method: "cash",
          notes: `Auto-payment for ${orderForm.order_number || "order"} (cash on delivery)`,
          paid_at: orderForm.order_date ? new Date(orderForm.order_date).toISOString() : new Date().toISOString(),
        });
      }

      toast.success(
        isConsignment ? "Consignment stock recorded" :
        isCash ? "Stock received — marked as paid" :
        "Purchase order recorded — " + formatCurrency(invoiceTotal) + " owed"
      );

      // Push the received quantities into store inventory
      if (created?.id && orderForm.update_stock && items.length > 0) {
        await applyStockToInventory(created, { silent: true });
      }

      // Received less than the invoice: raise an RFC to this supplier for the shortfall
      const shortItems = items.filter(i => Number(i.received_quantity === "" ? 0 : (i.received_quantity ?? i.quantity)) < i.quantity);
      if (created?.id && shortItems.length > 0) {
        const { data: rfc, error: rfcErr } = await supabase.rpc("po_raise_short_delivery_rfc", {
          p_po_id: created.id, p_resolution: orderForm.short_resolution,
        });
        if (rfcErr) toast.error("Order saved, but the short-delivery RFC failed: " + rfcErr.message);
        else if (rfc?.rfc_number) toast.success(`Short delivery: ${rfc.rfc_number} raised on the RFC tab (${formatCurrency(rfc.credit_total || 0)})`);
      }

      setShowNewOrder(false);
      setReceivingPoId(null);
      setOrderForm(emptyOrderForm);
      setItemForm({ product_name: "", quantity: "", cost_price: "" });
      load();
    } catch (err) {
      toast.error(err.message || "Failed to save order");
    } finally {
      setIsSaving(false);
    }
  };

  const savePayment = async () => {
    if (!payForm.supplier_id || !payForm.amount || Number(payForm.amount) <= 0) {
      toast.error("Select supplier and enter amount"); return;
    }
    setIsSaving(true);
    try {
      const { error } = await supabase.from("supplier_payments").insert({
        company_id: companyId,
        supplier_id: payForm.supplier_id,
        purchase_order_id: payForm.purchase_order_id === "none" ? null : payForm.purchase_order_id,
        amount: Number(payForm.amount),
        payment_method: payForm.payment_method,
        reference: payForm.reference || null,
        notes: payForm.notes || null,
        paid_at: payForm.payment_date ? new Date(payForm.payment_date).toISOString() : new Date().toISOString(),
        created_by: (await supabase.auth.getUser()).data.user?.id || null,
      });
      if (error) throw error;
      toast.success("Payment of " + formatCurrency(Number(payForm.amount)) + " recorded");
      setShowPayment(false);
      setPayForm(emptyPayForm);
      load();
    } catch (err) {
      toast.error(err.message || "Failed to record payment");
    } finally {
      setIsSaving(false);
    }
  };

  const openPayForOrder = (order) => {
    setPayForm({
      supplier_id: order.supplier_id,
      purchase_order_id: order.id,
      amount: (order.invoice_total - (order.amount_paid || 0)).toFixed(2),
      payment_method: "cash",
      reference: "",
      notes: "Payment for " + (order.order_number || order.id.slice(0, 8)),
      payment_date: today(),
    });
    setShowPayment(true);
  };

  const filteredOrders = orders.filter(o => {
    const matchSearch = !searchTerm || (o.suppliers?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) || (o.order_number || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = filterStatus === "all" || o.status === filterStatus;
    const matchSupplier = !selectedSupplier || o.supplier_id === selectedSupplier;
    return matchSearch && matchStatus && matchSupplier;
  });

  const supplierSummary = suppliers.map(s => {
    const sOrders = orders.filter(o => o.supplier_id === s.id && o.status !== "cancelled" && o.status !== "ordered");
    const sPayments = payments.filter(p => p.supplier_id === s.id);
    const owed = sOrders.filter(o => o.status !== "consignment").reduce((sum, o) => sum + (o.invoice_total || 0), 0);
    const paid = sPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const consignmentOrders = sOrders.filter(o => o.status === "consignment");
    return { ...s, owed, paid, balance: owed - paid, orderCount: sOrders.length, consignmentOrders };
  });

  const filteredSuppliers = suppliers.filter(s => {
    if (!searchTerm) return true;
    return (s.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.contact_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.email || "").toLowerCase().includes(searchTerm.toLowerCase());
  });

  const consignmentOrders = orders.filter(o => o.status === "consignment");

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-sm text-muted-foreground">Manage suppliers, track stock received & payments</p>
        </div>
        <div className="flex gap-2">
          {activeTab === "suppliers" && (
            <Button onClick={() => { setEditSupplier(null); setSupplierForm(emptySupplierForm); setShowNewSupplier(true); }} className="gap-2">
              <Plus className="w-4 h-4" /> Add Supplier
            </Button>
          )}
          {activeTab === "orders" && (
            <>
              <Button onClick={openNewSupplierOrder} className="gap-2">
                <ClipboardList className="w-4 h-4" /> New Order
              </Button>
              {canReorder && (
                <Button variant="outline" onClick={() => { const sid = activeStoreId || (stores[0] && stores[0].id) || ""; setBulkStoreId(sid); setBulkPlan(null); setBulkOpen(true); buildBulkPlan(sid); }} className="gap-2">
                  <Package className="w-4 h-4" /> Reorder All Suppliers
                </Button>
              )}
              <Button variant="outline" onClick={() => { setOrderMode("receive"); setReceivingPoId(null); setShowNewOrder(true); setOrderForm({ ...emptyOrderForm, store_id: activeStoreId || (stores[0] && stores[0].id) || "" }); }} className="gap-2">
                <Truck className="w-4 h-4" /> Receive Stock
              </Button>
            </>
          )}
          {activeTab === "payments" && (
            <Button onClick={() => { setShowPayment(true); setPayForm(emptyPayForm); }} className="gap-2">
              <Wallet className="w-4 h-4" /> Record Payment
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-primary/10"><Users className="w-5 h-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{suppliers.length}</p><p className="text-xs text-muted-foreground">Suppliers</p></div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-red-500/10"><DollarSign className="w-5 h-5 text-red-400" /></div>
            <div><p className="text-2xl font-bold text-red-400">{formatCurrency(totalOutstanding)}</p><p className="text-xs text-muted-foreground">Outstanding</p></div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-green-500/10"><CheckCircle className="w-5 h-5 text-green-400" /></div>
            <div><p className="text-2xl font-bold text-green-400">{formatCurrency(totalPaid)}</p><p className="text-xs text-muted-foreground">Total Paid</p></div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-purple-500/10"><Package className="w-5 h-5 text-purple-400" /></div>
            <div><p className="text-2xl font-bold text-purple-400">{consignmentCount}</p><p className="text-xs text-muted-foreground">Consignment</p></div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border overflow-x-auto">
        {[
          { key: "suppliers", label: `Suppliers (${suppliers.length})` },
          { key: "orders", label: `Purchase Orders (${orders.length})` },
          { key: "payments", label: `Payments (${payments.length})` },
          { key: "consignment", label: `Consignment (${consignmentCount})` },
        ].map(t => (
          <button key={t.key} onClick={() => { setActiveTab(t.key); setSearchTerm(""); setFilterStatus("all"); setSelectedSupplier(null); }}
            className={`px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${activeTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder={activeTab === "suppliers" ? "Search suppliers..." : "Search by supplier or order..."} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
      </div>

      {/* ═══ SUPPLIERS TAB ═══ */}
      {activeTab === "suppliers" && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Supplier</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Contact</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Phone</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">VAT No.</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Owed</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Balance</th>
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map(s => {
                  const summary = supplierSummary.find(ss => ss.id === s.id) || { owed: 0, paid: 0, balance: 0 };
                  return (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3">
                        <p className="text-sm font-medium">{s.name}</p>
                        {s.email && <p className="text-xs text-muted-foreground">{s.email}</p>}
                        {s.registration_number && <p className="text-xs text-muted-foreground">Reg: {s.registration_number}</p>}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell">{s.contact_name || s.contact_person || "—"}</td>
                      <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">{s.phone || "—"}</td>
                      <td className="p-3 text-sm text-muted-foreground hidden lg:table-cell">{s.vat_number || "—"}</td>
                      <td className="p-3 text-sm">{formatCurrency(summary.owed)}</td>
                      <td className="p-3">
                        <span className={`text-sm font-bold ${summary.balance > 0 ? "text-red-400" : "text-green-400"}`}>
                          {formatCurrency(summary.balance)}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditSupplier(s)}><Edit className="w-4 h-4" /></Button>
                          {summary.balance > 0 && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-green-400" onClick={() => { setPayForm({ ...emptyPayForm, supplier_id: s.id }); setShowPayment(true); }}><CreditCard className="w-4 h-4" /></Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => deleteSupplier(s.id)}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!filteredSuppliers.length && (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No suppliers yet</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ ORDERS TAB ═══ */}
      {activeTab === "orders" && (
        <>
          <div className="flex gap-2 flex-wrap">
            {["all", "ordered", "unpaid", "partial", "paid", "consignment", "cancelled"].map(f => (
              <button key={f} onClick={() => setFilterStatus(f)}
                className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all ${filterStatus === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                {f}
              </button>
            ))}
          </div>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Supplier</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Order #</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Invoice</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Paid</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Balance</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Type</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Stock</th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Date</th>
                    <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(o => {
                    const balance = (o.invoice_total || 0) - (o.amount_paid || 0);
                    const StatusIcon = STATUS_ICONS[o.status] || Clock;
                    const typeColors = { cash: "text-green-400", terms: "text-amber-400", consignment: "text-purple-400" };
                    const isWrittenOff = o.status === "cancelled" && (o.notes || "").includes("[WRITE-OFF");
                    const lineItems = parseItems(o.items);
                    return (
                      <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="p-3">
                          <p className="text-sm font-medium">{o.suppliers?.name || "Unknown"}</p>
                          {isWrittenOff && <p className="text-xs text-orange-400 font-medium">Written off</p>}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell font-mono">{o.order_number || o.id.slice(0, 8)}</td>
                        <td className="p-3 text-sm font-semibold">{formatCurrency(o.invoice_total)}</td>
                        <td className="p-3 text-sm text-green-400 hidden md:table-cell">{formatCurrency(o.amount_paid || 0)}</td>
                        <td className="p-3"><span className={`text-sm font-bold ${balance > 0 && o.status !== "cancelled" && o.status !== "ordered" ? "text-red-400" : "text-muted-foreground"}`}>{o.status === "cancelled" || o.status === "ordered" ? "—" : formatCurrency(balance)}</span></td>
                        <td className="p-3">
                          <span className={`text-xs font-medium capitalize ${typeColors[o.payment_type || "terms"] || "text-muted-foreground"}`}>
                            {o.payment_type || "terms"}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium ${STATUS_STYLES[o.status]}`}>
                            <StatusIcon className="w-3 h-3" />{o.status === "ordered" && o.sent_at ? "ordered · sent" : o.status}
                          </span>
                        </td>
                        <td className="p-3 hidden md:table-cell">
                          {lineItems.length === 0 || o.status === "ordered" ? (
                            <span className="text-xs text-muted-foreground">{o.status === "ordered" ? "Awaiting delivery" : "—"}</span>
                          ) : o.stock_applied ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">
                              <PackageCheck className="w-3.5 h-3.5" /> In stock
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" /> Not added
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground hidden lg:table-cell">{new Date(o.received_at).toLocaleDateString("en-ZA")}</td>
                        <td className="p-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowDetail(o)}><Eye className="w-4 h-4" /></Button>
                            {o.status === "ordered" && (
                              <>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-green-400" title="Send via WhatsApp" onClick={() => sendOrderWhatsApp(o)}><MessageCircle className="w-4 h-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-sky-400" title="Send via email" onClick={() => sendOrderEmail(o)}><Mail className="w-4 h-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Copy order text" onClick={() => copyOrderText(o)}><Copy className="w-4 h-4" /></Button>
                                <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => openReceiveOrder(o)}><Truck className="w-3.5 h-3.5" /> Receive</Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-400" title="Cancel order" onClick={() => cancelOrderedPo(o)}><XCircle className="w-4 h-4" /></Button>
                              </>
                            )}
                            {o.status !== "ordered" && !o.stock_applied && lineItems.length > 0 && o.status !== "cancelled" && (
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 text-amber-400 hover:text-amber-300"
                                title="Add received stock to inventory"
                                disabled={applyingStockId === o.id}
                                onClick={() => applyStockToInventory(o)}
                              >
                                <Warehouse className="w-4 h-4" />
                              </Button>
                            )}
                            {o.status !== "ordered" && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditOrder(o)}><Edit className="w-4 h-4" /></Button>}
                            {o.status !== "paid" && o.status !== "cancelled" && o.status !== "consignment" && o.status !== "ordered" && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-green-400" onClick={() => openPayForOrder(o)}><CreditCard className="w-4 h-4" /></Button>
                            )}
                            {/* Write-off button — only for unpaid/partial orders */}
                            {(o.status === "unpaid" || o.status === "partial") && (
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-orange-400"
                                title="Write off — supplier will not be paid"
                                onClick={() => openWriteOff(o)}
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!filteredOrders.length && (
              <div className="text-center py-12 text-muted-foreground">
                <Truck className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{orders.length === 0 ? "No purchase orders yet" : "No orders match filters"}</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══ PAYMENTS TAB ═══ */}
      {activeTab === "payments" && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Supplier</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Amount</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Method</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Order</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Reference</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.filter(p => {
                  if (!searchTerm) return true;
                  return (p.suppliers?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) || (p.reference || "").toLowerCase().includes(searchTerm.toLowerCase());
                }).map(p => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="p-3 text-sm font-medium">{p.suppliers?.name || "Unknown"}</td>
                    <td className="p-3 text-sm font-bold text-green-400">{formatCurrency(p.amount)}</td>
                    <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell capitalize">{p.payment_method}</td>
                    <td className="p-3 text-sm text-muted-foreground hidden md:table-cell font-mono">{p.supplier_purchase_orders?.order_number || (p.purchase_order_id ? p.purchase_order_id.slice(0, 8) : "General")}</td>
                    <td className="p-3 text-sm text-muted-foreground hidden lg:table-cell">{p.reference || "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(p.paid_at).toLocaleDateString("en-ZA")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!payments.length && (
            <div className="text-center py-12 text-muted-foreground">
              <Wallet className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No payments recorded yet</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ CONSIGNMENT TAB ═══ */}
      {activeTab === "consignment" && (
        <div className="space-y-4">
          <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4">
            <p className="text-sm text-purple-300">
              Consignment stock is received but not yet owed — you only pay the supplier after selling the units.
              Track what's been sold and settle per order.
            </p>
          </div>
          {consignmentOrders.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No consignment orders yet</p>
              <p className="text-xs mt-1">Receive stock with payment type "Consignment" to track here</p>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Supplier</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Order #</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Stock Value</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Units Sold</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Amount Owed</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Date</th>
                      <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consignmentOrders.map(o => {
                      const items = parseItems(o.items);
                      const totalUnits = items.reduce((s, i) => s + (i.quantity || 0), 0);
                      const soldUnits = o.consignment_sold || 0;
                      const unitCost = totalUnits > 0 ? (o.invoice_total / totalUnits) : 0;
                      const amountOwed = soldUnits * unitCost;
                      return (
                        <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="p-3 text-sm font-medium">{o.suppliers?.name || "Unknown"}</td>
                          <td className="p-3 text-sm font-mono text-muted-foreground">{o.order_number || o.id.slice(0, 8)}</td>
                          <td className="p-3 text-sm font-semibold">{formatCurrency(o.invoice_total)}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-amber-400">{soldUnits}</span>
                              <span className="text-xs text-muted-foreground">/ {totalUnits} units</span>
                            </div>
                            {totalUnits > 0 && (
                              <div className="w-20 h-1 bg-muted rounded-full mt-1">
                                <div className="h-1 bg-amber-400 rounded-full" style={{ width: `${Math.min(100, (soldUnits / totalUnits) * 100)}%` }} />
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-sm font-bold text-purple-400">{formatCurrency(amountOwed)}</td>
                          <td className="p-3 text-xs text-muted-foreground">{new Date(o.received_at).toLocaleDateString("en-ZA")}</td>
                          <td className="p-3">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowDetail(o)}><Eye className="w-4 h-4" /></Button>
                              {!o.stock_applied && items.length > 0 && (
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-8 w-8 text-amber-400 hover:text-amber-300"
                                  title="Add received stock to inventory"
                                  disabled={applyingStockId === o.id}
                                  onClick={() => applyStockToInventory(o)}
                                >
                                  <Warehouse className="w-4 h-4" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditOrder(o)}><Edit className="w-4 h-4" /></Button>
                              {amountOwed > 0 && (
                                <Button variant="ghost" size="sm" className="h-8 text-xs text-green-400 gap-1" onClick={() => {
                                  setPayForm({ ...emptyPayForm, supplier_id: o.supplier_id, purchase_order_id: o.id, amount: amountOwed.toFixed(2), notes: `Consignment settlement for ${o.order_number || o.id.slice(0, 8)}` });
                                  setShowPayment(true);
                                }}>
                                  <CreditCard className="w-3 h-3" /> Settle
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Write-Off Dialog ── */}
      <Dialog open={bulkOpen} onOpenChange={(open) => { setBulkOpen(open); if (!open) setBulkPlan(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Reorder all suppliers</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Store</Label>
              <Select value={bulkStoreId} onValueChange={(v) => { setBulkStoreId(v); buildBulkPlan(v); }}>
                <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>{(stores || []).map(st => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {bulkBusy && !bulkPlan && <p className="text-sm text-muted-foreground">Working out what is at or below its reorder level...</p>}
            {bulkPlan && (
              <>
                <p className="text-sm text-muted-foreground">
                  Items at or below their reorder point are ordered at the preferred quantity, one purchase order per supplier. Remove or change lines first. Nothing is received or owed until the goods arrive.
                  {bulkPlan.onOrder > 0 && ` ${bulkPlan.onOrder} item${bulkPlan.onOrder === 1 ? " is" : "s are"} already on an open order and skipped.`}
                </p>
                {bulkPlan.groups.length === 0 && <p className="text-sm">Nothing to order for this store{bulkPlan.withLevels === 0 ? " (no reorder levels are loaded for it)" : ""}.</p>}
                {bulkPlan.groups.map(g => {
                  const total = g.lines.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0);
                  return (
                    <div key={g.supplier_id} className="border rounded-lg">
                      <div className="flex justify-between items-center px-3 py-2 bg-muted/40 rounded-t-lg">
                        <span className="font-medium">{g.supplier_name} <span className="text-xs text-muted-foreground">({g.lines.length} item{g.lines.length === 1 ? "" : "s"})</span></span>
                        <span className="text-sm">{formatCurrency(total)}</span>
                      </div>
                      <div className="divide-y">
                        {g.lines.map(l => (
                          <div key={l.product_id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                            <span className="flex-1 truncate">{l.product_name}</span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">stock {l.stock} / reorder at {l.reorder_point}</span>
                            <Input type="number" min="0" className="w-20 h-8" value={l.quantity} onChange={e => setBulkQty(g.supplier_id, l.product_id, e.target.value)} />
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeBulkLine(g.supplier_id, l.product_id)}><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {bulkPlan.noSupplier.length > 0 && (
                  <div className="border border-amber-500/30 rounded-lg p-3 text-sm">
                    <p className="font-medium text-amber-500 mb-1">{bulkPlan.noSupplier.length} low item{bulkPlan.noSupplier.length === 1 ? "" : "s"} have no supplier, so no order can be made for them</p>
                    <p className="text-muted-foreground">{bulkPlan.noSupplier.map(l => l.product_name).join(", ")}</p>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBulkOpen(false)}>Close</Button>
              <Button disabled={bulkBusy || !bulkPlan || bulkPlan.groups.length === 0} onClick={createBulkOrders}>
                {bulkBusy ? "Working..." : `Create ${bulkPlan ? bulkPlan.groups.length : 0} purchase order${bulkPlan && bulkPlan.groups.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!writeOffOrder} onOpenChange={open => { if (!open) setWriteOffOrder(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-400">
              <XCircle className="w-5 h-5" /> Write Off Purchase Order
            </DialogTitle>
          </DialogHeader>
          {writeOffOrder && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-lg bg-orange-500/5 border border-orange-500/20 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Supplier</span>
                  <span className="font-semibold">{writeOffOrder.suppliers?.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Order #</span>
                  <span className="font-mono">{writeOffOrder.order_number || writeOffOrder.id.slice(0, 8)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Invoice Total</span>
                  <span className="font-bold">{formatCurrency(writeOffOrder.invoice_total)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount Owed</span>
                  <span className="font-bold text-red-400">{formatCurrency((writeOffOrder.invoice_total || 0) - (writeOffOrder.amount_paid || 0))}</span>
                </div>
              </div>

              {/* What this does */}
              <div className="rounded-lg bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground text-sm">What this does:</p>
                <p>✓ Marks this PO as <span className="text-orange-400 font-medium">cancelled</span> — no payment will be owed</p>
                <p>✓ Stock already received <span className="font-medium text-foreground">stays in your inventory</span></p>
                <p>✓ Write-off reason is saved to the order notes</p>
              </div>

              <div>
                <Label>Reason for write-off *</Label>
                <Textarea
                  value={writeOffReason}
                  onChange={e => setWriteOffReason(e.target.value)}
                  placeholder="e.g. Damaged on delivery, quality rejected, supplier dispute resolved..."
                  rows={3}
                  className="mt-1"
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setWriteOffOrder(null)}>Cancel</Button>
                <Button
                  className="flex-1 bg-orange-600 hover:bg-orange-700 text-white gap-2"
                  onClick={saveWriteOff}
                  disabled={isWritingOff || !writeOffReason.trim()}
                >
                  <XCircle className="w-4 h-4" />
                  {isWritingOff ? "Writing off..." : "Confirm Write-Off"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add/Edit Supplier Dialog ── */}
      <Dialog open={showNewSupplier} onOpenChange={open => { if (!open) { setShowNewSupplier(false); setEditSupplier(null); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editSupplier ? "Edit Supplier" : "Add Supplier"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={supplierForm.name} onChange={e => setSupplierForm(p => ({ ...p, name: e.target.value }))} placeholder="Supplier name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contact Person</Label><Input value={supplierForm.contact_name} onChange={e => setSupplierForm(p => ({ ...p, contact_name: e.target.value }))} /></div>
              <div><Label>Phone</Label><Input value={supplierForm.phone} onChange={e => setSupplierForm(p => ({ ...p, phone: e.target.value }))} /></div>
            </div>
            <div><Label>Email</Label><Input value={supplierForm.email} onChange={e => setSupplierForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>VAT Number</Label><Input value={supplierForm.vat_number} onChange={e => setSupplierForm(p => ({ ...p, vat_number: e.target.value }))} placeholder="e.g. 4012345678" /></div>
              <div><Label>Business Reg No.</Label><Input value={supplierForm.registration_number} onChange={e => setSupplierForm(p => ({ ...p, registration_number: e.target.value }))} placeholder="e.g. 2023/123456/07" /></div>
            </div>
            <div><Label>Address</Label><Input value={supplierForm.address} onChange={e => setSupplierForm(p => ({ ...p, address: e.target.value }))} /></div>
            <div><Label>Notes</Label><Textarea value={supplierForm.notes} onChange={e => setSupplierForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
            <Button onClick={saveSupplier} disabled={isSaving || !supplierForm.name.trim()} className="w-full">
              {isSaving ? "Saving..." : editSupplier ? "Update Supplier" : "Add Supplier"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Order Dialog ── */}
      <Dialog open={!!editOrder} onOpenChange={open => { if (!open) setEditOrder(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Edit className="w-5 h-5" /> Edit Purchase Order</DialogTitle></DialogHeader>
          {editOrder && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                Supplier: <span className="font-semibold text-foreground">{editOrder.suppliers?.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Order / Invoice #</Label>
                  <Input value={editOrderForm.order_number} onChange={e => setEditOrderForm(p => ({ ...p, order_number: e.target.value }))} placeholder="e.g. INV-001" />
                </div>
                <div>
                  <Label>Invoice Total *</Label>
                  <Input type="number" value={editOrderForm.invoice_total} onChange={e => setEditOrderForm(p => ({ ...p, invoice_total: e.target.value }))} placeholder="0.00" />
                </div>
              </div>
              <div>
                <Label>Date Received</Label>
                <Input type="date" value={editOrderForm.received_at} onChange={e => setEditOrderForm(p => ({ ...p, received_at: e.target.value }))} className="[color-scheme:dark]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Payment Type</Label>
                  <Select value={editOrderForm.payment_type} onValueChange={v => setEditOrderForm(p => ({ ...p, payment_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="terms">Terms</SelectItem>
                      <SelectItem value="consignment">Consignment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={editOrderForm.status} onValueChange={v => setEditOrderForm(p => ({ ...p, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="partial">Partial</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="consignment">Consignment</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea value={editOrderForm.notes} onChange={e => setEditOrderForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
              </div>
              <Button onClick={saveEditOrder} disabled={isSavingOrder || !editOrderForm.invoice_total} className="w-full">
                {isSavingOrder ? "Saving..." : "Update Order"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Receive Stock Dialog ── */}
      <Dialog open={showNewOrder} onOpenChange={(open) => { setShowNewOrder(open); if (!open) setReceivingPoId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2">{orderMode === "order" ? <ClipboardList className="w-5 h-5" /> : <Truck className="w-5 h-5" />} {orderMode === "order" ? "New Order to Supplier" : receivingPoId ? "Receive Order" : "Receive Stock from Supplier"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Supplier *</Label>
              <Select value={orderForm.supplier_id || "pick"} onValueChange={v => { if (v !== "pick") setOrderForm(p => ({ ...p, supplier_id: v })); }}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pick" disabled>Select supplier</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{orderMode === "order" ? "Deliver To Store *" : "Receiving Store *"}</Label>
              <Select value={orderForm.store_id || "pick"} onValueChange={v => { if (v !== "pick") setOrderForm(p => ({ ...p, store_id: v })); }}>
                <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pick" disabled>Select store</SelectItem>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {orderMode === "order" && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>PO Number</Label><Input value={orderForm.order_number} onChange={e => setOrderForm(p => ({ ...p, order_number: e.target.value }))} /></div>
                <div><Label>Needed By (optional)</Label><Input type="date" value={orderForm.expected_date || ""} onChange={e => setOrderForm(p => ({ ...p, expected_date: e.target.value }))} className="[color-scheme:dark]" /></div>
              </div>
            )}
            {orderMode !== "order" && (<div>
              <Label>Payment Type *</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {[
                  { value: "cash", label: "💵 Cash", desc: "Paid on delivery" },
                  { value: "terms", label: "📋 Terms", desc: "Pay later" },
                  { value: "consignment", label: "🔄 Consignment", desc: "Pay when sold" },
                ].map(t => (
                  <button key={t.value} type="button" onClick={() => setOrderForm(p => ({ ...p, payment_type: t.value }))}
                    className={`p-2.5 rounded-lg border text-center transition-all ${orderForm.payment_type === t.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-border/80"}`}>
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-[10px] mt-0.5 opacity-70">{t.desc}</p>
                  </button>
                ))}
              </div>
              {orderForm.payment_type === "cash" && <p className="text-xs text-green-400 mt-1">✓ Will be auto-marked as paid and a payment record created</p>}
              {orderForm.payment_type === "consignment" && <p className="text-xs text-purple-400 mt-1">✓ Stock received — payment only due after units are sold</p>}
            </div>)}
            {orderMode !== "order" && (<><div className="grid grid-cols-2 gap-3">
              <div><Label>Invoice / Order Number</Label><Input value={orderForm.order_number} onChange={e => setOrderForm(p => ({ ...p, order_number: e.target.value }))} placeholder="e.g. INV-001" /></div>
              <div><Label>Invoice Total</Label><Input type="number" value={orderForm.invoice_total} onChange={e => setOrderForm(p => ({ ...p, invoice_total: e.target.value }))} placeholder="Auto-fills from line items" /></div>
            </div>
            <div>
              <Label>Date Received</Label>
              <Input type="date" value={orderForm.order_date} onChange={e => setOrderForm(p => ({ ...p, order_date: e.target.value }))} className="[color-scheme:dark]" />
            </div></>)}
            {orderMode === "order" && canReorder && (
              <Button type="button" variant="outline" size="sm" className="w-full" disabled={reorderLoading || !orderForm.supplier_id || !orderForm.store_id}
                onClick={() => fillOrderFromReorder(orderForm.supplier_id, orderForm.store_id)}>
                {reorderLoading ? "Loading reorder levels..." : "Reload from reorder levels"}
              </Button>
            )}
            <div className="border border-border rounded-lg p-3 space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground">Line Items — pick existing products so stock updates automatically</h4>
              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-2">
                  <Input value={itemForm.product_name} onChange={e => setItemForm(p => ({ ...p, product_name: e.target.value }))} placeholder="Product name" list="product-suggestions" />
                  <datalist id="product-suggestions">{products.map(p => <option key={p.id} value={p.name} />)}</datalist>
                </div>
                <Input type="number" value={itemForm.quantity} onChange={e => setItemForm(p => ({ ...p, quantity: e.target.value }))} placeholder="Qty" />
                <Input type="number" value={itemForm.cost_price} onChange={e => setItemForm(p => ({ ...p, cost_price: e.target.value }))} placeholder={orderMode === "order" ? "Cost (optional)" : "Cost"} />
              </div>
              <Button size="sm" variant="outline" onClick={addItem} className="gap-1"><Plus className="w-3 h-3" /> Add Item</Button>
              {orderForm.items.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-border">
                  {orderForm.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        {item.product_id
                          ? <PackageCheck className="w-3.5 h-3.5 text-green-400 shrink-0" />
                          : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        {orderMode === "order"
                          ? <><input type="number" min="0" value={item.quantity} onChange={e => setOrderQty(idx, e.target.value)} className="w-14 h-6 rounded border border-border bg-background px-1 text-xs" /> × {item.product_name}{Number(item.cost_price) > 0 ? <> @ {formatCurrency(item.cost_price)}</> : null}</>
                          : <>{item.quantity}× {item.product_name} @ {formatCurrency(item.cost_price)}</>}
                      </span>
                      <div className="flex items-center gap-2">
                        {orderMode !== "order" && <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          Received
                          <input type="number" min="0" max={item.quantity} value={item.received_quantity ?? item.quantity}
                            onChange={e => setReceived(idx, e.target.value)}
                            className={`w-14 h-6 rounded border bg-background px-1 text-xs ${Number(item.received_quantity ?? item.quantity) < item.quantity ? "border-amber-500 text-amber-400" : "border-border"}`} />
                        </label>}
                        <span className="font-semibold">{formatCurrency(item.line_total)}</span>
                        <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-300">×</button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs font-bold pt-1">
                    <span>Calculated Total</span>
                    <span>{formatCurrency(orderForm.items.reduce((s, i) => s + i.line_total, 0))}</span>
                  </div>
                  {orderMode !== "order" && orderForm.items.some(i => Number(i.received_quantity ?? i.quantity) < i.quantity) && (
                    <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 mt-1 space-y-1.5">
                      <p className="text-[11px] text-amber-300">
                        Short delivery: only the received quantities go into stock, and an RFC is raised to this supplier for{" "}
                        {formatCurrency(orderForm.items.reduce((s, i) => s + Math.max(0, i.quantity - Number(i.received_quantity ?? i.quantity)) * i.cost_price, 0))}.
                      </p>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span>Supplier will</span>
                        <select value={orderForm.short_resolution} onChange={e => setOrderForm(p => ({ ...p, short_resolution: e.target.value }))}
                          className="h-6 rounded border border-border bg-background px-1 text-xs">
                          <option value="credit">Issue a credit note</option>
                          <option value="refund">Refund</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {orderForm.items.some(i => !i.product_id) && (
                    <p className="text-[11px] text-amber-400 pt-1">
                      ⚠ Items marked with a warning don't match an existing product and will be skipped when updating stock.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Inventory toggle */}
            {orderMode !== "order" && <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Warehouse className="w-4 h-4 text-primary shrink-0" />
                  <Label className="cursor-pointer">Add these quantities to inventory</Label>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Increases stock at {stores.find(s => s.id === orderForm.store_id)?.name || "the selected store"} and logs a stock movement. Turn off if you'll capture stock manually.
                </p>
              </div>
              <Switch
                checked={orderForm.update_stock}
                onCheckedChange={v => setOrderForm(p => ({ ...p, update_stock: v }))}
              />
            </div>}

            <div><Label>Notes</Label><Textarea value={orderForm.notes} onChange={e => setOrderForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional delivery notes" rows={2} /></div>
            <Button onClick={saveOrder} disabled={isSaving || !orderForm.supplier_id || !orderForm.store_id} className="w-full">
              {isSaving ? "Saving..." : orderMode === "order" ? "Create Order" : receivingPoId ? "Receive Order & Add Stock" : orderForm.payment_type === "consignment" ? "Record Consignment" : orderForm.payment_type === "cash" ? "Receive & Mark Paid" : "Record Purchase Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Record Payment Dialog ── */}
      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Wallet className="w-5 h-5" /> Record Supplier Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Supplier *</Label>
              <Select value={payForm.supplier_id || "pick"} onValueChange={v => { if (v !== "pick") setPayForm(p => ({ ...p, supplier_id: v, purchase_order_id: "none" })); }}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pick" disabled>Select supplier</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {payForm.supplier_id && payForm.supplier_id !== "pick" && (
              <div>
                <Label>Against Order (optional)</Label>
                <Select value={payForm.purchase_order_id} onValueChange={v => setPayForm(p => ({ ...p, purchase_order_id: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General payment (no specific order)</SelectItem>
                    {orders.filter(o => o.supplier_id === payForm.supplier_id && o.status !== "paid" && o.status !== "cancelled" && o.status !== "ordered").map(o => {
                      const bal = (o.invoice_total || 0) - (o.amount_paid || 0);
                      return <SelectItem key={o.id} value={o.id}>{o.order_number || o.id.slice(0, 8)} — {formatCurrency(bal)} due</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount *</Label><Input type="number" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" /></div>
              <div>
                <Label>Method</Label>
                <Select value={payForm.payment_method} onValueChange={v => setPayForm(p => ({ ...p, payment_method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="eft">EFT / Bank Transfer</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="mobile">Mobile Pay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Payment Date</Label>
              <Input type="date" value={payForm.payment_date} onChange={e => setPayForm(p => ({ ...p, payment_date: e.target.value }))} className="[color-scheme:dark]" />
            </div>
            <div><Label>Reference</Label><Input value={payForm.reference} onChange={e => setPayForm(p => ({ ...p, reference: e.target.value }))} placeholder="e.g. EFT ref, receipt number" /></div>
            <div><Label>Notes</Label><Textarea value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" rows={2} /></div>
            <Button onClick={savePayment} disabled={isSaving || !payForm.supplier_id || payForm.supplier_id === "pick" || !payForm.amount} className="w-full bg-green-600 hover:bg-green-700">
              {isSaving ? "Saving..." : "Record Payment — " + formatCurrency(Number(payForm.amount || 0))}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Copy PO to Other Stores Dialog ── */}
      <Dialog open={!!copyOrder} onOpenChange={(open) => { if (!open) { setCopyOrder(null); setCopyStoreIds([]); } }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Copy PO to Other Stores</DialogTitle></DialogHeader>
          {copyOrder && (() => {
            const srcItems = parseItems(copyOrder.items);
            const targets = stores.filter(s => s.id !== copyOrder.store_id);
            return (
              <div className="space-y-4">
                <div className="rounded-lg bg-muted/30 p-3 text-sm">
                  <p className="font-medium">{copyOrder.suppliers?.name} · {copyOrder.order_number || copyOrder.id.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">{srcItems.length} line item{srcItems.length !== 1 ? "s" : ""} · {formatCurrency(copyOrder.invoice_total)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Copy to</Label>
                  <div className="space-y-1 mt-2">
                    {targets.map(s => (
                      <label key={s.id} className="flex items-center gap-3 text-sm bg-muted/30 rounded px-3 py-2 cursor-pointer">
                        <input type="checkbox" checked={copyStoreIds.includes(s.id)} onChange={() => toggleCopyStore(s.id)} />
                        <span>{s.name}</span>
                      </label>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setCopyStoreIds(copyStoreIds.length === targets.length ? [] : targets.map(s => s.id))}>
                    {copyStoreIds.length === targets.length ? "Clear all" : "Select all"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Each store gets its own PO with the same supplier and items. Stock is not added and no payment is recorded — add stock at each store when the goods arrive. Copies start as unpaid (consignment stays consignment). You can edit each store's PO afterwards.
                </p>
                <Button onClick={saveCopyOrder} disabled={isCopying || copyStoreIds.length === 0} className="w-full">
                  {isCopying ? "Copying..." : `Copy to ${copyStoreIds.length} store${copyStoreIds.length !== 1 ? "s" : ""}`}
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Order Detail Dialog ── */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Purchase Order Detail</DialogTitle></DialogHeader>
          {showDetail && (() => {
            const o = showDetail;
            const items = parseItems(o.items);
            const orderPayments = payments.filter(p => p.purchase_order_id === o.id);
            const balance = (o.invoice_total || 0) - (o.amount_paid || 0);
            const isWrittenOff = o.status === "cancelled" && (o.notes || "").includes("[WRITE-OFF");
            return (
              <div className="space-y-4">
                {isWrittenOff && (
                  <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-3 flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-orange-400 shrink-0" />
                    <p className="text-xs text-orange-300">This order was written off — no payment owed. Stock remains in inventory.</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground text-xs">Supplier</span><p className="font-medium">{o.suppliers?.name}</p></div>
                  <div><span className="text-muted-foreground text-xs">Order #</span><p className="font-medium font-mono">{o.order_number || o.id.slice(0, 8)}</p></div>
                  <div><span className="text-muted-foreground text-xs">Invoice Total</span><p className="font-bold">{formatCurrency(o.invoice_total)}</p></div>
                  <div><span className="text-muted-foreground text-xs">Balance Due</span><p className={`font-bold ${balance > 0 && o.status !== "cancelled" ? "text-red-400" : "text-muted-foreground"}`}>{o.status === "cancelled" ? "—" : formatCurrency(balance)}</p></div>
                  <div><span className="text-muted-foreground text-xs">Payment Type</span><p className="font-medium capitalize">{o.payment_type || "terms"}</p></div>
                  <div><span className="text-muted-foreground text-xs">Date Received</span><p className="font-medium">{new Date(o.received_at).toLocaleDateString("en-ZA")}</p></div>
                  <div><span className="text-muted-foreground text-xs">Status</span><span className={`inline-flex items-center text-xs px-2 py-1 rounded-full border font-medium ${STATUS_STYLES[o.status]}`}>{o.status}</span></div>
                  <div>
                    <span className="text-muted-foreground text-xs">Inventory</span>
                    {items.length === 0 ? (
                      <p className="font-medium text-muted-foreground text-xs mt-1">No line items</p>
                    ) : o.stock_applied ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium bg-green-500/10 text-green-400 border-green-500/20">
                        <PackageCheck className="w-3 h-3" /> Added to stock
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium bg-amber-500/10 text-amber-400 border-amber-500/20">
                        <AlertTriangle className="w-3 h-3" /> Not added
                      </span>
                    )}
                  </div>
                </div>
                {o.notes && <div className="rounded-lg bg-muted/30 p-3"><span className="text-xs text-muted-foreground">Notes</span><p className="text-sm whitespace-pre-wrap">{o.notes}</p></div>}
                {items.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-2">Items Received</h4>
                    <div className="space-y-1">
                      {items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs bg-muted/30 rounded px-3 py-2">
                          <span>{item.quantity}× {item.product_name}</span>
                          <span className="font-semibold">{formatCurrency(item.line_total || item.quantity * item.cost_price)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add to inventory */}
                {items.length > 0 && !o.stock_applied && o.status !== "cancelled" && (
                  <Button
                    onClick={() => applyStockToInventory(o)}
                    disabled={applyingStockId === o.id}
                    className="w-full gap-2"
                    variant="outline"
                  >
                    <Warehouse className="w-4 h-4" />
                    {applyingStockId === o.id ? "Updating inventory..." : "Add Received Stock to Inventory"}
                  </Button>
                )}
                {o.stock_applied && o.stock_applied_at && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    Stock added to inventory on {new Date(o.stock_applied_at).toLocaleString("en-ZA")}
                  </p>
                )}

                {/* Copy this PO to other stores */}
                {items.length > 0 && o.status !== "cancelled" && stores.filter(s => s.id !== o.store_id).length > 0 && (
                  <Button onClick={() => openCopyOrder(o)} className="w-full gap-2" variant="outline">
                    <Copy className="w-4 h-4" /> Copy PO to Other Stores
                  </Button>
                )}

                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Payments ({orderPayments.length})</h4>
                  {orderPayments.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No payments recorded against this order</p>
                  ) : (
                    <div className="space-y-1">
                      {orderPayments.map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs bg-green-500/5 border border-green-500/10 rounded px-3 py-2">
                          <div>
                            <p className="font-medium">{formatCurrency(p.amount)} via {p.payment_method}</p>
                            <p className="text-muted-foreground">{new Date(p.paid_at).toLocaleDateString("en-ZA")}{p.reference ? " · " + p.reference : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {balance > 0 && o.status !== "consignment" && o.status !== "cancelled" && (
                  <Button onClick={() => { setShowDetail(null); openPayForOrder(o); }} className="w-full bg-green-600 hover:bg-green-700 gap-2">
                    <CreditCard className="w-4 h-4" /> Pay {formatCurrency(balance)}
                  </Button>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
