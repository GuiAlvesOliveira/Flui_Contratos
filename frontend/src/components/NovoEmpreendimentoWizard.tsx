import { Fragment, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

interface EmpForm {
  nome: string; matriculaMae: string; endereco: string; cep: string;
  bancoFinanciador: string; construtoraInfo: string; incorporadoraContato: string;
}

interface UnidadeDraft { key: number; identificacao: string; valor: string }

interface Props {
  onClose: () => void;
  onSuccess: (empId: string) => void;
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1 as Step, label: 'Empreendimento' },
  { n: 2 as Step, label: 'Unidades' },
  { n: 3 as Step, label: 'Confirmação' },
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

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// "350.000,00" → 350000; empty/invalid → undefined
function parseVal(s: string): number | undefined {
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? undefined : n;
}

function formatCurrency(v: number | undefined) {
  if (v === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function apiError(e: unknown): string {
  const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? (e instanceof Error ? e.message : 'Erro desconhecido');
}

// ── Main component ─────────────────────────────────────────────────────────────

// Nothing is saved until the confirmation step: the empreendimento and its
// unidades are only created when the user confirms the summary.
export function NovoEmpreendimentoWizard({ onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState('');

  const [empForm, setEmpForm] = useState<EmpForm>({
    nome: '', matriculaMae: '', endereco: '', cep: '',
    bancoFinanciador: '', construtoraInfo: '', incorporadoraContato: '',
  });
  const [unidades, setUnidades] = useState<UnidadeDraft[]>([{ key: 1, identificacao: '', valor: '' }]);
  const [nextKey, setNextKey] = useState(2);

  // Save progress — kept so a retry never creates the empreendimento (or a unidade) twice.
  const [saving, setSaving] = useState(false);
  const [empId, setEmpId] = useState('');
  const [createdKeys, setCreatedKeys] = useState<number[]>([]);
  const [unitErrors, setUnitErrors] = useState<Record<number, string>>({});

  // ── Validation ────────────────────────────────────────────────────────────────

  const cepLen = empForm.cep.trim().length;
  const canStep1 = !!(empForm.nome.trim() && empForm.matriculaMae.trim() && empForm.endereco.trim() &&
    empForm.bancoFinanciador.trim()) && cepLen >= 8 && cepLen <= 10;
  // A row is either left blank (ignored) or has an identificação.
  const incompleteRow = unidades.some(u => !u.identificacao.trim() && u.valor.trim());
  const filledUnidades = unidades.filter(u => u.identificacao.trim());

  const setEmp = (k: keyof EmpForm, v: string) => setEmpForm(f => ({ ...f, [k]: v }));
  const setUnidade = (key: number, patch: Partial<UnidadeDraft>) =>
    setUnidades(list => list.map(u => (u.key === key ? { ...u, ...patch } : u)));
  const addUnidade = () => {
    setUnidades(list => [...list, { key: nextKey, identificacao: '', valor: '' }]);
    setNextKey(k => k + 1);
  };
  const removeUnidade = (key: number) => setUnidades(list => list.filter(u => u.key !== key));

  // ── Save (confirmation step) ──────────────────────────────────────────────────

  const confirm = async () => {
    setSaving(true);
    setError('');

    let id = empId;
    if (!id) {
      try {
        const res = await api.post('/empreendimentos', {
          nome: empForm.nome.trim(),
          matriculaMae: empForm.matriculaMae.trim(),
          endereco: empForm.endereco.trim(),
          cep: empForm.cep.trim(),
          bancoFinanciador: empForm.bancoFinanciador.trim(),
          construtoraInfo: empForm.construtoraInfo.trim() || undefined,
          incorporadoraContato: empForm.incorporadoraContato.trim() || undefined,
        });
        id = res.data.id as string;
        setEmpId(id);
        void qc.invalidateQueries({ queryKey: ['empreendimentos'] });
      } catch (e) {
        setError(apiError(e));
        setSaving(false);
        return;
      }
    }

    const created = [...createdKeys];
    const failed: Record<number, string> = {};
    for (const u of filledUnidades) {
      if (created.includes(u.key)) continue;
      try {
        await api.post('/unidades', {
          empreendimentoId: id,
          identificacao: u.identificacao.trim(),
          valor: parseVal(u.valor),
        });
        created.push(u.key);
      } catch (e) {
        failed[u.key] = apiError(e);
      }
    }
    setCreatedKeys(created);
    setUnitErrors(failed);
    if (filledUnidades.length > 0) void qc.invalidateQueries({ queryKey: ['unidades'] });
    setSaving(false);

    const failures = Object.keys(failed).length;
    if (failures === 0) {
      onSuccess(id);
    } else {
      setError(`O empreendimento foi criado, mas ${failures} unidade(s) não foram salvas.`);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const kvRows = [
    { label: 'Nome', value: empForm.nome.trim() },
    { label: 'Matrícula mãe', value: empForm.matriculaMae.trim() },
    { label: 'Endereço', value: empForm.endereco.trim() },
    { label: 'CEP', value: empForm.cep.trim() },
    { label: 'Banco', value: empForm.bancoFinanciador.trim() },
    { label: 'Construtora', value: empForm.construtoraInfo.trim() || '—' },
    { label: 'Incorporadora', value: empForm.incorporadoraContato.trim() || '—' },
  ];
  const total = filledUnidades.reduce((sum, u) => sum + (parseVal(u.valor) ?? 0), 0);
  const hasUnitErrors = Object.keys(unitErrors).length > 0;

  return (
    <>
      <div className="ds-drawer-backdrop open" onClick={saving ? undefined : onClose} />
      <div className="ds-drawer open" style={{ width: 480 }}>

        <div className="ds-drawer-hdr">
          <h2>Novo Empreendimento</h2>
          <button className="ds-btn ghost sm" onClick={onClose} disabled={saving}><Icon.X size={14} /></button>
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
              {cepLen > 0 && (cepLen < 8 || cepLen > 10) && (
                <div style={{ fontSize: 11.5, color: 'var(--red)' }}>CEP deve ter 8 dígitos (com ou sem hífen).</div>
              )}
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

          {/* ── STEP 2: Unidades ──────────────────────────────────────── */}
          {step === 2 && (
            <>
              <div style={{ padding: '10px 12px', background: 'var(--surface-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
                <Icon.Building size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--accent)' }} />
                Adicione as unidades agora ou deixe em branco para cadastrar depois.
              </div>
              {unidades.map((u, idx) => (
                <div key={u.key} style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: 8, alignItems: 'end' }}>
                  <Field label={idx === 0 ? 'Identificação' : ''}>
                    <div className="ds-input">
                      <input placeholder="Ex: Apto 101, Casa 5, Lote 12" value={u.identificacao}
                        onChange={e => setUnidade(u.key, { identificacao: e.target.value })}
                        style={{ flex: 1 }} autoFocus={idx === 0} />
                    </div>
                  </Field>
                  <Field label={idx === 0 ? 'Valor (R$)' : ''}>
                    <div className="ds-input">
                      <input placeholder="0,00" value={u.valor}
                        onChange={e => setUnidade(u.key, { valor: e.target.value })} style={{ flex: 1 }} />
                    </div>
                  </Field>
                  <button className="ds-btn ghost sm" title="Remover unidade"
                    disabled={unidades.length === 1} onClick={() => removeUnidade(u.key)}>
                    <Icon.Trash size={13} />
                  </button>
                </div>
              ))}
              <button className="ds-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={addUnidade}>
                <Icon.Plus size={12} /> Adicionar unidade
              </button>
              {incompleteRow && (
                <div style={{ fontSize: 11.5, color: 'var(--red)' }}>Informe a identificação das unidades com valor preenchido.</div>
              )}
            </>
          )}

          {/* ── STEP 3: Confirmação ───────────────────────────────────── */}
          {step === 3 && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Confira os dados antes de criar. Nada foi salvo ainda.
              </div>
              <div className="ds-card">
                <div className="ds-card-hdr">Empreendimento</div>
                <div className="ds-card-body">
                  <dl className="ds-kv" style={{ margin: 0 }}>
                    {kvRows.map(r => (
                      <Fragment key={r.label}>
                        <dt>{r.label}</dt>
                        <dd style={{ margin: 0 }}>{r.value}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </div>
              </div>
              <div className="ds-card">
                <div className="ds-card-hdr">
                  Unidades ({filledUnidades.length})
                </div>
                {filledUnidades.length === 0 ? (
                  <div className="ds-card-body" style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
                    Nenhuma unidade — dá para cadastrar depois, na página do empreendimento.
                  </div>
                ) : (
                  <table className="ds-table">
                    <thead>
                      <tr><th>Identificação</th><th style={{ textAlign: 'right' }}>Valor</th><th></th></tr>
                    </thead>
                    <tbody>
                      {filledUnidades.map(u => (
                        <tr key={u.key}>
                          <td>
                            {u.identificacao.trim()}
                            {unitErrors[u.key] && (
                              <div style={{ fontSize: 11, color: 'var(--red)' }}>{unitErrors[u.key]}</div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(parseVal(u.valor))}</td>
                          <td style={{ width: 20 }}>
                            {createdKeys.includes(u.key) && <Icon.Check size={13} style={{ color: 'var(--green, #16a34a)' }} />}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ fontWeight: 500 }}>Total</td>
                        <td style={{ textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(total)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
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
          <button className="ds-btn ghost" onClick={onClose} disabled={saving}>
            {empId ? 'Fechar' : 'Cancelar'}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step > 1 && !empId && (
              <button className="ds-btn ghost" disabled={saving}
                onClick={() => { setError(''); setStep((step - 1) as Step); }}>
                ← Voltar
              </button>
            )}

            {step === 1 && (
              <button className="ds-btn accent" disabled={!canStep1} onClick={() => setStep(2)}>
                Próximo →
              </button>
            )}

            {step === 2 && (
              <button className="ds-btn accent" disabled={incompleteRow} onClick={() => setStep(3)}>
                Próximo →
              </button>
            )}

            {step === 3 && hasUnitErrors && !saving && (
              <button className="ds-btn ghost" onClick={() => onSuccess(empId)}>
                Concluir sem essas unidades
              </button>
            )}

            {step === 3 && (
              <button className="ds-btn accent" disabled={saving} onClick={() => void confirm()}>
                {saving ? 'Criando...' : hasUnitErrors ? 'Tentar de novo' : 'Criar empreendimento'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
