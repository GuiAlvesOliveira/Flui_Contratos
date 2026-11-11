import { useState } from 'react';
import { api } from '../api/axiosInstance';
import { supabase } from '../auth/supabaseClient';
import { AuthLayout } from '../components/AuthLayout';

// Marcado no index.html quando o link do e-mail (convite ou recuperação) já
// expirou ou foi usado: o Supabase volta com error_code=otp_expired.
function takeExpiredLinkFlag(): boolean {
  const expired = sessionStorage.getItem('supabase_link_expired') === 'true';
  sessionStorage.removeItem('supabase_link_expired');
  return expired;
}

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [linkExpired] = useState(takeExpiredLinkFlag);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  // BE-08: a resposta é a mesma exista ou não a conta com esse e-mail
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post<{ message: string }>('/auth/forgot-password', { email: email.trim() });
      setSentMessage(data.message);
    } catch {
      setError('Não foi possível enviar agora. Tente novamente em alguns minutos.');
    }
    setLoading(false);
  };

  const switchMode = (next: 'login' | 'forgot') => {
    setMode(next);
    setError(null);
    setSentMessage(null);
  };

  if (mode === 'forgot') {
    return (
      <AuthLayout
        title="Esqueci minha senha"
        subtitle={sentMessage ? undefined : 'Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.'}
      >
        <form onSubmit={handleForgot} className="ds-auth-form">
          {sentMessage ? (
            <p role="status" className="ds-auth-msg info">{sentMessage}</p>
          ) : (
            <>
              {error && <p role="alert" className="ds-auth-msg error">{error}</p>}
              <div>
                <label htmlFor="forgot-email">E-mail</label>
                <input
                  id="forgot-email"
                  type="email"
                  placeholder="voce@exemplo.com.br"
                  aria-label="E-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="ds-auth-input"
                />
              </div>
              <button type="submit" disabled={loading} className="ds-auth-btn">
                {loading ? 'Enviando...' : 'Enviar link'}
              </button>
            </>
          )}
          <button type="button" className="ds-auth-link" onClick={() => switchMode('login')}>
            Voltar para o login
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Entrar" subtitle="Acesse o painel da sua assessoria ou acompanhe o seu financiamento.">
      <form onSubmit={handleSubmit} className="ds-auth-form">
        {linkExpired && (
          <p role="alert" className="ds-auth-msg warn">
            O link do e-mail expirou ou já foi usado. Peça um novo em "Esqueci minha senha".
          </p>
        )}
        {error && <p role="alert" className="ds-auth-msg error">{error}</p>}
        <div>
          <label htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            type="email"
            placeholder="voce@exemplo.com.br"
            aria-label="E-mail"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="ds-auth-input"
          />
        </div>
        <div>
          <label htmlFor="login-password">Senha</label>
          <input
            id="login-password"
            type="password"
            placeholder="Sua senha"
            aria-label="Senha"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="ds-auth-input"
          />
        </div>
        <button type="submit" disabled={loading} className="ds-auth-btn">
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
        <button type="button" className="ds-auth-link" onClick={() => switchMode('forgot')}>
          Esqueci minha senha
        </button>
      </form>
    </AuthLayout>
  );
}
