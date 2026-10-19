import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "../../lib/currency";


const statusColors = {
  completed: "bg-green-500/10 text-green-500 border-green-500/20",
  pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  cancelled: "bg-red-500/10 text-red-500 border-red-500/20",
  refunded: "bg-blue-500/10 text-blue-500 border-blue-500/20",
};

export default function RecentOrders({ orders }) {
  if (!orders?.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold mb-4">Recent Orders</h3>
        <p className="text-sm text-muted-foreground text-center py-8">No orders yet</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold mb-4">Recent Orders</h3>
      <div className="space-y-3">
        {orders.map((order) => (
          <div key={order.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
            <div>
              <p className="text-sm font-medium">{order.member_name || "Walk-in"}</p>
             <p className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleDateString('en-ZA')}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-1 rounded-full border ${statusColors[order.status] || ""}`}>
                {order.status}
              </span>
              <span className="text-sm font-semibold">{formatCurrency(order.total_amount)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
