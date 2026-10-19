import { Tag, Zap } from "lucide-react";

const TYPE_LABELS = {
  percentage_discount: (p) => `${p.discount_value}% OFF`,
  fixed_discount: (p) => `${p.discount_value} OFF`,
  buy_x_get_y: (p) => `Buy ${p.buy_quantity} Get ${p.get_quantity} Free`,
  bundle: (p) => `Bundle Deal — ${p.discount_value}% OFF`,
  free_item: (p) => `Free: ${p.free_product_name || "item"}`,
};

const TYPE_COLORS = {
  percentage_discount: "bg-green-500/10 text-green-700 border-green-500/30",
  fixed_discount: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  buy_x_get_y: "bg-purple-500/10 text-purple-700 border-purple-500/30",
  bundle: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  free_item: "bg-pink-500/10 text-pink-700 border-pink-500/30",
};

export default function PromotionsBanner({ promotions }) {
  const active = promotions.filter(p => p.is_active);
  if (!active.length) return null;

  return (
    <div className="px-4 py-2 border-b border-border bg-muted/20">
      <div className="flex items-center gap-2 mb-1.5">
        <Zap className="w-3.5 h-3.5 text-yellow-500" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Active Promotions</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {active.map(p => (
          <div key={p.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${TYPE_COLORS[p.promo_type] || "bg-muted text-muted-foreground border-border"}`}>
            <Tag className="w-3 h-3" />
            <span>{p.name}</span>
            <span className="opacity-70">— {TYPE_LABELS[p.promo_type]?.(p) || p.promo_type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}