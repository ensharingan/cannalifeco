import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { supabase } from "@/api/supabaseClient";
import { fetchAll } from "@/lib/fetchAll";
import {
  ArrowUpDown,
  AlertTriangle,
  ArrowRight,
  Download,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Store,
  Tag,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../lib/currency";
import { useCompany } from "../lib/CompanyContext";
import { useAuth } from "@/lib/AuthContext";

// Canonical strain vocabulary. Any value stored on a product that isn't in this
// list still displays and still appears in the filter, so legacy free-text
// entries ("n/a" and similar) are never hidden from the club that typed them.
var STRAIN_TYPES = ["indica", "sativa", "hybrid", "cbd"];

function formatStrain(value) {
  if (!value) return "—";
  var v = String(value).trim();
  if (!v) return "—";
  if (v.toLowerCase() === "cbd") return "CBD";
  if (v.toLowerCase() === "n/a") return "N/A";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

// Colour-code the badge so the strain reads at a glance on a busy table.
function strainClasses(value) {
  var v = value ? String(value).toLowerCase() : "";
  if (v === "indica") return "bg-purple-500/10 text-purple-400";
  if (v === "sativa") return "bg-orange-500/10 text-orange-400";
  if (v === "hybrid") return "bg-green-500/10 text-green-400";
  if (v === "cbd") return "bg-blue-500/10 text-blue-400";
  return "bg-muted text-muted-foreground";
}

// ── Per-store pricing ──────────────────────────────────────────────────
// A branch can sell the same product at its own price. The override lives on
// the store_inventory row that already carries that branch's stock, so NULL
// means "no special price here, use the group price off products". One
// catalogue, one SKU, one set of reports — only the number differs.
function hasOverride(value) {
  return value !== null && value !== undefined && value !== "";
}

function resolveStorePrice(baseValue, overrideValue) {
  if (!hasOverride(overrideValue)) return baseValue;
  var n = Number(overrideValue);
  return isNaN(n) ? baseValue : n;
}

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col)
    return <ChevronUp className="w-3 h-3 opacity-20 ml-1 inline" />;
  return sortDir === "asc" ? (
    <ChevronUp className="w-3 h-3 ml-1 inline text-primary" />
  ) : (
    <ChevronDown className="w-3 h-3 ml-1 inline text-primary" />
  );
}

// Searchable product picker. A plain <Select> is unusable once a club has more
// than about thirty products — Fay's book is 406 — so this pins a search box to
// the top of the dropdown and filters on name, SKU, category and strain.
//
// Two things to know if you ever touch this:
//   1. Radix Select runs its own "type-ahead" on keystrokes and will hijack
//      anything typed into the box, so keydown is stopped from bubbling.
//      Escape is deliberately let through so the dropdown still closes.
//   2. Radix moves DOM focus onto the highlighted item the instant the
//      content opens (that's core to how it works) — it does this via
//      onOpenAutoFocus. We used to fight it with a setTimeout(..., 50) that
//      tried to steal focus back onto the search input, but that's a race:
//      on a slower device Radix's own focus move can land *after* the
//      timeout fires and silently pull focus back off the input. From that
//      moment every keystroke lands on the (invisible) highlighted item
//      instead of the box, and it looks like the search field has stopped
//      accepting input entirely — intermittent, and worse on mobile/slower
//      hardware, which is exactly why it was hard to pin down. Using
//      onOpenAutoFocus + preventDefault() intercepts Radix's focus move
//      before it happens instead of racing it after the fact.
// storeId + storeInventory are optional — when a specific store is in play
// (e.g. the "From Store" of a transfer, or the store an adjustment applies
// to), the picker shows THAT store's quantity instead of the all-stores
// combined total, so you can't accidentally try to move/adjust more than
// what's actually sitting on that branch's shelf.
function ProductPicker({ value, onChange, products, showStock, storeId, storeInventory }) {
  var [open, setOpen] = useState(false);
  var [query, setQuery] = useState("");
  var inputRef = useRef(null);

  var filtered = useMemo(
    function () {
      var term = query.trim().toLowerCase();
      if (!term) return products;
      return products.filter(function (p) {
        return (
          String(p.name || "").toLowerCase().indexOf(term) !== -1 ||
          String(p.sku || "").toLowerCase().indexOf(term) !== -1 ||
          String(p.barcode || "").toLowerCase().indexOf(term) !== -1 ||
          String(p.category || "").toLowerCase().indexOf(term) !== -1 ||
          String(p.strain_type || "").toLowerCase().indexOf(term) !== -1
        );
      });
    },
    [products, query]
  );

  // Clear the box on close so the next open starts fresh.
  useEffect(
    function () {
      if (!open) setQuery("");
    },
    [open]
  );

  function stockFor(p) {
    if (storeId && storeInventory) {
      var row = storeInventory.find(function (si) { return si.product_id === p.id && si.store_id === storeId; });
      return row ? (row.stock_quantity || 0) : 0;
    }
    return p.stock_quantity || 0;
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter" && filtered.length === 1) {
      e.preventDefault();
      onChange(filtered[0].id);
      setOpen(false);
      return;
    }
    e.stopPropagation();
  }

  return (
    <Select open={open} onOpenChange={setOpen} value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select product" />
      </SelectTrigger>
      <SelectContent
        className="max-h-72"
        onOpenAutoFocus={function (e) {
          // Stop Radix from moving focus onto the highlighted item, and put
          // it on our search input instead — synchronously, no race.
          e.preventDefault();
          if (inputRef.current) inputRef.current.focus();
        }}
      >
        <div className="sticky top-0 z-10 -mt-1 bg-popover px-2 pt-2 pb-2 border-b border-border">
          <Input
            ref={inputRef}
            value={query}
            onChange={function (e) {
              setQuery(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search name, SKU or strain..."
            className="h-8"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-sm text-muted-foreground text-center">
            No products match "{query}"
          </div>
        ) : (
          filtered.map(function (p) {
            return (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {showStock ? " (stock: " + stockFor(p) + (storeId ? " here" : "") + ")" : ""}
              </SelectItem>
            );
          })
        )}
      </SelectContent>
    </Select>
  );
}

export default function Inventory() {
  var { companyId, activeStoreId: sidebarStoreId } = useCompany();
  var { profile } = useAuth();
  // Prestin-style restricted staff: can receive stock in, nothing else. Set
  // explicitly per-profile via profiles.permissions.stock_add, independent of
  // role, so a manager can still be scoped down to add-only when the account
  // owner asks for exactly that (not a full manager promotion).
  var addOnlyMode = !!(profile && profile.permissions && profile.permissions.stock_add === true);
  var [products, setProducts] = useState([]);
  var [storeInventory, setStoreInventory] = useState([]);
  var [movements, setMovements] = useState([]);
  var [stores, setStores] = useState([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState("");
  var [categoryFilter, setCategoryFilter] = useState("all");

  // ── Store view ────────────────────────────────────────────────────────
  // The sidebar's picker sets the whole app's store. This page needs its own
  // as well, because working through one branch's stock here should not drag
  // the till and every other screen along with it. It starts on whatever the
  // sidebar says and re-syncs whenever that changes; after that the picker at
  // the top of this page wins.
  //
  // "" means all stores combined.
  var [viewStoreId, setViewStoreId] = useState(sidebarStoreId || "");
  useEffect(
    function () {
      setViewStoreId(sidebarStoreId || "");
    },
    [sidebarStoreId]
  );

  // Which product's per-store stock breakdown is open, in the all-stores view.
  var [expandedStock, setExpandedStock] = useState(null);

  // A single-store club has nothing meaningful to choose between, so "All
  // Stores" IS its one store. Without this, Starter clubs (single-store by
  // definition) hit "please select a specific store" on Adjust and Transfer
  // with no way forward, because the store picker has one entry that is
  // already implied. Multi-store clubs are unaffected — they must still pick,
  // since stock has to land somewhere specific.
  var activeStoreId = useMemo(
    function () {
      if (viewStoreId) return viewStoreId;
      if (stores.length === 1) return stores[0].id;
      return null;
    },
    [viewStoreId, stores]
  );
  var isImpliedStore = !viewStoreId && !!activeStoreId;
  var [strainFilter, setStrainFilter] = useState("all");
  var [sortCol, setSortCol] = useState("name");
  var [sortDir, setSortDir] = useState("asc");
  var [showAdjust, setShowAdjust] = useState(false);
  var [selectedProduct, setSelectedProduct] = useState("");
  var [adjustQty, setAdjustQty] = useState(0);
  var [adjustType, setAdjustType] = useState("restock");
  var [adjustNotes, setAdjustNotes] = useState("");
  var [isSaving, setIsSaving] = useState(false);
  var [showTransfer, setShowTransfer] = useState(false);
  var [transfer, setTransfer] = useState({
    product_id: "",
    from_store_id: "",
    to_store_id: "",
    quantity: 1,
    notes: "",
  });
  var [isTransferring, setIsTransferring] = useState(false);

  // Store price editor
  var [priceProduct, setPriceProduct] = useState(null);
  var [priceInput, setPriceInput] = useState("");
  var [costInput, setCostInput] = useState("");
  var [savingPrice, setSavingPrice] = useState(false);

  var storeName = useMemo(
    function () {
      var s = stores.find(function (st) { return st.id === activeStoreId; });
      return s ? s.name : "this store";
    },
    [stores, activeStoreId]
  );

  var load = useCallback(
    async function () {
      if (!companyId) return;
      setLoading(true);
      try {
        var results = await Promise.all([
          fetchAll(function () {
            return supabase
              .from("products")
              .select("*")
              .eq("company_id", companyId)
              .order("created_at", { ascending: false });
          }).then(function (data) { return { data: data, error: null }; }),
          fetchAll(function () {
            return supabase
              .from("store_inventory")
              .select("*")
              .eq("company_id", companyId);
          }).then(function (data) { return { data: data, error: null }; }),
          supabase
            .from("inventory_movements")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("stores")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(100),
        ]);
        setProducts(results[0].data || []);
        setStoreInventory(results[1].data || []);
        setMovements(results[2].data || []);
        setStores((results[3].data || []).filter(function (st) {
          return st.is_active !== false;
        }));
      } catch (err) {
        toast.error("Failed to load inventory");
      } finally {
        setLoading(false);
      }
    },
    [companyId]
  );

  useEffect(function () {
    load();
  }, [load]);

  // Merge products with per-store stock and per-store price.
  //
  // With a store selected, price and cost_price become that branch's numbers,
  // so every figure below — stock value, margin, the CSV — is what this branch
  // actually sells at. _base_price is carried alongside purely so the editor
  // can show what the group price is; nothing calculates off it.
  //
  // _by_store is always built: it powers the expandable stock cell and the
  // per-store summary strip, and costs one pass over an already-loaded array.
  var mergedProducts = useMemo(
    function () {
      // Index the inventory once rather than scanning it per product per store.
      var byKey = {};
      for (var k = 0; k < storeInventory.length; k++) {
        var row = storeInventory[k];
        byKey[row.product_id + "|" + row.store_id] = row;
      }

      return products.map(function (p) {
        var byStore = stores.map(function (s) {
          var r = byKey[p.id + "|" + s.id];
          return {
            store_id: s.id,
            store_name: s.name,
            qty: r ? (r.stock_quantity || 0) : 0,
            has_row: !!r,
            price: resolveStorePrice(p.price, r ? r.price : null),
            price_override: r && hasOverride(r.price) ? Number(r.price) : null,
            low_stock_threshold:
              r && r.low_stock_threshold != null
                ? r.low_stock_threshold
                : (p.low_stock_threshold || 5),
          };
        });

        if (activeStoreId) {
          var inv = byKey[p.id + "|" + activeStoreId] || null;
          return {
            ...p,
            price: resolveStorePrice(p.price, inv ? inv.price : null),
            cost_price: resolveStorePrice(p.cost_price, inv ? inv.cost_price : null),
            _base_price: p.price,
            _base_cost: p.cost_price,
            _price_override: inv && hasOverride(inv.price) ? Number(inv.price) : null,
            _cost_override: inv && hasOverride(inv.cost_price) ? Number(inv.cost_price) : null,
            _by_store: byStore,
            stock_quantity: inv ? inv.stock_quantity : 0,
            _inv_id: inv ? inv.id : null,
          };
        }

        // "All Stores" — sum stock across all stores. Branches may price the
        // same product differently, so there is no single price to show here;
        // the group price stands and overrides are edited per store.
        var totalStock = 0;
        var overrides = 0;
        for (var j = 0; j < byStore.length; j++) {
          totalStock += byStore[j].qty;
          if (byStore[j].price_override !== null) overrides++;
        }
        return {
          ...p,
          _base_price: p.price,
          _base_cost: p.cost_price,
          _price_override: null,
          _cost_override: null,
          _override_store_count: overrides,
          _by_store: byStore,
          stock_quantity: totalStock,
          _inv_id: null,
        };
      });
    },
    [products, storeInventory, stores, activeStoreId]
  );

  var overrideCount = useMemo(
    function () {
      return mergedProducts.filter(function (p) {
        return p._price_override !== null;
      }).length;
    },
    [mergedProducts]
  );

  var stats = useMemo(
    function () {
      return {
        totalValue: mergedProducts.reduce(function (sum, p) {
          return sum + (p.cost_price || 0) * (p.stock_quantity || 0);
        }, 0),
        retailValue: mergedProducts.reduce(function (sum, p) {
          return sum + (p.price || 0) * (p.stock_quantity || 0);
        }, 0),
        outOfStock: mergedProducts.filter(function (p) {
          return (p.stock_quantity || 0) <= 0;
        }).length,
        lowStock: mergedProducts.filter(function (p) {
          return (
            (p.stock_quantity || 0) > 0 &&
            (p.stock_quantity || 0) <= (p.low_stock_threshold || 5)
          );
        }).length,
      };
    },
    [mergedProducts]
  );

  var categories = useMemo(
    function () {
      var cats = {};
      for (var i = 0; i < products.length; i++) {
        if (products[i].category) cats[products[i].category] = true;
      }
      return Object.keys(cats).sort();
    },
    [products]
  );

  // Strain options: the canonical list, plus any legacy value already stored
  // against this company's products so nothing becomes unfilterable.
  var strains = useMemo(
    function () {
      var seen = {};
      for (var i = 0; i < STRAIN_TYPES.length; i++) seen[STRAIN_TYPES[i]] = true;
      for (var j = 0; j < products.length; j++) {
        var s = products[j].strain_type;
        if (s && String(s).trim()) seen[String(s).trim().toLowerCase()] = true;
      }
      return Object.keys(seen).sort();
    },
    [products]
  );

  var untaggedCount = useMemo(
    function () {
      return mergedProducts.filter(function (p) {
        return !p.strain_type || !String(p.strain_type).trim();
      }).length;
    },
    [mergedProducts]
  );

  var filtered = useMemo(
    function () {
      var list = mergedProducts.filter(function (p) {
        var strainVal = p.strain_type ? String(p.strain_type).trim().toLowerCase() : "";
        var matchSearch =
          !search ||
          (p.name && p.name.toLowerCase().indexOf(search.toLowerCase()) >= 0) ||
          (p.sku && p.sku.toLowerCase().indexOf(search.toLowerCase()) >= 0) ||
          (strainVal && strainVal.indexOf(search.toLowerCase()) >= 0);
        var matchStrain =
          strainFilter === "all" ||
          (strainFilter === "untagged" ? !strainVal : strainVal === strainFilter);
        return (
          matchSearch &&
          matchStrain &&
          (categoryFilter === "all" || p.category === categoryFilter)
        );
      });
      return list.slice().sort(function (a, b) {
        var va, vb;
        switch (sortCol) {
          case "name": va = a.name || ""; vb = b.name || ""; break;
          case "category": va = a.category || ""; vb = b.category || ""; break;
          case "strain": va = a.strain_type || ""; vb = b.strain_type || ""; break;
          case "sku": va = a.sku || ""; vb = b.sku || ""; break;
          case "stock": va = a.stock_quantity || 0; vb = b.stock_quantity || 0; break;
          case "price": va = a.price || 0; vb = b.price || 0; break;
          case "cost": va = a.cost_price || 0; vb = b.cost_price || 0; break;
          case "value":
            va = (a.price || 0) * (a.stock_quantity || 0);
            vb = (b.price || 0) * (b.stock_quantity || 0);
            break;
          case "margin":
            va = a.price > 0 ? ((a.price - (a.cost_price || 0)) / a.price) * 100 : 0;
            vb = b.price > 0 ? ((b.price - (b.cost_price || 0)) / b.price) * 100 : 0;
            break;
          default: va = a.name || ""; vb = b.name || "";
        }
        if (typeof va === "string")
          return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        return sortDir === "asc" ? va - vb : vb - va;
      });
    },
    [mergedProducts, search, categoryFilter, strainFilter, sortCol, sortDir]
  );

  // Stock held per store over whatever is currently filtered. Drives the
  // summary strip, so a manager can see where the units sit without opening a
  // single product.
  var stockByStore = useMemo(
    function () {
      return stores.map(function (s) {
        var qty = 0;
        var skus = 0;
        var value = 0;
        for (var i = 0; i < filtered.length; i++) {
          var rows = filtered[i]._by_store || [];
          for (var j = 0; j < rows.length; j++) {
            if (rows[j].store_id !== s.id) continue;
            qty += rows[j].qty;
            if (rows[j].qty > 0) skus++;
            value += rows[j].qty * (rows[j].price || 0);
          }
        }
        return { id: s.id, name: s.name, qty: qty, skus: skus, value: value };
      });
    },
    [stores, filtered]
  );

  var totalFilteredStock = useMemo(
    function () {
      return filtered.reduce(function (s, p) { return s + (p.stock_quantity || 0); }, 0);
    },
    [filtered]
  );

  var toggleSort = function (col) {
    if (sortCol === col) setSortDir(function (d) { return d === "asc" ? "desc" : "asc"; });
    else { setSortCol(col); setSortDir("asc"); }
  };

  var exportCSV = function () {
    // Both prices go out, so a branch export can be read against the group
    // price without opening the app. In the all-stores view every branch gets
    // its own column, because a single summed figure is exactly what people
    // then go and rebuild by hand in Excel.
    var perStore = !activeStoreId && stores.length > 1;
    var headers = ["Name", "SKU", "Category", "Strain Type", "Stock", "Threshold", "Price", "Group Price", "Store Price Set", "Cost Price", "Stock Value", "Retail Value", "Margin %", "Status"];
    if (perStore) {
      for (var s0 = 0; s0 < stores.length; s0++) headers.push("Stock · " + stores[s0].name);
    }
    var rows = filtered.map(function (p) {
      var margin = p.price > 0 ? (((p.price - (p.cost_price || 0)) / p.price) * 100).toFixed(1) : "0.0";
      var status = (p.stock_quantity || 0) <= 0 ? "Out of stock" : (p.stock_quantity || 0) <= (p.low_stock_threshold || 5) ? "Low" : "OK";
      var strain = p.strain_type && String(p.strain_type).trim() ? formatStrain(p.strain_type) : "";
      var row = [p.name, p.sku || "", p.category || "", strain, p.stock_quantity || 0, p.low_stock_threshold || 5, p.price || 0, p._base_price || 0, p._price_override !== null ? "Yes" : "No", p.cost_price || 0, ((p.cost_price || 0) * (p.stock_quantity || 0)).toFixed(2), ((p.price || 0) * (p.stock_quantity || 0)).toFixed(2), margin, status];
      if (perStore) {
        for (var s1 = 0; s1 < stores.length; s1++) {
          var hit = (p._by_store || []).find(function (b) { return b.store_id === stores[s1].id; });
          row.push(hit ? hit.qty : 0);
        }
      }
      return row;
    });
    // Escape embedded quotes so a product name containing " can't break the row.
    var csv = [headers].concat(rows).map(function (r) {
      return r.map(function (v) {
        return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      }).join(",");
    }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    var suffix = activeStoreId ? "_" + storeName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() : "_all-stores";
    a.download = "inventory" + suffix + "_" + new Date().toISOString().split("T")[0] + ".csv";
    a.click();
    toast.success("Inventory exported");
  };

  // ── Store price editor ───────────────────────────────────────────────
  var openPriceDialog = function (p) {
    if (!activeStoreId) return;
    if (addOnlyMode) return; // load-only staff can't touch pricing
    setPriceProduct(p);
    setPriceInput(p._price_override !== null ? String(p._price_override) : "");
    setCostInput(p._cost_override !== null ? String(p._cost_override) : "");
  };

  var closePriceDialog = function () {
    setPriceProduct(null);
    setPriceInput("");
    setCostInput("");
  };

  // Blank means "no special price here" — the row keeps its stock, the price
  // column just goes back to NULL and the group price takes over again. The
  // row is created at zero stock if it doesn't exist yet, because the override
  // has to hang off something; (store_id, product_id) is unique, so there can
  // only ever be one.
  var handleSavePrice = async function () {
    if (!priceProduct || !activeStoreId || addOnlyMode) return;

    var priceRaw = String(priceInput).trim();
    var costRaw = String(costInput).trim();
    var priceVal = priceRaw === "" ? null : Number(priceRaw);
    var costVal = costRaw === "" ? null : Number(costRaw);

    if (priceVal !== null && (isNaN(priceVal) || priceVal < 0)) {
      toast.error("Enter a selling price of 0 or more, or leave it blank to use the group price");
      return;
    }
    if (costVal !== null && (isNaN(costVal) || costVal < 0)) {
      toast.error("Enter a cost price of 0 or more, or leave it blank to use the group cost");
      return;
    }

    setSavingPrice(true);
    try {
      var invRow = null;
      for (var i = 0; i < storeInventory.length; i++) {
        if (
          storeInventory[i].product_id === priceProduct.id &&
          storeInventory[i].store_id === activeStoreId
        ) {
          invRow = storeInventory[i];
          break;
        }
      }

      if (invRow) {
        var upd = await supabase
          .from("store_inventory")
          .update({ price: priceVal, cost_price: costVal, updated_at: new Date().toISOString() })
          .eq("id", invRow.id);
        if (upd.error) throw upd.error;
      } else {
        var ins = await supabase.from("store_inventory").insert({
          company_id: companyId,
          store_id: activeStoreId,
          product_id: priceProduct.id,
          stock_quantity: 0,
          low_stock_threshold: priceProduct.low_stock_threshold || 5,
          price: priceVal,
          cost_price: costVal,
        });
        if (ins.error) throw ins.error;
      }

      if (priceVal === null) {
        toast.success(priceProduct.name + " follows the group price at " + storeName + " again");
      } else {
        toast.success(priceProduct.name + " now sells for " + formatCurrency(priceVal) + " at " + storeName);
      }
      closePriceDialog();
      await load();
    } catch (err) {
      toast.error(err.message || "Couldn't save the store price");
    } finally {
      setSavingPrice(false);
    }
  };

  var handleAdjust = async function () {
    if (!selectedProduct || adjustQty === 0) return;
    if (!activeStoreId) {
      toast.error("Pick a specific store at the top of the page before adjusting stock");
      return;
    }
    // Belt-and-braces: load-only staff can only ever post an increase, no
    // matter what the movement-type dropdown was set to, since the options
    // that decrease stock are already hidden from them in the UI below.
    if (addOnlyMode && adjustType !== "restock" && adjustType !== "return") {
      toast.error("You can only add stock, not adjust or remove it");
      return;
    }
    setIsSaving(true);
    try {
      var product = products.find(function (p) { return p.id === selectedProduct; });
      var change = adjustType === "restock" || adjustType === "return" ? Math.abs(adjustQty) : -Math.abs(adjustQty);

      // Find current store inventory row
      var invRow = null;
      for (var i = 0; i < storeInventory.length; i++) {
        if (storeInventory[i].product_id === selectedProduct && storeInventory[i].store_id === activeStoreId) {
          invRow = storeInventory[i];
          break;
        }
      }

      if (invRow) {
        // Only stock_quantity is touched here. Writing the whole row would
        // wipe any price override sitting on it.
        await supabase
          .from("store_inventory")
          .update({ stock_quantity: (invRow.stock_quantity || 0) + change, updated_at: new Date().toISOString() })
          .eq("id", invRow.id);
      } else {
        await supabase.from("store_inventory").insert({
          company_id: companyId,
          store_id: activeStoreId,
          product_id: selectedProduct,
          stock_quantity: Math.max(0, change),
        });
      }

      // Also update the global products.stock_quantity for backward compat
      await supabase
        .from("products")
        .update({ stock_quantity: (product.stock_quantity || 0) + change })
        .eq("id", selectedProduct);

      await supabase.from("inventory_movements").insert({
        company_id: companyId,
        product_id: selectedProduct,
        product_name: product.name,
        quantity_change: change,
        movement_type: adjustType,
        notes: adjustNotes,
      });

      toast.success("Inventory adjusted at " + storeName);
      setShowAdjust(false);
      setSelectedProduct("");
      setAdjustQty(0);
      setAdjustNotes("");
      await load();
    } catch (err) {
      toast.error(err.message || "Failed to adjust");
    } finally {
      setIsSaving(false);
    }
  };

  var handleTransfer = async function () {
    if (addOnlyMode) return; // load-only staff can't move stock between stores
    var pid = transfer.product_id;
    var fromId = transfer.from_store_id;
    var toId = transfer.to_store_id;
    var qty = transfer.quantity;
    var notes = transfer.notes;
    if (!pid || !fromId || !toId || qty <= 0) return;
    if (fromId === toId) { toast.error("Source and destination must be different"); return; }
    setIsTransferring(true);
    try {
      var product = products.find(function (p) { return p.id === pid; });
      var fromStore = stores.find(function (s) { return s.id === fromId; });
      var toStore = stores.find(function (s) { return s.id === toId; });

      // Deduct from source store_inventory
      var fromInv = null;
      var toInv = null;
      for (var i = 0; i < storeInventory.length; i++) {
        if (storeInventory[i].product_id === pid && storeInventory[i].store_id === fromId) fromInv = storeInventory[i];
        if (storeInventory[i].product_id === pid && storeInventory[i].store_id === toId) toInv = storeInventory[i];
      }

      if (!fromInv || (fromInv.stock_quantity || 0) < qty) {
        toast.error("Not enough stock at " + fromStore.name);
        setIsTransferring(false);
        return;
      }

      // Stock only. Each branch keeps its own price — moving units between
      // them must not move the price with them.
      await supabase
        .from("store_inventory")
        .update({ stock_quantity: fromInv.stock_quantity - qty, updated_at: new Date().toISOString() })
        .eq("id", fromInv.id);

      if (toInv) {
        await supabase
          .from("store_inventory")
          .update({ stock_quantity: (toInv.stock_quantity || 0) + qty, updated_at: new Date().toISOString() })
          .eq("id", toInv.id);
      } else {
        await supabase.from("store_inventory").insert({
          company_id: companyId,
          store_id: toId,
          product_id: pid,
          stock_quantity: qty,
        });
      }

      // Log transfer
      try {
        await supabase.from("stock_transfers").insert({
          company_id: companyId,
          product_id: pid,
          product_name: product.name,
          from_store_id: fromId,
          from_store_name: fromStore.name,
          to_store_id: toId,
          to_store_name: toStore.name,
          quantity: qty,
          status: "completed",
          notes: notes,
        });
      } catch (_) {}

      await supabase.from("inventory_movements").insert([
        {
          company_id: companyId, product_id: pid, product_name: product.name,
          quantity_change: -qty, movement_type: "transfer_out",
          notes: "Transfer out → " + toStore.name + (notes ? " · " + notes : ""),
        },
        {
          company_id: companyId, product_id: pid, product_name: product.name,
          quantity_change: qty, movement_type: "transfer_in",
          notes: "Transfer in ← " + fromStore.name + (notes ? " · " + notes : ""),
        },
      ]);

      toast.success("Transferred " + qty + "x " + product.name + " → " + toStore.name);
      setShowTransfer(false);
      setTransfer({ product_id: "", from_store_id: "", to_store_id: "", quantity: 1, notes: "" });
      await load();
    } catch (err) {
      toast.error(err.message || "Failed to transfer");
    } finally {
      setIsTransferring(false);
    }
  };

  // Open the transfer dialog pre-filled with the branch you're looking at, so
  // "this store is empty" turns into a transfer in one click instead of three.
  var openTransferFor = function (productId, fromStoreId) {
    if (addOnlyMode) return;
    setTransfer({
      product_id: productId || "",
      from_store_id: fromStoreId || "",
      to_store_id: "",
      quantity: 1,
      notes: "",
    });
    setShowTransfer(true);
  };

  var multiStore = stores.length > 1;

  if (loading)
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {mergedProducts.length} products tracked
            {activeStoreId
              ? " · " + storeName + (isImpliedStore ? "" : "")
              : " · all " + stores.length + " stores combined"}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* ── Store picker ──
              Scoped to this page. Stock, prices, the stat cards, the CSV and
              the Adjust dialog all follow it, so stock lands where you're
              looking. The sidebar still sets the app default and this resets
              to it whenever that changes. */}
          {multiStore && (
            <Select
              value={viewStoreId || "__all__"}
              onValueChange={function (v) {
                setViewStoreId(v === "__all__" ? "" : v);
                setExpandedStock(null);
              }}
            >
              <SelectTrigger className={cn("w-[190px]", viewStoreId && "border-primary/60 text-primary")}>
                <span className="flex items-center gap-2 truncate">
                  <Store className="w-4 h-4 shrink-0" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Stores ({stores.length})</SelectItem>
                {stores.map(function (s) {
                  return <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={exportCSV} className="gap-2">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          {!addOnlyMode && (
            <Button variant="outline" onClick={function () { openTransferFor("", activeStoreId || ""); }} className="gap-2">
              <ArrowRight className="w-4 h-4" /> Transfer Stock
            </Button>
          )}
          <Button onClick={function () { setShowAdjust(true); }} className="gap-2">
            <ArrowUpDown className="w-4 h-4" /> {addOnlyMode ? "Load Stock" : "Adjust Stock"}
          </Button>
        </div>
      </div>

      {/* Stock per store at a glance, over the current filters. Also a
          one-click switch into a branch, which is what most people want after
          seeing a number they don't like. */}
      {multiStore && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={function () { setViewStoreId(""); setExpandedStock(null); }}
            className={cn(
              "rounded-xl border px-4 py-2.5 text-left transition-colors min-w-[150px]",
              !viewStoreId ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
            )}
          >
            <div className="text-xs text-muted-foreground">All Stores</div>
            <div className="text-base font-bold">{totalFilteredStock} units</div>
            <div className="text-[10px] text-muted-foreground">{filtered.length} products listed</div>
          </button>
          {stockByStore.map(function (s) {
            return (
              <button
                key={s.id}
                type="button"
                onClick={function () { setViewStoreId(s.id); setExpandedStock(null); }}
                className={cn(
                  "rounded-xl border px-4 py-2.5 text-left transition-colors min-w-[150px]",
                  viewStoreId === s.id ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
                )}
              >
                <div className="text-xs text-muted-foreground truncate max-w-[170px]">{s.name}</div>
                <div className="text-base font-bold">{s.qty} units</div>
                <div className="text-[10px] text-muted-foreground">
                  {s.skus} stocked · {formatCurrency(s.value)}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Cost Value", value: formatCurrency(stats.totalValue), sub: activeStoreId ? "at " + storeName : "at cost price, all stores", color: "text-primary" },
          { label: "Retail Value", value: formatCurrency(stats.retailValue), sub: activeStoreId ? "at this store's prices" : "at group prices, all stores", color: "text-green-500" },
          { label: "Out of Stock", value: stats.outOfStock, sub: activeStoreId ? "products at " + storeName : "products everywhere", color: "text-red-500" },
          { label: "Low Stock", value: stats.lowStock, sub: "products", color: "text-yellow-500" },
        ].map(function (c) {
          return (
            <div key={c.label} className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
              <p className={cn("text-xl font-bold", c.color)}>{c.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
            </div>
          );
        })}
      </div>

      {(stats.outOfStock > 0 || stats.lowStock > 0) && (
        <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0" />
          <p className="text-sm font-medium">
            {stats.outOfStock > 0 && stats.outOfStock + " out of stock"}
            {stats.outOfStock > 0 && stats.lowStock > 0 && " · "}
            {stats.lowStock > 0 && stats.lowStock + " low stock"}
            {activeStoreId ? <span className="font-normal text-muted-foreground"> at {storeName}</span> : null}
          </p>
        </div>
      )}

      {/* Per-store pricing. Only shown with a specific store selected, because
          that is the only view where a single price is the right answer.
          Load-only staff don't get this callout — they can't act on it. */}
      {activeStoreId && !addOnlyMode && (
        <div className="flex items-start gap-3 p-4 bg-muted/40 border border-border rounded-xl">
          <Tag className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Prices shown are <span className="font-medium text-foreground">{storeName}</span>'s.
            Tap any price to give this branch its own — leave it blank and it follows the group price.
            {overrideCount > 0
              ? " " + overrideCount + (overrideCount === 1 ? " product has" : " products have") + " a price set here."
              : " No products are priced differently here yet."}
          </p>
        </div>
      )}

      {!activeStoreId && multiStore && (
        <div className="flex items-start gap-3 p-4 bg-muted/40 border border-border rounded-xl">
          <Store className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Stock is added up across all {stores.length} stores, at group prices. Pick a store above
            to work on one branch — or click a stock figure to see the split per branch.
          </p>
        </div>
      )}

      {untaggedCount > 0 && (
        <button
          type="button"
          onClick={function () { setStrainFilter("untagged"); }}
          className="w-full flex items-center gap-3 p-4 bg-muted/40 border border-border rounded-xl text-left hover:bg-muted/60 transition-colors"
        >
          <AlertTriangle className="w-5 h-5 text-muted-foreground shrink-0" />
          <p className="text-sm">
            <span className="font-medium">{untaggedCount}</span>
            <span className="text-muted-foreground">
              {untaggedCount === 1 ? " product has" : " products have"} no strain type set — tap to review
            </span>
          </p>
        </button>
      )}

      <div className="flex gap-3 flex-wrap">
        <Input placeholder="Search products, SKU or strain..." value={search} onChange={function (e) { setSearch(e.target.value); }} className="max-w-xs" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(function (c) {
              return <SelectItem key={c} value={c} className="capitalize">{c.replace(/_/g, " ")}</SelectItem>;
            })}
          </SelectContent>
        </Select>
        <Select value={strainFilter} onValueChange={setStrainFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All strains" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All strains</SelectItem>
            {strains.map(function (s) {
              return <SelectItem key={s} value={s}>{formatStrain(s)}</SelectItem>;
            })}
            <SelectItem value="untagged">Not set</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {[
                  { key: "name", label: "Product", align: "left" },
                  { key: "sku", label: "SKU", align: "left" },
                  { key: "category", label: "Category", align: "left" },
                  { key: "strain", label: "Strain", align: "left" },
                  { key: "stock", label: activeStoreId ? "Stock · " + storeName : "Stock · all stores", align: "right" },
                  { key: "price", label: "Price", align: "right" },
                  { key: "cost", label: "Cost", align: "right" },
                  { key: "value", label: "Stock Value", align: "right" },
                  { key: "margin", label: "Margin %", align: "right" },
                  { key: "status", label: "Status", align: "right" },
                ].map(function (col) {
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        "p-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none whitespace-nowrap",
                        col.align === "right" ? "text-right" : "text-left"
                      )}
                      onClick={function () {
                        if (col.key !== "status") toggleSort(col.key);
                      }}
                    >
                      {col.label}
                      {col.key !== "status" && <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-sm text-muted-foreground">No products found</td>
                </tr>
              ) : (
                filtered.map(function (p) {
                  var stockVal = (p.price || 0) * (p.stock_quantity || 0);
                  var margin = p.price > 0 ? ((p.price - (p.cost_price || 0)) / p.price) * 100 : 0;
                  var isOut = (p.stock_quantity || 0) <= 0;
                  var isLow = !isOut && (p.stock_quantity || 0) <= (p.low_stock_threshold || 5);
                  var hasStrain = p.strain_type && String(p.strain_type).trim();
                  var isOverridden = p._price_override !== null;
                  var canExpand = !activeStoreId && multiStore;
                  var isExpanded = expandedStock === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-3 font-medium">{p.name}</td>
                        <td className="p-3 text-muted-foreground font-mono text-xs">{p.sku || "—"}</td>
                        <td className="p-3 text-muted-foreground capitalize">{p.category ? p.category.replace(/_/g, " ") : "—"}</td>
                        <td className="p-3">
                          {hasStrain ? (
                            <span className={cn("text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap", strainClasses(p.strain_type))}>
                              {formatStrain(p.strain_type)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right font-semibold">
                          {canExpand ? (
                            <button
                              type="button"
                              onClick={function () { setExpandedStock(isExpanded ? null : p.id); }}
                              title="Show stock per store"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 -mr-1.5 rounded-md hover:bg-muted transition-colors"
                            >
                              {isExpanded
                                ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                              {p.stock_quantity || 0}
                            </button>
                          ) : (
                            p.stock_quantity || 0
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {activeStoreId && !addOnlyMode ? (
                            <button
                              type="button"
                              onClick={function () { openPriceDialog(p); }}
                              title={"Set " + storeName + "'s price for " + p.name}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-2 py-1 -mr-2 rounded-md hover:bg-muted transition-colors",
                                isOverridden ? "font-semibold text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {formatCurrency(p.price || 0)}
                              {isOverridden && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary whitespace-nowrap">
                                  {storeName}
                                </span>
                              )}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">
                              {formatCurrency(p.price || 0)}
                              {!activeStoreId && p._override_store_count > 0 && (
                                <span
                                  className="block text-[10px] text-muted-foreground"
                                  title="Some branches price this differently"
                                >
                                  {p._override_store_count} store{p._override_store_count === 1 ? "" : "s"} differ
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right text-muted-foreground">{formatCurrency(p.cost_price || 0)}</td>
                        <td className="p-3 text-right font-semibold">{formatCurrency(stockVal)}</td>
                        <td className={cn("p-3 text-right font-semibold", margin >= 40 ? "text-green-500" : margin >= 20 ? "text-yellow-500" : "text-red-500")}>
                          {margin.toFixed(1)}%
                        </td>
                        <td className="p-3 text-right">
                          <span className={cn("text-xs px-2 py-1 rounded-full font-medium", isOut ? "bg-red-500/10 text-red-500" : isLow ? "bg-yellow-500/10 text-yellow-500" : "bg-green-500/10 text-green-500")}>
                            {isOut ? "Out of stock" : isLow ? "Low" : "OK"}
                          </span>
                        </td>
                      </tr>

                      {/* Per-store split for this one product. Only reachable
                          from the all-stores view, where the single figure
                          otherwise hides which branch is actually empty. */}
                      {canExpand && isExpanded && (
                        <tr className="border-b border-border/50 bg-muted/20">
                          <td colSpan={10} className="p-3">
                            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Store className="w-3 h-3" /> {p.name} — stock per store
                              </div>
                              {!addOnlyMode && (
                                <button
                                  type="button"
                                  className="text-xs text-primary hover:underline"
                                  onClick={function () { openTransferFor(p.id, ""); }}
                                >
                                  Move this between stores
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(p._by_store || []).map(function (b) {
                                var bOut = b.qty <= 0;
                                var bLow = !bOut && b.qty <= (b.low_stock_threshold || 5);
                                return (
                                  <button
                                    key={b.store_id}
                                    type="button"
                                    onClick={function () { setViewStoreId(b.store_id); setExpandedStock(null); }}
                                    title={"Switch to " + b.store_name}
                                    className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:border-primary/60 transition-colors min-w-[150px]"
                                  >
                                    <div className="text-xs text-muted-foreground truncate max-w-[170px]">{b.store_name}</div>
                                    <div className={cn("text-sm font-bold", bOut ? "text-red-500" : bLow ? "text-yellow-500" : "")}>
                                      {b.qty}
                                      {bOut ? " · out" : bLow ? " · low" : ""}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      {formatCurrency(b.price || 0)}
                                      {b.price_override !== null && <span className="text-primary"> · own price</span>}
                                    </div>
                                  </button>
                                );
                              })}
                              {(p._by_store || []).length === 0 && (
                                <span className="text-xs text-muted-foreground">No stores set up yet.</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-muted/30">
                  <td colSpan={4} className="p-3 text-xs font-semibold text-muted-foreground">
                    {filtered.length} products
                    {activeStoreId ? <span className="font-normal"> · {storeName}</span> : null}
                  </td>
                  <td className="p-3 text-right text-xs font-semibold">{totalFilteredStock}</td>
                  <td colSpan={2} />
                  <td className="p-3 text-right text-xs font-semibold text-primary">
                    {formatCurrency(filtered.reduce(function (s, p) { return s + (p.price || 0) * (p.stock_quantity || 0); }, 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold mb-4">Recent Movements</h3>
        <div className="space-y-2">
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No movements yet</p>
          ) : (
            movements.map(function (m) {
              return (
                <div key={m.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div>
                    <p className="text-sm font-medium">{m.product_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(m.created_at).toLocaleDateString()} · {m.notes || m.movement_type}
                    </p>
                  </div>
                  <span className={cn("text-sm font-semibold", m.quantity_change > 0 ? "text-green-500" : "text-red-500")}>
                    {m.quantity_change > 0 ? "+" : ""}{m.quantity_change}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Store price dialog — never opens in add-only mode (openPriceDialog
          bails out before setting priceProduct), so nothing extra needed here. */}
      <Dialog open={!!priceProduct} onOpenChange={function (open) { if (!open) closePriceDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-primary" />
              {priceProduct ? priceProduct.name : "Store price"}
            </DialogTitle>
          </DialogHeader>
          {priceProduct && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/50 border border-border rounded-lg text-xs text-muted-foreground">
                Setting the price at <span className="font-medium text-foreground">{storeName}</span>
                {isImpliedStore ? " (your only store)" : ""}. Other branches keep the group price of{" "}
                <span className="font-medium text-foreground">{formatCurrency(priceProduct._base_price || 0)}</span>.
              </div>

              <div>
                <Label>Selling price at {storeName}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={priceInput}
                  onChange={function (e) { setPriceInput(e.target.value); }}
                  placeholder={"Group price — " + formatCurrency(priceProduct._base_price || 0)}
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Leave blank to follow the group price.
                </p>
              </div>

              <div>
                <Label>Cost price at {storeName}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={costInput}
                  onChange={function (e) { setCostInput(e.target.value); }}
                  placeholder={"Group cost — " + formatCurrency(priceProduct._base_cost || 0)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Only needed if this branch buys it at a different price.
                </p>
              </div>

              {priceProduct._price_override !== null && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={function () { setPriceInput(""); setCostInput(""); }}
                  disabled={savingPrice}
                >
                  Clear both and follow the group price
                </button>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={closePriceDialog} disabled={savingPrice}>
                  Cancel
                </Button>
                <Button className="flex-1" onClick={handleSavePrice} disabled={savingPrice}>
                  {savingPrice ? "Saving..." : "Save price"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Transfer dialog — button that opens it is hidden in add-only mode,
          and handleTransfer bails out too, as a second line of defence. */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Transfer Stock</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Product</Label>
              <ProductPicker
                value={transfer.product_id}
                onChange={function (v) { setTransfer(function (p) { return { ...p, product_id: v }; }); }}
                products={mergedProducts}
                showStock
                storeId={transfer.from_store_id}
                storeInventory={storeInventory}
              />
            </div>
            <div>
              <Label>From Store</Label>
              <Select value={transfer.from_store_id} onValueChange={function (v) { setTransfer(function (p) { return { ...p, from_store_id: v }; }); }}>
                <SelectTrigger><SelectValue placeholder="Source store" /></SelectTrigger>
                <SelectContent>{stores.map(function (s) { return <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>; })}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>To Store</Label>
              <Select value={transfer.to_store_id} onValueChange={function (v) { setTransfer(function (p) { return { ...p, to_store_id: v }; }); }}>
                <SelectTrigger><SelectValue placeholder="Destination store" /></SelectTrigger>
                <SelectContent>
                  {stores.filter(function (s) { return s.id !== transfer.from_store_id; }).map(function (s) {
                    return <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" min={1} value={transfer.quantity} onChange={function (e) { setTransfer(function (p) { return { ...p, quantity: Number(e.target.value) }; }); }} />
              {transfer.product_id && transfer.from_store_id && (function () {
                var row = storeInventory.find(function (si) { return si.product_id === transfer.product_id && si.store_id === transfer.from_store_id; });
                var available = row ? (row.stock_quantity || 0) : 0;
                var fromName = (stores.find(function (s) { return s.id === transfer.from_store_id; }) || {}).name || "this store";
                return (
                  <p className={"text-[11px] mt-1 " + (transfer.quantity > available ? "text-red-400" : "text-muted-foreground")}>
                    Available at {fromName}: {available}
                  </p>
                );
              })()}
            </div>
            <div><Label>Notes</Label><Input value={transfer.notes} onChange={function (e) { setTransfer(function (p) { return { ...p, notes: e.target.value }; }); }} placeholder="Optional" /></div>
            <p className="text-[11px] text-muted-foreground">
              Stock moves, prices don't — each branch keeps whatever price it has set.
            </p>
            <Button onClick={handleTransfer} disabled={!transfer.product_id || !transfer.from_store_id || !transfer.to_store_id || transfer.quantity <= 0 || isTransferring} className="w-full gap-2">
              <ArrowRight className="w-4 h-4" />{isTransferring ? "Transferring..." : "Transfer Stock"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Adjust dialog. In add-only mode the Movement Type field is skipped
          entirely (adjustType stays "restock", set once at the top) rather
          than shown as a single-option dropdown — there's nothing to choose
          if there's only one legitimate option, so a picker just adds a step
          for no reason. */}
      <Dialog open={showAdjust} onOpenChange={setShowAdjust}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{addOnlyMode ? "Load Stock" : "Adjust Stock"}</DialogTitle></DialogHeader>
          {!activeStoreId ? (
            <div className="space-y-3">
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-500">
                You have more than one store. Pick the branch this stock belongs to, so it lands in the right place.
              </div>
              <div>
                <Label>Store</Label>
                <Select value="" onValueChange={function (v) { setViewStoreId(v); setExpandedStock(null); }}>
                  <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>
                    {stores.map(function (s) { return <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>; })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-muted/50 border border-border rounded-lg text-xs text-muted-foreground">
              {addOnlyMode ? "Loading stock in at " : "Adjusting stock at "}
              <span className="font-medium text-foreground">{storeName}</span>
              {isImpliedStore ? " (your only store)" : ""}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <Label>Product</Label>
              <ProductPicker
                value={selectedProduct}
                onChange={setSelectedProduct}
                products={mergedProducts}
                showStock
                storeId={activeStoreId || ""}
                storeInventory={storeInventory}
              />
            </div>
            {!addOnlyMode && (
              <div>
                <Label>Movement Type</Label>
                <Select value={adjustType} onValueChange={setAdjustType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restock">Restock (+)</SelectItem>
                    <SelectItem value="adjustment">Adjustment (-)</SelectItem>
                    <SelectItem value="damage">Damage (-)</SelectItem>
                    <SelectItem value="return">Return (+)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Quantity</Label><Input type="number" min={1} value={adjustQty} onChange={function (e) { setAdjustQty(Number(e.target.value)); }} /></div>
            <div><Label>Notes</Label><Input value={adjustNotes} onChange={function (e) { setAdjustNotes(e.target.value); }} placeholder="Optional reason" /></div>
            <Button onClick={handleAdjust} disabled={!selectedProduct || adjustQty === 0 || isSaving || !activeStoreId} className="w-full">
              {isSaving ? "Saving..." : addOnlyMode ? "Add Stock" : "Apply Adjustment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
