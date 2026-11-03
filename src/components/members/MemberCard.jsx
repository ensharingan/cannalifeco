import { cn } from "@/lib/utils";
import { Leaf, User } from "lucide-react";
import { useCompany } from "@/lib/CompanyContext";

const membershipColors = {
  standard: "from-slate-700 to-slate-900",
  premium:  "from-emerald-700 to-emerald-900",
  vip:      "from-amber-600 to-amber-900",
  founder:  "from-purple-700 to-purple-900",
  basic:    "from-slate-600 to-slate-800",
  lounge:   "from-indigo-700 to-indigo-900",
};

export default function MemberCard({ member }) {
  var { company } = useCompany();
  var companyName = (company && (company.trading_name || company.company_name)) || "CANNA LIFE CO";

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
