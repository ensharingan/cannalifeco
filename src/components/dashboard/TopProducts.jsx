import { Package } from "lucide-react";
import { formatCurrency } from "../../lib/currency";

export default function TopProducts({ orders }) {
  // Aggregate product sales from order items
  const productMap = {};
  for (const order of orders) {
    if (order.status !== "completed" || !order.items) continue;
    const items = JSON.parse(order.items);
    for (const item of items) {
      if (!productMap[item.product_id]) {
        productMap[item.product_id] = { name: item.name, qty: 0, revenue: 0 };
      }
      productMap[item.product_id].qty += item.quantity;
      productMap[item.product_id].revenue += item.price * item.quantity;
    }
  }
  const top = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  const maxRev = top[0]?.revenue || 1;

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold mb-4">Top Selling Products</h3>
      {top.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Package className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-sm">No sales data yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {top.map((p, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium truncate max-w-[60%]">{p.name}</span>
                <span className="text-muted-foreground">{p.qty} units · {formatCurrency(p.revenue)}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${(p.revenue / maxRev) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}