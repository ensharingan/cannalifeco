import { cn } from "@/lib/utils";
import { Package, Scale } from "lucide-react";
import { formatCurrency } from "../../lib/currency";
const categoryIcons = {
  flower: "🌿", edibles: "🍪", oils: "💧", concentrates: "🔥",
  pre_rolls: "🚬", "pre-roll": "🚬", accessories: "🔧", beverages: "🥤",
  topicals: "✨", hash_slab: "🔥", vape: "💨", tincture: "💧",
  gummies: "🍬", bundle: "🎁", other: "📦",
};
export default function ProductGrid({ products, onSelect, searchTerm, selectedCategory, allowNegative }) {
  const filtered = products.filter(function (p) {
    if (p.is_active === false) return false;
    if (selectedCategory) {
      var cat = (p.category || "").toLowerCase().replace(/-/g, "_").replace(/ /g, "_");
      if (cat !== selectedCategory) return false;
    }
    if (searchTerm) {
      // Match on name, SKU or barcode. Scanners type the code straight into
      // the search box, so a name-only match hid every product on a scan.
      var q = searchTerm.trim().toLowerCase();
      var name = (p.name || "").toLowerCase();
      var sku = String(p.sku || "").toLowerCase();
      var barcode = String(p.barcode || "").toLowerCase();
      if (name.indexOf(q) === -1 && sku !== q && barcode !== q) return false;
    }
    return true;
  });
  if (!filtered.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Package className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm">No products found</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {filtered.map(function (product) {
        var hasTiers = product.price_tiers && product.price_tiers.length > 0;
        var isFlower = (product.category || "").toLowerCase() === "flower";
        // Out of stock only blocks the sale when the company doesn't allow overselling.
        var soldOut = product.stock_quantity <= 0;
        var blocked = soldOut && !allowNegative;
        return (
          <button
            key={product.id}
            onClick={function () { onSelect(product); }}
            disabled={blocked}
            className={cn(
              "flex flex-col items-center p-4 rounded-xl border transition-all duration-200 text-center relative",
              "hover:shadow-md hover:border-primary/30 hover:scale-[1.02] active:scale-[0.98]",
              blocked
                ? "opacity-40 cursor-not-allowed bg-muted"
                : soldOut
                  ? "bg-card border-red-500/30 cursor-pointer"
                  : "bg-card border-border cursor-pointer"
            )}
          >
            {/* Tier indicator badge */}
            {hasTiers && (
              <span className="absolute top-2 right-2 flex items-center gap-0.5 bg-green-100 text-green-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                <Scale className="w-3 h-3" />
                {product.price_tiers.length + 1}
              </span>
            )}
            <span className="text-2xl mb-2">{categoryIcons[product.category] || "📦"}</span>
            <p className="text-sm font-medium line-clamp-2 mb-1">{product.name}</p>
            {/* Show base price label */}
            <p className="text-xs text-muted-foreground mb-0.5">
              {isFlower && hasTiers ? "from" : "RSP"}
            </p>
            <p className="text-lg font-bold text-primary">{formatCurrency(product.price)}</p>
            {/* Show tier previews for flower */}
            {hasTiers && (
              <div className="flex flex-wrap gap-1 mt-1 justify-center">
                {product.price_tiers.slice(0, 3).map(function (tier, i) {
                  return (
                    <span key={i} className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded">
                      {tier.grams}g {formatCurrency(tier.price)}
                    </span>
                  );
                })}
              </div>
            )}
            <p className={cn(
              "text-xs mt-1",
              product.stock_quantity <= 5 ? "text-red-500" : "text-muted-foreground"
            )}>
              {product.stock_quantity}{isFlower ? "g" : ""} in stock
            </p>
          </button>
        );
      })}
    </div>
  );
}
