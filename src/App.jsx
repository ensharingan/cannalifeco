import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import MemberPortalLogin from './pages/MemberPortalLogin';
import MemberPortalDashboard from './pages/MemberPortalDashboard';
import ClubPublicPage from './pages/ClubPublicPage';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { HashRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import PageNotFound from './lib/PageNotFound';
import { ThemeProvider } from '@/lib/ThemeContext';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { CompanyProvider, useCompany } from '@/lib/CompanyContext';
import { usePosSettings } from '@/lib/usePosSettings';
import { supabase } from '@/api/supabaseClient';
import CompanySetup from './components/CompanySetup';
import CompanyStatusGate from './components/CompanyStatusGate';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Members from './pages/Members';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Orders from './pages/Orders';
import Finances from './pages/Finances';
import Settings from './pages/Settings';
import Stores from './pages/Stores';
import HeadOffice from './pages/HeadOffice';
import MemberRegister from './pages/MemberRegister';
import Loyalty from './pages/Loyalty';
import SupplierReturns from './pages/SupplierReturns';
import SupplierPayments from './pages/SupplierPayments';
import Promotions from './pages/Promotions';
import CashierSessions from './pages/CashierSessions';
import Reports from './pages/Reports';
import EndOfDay from './pages/EndOfDay';
import Cashiers from './pages/Cashiers';
import PatientIntakeForm from './pages/PatientIntakeForm';
import PatientsDashboard from './pages/PatientsDashboard';
import SuperAdminCompliance from './pages/SuperAdminCompliance';
import Marketing from './pages/Marketing';
import InventoryAnalytics from './pages/InventoryAnalytics';
import CustomerPortal from './pages/CustomerPortal';
import StaffPerformance from './pages/StaffPerformance';
import SuperAdmin from './pages/SuperAdmin';
import SuperAdminClients from './pages/superadmin/Clients';
import SupplierSignup from './pages/SupplierSignup';
import SupplierLogin from './pages/SupplierLogin';
import SupplierDashboard from './pages/SupplierDashboard';
import HelpCenter from './pages/HelpCenter';
import StockValueReport from './pages/StockValueReport';
import PaymentBreakdownReport from './pages/PaymentBreakdownReport';
import SalesByProductReport from './pages/SalesByProductReport';
import VatReport from './pages/VatReport';
import PrintLabels from './pages/PrintLabels';
import Membership from './pages/Membership';
import PublicSign from './pages/PublicSign';
import TillCashOuts from './pages/TillCashOuts';
import StockCounts from './pages/StockCounts';
import StockCountSession from './pages/StockCountSession';

// Accounting module — Pastel-style cash books, journals and financial reports.
import CashBooks from './pages/accounting/CashBooks';
import ProcessCashBook from './pages/accounting/ProcessCashBook';
import BankReconciliation from './pages/accounting/BankReconciliation';
import Journals from './pages/accounting/Journals';
import InventoryJournals from './pages/accounting/InventoryJournals';
import TaxPeriods from './pages/accounting/TaxPeriods';
import FinancialReports from './pages/accounting/FinancialReports';
import GeneralLedger from './pages/accounting/GeneralLedger';
import AccountingSetup from './pages/accounting/AccountingSetup';

// The books are for owners and managers. This only hides the pages; the
// database enforces the same rule, so a hand-typed URL gets an empty screen
// rather than someone else's bank balance.
const AccountingGuard = ({ children }) => {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role !== 'owner' && profile.role !== 'manager' && profile.role !== 'superadmin') {
    return <Navigate to="/" replace />;
  }
  return children;
};

// Head Office is franchise-level (multi-store) control — owners and
// superadmins only. HeadOffice.jsx also checks this itself, so this is a
// second line of defence, same pattern as AccountingGuard above.
const HeadOfficeGuard = ({ children }) => {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role !== 'owner' && profile.role !== 'superadmin') {
    return <Navigate to="/" replace />;
  }
  return children;
};

const CashierGuard = ({ children }) => {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role === 'cashier') return <Navigate to="/pos" replace />;
  return children;
};

// Blocks the Section 21 / Patients pages when the company has
// pos_settings.hide_patients set, so the URL can't be hit directly
// after the nav item is hidden.
const PatientsGuard = ({ children }) => {
  const { settings, isLoading } = usePosSettings();
  const { profile } = useAuth();
  if (isLoading) return null;
  if (settings.hide_patients) return <Navigate to="/" replace />;
  if (settings.cashier_hide_patients && profile?.role === 'cashier') {
    return <Navigate to="/pos" replace />;
  }
  return children;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();
  const { companyId, loading: companyLoading } = useCompany();
  const location = useLocation();
  var fullPath = location.pathname + location.hash;
  var isSupplierPath = fullPath.includes('/supplier-login') || fullPath.includes('/supplier-signup') || fullPath.includes('/supplier-dashboard');
  if (isSupplierPath) {
    return (
      <Routes>
        <Route path="/supplier-signup" element={<SupplierSignup />} />
        <Route path="/supplier-login" element={<SupplierLogin />} />
        <Route path="/supplier-dashboard" element={<SupplierDashboard />} />
        <Route path="*" element={<Navigate to="/supplier-login" replace />} />
      </Routes>
    );
  }
  var isSignPath = fullPath.includes('/sign/');
  if (isSignPath) {
    return (
      <Routes>
        <Route path="/sign/:token" element={<PublicSign />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }
  if (isLoadingAuth || companyLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<MemberRegister />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/member-portal/:companyId" element={<MemberPortalLogin />} />
        <Route path="/member-portal/:companyId/dashboard" element={<MemberPortalDashboard />} />
        <Route path="/club/:companyId" element={<ClubPublicPage />} />
        <Route path="/sign/:token" element={<PublicSign />} />
        <Route path="/supplier-signup" element={<SupplierSignup />} />
        <Route path="/supplier-login" element={<SupplierLogin />} />
        <Route path="/supplier-dashboard" element={<SupplierDashboard />} />
        {/* White label: no self-serve signup. Stores are created by a superadmin. */}
        <Route path="/signup" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/member-portal/:companyId" element={<MemberPortalLogin />} />
      <Route path="/member-portal/:companyId/dashboard" element={<MemberPortalDashboard />} />
      <Route path="/club/:companyId" element={<ClubPublicPage />} />
      <Route path="/sign/:token" element={<PublicSign />} />
      <Route path="/supplier-signup" element={<SupplierSignup />} />
      <Route path="/supplier-login" element={<SupplierLogin />} />
      <Route path="/supplier-dashboard" element={<SupplierDashboard />} />
      <Route path="/setup" element={<CompanySetup />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<CompanyStatusGate><Layout /></CompanyStatusGate>}>
        <Route path="/" element={<CashierGuard><Dashboard /></CashierGuard>} />
        <Route path="/pos" element={<POS />} />
        <Route path="/members" element={<Members />} />
        <Route path="/membership" element={<Membership />} />
        <Route path="/products" element={<Products />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/stock-counts" element={<StockCounts />} />
        <Route path="/stock-counts/:id" element={<StockCountSession />} />

        {/* Accounting — owners and managers only; the guard is enforced again by RLS. */}
        <Route path="/accounting" element={<Navigate to="/accounting/cash-books" replace />} />
        <Route path="/accounting/cash-books" element={<AccountingGuard><CashBooks /></AccountingGuard>} />
        <Route path="/accounting/cash-books/:id" element={<AccountingGuard><ProcessCashBook /></AccountingGuard>} />
        <Route path="/accounting/bank-rec" element={<AccountingGuard><BankReconciliation /></AccountingGuard>} />
        <Route path="/accounting/journals" element={<AccountingGuard><Journals /></AccountingGuard>} />
        <Route path="/accounting/inventory-journals" element={<AccountingGuard><InventoryJournals batchType="normal" /></AccountingGuard>} />
        <Route path="/accounting/interstore" element={<AccountingGuard><InventoryJournals batchType="interstore" /></AccountingGuard>} />
        <Route path="/accounting/tax-periods" element={<AccountingGuard><TaxPeriods /></AccountingGuard>} />
        <Route path="/accounting/reports" element={<AccountingGuard><FinancialReports /></AccountingGuard>} />
        <Route path="/accounting/ledger" element={<AccountingGuard><GeneralLedger /></AccountingGuard>} />
        <Route path="/accounting/settings" element={<AccountingGuard><AccountingSetup /></AccountingGuard>} />
        <Route path="/print-labels" element={<PrintLabels />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/finances" element={<Finances />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/stores" element={<Stores />} />
        <Route path="/head-office" element={<HeadOfficeGuard><HeadOffice /></HeadOfficeGuard>} />
        <Route path="/register" element={<MemberRegister />} />
        <Route path="/loyalty" element={<Loyalty />} />
        <Route path="/supplier-returns" element={<SupplierReturns />} />
        <Route path="/supplier-payments" element={<SupplierPayments />} />
        <Route path="/promotions" element={<Promotions />} />
        <Route path="/cashier-sessions" element={<CashierSessions />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/end-of-day" element={<EndOfDay />} />
        <Route path="/payment-breakdown" element={<PaymentBreakdownReport />} />
        <Route path="/stock-value-report" element={<StockValueReport />} />
        <Route path="/sales-by-product" element={<SalesByProductReport />} />
        <Route path="/vat-report" element={<VatReport />} />
        <Route path="/cashiers" element={<Cashiers />} />
        <Route path="/till-cash-outs" element={<TillCashOuts />} />
        <Route path="/patient-intake" element={<PatientsGuard><PatientIntakeForm /></PatientsGuard>} />
        <Route path="/patients-dashboard" element={<PatientsGuard><PatientsDashboard /></PatientsGuard>} />
        <Route path="/admin-compliance" element={<SuperAdminCompliance />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/inventory-analytics" element={<InventoryAnalytics />} />
        <Route path="/customer-portal" element={<CustomerPortal />} />
        <Route path="/staff-performance" element={<StaffPerformance />} />
        <Route path="/super-admin" element={<SuperAdmin />} />
        <Route path="/super-admin/clients" element={<SuperAdminClients />} />
        <Route path="/help" element={<HelpCenter />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  );
};
function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <CompanyProvider>
          <QueryClientProvider client={queryClientInstance}>
            <Router>
              <AuthenticatedApp />
            </Router>
            <Toaster />
            <SonnerToaster position="top-right" richColors closeButton />
          </QueryClientProvider>
        </CompanyProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
export default App
