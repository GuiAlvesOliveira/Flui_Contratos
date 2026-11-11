import { useState } from 'react';
import { api } from '../api/axiosInstance';
import { AuthLayout } from '../components/AuthLayout';

export function AnalistaOnboardingPage() {
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
      // Recarrega para o /me trazer onboardingCompleted = true (AUTH-08)
      window.location.replace('/analista');
    } catch {
      setError('Erro ao salvar. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Complete seu cadastro" subtitle="Revise e complete seus dados antes de começar." wide>
      <form onSubmit={handleSubmit} className="ds-auth-form">
        <div className="ds-auth-grid">
          <div>
            <label>Nome *</label>
            <input
              type="text"
              value={form.name}
              onChange={set('name')}
              required
              autoFocus
              className="ds-auth-input"
            />
          </div>
          <div>
            <label>Sobrenome</label>
            <input
              type="text"
              value={form.surname}
              onChange={set('surname')}
              className="ds-auth-input"
            />
          </div>
        </div>

        <div>
          <label>Telefone</label>
          <input
            type="tel"
            value={form.telefone}
            onChange={set('telefone')}
            placeholder="(11) 99999-9999"
            className="ds-auth-input"
          />
        </div>

        <div>
          <label>RG</label>
          <input
            type="text"
            value={form.rg}
            onChange={set('rg')}
            className="ds-auth-input"
          />
        </div>

        {error && <p role="alert" className="ds-auth-msg error">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="ds-auth-btn"
        >
          {loading ? 'Salvando...' : 'Entrar na plataforma'}
        </button>
      </form>
    </AuthLayout>
  );
}
