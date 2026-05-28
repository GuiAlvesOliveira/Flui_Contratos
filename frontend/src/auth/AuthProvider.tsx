import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import { supabase } from './supabaseClient';

type Role = 'admin' | 'dono' | 'analista' | 'cliente';

interface AuthContextValue {
  session: Session | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  role: Role | null;
  tenantId: string | null;
  name: string | null;
  onboardingCompleted: boolean;
  mustChangePassword: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } },
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // Initialize session and subscribe to auth changes (single source of truth)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) setIsLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') return; // silent refresh — don't reset app state
      setSession(session);
      if (!session) {
        setRole(null);
        setTenantId(null);
        setName(null);
        setOnboardingCompleted(false);
        setMustChangePassword(false);
        setIsLoadingAuth(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch user info from backend whenever session changes
  useEffect(() => {
    if (!session) return;

    setIsLoadingAuth(true);
    api
      .get<{ role: Role; tenantId: string; name: string; onboardingCompleted: boolean; mustChangePassword: boolean }>('/me')
      .then(({ data }) => {
        setRole(data.role);
        setTenantId(data.tenantId);
        setName(data.name);
        setOnboardingCompleted(data.onboardingCompleted);
        setMustChangePassword(data.mustChangePassword);
      })
      .catch(() => {
        setRole(null);
        setTenantId(null);
        setName(null);
        setOnboardingCompleted(false);
        setMustChangePassword(false);
      })
      .finally(() => setIsLoadingAuth(false));
  }, [session]);

  const logout = () => { supabase.auth.signOut(); };

  return (
    <AuthContext.Provider
      value={{ session, isAuthenticated: !!session, isLoadingAuth, role, tenantId, name, onboardingCompleted, mustChangePassword, logout }}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}
