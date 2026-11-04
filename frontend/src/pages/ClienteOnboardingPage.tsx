import { useState } from 'react';
import { api } from '../api/axiosInstance';
import { cepDigits } from '../lib/cep';
import { useCepLookup } from '../lib/useCepLookup';
import { UFS } from '../lib/ficha';

type FonteRenda = 'assalariado' | 'nao_assalariado';
type EstadoCivil = 'solteiro' | 'casado' | 'divorciado' | 'viuvo' | 'uniao_estavel';

export function ClienteOnboardingPage() {
  const [form, setForm] = useState({
    name: '',
    surname: '',
    cpf: '',
    rg: '',
    telefone: '',
    dataNascimento: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    estadoCivil: '' as EstadoCivil | '',
    fonteRenda: '' as FonteRenda | '',
  });
  const cep = useCepLookup();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (field: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Nome é obrigatório'); return; }
    if (!form.estadoCivil) { setError('Estado civil é obrigatório'); return; }
    if (!form.fonteRenda) { setError('Fonte de renda é obrigatória'); return; }
    if (form.cep.trim() && cepDigits(form.cep).length !== 8) { setError('CEP deve ter 8 dígitos'); return; }

    setLoading(true);
    setError('');

    try {
      await api.patch('/me/onboarding', {
        name: form.name.trim(),
        surname: form.surname.trim() || undefined,
        cpf: form.cpf.trim() || undefined,
        rg: form.rg.trim() || undefined,
        telefone: form.telefone.trim() || undefined,
        dataNascimento: form.dataNascimento || undefined,
        cep: form.cep.trim() ? cepDigits(form.cep) : undefined,
        // ficha completa: o endereço em partes (o servidor monta o texto)
        logradouro: form.logradouro.trim() || undefined,
        numero: form.numero.trim() || undefined,
        complemento: form.complemento.trim() || undefined,
        bairro: form.bairro.trim() || undefined,
        cidade: form.cidade.trim() || undefined,
        uf: form.uf || undefined,
        // antes a ficha pedia e não enviava: ficam no cliente e nos processos dele
        estadoCivil: form.estadoCivil,
        fonteRenda: form.fonteRenda,
      });
      // Recarrega para o /me trazer onboardingCompleted = true (AUTH-08)
      window.location.replace('/cliente');
    } catch {
      setError('Erro ao salvar. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-md p-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Ficha Cadastral</h1>
          <p className="text-sm text-gray-500 mt-1">
            Preencha seus dados para iniciar o processo de financiamento.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Dados pessoais</legend>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                <input type="text" value={form.name} onChange={set('name')} required autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
                <input type="text" value={form.surname} onChange={set('surname')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CPF</label>
                <input type="text" value={form.cpf} onChange={set('cpf')} placeholder="000.000.000-00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">RG</label>
                <input type="text" value={form.rg} onChange={set('rg')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                <input type="tel" value={form.telefone} onChange={set('telefone')} placeholder="(11) 99999-9999"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de nascimento</label>
                <input type="date" value={form.dataNascimento} onChange={set('dataNascimento')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado civil *</label>
              <select value={form.estadoCivil} onChange={set('estadoCivil')} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">Selecione</option>
                <option value="solteiro">Solteiro(a)</option>
                <option value="casado">Casado(a)</option>
                <option value="divorciado">Divorciado(a)</option>
                <option value="viuvo">Viúvo(a)</option>
                <option value="uniao_estavel">União Estável</option>
              </select>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Renda</legend>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fonte de renda *</label>
              <select value={form.fonteRenda} onChange={set('fonteRenda')} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">Selecione</option>
                <option value="assalariado">Assalariado(a)</option>
                <option value="nao_assalariado">Não assalariado(a) / Autônomo</option>
              </select>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Endereço</legend>
            {/* PROD-06: o CEP preenche o endereço; número e complemento continuam editáveis */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="onb-cep" className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
                <input id="onb-cep" type="text" inputMode="numeric" maxLength={9} value={form.cep}
                  placeholder="00000-000"
                  onChange={e => {
                    const v = e.target.value;
                    setForm(prev => ({ ...prev, cep: v }));
                    cep.buscar(v, (_texto, e) => setForm(prev => ({ ...prev, logradouro: e.logradouro, bairro: e.bairro, cidade: e.cidade, uf: e.uf })));
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <label htmlFor="onb-logradouro" className="block text-sm font-medium text-gray-700 mb-1">Logradouro</label>
                <input id="onb-logradouro" type="text" maxLength={255} value={form.logradouro} onChange={set('logradouro')}
                  placeholder="Rua, avenida..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {([['numero', 'Número', 20], ['complemento', 'Complemento', 120], ['bairro', 'Bairro', 120]] as const).map(([k, label, max]) => (
                <div key={k}>
                  <label htmlFor={`onb-${k}`} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input id={`onb-${k}`} type="text" maxLength={max} value={form[k]} onChange={set(k)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="onb-cidade" className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
                <input id="onb-cidade" type="text" maxLength={120} value={form.cidade} onChange={set('cidade')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="onb-uf" className="block text-sm font-medium text-gray-700 mb-1">UF</label>
                <select id="onb-uf" value={form.uf} onChange={set('uf')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">—</option>
                  {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>
            </div>
            {cep.mensagem && (
              <p role="status" className={`text-xs ${cep.estado === 'ok' || cep.estado === 'buscando' ? 'text-gray-500' : 'text-amber-700'}`}>
                {cep.mensagem}
              </p>
            )}
          </fieldset>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors cursor-pointer">
            {loading ? 'Salvando...' : 'Confirmar e entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
