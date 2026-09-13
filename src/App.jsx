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
import EstimateHistory from '@/pages/EstimateHistory';
import VendorManagement from '@/pages/VendorManagement';
import PriceMasterList from '@/pages/PriceMasterList';
import SystemSettingsPage from '@/pages/SystemSettings';
import UserManagement from '@/pages/UserManagement';
import ClientManagement from '@/pages/ClientManagement';
import FaqPage from '@/pages/FaqPage';

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
          <Route path="/estimates/new" element={<EstimateCreate />} />
          <Route path="/estimates/:id" element={<EstimateDetail />} />
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
