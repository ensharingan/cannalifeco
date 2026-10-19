import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function RevenueChart({ data }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold mb-4">Revenue Overview</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(152, 55%, 28%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(152, 55%, 28%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(150, 10%, 88%)" opacity={0.3} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(160, 8%, 45%)" />
            <YAxis tick={{ fontSize: 12 }} stroke="hsl(160, 8%, 45%)" />
            <Tooltip
              contentStyle={{
                background: "hsl(0, 0%, 100%)",
                border: "1px solid hsl(150, 10%, 88%)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Area type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(152, 55%, 28%)" strokeWidth={2} fill="url(#revenueGradient)" />
            <Area type="monotone" dataKey="expenses" name="Expenses" stroke="hsl(0, 72%, 51%)" strokeWidth={2} fill="url(#expenseGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}