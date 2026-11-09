// Tidy product_group labels for the POS browse tiles. The data is free text and
// messy ("G House" / "Green House", "Hydro" / "Hydro Pre", typos), so we map the
// known variants to one label and let anything unknown through unchanged.
var MAP = {
  "g house": "Green House", "green house": "Green House", "greenhouse": "Green House",
  "hydro pre": "Hydro", "indoor pre": "Indoor",
  "anton (aa)": "Anton (AA)", "anton pre (aa)": "Anton (AA)", "anton": "Anton (AA)",
  "accesories": "Accessories", "drinks": "Drink", "oils": "Oils & Tinctures",
  "cbd products": "CBD", "medicinals +": "Medicinals", "bath salt & soap": "Bath Bombs & Soaps",
};

export function normCat(raw) {
  return raw ? String(raw).toLowerCase().replace(/-/g, "_").replace(/ /g, "_") : "";
}

// Group label for a product within its category. Empty / duplicate-of-the-category
// groups come back as "Other".
export function groupOf(p) {
  var g = String(p.product_group || "").trim();
  if (!g) return "Other";
  var low = g.toLowerCase();
  var cat = String(p.category || "").toLowerCase().replace(/_/g, " ");
  var catPlain = cat.replace(/s$/, "");
  if (low === cat || low === catPlain || low === cat + "s" || low.replace(/-/g, " ") === cat) return "Other";
  return MAP[low] || g;
}

// Groups present in a category: [{ key, count }], biggest first, "Other" last.
export function groupsIn(products, catKey) {
  var counts = {};
  products.forEach(function (p) {
    if (p.is_active === false) return;
    if (normCat(p.category) !== catKey) return;
    var g = groupOf(p);
    counts[g] = (counts[g] || 0) + 1;
  });
  return Object.keys(counts).map(function (k) { return { key: k, count: counts[k] }; })
    .sort(function (a, b) {
      if (a.key === "Other") return 1;
      if (b.key === "Other") return -1;
      return b.count - a.count;
    });
}
