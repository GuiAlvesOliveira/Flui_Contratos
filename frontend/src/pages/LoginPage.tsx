import { useState } from 'react';
import { api } from '../api/axiosInstance';
import { supabase } from '../auth/supabaseClient';

// Marcado no index.html quando o link do e-mail (convite ou recuperação) já
// expirou ou foi usado: o Supabase volta com error_code=otp_expired.
function takeExpiredLinkFlag(): boolean {
  const expired = sessionStorage.getItem('supabase_link_expired') === 'true';
  sessionStorage.removeItem('supabase_link_expired');
  return expired;
}

const inputClass =
  'border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const linkClass = 'text-sm text-blue-600 hover:underline self-start cursor-pointer';

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <form
          onSubmit={handleForgot}
          className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm flex flex-col gap-4"
        >
          <h1 className="text-2xl font-bold text-gray-800">Esqueci minha senha</h1>
          {sentMessage ? (
            <p role="status" className="text-sm text-gray-700">{sentMessage}</p>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.
              </p>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <input
                type="email"
                placeholder="E-mail"
                aria-label="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className={inputClass}
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Enviando...' : 'Enviar link'}
              </button>
            </>
          )}
          <button type="button" className={linkClass} onClick={() => switchMode('login')}>
            Voltar para o login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm flex flex-col gap-4"
      >
        <h1 className="text-2xl font-bold text-gray-800">Flui Contratos</h1>
        {linkExpired && (
          <p role="alert" className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">
            O link do e-mail expirou ou já foi usado. Peça um novo em "Esqueci minha senha".
          </p>
        )}
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <input
          type="email"
          placeholder="E-mail"
          aria-label="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={inputClass}
        />
        <input
          type="password"
          placeholder="Senha"
          aria-label="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className={inputClass}
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
        <button type="button" className={linkClass} onClick={() => switchMode('forgot')}>
          Esqueci minha senha
        </button>
      </form>
    </div>
  );
}
