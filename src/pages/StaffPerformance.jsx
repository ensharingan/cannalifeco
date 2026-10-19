import { useState, useEffect } from "react";
import { entities } from '@/api/entities';
import { useCompany } from "../lib/CompanyContext";
import { formatCurrency } from "../lib/currency";
import { Users, TrendingUp, ShoppingCart, Star, Award, DollarSign } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { cn } from "@/lib/utils";

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

export default function StaffPerformance() {
  const { companyId } = useCompany();
  const [orders, setOrders] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      entities.Order.filter({ company_id: companyId, status: "completed" }, "-created_at", 2000),
      entities.CashierSession.filter({ company_id: companyId }, "-created_at", 500),
    ]).then(([o, s]) => {
      setOrders(o);
      setSessions(s);
    }).finally(() => setLoading(false));
  }, [companyId]);

  const filterByPeriod = (items) => {
    const now = new Date();
    if (period === "today") return items.filter(o => new Date(o.created_at).toDateString() === now.toDateString());
    if (period === "week") {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return items.filter(o => new Date(o.created_at) >= weekAgo);
    }
    if (period === "month") return items.filter(o => {
      const d = new Date(o.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    return items;
  };

  const filteredOrders = filterByPeriod(orders);

  // Group by staff (created_by = email)
  const staffMap = {};
  filteredOrders.forEach(order => {
    const staff = order.created_by || "Unknown";
    if (!staffMap[staff]) {
      staffMap[staff] = {
        email: staff,
        name: staff.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        totalSales: 0,
        orderCount: 0,
        itemsSold: 0,
      };
    }
    staffMap[staff].totalSales += order.total_amount || 0;
    staffMap[staff].orderCount += 1;
    try {
      const items = JSON.parse(order.items || "[]");
      staffMap[staff].itemsSold += items.reduce((s, i) => s + (i.quantity || 0), 0);
    } catch (_) {}
  });

  const staffList = Object.values(staffMap)
    .map(s => ({ ...s, avgOrderValue: s.orderCount > 0 ? s.totalSales / s.orderCount : 0 }))
    .sort((a, b) => b.totalSales - a.totalSales);

  // Shift count per staff
  const shiftMap = {};
  sessions.forEach(s => {
    const key = s.cashier_name || s.cashier_id || "Unknown";
    shiftMap[key] = (shiftMap[key] || 0) + 1;
  });

  const totalRevenue = filteredOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
  const topPerformer = staffList[0];

  const chartData = staffList.slice(0, 8).map(s => ({
    name: s.name.split(" ")[0],
    sales: Math.round(s.totalSales),
    orders: s.orderCount,
  }));

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Staff Performance</h1>
        <p className="text-sm text-muted-foreground">Track individual sales performance and reward top team members</p>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 flex-wrap">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all",
              period === p.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}>
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 flex gap-4 items-start">
          <div className="p-2.5 rounded-lg bg-primary/10"><Users className="w-5 h-5 text-primary" /></div>
          <div>
            <p className="text-sm text-muted-foreground">Active Staff</p>
            <p className="text-2xl font-bold">{staffList.length}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 flex gap-4 items-start">
          <div className="p-2.5 rounded-lg bg-green-500/10"><DollarSign className="w-5 h-5 text-green-500" /></div>
          <div>
            <p className="text-sm text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-bold">{formatCurrency(totalRevenue)}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 flex gap-4 items-start">
          <div className="p-2.5 rounded-lg bg-yellow-500/10"><Award className="w-5 h-5 text-yellow-500" /></div>
          <div>
            <p className="text-sm text-muted-foreground">Top Performer</p>
            <p className="text-xl font-bold truncate">{topPerformer?.name?.split(" ")[0] || "—"}</p>
            <p className="text-xs text-muted-foreground">{topPerformer ? formatCurrency(topPerformer.totalSales) : ""}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 flex gap-4 items-start">
          <div className="p-2.5 rounded-lg bg-blue-500/10"><ShoppingCart className="w-5 h-5 text-blue-500" /></div>
          <div>
            <p className="text-sm text-muted-foreground">Total Orders</p>
            <p className="text-2xl font-bold">{filteredOrders.length}</p>
          </div>
        </div>
      </div>

      {/* Sales by Staff Chart */}
      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Sales by Staff Member</h2>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barCategoryGap="30%">
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v) => [`${v.toLocaleString()}`, "Sales"]}
              />
              <Bar dataKey="sales" radius={[6, 6, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? "hsl(var(--primary))" : `hsl(var(--chart-${(i % 5) + 1}))`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Staff Leaderboard */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Star className="w-5 h-5 text-yellow-500" />
          <h2 className="font-semibold">Staff Leaderboard</h2>
        </div>
        {staffList.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">No sales data for this period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase">
                  <th className="text-left pb-2 pr-4">Rank</th>
                  <th className="text-left pb-2 pr-4">Staff Member</th>
                  <th className="text-right pb-2 px-4">Total Sales</th>
                  <th className="text-right pb-2 px-4">Orders</th>
                  <th className="text-right pb-2 px-4">Items Sold</th>
                  <th className="text-right pb-2 px-4">Avg Order</th>
                  <th className="text-right pb-2 pl-4">Performance</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((staff, i) => {
                  const pct = totalRevenue > 0 ? (staff.totalSales / totalRevenue) * 100 : 0;
                  return (
                    <tr key={staff.email} className="border-b border-border/50 last:border-0">
                      <td className="py-3 pr-4">
                        <span className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                          i === 0 ? "bg-yellow-500/20 text-yellow-400" :
                          i === 1 ? "bg-slate-400/20 text-slate-400" :
                          i === 2 ? "bg-orange-600/20 text-orange-400" : "bg-muted text-muted-foreground"
                        )}>
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <p className="font-medium">{staff.name}</p>
                        <p className="text-xs text-muted-foreground">{staff.email}</p>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-primary">{formatCurrency(staff.totalSales)}</td>
                      <td className="py-3 px-4 text-right">{staff.orderCount}</td>
                      <td className="py-3 px-4 text-right">{staff.itemsSold}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(staff.avgOrderValue)}</td>
                      <td className="py-3 pl-4">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
