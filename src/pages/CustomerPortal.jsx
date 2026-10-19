import { supabase } from '@/api/supabaseClient';
import { useState, useEffect } from "react";
import { entities } from '@/api/entities';
import { Bell, Package, Search, Leaf } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../lib/currency";


const categoryIcons = {
  flower: "🌿", edibles: "🍪", oils: "💧", concentrates: "🔥",
  pre_rolls: "🚬", accessories: "🔧", beverages: "🥤", topicals: "✨", other: "📦"
};

export default function CustomerPortal() {
  const [user, setUser] = useState(null);
  const [member, setMember] = useState(null);
  const [products, setProducts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("products");

  useEffect(() => {
    supabase.auth.getUser().then(r => r.data.user).then(async (u) => {
      setUser(u);
      // Try to find matching member by email
      const allMembers = await entities.Member.filter({ email: u.email }, "-created_at", 1);
      const m = allMembers[0] || null;
      setMember(m);

      // Load products and notifications
      const [prods, notifs] = await Promise.all([
        entities.Product.list("-created_at", 200),
        entities.CustomerNotification.list("-created_at", 50),
      ]);

      const activeProds = prods.filter(p => p.is_active !== false && p.stock_quantity > 0);
      setProducts(activeProds);

      // Filter notifications by membership type
      const relevant = notifs.filter(n => {
        if (!n.is_published) return false;
        if (n.target_audience === "all") return true;
        if (m && n.target_audience === m.membership_type) return true;
        return false;
      });
      setNotifications(relevant);
      setLoading(false);
    }).catch(() => {
      window.location.href='/login';
    });
  }, []);

  const filtered = products.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()));
  const unreadCount = notifications.length;

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-card/80 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Leaf className="w-6 h-6 text-primary" />
            <span className="font-bold text-lg">Member Portal</span>
          </div>
          <div className="flex items-center gap-3">
            {member && (
              <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-full capitalize">
                {member.membership_type || "member"}
              </span>
            )}
            <span className="text-sm text-muted-foreground">{user?.full_name}</span>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Welcome */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="font-semibold">Welcome{member ? `, ${member.first_name}` : ""}! 👋</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {member ? `Member ID: ${member.membership_id} · Points: ${member.loyalty_points || 0}` : "Browse our available products below."}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("products")}
            className={cn("flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all",
              activeTab === "products" ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Package className="w-4 h-4" /> Products
          </button>
          <button
            onClick={() => setActiveTab("notifications")}
            className={cn("flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all relative",
              activeTab === "notifications" ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Bell className="w-4 h-4" />
            Notifications
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Products tab */}
        {activeTab === "products" && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {filtered.map(p => (
                <div key={p.id} className="bg-card border border-border rounded-xl p-3">
                  <span className="text-2xl">{categoryIcons[p.category] || "📦"}</span>
                  <h3 className="font-medium text-sm mt-2 line-clamp-2">{p.name}</h3>
                  {p.strain_type && p.strain_type !== "n/a" && (
                    <p className="text-xs text-muted-foreground capitalize mt-0.5">{p.strain_type}</p>
                  )}
                  {p.thc_content && <p className="text-xs text-muted-foreground">THC: {p.thc_content}</p>}
                  <p className="text-lg font-bold text-primary mt-2">{formatCurrency(p.price)}</p>
                  <p className={cn("text-xs mt-0.5", p.stock_quantity <= 5 ? "text-yellow-500" : "text-muted-foreground")}>
                    {p.stock_quantity <= 5 ? `Only ${p.stock_quantity} left!` : "In stock"}
                  </p>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-2 text-center py-12 text-muted-foreground text-sm">No products found</div>
              )}
            </div>
          </div>
        )}

        {/* Notifications tab */}
        {activeTab === "notifications" && (
          <div className="space-y-3">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Bell className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : notifications.map(n => (
              <div key={n.id} className="bg-card border border-border rounded-xl overflow-hidden">
                {n.image_url && <img src={n.image_url} alt="" className="w-full h-40 object-cover" />}
                <div className="p-4">
                  <h3 className="font-semibold text-sm mb-1">{n.title}</h3>
                  <p className="text-sm text-muted-foreground">{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-2">{new Date(n.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}