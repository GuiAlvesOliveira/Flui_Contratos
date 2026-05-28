import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { AnalistaOnboardingPage } from '../pages/AnalistaOnboardingPage';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { ClienteOnboardingPage } from '../pages/ClienteOnboardingPage';
import { Forbidden } from '../pages/Forbidden';
import { LoginPage } from '../pages/LoginPage';
import { SetPasswordPage } from '../pages/SetPasswordPage';
import { AppShell } from '../components/layout/AppShell';

const Loading = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font)' }}>
    Carregando...
  </div>
);

function RoleRoute({ allowed, children }: { allowed: string; children: React.ReactNode }) {
  const { isAuthenticated, role, isLoadingAuth } = useAuth();

  if (isLoadingAuth) return <Loading />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (role !== allowed) return <Forbidden />;

  return <>{children}</>;
}

// Set in index.html inline script (before Supabase clears the hash) — read it here.
const isInviteSession = typeof window !== 'undefined' &&
  sessionStorage.getItem('supabase_invite_flow') === 'true';

function RootRedirect() {
  const { isAuthenticated, role, isLoadingAuth, mustChangePassword, onboardingCompleted } = useAuth();

  if (isLoadingAuth) return <Loading />;

  // Invite flow: Supabase clears the hash before we render with isLoadingAuth=false,
  // so we persist the flag in sessionStorage to survive the hash clearing.
  if (isInviteSession) {
    sessionStorage.removeItem('supabase_invite_flow');
    return <SetPasswordPage />;
  }

  if (!isAuthenticated) return <LoginPage />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;

  if (!onboardingCompleted) {
    if (role === 'analista') return <Navigate to="/analista/onboarding" replace />;
    if (role === 'cliente') return <Navigate to="/cliente/onboarding" replace />;
  }

  if (role === 'dono') return <Navigate to="/dono" replace />;
  if (role === 'analista') return <Navigate to="/analista" replace />;
  if (role === 'cliente') return <Navigate to="/cliente" replace />;

  return <Forbidden />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/analista/onboarding" element={<AnalistaOnboardingPage />} />
        <Route path="/cliente/onboarding" element={<ClienteOnboardingPage />} />
        <Route path="/dono" element={<RoleRoute allowed="dono"><AppShell /></RoleRoute>} />
        <Route path="/analista" element={<RoleRoute allowed="analista"><AppShell /></RoleRoute>} />
        <Route path="/cliente" element={<RoleRoute allowed="cliente"><AppShell /></RoleRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
