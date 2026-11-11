import { useState } from 'react';
import { api } from '../api/axiosInstance';
import { supabase } from '../auth/supabaseClient';
import { AuthLayout } from '../components/AuthLayout';

export function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) { setError('As senhas não conferem'); return; }
    if (newPassword.length < 8) { setError('Mínimo 8 caracteres'); return; }

    setLoading(true);
    setError('');

    try {
      await api.patch('/me/change-password', { newPassword });
      // Sign out so the invalidated token doesn't cause a Forbidden screen.
      // User logs in again with the new password → onboarding flow continues.
      await supabase.auth.signOut();
      window.location.replace('/');
    } catch {
      setError('Não foi possível atualizar a senha. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Criar nova senha" subtitle="Sua senha temporária precisa ser alterada antes de continuar.">
      <form onSubmit={handleSubmit} className="ds-auth-form">
        <div>
          <label>Nova senha</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoFocus
            className="ds-auth-input"
            placeholder="Mínimo 8 caracteres"
          />
        </div>

        <div>
          <label>Confirmar senha</label>
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
          {loading ? 'Salvando...' : 'Salvar e continuar'}
        </button>
      </form>
    </AuthLayout>
  );
}
