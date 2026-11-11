import { useState } from 'react';
import { api } from '../api/axiosInstance';
import { cepDigits } from '../lib/cep';
import { useCepLookup } from '../lib/useCepLookup';
import { UFS } from '../lib/ficha';
import { AuthLayout } from '../components/AuthLayout';

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
    <AuthLayout title="Ficha Cadastral" subtitle="Preencha seus dados para iniciar o processo de financiamento." wide>
      <form onSubmit={handleSubmit} className="ds-auth-form">
        <fieldset>
          <legend>Dados pessoais</legend>

          <div className="ds-auth-grid">
            <div>
              <label>Nome *</label>
              <input type="text" value={form.name} onChange={set('name')} required autoFocus
                className="ds-auth-input" />
            </div>
            <div>
              <label>Sobrenome</label>
              <input type="text" value={form.surname} onChange={set('surname')}
                className="ds-auth-input" />
            </div>
          </div>

          <div className="ds-auth-grid">
            <div>
              <label>CPF</label>
              <input type="text" value={form.cpf} onChange={set('cpf')} placeholder="000.000.000-00"
                className="ds-auth-input" />
            </div>
            <div>
              <label>RG</label>
              <input type="text" value={form.rg} onChange={set('rg')}
                className="ds-auth-input" />
            </div>
          </div>

          <div className="ds-auth-grid">
            <div>
              <label>Telefone</label>
              <input type="tel" value={form.telefone} onChange={set('telefone')} placeholder="(11) 99999-9999"
                className="ds-auth-input" />
            </div>
            <div>
              <label>Data de nascimento</label>
              <input type="date" value={form.dataNascimento} onChange={set('dataNascimento')}
                className="ds-auth-input" />
            </div>
          </div>

          <div>
            <label>Estado civil *</label>
            <select value={form.estadoCivil} onChange={set('estadoCivil')} required
              className="ds-auth-input">
              <option value="">Selecione</option>
              <option value="solteiro">Solteiro(a)</option>
              <option value="casado">Casado(a)</option>
              <option value="divorciado">Divorciado(a)</option>
              <option value="viuvo">Viúvo(a)</option>
              <option value="uniao_estavel">União Estável</option>
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend>Renda</legend>

          <div>
            <label>Fonte de renda *</label>
            <select value={form.fonteRenda} onChange={set('fonteRenda')} required
              className="ds-auth-input">
              <option value="">Selecione</option>
              <option value="assalariado">Assalariado(a)</option>
              <option value="nao_assalariado">Não assalariado(a) / Autônomo</option>
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend>Endereço</legend>
          {/* PROD-06: o CEP preenche o endereço; número e complemento continuam editáveis */}
          <div className="ds-auth-grid cols-3">
            <div>
              <label htmlFor="onb-cep">CEP</label>
              <input id="onb-cep" type="text" inputMode="numeric" maxLength={9} value={form.cep}
                placeholder="00000-000"
                onChange={e => {
                  const v = e.target.value;
                  setForm(prev => ({ ...prev, cep: v }));
                  cep.buscar(v, (_texto, e) => setForm(prev => ({ ...prev, logradouro: e.logradouro, bairro: e.bairro, cidade: e.cidade, uf: e.uf })));
                }}
                className="ds-auth-input" />
            </div>
            <div className="span-2">
              <label htmlFor="onb-logradouro">Logradouro</label>
              <input id="onb-logradouro" type="text" maxLength={255} value={form.logradouro} onChange={set('logradouro')}
                placeholder="Rua, avenida..."
                className="ds-auth-input" />
            </div>
          </div>
          <div className="ds-auth-grid cols-3">
            {([['numero', 'Número', 20], ['complemento', 'Complemento', 120], ['bairro', 'Bairro', 120]] as const).map(([k, label, max]) => (
              <div key={k}>
                <label htmlFor={`onb-${k}`}>{label}</label>
                <input id={`onb-${k}`} type="text" maxLength={max} value={form[k]} onChange={set(k)}
                  className="ds-auth-input" />
              </div>
            ))}
          </div>
          <div className="ds-auth-grid cols-3">
            <div className="span-2">
              <label htmlFor="onb-cidade">Cidade</label>
              <input id="onb-cidade" type="text" maxLength={120} value={form.cidade} onChange={set('cidade')}
                className="ds-auth-input" />
            </div>
            <div>
              <label htmlFor="onb-uf">UF</label>
              <select id="onb-uf" value={form.uf} onChange={set('uf')}
                className="ds-auth-input">
                <option value="">—</option>
                {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </div>
          </div>
          {cep.mensagem && (
            <p role="status" className={`ds-auth-hint ${cep.estado === 'ok' || cep.estado === 'buscando' ? '' : 'warn'}`}>
              {cep.mensagem}
            </p>
          )}
        </fieldset>

        {error && <p role="alert" className="ds-auth-msg error">{error}</p>}

        <button type="submit" disabled={loading}
          className="ds-auth-btn">
          {loading ? 'Salvando...' : 'Confirmar e entrar'}
        </button>
      </form>
    </AuthLayout>
  );
}
