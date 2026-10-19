import { useState, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

function getMember() {
  try {
    var raw = sessionStorage.getItem("portal_member");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

var TIER_META = {
  bronze:   { emoji: "🥉", color: "#f59e0b", label: "BRONZE" },
  silver:   { emoji: "🥈", color: "#94a3b8", label: "SILVER" },
  gold:     { emoji: "🥇", color: "#fbbf24", label: "GOLD" },
  platinum: { emoji: "💎", color: "#a78bfa", label: "PLATINUM" },
};

// The server decides the tier. The thresholds are only a fallback for the first
// paint, before the refresh lands.
function getTierInfo(member, thresholds) {
  if (member && member.tier && TIER_META[member.tier]) return TIER_META[member.tier];
  var points = (member && member.loyalty_points) || 0;
  var s = thresholds.silver   ?? 500;
  var g = thresholds.gold     ?? 1500;
  var p = thresholds.platinum ?? 5000;
  if (points >= p) return TIER_META.platinum;
  if (points >= g) return TIER_META.gold;
  if (points >= s) return TIER_META.silver;
  return TIER_META.bronze;
}

function formatDate(d) {
  if (!d) return "N/A";
  var date = new Date(d);
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

var ORDER_STATUS_META = {
  pending:   { bg: "rgba(245,158,11,0.1)", color: "#f59e0b", label: "⏳ Pending" },
  unpaid:    { bg: "rgba(245,158,11,0.1)", color: "#f59e0b", label: "⏳ Awaiting Payment" },
  completed: { bg: "rgba(34,197,94,0.1)",  color: "#22c55e", label: "✅ Completed" },
  refunded:  { bg: "rgba(239,68,68,0.1)",  color: "#ef4444", label: "↩ Refunded" },
  cancelled: { bg: "rgba(239,68,68,0.1)",  color: "#ef4444", label: "❌ Cancelled" },
};

// FICA and Section 21 both report status strings with different casing
// conventions depending on where they were written from (portal vs staff
// admin), so everything routes through one normaliser before it hits a label.
var FICA_STATUS_META = {
  verified: { bg: "rgba(34,197,94,0.12)",  color: "#22c55e", label: "✅ Verified" },
  pending:  { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", label: "⏳ Pending Review" },
  rejected: { bg: "rgba(239,68,68,0.12)",  color: "#ef4444", label: "⚠️ Action Needed" },
  none:     { bg: "rgba(148,163,184,0.12)", color: "#94a3b8", label: "Not Submitted" },
};

var SECTION21_STATUS_META = {
  submitted: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", label: "⏳ Under Review" },
  approved:  { bg: "rgba(34,197,94,0.12)",  color: "#22c55e", label: "✅ Approved" },
  rejected:  { bg: "rgba(239,68,68,0.12)",  color: "#ef4444", label: "⚠️ Action Needed" },
  none:      { bg: "rgba(148,163,184,0.12)", color: "#94a3b8", label: "Not Started" },
};

function ficaMeta(status, hasDocs) {
  var s = (status || "").toLowerCase();
  if (!hasDocs) return FICA_STATUS_META.none;
  return FICA_STATUS_META[s] || FICA_STATUS_META.pending;
}

function section21Meta(app) {
  if (!app) return SECTION21_STATUS_META.none;
  var s = (app.application_status || "").toLowerCase();
  return SECTION21_STATUS_META[s] || SECTION21_STATUS_META.submitted;
}

// Loads an image for canvas drawing without letting a broken/CORS-blocked URL
// stop the whole card download — a failed load resolves to null rather than
// rejecting, so downloadCard can carry on without that one image.
function loadImageSafe(url) {
  return new Promise(function (resolve) {
    if (!url) { resolve(null); return; }
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () { resolve(img); };
    img.onerror = function () { resolve(null); };
    img.src = url;
  });
}

export default function MemberPortalDashboard() {
  var navigate = useNavigate();
  var params = useParams();
  var companyId = params.companyId;
  var [member, setMember] = useState(getMember);
  var [companyName, setCompanyName] = useState("");
  var [companyLogo, setCompanyLogo] = useState("");
  var [tab, setTab] = useState("profile");
  var [flipped, setFlipped] = useState(false);
  var [products, setProducts] = useState([]);
  var [loadingProducts, setLoadingProducts] = useState(false);
  var [uploading, setUploading] = useState(false);
  var [searchTerm, setSearchTerm] = useState("");
  var [selectedCategory, setSelectedCategory] = useState("");
  var [notifications, setNotifications] = useState([]);
  var [loadingNotifs, setLoadingNotifs] = useState(false);
  var [unreadCount, setUnreadCount] = useState(0);
  var [thresholds, setThresholds] = useState({ bronze: 0, silver: 500, gold: 1500, platinum: 5000 });
  var [stores, setStores] = useState([]);
  var [selectedStore, setSelectedStore] = useState("");
  var [tabs, setTabs] = useState(null);
  var [cart, setCart] = useState([]);
  var [cartOpen, setCartOpen] = useState(false);
  var [orderNotes, setOrderNotes] = useState("");
  var [placingOrder, setPlacingOrder] = useState(false);
  var [myOrders, setMyOrders] = useState([]);
  var [loadingOrders, setLoadingOrders] = useState(false);

  // Compliance — FICA (ID + proof of address) and Section 21 (medical/
  // unregistered-medicine application) document status and uploads.
  var [compliance, setCompliance] = useState(null);
  var [loadingCompliance, setLoadingCompliance] = useState(false);
  var [uploadingFicaId, setUploadingFicaId] = useState(false);
  var [uploadingFicaPoa, setUploadingFicaPoa] = useState(false);
  var [uploadingSection21, setUploadingSection21] = useState(false);

  var fileRef = useRef(null);
  var ficaIdRef = useRef(null);
  var ficaPoaRef = useRef(null);
  var section21Ref = useRef(null);

  useEffect(function () {
    if (!member || !companyId) {
      navigate("/member-portal/" + (companyId || ""));
      return;
    }
    if (member.company_id !== companyId) {
      sessionStorage.removeItem("portal_member");
      navigate("/member-portal/" + companyId);
      return;
    }

    // Refresh member data. The RPC returns only what this page renders, with the
    // ID number already masked — the raw value never reaches the browser.
    supabase
      .rpc("portal_get_member", { p_member_id: member.id, p_company_id: companyId })
      .then(function (res) {
        if (res.data) {
          setMember(res.data);
          sessionStorage.setItem("portal_member", JSON.stringify(res.data));
        } else {
          sessionStorage.removeItem("portal_member");
          navigate("/member-portal/" + companyId);
        }
      });

    supabase
      .rpc("portal_get_company", { p_company_id: companyId })
      .then(function (res) {
        if (res.data) {
          setCompanyName(res.data.trading_name || res.data.company_name || "");
          setCompanyLogo(res.data.logo_url || "");
          setThresholds({
            bronze:   res.data.loyalty_bronze   ?? 0,
            silver:   res.data.loyalty_silver   ?? 500,
            gold:     res.data.loyalty_gold     ?? 1500,
            platinum: res.data.loyalty_platinum ?? 5000,
          });
        }
      });

    supabase
      .rpc("portal_get_stores", { p_company_id: companyId })
      .then(function (res) {
        if (res.data) setStores(res.data);
      });

    loadTabs();
  }, []);

  var loadTabs = function () {
    var m = getMember();
    if (!m) return;
    supabase
      .rpc("get_member_tab_balance", { p_member_id: m.id })
      .then(function (res) {
        if (res.data) setTabs(res.data);
      });
  };

  useEffect(function () {
    if (tab === "shop" && member) loadProducts();
    if (tab === "inbox") loadNotifications();
    if (tab === "orders") loadMyOrders();
    if (tab === "compliance" && member) loadCompliance();
  }, [tab]);

  // Reload shop stock when the selected store changes
  useEffect(function () {
    if (tab === "shop" && member) loadProducts();
  }, [selectedStore]);

  var loadNotifications = async function () {
    setLoadingNotifs(true);
    try {
      // Tier is resolved server-side, so the audience filter can't be spoofed.
      var { data, error } = await supabase.rpc("portal_get_notifications", {
        p_member_id: member.id,
        p_company_id: companyId,
      });
      if (error) throw error;
      var notifs = data || [];
      setNotifications(notifs);
      var readKey = "portal_read_" + member.id;
      var readIds = JSON.parse(sessionStorage.getItem(readKey) || "[]");
      setUnreadCount(notifs.filter(function (n) { return !readIds.includes(n.id); }).length);
    } catch (e) {
      setNotifications([]);
    } finally {
      setLoadingNotifs(false);
    }
  };

  useEffect(function () {
    if (!member || !companyId) return;
    supabase
      .rpc("portal_get_notifications", { p_member_id: member.id, p_company_id: companyId })
      .then(function (res) {
        if (res.data) {
          var readKey = "portal_read_" + member.id;
          var readIds = JSON.parse(sessionStorage.getItem(readKey) || "[]");
          setUnreadCount(res.data.filter(function (n) { return !readIds.includes(n.id); }).length);
        }
      });
  }, [member && member.id]);

  var markAllRead = function (notifs) {
    var readKey = "portal_read_" + member.id;
    sessionStorage.setItem(readKey, JSON.stringify(notifs.map(function (n) { return n.id; })));
    setUnreadCount(0);
  };

  var loadProducts = async function () {
    setLoadingProducts(true);
    try {
      // Stock — and, when a store is selected, that store's own price —
      // is resolved server-side against store_inventory.
      var res = await supabase.rpc("portal_get_menu", {
        p_company_id: companyId,
        p_store_id: selectedStore || null,
      });
      setProducts(res.data || []);
    } catch (e) {
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  var loadMyOrders = async function () {
    setLoadingOrders(true);
    try {
      var res = await supabase.rpc("portal_get_my_orders", { p_member_id: member.id, p_company_id: companyId });
      setMyOrders(res.data || []);
    } catch (e) {
      setMyOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  };

  var loadCompliance = async function () {
    setLoadingCompliance(true);
    try {
      var res = await supabase.rpc("portal_get_compliance", { p_member_id: member.id, p_company_id: companyId });
      setCompliance(res.data || null);
    } catch (e) {
      setCompliance(null);
    } finally {
      setLoadingCompliance(false);
    }
  };

  // Shared upload path for both compliance documents. Mirrors handlePhotoUpload
  // below — same bucket, same size cap — just a different folder per document
  // type so staff can tell FICA docs from Section 21 docs in storage.
  var uploadComplianceFile = async function (file, folder) {
    if (file.size > 8 * 1024 * 1024) { toast.error("File must be under 8MB"); return null; }
    var ext = file.name.split(".").pop();
    var path = folder + "/" + member.id + "-" + Date.now() + "." + ext;
    var { error: uploadError } = await supabase.storage.from("uploads").upload(path, file, { upsert: true });
    if (uploadError) throw uploadError;
    var { data: urlData } = supabase.storage.from("uploads").getPublicUrl(path);
    return urlData.publicUrl;
  };

  var handleFicaIdFile = async function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadingFicaId(true);
    try {
      var url = await uploadComplianceFile(file, "member-fica");
      if (!url) return;
      var res = await supabase.rpc("portal_submit_fica_documents", {
        p_member_id: member.id, p_company_id: companyId,
        p_id_document_url: url, p_proof_of_address_url: null,
      });
      if (res.error) throw res.error;
      setCompliance(function (prev) {
        var next = prev ? { ...prev } : { fica: {}, section21: null };
        next.fica = { ...next.fica, id_document_url: url, status: "pending", notes: null };
        return next;
      });
      toast.success("ID document uploaded — pending review");
    } catch (err) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setUploadingFicaId(false);
      e.target.value = "";
    }
  };

  var handleFicaPoaFile = async function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadingFicaPoa(true);
    try {
      var url = await uploadComplianceFile(file, "member-fica");
      if (!url) return;
      var res = await supabase.rpc("portal_submit_fica_documents", {
        p_member_id: member.id, p_company_id: companyId,
        p_id_document_url: null, p_proof_of_address_url: url,
      });
      if (res.error) throw res.error;
      setCompliance(function (prev) {
        var next = prev ? { ...prev } : { fica: {}, section21: null };
        next.fica = { ...next.fica, proof_of_address_url: url, status: "pending", notes: null };
        return next;
      });
      toast.success("Proof of address uploaded — pending review");
    } catch (err) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setUploadingFicaPoa(false);
      e.target.value = "";
    }
  };

  var handleSection21File = async function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadingSection21(true);
    try {
      var url = await uploadComplianceFile(file, "member-section21");
      if (!url) return;
      var res = await supabase.rpc("portal_submit_section21_document", {
        p_member_id: member.id, p_company_id: companyId, p_document_url: url,
      });
      if (res.error) throw res.error;
      setCompliance(function (prev) {
        var next = prev ? { ...prev } : { fica: {}, section21: null };
        next.section21 = {
          ...(next.section21 || {}),
          id_upload_url: url,
          application_status: "Submitted",
          submission_timestamp: new Date().toISOString(),
        };
        return next;
      });
      toast.success("Document submitted — your Section 21 application is under review");
    } catch (err) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setUploadingSection21(false);
      e.target.value = "";
    }
  };

  // Prices are store-specific, so switching pickup stores mid-shop invalidates
  // whatever is already in the cart.
  var changeStore = function (newStoreId) {
    if (cart.length > 0 && newStoreId !== selectedStore) {
      setCart([]);
      toast("Pickup store changed — your cart was cleared");
    }
    setSelectedStore(newStoreId);
  };

  var addToCart = function (product) {
    setCart(function (prev) {
      var maxQty = product.stock_quantity || 0;
      var existing = prev.find(function (c) { return c.product_id === product.id; });
      if (existing) {
        if (existing.qty >= maxQty) { toast.error("Only " + maxQty + " in stock"); return prev; }
        return prev.map(function (c) {
          return c.product_id === product.id ? Object.assign({}, c, { qty: c.qty + 1 }) : c;
        });
      }
      if (maxQty < 1) { toast.error("Out of stock"); return prev; }
      return prev.concat([{
        product_id: product.id, name: product.name, price: product.price,
        image_url: product.image_url, category: product.category, product_type: product.product_type,
        qty: 1, maxQty: maxQty,
      }]);
    });
  };

  var updateCartQty = function (productId, delta) {
    setCart(function (prev) {
      return prev
        .map(function (c) {
          if (c.product_id !== productId) return c;
          var next = c.qty + delta;
          if (next > c.maxQty) { toast.error("Only " + c.maxQty + " in stock"); return c; }
          return Object.assign({}, c, { qty: next });
        })
        .filter(function (c) { return c.qty > 0; });
    });
  };

  var submitPreorder = async function () {
    if (cart.length === 0) return;
    if (stores.length > 1 && !selectedStore) {
      toast.error("Please choose a pickup store first");
      return;
    }
    setPlacingOrder(true);
    try {
      var payload = cart.map(function (c) { return { product_id: c.product_id, quantity: c.qty }; });
      var res = await supabase.rpc("portal_create_preorder", {
        p_member_id: member.id,
        p_company_id: companyId,
        p_store_id: selectedStore || null,
        p_items: payload,
        p_notes: orderNotes || null,
      });
      if (res.error) throw res.error;
      toast.success("Pre-order placed! Show your Orders tab at the counter.");
      setCart([]);
      setOrderNotes("");
      setCartOpen(false);
      loadMyOrders();
      setTab("orders");
    } catch (err) {
      toast.error((err && err.message) || "Couldn't place your order — please try again");
    } finally {
      setPlacingOrder(false);
    }
  };

  var handlePhotoUpload = async function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setUploading(true);
    try {
      var ext = file.name.split(".").pop();
      var path = "member-photos/" + member.id + "." + ext;
      var { error: uploadError } = await supabase.storage.from("uploads").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      var { data: urlData } = supabase.storage.from("uploads").getPublicUrl(path);
      var publicUrl = urlData.publicUrl + "?t=" + Date.now();
      var { error: updateError } = await supabase.rpc("portal_update_member_photo", {
        p_member_id: member.id,
        p_company_id: companyId,
        p_url: publicUrl,
      });
      if (updateError) throw updateError;
      var updated = Object.assign({}, member, { profile_image: publicUrl });
      setMember(updated);
      sessionStorage.setItem("portal_member", JSON.stringify(updated));
      toast.success("Photo updated!");
    } catch (err) {
      toast.error("Failed to upload: " + (err.message || "Unknown error"));
    } finally {
      setUploading(false);
    }
  };

  var handleLogout = function () {
    sessionStorage.removeItem("portal_member");
    sessionStorage.removeItem("portal_company_id");
    navigate("/member-portal/" + companyId);
  };

  // ── Card download ──────────────────────────────────────────────────────
  // Redrawn to match the front-of-card layout: brand mark, tier-ringed photo,
  // status/points strip and the bottom tagline. Avatar and shop-logo images
  // load asynchronously first so the export never ships a half-drawn card.
  var downloadCard = async function () {
    var tierInfo = getTierInfo(member, thresholds);
    var canvas = document.createElement("canvas");
    canvas.width = 1000; canvas.height = 580;
    var ctx = canvas.getContext("2d");

    var avatarImg = member.profile_image ? await loadImageSafe(member.profile_image) : null;
    var logoImg = companyLogo ? await loadImageSafe(companyLogo) : null;

    function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

    // Background + gradient border
    var bg = ctx.createLinearGradient(0, 0, 1000, 580);
    bg.addColorStop(0, "#0a0e0a"); bg.addColorStop(0.55, "#0f2416"); bg.addColorStop(1, "#0a0e0a");
    ctx.fillStyle = bg;
    rr(0, 0, 1000, 580, 32); ctx.fill();

    var borderGrad = ctx.createLinearGradient(0, 0, 1000, 580);
    borderGrad.addColorStop(0, "#22c55e"); borderGrad.addColorStop(0.5, "#fbbf24"); borderGrad.addColorStop(1, "#ef4444");
    ctx.strokeStyle = borderGrad; ctx.lineWidth = 4;
    rr(2, 2, 996, 576, 30); ctx.stroke();

    // Faint watermark leaf, bottom-right
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.font = "340px serif";
    ctx.fillStyle = "#fbbf24";
    ctx.fillText("🌿", 660, 560);
    ctx.restore();

    // Brand mark, top-left
    ctx.font = "32px serif"; ctx.fillStyle = "#22c55e";
    ctx.fillText("🌿", 40, 70);
    ctx.font = "bold 34px Arial"; ctx.fillStyle = "#ffffff";
    ctx.fillText("Canna Life Co", 82, 68);
    var wordmarkWidth = ctx.measureText("Canna Life Co").width;
    ctx.fillStyle = "#22c55e";
    rr(82 + wordmarkWidth + 12, 40, 66, 30, 8); ctx.fill();
    ctx.fillStyle = "#0a0e0a"; ctx.font = "bold 15px Arial";
    ctx.fillText("POS", 82 + wordmarkWidth + 28, 61);
    ctx.fillStyle = "#8fae9a"; ctx.font = "bold 12px Arial";
    ctx.fillText("C A N N A B I S   C L U B   M E M B E R S H I P", 40, 92);

    // Tagline, top-right
    ctx.textAlign = "right"; ctx.font = "bold 11px Arial"; ctx.fillStyle = "#d4af37";
    ctx.fillText("GOOD PEOPLE", 960, 46);
    ctx.fillText("HIGHER REWARDS", 960, 62);
    ctx.textAlign = "left";
    var barColors = ["#22c55e", "#fbbf24", "#ef4444"];
    var barX = 860;
    for (var bi = 0; bi < 3; bi++) {
      ctx.fillStyle = barColors[bi];
      ctx.fillRect(barX, 70, 32, 3);
      barX += 34;
    }

    // Shop logo box, right side
    var logoBoxX = 860, logoBoxY = 96, logoBoxW = 100, logoBoxH = 100;
    ctx.strokeStyle = "rgba(212,175,55,0.5)"; ctx.lineWidth = 2;
    rr(logoBoxX, logoBoxY, logoBoxW, logoBoxH, 14); ctx.stroke();
    if (logoImg) {
      ctx.save();
      rr(logoBoxX + 8, logoBoxY + 8, logoBoxW - 16, logoBoxH - 16, 8); ctx.clip();
      ctx.drawImage(logoImg, logoBoxX + 8, logoBoxY + 8, logoBoxW - 16, logoBoxH - 16);
      ctx.restore();
    } else {
      ctx.fillStyle = "#6b7280"; ctx.font = "34px Arial"; ctx.textAlign = "center";
      ctx.fillText("🏪", logoBoxX + logoBoxW / 2, logoBoxY + 48);
      ctx.font = "10px Arial";
      ctx.fillText("Shop Logo", logoBoxX + logoBoxW / 2, logoBoxY + 74);
      ctx.textAlign = "left";
    }

    // Avatar with tier-colour ring
    var cx = 100, cy = 220, r = 56;
    var ringGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    ringGrad.addColorStop(0, "#22c55e"); ringGrad.addColorStop(0.5, "#fbbf24"); ringGrad.addColorStop(1, "#ef4444");
    ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.fillStyle = ringGrad; ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (avatarImg) {
      ctx.drawImage(avatarImg, cx - r, cy - r, r * 2, r * 2);
    } else {
      var avGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      avGrad.addColorStop(0, "#22c55e"); avGrad.addColorStop(1, "#16a34a");
      ctx.fillStyle = avGrad; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = "#fff"; ctx.font = "bold 36px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((member.first_name || "?")[0] + (member.last_name || "?")[0], cx, cy + 2);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }
    ctx.restore();

    // Name / tier / membership id
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 34px Arial";
    ctx.fillText((member.first_name + " " + member.last_name), 176, 208);
    ctx.font = "bold 20px Arial"; ctx.fillStyle = tierInfo.color;
    ctx.fillText(tierInfo.emoji + "  " + tierInfo.label + " MEMBER", 176, 240);
    ctx.font = "16px monospace"; ctx.fillStyle = "#8fae9a";
    ctx.fillText(member.membership_id || "", 176, 264);

    // Status / points strip
    var stripY = 320, stripH = 90;
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
    rr(40, stripY, 560, stripH, 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(320, stripY + 14); ctx.lineTo(320, stripY + stripH - 14);
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.stroke();

    ctx.fillStyle = "#6b7280"; ctx.font = "13px Arial";
    ctx.fillText("STATUS", 66, stripY + 34);
    ctx.fillStyle = member.is_active ? "#22c55e" : "#ef4444"; ctx.font = "bold 24px Arial";
    ctx.fillText(member.is_active ? "● ACTIVE" : "● INACTIVE", 66, stripY + 66);

    ctx.fillStyle = "#6b7280"; ctx.font = "13px Arial";
    ctx.fillText("POINTS", 346, stripY + 34);
    ctx.fillStyle = "#fbbf24"; ctx.font = "bold 24px Arial";
    ctx.fillText("★ " + (member.loyalty_points || 0).toLocaleString(), 346, stripY + 66);

    // Bottom-left tagline
    ctx.fillStyle = "#d4af37"; ctx.font = "bold 13px Arial";
    ctx.fillText("MORE PLANTS", 40, 490);
    ctx.fillText("A BRIGHTER TOMORROW", 40, 510);

    // Footer strip
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(0, 536, 1000, 44);
    ctx.fillStyle = "#6b7280"; ctx.font = "13px Arial";
    ctx.fillText("Powered by Canna Life Co POS  •  pos.cannalife.co.za", 40, 562);

    var link = document.createElement("a");
    link.download = "membership-card-" + (member.membership_id || "card") + ".png";
    link.href = canvas.toDataURL("image/png"); link.click();
  };

  if (!member) return null;

  var tierInfo = getTierInfo(member, thresholds);
  var tabBalance = tabs ? (parseFloat(tabs.balance) || 0) : 0;
  var openTabCount = tabs ? (parseInt(tabs.open_tabs, 10) || 0) : 0;

  var isExpiringSoon = false;
  if (member.expiry_date) {
    var expiryDate = new Date(member.expiry_date);
    var daysLeft = (expiryDate.getTime() - Date.now()) / 86400000;
    isExpiringSoon = daysLeft >= 0 && daysLeft <= 30;
  }

  var cartCount = cart.reduce(function (sum, c) { return sum + c.qty; }, 0);
  var cartTotal = cart.reduce(function (sum, c) { return sum + c.price * c.qty; }, 0);

  var categorySet = {};
  products.forEach(function (p) {
    var cat = (p.category || "other").toLowerCase();
    categorySet[cat] = (categorySet[cat] || 0) + 1;
  });
  var categoryKeys = Object.keys(categorySet).sort();
  var filteredProducts = products.filter(function (p) {
    var matchCat = !selectedCategory || (p.category || "other").toLowerCase() === selectedCategory;
    var matchSearch = !searchTerm || p.name.toLowerCase().indexOf(searchTerm.toLowerCase()) >= 0;
    return matchCat && matchSearch;
  });

  var ficaHasDocs = !!(compliance && compliance.fica && (compliance.fica.id_document_url || compliance.fica.proof_of_address_url));
  var ficaStatusMeta = compliance ? ficaMeta(compliance.fica && compliance.fica.status, ficaHasDocs) : ficaMeta(member.fica_status, false);
  var section21App = compliance ? compliance.section21 : null;
  var section21StatusMeta = section21Meta(section21App);

  // Header badge on the Compliance tab — a quiet nudge, cleared once FICA
  // is verified.
  var complianceNeedsAttention = (member.fica_status || "pending") !== "verified";

  var s = {
    page: { minHeight: "100vh", background: "linear-gradient(145deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)", fontFamily: "'Outfit', sans-serif", color: "#fff", paddingBottom: cart.length > 0 ? "76px" : "0" },

    // ── Facebook-style page chrome: cover banner + overlapping avatar ──
    cover: { position: "relative", height: "150px", background: "linear-gradient(120deg, #0f3d1e 0%, #14532d 45%, #0a0a0a 100%)", overflow: "hidden" },
    coverPattern: { position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 20% 30%, rgba(34,197,94,0.18), transparent 45%), radial-gradient(circle at 80% 70%, rgba(251,191,36,0.10), transparent 40%)" },
    coverTopRow: { position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" },
    coverBrand: { display: "flex", alignItems: "center", gap: "8px" },
    coverBrandText: { fontSize: "13px", fontWeight: "600", color: "rgba(255,255,255,0.85)" },
    logoutBtn: { background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", color: "#e5e7eb", padding: "7px 14px", fontSize: "12px", cursor: "pointer", fontFamily: "'Outfit', sans-serif", backdropFilter: "blur(4px)" },
    headerRow: { display: "flex", alignItems: "flex-end", gap: "16px", padding: "0 20px", marginTop: "-46px", position: "relative", zIndex: 3 },
    avatarRingOuter: function (size) {
      return { width: size + "px", height: size + "px", borderRadius: "50%", background: "conic-gradient(from 180deg, #22c55e, #fbbf24, #ef4444, #22c55e)", padding: "3px", flexShrink: 0, boxShadow: "0 4px 18px rgba(0,0,0,0.4)" };
    },
    avatarRingInner: { width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden", background: "linear-gradient(135deg, #22c55e, #16a34a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: "700", color: "#fff", border: "3px solid #0a0a0a" },
    headerNameBlock: { paddingBottom: "10px", minWidth: 0 },
    headerName: { fontSize: "20px", fontWeight: "700", lineHeight: 1.15 },
    headerTierRow: { display: "flex", alignItems: "center", gap: "6px", marginTop: "3px" },
    headerTierText: { fontSize: "12px", fontWeight: "600" },
    headerMemberId: { fontSize: "11px", color: "#6b7280", fontFamily: "monospace", marginTop: "2px" },
    statsBar: { display: "flex", margin: "14px 20px 0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", overflow: "hidden" },
    statCell: { flex: 1, textAlign: "center", padding: "10px 6px", borderRight: "1px solid rgba(255,255,255,0.06)" },
    statCellLast: { flex: 1, textAlign: "center", padding: "10px 6px" },
    statCellVal: { fontSize: "15px", fontWeight: "700" },
    statCellLabel: { fontSize: "9px", color: "#6b7280", marginTop: "2px", letterSpacing: "0.3px" },

    tabsOuter: { borderBottom: "1px solid rgba(255,255,255,0.06)", marginTop: "14px" },
    tabsInner: { display: "flex", padding: "0 20px", overflowX: "auto" },
    tab: function (active) {
      return { padding: "12px 18px", fontSize: "13px", fontWeight: active ? "600" : "400", color: active ? "#22c55e" : "#9ca3af", cursor: "pointer", background: "none", border: "none", borderBottom: "2px solid " + (active ? "#22c55e" : "transparent"), fontFamily: "'Outfit', sans-serif", whiteSpace: "nowrap", position: "relative" };
    },
    tabBadge: { display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#22c55e", color: "#fff", borderRadius: "50%", width: "16px", height: "16px", fontSize: "9px", fontWeight: "700", position: "absolute", top: "6px", right: "6px" },
    tabDot: { display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444", position: "absolute", top: "10px", right: "8px" },

    card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "20px", marginBottom: "14px" },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "14px" },
    stat: { background: "rgba(255,255,255,0.03)", borderRadius: "10px", padding: "12px" },
    label: { color: "#6b7280", fontSize: "11px", marginBottom: "3px" },
    val: { color: "#fff", fontSize: "15px", fontWeight: "600" },
    greenBtn: { width: "100%", padding: "12px", background: "linear-gradient(135deg, #22c55e, #16a34a)", border: "none", borderRadius: "10px", color: "#fff", fontSize: "14px", fontWeight: "600", cursor: "pointer", fontFamily: "'Outfit', sans-serif", marginTop: "14px" },
    productRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" },
    badge: function (type) {
      var c = { Indoor: "#22c55e", Outdoor: "#f59e0b", Hydro: "#3b82f6", Tunnel: "#a855f7", Pops: "#ec4899", Greendoor: "#14b8a6" };
      var color = c[type] || "#6b7280";
      return { display: "inline-block", padding: "2px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: "600", background: color + "20", color: color };
    },
    search: { width: "100%", padding: "10px 14px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", fontSize: "14px", outline: "none", fontFamily: "'Outfit', sans-serif", marginBottom: "12px", boxSizing: "border-box" },
    storeSelect: { width: "100%", padding: "10px 14px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", fontSize: "14px", outline: "none", fontFamily: "'Outfit', sans-serif", marginBottom: "12px", boxSizing: "border-box", appearance: "none", cursor: "pointer" },
    catPill: function (active) {
      return { display: "inline-block", padding: "6px 14px", borderRadius: "20px", fontSize: "12px", fontWeight: "500", cursor: "pointer", border: "none", fontFamily: "'Outfit', sans-serif", background: active ? "#22c55e" : "rgba(255,255,255,0.06)", color: active ? "#fff" : "#9ca3af", marginRight: "6px", marginBottom: "6px", whiteSpace: "nowrap" };
    },
    stockBadge: { display: "inline-block", padding: "2px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: "600", background: "rgba(34,197,94,0.15)", color: "#22c55e" },
    tabCard: function (owing) {
      return {
        gridColumn: "1 / -1",
        background: owing ? "rgba(245,158,11,0.06)" : "rgba(255,255,255,0.03)",
        border: "1px solid " + (owing ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.06)"),
        borderRadius: "10px",
        padding: "12px",
      };
    },

    // ── Card (the physical/digital membership card widget) ──
    cardOuterGlow: { boxShadow: "0 0 30px rgba(34,197,94,0.12)", borderRadius: "20px" },
    cardBorderWrap: { background: "linear-gradient(135deg, #22c55e, #fbbf24, #ef4444)", padding: "2px", borderRadius: "20px" },
    flipOuter: { perspective: "1400px", cursor: "pointer", WebkitTapHighlightColor: "transparent" },
    flipInner: function (isFlipped) {
      return { position: "relative", width: "100%", minHeight: "300px", transformStyle: "preserve-3d", transition: "transform 0.6s cubic-bezier(0.4, 0.2, 0.2, 1)", transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)" };
    },
    flipFace: function (isBack) {
      return {
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
        transform: isBack ? "rotateY(180deg)" : "none",
        background: "linear-gradient(160deg, #0e1a10 0%, #0a0a0a 100%)",
        borderRadius: "18px", padding: "18px", boxSizing: "border-box",
        display: "flex", flexDirection: "column", overflow: "hidden",
      };
    },
    cardWatermark: { position: "absolute", right: "-30px", bottom: "-40px", fontSize: "180px", opacity: 0.05, color: "#fbbf24", pointerEvents: "none", lineHeight: 1 },
    cardHeaderRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", position: "relative", zIndex: 2 },
    cardBrandRow: { display: "flex", alignItems: "center", gap: "6px" },
    cardBrandWordmark: { fontSize: "16px", fontWeight: "800", color: "#fff" },
    cardBrandPill: { background: "#22c55e", color: "#06170c", fontSize: "9px", fontWeight: "800", padding: "2px 7px", borderRadius: "5px", letterSpacing: "0.5px" },
    cardSubtitle: { fontSize: "8px", color: "#7fa88e", fontWeight: "700", letterSpacing: "1.4px", marginTop: "3px" },
    cardTaglineWrap: { textAlign: "right" },
    cardTaglineLine: { fontSize: "8px", color: "#d4af37", fontWeight: "700", letterSpacing: "0.8px", lineHeight: 1.5 },
    cardTaglineBar: { display: "flex", gap: "3px", marginTop: "4px", justifyContent: "flex-end" },
    cardTaglineBarSeg: { width: "18px", height: "2px", borderRadius: "1px" },
    cardMidRow: { display: "flex", alignItems: "center", gap: "12px", marginTop: "18px", position: "relative", zIndex: 2 },
    cardName: { fontSize: "17px", fontWeight: "800", lineHeight: 1.2 },
    cardTierRow: { display: "flex", alignItems: "center", gap: "5px", marginTop: "3px" },
    cardTierText: { fontSize: "11px", fontWeight: "700" },
    cardMemberId: { fontSize: "10px", color: "#7fa88e", fontFamily: "monospace", marginTop: "3px" },
    cardLogoBox: { position: "absolute", top: "18px", right: "18px", width: "56px", height: "56px", borderRadius: "10px", border: "1px solid rgba(212,175,55,0.45)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "rgba(255,255,255,0.02)" },
    cardStripRow: { display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: "20px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", position: "relative", zIndex: 2 },
    cardStripCell: { padding: "9px 12px", borderRight: "1px solid rgba(255,255,255,0.08)" },
    cardStripCellLast: { padding: "9px 12px" },
    cardStripLabel: { fontSize: "8px", color: "#6b7280", letterSpacing: "0.5px" },
    cardStripVal: { fontSize: "13px", fontWeight: "700", marginTop: "2px" },
    cardBottomTagline: { marginTop: "auto", paddingTop: "14px", fontSize: "8px", color: "#d4af37", fontWeight: "700", letterSpacing: "0.6px", lineHeight: 1.6, position: "relative", zIndex: 2 },
    cardFlipHint: { textAlign: "center", fontSize: "10px", color: "#6b7280", marginTop: "10px", position: "relative", zIndex: 2 },
    cardBackTitle: { textAlign: "center", fontSize: "10px", color: "#22c55e", fontWeight: "700", letterSpacing: "1px", margin: "20px 0 16px", position: "relative", zIndex: 2 },
    cardBackDetailsRow: { display: "flex", justifyContent: "space-between", gap: "10px", position: "relative", zIndex: 2 },
    cardBackQrWrap: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", marginTop: "10px", position: "relative", zIndex: 2 },

    inboxThumb: { width: "56px", height: "56px", borderRadius: "10px", objectFit: "cover", flexShrink: 0 },
    productCard: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", overflow: "hidden", display: "flex", flexDirection: "column" },
    productImgWrap: { width: "100%", paddingTop: "100%", position: "relative", background: "rgba(255,255,255,0.03)" },
    productImg: { width: "100%", height: "100%", objectFit: "cover" },
    productImgFallback: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "40px", color: "rgba(255,255,255,0.15)" },
    stepperBtn: { width: "32px", height: "32px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: "16px", fontWeight: "700", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
    cartBar: { position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(15,15,26,0.97)", borderTop: "1px solid rgba(34,197,94,0.3)", cursor: "pointer", zIndex: 40, backdropFilter: "blur(12px)" },
    overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50, padding: 0 },
    drawer: { width: "100%", maxWidth: "480px", background: "#12121e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "18px 18px 0 0", padding: "20px", boxSizing: "border-box", maxHeight: "85vh", overflowY: "auto" },
    closeBtn: { background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: "28px", height: "28px", color: "#fff", cursor: "pointer", fontSize: "13px", flexShrink: 0 },
    notesInput: { width: "100%", minHeight: "60px", padding: "10px 12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", fontSize: "13px", outline: "none", fontFamily: "'Outfit', sans-serif", resize: "vertical", boxSizing: "border-box" },

    // ── Compliance ──
    statusPill: function (meta) {
      return { display: "inline-flex", alignItems: "center", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "600", background: meta.bg, color: meta.color };
    },
    uploadBox: function (has) {
      return {
        border: "1.5px dashed " + (has ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.15)"),
        background: has ? "rgba(34,197,94,0.05)" : "rgba(255,255,255,0.02)",
        borderRadius: "12px", padding: "16px", textAlign: "center", cursor: "pointer",
      };
    },
    complianceNote: { fontSize: "12px", color: "#9ca3af", lineHeight: 1.5, marginTop: "8px" },
  };

  return (
    <div style={s.page}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style>{"\n        .mp-wrap { max-width: 600px; margin: 0 auto; width: 100%; box-sizing: border-box; }\n        @media (min-width: 900px) { .mp-wrap { max-width: 900px; } }\n        @media (min-width: 1300px) { .mp-wrap { max-width: 1200px; } }\n        .mp-narrow { max-width: 560px; margin: 0 auto; }\n        .mp-shop-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }\n        @media (min-width: 560px) { .mp-shop-grid { grid-template-columns: repeat(2, 1fr); } }\n        @media (min-width: 1024px) { .mp-shop-grid { grid-template-columns: repeat(3, 1fr); } }\n        @media (min-width: 1500px) { .mp-shop-grid { grid-template-columns: repeat(4, 1fr); } }\n      "}</style>

      {/* ── Facebook-style cover + avatar header ── */}
      <div style={s.cover}>
        <div style={s.coverPattern} />
        <div className="mp-wrap" style={s.coverTopRow}>
          <div style={s.coverBrand}>
            {companyLogo ? (
              <img src={companyLogo} alt={companyName} style={{ width: "26px", height: "26px", borderRadius: "6px", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: "18px" }}>🌿</span>
            )}
            <span style={s.coverBrandText}>{companyName || "Member Portal"}</span>
          </div>
          <button style={s.logoutBtn} onClick={handleLogout}>Log Out</button>
        </div>
      </div>

      <div className="mp-wrap">
        <div style={s.headerRow}>
          <div style={{ position: "relative" }} onClick={function () { if (fileRef.current) fileRef.current.click(); }}>
            <div style={s.avatarRingOuter(92)}>
              <div style={s.avatarRingInner}>
                {member.profile_image ? (
                  <img src={member.profile_image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  (member.first_name || "?")[0] + (member.last_name || "?")[0]
                )}
              </div>
            </div>
            {uploading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#fff" }}>...</div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoUpload} />
          <div style={s.headerNameBlock}>
            <div style={s.headerName}>{member.first_name} {member.last_name}</div>
            <div style={s.headerTierRow}>
              <span>{tierInfo.emoji}</span>
              <span style={Object.assign({}, s.headerTierText, { color: tierInfo.color })}>{tierInfo.label} MEMBER</span>
            </div>
            <div style={s.headerMemberId}>{member.membership_id}</div>
          </div>
        </div>

        <div style={s.statsBar}>
          <div style={s.statCell}>
            <div style={Object.assign({}, s.statCellVal, { color: "#fbbf24" })}>{(member.loyalty_points || 0).toLocaleString()}</div>
            <div style={s.statCellLabel}>POINTS</div>
          </div>
          <div style={s.statCell}>
            <div style={Object.assign({}, s.statCellVal, { color: "#22c55e" })}>{(member.store_credit || 0).toFixed(0)}</div>
            <div style={s.statCellLabel}>CREDIT</div>
          </div>
          <div style={s.statCellLast}>
            <div style={Object.assign({}, s.statCellVal, { color: member.is_active ? "#22c55e" : "#ef4444" })}>{member.is_active ? "Active" : "Inactive"}</div>
            <div style={s.statCellLabel}>STATUS</div>
          </div>
        </div>

        <div style={s.tabsOuter}>
          <div style={s.tabsInner}>
            <button style={s.tab(tab === "profile")} onClick={function () { setTab("profile"); }}>Profile</button>
            <button style={s.tab(tab === "inbox")} onClick={function () { setTab("inbox"); loadNotifications(); }}>
              Inbox
              {unreadCount > 0 && <span style={s.tabBadge}>{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            <button style={s.tab(tab === "shop")} onClick={function () { setTab("shop"); }}>
              Shop
              {cartCount > 0 && <span style={s.tabBadge}>{cartCount > 9 ? "9+" : cartCount}</span>}
            </button>
            <button style={s.tab(tab === "orders")} onClick={function () { setTab("orders"); loadMyOrders(); }}>Orders</button>
            <button style={s.tab(tab === "compliance")} onClick={function () { setTab("compliance"); loadCompliance(); }}>
              Compliance
              {complianceNeedsAttention && <span style={s.tabDot} />}
            </button>
          </div>
        </div>
      </div>

      <div className="mp-wrap" style={{ padding: "20px", boxSizing: "border-box" }}>

        {/* PROFILE */}
        {tab === "profile" && (
          <div className="mp-narrow">
            <div style={s.card}>
              <h3 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "14px" }}>Your Membership Card</h3>

              <div style={s.cardOuterGlow}>
                <div style={s.cardBorderWrap}>
                  <div style={s.flipOuter} onClick={function () { setFlipped(function (f) { return !f; }); }}>
                    <div style={s.flipInner(flipped)}>

                      {/* FRONT */}
                      <div style={s.flipFace(false)}>
                        <div style={s.cardWatermark}>🌿</div>

                        <div style={s.cardHeaderRow}>
                          <div>
                            <div style={s.cardBrandRow}>
                              <span style={{ fontSize: "16px" }}>🌿</span>
                              <span style={s.cardBrandWordmark}>Canna Life Co</span>
                              <span style={s.cardBrandPill}>POS</span>
                            </div>
                            <div style={s.cardSubtitle}>CANNABIS CLUB MEMBERSHIP</div>
                          </div>
                          <div style={s.cardTaglineWrap}>
                            <div style={s.cardTaglineLine}>GOOD PEOPLE</div>
                            <div style={s.cardTaglineLine}>HIGHER REWARDS</div>
                            <div style={s.cardTaglineBar}>
                              <div style={Object.assign({}, s.cardTaglineBarSeg, { background: "#22c55e" })} />
                              <div style={Object.assign({}, s.cardTaglineBarSeg, { background: "#fbbf24" })} />
                              <div style={Object.assign({}, s.cardTaglineBarSeg, { background: "#ef4444" })} />
                            </div>
                          </div>
                        </div>

                        <div style={s.cardLogoBox}>
                          {companyLogo ? (
                            <img src={companyLogo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <span style={{ fontSize: "20px", opacity: 0.5 }}>🏪</span>
                          )}
                        </div>

                        <div style={s.cardMidRow}>
                          <div style={{ position: "relative" }} onClick={function (e) { e.stopPropagation(); if (fileRef.current) fileRef.current.click(); }}>
                            <div style={s.avatarRingOuter(64)}>
                              <div style={Object.assign({}, s.avatarRingInner, { fontSize: "18px" })}>
                                {member.profile_image ? (
                                  <img src={member.profile_image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : (
                                  (member.first_name || "?")[0] + (member.last_name || "?")[0]
                                )}
                              </div>
                            </div>
                          </div>
                          <div>
                            <div style={s.cardName}>{member.first_name} {member.last_name}</div>
                            <div style={s.cardTierRow}>
                              <span>{tierInfo.emoji}</span>
                              <span style={Object.assign({}, s.cardTierText, { color: tierInfo.color })}>{tierInfo.label} MEMBER</span>
                            </div>
                            <div style={s.cardMemberId}>{member.membership_id}</div>
                          </div>
                        </div>

                        <div style={s.cardStripRow}>
                          <div style={s.cardStripCell}>
                            <div style={s.cardStripLabel}>STATUS</div>
                            <div style={Object.assign({}, s.cardStripVal, { color: member.is_active ? "#22c55e" : "#ef4444" })}>
                              {member.is_active ? "● ACTIVE" : "● INACTIVE"}
                            </div>
                          </div>
                          <div style={s.cardStripCellLast}>
                            <div style={s.cardStripLabel}>POINTS</div>
                            <div style={Object.assign({}, s.cardStripVal, { color: "#fbbf24" })}>★ {(member.loyalty_points || 0).toLocaleString()}</div>
                          </div>
                        </div>

                        <div style={s.cardBottomTagline}>
                          MORE PLANTS<br />A BRIGHTER TOMORROW
                        </div>
                        <div style={s.cardFlipHint}>⟲ Tap card for membership dates &amp; QR code</div>
                      </div>

                      {/* BACK */}
                      <div style={s.flipFace(true)}>
                        <div style={s.cardWatermark}>🌿</div>

                        <div style={s.cardHeaderRow}>
                          <div>
                            <div style={s.cardBrandRow}>
                              <span style={{ fontSize: "16px" }}>🌿</span>
                              <span style={s.cardBrandWordmark}>Canna Life Co</span>
                              <span style={s.cardBrandPill}>POS</span>
                            </div>
                            <div style={s.cardSubtitle}>CANNABIS CLUB MEMBERSHIP</div>
                          </div>
                          <div style={s.cardTaglineWrap}>
                            <div style={s.cardTaglineLine}>SAME COMMUNITY</div>
                            <div style={s.cardTaglineLine}>BIGGER TOMORROWS</div>
                            <div style={s.cardTaglineBar}>
                              <div style={Object.assign({}, s.cardTaglineBarSeg, { background: "#22c55e" })} />
                              <div style={Object.assign({}, s.cardTaglineBarSeg, { background: "#fbbf24" })} />
                              <div style={Object.assign({}, s.cardTaglineBarSeg, { background: "#ef4444" })} />
                            </div>
                          </div>
                        </div>

                        <div style={s.cardLogoBox}>
                          {companyLogo ? (
                            <img src={companyLogo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <span style={{ fontSize: "20px", opacity: 0.5 }}>🏪</span>
                          )}
                        </div>

                        <div style={s.cardBackTitle}>CANNA LIFE CO POS · DETAILS</div>

                        <div style={s.cardBackDetailsRow}>
                          <div>
                            <div style={s.cardStripLabel}>📅 MEMBER SINCE</div>
                            <div style={{ fontSize: "13px", fontWeight: "700", marginTop: "3px" }}>{formatDate(member.membership_start_date)}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={s.cardStripLabel}>⏰ EXPIRES</div>
                            <div style={{ fontSize: "13px", fontWeight: "700", marginTop: "3px", color: isExpiringSoon ? "#f59e0b" : "#fff" }}>
                              {member.expiry_date ? formatDate(member.expiry_date) : "No expiry"}
                            </div>
                          </div>
                        </div>

                        <div style={s.cardBackQrWrap}>
                          {member.qr_code ? (
                            <div style={{ textAlign: "center" }}>
                              <img src={member.qr_code} alt="QR" style={{ width: "128px", height: "128px", borderRadius: "8px", background: "#fff", padding: "6px", boxSizing: "border-box" }} />
                              <p style={{ fontSize: "10px", color: "#6b7280", marginTop: "8px" }}>Show this at the counter for quick check-in</p>
                            </div>
                          ) : (
                            <p style={{ fontSize: "11px", color: "#6b7280" }}>No QR code on file</p>
                          )}
                        </div>

                        <div style={s.cardBottomTagline}>
                          GOOD PLANTS<br />GREAT PEOPLE<br />BETTER DAYS
                        </div>
                        <div style={s.cardFlipHint}>📱 Tap to flip back</div>
                      </div>

                    </div>
                  </div>
                </div>
              </div>

              <button style={s.greenBtn} onClick={downloadCard}>Download Card as Image</button>
            </div>

            <div style={Object.assign({}, s.card, { marginTop: "14px" })}>
              <div style={s.grid}>
                <div>
                  <div style={s.label}>Email</div>
                  <div style={{ color: "#d1d5db", fontSize: "13px" }}>{member.email || "Not provided"}</div>
                </div>
                <div>
                  <div style={s.label}>Phone</div>
                  <div style={{ color: "#d1d5db", fontSize: "13px" }}>{member.phone || "Not provided"}</div>
                </div>
                <div>
                  <div style={s.label}>ID Number</div>
                  <div style={{ color: "#d1d5db", fontSize: "13px" }}>
                    {member.id_number_masked || "Not provided"}
                  </div>
                </div>
                <div>
                  <div style={s.label}>Status</div>
                  <div style={{ color: member.is_active ? "#22c55e" : "#ef4444", fontSize: "13px", fontWeight: "600" }}>
                    {member.is_active ? "Active" : "Inactive"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* INBOX */}
        {tab === "inbox" && (
          <div className="mp-narrow">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <div>
                <h3 style={{ fontSize: "15px", fontWeight: "600", margin: 0 }}>Inbox</h3>
                <p style={{ fontSize: "11px", color: "#6b7280", margin: "2px 0 0" }}>Messages from {companyName}</p>
              </div>
              {unreadCount > 0 && (
                <button onClick={function () { markAllRead(notifications); }}
                  style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: "8px", color: "#22c55e", padding: "6px 12px", fontSize: "12px", cursor: "pointer", fontFamily: "'Outfit', sans-serif" }}>
                  Mark all read
                </button>
              )}
            </div>
            {loadingNotifs ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>Loading...</div>
            ) : notifications.length === 0 ? (
              <div style={Object.assign({}, s.card, { textAlign: "center", padding: "48px 20px" })}>
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>📭</div>
                <p style={{ color: "#6b7280", fontSize: "14px" }}>No messages yet</p>
                <p style={{ color: "#4b5563", fontSize: "12px", marginTop: "4px" }}>Check back for specials and updates from {companyName}</p>
              </div>
            ) : (
              <div>
                {notifications.map(function (n) {
                  var readKey = "portal_read_" + member.id;
                  var readIds = JSON.parse(sessionStorage.getItem(readKey) || "[]");
                  var isRead = readIds.includes(n.id);
                  var markRead = function () {
                    if (!isRead) {
                      sessionStorage.setItem(readKey, JSON.stringify(readIds.concat([n.id])));
                      setUnreadCount(function (c) { return Math.max(0, c - 1); });
                    }
                  };
                  var audienceColors = {
                    all:      { bg: "rgba(59,130,246,0.1)",  color: "#60a5fa", label: "👥 All Members" },
                    bronze:   { bg: "rgba(245,158,11,0.1)",  color: "#f59e0b", label: "🥉 Bronze" },
                    silver:   { bg: "rgba(148,163,184,0.1)", color: "#94a3b8", label: "🥈 Silver" },
                    gold:     { bg: "rgba(251,191,36,0.1)",  color: "#fbbf24", label: "🥇 Gold" },
                    platinum: { bg: "rgba(167,139,250,0.1)", color: "#a78bfa", label: "💎 Platinum" },
                  };
                  var aud = audienceColors[n.target_audience] || audienceColors.all;
                  return (
                    <div key={n.id} onClick={markRead}
                      style={{ background: isRead ? "rgba(255,255,255,0.03)" : "rgba(34,197,94,0.05)", border: "1px solid " + (isRead ? "rgba(255,255,255,0.07)" : "rgba(34,197,94,0.2)"), borderRadius: "12px", padding: "16px", marginBottom: "10px", cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                        {n.image_url && <img src={n.image_url} alt="" style={s.inboxThumb} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
                            {!isRead && <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#22c55e", display: "inline-block", flexShrink: 0 }} />}
                            <h4 style={{ fontSize: "18px", fontWeight: "700", margin: 0, lineHeight: "1.3" }}>{n.title}</h4>
                          </div>
                          <p style={{ fontSize: "14px", color: "#c7ccd6", margin: "0 0 10px", lineHeight: "1.5" }}>{n.message}</p>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "20px", background: aud.bg, color: aud.color, fontWeight: "500" }}>{aud.label}</span>
                            <span style={{ fontSize: "10px", color: "#4b5563" }}>
                              {new Date(n.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* SHOP */}
        {tab === "shop" && (
          <div>
            <div style={{ marginBottom: "16px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "4px" }}>Shop</h3>
              <p style={{ fontSize: "11px", color: "#6b7280" }}>
                {filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""} available to pre-order
                {selectedStore ? " at " + ((stores.find(function (st) { return st.id === selectedStore; }) || {}).name || "selected store") : ""}
                {" — pay in-store on collection"}
              </p>
            </div>

            {/* Store selector — only shown when the company has more than one store */}
            {stores.length > 1 && (
              <select
                value={selectedStore}
                onChange={function (e) { changeStore(e.target.value); }}
                style={s.storeSelect}
              >
                <option value="">All Stores (combined stock)</option>
                {stores.map(function (st) {
                  return <option key={st.id} value={st.id}>{st.name}</option>;
                })}
              </select>
            )}

            {categoryKeys.length > 1 && (
              <div style={{ marginBottom: "12px", overflowX: "auto", whiteSpace: "nowrap" }}>
                <button style={s.catPill(!selectedCategory)} onClick={function () { setSelectedCategory(""); }}>All ({products.length})</button>
                {categoryKeys.map(function (cat) {
                  return (
                    <button key={cat} style={s.catPill(selectedCategory === cat)} onClick={function () { setSelectedCategory(selectedCategory === cat ? "" : cat); }}>
                      {cat.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); })} ({categorySet[cat]})
                    </button>
                  );
                })}
              </div>
            )}
            <input type="text" placeholder="Search products..." value={searchTerm} onChange={function (e) { setSearchTerm(e.target.value); }} style={s.search} />

            {loadingProducts ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#6b7280" }}>Loading...</div>
            ) : filteredProducts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#6b7280" }}>{searchTerm ? "No matches" : "No products available"}</div>
            ) : (
              <div className="mp-shop-grid">
                {filteredProducts.map(function (p) {
                  var inCart = cart.find(function (c) { return c.product_id === p.id; });
                  var qtyInCart = inCart ? inCart.qty : 0;
                  return (
                    <div key={p.id} style={s.productCard}>
                      <div style={s.productImgWrap}>
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} style={s.productImg} />
                          ) : (
                            <div style={s.productImgFallback}>🌿</div>
                          )}
                        </div>
                      </div>
                      <div style={{ padding: "14px", display: "flex", flexDirection: "column", flex: 1 }}>
                        <div style={{ display: "flex", gap: "6px", marginBottom: "6px", flexWrap: "wrap", alignItems: "center" }}>
                          {p.product_type && <span style={s.badge(p.product_type)}>{p.product_type}</span>}
                          {p.category && <span style={{ fontSize: "10px", color: "#6b7280" }}>{p.category}</span>}
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "4px" }}>{p.name}</div>
                        <div style={{ fontSize: "16px", fontWeight: "700", color: "#22c55e", marginBottom: "2px" }}>{(p.price || 0).toFixed(2)}</div>
                        {p.stock_quantity <= 5 && (
                          <div style={{ fontSize: "10px", color: "#f59e0b", marginBottom: "8px" }}>Only {p.stock_quantity} left</div>
                        )}
                        <div style={{ marginTop: "auto", paddingTop: "8px" }}>
                          {qtyInCart === 0 ? (
                            <button style={Object.assign({}, s.greenBtn, { marginTop: 0, padding: "9px" })} onClick={function () { addToCart(p); }}>
                              Add to Cart
                            </button>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                              <button style={s.stepperBtn} onClick={function () { updateCartQty(p.id, -1); }}>−</button>
                              <span style={{ fontSize: "14px", fontWeight: "700" }}>{qtyInCart}</span>
                              <button style={s.stepperBtn} onClick={function () { updateCartQty(p.id, 1); }}>+</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ORDERS */}
        {tab === "orders" && (
          <div className="mp-narrow">
            <div style={{ marginBottom: "14px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "600", margin: 0 }}>My Pre-Orders</h3>
              <p style={{ fontSize: "11px", color: "#6b7280", margin: "2px 0 0" }}>Orders placed for in-store pickup</p>
            </div>
            {loadingOrders ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>Loading...</div>
            ) : myOrders.length === 0 ? (
              <div style={Object.assign({}, s.card, { textAlign: "center", padding: "48px 20px" })}>
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>🛍️</div>
                <p style={{ color: "#6b7280", fontSize: "14px" }}>No pre-orders yet</p>
                <p style={{ color: "#4b5563", fontSize: "12px", marginTop: "4px" }}>Head to the Shop tab to reserve items for pickup</p>
              </div>
            ) : (
              <div>
                {myOrders.map(function (o) {
                  var meta = ORDER_STATUS_META[o.status] || ORDER_STATUS_META.pending;
                  var items = Array.isArray(o.items) ? o.items : [];
                  return (
                    <div key={o.id} style={Object.assign({}, s.card, { marginBottom: "10px" })}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "8px" }}>
                        <div>
                          <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#6b7280" }}>#{o.id.slice(0, 8).toUpperCase()}</div>
                          <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                            {new Date(o.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                            {o.store_name ? " · " + o.store_name : ""}
                          </div>
                        </div>
                        <span style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "20px", background: meta.bg, color: meta.color, fontWeight: "600", whiteSpace: "nowrap" }}>{meta.label}</span>
                      </div>
                      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px" }}>
                        {items.map(function (it, idx) {
                          return (
                            <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#d1d5db", marginBottom: "3px" }}>
                              <span>{it.quantity} × {it.name}</span>
                              <span>{(parseFloat(it.line_total) || 0).toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <span style={{ fontSize: "12px", color: "#9ca3af" }}>Total</span>
                        <span style={{ fontSize: "14px", fontWeight: "700", color: "#22c55e" }}>{(parseFloat(o.total_amount) || 0).toFixed(2)}</span>
                      </div>
                      {o.notes && <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "6px", fontStyle: "italic" }}>"{o.notes}"</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* COMPLIANCE */}
        {tab === "compliance" && (
          <div className="mp-narrow">
            <div style={{ marginBottom: "14px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "600", margin: 0 }}>Compliance</h3>
              <p style={{ fontSize: "11px", color: "#6b7280", margin: "2px 0 0" }}>FICA verification and Section 21 documents, on file with {companyName}</p>
            </div>

            {loadingCompliance ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>Loading...</div>
            ) : (
              <>
                {/* FICA */}
                <div style={Object.assign({}, s.card, { marginBottom: "14px" })}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <h4 style={{ fontSize: "14px", fontWeight: "700", margin: 0 }}>FICA Verification</h4>
                    <span style={s.statusPill(ficaStatusMeta)}>{ficaStatusMeta.label}</span>
                  </div>
                  <p style={s.complianceNote}>South African law requires ID and proof of address on file before your account can be fully verified.</p>

                  {compliance && compliance.fica && compliance.fica.status === "rejected" && compliance.fica.notes && (
                    <div style={{ marginTop: "10px", padding: "10px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", fontSize: "12px", color: "#f87171" }}>
                      {compliance.fica.notes}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "14px" }}>
                    <div style={s.uploadBox(!!(compliance && compliance.fica && compliance.fica.id_document_url))}
                      onClick={function () { if (ficaIdRef.current) ficaIdRef.current.click(); }}>
                      <div style={{ fontSize: "22px" }}>{compliance && compliance.fica && compliance.fica.id_document_url ? "✅" : "🪪"}</div>
                      <div style={{ fontSize: "12px", fontWeight: "600", marginTop: "6px" }}>ID Document</div>
                      <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px" }}>
                        {uploadingFicaId ? "Uploading..." : (compliance && compliance.fica && compliance.fica.id_document_url) ? "Uploaded — tap to replace" : "Tap to upload"}
                      </div>
                    </div>
                    <div style={s.uploadBox(!!(compliance && compliance.fica && compliance.fica.proof_of_address_url))}
                      onClick={function () { if (ficaPoaRef.current) ficaPoaRef.current.click(); }}>
                      <div style={{ fontSize: "22px" }}>{compliance && compliance.fica && compliance.fica.proof_of_address_url ? "✅" : "🏠"}</div>
                      <div style={{ fontSize: "12px", fontWeight: "600", marginTop: "6px" }}>Proof of Address</div>
                      <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px" }}>
                        {uploadingFicaPoa ? "Uploading..." : (compliance && compliance.fica && compliance.fica.proof_of_address_url) ? "Uploaded — tap to replace" : "Tap to upload"}
                      </div>
                    </div>
                  </div>
                  <input ref={ficaIdRef} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={handleFicaIdFile} />
                  <input ref={ficaPoaRef} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={handleFicaPoaFile} />
                </div>

                {/* Section 21 */}
                <div style={s.card}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <h4 style={{ fontSize: "14px", fontWeight: "700", margin: 0 }}>Section 21 Application</h4>
                    <span style={s.statusPill(section21StatusMeta)}>{section21StatusMeta.label}</span>
                  </div>
                  <p style={s.complianceNote}>
                    Access to unregistered cannabis medicine under Section 21 of the Medicines and Related Substances
                    Act requires a doctor-supported application. Upload your prescription or application document
                    here — the full clinical intake is completed with {companyName}'s staff.
                  </p>

                  {section21App && section21App.notes && (section21App.application_status || "").toLowerCase() === "rejected" && (
                    <div style={{ marginTop: "10px", padding: "10px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", fontSize: "12px", color: "#f87171" }}>
                      {section21App.notes}
                    </div>
                  )}

                  <div style={{ marginTop: "14px" }}>
                    <div style={s.uploadBox(!!(section21App && section21App.id_upload_url))}
                      onClick={function () { if (section21Ref.current) section21Ref.current.click(); }}>
                      <div style={{ fontSize: "22px" }}>{section21App && section21App.id_upload_url ? "✅" : "📄"}</div>
                      <div style={{ fontSize: "12px", fontWeight: "600", marginTop: "6px" }}>Prescription / Application Document</div>
                      <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px" }}>
                        {uploadingSection21 ? "Uploading..." : (section21App && section21App.id_upload_url) ? "Uploaded — tap to replace" : "Tap to upload"}
                      </div>
                    </div>
                  </div>
                  {section21App && section21App.submission_timestamp && (
                    <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "8px" }}>
                      Submitted {formatDate(section21App.submission_timestamp)}
                    </div>
                  )}
                  <input ref={section21Ref} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={handleSection21File} />
                </div>
              </>
            )}
          </div>
        )}

      </div>

      <div style={{ textAlign: "center", padding: "8px 20px 32px", color: "#4b5563", fontSize: "11px" }}>
        🌿 Powered by <span style={{ color: "#22c55e", fontWeight: "600" }}>Canna Life Co</span>
      </div>

      {/* FLOATING CART BAR */}
      {cart.length > 0 && (
        <div style={s.cartBar} onClick={function () { setCartOpen(true); }}>
          <div className="mp-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>🛒</span>
              <span style={{ fontSize: "14px", fontWeight: "700" }}>{cartCount} item{cartCount !== 1 ? "s" : ""} · {cartTotal.toFixed(2)}</span>
            </div>
            <span style={{ fontSize: "14px", fontWeight: "800", color: "#0a0a0a", background: "#22c55e", padding: "9px 18px", borderRadius: "10px", letterSpacing: "0.3px" }}>View Cart →</span>
          </div>
        </div>
      )}

      {/* CART DRAWER */}
      {cartOpen && (
        <div style={s.overlay} onClick={function () { setCartOpen(false); }}>
          <div style={s.drawer} onClick={function (e) { e.stopPropagation(); }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "700", margin: 0 }}>Your Pre-Order</h3>
              <button style={s.closeBtn} onClick={function () { setCartOpen(false); }}>✕</button>
            </div>

            {stores.length > 1 && (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "4px" }}>Pickup store</div>
                <select value={selectedStore} onChange={function (e) { changeStore(e.target.value); }} style={Object.assign({}, s.storeSelect, { marginBottom: 0 })}>
                  <option value="">Select a store...</option>
                  {stores.map(function (st) {
                    return <option key={st.id} value={st.id}>{st.name}</option>;
                  })}
                </select>
              </div>
            )}

            <div style={{ maxHeight: "260px", overflowY: "auto", marginBottom: "14px", marginTop: stores.length > 1 ? "12px" : 0 }}>
              {cart.map(function (c) {
                return (
                  <div key={c.product_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "600" }}>{c.name}</div>
                      <div style={{ fontSize: "11px", color: "#6b7280" }}>{c.price.toFixed(2)} each</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button style={s.stepperBtn} onClick={function () { updateCartQty(c.product_id, -1); }}>−</button>
                      <span style={{ fontSize: "13px", fontWeight: "700", minWidth: "16px", textAlign: "center" }}>{c.qty}</span>
                      <button style={s.stepperBtn} onClick={function () { updateCartQty(c.product_id, 1); }}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <textarea
              placeholder="Pickup notes (optional) — e.g. preferred time"
              value={orderNotes}
              onChange={function (e) { setOrderNotes(e.target.value); }}
              style={s.notesInput}
            />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0" }}>
              <span style={{ fontSize: "13px", color: "#9ca3af" }}>Total</span>
              <span style={{ fontSize: "20px", fontWeight: "700", color: "#22c55e" }}>{cartTotal.toFixed(2)}</span>
            </div>

            <button style={s.greenBtn} disabled={placingOrder} onClick={submitPreorder}>
              {placingOrder ? "Placing Order..." : "Place Pre-Order (Pay In-Store)"}
            </button>
            <p style={{ fontSize: "10px", color: "#6b7280", textAlign: "center", marginTop: "8px" }}>
              No payment now — settle at checkout when you collect.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
