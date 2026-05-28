import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/axiosInstance';

export function AnalistaOnboardingPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', surname: '', telefone: '', rg: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Nome é obrigatório'); return; }

    setLoading(true);
    setError('');

    try {
      await api.patch('/me/onboarding', {
        name: form.name.trim(),
        surname: form.surname.trim() || undefined,
        telefone: form.telefone.trim() || undefined,
        rg: form.rg.trim() || undefined,
      });
      navigate('/analista', { replace: true });
    } catch {
      setError('Erro ao salvar. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Complete seu cadastro</h1>
          <p className="text-sm text-gray-500 mt-1">
            Revise e complete seus dados antes de começar.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
              <input
                type="text"
                value={form.name}
                onChange={set('name')}
                required
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
              <input
                type="text"
                value={form.surname}
                onChange={set('surname')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
            <input
              type="tel"
              value={form.telefone}
              onChange={set('telefone')}
              placeholder="(11) 99999-9999"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">RG</label>
            <input
              type="text"
              value={form.rg}
              onChange={set('rg')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors cursor-pointer"
          >
            {loading ? 'Salvando...' : 'Entrar na plataforma'}
          </button>
        </form>
      </div>
    </div>
  );
}
