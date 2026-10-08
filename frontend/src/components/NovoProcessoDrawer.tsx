import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';
import { LINEAR_STAGES, STAGE_LABELS, type ProcessStage } from '../lib/processStages';

// ── Types ──────────────────────────────────────────────────────────────────────

interface User { id: string; name: string | null; email: string; cpf: string | null }
interface Empreendimento { id: string; nome: string; bancoFinanciador: string }
interface Unidade { id: string; identificacao: string; valor: number | null }

interface FormState {
  clienteId: string;
  analistaId: string;
  empreendimentoId: string;
  unidadeId: string;
  valorUnidade: string;
  valorEmAberto: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(v: number | null) {
  if (!v) return '';
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(v);
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onSuccess: (processId: string) => void;
  // FE-25: aberto pela coluna do Kanban, o processo já vai para esta etapa
  initialStage?: ProcessStage;
}

export function NovoProcessoDrawer({ onClose, onSuccess, initialStage }: Props) {
  const qc = useQueryClient();
  const [moveError, setMoveError] = useState<{ id: string; message: string } | null>(null);

  const [form, setForm] = useState<FormState>({
    clienteId: '',
    analistaId: '',
    empreendimentoId: '',
    unidadeId: '',
    valorUnidade: '',
    valorEmAberto: '',
  });

  const { data: clientes = [] } = useQuery<User[]>({
    queryKey: ['users', 'cliente'],
    queryFn: () => api.get('/users', { params: { role: 'cliente' } }).then(r => r.data),
  });

  const { data: analistas = [] } = useQuery<User[]>({
    queryKey: ['users', 'analista'],
    queryFn: () => api.get('/users', { params: { role: 'analista' } }).then(r => r.data),
  });

  const { data: empreendimentos = [] } = useQuery<Empreendimento[]>({
    queryKey: ['empreendimentos'],
    queryFn: () => api.get('/empreendimentos').then(r => r.data),
  });

  const { data: unidades = [] } = useQuery<Unidade[]>({
    queryKey: ['unidades', form.empreendimentoId],
    queryFn: () => api.get('/unidades', { params: { empreendimentoId: form.empreendimentoId } }).then(r => r.data),
    enabled: !!form.empreendimentoId,
  });

  // Auto-fill valor when unidade is selected
  useEffect(() => {
    if (!form.unidadeId) return;
    const u = unidades.find(u => u.id === form.unidadeId);
    if (u?.valor) {
      setForm(f => ({ ...f, valorUnidade: formatCurrency(u.valor) }));
    }
  }, [form.unidadeId, unidades]);

  // Reset unidade when empreendimento changes
  useEffect(() => {
    setForm(f => ({ ...f, unidadeId: '', valorUnidade: '' }));
  }, [form.empreendimentoId]);

  const createMut = useMutation({
    mutationFn: async () => {
      const parseVal = (s: string) => {
        const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
        return isNaN(n) ? undefined : n;
      };
      const res = await api.post('/processes', {
        clientId: form.clienteId,
        analistaId: form.analistaId || undefined,
        unidadeId: form.unidadeId || undefined,
        valorUnidade: parseVal(form.valorUnidade),
        valorEmAberto: parseVal(form.valorEmAberto),
      });
      const id = res.data.id as string;
      // O processo nasce em Primeiro Contato e segue pelas mesmas mudanças de
      // etapa da API (máquina de estados, log de auditoria e notificação).
      const target = initialStage ? LINEAR_STAGES.indexOf(initialStage) : 0;
      for (const toStage of LINEAR_STAGES.slice(1, target + 1)) {
        try {
          await api.patch(`/processes/${id}/stage`, { toStage });
        } catch (e) {
          const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
          const detail = Array.isArray(msg) ? msg.join('; ') : (msg ?? 'erro desconhecido');
          return { id, moveError: `O processo foi criado, mas não entrou em ${STAGE_LABELS[toStage]}: ${detail}` };
        }
      }
      return { id, moveError: null };
    },
    onSuccess: ({ id, moveError: error }) => {
      qc.invalidateQueries({ queryKey: ['processes'] });
      if (error) setMoveError({ id, message: error });
      else onSuccess(id);
    },
  });

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }));

  const canSubmit = !!form.clienteId;

  return (
    <>
      {/* Backdrop */}
      <div className="ds-drawer-backdrop open" onClick={onClose} />

      {/* Drawer */}
      <div className="ds-drawer open" style={{ width: 440 }}>
        <div className="ds-drawer-hdr">
          <h2>Novo Processo</h2>
          <button className="ds-btn ghost sm" onClick={onClose}>
            <Icon.X size={14} />
          </button>
        </div>

        <div className="ds-drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {initialStage && initialStage !== 'inicial' && (
            <div className="ds-alert info" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
              <div className="ds-alert-icon"><Icon.Info size={14} /></div>
              <div className="ds-alert-desc">
                O processo entra em <strong>{STAGE_LABELS[initialStage]}</strong>. A mudança de etapa fica no
                log de auditoria e o cliente é notificado.
              </div>
            </div>
          )}

          {/* Cliente */}
          <div className="ds-field">
            <label>Proponente / Cliente <span style={{ color: 'var(--red)' }}>*</span></label>
            <select
              className="ds-input"
              value={form.clienteId}
              onChange={e => set('clienteId', e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">Selecionar cliente...</option>
              {clientes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.email}{c.cpf ? ` · ${c.cpf}` : ''}
                </option>
              ))}
            </select>
            {clientes.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>
                Nenhum cliente cadastrado. Use <strong>Configurações → Usuários</strong> para adicionar.
              </div>
            )}
          </div>

          {/* Analista */}
          <div className="ds-field">
            <label>Analista Responsável</label>
            <select
              className="ds-input"
              value={form.analistaId}
              onChange={e => set('analistaId', e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— Sem analista designado —</option>
              {analistas.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.email}
                </option>
              ))}
            </select>
          </div>

          <div className="ds-divider" />

          {/* Empreendimento */}
          <div className="ds-field">
            <label>Empreendimento</label>
            <select
              className="ds-input"
              value={form.empreendimentoId}
              onChange={e => set('empreendimentoId', e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— Sem empreendimento —</option>
              {empreendimentos.map(e => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>

          {/* Unidade (só aparece se empreendimento selecionado) */}
          {form.empreendimentoId && (
            <div className="ds-field">
              <label>Unidade</label>
              <select
                className="ds-input"
                value={form.unidadeId}
                onChange={e => set('unidadeId', e.target.value)}
                style={{ width: '100%' }}
                disabled={unidades.length === 0}
              >
                <option value="">— Selecionar unidade —</option>
                {unidades.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.identificacao}{u.valor ? ` · R$ ${formatCurrency(u.valor)}` : ''}
                  </option>
                ))}
              </select>
              {unidades.length === 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>
                  Nenhuma unidade cadastrada neste empreendimento.
                </div>
              )}
            </div>
          )}

          <div className="ds-divider" />

          {/* Valores */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="ds-field">
              <label>Valor da Unidade (R$)</label>
              <div className="ds-input">
                <input
                  placeholder="0,00"
                  value={form.valorUnidade}
                  onChange={e => set('valorUnidade', e.target.value)}
                />
              </div>
            </div>
            <div className="ds-field">
              <label>Valor em Aberto (R$)</label>
              <div className="ds-input">
                <input
                  placeholder="0,00"
                  value={form.valorEmAberto}
                  onChange={e => set('valorEmAberto', e.target.value)}
                />
              </div>
            </div>
          </div>

          {createMut.isError && (
            <div className="ds-alert urgent">
              <Icon.AlertTriangle size={14} />
              <span>Erro ao criar processo. Verifique os dados e tente novamente.</span>
            </div>
          )}
          {moveError && (
            <div className="ds-alert urgent" role="alert">
              <Icon.AlertTriangle size={14} />
              <span>{moveError.message}</span>
            </div>
          )}
        </div>

        <div className="ds-drawer-foot">
          {moveError ? (
            <button className="ds-btn accent" onClick={() => onSuccess(moveError.id)}>
              Abrir processo
            </button>
          ) : (
            <>
              <button className="ds-btn ghost" onClick={onClose}>Cancelar</button>
              <button
                className="ds-btn accent"
                onClick={() => createMut.mutate()}
                disabled={!canSubmit || createMut.isPending}
              >
                {createMut.isPending ? 'Criando...' : 'Criar Processo'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
