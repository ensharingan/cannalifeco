import { AlertTriangle } from "lucide-react";

export default function LowStockAlert({ products }) {
  const lowStock = products?.filter(p => p.stock_quantity <= (p.low_stock_threshold || 5)) || [];

  if (!lowStock.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold mb-4">Inventory Alerts</h3>
        <p className="text-sm text-muted-foreground text-center py-8">All stock levels are healthy</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-yellow-500" />
        <h3 className="text-sm font-semibold">Low Stock Alerts</h3>
        <span className="text-xs bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded-full ml-auto">
          {lowStock.length} items
        </span>
      </div>
      <div className="space-y-2">
        {lowStock.slice(0, 5).map((p) => (
          <div key={p.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
            <div>
              <p className="text-sm font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{p.category}</p>
            </div>
            <span className="text-sm font-bold text-red-500">{p.stock_quantity} left</span>
          </div>
        ))}
      </div>
    </div>
  );
}