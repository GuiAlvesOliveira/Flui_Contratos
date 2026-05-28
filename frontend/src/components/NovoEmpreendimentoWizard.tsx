import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 1 | 2;

interface EmpForm {
  nome: string; matriculaMae: string; endereco: string; cep: string;
  bancoFinanciador: string; construtoraInfo: string; incorporadoraContato: string;
}

interface Props {
  onClose: () => void;
  onSuccess: (empId: string) => void;
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1 as Step, label: 'Empreendimento' },
  { n: 2 as Step, label: 'Unidade' },
];

function StepBar({ current }: { current: Step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 24px 16px', borderBottom: '1px solid var(--border)' }}>
      {STEPS.map((s, i) => (
        <div key={s.n} style={{ display: 'contents' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600, flexShrink: 0,
              background: current > s.n ? 'var(--accent)' : current === s.n ? 'var(--accent)' : 'var(--surface-elevated)',
              color: current >= s.n ? '#fff' : 'var(--text-faint)',
              border: current < s.n ? '1px solid var(--border)' : 'none',
            }}>
              {current > s.n ? '✓' : s.n}
            </div>
            <span style={{
              fontSize: 12,
              color: current === s.n ? 'var(--text)' : 'var(--text-faint)',
              fontWeight: current === s.n ? 500 : 400,
            }}>
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex: 1, height: 1, background: 'var(--border)', margin: '0 10px' }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Field helper ───────────────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="ds-field" style={{ marginBottom: 0 }}>
      <label>
        {label}
        {required && <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function NovoEmpreendimentoWizard({ onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [empId, setEmpId] = useState('');
  const [error, setError] = useState('');

  const [empForm, setEmpForm] = useState<EmpForm>({
    nome: '', matriculaMae: '', endereco: '', cep: '',
    bancoFinanciador: '', construtoraInfo: '', incorporadoraContato: '',
  });

  const [unidadeForm, setUnidadeForm] = useState({ identificacao: '', valor: '' });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const empMut = useMutation({
    mutationFn: () => api.post('/empreendimentos', {
      nome: empForm.nome.trim(),
      matriculaMae: empForm.matriculaMae.trim(),
      endereco: empForm.endereco.trim(),
      cep: empForm.cep.trim(),
      bancoFinanciador: empForm.bancoFinanciador.trim(),
      construtoraInfo: empForm.construtoraInfo.trim() || undefined,
      incorporadoraContato: empForm.incorporadoraContato.trim() || undefined,
    }),
    onSuccess: (res) => {
      setEmpId(res.data.id);
      void qc.invalidateQueries({ queryKey: ['empreendimentos'] });
      setStep(2);
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const parseVal = (s: string) => {
    const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? undefined : n;
  };

  const unidadeMut = useMutation({
    mutationFn: () => api.post('/unidades', {
      empreendimentoId: empId,
      identificacao: unidadeForm.identificacao.trim(),
      valor: parseVal(unidadeForm.valor),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['unidades'] });
      onSuccess(empId);
    },
    onError: (e: Error) => setError(e.message),
  });

  // ── Validation ────────────────────────────────────────────────────────────────

  const canStep1 = !!(empForm.nome && empForm.matriculaMae && empForm.endereco && empForm.cep && empForm.bancoFinanciador);
  const canStep2 = !!unidadeForm.identificacao.trim();

  const setEmp = (k: keyof EmpForm, v: string) => setEmpForm(f => ({ ...f, [k]: v }));

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="ds-drawer-backdrop open" onClick={onClose} />
      <div className="ds-drawer open" style={{ width: 480 }}>

        <div className="ds-drawer-hdr">
          <h2>Novo Empreendimento</h2>
          <button className="ds-btn ghost sm" onClick={onClose}><Icon.X size={14} /></button>
        </div>

        <StepBar current={step} />

        <div className="ds-drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ── STEP 1: Empreendimento ─────────────────────────────────── */}
          {step === 1 && (
            <>
              <Field label="Nome do Empreendimento" required>
                <div className="ds-input">
                  <input placeholder="Ex: Residencial Parque Verde" value={empForm.nome}
                    onChange={e => setEmp('nome', e.target.value)} style={{ flex: 1 }} autoFocus />
                </div>
              </Field>
              <Field label="Matrícula Mãe" required>
                <div className="ds-input">
                  <input placeholder="Ex: 12345" value={empForm.matriculaMae}
                    onChange={e => setEmp('matriculaMae', e.target.value)} style={{ flex: 1 }} />
                </div>
              </Field>
              <Field label="Endereço" required>
                <div className="ds-input">
                  <input placeholder="Rua, número, bairro, cidade" value={empForm.endereco}
                    onChange={e => setEmp('endereco', e.target.value)} style={{ flex: 1 }} />
                </div>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="CEP" required>
                  <div className="ds-input">
                    <input placeholder="00000-000" value={empForm.cep}
                      onChange={e => setEmp('cep', e.target.value)} style={{ flex: 1 }} />
                  </div>
                </Field>
                <Field label="Banco Financiador" required>
                  <div className="ds-input">
                    <input placeholder="Ex: CEF" value={empForm.bancoFinanciador}
                      onChange={e => setEmp('bancoFinanciador', e.target.value)} style={{ flex: 1 }} />
                  </div>
                </Field>
              </div>
              <Field label="Construtora">
                <div className="ds-input">
                  <input placeholder="Opcional" value={empForm.construtoraInfo}
                    onChange={e => setEmp('construtoraInfo', e.target.value)} style={{ flex: 1 }} />
                </div>
              </Field>
              <Field label="Contato Incorporadora">
                <div className="ds-input">
                  <input placeholder="Opcional" value={empForm.incorporadoraContato}
                    onChange={e => setEmp('incorporadoraContato', e.target.value)} style={{ flex: 1 }} />
                </div>
              </Field>
            </>
          )}

          {/* ── STEP 2: Unidade ───────────────────────────────────────── */}
          {step === 2 && (
            <>
              <div style={{ padding: '10px 12px', background: 'var(--surface-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
                <Icon.Building size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--accent)' }} />
                Empreendimento criado. Adicione a primeira unidade ou pule para concluir.
              </div>
              <Field label="Identificação da Unidade" required>
                <div className="ds-input">
                  <input placeholder="Ex: Apto 101, Casa 5, Lote 12"
                    value={unidadeForm.identificacao}
                    onChange={e => setUnidadeForm(f => ({ ...f, identificacao: e.target.value }))}
                    style={{ flex: 1 }} autoFocus />
                </div>
              </Field>
              <Field label="Valor da Unidade (R$)">
                <div className="ds-input">
                  <input placeholder="0,00" value={unidadeForm.valor}
                    onChange={e => setUnidadeForm(f => ({ ...f, valor: e.target.value }))}
                    style={{ flex: 1 }} />
                </div>
              </Field>
            </>
          )}

          {error && (
            <div className="ds-alert urgent" style={{ marginTop: 4 }}>
              <Icon.AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="ds-drawer-foot">
          <button className="ds-btn ghost" onClick={onClose}>Cancelar</button>

          {step === 1 && (
            <button className="ds-btn accent"
              disabled={!canStep1 || empMut.isPending}
              onClick={() => { setError(''); empMut.mutate(); }}>
              {empMut.isPending ? 'Criando...' : 'Próximo →'}
            </button>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="ds-btn ghost"
                onClick={() => onSuccess(empId)}>
                Pular etapa
              </button>
              <button className="ds-btn accent"
                disabled={!canStep2 || unidadeMut.isPending}
                onClick={() => { setError(''); unidadeMut.mutate(); }}>
                {unidadeMut.isPending ? 'Criando...' : 'Concluir'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
