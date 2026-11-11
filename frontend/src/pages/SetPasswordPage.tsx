import { useState } from 'react';
import { api } from '../api/axiosInstance';
import { supabase } from '../auth/supabaseClient';
import { AuthLayout } from '../components/AuthLayout';

const TEXTS = {
  invite: {
    title: 'Criar senha',
    subtitle: 'Bem-vindo! Defina sua senha para acessar a plataforma.',
    expired: 'Link de convite expirado. Peça um novo convite.',
  },
  recovery: {
    title: 'Redefinir senha',
    subtitle: 'Escolha uma nova senha para a sua conta.',
    expired: 'Link expirado. Peça um novo em "Esqueci minha senha".',
  },
};

// Convite (definir a primeira senha) ou recuperação de senha (BE-08): os dois
// chegam com uma sessão do Supabase pelo link do e-mail.
export function SetPasswordPage({ mode = 'invite' }: { mode?: 'invite' | 'recovery' }) {
  const texts = TEXTS[mode];
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('As senhas não conferem'); return; }
    if (password.length < 8) { setError('Mínimo 8 caracteres'); return; }

    setLoading(true);
    setError('');

    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user.email;
    if (!email) {
      setError(texts.expired);
      setLoading(false);
      return;
    }

    try {
      // Define a senha no servidor e limpa o mustChangePassword num passo só —
      // assim o convidado não é mandado para /change-password escolher outra senha.
      await api.patch('/me/change-password', { newPassword: password });
    } catch {
      setError('Não foi possível salvar a senha. Tente novamente.');
      setLoading(false);
      return;
    }

    // A troca feita pelo servidor encerra a sessão do convite: entra de novo com
    // a senha recém-criada para seguir direto para o app.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) await supabase.auth.signOut(); // senha já salva — cai no login

    // Limpa o hash e reinicia o fluxo de auth → RootRedirect redireciona pelo role
    window.location.replace('/');
  };

  return (
    <AuthLayout title={texts.title} subtitle={texts.subtitle}>
      <form onSubmit={handleSubmit} className="ds-auth-form">
        <div>
          <label>Nova senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            className="ds-auth-input"
            placeholder="Mínimo 8 caracteres"
          />
        </div>

        <div>
          <label>
            Confirmar senha
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="ds-auth-input"
            placeholder="Repita a senha"
          />
        </div>

        {error && <p role="alert" className="ds-auth-msg error">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="ds-auth-btn"
        >
          {loading ? 'Salvando...' : 'Salvar senha e entrar'}
        </button>
      </form>
    </AuthLayout>
  );
}
