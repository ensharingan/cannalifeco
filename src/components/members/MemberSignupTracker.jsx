import { useState, useEffect } from "react";
import { supabase } from '@/api/supabaseClient';
import { useCompany } from "@/lib/CompanyContext";
import { formatCurrency } from "../../lib/currency";
import { Users, UserPlus, Calendar, TrendingUp } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * MemberSignupTracker
 * 
 * Shows a report of how many members each staff member signed up.
 * Reads from members.registered_by → joins profiles for name.
 * 
 * Usage: Drop this component into the Dashboard, Members page, or a Reports section.
 * 
 * <MemberSignupTracker />
 */
export default function MemberSignupTracker({ membershipFee = 0 }) {
  const { companyId } = useCompany();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("all"); // all | month | week | today

  useEffect(() => {
    if (!companyId) return;
    loadData();
  }, [companyId, period]);

  const loadData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("members")
        .select("id, registered_by, created_at")
        .eq("company_id", companyId)
        .not("registered_by", "is", null);

      // Apply time filter
      const now = new Date();
      if (period === "today") {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        query = query.gte("created_at", todayStart);
      } else if (period === "week") {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte("created_at", weekAgo);
      } else if (period === "month") {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        query = query.gte("created_at", monthStart);
      }

      const { data: members, error } = await query;
      if (error) throw error;

      // Group by registered_by
      const grouped = {};
      for (const m of members || []) {
        if (!grouped[m.registered_by]) {
          grouped[m.registered_by] = { userId: m.registered_by, count: 0 };
        }
        grouped[m.registered_by].count++;
      }

      // Fetch profile names
      const userIds = Object.keys(grouped);
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);

        for (const p of profiles || []) {
          if (grouped[p.id]) {
            grouped[p.id].name = p.full_name || p.email || "Unknown";
            grouped[p.id].email = p.email;
          }
        }
      }

      // Sort by count descending
      const sorted = Object.values(grouped).sort((a, b) => b.count - a.count);
      setData(sorted);
    } catch (err) {
      console.error("Error loading signup data:", err);
    } finally {
      setLoading(false);
    }
  };

  const totalSignups = data.reduce((sum, d) => sum + d.count, 0);
  const totalFees = membershipFee > 0 ? totalSignups * membershipFee : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <UserPlus className="w-5 h-5" />
          Member Signups by Staff
        </h3>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Signups</p>
          <p className="text-2xl font-bold">{totalSignups}</p>
        </div>
        {membershipFee > 0 && (
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Fees Earned</p>
            <p className="text-2xl font-bold text-green-500">{formatCurrency(totalFees)}</p>
            <p className="text-xs text-muted-foreground">@ {formatCurrency(membershipFee)} each</p>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      {loading ? (
        <div className="text-center py-6 text-muted-foreground text-sm">Loading...</div>
      ) : data.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">
          No signups recorded{period !== "all" ? ` for ${period === "today" ? "today" : `this ${period}`}` : ""}.
          <br />
          <span className="text-xs">New members will be tracked once registered_by is set.</span>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((row, idx) => {
            const maxCount = data[0]?.count || 1;
            const barWidth = (row.count / maxCount) * 100;

            return (
              <div key={row.userId} className="relative overflow-hidden rounded-lg border border-border p-3">
                {/* Background bar */}
                <div
                  className="absolute inset-y-0 left-0 bg-primary/10"
                  style={{ width: `${barWidth}%` }}
                />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{row.name || "Unknown"}</p>
                      {row.email && <p className="text-xs text-muted-foreground">{row.email}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{row.count}</p>
                    {membershipFee > 0 && (
                      <p className="text-xs text-green-500">{formatCurrency(row.count * membershipFee)}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
