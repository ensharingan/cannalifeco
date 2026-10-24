import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { usePosSettings } from '@/lib/usePosSettings';
import { useState, useEffect } from "react";
import { supabase } from '@/api/supabaseClient';
import {
  LayoutDashboard, ShoppingCart, Users, Package, Warehouse,
  Receipt, DollarSign, Settings, Menu, ChevronDown,
  LogOut, User, Store, Star, RotateCcw, Tag, Clock, BarChart2,
  Megaphone, TrendingUp, UserCircle,
  LifeBuoy, PackageSearch, ClipboardCheck, Sunset,
  ReceiptText, Building2
} from "lucide-react";
import cannalifeLogo from '../cannalife-logo.png';
import StoreSelector from "./StoreSelector";
import OfflineBanner from "./OfflineBanner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

const ROLE_ACCESS = {
  cashier:    ['cashier'],
  staff:      ['cashier', 'staff'],
  manager:    ['cashier', 'staff', 'manager'],
  owner:      ['cashier', 'staff', 'manager', 'owner'],
  superadmin: ['cashier', 'staff', 'manager', 'owner', 'superadmin'],
};

// requiresVat: only shown once the company has a SARS VAT number on file.
// A club that isn't VAT-registered has nothing to file, and the page itself
// only renders a "add your VAT number in Settings" notice — so a permanent
// nav item leading to that notice is just clutter.
const NAV_GROUPS = [
  { id: 'main',   label: null },
  { id: 'stock',  label: 'Stock' },
  { id: 'money',  label: 'Money' },
  { id: 'growth', label: 'Growth' },
  { id: 'admin',  label: 'Admin' },
];

const allNavItems = [
  { group: 'main',   path: "/",                    label: "Dashboard",           icon: LayoutDashboard, minRole: 'manager' },
  { group: 'main',   path: "/pos",                 label: "POS",                 icon: ShoppingCart,    minRole: 'cashier' },
  { group: 'main',   path: "/orders",              label: "Sales",               icon: Receipt,         minRole: 'cashier' },
  { group: 'main',   path: "/members",             label: "Members",             icon: Users,           minRole: 'cashier' },

  { group: 'stock',  path: "/products",            label: "Products",            icon: Package,         minRole: 'manager' },
  { group: 'stock',  path: "/inventory",           label: "Inventory",           icon: Warehouse,       minRole: 'manager' },
  { group: 'stock',  path: "/inventory-analytics", label: "Inventory Analytics", icon: TrendingUp,      minRole: 'manager', sub: true },
  { group: 'stock',  path: "/stock-value-report",  label: "Stock Value Report",  icon: PackageSearch,   minRole: 'manager', sub: true },
  { group: 'stock',  path: "/stock-counts",        label: "Stock Counts",        icon: ClipboardCheck,  minRole: 'cashier' },
  { group: 'stock',  path: "/supplier-payments",   label: "Suppliers",           icon: DollarSign,      minRole: 'manager' },
  { group: 'stock',  path: "/supplier-returns",    label: "Supplier Returns",    icon: RotateCcw,       minRole: 'manager', sub: true },

  { group: 'money',  path: "/finances",            label: "Finances",            icon: DollarSign,      minRole: 'cashier' },
  { group: 'money',  path: "/vat-report",          label: "VAT Report",          icon: ReceiptText,     minRole: 'owner',   sub: true, requiresVat: true },
  { group: 'money',  path: "/cashier-sessions",    label: "Cashier Sessions",    icon: Clock,           minRole: 'cashier' },
  { group: 'money',  path: "/end-of-day",          label: "End of Day",          icon: Sunset,          minRole: 'manager' },
  { group: 'money',  path: "/reports",             label: "Reports",             icon: BarChart2,       minRole: 'manager' },

  { group: 'growth', path: "/loyalty",             label: "Loyalty",             icon: Star,            minRole: 'manager' },
  { group: 'growth', path: "/promotions",          label: "Promotions",          icon: Tag,             minRole: 'manager' },
  { group: 'growth', path: "/marketing",           label: "Marketing",           icon: Megaphone,       minRole: 'owner' },

  { group: 'admin',  path: "/stores",              label: "Stores",              icon: Store,           minRole: 'owner' },
  { group: 'admin',  path: "/head-office",         label: "Head Office",         icon: Building2,       minRole: 'owner',   sub: true },
  { group: 'admin',  path: "/staff-performance",   label: "Staff Performance",   icon: UserCircle,      minRole: 'owner' },
  { group: 'admin',  path: "/settings",            label: "Settings",            icon: Settings,        minRole: 'manager' },
  { group: 'admin',  path: "/help",                label: "Help & Support",      icon: LifeBuoy,        minRole: 'cashier' },
];

const COLLAPSE_KEY = 'nav_collapsed_groups';
function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'); } catch (e) { return []; }
}
function saveCollapsed(list) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, logout } = useAuth();
  const { company, companyId } = useCompany();
  const { settings } = usePosSettings();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingPreorders, setPendingPreorders] = useState(0);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggleGroup = function (id) {
    setCollapsed(function (prev) {
      var next = prev.includes(id) ? prev.filter(function (g) { return g !== id; }) : prev.concat(id);
      saveCollapsed(next);
      return next;
    });
  };

  // Member pre-orders (Shop tab in the member portal) land here as
  // orders.order_type = 'pre_order', status = 'pending'. Nothing else in the
  // app currently surfaces them, so this badge is the only heads-up staff get.
  useEffect(function () {
    if (!companyId) return;
    var cancelled = false;

    var loadCount = async function () {
      var { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('order_type', 'pre_order')
        .eq('status', 'pending');
      if (!cancelled) setPendingPreorders(count || 0);
    };
    loadCount();

    var channel = supabase.channel('sidebar-preorder-count')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'orders',
        filter: 'company_id=eq.' + companyId,
      }, function () { loadCount(); })
      .subscribe();

    return function () { cancelled = true; supabase.removeChannel(channel); };
  }, [companyId]);

  const role = profile?.role || 'cashier';
  const accessibleRoles = ROLE_ACCESS[role] || ['cashier'];

  // company comes back from CompanyContext with select('*'), so vat_number is
  // on it. It is null on the very first render before the context resolves —
  // the item simply appears once the company loads.
  var hasVat = !!(company && company.vat_number && String(company.vat_number).trim() !== "");

  // Per-user extra pages (profiles.extra_pages) unlock individual nav items
  // above the user's role, e.g. a cashier who also gets Promotions + Marketing.
  const extraPages = Array.isArray(profile?.extra_pages) ? profile.extra_pages : [];

  const navItems = allNavItems.filter(function (item) {
    if (!accessibleRoles.includes(item.minRole) && !extraPages.includes(item.path)) return false;
    if (item.requiresVat && !hasVat) return false;
    return true;
  });

  // Exact match, or a match on a real path segment boundary.
  // Prevents a path from also highlighting a longer path that shares its prefix.
  const isActive = (path) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  const roleLabel = {
    superadmin: 'Super Admin',
    owner: 'Owner',
    manager: 'Manager',
    staff: 'Staff',
    cashier: 'Cashier',
  }[role] || role;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-64 bg-sidebar text-sidebar-foreground
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        flex flex-col
      `}>
        <div className="h-16 flex items-center justify-center px-4 border-b border-sidebar-border">
          <img src={cannalifeLogo} alt="Canna Life Co POS" className="h-10 w-auto" />
        </div>

        {role !== 'cashier' && <StoreSelector />}

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {NAV_GROUPS.map(function (g) {
            var items = navItems.filter(function (i) { return i.group === g.id; });
            if (items.length === 0) return null;
            var hasActive = items.some(function (i) { return isActive(i.path); });
            var isCollapsed = g.label && collapsed.includes(g.id) && !hasActive;
            return (
              <div key={g.id} className={g.label ? "pt-3" : ""}>
                {g.label && (
                  <button
                    type="button"
                    onClick={function () { toggleGroup(g.id); }}
                    className="flex items-center justify-between w-full px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
                  >
                    <span>{g.label}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>
                )}
                {!isCollapsed && (
                  <div className="space-y-1">
                    {items.map(({ path, label, icon: Icon, sub }) => (
                      <Link
                        key={path}
                        to={path}
                        onClick={() => setSidebarOpen(false)}
                        className={`
                          flex items-center gap-3 rounded-lg text-sm font-medium
                          transition-all duration-200
                          ${sub ? "ml-4 px-3 py-2 text-xs" : "px-3 py-2.5"}
                          ${isActive(path)
                            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/20"
                            : sub
                              ? "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          }
                        `}
                      >
                        <Icon className={sub ? "w-3.5 h-3.5" : "w-4 h-4"} />
                        <span className="flex-1">{label}</span>
                        {path === "/orders" && pendingPreorders > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-green-500 text-white text-[10px] font-bold shrink-0">
                            {pendingPreorders > 99 ? "99+" : pendingPreorders}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {profile && (
          <div className="p-3 border-t border-sidebar-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors">
                  <div className="w-8 h-8 rounded-full bg-sidebar-primary/20 flex items-center justify-center">
                    <User className="w-4 h-4 text-sidebar-primary" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium text-sidebar-accent-foreground truncate">{profile.full_name || user?.email}</p>
                    <p className="text-xs text-sidebar-foreground/60 truncate">{roleLabel}</p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-sidebar-foreground/40" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="w-4 h-4 mr-2" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex items-center gap-4 px-4 lg:px-6 border-b border-border bg-card/50 backdrop-blur-sm">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1" />
          {/* Canna Life Co is light-only for this client — dark mode toggle removed.
              The actual lock (default + ignoring any stored 'dark' preference)
              lives in ThemeContext / the first-paint script in index.html. */}
          <button
            onClick={() => navigate("/help")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title="Help & Support"
          >
            <LifeBuoy className="w-4 h-4" />
            <span className="hidden sm:inline">Help</span>
          </button>
        </header>
        <main className="flex-1 overflow-y-auto">
          <OfflineBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
