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

const needsOnboarding = (role: string | null) => role === 'analista' || role === 'cliente';

// AUTH-08: abrir /analista ou /cliente direto não pula a troca de senha nem o
// onboarding (a API também recusa, com ONBOARDING_REQUIRED).
function RoleRoute({ allowed, children }: { allowed: string; children: React.ReactNode }) {
  const { isAuthenticated, role, isLoadingAuth, mustChangePassword, onboardingCompleted } = useAuth();

  if (isLoadingAuth) return <Loading />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (role !== allowed) return <Forbidden />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!onboardingCompleted && needsOnboarding(role)) {
    return <Navigate to={`/${role}/onboarding`} replace />;
  }

  return <>{children}</>;
}

function OnboardingRoute({ allowed, children }: { allowed: string; children: React.ReactNode }) {
  const { isAuthenticated, role, isLoadingAuth, mustChangePassword, onboardingCompleted } = useAuth();

  if (isLoadingAuth) return <Loading />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (role !== allowed) return <Forbidden />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  if (onboardingCompleted) return <Navigate to={`/${role}`} replace />;

  return <>{children}</>;
}

// Set in index.html inline script (before Supabase clears the hash) — read it here.
const isInviteSession = typeof window !== 'undefined' &&
  sessionStorage.getItem('supabase_invite_flow') === 'true';
// BE-08: link de "esqueci minha senha" (type=recovery), mesmo mecanismo do convite
const isRecoverySession = typeof window !== 'undefined' &&
  sessionStorage.getItem('supabase_recovery_flow') === 'true';

function RootRedirect() {
  const { isAuthenticated, role, isLoadingAuth, mustChangePassword, onboardingCompleted } = useAuth();

  if (isLoadingAuth) return <Loading />;

  // Invite flow: Supabase clears the hash before we render with isLoadingAuth=false,
  // so we persist the flag in sessionStorage to survive the hash clearing.
  if (isInviteSession) {
    sessionStorage.removeItem('supabase_invite_flow');
    return <SetPasswordPage />;
  }
  if (isRecoverySession) {
    sessionStorage.removeItem('supabase_recovery_flow');
    return <SetPasswordPage mode="recovery" />;
  }

  if (!isAuthenticated) return <LoginPage />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;

  if (!onboardingCompleted && needsOnboarding(role)) {
    return <Navigate to={`/${role}/onboarding`} replace />;
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
        <Route path="/analista/onboarding" element={<OnboardingRoute allowed="analista"><AnalistaOnboardingPage /></OnboardingRoute>} />
        <Route path="/cliente/onboarding" element={<OnboardingRoute allowed="cliente"><ClienteOnboardingPage /></OnboardingRoute>} />
        <Route path="/dono" element={<RoleRoute allowed="dono"><AppShell /></RoleRoute>} />
        <Route path="/analista" element={<RoleRoute allowed="analista"><AppShell /></RoleRoute>} />
        <Route path="/cliente" element={<RoleRoute allowed="cliente"><AppShell /></RoleRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
