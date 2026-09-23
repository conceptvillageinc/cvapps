import { Toaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

import Login from '@/pages/Login';

import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import EstimateCreate from '@/pages/EstimateCreate';
import EstimateList from '@/pages/EstimateList';
import EstimateDetail from '@/pages/EstimateDetail';
import EstimateShortLink from '@/pages/EstimateShortLink';
import EstimateHistory from '@/pages/EstimateHistory';
import VendorManagement from '@/pages/VendorManagement';
import PriceMasterList from '@/pages/PriceMasterList';
import SystemSettingsPage from '@/pages/SystemSettings';
import UserManagement from '@/pages/UserManagement';
import ClientManagement from '@/pages/ClientManagement';
import FaqPage from '@/pages/FaqPage';
import ProjectList from '@/pages/ProjectList';
import ProjectDetail from '@/pages/ProjectDetail';
import RecurringProjects from '@/pages/RecurringProjects';
import DeliveryNoteList from '@/pages/DeliveryNoteList';
import DeliveryNoteEdit from '@/pages/DeliveryNoteEdit';
import InvoiceList from '@/pages/InvoiceList';
import InvoiceEdit from '@/pages/InvoiceEdit';
import Payments from '@/pages/Payments';
import AccountingExport from '@/pages/AccountingExport';
import SalesReport from '@/pages/SalesReport';
import Cashflow from '@/pages/Cashflow';
import ClientKarte from '@/pages/ClientKarte';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  // 未ログイン時の扱いは ProtectedRoute に一任する。
  // ここで認証エラーを見て握りつぶすと /login 自体が描画されなくなる。
  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />

      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<ProjectList />} />
          <Route path="/projects/recurring" element={<RecurringProjects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/sales-report" element={<SalesReport />} />
          <Route path="/cashflow" element={<Cashflow />} />
          <Route path="/clients/:id" element={<ClientKarte />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/accounting-export" element={<AccountingExport />} />
          <Route path="/invoices" element={<InvoiceList />} />
          <Route path="/invoices/new" element={<InvoiceEdit />} />
          <Route path="/invoices/:id" element={<InvoiceEdit />} />
          <Route path="/delivery-notes" element={<DeliveryNoteList />} />
          <Route path="/delivery-notes/new" element={<DeliveryNoteEdit />} />
          <Route path="/delivery-notes/:id" element={<DeliveryNoteEdit />} />
          <Route path="/estimates/new" element={<EstimateCreate />} />
          <Route path="/estimates/:id" element={<EstimateDetail />} />
          <Route path="/e/:number" element={<EstimateShortLink />} />
          <Route path="/estimates" element={<EstimateList />} />
          <Route path="/history" element={<EstimateHistory />} />
          <Route path="/vendors" element={<VendorManagement />} />
          <Route path="/price-master" element={<PriceMasterList />} />
          <Route path="/settings" element={<SystemSettingsPage />} />
          <Route path="/users" element={<UserManagement />} />
          <Route path="/clients" element={<ClientManagement />} />
          <Route path="/faq" element={<FaqPage />} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
