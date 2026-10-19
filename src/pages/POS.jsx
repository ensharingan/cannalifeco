import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { Search, QrCode, X, ShoppingCart, ScanLine, Scale, Receipt, CheckCircle, UserCheck, AlertTriangle, Tag, Banknote, PackageSearch, RefreshCw, Ticket, CreditCard, Lock, Store, Wallet, ShoppingBag } from "lucide-react";
import BarcodeScanner from "../components/pos/BarcodeScanner";
import useBarcodeScanner from "../hooks/useBarcodeScanner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import CashierSessionBar from "../components/pos/CashierSessionBar";
import PromotionsBanner from "../components/pos/PromotionsBanner";
import ReceiptModal from "../components/pos/ReceiptModal";
import TillCashOut from "../components/pos/TillCashOut";
import MemberCreditManager from "../components/pos/MemberCreditManager";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrency } from "../lib/currency";
import ProductGrid from "../components/pos/ProductGrid";
import CartPanel, { lineDiscountAmount, lineTotal } from "../components/pos/CartPanel";
import { useCompany } from "../lib/CompanyContext";
import { cn } from "@/lib/utils";

var CATEGORY_ICONS = {
  flower: "🌿", pre_rolls: "🚬", hash_slab: "🔥", vape: "💨",
  tincture: "💧", gummies: "🍬", edibles: "🍪", accessories: "🔧",
  concentrates: "🔥", beverages: "🥤", topicals: "✨", oils: "💧",
  other: "📦", bundle: "🎁",
  flower_greenhouse: "🌿", flower_indoor: "🌿", flower_outdoor: "🌿",
  pre_rolls_greenhouse: "🚬", pre_rolls_indoor: "🚬", pre_rolls_outdoor: "🚬",
  vapes: "💨",
};


var TIER_STYLES = [
  { name: "Bronze",   icon: "🥉", color: "text-orange-500", bg: "bg-orange-500/10" },
  { name: "Silver",   icon: "🥈", color: "text-slate-400",  bg: "bg-slate-400/10"  },
  { name: "Gold",     icon: "🥇", color: "text-yellow-500", bg: "bg-yellow-500/10" },
  { name: "Platinum", icon: "💎", color: "text-purple-500", bg: "bg-purple-500/10" },
];

// Roles allowed to open the credit-management dialog from a member row. This
// is a UI-level gate only — see the note in MemberCreditManager.jsx about RLS.
var CREDIT_MANAGE_ROLES = ["owner", "manager", "superadmin"];

function getTierStyle(points, thresholds) {
  var b = thresholds.bronze   ?? 0;
  var s = thresholds.silver   ?? 500;
  var g = thresholds.gold     ?? 1500;
  var p = thresholds.platinum ?? 5000;
  if (points >= p) return TIER_STYLES[3];
  if (points >= g) return TIER_STYLES[2];
  if (points >= s) return TIER_STYLES[1];
  return TIER_STYLES[0];
}

function normalizeCat(raw) {
  if (!raw) return "";
  return raw.toLowerCase().replace(/-/g, "_").replace(/ /g, "_");
}

// A promo carrying a code is entered by the cashier at the till. It must never
// appear as a banner pill or come off a sale on its own, or the code is
// pointless — the discount would already be gone before anyone typed it.
function isCodedPromo(p) {
  return !!(p && p.code && String(p.code).trim() !== "");
}

// ── Per-store pricing ──────────────────────────────────────────────────
// A branch can sell the same product at its own price. The override lives on
// the store_inventory row that already carries that branch's stock, so a NULL
// simply means "no special price here, use the group price". Resolved once at
// load time and written back onto the product, so every downstream consumer —
// grid, tier picker, cart, receipt — reads one number and none of them has to
// know per-store pricing exists.
function resolveStorePrice(baseValue, overrideValue) {
  if (overrideValue === null || overrideValue === undefined || overrideValue === "") return baseValue;
  var n = Number(overrideValue);
  return isNaN(n) ? baseValue : n;
}

var CART_STORAGE_PREFIX = "cannalife_pos_cart_v1";
var CART_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// PostgREST silently truncates unbounded selects at 1000 rows, so every fetch
// below pages through with .range() until a short page comes back.
var PAGE_SIZE = 1000;
var MAX_PAGES = 30;

async function fetchAllRows(buildQuery) {
  var out = [];
  var page = 0;
  while (page < MAX_PAGES) {
    var from = page * PAGE_SIZE;
    var res = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (res.error) throw res.error;
    var rows = res.data || [];
    out = out.concat(rows);
    if (rows.length < PAGE_SIZE) break;
    page++;
  }
  return out;
}

// .in() lists get sent as a URL query string, so long id lists have to be
// broken into chunks or the request line blows past the server limit.
var IN_CHUNK = 200;

async function fetchProductsByIds(companyId, ids) {
  var out = [];
  for (var i = 0; i < ids.length; i += IN_CHUNK) {
    var slice = ids.slice(i, i + IN_CHUNK);
    var res = await supabase.from("products").select("*")
      .eq("company_id", companyId).in("id", slice);
    if (res.error) throw res.error;
    out = out.concat(res.data || []);
  }
  return out;
}

function cartStorageKey(companyId, storeId, userId) {
  if (!companyId || !userId) return null;
  return CART_STORAGE_PREFIX + ":" + companyId + ":" + (storeId || "nostore") + ":" + userId;
}

function loadStoredCart(key) {
  if (!key) return null;
  try {
    var raw = window.localStorage.getItem(key);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.cart) || parsed.cart.length === 0) return null;
    if (!parsed.savedAt || (Date.now() - parsed.savedAt) > CART_MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch (_) { return null; }
}

function saveStoredCart(key, cart, member, credit) {
  if (!key) return;
  try {
    if (!cart || cart.length === 0) { window.localStorage.removeItem(key); return; }
    window.localStorage.setItem(key, JSON.stringify({
      cart: cart, member: member || null, credit: credit || 0, savedAt: Date.now(),
    }));
  } catch (_) {}
}

function clearStoredCart(key) {
  if (!key) return;
  try { window.localStorage.removeItem(key); } catch (_) {}
}

// Net of every line's own discount. This is the figure store credit and the
// mobile cart badge work from — the gross figure would overstate what's due.
function cartNetSubtotal(cart) {
  return (cart || []).reduce(function (s, i) { return s + lineTotal(i); }, 0);
}

function sortByName(list) {
  return (list || []).slice().sort(function (a, b) {
    var an = String(a && a.name ? a.name : "");
    var bn = String(b && b.name ? b.name : "");
    return an.localeCompare(bn, "en", { sensitivity: "base", numeric: true });
  });
}

function prettyLabel(key) {
  var icon = CATEGORY_ICONS[key] || "📦";
  var name = key.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  return icon + " " + name;
}

function parseItems(raw) {
  var items = [];
  try { items = typeof raw === "string" ? JSON.parse(raw) : (raw || []); } catch (_) { items = []; }
  return Array.isArray(items) ? items : [];
}

function parseApplicable(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

function parseWeightTiers(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

function promoWindowActive(p, now) {
  if (!p.is_active) return false;
  if (isCodedPromo(p)) return false;
  if (p.start_date && new Date(p.start_date + "T00:00:00") > now) return false;
  if (p.end_date && new Date(p.end_date + "T23:59:59") < now) return false;
  if (p.max_uses && (p.usage_count || 0) >= p.max_uses) return false;
  return true;
}

function timeAgoFrom(ts) {
  try {
    var diffMin = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (diffMin < 60) return diffMin + "m ago";
    if (diffMin < 1440) return Math.floor(diffMin / 60) + "h ago";
    return Math.floor(diffMin / 1440) + "d ago";
  } catch (_) { return ""; }
}

function getMembershipExpiry(member) {
  if (!member || !member.expiry_date) return null;
  var expiry = new Date(member.expiry_date);
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  return expiry < today ? expiry : null;
}

function formatExpiryDate(date) {
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

function getDaysExpired(expiryDate) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var diff = Math.floor((today - expiryDate) / (1000 * 60 * 60 * 24));
  return diff;
}

export default function POS() {
  // Taken as a whole rather than destructured, so the optional store-setter
  // below can be looked up without assuming CompanyContext exposes it.
  var companyCtx = useCompany();
  var companyId = companyCtx.companyId;
  var activeStoreId = companyCtx.activeStoreId;
  var ctxStores = companyCtx.stores;
  var company = companyCtx.company;

  // CompanyContext has gone by a few names for this over time. Resolve
  // whichever exists; if none does, the "switch to my session's store" button
  // simply isn't offered and the cashier closes the day instead.
  var setActiveStore = useMemo(function () {
    var candidates = ["setActiveStoreId", "selectStore", "switchStore", "setActiveStore", "changeStore"];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof companyCtx[candidates[i]] === "function") return companyCtx[candidates[i]];
    }
    return null;
  }, [companyCtx]);

  var allowNegative = !!(company && company.allow_negative_stock);

  // Per-club POS flags. Absent key = off, so clubs without pos_settings are
  // unaffected.
  var ps = (company && company.pos_settings) || {};
  var requireOpenSession = !!ps.require_open_session;
  // Canna Life Co does not offer tabs / customer accounts — Open Tabs UI is always hidden.
  var hideOpenTabs = true;

  // Voucher mode: members buy credit at the counter, then collect stock
  // against that credit. Cash and card never touch a stock sale.
  var voucherMode = !!ps.voucher_mode;
  var creditUnit = ps.credit_unit || "Voucher";
  var creditRate = ps.credit_rate && ps.credit_rate > 0 ? ps.credit_rate : 1;

  var [products, setProducts] = useState([]);
  var [storeInventory, setStoreInventory] = useState([]);
  var [promotions, setPromotions] = useState([]);
  var [cart, setCart] = useState([]);
  var [searchTerm, setSearchTerm] = useState("");
  var [selectedCategory, setSelectedCategory] = useState("");
  var [selectedPromo, setSelectedPromo] = useState(null);
  var [selectedMember, setSelectedMember] = useState(null);
  // Member pre-orders (placed via the member portal Shop tab). memberPreorders
  // + showPreorderPrompt drive the auto-popup on member select; the browser
  // dialog and its own live count let staff find one without selecting the
  // member first. activePreorderId tracks which pre-order the current cart
  // was loaded from, so a successful checkout can dismiss it automatically.
  var [memberPreorders, setMemberPreorders] = useState([]);
  var [showPreorderPrompt, setShowPreorderPrompt] = useState(false);
  var [allPendingPreorders, setAllPendingPreorders] = useState([]);
  var [showPreorderBrowser, setShowPreorderBrowser] = useState(false);
  var [loadingPreorders, setLoadingPreorders] = useState(false);
  var [pendingPreorderCount, setPendingPreorderCount] = useState(0);
  var [activePreorderId, setActivePreorderId] = useState(null);
  var [memberSearch, setMemberSearch] = useState("");
  var [searchedMembers, setSearchedMembers] = useState([]);
  var [memberSearching, setMemberSearching] = useState(false);
  var [showMemberDialog, setShowMemberDialog] = useState(false);
  var [discount, setDiscount] = useState(0);
  var [paymentMethod, setPaymentMethod] = useState(voucherMode ? "credit" : "cash");
  var [isProcessing, setIsProcessing] = useState(false);
  var [loading, setLoading] = useState(true);
  var [reloading, setReloading] = useState(false);
  var [loadError, setLoadError] = useState(false);
  var [receipt, setReceipt] = useState(null);
  var [showCart, setShowCart] = useState(false);
  var [showScanner, setShowScanner] = useState(false);
  var [activeSession, setActiveSession] = useState(null);
  var [sessionResolved, setSessionResolved] = useState(false);
  var [tierPickerProduct, setTierPickerProduct] = useState(null);
  var [appliedCredit, setAppliedCredit] = useState(0);
  var [storeSettings, setStoreSettings] = useState(null);
  var [thresholds, setThresholds] = useState({ bronze: 0, silver: 500, gold: 1500, platinum: 5000 });
  var [showCustomerGate, setShowCustomerGate] = useState(false);
  var [pendingProduct, setPendingProduct] = useState(null);
  var [openTabs, setOpenTabs] = useState([]);
  var [showTabsSheet, setShowTabsSheet] = useState(false);
  var [tabsLoading, setTabsLoading] = useState(false);
  var [payAmounts, setPayAmounts] = useState({});
  var [payMethods, setPayMethods] = useState({});
  var [payingKey, setPayingKey] = useState(null);
  // Member store-credit balances, fetched on demand when a cashier picks
  // "Store Credit" as the way to settle a tab — keyed by member_id so the
  // same lookup covers every tab that member has open at once.
  var [tabMemberCredit, setTabMemberCredit] = useState({});
  var [expandedKey, setExpandedKey] = useState(null);
  var [expiryWarningMember, setExpiryWarningMember] = useState(null);
  var [currentUserId, setCurrentUserId] = useState(null);
  var [currentUserRole, setCurrentUserRole] = useState(null);
  var [creditManagerMember, setCreditManagerMember] = useState(null);

  // Voucher sale dialog
  var [showVoucherDialog, setShowVoucherDialog] = useState(false);
  var [voucherAmount, setVoucherAmount] = useState("");
  var [voucherPayMethod, setVoucherPayMethod] = useState("cash");
  var [voucherMember, setVoucherMember] = useState(null);
  var [voucherMemberSearch, setVoucherMemberSearch] = useState("");
  var [voucherMemberResults, setVoucherMemberResults] = useState([]);
  var [issuingVoucher, setIssuingVoucher] = useState(false);

  var hydratedKeyRef = useRef(null);

  // Every load run takes a ticket. Only the newest ticket is allowed to write
  // state, so a slow request fired against the old store can no longer land
  // after a newer one and blank the grid.
  var loadTokenRef = useRef(0);

  // Everything that applies by itself. Coded promos are stripped out here once,
  // so the banner, the pills and the cart all work off the same list.
  var autoPromotions = useMemo(function () {
    return (promotions || []).filter(function (p) { return !isCodedPromo(p); });
  }, [promotions]);

  // ── Store scoping ────────────────────────────────────────────────────
  // The open cashier session owns the store. The sidebar selector is a
  // browsing convenience and must never decide which branch a sale hits —
  // a till logged in at one branch was reading stock from, and deducting
  // stock off, whichever store happened to be selected in the sidebar.
  var sessionStoreId = activeSession && activeSession.store_id ? activeSession.store_id : null;
  var effectiveStoreId = sessionStoreId || activeStoreId || (ctxStores && ctxStores.length > 0 ? ctxStores[0].id : null);

  // When these disagree the cashier is looking at one branch's name and
  // trading on another's stock. That used to be a thin advisory strip, and a
  // full trading day was rung up against the wrong branch before anyone
  // noticed. It now stops the till until it is resolved one way or the other.
  var storeMismatch = !!(sessionStoreId && activeStoreId && sessionStoreId !== activeStoreId);

  var storesReady = Array.isArray(ctxStores);

  var storeNameFor = useCallback(function (id, fallback) {
    var list = ctxStores || [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i].name; }
    return fallback;
  }, [ctxStores]);

  var activeStore = useMemo(function () {
    var list = ctxStores || [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === effectiveStoreId) return list[i]; }
    return null;
  }, [ctxStores, effectiveStoreId]);

  var activeStoreName = activeStore ? activeStore.name : "this store";
  var selectorStoreName = useMemo(function () {
    return storeNameFor(activeStoreId, "another store");
  }, [storeNameFor, activeStoreId]);

  var fmtCredit = useCallback(function (rands) {
    var units = (Number(rands) || 0) / creditRate;
    return units.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + creditUnit;
  }, [creditRate, creditUnit]);

  var storageKey = useMemo(function () {
    return cartStorageKey(companyId, effectiveStoreId, currentUserId);
  }, [companyId, effectiveStoreId, currentUserId]);

  useEffect(function () {
    var cancelled = false;
    supabase.auth.getUser().then(function (res) {
      if (cancelled) return;
      var u = res && res.data ? res.data.user : null;
      setCurrentUserId(u ? u.id : null);
      if (!u) { setCurrentUserRole(null); return; }
      supabase.from("profiles").select("role").eq("id", u.id).maybeSingle()
        .then(function (profRes) {
          if (cancelled) return;
          setCurrentUserRole(profRes && profRes.data ? profRes.data.role : null);
        })
        .catch(function () { if (!cancelled) setCurrentUserRole(null); });
    }).catch(function () { if (!cancelled) { setCurrentUserId(null); setCurrentUserRole(null); } });
    return function () { cancelled = true; };
  }, []);

  var canManageCredit = CREDIT_MANAGE_ROLES.indexOf(currentUserRole) !== -1;

  useEffect(function () {
    if (!storageKey) return;
    if (hydratedKeyRef.current === storageKey) return;
    hydratedKeyRef.current = storageKey;
    var stored = loadStoredCart(storageKey);
    if (!stored) return;
    setCart(stored.cart);
    if (stored.member && !stored.member.is_walkin) setSelectedMember(stored.member);
    if (stored.credit) setAppliedCredit(stored.credit);
    toast.info("Basket restored — " + stored.cart.length + " item" + (stored.cart.length !== 1 ? "s" : "") + ". Check prices before charging.");
  }, [storageKey]);

  useEffect(function () {
    if (!storageKey) return;
    if (hydratedKeyRef.current !== storageKey) return;
    saveStoredCart(storageKey, cart, selectedMember, appliedCredit);
  }, [cart, selectedMember, appliedCredit, storageKey]);

  useEffect(function () {
    if (!companyId) return;
    supabase.from("companies").select("loyalty_bronze, loyalty_silver, loyalty_gold, loyalty_platinum")
      .eq("id", companyId).maybeSingle()
      .then(function (res) {
        if (res.data) {
          setThresholds({
            bronze:   res.data.loyalty_bronze   ?? 0,
            silver:   res.data.loyalty_silver   ?? 500,
            gold:     res.data.loyalty_gold     ?? 1500,
            platinum: res.data.loyalty_platinum ?? 5000,
          });
        }
      });
  }, [companyId]);

  // Loads exactly what this store stocks, rather than the newest 500 products
  // company-wide. With a store selected we read that store's inventory first
  // and then pull only those products, so catalogue size no longer decides
  // whether a store's items show up.
  var loadPosData = useCallback(async function () {
    if (!companyId) return;
    var token = ++loadTokenRef.current;
    var isCurrent = function () { return loadTokenRef.current === token; };

    var invData = await fetchAllRows(function () {
      var q = supabase.from("store_inventory").select("*").eq("company_id", companyId);
      if (effectiveStoreId) q = q.eq("store_id", effectiveStoreId);
      return q;
    });
    if (!isCurrent()) return;

    var rawProducts;
    if (effectiveStoreId && !allowNegative) {
      var idMap = {};
      for (var n = 0; n < invData.length; n++) {
        if ((invData[n].stock_quantity || 0) > 0) idMap[invData[n].product_id] = true;
      }
      var ids = Object.keys(idMap);
      rawProducts = ids.length > 0 ? await fetchProductsByIds(companyId, ids) : [];
      if (!isCurrent()) return;

      // Bundles draw down a linked product, so they can be sellable without an
      // inventory row of their own.
      var bundleRes = await supabase.from("products").select("*")
        .eq("company_id", companyId).eq("is_bundle", true);
      if (bundleRes.error) throw bundleRes.error;
      if (!isCurrent()) return;
      var seen = {};
      for (var s = 0; s < rawProducts.length; s++) seen[rawProducts[s].id] = true;
      var bundles = bundleRes.data || [];
      for (var bi = 0; bi < bundles.length; bi++) {
        if (!seen[bundles[bi].id]) rawProducts.push(bundles[bi]);
      }
    } else {
      rawProducts = await fetchAllRows(function () {
        return supabase.from("products").select("*").eq("company_id", companyId);
      });
      if (!isCurrent()) return;
    }

    var promoRes = await supabase.from("promotions").select("*")
      .eq("company_id", companyId).order("created_at", { ascending: false }).limit(50);
    if (!isCurrent()) return;

    setStoreInventory(invData);
    setPromotions(promoRes.data || []);

    var merged = [];
    for (var idx = 0; idx < rawProducts.length; idx++) {
      var p = rawProducts[idx];
      if (effectiveStoreId) {
        var inv = null;
        for (var i = 0; i < invData.length; i++) {
          if (invData[i].product_id === p.id && invData[i].store_id === effectiveStoreId) { inv = invData[i]; break; }
        }
        var storeStock = inv ? inv.stock_quantity : 0;
        if (storeStock <= 0 && !p.is_bundle && !allowNegative) continue;

        // This branch's own price, where it has one. Written onto price and
        // cost_price rather than kept alongside them, so the grid, the tier
        // picker, the cart and the receipt all read the same field they
        // always have. _base_price is kept only so the difference can be
        // shown; nothing charges off it.
        var storePrice = resolveStorePrice(p.price, inv ? inv.price : null);
        var storeCost = resolveStorePrice(p.cost_price, inv ? inv.cost_price : null);

        merged.push({
          ...p,
          price: storePrice,
          cost_price: storeCost,
          _base_price: p.price,
          _has_store_price: !!(inv && inv.price !== null && inv.price !== undefined),
          stock_quantity: storeStock,
          _inv_id: inv ? inv.id : null,
        });
      } else {
        // "All stores" is a browsing view spanning branches that may price the
        // same item differently, so there is no single correct price to show.
        // The group price stands, and a sale can't be rung from here anyway —
        // checkout takes its store from the open session.
        var total = 0; var hasInv = false;
        for (var j = 0; j < invData.length; j++) {
          if (invData[j].product_id === p.id) { total += invData[j].stock_quantity || 0; hasInv = true; }
        }
        var qty = hasInv ? total : (p.stock_quantity || 0);
        if (qty <= 0 && !p.is_bundle && !allowNegative) continue;
        merged.push({ ...p, _base_price: p.price, _has_store_price: false, stock_quantity: qty, _inv_id: null });
      }
    }
    if (!isCurrent()) return;
    setProducts(sortByName(merged));
  }, [companyId, effectiveStoreId, allowNegative]);

  // Holding off until the store list has resolved stops the very first run
  // firing against a store id that is about to change a tick later. The
  // session lookup is waited on for the same reason — it, not the selector,
  // decides the store, so loading before it lands would read the wrong branch.
  useEffect(function () {
    if (!companyId) return;
    if (!storesReady && !activeStoreId) return;
    if (!sessionResolved) return;
    var cancelled = false;
    setLoading(true);
    setLoadError(false);
    loadPosData()
      .catch(function () {
        if (cancelled) return;
        setLoadError(true);
        toast.error("Failed to load POS data");
      })
      .finally(function () { if (!cancelled) setLoading(false); });
    return function () { cancelled = true; };
  }, [companyId, storesReady, activeStoreId, sessionResolved, loadPosData]);

  var handleReload = useCallback(function () {
    setReloading(true);
    setLoadError(false);
    loadPosData()
      .catch(function () { setLoadError(true); toast.error("Failed to load POS data"); })
      .finally(function () { setReloading(false); });
  }, [loadPosData]);

  useEffect(function () {
    if (!effectiveStoreId || !companyId) return;
    supabase.from("store_settings").select("*").eq("store_id", effectiveStoreId).maybeSingle()
      .then(function (res) { if (res.data) setStoreSettings(res.data); })
      .catch(function () { setStoreSettings(null); });
  }, [effectiveStoreId, companyId]);

  var categories = useMemo(function () {
    var seen = {};
    for (var i = 0; i < products.length; i++) {
      var key = normalizeCat(products[i].category);
      if (key) seen[key] = true;
    }
    var keys = Object.keys(seen).sort();
    var result = [{ key: "", label: "All" }];
    for (var j = 0; j < keys.length; j++) result.push({ key: keys[j], label: prettyLabel(keys[j]) });
    return result;
  }, [products]);

  useEffect(function () {
    if (!showMemberDialog && !showCustomerGate) return;
    if (!companyId) return;
    if (!memberSearch.trim()) {
      setMemberSearching(true);
      supabase.from("members").select("*").eq("company_id", companyId).eq("is_active", true).order("first_name").limit(50)
        .then(function (res) { setSearchedMembers(res.data || []); setMemberSearching(false); });
      return;
    }
    setMemberSearching(true);
    var timeout = setTimeout(async function () {
      try {
        var term = memberSearch.trim().toLowerCase();
        var parts = term.split(/\s+/);
        var res;
        if (parts.length >= 2) {
          var first = parts[0]; var last = parts.slice(1).join(" ");
          res = await supabase.from("members").select("*").eq("company_id", companyId)
            .or("first_name.ilike.%" + first + "%,last_name.ilike.%" + last + "%,first_name.ilike.%" + last + "%,last_name.ilike.%" + first + "%,membership_id.ilike.%" + term + "%,phone.ilike.%" + term + "%")
            .order("first_name").limit(50);
        } else {
          res = await supabase.from("members").select("*").eq("company_id", companyId)
            .or("first_name.ilike.%" + term + "%,last_name.ilike.%" + term + "%,membership_id.ilike.%" + term + "%,email.ilike.%" + term + "%,phone.ilike.%" + term + "%")
            .order("first_name").limit(50);
        }
        setSearchedMembers(res.data || []);
      } catch (err) { setSearchedMembers([]); } finally { setMemberSearching(false); }
    }, 300);
    return function () { clearTimeout(timeout); };
  }, [memberSearch, showMemberDialog, showCustomerGate, companyId]);

  // Member lookup for the voucher sale dialog. Kept separate from the till's
  // own member search so opening one doesn't disturb the other.
  useEffect(function () {
    if (!showVoucherDialog || !companyId) return;
    var term = voucherMemberSearch.trim().toLowerCase();
    var timeout = setTimeout(async function () {
      try {
        var res;
        if (!term) {
          res = await supabase.from("members").select("*").eq("company_id", companyId)
            .eq("is_active", true).order("first_name").limit(50);
        } else {
          res = await supabase.from("members").select("*").eq("company_id", companyId)
            .or("first_name.ilike.%" + term + "%,last_name.ilike.%" + term + "%,membership_id.ilike.%" + term + "%,email.ilike.%" + term + "%,phone.ilike.%" + term + "%")
            .order("first_name").limit(50);
        }
        setVoucherMemberResults(res.data || []);
      } catch (_) { setVoucherMemberResults([]); }
    }, 250);
    return function () { clearTimeout(timeout); };
  }, [voucherMemberSearch, showVoucherDialog, companyId]);

  useEffect(function () {
    if (!companyId) return;
    var fetchSession = async function () {
      try {
        var authRes = await supabase.auth.getUser();
        var user = authRes.data ? authRes.data.user : null;
        if (!user) { setSessionResolved(true); return; }
        var res = await supabase.from("cashier_sessions").select("*").eq("company_id", companyId)
          .eq("cashier_id", user.id).eq("status", "open").order("opening_time", { ascending: false }).limit(1).maybeSingle();
        setActiveSession(res.data || null);
      } catch (_) { setActiveSession(null); } finally { setSessionResolved(true); }
    };
    fetchSession();
    var channel = supabase.channel("session-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "cashier_sessions", filter: "company_id=eq." + companyId }, function () { fetchSession(); })
      .subscribe();
    return function () { supabase.removeChannel(channel); };
  }, [companyId]);

  // A session that opens or closes mid-shift changes which branch the till is
  // trading on. Anything already in the basket was priced and stock-checked
  // against the old branch, so it must not be carried across.
  var lastStoreRef = useRef(null);
  useEffect(function () {
    if (!effectiveStoreId) return;
    if (lastStoreRef.current === null) { lastStoreRef.current = effectiveStoreId; return; }
    if (lastStoreRef.current === effectiveStoreId) return;
    lastStoreRef.current = effectiveStoreId;
    setCart(function (prev) {
      if (prev.length > 0) toast.info("Store changed to " + activeStoreName + " — basket cleared.");
      return [];
    });
    setAppliedCredit(0);
  }, [effectiveStoreId, activeStoreName]);

  var fetchOpenTabs = useCallback(async function () {
    if (!companyId) return;
    setTabsLoading(true);
    try {
      var query = supabase.from("order_balances").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (effectiveStoreId) query = query.or("store_id.eq." + effectiveStoreId + ",store_id.is.null");
      var res = await query;
      var rows = (res.data || []).filter(function (t) { return (parseFloat(t.balance) || 0) > 0.004; });
      setOpenTabs(rows);
    } catch (_) { setOpenTabs([]); } finally { setTabsLoading(false); }
  }, [companyId, effectiveStoreId]);

  useEffect(function () { if (companyId) fetchOpenTabs(); }, [companyId, activeSession, fetchOpenTabs]);

  useEffect(function () {
    if (!companyId) return;
    var channel = supabase.channel("tabs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: "company_id=eq." + companyId }, function () { fetchOpenTabs(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_payments", filter: "company_id=eq." + companyId }, function () { fetchOpenTabs(); })
      .subscribe();
    return function () { supabase.removeChannel(channel); };
  }, [companyId, fetchOpenTabs]);

  // On-demand store-credit lookup for the Open Tabs "Store Credit" payment
  // option. Only fetched when a cashier actually selects that method for a
  // tab, and cached per member_id so switching between a member's several
  // open tabs doesn't re-fetch.
  var fetchTabMemberCredit = useCallback(async function (memberId) {
    if (!memberId || !companyId) return;
    try {
      var res = await supabase.from("members").select("store_credit").eq("id", memberId).eq("company_id", companyId).maybeSingle();
      setTabMemberCredit(function (prev) {
        var n = { ...prev };
        n[memberId] = res && res.data ? (Number(res.data.store_credit) || 0) : 0;
        return n;
      });
    } catch (_) {}
  }, [companyId]);

  var tabGroups = useMemo(function () {
    var byMember = {};
    var groups = [];
    openTabs.forEach(function (t) {
      var bal = parseFloat(t.balance) || 0;
      if (!t.member_id) {
        groups.push({
          key: "o:" + t.order_id, orderId: t.order_id, memberId: null,
          label: t.member_name || "Walk-in", tabs: [t], balance: bal,
          billed: parseFloat(t.total_amount) || 0, paid: parseFloat(t.amount_paid) || 0,
          oldest: t.created_at,
        });
        return;
      }
      if (!byMember[t.member_id]) {
        byMember[t.member_id] = {
          key: "m:" + t.member_id, orderId: null, memberId: t.member_id,
          label: t.member_name || "Member", tabs: [], balance: 0, billed: 0, paid: 0, oldest: t.created_at,
        };
        groups.push(byMember[t.member_id]);
      }
      var g = byMember[t.member_id];
      g.tabs.push(t);
      g.balance += bal;
      g.billed += parseFloat(t.total_amount) || 0;
      g.paid += parseFloat(t.amount_paid) || 0;
      if (new Date(t.created_at) < new Date(g.oldest)) g.oldest = t.created_at;
    });
    groups.sort(function (a, b) { return b.balance - a.balance; });
    return groups;
  }, [openTabs]);

  var totalOutstanding = useMemo(function () {
    return openTabs.reduce(function (s, t) { return s + (parseFloat(t.balance) || 0); }, 0);
  }, [openTabs]);

  var setPayAmount = function (key, val) {
    setPayAmounts(function (prev) { return { ...prev, [key]: val }; });
  };
  var setPayMethod = function (key, val) {
    setPayMethods(function (prev) { return { ...prev, [key]: val }; });
  };

  var handleTakePayment = async function (group) {
    if (!activeSession) { toast.error("Open the day first — tab payments have to land in a cashier session so they show up on cash-up."); return; }
    var amount = parseFloat(payAmounts[group.key]);
    if (isNaN(amount) || amount <= 0) { toast.error("Enter an amount"); return; }
    if (amount - group.balance > 0.004) { toast.error("That's more than the " + formatCurrency(group.balance) + " owed"); return; }
    var method = payMethods[group.key] || "cash";

    // Store credit only exists on a member profile, and it has to actually
    // cover what's being taken — there's no cash/card top-up for a shortfall
    // on this method, unlike a normal tender.
    if (method === "store_credit") {
      if (!group.memberId) { toast.error("This tab has no member on it — store credit isn't available."); return; }
      var available = tabMemberCredit[group.memberId];
      if (available === undefined) {
        toast.error("Still loading this member's credit balance — try again in a moment.");
        fetchTabMemberCredit(group.memberId);
        return;
      }
      if (amount - available > 0.004) {
        toast.error("Only " + formatCurrency(available) + " credit available — short by " + formatCurrency(amount - available));
        return;
      }
    }

    setPayingKey(group.key);
    try {
      var res = await supabase.rpc("record_tab_payment", {
        p_amount: amount, p_payment_method: method,
        p_member_id: group.memberId || null, p_order_id: group.orderId || null,
        p_cashier_session_id: activeSession.id, p_store_id: effectiveStoreId || null, p_notes: null,
      });
      if (res.error) throw res.error;

      // Draw the amount off the member's store credit now that the payment is
      // actually booked. Best-effort logging to store_credit_transactions —
      // the tab payment has already landed, so a failed audit write here must
      // not undo it.
      if (method === "store_credit" && group.memberId) {
        try {
          var newBalance = Math.max(0, (tabMemberCredit[group.memberId] || 0) - amount);
          await supabase.from("members").update({ store_credit: newBalance }).eq("id", group.memberId);
          await supabase.from("store_credit_transactions").insert({
            company_id: companyId, member_id: group.memberId, amount: -amount,
            type: "tab_payment", note: "Store credit used to settle tab — " + formatCurrency(amount),
          });
          setTabMemberCredit(function (prev) { var n = { ...prev }; n[group.memberId] = newBalance; return n; });
        } catch (_) {}
      }

      var settled = res.data && res.data.tabs_settled ? res.data.tabs_settled : 0;
      var remaining = group.balance - amount;
      toast.success(
        formatCurrency(amount) + " from " + group.label +
        (remaining > 0.004 ? " — " + formatCurrency(remaining) + " still owing" : " — account settled") +
        (settled > 0 ? " (" + settled + " tab" + (settled !== 1 ? "s" : "") + " closed)" : "")
      );
      if (method === "cash") {
        toast.info(formatCurrency(amount) + " cash added to the drawer — it will show on your cash-up.");
      }
      setPayAmount(group.key, "");
      await fetchOpenTabs();
    } catch (err) {
      toast.error("Payment failed: " + (err && err.message ? err.message : "Unknown error"));
    } finally { setPayingKey(null); }
  };

  // Adds a completed take to the open session totals. Reads the row back first
  // so a second till or a tab payment can't be silently overwritten.
  var bumpSessionTotals = useCallback(async function (amount, method) {
    if (!activeSession) return;
    try {
      var cashAmount = method === "cash" ? amount : 0;
      var cardAmount = method === "cash" ? 0 : amount;
      var freshRes = await supabase.from("cashier_sessions")
        .select("total_sales, total_orders, cash_sales, card_sales")
        .eq("id", activeSession.id).maybeSingle();
      var base = freshRes && freshRes.data ? freshRes.data : activeSession;
      var nextTotals = {
        total_sales: (Number(base.total_sales) || 0) + amount,
        total_orders: (Number(base.total_orders) || 0) + 1,
        cash_sales: (Number(base.cash_sales) || 0) + cashAmount,
        card_sales: (Number(base.card_sales) || 0) + cardAmount,
      };
      await supabase.from("cashier_sessions").update({
        total_sales: nextTotals.total_sales,
        total_orders: nextTotals.total_orders,
        cash_sales: nextTotals.cash_sales,
        card_sales: nextTotals.card_sales,
        updated_at: new Date().toISOString(),
      }).eq("id", activeSession.id);
      setActiveSession(function (prev) {
        if (!prev) return null;
        return { ...prev, ...nextTotals };
      });
    } catch (_) {}
  }, [activeSession]);

  // ── Voucher sale ──────────────────────────────────────────────────────
  // The voucher is the revenue event, so it books a real order. No stock
  // moves here — that happens later when the member collects.
  var handleSellVoucher = async function () {
    if (!activeSession) { toast.error("Open the day before selling a voucher, so the money lands on your cash-up."); return; }
    if (storeMismatch) { toast.error("Fix the store mismatch before selling a voucher."); return; }
    if (!voucherMember) { toast.error("Select the member the voucher is for"); return; }
    var amount = parseFloat(voucherAmount);
    if (isNaN(amount) || amount <= 0) { toast.error("Enter a voucher amount"); return; }
    setIssuingVoucher(true);
    var createdOrderId = null;
    try {
      var memberName = voucherMember.first_name + " " + (voucherMember.last_name || "");
      var orderRes = await supabase.from("orders").insert([{
        company_id: companyId,
        store_id: effectiveStoreId || null,
        member_id: voucherMember.id,
        member_name: memberName.trim(),
        total_amount: amount,
        discount_amount: 0,
        payment_method: voucherPayMethod,
        payment_details: JSON.stringify([{ method: voucherPayMethod, amount: amount }]),
        credit_applied: 0,
        status: "completed",
        order_type: "voucher",
        items: JSON.stringify([{ name: "Voucher", quantity: 1, price: amount }]),
        cashier_session_id: activeSession.id,
        user_id: currentUserId,
      }]).select().single();
      if (orderRes.error) throw orderRes.error;
      createdOrderId = orderRes.data.id;

      var rpcRes = await supabase.rpc("issue_voucher", {
        p_company_id: companyId,
        p_member_id: voucherMember.id,
        p_amount: amount,
        p_payment_method: voucherPayMethod,
        p_store_id: effectiveStoreId || null,
        p_issued_by: currentUserId,
      });
      if (rpcRes.error) throw rpcRes.error;
      var v = rpcRes.data || {};

      await supabase.from("vouchers").update({ order_id: createdOrderId }).eq("id", v.voucher_id);
      await bumpSessionTotals(amount, voucherPayMethod);

      // Keep the till's copy of the member in step if it's the same person.
      if (selectedMember && selectedMember.id === voucherMember.id) {
        setSelectedMember(function (prev) { return { ...prev, store_credit: v.available_credit }; });
      }

      setReceipt({
        kind: "voucher_purchase",
        storeName: activeStore ? activeStore.name : "My Store",
        createdAt: new Date().toISOString(),
        creditUnit: creditUnit,
        creditRate: creditRate,
        voucher: {
          memberName: memberName.trim(),
          voucherNumber: v.voucher_number,
          amountPaid: v.amount_paid,
          availableCredit: v.available_credit,
        },
      });

      toast.success("Voucher " + v.voucher_number + " issued — " + fmtCredit(v.available_credit) + " available");
      setShowVoucherDialog(false);
      setVoucherAmount("");
      setVoucherMember(null);
      setVoucherMemberSearch("");
    } catch (err) {
      // Roll the sale back rather than leaving money booked against a voucher
      // that was never created.
      if (createdOrderId) {
        try { await supabase.from("orders").delete().eq("id", createdOrderId); } catch (_) {}
      }
      toast.error("Voucher failed: " + (err && err.message ? err.message : "Unknown error"));
    } finally {
      setIssuingVoucher(false);
    }
  };

  var memberTierKey = useMemo(function () {
    if (!selectedMember || selectedMember.is_walkin) return null;
    return getTierStyle(selectedMember.loyalty_points || 0, thresholds).name.toLowerCase();
  }, [selectedMember, thresholds]);

  var getPromoTiersFor = useCallback(function (product) {
    if (!product) return [];
    var out = [];
    var now = new Date();
    for (var i = 0; i < (promotions || []).length; i++) {
      var p = promotions[i];
      if (p.promo_type !== "weight_special") continue;
      if (!promoWindowActive(p, now)) continue;
      var targetTier = (p.target_tier || "all").toLowerCase();
      if (targetTier !== "all" && memberTierKey !== targetTier) continue;
      var applicable = parseApplicable(p.applicable_products);
      if (applicable.length > 0 && applicable.indexOf(product.id) === -1) continue;
      var tiers = parseWeightTiers(p.weight_tiers);
      for (var t = 0; t < tiers.length; t++) {
        var grams = Number(tiers[t].grams) || 0;
        var price = Number(tiers[t].price) || 0;
        if (grams <= 0 || price <= 0) continue;
        out.push({ grams, price, label: tiers[t].label || (grams + "g for R" + price), _promo_id: p.id, _promo_name: p.name });
      }
    }
    out.sort(function (a, b) { return a.grams - b.grams; });
    return out;
  }, [promotions, memberTierKey]);

  // NOTE ON WEIGHT TIERS: both products.price_tiers and promotion weight_tiers
  // hold flat rand amounts ("5g for R400"), not multiples of the unit price, so
  // a per-store override on the product does NOT move them. A branch that
  // prices differently and also runs weight tiers needs its own promotion, or
  // the tiers have to move onto store_inventory too.
  var getAllTiers = useCallback(function (product) {
    if (!product) return [];
    var base = Array.isArray(product.price_tiers) ? product.price_tiers : [];
    return base.concat(getPromoTiersFor(product));
  }, [getPromoTiersFor]);

  var requireCustomer = useCallback(function (product) {
    if (selectedMember) return true;
    if (product) setPendingProduct(product);
    setShowCustomerGate(true);
    setMemberSearch("");
    return false;
  }, [selectedMember]);

  var handleSelectMember = useCallback(function (m) {
    var expired = getMembershipExpiry(m);
    if (expired) {
      setShowCustomerGate(false);
      setShowMemberDialog(false);
      setMemberSearch("");
      setExpiryWarningMember(m);
      return;
    }
    setSelectedMember(m);
    setShowCustomerGate(false);
    setShowMemberDialog(false);
    setMemberSearch("");

    // Surface any pre-orders this member placed via the member portal Shop
    // tab, so staff don't have to remember to check the Sales screen.
    if (companyId && m && !m.is_walkin) {
      supabase.from("orders").select("id, items, total_amount, notes, created_at, store_id")
        .eq("company_id", companyId).eq("member_id", m.id)
        .eq("order_type", "pre_order").eq("status", "pending")
        .order("created_at", { ascending: true })
        .then(function (res) {
          var rows = res.data || [];
          setMemberPreorders(rows);
          if (rows.length > 0) setShowPreorderPrompt(true);
        });
    } else {
      setMemberPreorders([]);
    }
  }, [companyId]);

  // Loads a pre-order's items into the live cart at current prices and stock
  // — the same addToCartDirect the product grid uses, so weight tiers, stock
  // caps, and pricing all behave exactly like ringing it up by hand. Nothing
  // here touches the source order; it's marked cancelled only once the real
  // sale actually completes (see the checkout success handler).
  var loadPreorderIntoCart = useCallback(function (order) {
    if (storeMismatch) {
      toast.error("Sort out the store first — your session is at " + activeStoreName + " but the selector says " + selectorStoreName + ".");
      return;
    }
    if (requireOpenSession && !activeSession) {
      toast.error("Open the day before loading a pre-order");
      return;
    }
    var items = Array.isArray(order.items) ? order.items : [];
    var missing = [];
    items.forEach(function (it) {
      var product = (products || []).find(function (p) { return p.id === it.product_id; });
      if (!product) { missing.push(it.name); return; }
      var qty = Number(it.quantity) || 0;
      for (var i = 0; i < qty; i++) { addToCartDirect(product, null); }
    });
    setActivePreorderId(order.id);
    setShowPreorderPrompt(false);
    setShowPreorderBrowser(false);
    if (missing.length > 0) {
      toast.error("No longer available, skipped: " + missing.join(", "));
    } else {
      toast.success("Pre-order loaded into cart — review and charge as normal");
    }
  }, [products, addToCartDirect, storeMismatch, requireOpenSession, activeSession, activeStoreName, selectorStoreName]);

  // For the "browse all" dialog: the order only carries member_id/member_name,
  // not the full profile the cart needs (store_credit, ban status, expiry) —
  // fetch it properly before switching the active customer.
  var loadPreorderFromBrowser = useCallback(async function (order) {
    if (order.member_id) {
      var res = await supabase.from("members").select("*").eq("id", order.member_id).eq("company_id", companyId).single();
      if (!res.data) { toast.error("Couldn't find this member's profile"); return; }
      if (getMembershipExpiry(res.data)) { toast.error(res.data.first_name + "'s membership has expired — resolve that first."); return; }
      setSelectedMember(res.data);
    }
    loadPreorderIntoCart(order);
  }, [companyId, loadPreorderIntoCart]);

  var loadAllPendingPreorders = useCallback(async function () {
    if (!companyId) return;
    setLoadingPreorders(true);
    try {
      var res = await supabase.from("orders").select("id, member_id, member_name, items, total_amount, notes, created_at, store_id")
        .eq("company_id", companyId).eq("order_type", "pre_order").eq("status", "pending")
        .order("created_at", { ascending: true });
      setAllPendingPreorders(res.data || []);
    } finally {
      setLoadingPreorders(false);
    }
  }, [companyId]);

  // Live badge count on the toolbar button — independent of the dialog above,
  // so staff see there's something waiting without opening it first.
  useEffect(function () {
    if (!companyId) return;
    var cancelled = false;
    var loadCount = function () {
      supabase.from("orders").select("id", { count: "exact", head: true })
        .eq("company_id", companyId).eq("order_type", "pre_order").eq("status", "pending")
        .then(function (res) { if (!cancelled) setPendingPreorderCount(res.count || 0); });
    };
    loadCount();
    var channel = supabase.channel("pos-preorder-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: "company_id=eq." + companyId }, loadCount)
      .subscribe();
    return function () { cancelled = true; supabase.removeChannel(channel); };
  }, [companyId]);

  var handleProceedExpired = useCallback(function () {
    if (!expiryWarningMember) return;
    setSelectedMember(expiryWarningMember);
    setExpiryWarningMember(null);
  }, [expiryWarningMember]);

  var handleCancelExpired = useCallback(function () {
    setExpiryWarningMember(null);
    setShowCustomerGate(true);
    setMemberSearch("");
  }, []);

  // product.price and product.cost_price are already this branch's numbers by
  // the time they reach here — resolved once in loadPosData.
  var addToCartDirect = useCallback(function (product, tierOverride) {
    if (selectedMember && selectedMember.is_banned) { toast.error("This member is banned and cannot make purchases"); return; }
    var gramsPerUnit = tierOverride ? Number(tierOverride.grams) || 1 : 1;
    var unitPrice = tierOverride ? Number(tierOverride.price) : Number(product.price);
    var itemName = tierOverride ? product.name + " (" + (tierOverride.label || tierOverride.grams + "g") + ")" : product.name;
    var promoId = tierOverride && tierOverride._promo_id ? tierOverride._promo_id : null;
    var promoName = tierOverride && tierOverride._promo_name ? tierOverride._promo_name : null;
    var cartKey = product.id + ":" + gramsPerUnit + ":" + (promoId || "base");

    setCart(function (prev) {
      var idx = -1;
      for (var i = 0; i < prev.length; i++) { if (prev[i]._cart_key === cartKey) { idx = i; break; } }
      var totalGramsInCart = 0;
      for (var ci = 0; ci < prev.length; ci++) {
        if (prev[ci].product_id === product.id) totalGramsInCart += prev[ci].qty * (prev[ci].grams_per_unit || 1);
      }
      if (idx >= 0) {
        if (!allowNegative && totalGramsInCart + gramsPerUnit > product.stock_quantity) {
          toast.error("Not enough stock (" + product.stock_quantity + "g available, " + totalGramsInCart + "g in cart)");
          return prev;
        }
        var updated = prev.slice();
        updated[idx] = { ...updated[idx], qty: updated[idx].qty + 1 };
        return updated;
      }
      if (!allowNegative && totalGramsInCart + gramsPerUnit > product.stock_quantity) {
        toast.error("Not enough stock (" + product.stock_quantity + "g available)");
        return prev;
      }
      return prev.concat([{
        _cart_key: cartKey, product_id: product.id, name: itemName, price: unitPrice, qty: 1,
        stock: allowNegative ? 999999 : Math.floor((product.stock_quantity - totalGramsInCart) / gramsPerUnit),
        grams_per_unit: gramsPerUnit, unit_weight: product.unit_weight || null,
        product_type: product.product_type || null, category: product.category || null,
        cost_price: product.cost_price != null ? Number(product.cost_price) : null,
        sku: product.sku || null, supplier_id: product.supplier_id || null,
        promo_id: promoId, promo_name: promoName,
        // This line's own discount. Starts at nothing; the cart panel edits it.
        line_discount: 0, line_discount_type: "rand",
      }]);
    });
  }, [selectedMember, allowNegative]);

  var handleProductSelect = useCallback(function (product) {
    // Hard stop. While the session's branch and the selector disagree there is
    // no safe answer to "which store is this coming off", so nothing goes in
    // the basket until the cashier resolves it. With per-store pricing this
    // matters more than before — the wrong branch means the wrong price too.
    if (storeMismatch) {
      toast.error("Sort out the store first — your session is at " + activeStoreName + " but the selector says " + selectorStoreName + ".");
      return;
    }
    if (requireOpenSession && !activeSession) {
      toast.error("Open the day before ringing up a sale");
      return;
    }
    if (!selectedMember) { requireCustomer(product); return; }
    var tiers = getAllTiers(product);
    if (tiers.length > 0) { setTierPickerProduct(product); }
    else { addToCartDirect(product, null); }
  }, [selectedMember, requireCustomer, addToCartDirect, getAllTiers, requireOpenSession, activeSession, storeMismatch, activeStoreName, selectorStoreName]);

  useEffect(function () {
    if (selectedMember && pendingProduct) {
      var prod = pendingProduct;
      setPendingProduct(null);
      setTimeout(function () { handleProductSelect(prod); }, 50);
    }
  }, [selectedMember, pendingProduct, handleProductSelect]);

  var handleTierSelect = function (tier) {
    if (tierPickerProduct) { addToCartDirect(tierPickerProduct, tier); setTierPickerProduct(null); }
  };

  var handleBaseSelect = function () {
    if (tierPickerProduct) { addToCartDirect(tierPickerProduct, { grams: 1, price: tierPickerProduct.price, label: "1g" }); setTierPickerProduct(null); }
  };

  var updateQty = useCallback(function (cartKeyOrIdx, newQty) {
    setCart(function (prev) {
      var idx = typeof cartKeyOrIdx === "number" ? cartKeyOrIdx : -1;
      if (idx === -1) {
        for (var i = 0; i < prev.length; i++) {
          if (prev[i]._cart_key === cartKeyOrIdx || prev[i].id === cartKeyOrIdx) { idx = i; break; }
        }
      }
      if (idx === -1) return prev;
      if (typeof newQty === "number") {
        if (newQty <= 0) return prev.filter(function (_, i) { return i !== idx; });
        var updated = prev.slice();
        updated[idx] = { ...updated[idx], qty: newQty };
        return updated;
      } else {
        var updatedD = prev.slice();
        var nq = updatedD[idx].qty + newQty;
        if (nq <= 0) return prev.filter(function (_, i) { return i !== idx; });
        if (!allowNegative && nq > updatedD[idx].stock) return prev;
        updatedD[idx] = { ...updatedD[idx], qty: nq };
        return updatedD;
      }
    });
  }, [allowNegative]);

  // Sets one line's own discount. The value is stored as typed; the cap (never
  // below zero, never over 100%) is applied when the amount is worked out, so
  // the cashier sees the effect immediately and the order gets the same figure.
  var updateLineDiscount = useCallback(function (cartKeyOrIdx, value, type) {
    setCart(function (prev) {
      var idx = typeof cartKeyOrIdx === "number" ? cartKeyOrIdx : -1;
      if (idx === -1) {
        for (var i = 0; i < prev.length; i++) {
          if (prev[i]._cart_key === cartKeyOrIdx || prev[i].id === cartKeyOrIdx) { idx = i; break; }
        }
      }
      if (idx === -1) return prev;
      var v = Number(value);
      if (isNaN(v) || v < 0) v = 0;
      var t = type === "percentage" ? "percentage" : "rand";
      if (t === "percentage" && v > 100) v = 100;
      var current = prev[idx];
      if ((Number(current.line_discount) || 0) === v && (current.line_discount_type || "rand") === t) return prev;
      var updated = prev.slice();
      updated[idx] = { ...current, line_discount: v, line_discount_type: t };
      return updated;
    });
  }, []);

  // requestedAmount lets voucher mode ask for the full amount due, including
  // any membership fee, rather than just the item subtotal.
  var handleApplyCredit = function (requestedAmount) {
    if (!selectedMember || !selectedMember.store_credit || selectedMember.store_credit <= 0) return;
    var subtotal = cartNetSubtotal(cart);
    var want = typeof requestedAmount === "number" && requestedAmount > 0 ? requestedAmount : subtotal;
    var creditToApply = Math.min(selectedMember.store_credit, want);
    setAppliedCredit(creditToApply);
    toast.success(voucherMode
      ? fmtCredit(creditToApply) + " ready to redeem"
      : formatCurrency(creditToApply) + " store credit applied");
  };

  var handleAddChangeToCredit = async function (amount) {
    if (!selectedMember || selectedMember.is_walkin || amount <= 0) return;
    try {
      var newBalance = (selectedMember.store_credit || 0) + amount;
      var res = await supabase.from("members").update({ store_credit: newBalance }).eq("id", selectedMember.id);
      if (res.error) throw res.error;
      await supabase.from("store_credit_transactions").insert({
        company_id: companyId, member_id: selectedMember.id, amount,
        type: "change_credit", note: "Change of " + formatCurrency(amount) + " added as store credit",
      });
      setSelectedMember(function (prev) { return { ...prev, store_credit: newBalance }; });
      toast.success(formatCurrency(amount) + " added to " + selectedMember.first_name + "'s store credit");
    } catch (err) {
      toast.error("Failed to add store credit: " + (err && err.message ? err.message : "Unknown error"));
    }
  };

  var handleCheckout = async function (checkoutData) {
    if (!activeSession) { toast.error("No active cashier session. Please open a session before making sales."); return; }
    // Belt and braces. The grid is already blocked on a mismatch, but a basket
    // built before the selector moved must not be pushed through either.
    if (storeMismatch) {
      toast.error("Your session is at " + activeStoreName + " but the selector says " + selectorStoreName + ". Fix that before charging.");
      return;
    }
    // The store is taken from the session at the moment of the sale, so a
    // stale selector can never send stock movements to the wrong branch.
    var saleStoreId = activeSession.store_id || effectiveStoreId || null;
    setIsProcessing(true);
    var createdOrderId = null;
    try {
      // Prices are snapshotted onto the order. That is what makes per-store
      // pricing safe for history: a later change to either the group price or
      // a branch override never rewrites what was actually charged.
      // The line's own discount is snapshotted the same way — price stays the
      // list price, line_discount_amount is what came off, line_total is what
      // the line actually contributed. Refunds and reports read line_total.
      var orderItems = cart.map(function (c) {
        var discAmt = lineDiscountAmount(c);
        return {
          product_id: c.product_id, name: c.name, quantity: c.qty, price: c.price,
          grams_per_unit: c.grams_per_unit || 1,
          category: c.category || null, product_type: c.product_type || null,
          cost_price: c.cost_price != null ? c.cost_price : null,
          sku: c.sku || null, supplier_id: c.supplier_id || null,
          promo_id: c.promo_id || null, promo_name: c.promo_name || null,
          line_discount: Number(c.line_discount) || 0,
          line_discount_type: c.line_discount_type || "rand",
          line_discount_amount: Math.round(discAmt * 100) / 100,
          line_total: Math.round(lineTotal(c) * 100) / 100,
        };
      });

      var finalTotal = checkoutData ? checkoutData.total : cartNetSubtotal(cart);
      var finalPaymentMethod = checkoutData ? checkoutData.paymentMethod : paymentMethod;
      // All-in: line discounts + promos + code + manual. The cart panel adds
      // them up so this matches what was on screen to the cent.
      var discountAmount = checkoutData ? checkoutData.discountAmount : 0;
      var discountType = checkoutData ? checkoutData.discountType : "percentage";
      var discountValue = checkoutData ? checkoutData.discountValue : 0;
      var paymentDetails = checkoutData ? checkoutData.paymentDetails : null;
      var membershipFee = checkoutData ? (checkoutData.membershipFee || 0) : 0;
      var promoCode = checkoutData ? checkoutData.promoCode : null;
      var isWalkIn = !selectedMember || selectedMember.is_walkin;

      if (isWalkIn) {
        toast.error("Select a member before charging. Every sale must be linked to a member.");
        setIsProcessing(false);
        return;
      }

      if (voucherMode && isWalkIn) {
        toast.error("Select the member — credit is held on their profile.");
        setIsProcessing(false);
        return;
      }

      var orderData = {
        company_id: companyId, store_id: saleStoreId,
        member_id: isWalkIn ? null : selectedMember.id,
        member_name: isWalkIn ? "Walk-in" : selectedMember.first_name + " " + selectedMember.last_name,
        total_amount: finalTotal, discount_amount: discountAmount, discount_type: discountType, discount_value: discountValue,
        payment_method: finalPaymentMethod, payment_details: paymentDetails ? JSON.stringify(paymentDetails) : null,
        credit_applied: appliedCredit || 0,
        status: finalPaymentMethod === "unpaid" ? "unpaid" : "completed",
        order_type: voucherMode ? "collection" : "pos",
        items: JSON.stringify(orderItems), cashier_session_id: activeSession.id,
        user_id: currentUserId,
      };

      var insertResult = await supabase.from("orders").insert([orderData]).select().single();
      if (insertResult.error) throw insertResult.error;
      var order = insertResult.data;
      createdOrderId = order.id;

      // Credit draw-down. Voucher mode goes through the RPC so the oldest
      // voucher is consumed first and every leg is written to
      // voucher_redemptions for the audit trail.
      var redemption = null;
      if (appliedCredit > 0 && selectedMember && !isWalkIn) {
        if (voucherMode) {
          var redeemRes = await supabase.rpc("redeem_voucher_credit", {
            p_company_id: companyId,
            p_member_id: selectedMember.id,
            p_amount: appliedCredit,
            p_order_id: order.id,
            p_created_by: currentUserId,
          });
          if (redeemRes.error) throw redeemRes.error;
          var rd = redeemRes.data || {};
          redemption = {
            valueRedeemed: rd.value_redeemed,
            vouchersUsed: rd.vouchers_used || [],
            remainingCredit: rd.remaining_credit,
          };
          setSelectedMember(function (prev) { return { ...prev, store_credit: rd.remaining_credit }; });
        } else {
          try {
            var newCreditBalance = Math.max(0, (selectedMember.store_credit || 0) - appliedCredit);
            await supabase.from("members").update({ store_credit: newCreditBalance }).eq("id", selectedMember.id);
            await supabase.from("store_credit_transactions").insert({ company_id: companyId, member_id: selectedMember.id, amount: -appliedCredit, type: "purchase", note: "Store credit used for order #" + (order.order_number || order.id.slice(0, 8)) });
            setSelectedMember(function (prev) { return { ...prev, store_credit: newCreditBalance }; });
          } catch (_) {}
        }
      }

      // Promo code redemption. Logs which code came off which sale and bumps
      // usage_count so max-uses caps actually bite. Deliberately non-fatal —
      // the money has already changed hands, so a failed audit write here must
      // not fail the sale.
      if (promoCode && promoCode.promotionId) {
        try {
          var codeRes = await supabase.rpc("promo_code_redeem", {
            p_promotion_id: promoCode.promotionId,
            p_order_id: order.id,
            p_discount: promoCode.discountAmount || 0,
            p_member_id: isWalkIn ? null : selectedMember.id,
            p_store_id: saleStoreId,
          });
          if (codeRes.error) throw codeRes.error;
        } catch (_codeErr) {
          console.warn("Promo code redemption failed to log", _codeErr);
        }
      }

      try {
        var promoCounts = {};
        for (var uc = 0; uc < cart.length; uc++) {
          if (cart[uc].promo_id) promoCounts[cart[uc].promo_id] = (promoCounts[cart[uc].promo_id] || 0) + cart[uc].qty;
        }
        var promoIds = Object.keys(promoCounts);
        for (var pk = 0; pk < promoIds.length; pk++) {
          var promoRow = null;
          for (var pr = 0; pr < promotions.length; pr++) { if (promotions[pr].id === promoIds[pk]) { promoRow = promotions[pr]; break; } }
          if (!promoRow) continue;
          await supabase.from("promotions").update({ usage_count: (promoRow.usage_count || 0) + promoCounts[promoIds[pk]] }).eq("id", promoIds[pk]);
        }
      } catch (_) {}

      // Voucher-mode collections take no money at the till — the cash was
      // already counted when the voucher was sold, so nothing is added here.
      if (!voucherMode && finalPaymentMethod !== "unpaid") {
        try {
          var cashAmount = 0; var cardAmount = 0;
          if (finalPaymentMethod === "split" && paymentDetails) {
            for (var pi = 0; pi < paymentDetails.length; pi++) {
              if (paymentDetails[pi].method === "cash") cashAmount += paymentDetails[pi].amount;
              else cardAmount += paymentDetails[pi].amount;
            }
          } else {
            cashAmount = finalPaymentMethod === "cash" ? finalTotal : 0;
            cardAmount = finalPaymentMethod !== "cash" ? finalTotal : 0;
          }
          // Read the row back before adding to it. The in-memory copy goes
          // stale the moment a second till, or a tab payment, touches the
          // same session, and the old read-modify-write silently lost those.
          var freshRes = await supabase.from("cashier_sessions")
            .select("total_sales, total_orders, cash_sales, card_sales")
            .eq("id", activeSession.id).maybeSingle();
          var base = freshRes && freshRes.data ? freshRes.data : activeSession;
          var nextTotals = {
            total_sales: (Number(base.total_sales) || 0) + finalTotal,
            total_orders: (Number(base.total_orders) || 0) + 1,
            cash_sales: (Number(base.cash_sales) || 0) + cashAmount,
            card_sales: (Number(base.card_sales) || 0) + cardAmount,
          };
          await supabase.from("cashier_sessions").update({
            total_sales: nextTotals.total_sales,
            total_orders: nextTotals.total_orders,
            cash_sales: nextTotals.cash_sales,
            card_sales: nextTotals.card_sales,
            updated_at: new Date().toISOString(),
          }).eq("id", activeSession.id);
          setActiveSession(function (prev) {
            if (!prev) return null;
            return { ...prev, ...nextTotals };
          });
        } catch (_) {}
      }

      for (var i = 0; i < cart.length; i++) {
        var item = cart[i];
        var product = null;
        for (var pIdx = 0; pIdx < products.length; pIdx++) { if (products[pIdx].id === item.product_id) { product = products[pIdx]; break; } }
        if (!product) continue;
        try {
          var gramsPerUnit = item.grams_per_unit || 1;
          var totalToDeduct = gramsPerUnit * item.qty;
          var isBundle = product.is_bundle && product.bundle_linked_product_id && product.bundle_grams;
          if (isBundle) {
            var bundleGrams = product.bundle_grams * item.qty;
            var linkedId = product.bundle_linked_product_id;
            var linked = null;
            for (var li = 0; li < products.length; li++) { if (products[li].id === linkedId) { linked = products[li]; break; } }
            if (saleStoreId) { await supabase.rpc("deduct_store_inventory", { p_product_id: linkedId, p_store_id: saleStoreId, p_company_id: companyId, p_quantity: bundleGrams, p_allow_negative: allowNegative }); }
            else if (linked) { await supabase.from("products").update({ stock_quantity: allowNegative ? (linked.stock_quantity || 0) - bundleGrams : Math.max(0, (linked.stock_quantity || 0) - bundleGrams) }).eq("id", linkedId); }
            await supabase.from("inventory_movements").insert({ company_id: companyId, store_id: saleStoreId, product_id: linkedId, product_name: linked ? linked.name : "Unknown", quantity_change: -bundleGrams, movement_type: "bundle_sale", reference_id: order.id });
            await supabase.from("inventory_movements").insert({ company_id: companyId, store_id: saleStoreId, product_id: item.product_id, product_name: item.name, quantity_change: -item.qty, movement_type: "sale", reference_id: order.id });
          } else {
            if (saleStoreId) { await supabase.rpc("deduct_store_inventory", { p_product_id: item.product_id, p_store_id: saleStoreId, p_company_id: companyId, p_quantity: totalToDeduct, p_allow_negative: allowNegative }); }
            else { await supabase.from("products").update({ stock_quantity: allowNegative ? (product.stock_quantity || 0) - totalToDeduct : Math.max(0, (product.stock_quantity || 0) - totalToDeduct) }).eq("id", item.product_id); }
            await supabase.from("inventory_movements").insert({ company_id: companyId, store_id: saleStoreId, product_id: item.product_id, product_name: item.name, quantity_change: -totalToDeduct, movement_type: item.promo_id ? "promo_sale" : "sale", reference_id: order.id });
          }
        } catch (_stockErr) { console.warn("Stock update failed for", item.name, _stockErr); }
      }

      if (selectedMember && !isWalkIn) {
        try {
          var spendForStats = voucherMode ? (appliedCredit || 0) : finalTotal;
          await supabase.from("member_activities").insert({ company_id: companyId, member_id: selectedMember.id, member_name: selectedMember.first_name + " " + selectedMember.last_name, visit_date: new Date().toISOString(), spend_amount: spendForStats, visit_type: "purchase" });
          await supabase.from("members").update({ total_spend: (selectedMember.total_spend || 0) + spendForStats, visit_count: (selectedMember.visit_count || 0) + 1, loyalty_points: (selectedMember.loyalty_points || 0) + Math.floor(spendForStats) }).eq("id", selectedMember.id);
        } catch (_) {}
      }

      if (membershipFee > 0 && selectedMember && !isWalkIn) {
        try {
          var interval = storeSettings ? storeSettings.membership_fee_interval : "yearly";
          var newExpiry = new Date();
          if (interval === "yearly") newExpiry.setFullYear(newExpiry.getFullYear() + 1);
          else if (interval === "monthly") newExpiry.setMonth(newExpiry.getMonth() + 1);
          else newExpiry.setFullYear(newExpiry.getFullYear() + 100);
          await supabase.from("members").update({ expiry_date: newExpiry.toISOString().split("T")[0] }).eq("id", selectedMember.id);
        } catch (_) {}
      }

      try { await loadPosData(); } catch (_) {}

      var currentStore = (ctxStores || []).find(function (s) { return s.id === saleStoreId; });
      setReceipt({
        kind: voucherMode ? "stock_collection" : "sale",
        order: { ...order, created_at: order.created_at || new Date().toISOString(), payment_details: paymentDetails },
        items: orderItems, member: isWalkIn ? null : selectedMember,
        storeName: currentStore ? currentStore.name : "My Store",
        redemption: redemption,
        promoCode: promoCode || null,
        creditUnit: creditUnit,
        creditRate: creditRate,
      });

      clearStoredCart(storageKey);
      setCart([]); setDiscount(0); setAppliedCredit(0); setSelectedMember(null);
      toast.success(voucherMode
        ? "Stock collected — " + fmtCredit(appliedCredit) + " redeemed"
        : "Sale completed! " + formatCurrency(finalTotal) + " via " + finalPaymentMethod);

      // This cart came from a pre-order (loaded via the popup or the browse
      // dialog) and the real sale just went through — the placeholder is done
      // its job. Best-effort: the sale already happened, so this must never
      // fail the checkout.
      if (activePreorderId) {
        var fulfilledPreorderId = activePreorderId;
        setActivePreorderId(null);
        supabase.from("orders").update({ status: "cancelled" }).eq("id", fulfilledPreorderId)
          .then(function () {})
          .catch(function () {});
      }
    } catch (err) {
      // A failed credit draw-down must not leave a collection booked against
      // stock that was never paid for.
      if (createdOrderId && voucherMode) {
        try { await supabase.from("orders").delete().eq("id", createdOrderId); } catch (_) {}
      }
      toast.error("Sale failed: " + (err && err.message ? err.message : "Unknown error"));
    } finally { setIsProcessing(false); }
  };

  // Fast path only. The grid holds one code per product — whichever is in
  // products.barcode — so this can miss an item that carries a second code.
  // A miss here falls through to the RPC rather than being reported as
  // "not found". An empty SKU can never match, or a scan of any unknown code
  // would land on the first product with a blank SKU.
  var findProductByCode = useCallback(function (code, exactOnly) {
    var c = (code || "").trim();
    if (!c) return null;
    var lower = c.toLowerCase();
    var i;
    for (i = 0; i < products.length; i++) {
      if (products[i].barcode && String(products[i].barcode).trim() === c) return products[i];
    }
    for (i = 0; i < products.length; i++) {
      var sku = products[i].sku ? String(products[i].sku).trim() : "";
      if (sku && sku.toLowerCase() === lower) return products[i];
    }
    if (exactOnly) return null;
    for (i = 0; i < products.length; i++) {
      if (products[i].name && products[i].name.toLowerCase().indexOf(lower) >= 0) return products[i];
    }
    return null;
  }, [products]);

  // Products carry several codes — the printed EAN, the IQ shelf label, a
  // supplier code — and only one of them lives in products.barcode. This asks
  // the database, which knows all of them, and reports the store's stock so a
  // sold-out item reads differently from a barcode that doesn't exist. The
  // price it returns is already this store's price.
  var resolveScan = useCallback(async function (code) {
    var c = (code || "").trim();
    if (!c || !companyId) return null;
    try {
      var res = await supabase.rpc("lookup_product_by_code", {
        p_company_id: companyId,
        p_code: c,
        p_store_id: effectiveStoreId || null,
      });
      if (res.error) throw res.error;
      var rows = res.data || [];
      return rows.length > 0 ? rows[0] : null;
    } catch (_) { return null; }
  }, [companyId, effectiveStoreId]);

  // One entry point for both the camera scanner and the wedge, so the two can
  // never drift apart on what counts as a hit.
  var handleScannedCode = useCallback(async function (code, verb) {
    var c = (code || "").trim();
    if (!c) return;
    setSearchTerm("");

    // In-memory hit — sellable right now, no round trip.
    var local = findProductByCode(c, true);
    if (local) { handleProductSelect(local); toast.success(verb + ": " + local.name); return; }

    var hit = await resolveScan(c);
    if (!hit) { toast.error("No product found for: " + c); return; }

    // Known product, but not on the grid. Say which of the three reasons it is
    // rather than leaving the cashier to guess.
    if (!hit.is_active) { toast.error(hit.name + " — this product is deactivated"); return; }
    if (!(Number(hit.stock_quantity) > 0) && !allowNegative) {
      toast.error(hit.name + " — no stock at " + activeStoreName);
      return;
    }

    // Sellable but the grid is stale (stock arrived, or a code was just added).
    // Reload and pick it up on the way back, so it carries this branch's price.
    try { await loadPosData(); } catch (_) {}
    var refreshed = findProductByCode(c, true);
    if (refreshed) { handleProductSelect(refreshed); toast.success(verb + ": " + refreshed.name); }
    else { toast.error(hit.name + " — reload the products list and try again"); }
  }, [findProductByCode, resolveScan, handleProductSelect, allowNegative, activeStoreName, loadPosData]);

  var handleBarcodeDetected = useCallback(function (code) {
    setShowScanner(false);
    handleScannedCode(code, "Found");
  }, [handleScannedCode]);

  var handleWedgeScan = useCallback(function (code) {
    // Any stray characters that reached the search box would otherwise filter
    // the whole grid away after the scan resolves.
    handleScannedCode(code, "Scanned");
  }, [handleScannedCode]);

  var posLocked = requireOpenSession && !activeSession;
  // Anything that must not be usable while the till is unsafe to trade on.
  var tillBlocked = posLocked || storeMismatch;

  var wedgeEnabled = !tillBlocked && !showScanner && !showCustomerGate && !showMemberDialog && !showTabsSheet && !showCart && !tierPickerProduct && !expiryWarningMember && !receipt && !showVoucherDialog;
  useBarcodeScanner(handleWedgeScan, { enabled: wedgeEnabled });

  // Matching the selector to the session is the safe half of the resolution:
  // it only changes what the cashier is looking at, never where a sale lands.
  var handleMatchSelectorToSession = useCallback(function () {
    if (!setActiveStore || !sessionStoreId) return;
    try {
      setActiveStore(sessionStoreId);
      toast.success("Now showing " + storeNameFor(sessionStoreId, "your session's store") + " — the branch your session belongs to.");
    } catch (_) {
      toast.error("Couldn't switch the store selector — change it in the sidebar instead.");
    }
  }, [setActiveStore, sessionStoreId, storeNameFor]);

  var handleCreditBalanceUpdated = useCallback(function (newBalance) {
    setSearchedMembers(function (prev) {
      return prev.map(function (m) { return creditManagerMember && m.id === creditManagerMember.id ? { ...m, store_credit: newBalance } : m; });
    });
    setVoucherMemberResults(function (prev) {
      return prev.map(function (m) { return creditManagerMember && m.id === creditManagerMember.id ? { ...m, store_credit: newBalance } : m; });
    });
    if (selectedMember && creditManagerMember && selectedMember.id === creditManagerMember.id) {
      setSelectedMember(function (prev) { return { ...prev, store_credit: newBalance }; });
    }
  }, [creditManagerMember, selectedMember]);

  if (loading) {
    return (<div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>);
  }

  var cartPanelProps = {
    cart, onUpdateQty: updateQty,
    onUpdateLineDiscount: updateLineDiscount,
    onRemove: function (cartKeyOrIdx) {
      setCart(function (prev) {
        if (typeof cartKeyOrIdx === "number") return prev.filter(function (_, i) { return i !== cartKeyOrIdx; });
        return prev.filter(function (item) { return item._cart_key !== cartKeyOrIdx && item.id !== cartKeyOrIdx; });
      });
    },
    onClear: function () { setCart([]); setAppliedCredit(0); setActivePreorderId(null); },
    selectedMember, discount, setDiscount, paymentMethod, setPaymentMethod,
    onCheckout: function (checkoutData) { handleCheckout(checkoutData); setShowCart(false); },
    isProcessing, onAddChangeToCredit: handleAddChangeToCredit,
    onApplyCredit: handleApplyCredit, appliedCredit, storeSettings,
    promotions: autoPromotions, selectedPromo, allowNegative,
    voucherMode: voucherMode, creditUnit: creditUnit, creditRate: creditRate,
  };

  var tierProduct = tierPickerProduct;
  var tierOptions = tierProduct ? getAllTiers(tierProduct) : [];

  var renderMemberRow = function (m, onSelect) {
    var tier = getTierStyle(m.loyalty_points || 0, thresholds);
    var expired = getMembershipExpiry(m);
    return (
      <div key={m.id}
        onClick={function () { onSelect(m); }}
        className={cn(
          "flex items-center gap-3 w-full p-3 rounded-lg hover:bg-muted transition-colors text-left cursor-pointer",
          expired && "border border-red-500/30 bg-red-500/5 hover:bg-red-500/10"
        )}>
        <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0 overflow-hidden">
          {m.profile_image
            ? <img src={m.profile_image} alt="" className="w-full h-full object-cover" />
            : <span>{m.first_name ? m.first_name[0] : ""}{m.last_name ? m.last_name[0] : ""}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{m.first_name} {m.last_name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-xs text-muted-foreground truncate">{m.membership_id}</span>
            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", tier.bg, tier.color)}>
              {tier.icon} {tier.name}
            </span>
            {expired && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-0.5">
                ⚠️ Expired
              </span>
            )}
          </div>
          {m.store_credit > 0 && (
            <p className="text-xs text-green-500 font-medium mt-0.5">
              {voucherMode ? "🎟️ " + fmtCredit(m.store_credit) : "💳 " + formatCurrency(m.store_credit) + " credit"}
            </p>
          )}
        </div>
        {canManageCredit && m.store_credit > 0 && (
          <Button
            variant="ghost" size="icon" className="h-7 w-7 shrink-0"
            title="Manage this member's credit"
            onClick={function (e) { e.stopPropagation(); setCreditManagerMember(m); }}
          >
            <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        )}
        <span className={cn("w-2 h-2 rounded-full shrink-0", m.is_banned ? "bg-red-500" : m.is_active ? "bg-green-500" : "bg-yellow-500")} />
      </div>
    );
  };

  var expiryDate = expiryWarningMember ? getMembershipExpiry(expiryWarningMember) : null;
  var daysExpired = expiryDate ? getDaysExpired(expiryDate) : 0;
  var gridIsEmpty = products.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <CashierSessionBar />
      <PromotionsBanner promotions={autoPromotions} />

      {openTabs.length > 0 && !hideOpenTabs && (
        <button onClick={function () { setShowTabsSheet(true); }}
          className="flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 hover:bg-amber-500/15 transition-colors cursor-pointer w-full text-left">
          <Receipt className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{openTabs.length} Open Tab{openTabs.length !== 1 ? "s" : ""}</span>
          <span className="text-xs text-muted-foreground">· {formatCurrency(totalOutstanding)} outstanding</span>
          <span className="ml-auto text-xs text-amber-500 font-medium">View →</span>
        </button>
      )}

      {/* The session's branch wins, and while the two disagree the till is
          stopped rather than merely warned. A whole day was once rung up
          against the wrong branch under an advisory strip like this. */}
      {storeMismatch && (
        <div className="flex flex-col gap-2 px-4 py-3 bg-red-500/10 border-b-2 border-red-500/40">
          <div className="flex items-start gap-3">
            <Lock className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-red-600 dark:text-red-400">
                Till stopped — wrong store
              </p>
              <p className="text-xs text-red-600/90 dark:text-red-400/90 mt-0.5">
                Your open session belongs to <strong>{activeStoreName}</strong>, but the store selector says <strong>{selectorStoreName}</strong>.
                Every sale would come off {activeStoreName}'s stock, at {activeStoreName}'s prices. Nothing can be rung up until this is sorted.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-7">
            {setActiveStore && (
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-600"
                onClick={handleMatchSelectorToSession}>
                <Store className="w-3.5 h-3.5" />
                I'm at {activeStoreName} — show that store
              </Button>
            )}
            <span className="text-[11px] text-red-600/80 dark:text-red-400/80">
              Working at {selectorStoreName} instead? Cash up and close your day, then open a new one there.
            </span>
          </div>
        </div>
      )}

      {voucherMode && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-b border-primary/20">
          <Ticket className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs text-primary font-medium">
            Voucher till — stock is collected against member credit. Cash and card only on voucher sales.
          </span>
        </div>
      )}

      {posLocked && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-600 dark:text-amber-400 flex-1 font-medium">
            Open the day before ringing up sales. Use the Open Day button above.
          </p>
        </div>
      )}

      {selectedMember && !selectedMember.is_walkin && getMembershipExpiry(selectedMember) && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-xs text-red-600 dark:text-red-400 flex-1 font-medium">
            ⚠️ {selectedMember.first_name}'s membership expired on {formatExpiryDate(getMembershipExpiry(selectedMember))}
          </p>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex flex-wrap gap-2">
              <div className="relative w-64 shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search products..." value={searchTerm} onChange={function (e) { setSearchTerm(e.target.value); }} className="pl-10" disabled={storeMismatch} />
              </div>
              <Button variant="outline" size="icon" className="shrink-0" onClick={function () { setShowScanner(true); }} title="Scan barcode (camera)" disabled={storeMismatch}>
                <ScanLine className="w-4 h-4" />
              </Button>

              {/* ── SELL VOUCHER ── the only place money is taken ── */}
              {voucherMode && (
                <Button
                  onClick={function () {
                    setVoucherMember(selectedMember && !selectedMember.is_walkin ? selectedMember : null);
                    setVoucherMemberSearch("");
                    setVoucherAmount("");
                    setVoucherPayMethod("cash");
                    setShowVoucherDialog(true);
                  }}
                  disabled={storeMismatch}
                  className="gap-2 whitespace-nowrap shrink-0 bg-primary hover:bg-primary/90"
                  title="Sell a voucher"
                >
                  <Ticket className="w-4 h-4" /> Sell Voucher
                </Button>
              )}

              {/* Tabs stay reachable whether or not the day is open. Taking a
                  payment still requires a session — the sheet says so. */}
              {!hideOpenTabs && (
                <Button variant={openTabs.length > 0 ? "default" : "outline"} size="icon"
                  onClick={function () { setShowTabsSheet(true); }} title={"Open Tabs (" + openTabs.length + ")"}
                  className={"relative shrink-0 " + (openTabs.length > 0 ? "bg-amber-500 hover:bg-amber-600 text-white" : "")}>
                  <Receipt className="w-4 h-4" />
                  {openTabs.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{openTabs.length}</span>
                  )}
                </Button>
              )}

              {/* Pre-orders placed via the member portal Shop tab. Browsable
                  here without selecting the member first. */}
              <Button variant={pendingPreorderCount > 0 ? "default" : "outline"}
                onClick={function () { loadAllPendingPreorders(); setShowPreorderBrowser(true); }}
                disabled={tillBlocked}
                title={"Pre-Orders (" + pendingPreorderCount + ")"}
                className={"relative gap-2 whitespace-nowrap shrink-0 " + (pendingPreorderCount > 0 ? "bg-green-500 hover:bg-green-600 text-white" : "")}>
                <ShoppingBag className="w-4 h-4" /> Pre-Orders
                {pendingPreorderCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{pendingPreorderCount}</span>
                )}
              </Button>

              {/* ── TILL CASH-OUT BUTTON ── stays live on a mismatch: closing
                  the day is one of the two ways out of it. */}
              <div className="shrink-0">
                <TillCashOut
                  sessionId={activeSession?.id}
                  companyId={companyId}
                  storeId={activeSession?.store_id || effectiveStoreId}
                />
              </div>

              <Button variant={selectedMember && !selectedMember.is_walkin ? "default" : "outline"}
                onClick={function () { setShowCustomerGate(true); setMemberSearch(""); }}
                disabled={tillBlocked}
                className={cn(
                  "gap-2 whitespace-nowrap shrink-0",
                  selectedMember && !selectedMember.is_walkin && getMembershipExpiry(selectedMember) && "bg-red-500 hover:bg-red-600 border-red-500"
                )}>
                {selectedMember && !selectedMember.is_walkin ? (
                  <><QrCode className="w-4 h-4" /> {selectedMember.first_name}{getMembershipExpiry(selectedMember) ? " ⚠️" : ""}</>
                ) : (
                  <><QrCode className="w-4 h-4" /> Select Member</>
                )}
              </Button>

              {selectedMember && (
                <Button variant="ghost" size="icon" className="shrink-0" onClick={function () { setSelectedMember(null); setAppliedCredit(0); setCart([]); setActivePreorderId(null); }}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>

            {/* Credit balance strip — voucher mode only */}
            {voucherMode && selectedMember && !selectedMember.is_walkin && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                <Ticket className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-xs text-muted-foreground">{selectedMember.first_name}'s credit</span>
                <span className="ml-auto text-sm font-bold text-primary">{fmtCredit(selectedMember.store_credit || 0)}</span>
                {canManageCredit && (
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6 shrink-0 -mr-1"
                    title="Manage this member's credit"
                    onClick={function () { setCreditManagerMember(selectedMember); }}
                  >
                    <Wallet className="w-3.5 h-3.5 text-primary" />
                  </Button>
                )}
              </div>
            )}

            {(function() {
              if (storeMismatch) return null;
              var now = new Date();
              var activePromos = autoPromotions.filter(function(p) { return promoWindowActive(p, now); });
              if (!activePromos.length) return null;
              return (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {activePromos.map(function(p) {
                    var isSelected = selectedPromo && selectedPromo.id === p.id;
                    var discType = (p.promo_type || p.discount_type || "").toLowerCase();
                    var label;
                    if (discType === "weight_special") {
                      var wt = parseWeightTiers(p.weight_tiers);
                      label = wt.length ? wt.map(function (t) { return t.grams + "g R" + t.price; }).join(" / ") : "Weight Special";
                    } else if (p.discount_value) {
                      label = (discType === "fixed_discount" || discType === "fixed") ? "" + p.discount_value + " OFF" : p.discount_value + "% OFF";
                    } else {
                      label = discType === "buy_x_get_y" ? "Buy " + p.buy_quantity + " Get " + p.get_quantity : "Deal";
                    }
                    var applicable = parseApplicable(p.applicable_products);
                    var promoItemCount = applicable.length > 0
                      ? products.filter(function(pr) { return applicable.indexOf(pr.id) !== -1; }).length
                      : products.length;
                    return (
                      <button key={p.id}
                        onClick={function() { setSelectedPromo(isSelected ? null : p); setSelectedCategory(""); }}
                        className={"flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border " +
                          (isSelected ? "bg-green-500 text-white border-green-500" : "bg-green-500/10 text-green-600 border-green-500/30 hover:bg-green-500/20")}>
                        🏷️ {p.name} — {label}
                        {isSelected && <span className="opacity-80 font-normal">({promoItemCount} items)</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {!gridIsEmpty && !storeMismatch && (
              <div className="flex flex-wrap gap-2 pb-1">
                {categories.map(function (cat) {
                  return (
                    <button key={cat.key} onClick={function () { setSelectedCategory(cat.key); }}
                      className={"px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all " +
                        (selectedCategory === cat.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className={"flex-1 overflow-y-auto p-4 transition-opacity " + ((!selectedMember || posLocked) && !gridIsEmpty && !storeMismatch ? "opacity-40 pointer-events-none select-none" : "")}>
            {storeMismatch ? (
              // The grid is replaced outright rather than dimmed. A dimmed grid
              // still reads as "the shop's stock", which is exactly the wrong
              // impression when it belongs to the other branch.
              <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
                <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
                  <Lock className="w-7 h-7 text-red-500" />
                </div>
                <p className="text-base font-bold text-red-600 dark:text-red-400">Till stopped — wrong store</p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Products are hidden because your open session is at <strong>{activeStoreName}</strong> while the
                  selector says <strong>{selectorStoreName}</strong>. Showing you one branch's stock and prices while
                  charging it to the other is how a full day ends up rung against the wrong shop.
                </p>
                <div className="flex flex-col items-center gap-2 mt-1">
                  {setActiveStore && (
                    <Button size="sm" variant="outline" className="gap-2" onClick={handleMatchSelectorToSession}>
                      <Store className="w-3.5 h-3.5" />
                      I'm at {activeStoreName} — show that store
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground max-w-xs">
                    If you're actually at <strong>{selectorStoreName}</strong>, cash up and close your day first,
                    then open a new day there.
                  </p>
                </div>
              </div>
            ) : gridIsEmpty ? (
              // An empty grid used to look identical whether the store genuinely
              // had no stock or the load had failed. Say which, and give a way out.
              <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
                <PackageSearch className="w-10 h-10 text-muted-foreground/40" />
                {loadError ? (
                  <>
                    <p className="text-sm font-medium">Couldn't load the product list</p>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      The connection dropped while loading. Nothing is wrong with your stock — try again.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">No stock at {activeStoreName}</p>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      {sessionStoreId
                        ? "Products only show here once they have stock at " + activeStoreName + ", the branch your open session belongs to. Add stock under Inventory."
                        : "Products only show here once they have stock at the store selected above. Check the store selector, or add stock under Inventory."}
                    </p>
                  </>
                )}
                <Button variant="outline" size="sm" className="gap-2 mt-1" onClick={handleReload} disabled={reloading}>
                  <RefreshCw className={"w-3.5 h-3.5 " + (reloading ? "animate-spin" : "")} />
                  {reloading ? "Loading..." : "Reload products"}
                </Button>
              </div>
            ) : (
              <ProductGrid
                products={(function () {
                  if (!selectedPromo) return products;
                  var applicable = parseApplicable(selectedPromo.applicable_products);
                  if (!applicable.length) return products;
                  return products.filter(function (p) { return applicable.indexOf(p.id) !== -1; });
                })()}
                onSelect={handleProductSelect}
                searchTerm={searchTerm}
                selectedCategory={selectedCategory}
                allowNegative={allowNegative}
              />
            )}
          </div>
        </div>

        <div className="w-80 lg:w-96 hidden lg:flex">
          <CartPanel {...cartPanelProps} />
        </div>

        {cart.length > 0 && !showCart && (
          <button onClick={function () { setShowCart(true); }}
            className="fixed bottom-6 right-6 z-50 lg:hidden flex items-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-full shadow-xl font-semibold text-sm">
            <ShoppingCart className="w-5 h-5" />
            <span>{cart.length} item{cart.length !== 1 ? "s" : ""}</span>
            <span className="bg-primary-foreground/20 px-2 py-0.5 rounded-full text-xs">{cartNetSubtotal(cart).toFixed(2)}</span>
          </button>
        )}

        <Sheet open={showCart} onOpenChange={setShowCart}>
          <SheetContent side="bottom" className="h-[90vh] p-0 flex flex-col">
            <SheetHeader className="px-4 pt-4 pb-2"><SheetTitle>Cart</SheetTitle></SheetHeader>
            <div className="flex-1 min-h-0"><CartPanel {...cartPanelProps} onClear={function () { setCart([]); setAppliedCredit(0); setShowCart(false); setActivePreorderId(null); }} /></div>
          </SheetContent>
        </Sheet>

        <Sheet open={showTabsSheet} onOpenChange={setShowTabsSheet}>
          <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
            <SheetHeader className="px-4 pt-4 pb-3 border-b border-border">
              <SheetTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-500" />
                Open Tabs ({openTabs.length})
                {openTabs.length > 0 && <span className="text-sm font-normal text-muted-foreground ml-auto">{formatCurrency(totalOutstanding)} owing</span>}
              </SheetTitle>
            </SheetHeader>

            {!activeSession && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Open the day before taking a tab payment, so the money is counted on your cash-up.
                </p>
              </div>
            )}

            {storeMismatch && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20">
                <Lock className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-600 dark:text-red-400">
                  Your session is at {activeStoreName} but the selector says {selectorStoreName}. Sort that out before taking tab payments.
                </p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {tabsLoading && (<div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>)}
              {!tabsLoading && tabGroups.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Receipt className="w-10 h-10 mb-2 opacity-30" /><p className="text-sm">No open tabs</p>
                  <p className="text-xs mt-1">Tabs opened via "Unpaid / Tab" will appear here</p>
                </div>
              )}
              {!tabsLoading && tabGroups.map(function (group) {
                var isPaying = payingKey === group.key;
                var isExpanded = expandedKey === group.key;
                var isMulti = group.tabs.length > 1;
                var newest = group.tabs[0];
                var previewItems = parseItems(newest.items);
                var selectedMethod = payMethods[group.key] || "cash";
                var creditBalance = group.memberId ? tabMemberCredit[group.memberId] : undefined;
                var enteredAmount = parseFloat(payAmounts[group.key]) || 0;
                var creditInsufficient = selectedMethod === "store_credit" && group.memberId
                  && creditBalance !== undefined && enteredAmount > 0 && (enteredAmount - creditBalance > 0.004);
                return (
                  <div key={group.key} className="bg-amber-500/5 border border-amber-500/20 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{group.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {isMulti ? group.tabs.length + " tabs · oldest " + timeAgoFrom(group.oldest) : new Date(newest.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) + " · " + timeAgoFrom(newest.created_at)}
                        </p>
                        {group.paid > 0.004 && (<p className="text-[11px] text-green-600 font-medium mt-0.5">{formatCurrency(group.paid)} paid of {formatCurrency(group.billed)}</p>)}
                      </div>
                      <span className="text-base font-bold text-amber-600 shrink-0">{formatCurrency(group.balance)}</span>
                    </div>

                    {!isMulti && previewItems.length > 0 && (
                      <div className="px-3 pb-2 space-y-0.5">
                        {previewItems.map(function (item, idx) {
                          var qty = item.quantity || item.qty || 1;
                          // Older tabs have no line_total; fall back to price × qty.
                          var lineAmt = item.line_total != null ? Number(item.line_total) : item.price * qty;
                          return (<div key={idx} className="flex items-center justify-between text-xs text-muted-foreground"><span>{qty}× {item.name}</span><span>{formatCurrency(lineAmt)}</span></div>);
                        })}
                      </div>
                    )}

                    {isMulti && (
                      <div className="px-3 pb-2">
                        <button className="text-xs text-amber-600 hover:underline" onClick={function () { setExpandedKey(isExpanded ? null : group.key); }}>
                          {isExpanded ? "Hide tabs" : "Show " + group.tabs.length + " tabs"}
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                            {group.tabs.map(function (t) {
                              return (
                                <div key={t.order_id} className="flex items-center justify-between text-xs border-b border-amber-500/10 pb-1">
                                  <span className="text-muted-foreground">{new Date(t.created_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}{(parseFloat(t.amount_paid) || 0) > 0 ? " · " + formatCurrency(t.amount_paid) + " paid" : ""}</span>
                                  <span className="font-medium text-amber-600">{formatCurrency(t.balance)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="p-3 bg-muted/30 border-t border-amber-500/10 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input type="number" step="0.01" min="0" className="h-8 text-xs w-24" placeholder="Amount"
                          value={payAmounts[group.key] || ""} onChange={function (e) { setPayAmount(group.key, e.target.value); }} />
                        <button type="button" className="text-[11px] text-amber-600 hover:underline whitespace-nowrap"
                          onClick={function () { setPayAmount(group.key, String(group.balance)); }}>Full</button>
                        <Select value={selectedMethod} onValueChange={function (v) {
                          setPayMethod(group.key, v);
                          // Credit lives on the member profile, so fetch it the
                          // moment this method is picked rather than preloading
                          // every group's balance up front.
                          if (v === "store_credit" && group.memberId && tabMemberCredit[group.memberId] === undefined) {
                            fetchTabMemberCredit(group.memberId);
                          }
                        }}>
                          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="card">Card</SelectItem>
                            <SelectItem value="eft">EFT</SelectItem>
                            <SelectItem value="mobile">Mobile Pay</SelectItem>
                            {group.memberId && (
                              <SelectItem value="store_credit">
                                <span className="flex items-center gap-1.5"><Wallet className="w-3 h-3" /> Store Credit</span>
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <Button size="sm" className="h-8 text-xs gap-1.5 bg-green-600 hover:bg-green-700"
                          disabled={isPaying || !activeSession || storeMismatch || creditInsufficient}
                          onClick={function () { handleTakePayment(group); }}>
                          <CheckCircle className="w-3.5 h-3.5" />{isPaying ? "..." : "Take"}
                        </Button>
                      </div>
                      {selectedMethod === "store_credit" && group.memberId && (
                        <p className={cn("text-[11px]", creditInsufficient ? "text-red-500 font-medium" : "text-muted-foreground")}>
                          {creditBalance === undefined
                            ? "Loading credit balance…"
                            : creditInsufficient
                              ? "Only " + formatCurrency(creditBalance) + " credit available — short by " + formatCurrency(enteredAmount - creditBalance)
                              : formatCurrency(creditBalance) + " credit available"}
                        </p>
                      )}
                      {isMulti && <p className="text-[10px] text-muted-foreground">Applied to the oldest tab first</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>

        {/* ── SELL VOUCHER DIALOG ── */}
        <Dialog open={showVoucherDialog} onOpenChange={function (open) { if (!open) setShowVoucherDialog(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-primary" /> Sell Voucher
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {!activeSession && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Open the day first so this money lands on your cash-up.
                  </p>
                </div>
              )}

              {storeMismatch && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                  <Lock className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Your session is at {activeStoreName} but the selector says {selectorStoreName}. Sort that out first.
                  </p>
                </div>
              )}

              {/* Member */}
              {voucherMember ? (
                <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                    {voucherMember.first_name ? voucherMember.first_name[0] : ""}{voucherMember.last_name ? voucherMember.last_name[0] : ""}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{voucherMember.first_name} {voucherMember.last_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {voucherMember.membership_id} · {fmtCredit(voucherMember.store_credit || 0)} held
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={function () { setVoucherMember(null); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input placeholder="Search member by name, ID or phone..." value={voucherMemberSearch}
                    onChange={function (e) { setVoucherMemberSearch(e.target.value); }} autoFocus />
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {voucherMemberResults.map(function (m) {
                      return renderMemberRow(m, function (mem) { setVoucherMember(mem); });
                    })}
                    {!voucherMemberResults.length && (
                      <p className="text-sm text-muted-foreground text-center py-4">No members found</p>
                    )}
                  </div>
                </div>
              )}

              {/* Amount */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Amount paid</label>
                <Input type="number" min={0} step="0.01" value={voucherAmount}
                  onChange={function (e) { setVoucherAmount(e.target.value); }}
                  className="h-11 text-base font-semibold" placeholder="0.00" />
                <div className="flex gap-1.5">
                  {[100, 200, 500, 1000].map(function (v) {
                    return (
                      <Button key={v} type="button" variant="outline" size="sm" className="flex-1 h-8 text-xs"
                        onClick={function () { setVoucherAmount(String(v)); }}>
                        {v}
                      </Button>
                    );
                  })}
                </div>
                {parseFloat(voucherAmount) > 0 && (
                  <p className="text-xs text-primary font-medium pt-0.5">
                    Gives {fmtCredit(parseFloat(voucherAmount))}
                  </p>
                )}
              </div>

              {/* Payment method */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Paid by</label>
                <Select value={voucherPayMethod} onValueChange={setVoucherPayMethod}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash"><span className="flex items-center gap-2"><Banknote className="w-4 h-4" /> Cash</span></SelectItem>
                    <SelectItem value="card"><span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Card</span></SelectItem>
                    <SelectItem value="eft"><span className="flex items-center gap-2"><Receipt className="w-4 h-4" /> EFT</span></SelectItem>
                    <SelectItem value="mobile"><span className="flex items-center gap-2"><Banknote className="w-4 h-4" /> Mobile Pay</span></SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                No stock is issued with this transaction. The member collects against their credit later.
              </p>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={function () { setShowVoucherDialog(false); }}>Cancel</Button>
                <Button className="flex-1 font-bold"
                  disabled={issuingVoucher || !voucherMember || !(parseFloat(voucherAmount) > 0) || !activeSession || storeMismatch}
                  onClick={handleSellVoucher}>
                  {issuingVoucher ? "Issuing..." : "Issue Voucher"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!tierPickerProduct} onOpenChange={function (open) { if (!open) setTierPickerProduct(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-green-600" />
                {tierProduct ? tierProduct.name : "Select Amount"}
              </DialogTitle>
            </DialogHeader>
            {tierProduct && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{tierProduct.stock_quantity}g in stock · Choose quantity:</p>
                <button onClick={handleBaseSelect} disabled={!allowNegative && tierProduct.stock_quantity < 1}
                  className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-green-600">1g</span>
                    <span className="text-sm text-muted-foreground">Per gram</span>
                  </div>
                  <span className="font-semibold">{voucherMode ? fmtCredit(tierProduct.price) : formatCurrency(tierProduct.price)}</span>
                </button>
                {tierOptions.map(function (tier, idx) {
                  var canAfford = allowNegative || tierProduct.stock_quantity >= tier.grams;
                  var perGram = tier.grams > 0 ? tier.price / tier.grams : 0;
                  var saving = tier.grams > 0 ? (tierProduct.price * tier.grams) - tier.price : 0;
                  var isPromo = !!tier._promo_id;
                  return (
                    <button key={idx} onClick={function () { handleTierSelect(tier); }} disabled={!canAfford}
                      className={"w-full flex items-center justify-between p-3 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
                        (isPromo ? "border-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10" : "hover:bg-green-50 hover:border-green-300")}>
                      <div className="flex items-center gap-3">
                        <span className={"text-lg font-bold " + (isPromo ? "text-emerald-600" : "text-green-600")}>{tier.grams}g</span>
                        <div className="text-left">
                          <span className="text-sm font-medium flex items-center gap-1.5">
                            {tier.label || tier.grams + "g Special"}
                            {isPromo && (<span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white"><Tag className="w-2.5 h-2.5" />PROMO</span>)}
                          </span>
                          {isPromo && <span className="block text-[10px] text-emerald-600/80">{tier._promo_name}</span>}
                          {saving > 0 && <span className="block text-xs text-green-600">Save {voucherMode ? fmtCredit(saving) : formatCurrency(saving)}</span>}
                          <span className="block text-[10px] text-muted-foreground">Deducts {tier.grams}g from stock</span>
                        </div>
                      </div>
                      <span className="font-semibold">{voucherMode ? fmtCredit(tier.price) : formatCurrency(tier.price)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={!!expiryWarningMember} onOpenChange={function (open) { if (!open) handleCancelExpired(); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-500">
                <AlertTriangle className="w-5 h-5" /> Membership Expired
              </DialogTitle>
            </DialogHeader>
            {expiryWarningMember && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-base shrink-0 overflow-hidden">
                    {expiryWarningMember.profile_image
                      ? <img src={expiryWarningMember.profile_image} alt="" className="w-full h-full object-cover" />
                      : <span>{expiryWarningMember.first_name ? expiryWarningMember.first_name[0] : ""}{expiryWarningMember.last_name ? expiryWarningMember.last_name[0] : ""}</span>}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{expiryWarningMember.first_name} {expiryWarningMember.last_name}</p>
                    <p className="text-xs text-muted-foreground">{expiryWarningMember.membership_id}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-1 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Membership expired</p>
                  <p className="text-lg font-bold text-red-500">{expiryDate ? formatExpiryDate(expiryDate) : ""}</p>
                  <p className="text-xs text-red-400 font-medium">{daysExpired === 1 ? "1 day ago" : daysExpired + " days ago"}</p>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  This member's membership has lapsed. You can renew it by collecting the membership fee at checkout, or proceed without renewing.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-500" onClick={handleCancelExpired}>Cancel</Button>
                  <Button className="flex-1 bg-red-500 hover:bg-red-600 text-white" onClick={handleProceedExpired}>Proceed Anyway</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={showCustomerGate} onOpenChange={function (open) { if (!open) { setShowCustomerGate(false); setPendingProduct(null); setMemberSearch(""); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-primary" /> Who is this sale for?
              </DialogTitle>
            </DialogHeader>
            <Input placeholder="Search by name, ID, email, or phone..." value={memberSearch} onChange={function (e) { setMemberSearch(e.target.value); }} autoFocus />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {memberSearching && (<div className="flex items-center justify-center py-6"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>)}
              {!memberSearching && searchedMembers.map(function (m) { return renderMemberRow(m, handleSelectMember); })}
              {!memberSearching && !searchedMembers.length && (<p className="text-sm text-muted-foreground text-center py-6">No members found</p>)}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showMemberDialog} onOpenChange={setShowMemberDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Select Member</DialogTitle></DialogHeader>
            <Input placeholder="Search by name, ID, email, or phone..." value={memberSearch} onChange={function (e) { setMemberSearch(e.target.value); }} autoFocus />
            <div className="max-h-80 overflow-y-auto space-y-1">
              {memberSearching && (<div className="flex items-center justify-center py-6"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>)}
              {!memberSearching && searchedMembers.map(function (m) { return renderMemberRow(m, function (mem) { handleSelectMember(mem); }); })}
              {!memberSearching && !searchedMembers.length && (<p className="text-sm text-muted-foreground text-center py-6">No members found</p>)}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {showScanner && (<BarcodeScanner onDetected={handleBarcodeDetected} onClose={function () { setShowScanner(false); }} />)}
      <ReceiptModal receipt={receipt} onClose={function () { setReceipt(null); }} />

      {/* Pop up right after selecting a member who has pre-orders waiting */}
      <Dialog open={showPreorderPrompt} onOpenChange={setShowPreorderPrompt}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-green-500" />
              Pending Pre-Order{memberPreorders.length !== 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            {selectedMember ? selectedMember.first_name : "This member"} {memberPreorders.length !== 1 ? "have" : "has"} {memberPreorders.length} pre-order{memberPreorders.length !== 1 ? "s" : ""} waiting for pickup.
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {memberPreorders.map(function (o) {
              var items = Array.isArray(o.items) ? o.items : [];
              return (
                <div key={o.id} className="rounded-lg border border-border p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-muted-foreground">#{o.order_number || o.id.slice(0, 8).toUpperCase()}</span>
                    <span className="text-sm font-bold">{formatCurrency(o.total_amount)}</span>
                  </div>
                  {items.map(function (it, idx) {
                    return <div key={idx} className="text-xs text-muted-foreground">{it.quantity} × {it.name}</div>;
                  })}
                  {o.notes && <p className="text-xs italic text-muted-foreground">"{o.notes}"</p>}
                  <Button size="sm" className="w-full mt-1" onClick={function () { loadPreorderIntoCart(o); }}>
                    Load into Cart
                  </Button>
                </div>
              );
            })}
          </div>
          <Button variant="outline" className="w-full" onClick={function () { setShowPreorderPrompt(false); }}>
            Not now
          </Button>
        </DialogContent>
      </Dialog>

      {/* Browse every pending pre-order across the store, without needing to
          select the member first — the button in the toolbar. */}
      <Dialog open={showPreorderBrowser} onOpenChange={setShowPreorderBrowser}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-green-500" />
              Pending Pre-Orders
            </DialogTitle>
          </DialogHeader>
          {loadingPreorders ? (
            <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
          ) : allPendingPreorders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No pending pre-orders right now</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {allPendingPreorders.map(function (o) {
                var items = Array.isArray(o.items) ? o.items : [];
                return (
                  <div key={o.id} className="rounded-lg border border-border p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{o.member_name || "Member"}</span>
                      <span className="text-sm font-bold">{formatCurrency(o.total_amount)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {items.map(function (it) { return it.quantity + "× " + it.name; }).join(", ")}
                    </div>
                    {o.notes && <p className="text-xs italic text-muted-foreground">"{o.notes}"</p>}
                    <Button size="sm" className="w-full mt-1" onClick={function () { loadPreorderFromBrowser(o); }}>
                      Load into Cart
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <MemberCreditManager
        open={!!creditManagerMember}
        onClose={function () { setCreditManagerMember(null); }}
        member={creditManagerMember}
        companyId={companyId}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        onBalanceUpdated={handleCreditBalanceUpdated}
      />
    </div>
  );
}
