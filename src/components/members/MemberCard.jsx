import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Leaf, User } from "lucide-react";
import { useCompany } from "@/lib/CompanyContext";
import { supabase } from "@/api/supabaseClient";

const TIER_META = [
  { key: "bronze",   name: "Bronze",   icon: "🥉", color: "text-orange-300",  bg: "bg-orange-400/20 border-orange-400/30" },
  { key: "silver",   name: "Silver",   icon: "🥈", color: "text-slate-200",   bg: "bg-slate-400/20 border-slate-400/30" },
  { key: "gold",     name: "Gold",     icon: "🥇", color: "text-yellow-300",  bg: "bg-yellow-400/20 border-yellow-400/30" },
  { key: "platinum", name: "Platinum", icon: "💎", color: "text-purple-300",  bg: "bg-purple-400/20 border-purple-400/30" },
];

function getTier(points, thresholds) {
  var b = thresholds.bronze   ?? 0;
  var s = thresholds.silver   ?? 500;
  var g = thresholds.gold     ?? 1500;
  var p = thresholds.platinum ?? 5000;
  if (points >= p) return TIER_META[3];
  if (points >= g) return TIER_META[2];
  if (points >= s) return TIER_META[1];
  return TIER_META[0];
}

const membershipColors = {
  standard: "from-slate-700 to-slate-900",
  premium:  "from-emerald-700 to-emerald-900",
  vip:      "from-amber-600 to-amber-900",
  founder:  "from-purple-700 to-purple-900",
  basic:    "from-slate-600 to-slate-800",
  lounge:   "from-indigo-700 to-indigo-900",
};

export default function MemberCard({ member }) {
  var { company, companyId } = useCompany();
  var companyName = (company && (company.trading_name || company.company_name)) || "CANNA LIFE CO";

  var [thresholds, setThresholds] = useState({
    bronze: 0, silver: 500, gold: 1500, platinum: 5000,
  });

  useEffect(function() {
    if (!companyId) return;
    supabase
      .from("companies")
      .select("loyalty_bronze, loyalty_silver, loyalty_gold, loyalty_platinum")
      .eq("id", companyId)
      .single()
      .then(function({ data }) {
        if (data) {
          setThresholds({
            bronze:   data.loyalty_bronze   ?? 0,
            silver:   data.loyalty_silver   ?? 500,
            gold:     data.loyalty_gold     ?? 1500,
            platinum: data.loyalty_platinum ?? 5000,
          });
        }
      });
  }, [companyId]);

  var points = member.loyalty_points || 0;
  var tier = getTier(points, thresholds);

  return (
    <div className={cn(
      "relative w-full max-w-sm rounded-2xl p-6 text-white shadow-xl overflow-hidden bg-gradient-to-br",
      membershipColors[member.membership_type] || membershipColors.standard
    )}>
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-4 right-4"><Leaf className="w-32 h-32" /></div>
      </div>

      {/* Content */}
      <div className="relative z-10 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Leaf className="w-5 h-5" />
            <span className="font-bold text-sm tracking-wider uppercase">{companyName}</span>
          </div>
          {/* Tier badge */}
          <span className={cn(
            "text-xs font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider",
            tier.bg, tier.color
          )}>
            {tier.icon} {tier.name}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
            {member.profile_image ? (
              <img src={member.profile_image} alt="" className="w-full h-full rounded-full object-cover" />
            ) : (
              <User className="w-8 h-8 text-white/80" />
            )}
          </div>
          <div>
            <p className="text-lg font-bold">{member.first_name} {member.last_name}</p>
            <p className="text-sm opacity-80">ID: {member.membership_id}</p>
            {/* Points under name */}
            <p className="text-xs opacity-70 mt-0.5">{points.toLocaleString()} pts</p>
          </div>
        </div>

        <div className="flex justify-between items-end">
          <div>
            <p className="text-xs opacity-60">Member Since</p>
            <p className="text-sm">{member.created_at ? new Date(member.created_at).toLocaleDateString() : "N/A"}</p>
          </div>
          {member.qr_code && (
            <img src={member.qr_code} alt="QR" className="w-14 h-14 rounded-lg bg-white p-1" />
          )}
        </div>
      </div>
    </div>
  );
}
