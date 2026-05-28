import { useState } from 'react';
import { api } from '../api/axiosInstance';
import { supabase } from '../auth/supabaseClient';

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-md p-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Criar nova senha</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sua senha temporária (CPF) precisa ser alterada antes de continuar.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar senha</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Repita a senha"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors cursor-pointer"
          >
            {loading ? 'Salvando...' : 'Salvar e continuar'}
          </button>
        </form>
      </div>
    </div>
  );
}
