import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';
import { NovoProcessoDrawer } from '../components/NovoProcessoDrawer';
import { useAuth } from '../auth/useAuth';

// ── Types ─────────────────────────────────────────────────────────────────────

type ProcessStage =
  | 'inicial' | 'cadastro' | 'analise_credito' | 'credito_aprovado'
  | 'analise_juridica' | 'juridico_aprovado' | 'cartorio' | 'assinatura'
  | 'cliente_inativo' | 'credito_recusado' | 'processo_pendencia';

interface ProcessUser { id: string; name: string | null; email: string }
interface ProcessCard {
  id: string;
  stage: ProcessStage;
  clientId: string;
  client: ProcessUser;
  analista: ProcessUser | null;
  valorUnidade: number | null;
  valorEmAberto: number | null;
  updatedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<ProcessStage, string> = {
  inicial: 'Primeiro Contato',
  cadastro: 'Cadastro',
  analise_credito: 'Análise de Crédito',
  credito_aprovado: 'Crédito Aprovado',
  analise_juridica: 'Análise Jurídica',
  juridico_aprovado: 'Jurídico Aprovado',
  cartorio: 'Cartório',
  assinatura: 'Assinatura',
  cliente_inativo: 'Inativo',
  credito_recusado: 'Crédito Recusado',
  processo_pendencia: 'Pendência',
};

const STAGE_COLORS: Record<ProcessStage, string> = {
  inicial: '#71717a',
  cadastro: '#0ea5e9',
  analise_credito: '#f59e0b',
  credito_aprovado: '#22c55e',
  analise_juridica: '#7c3aed',
  juridico_aprovado: '#16a34a',
  cartorio: '#2563eb',
  assinatura: '#059669',
  cliente_inativo: '#a1a1aa',
  credito_recusado: '#dc2626',
  processo_pendencia: '#d97706',
};

const STAGE_PROGRESS: Record<ProcessStage, number> = {
  inicial: 5,
  cadastro: 18,
  analise_credito: 32,
  credito_aprovado: 46,
  analise_juridica: 60,
  juridico_aprovado: 74,
  cartorio: 88,
  assinatura: 100,
  cliente_inativo: 0,
  credito_recusado: 0,
  processo_pendencia: 0,
};

const MAIN_STAGES: ProcessStage[] = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
];

const SIDE_STAGES: ProcessStage[] = ['cliente_inativo', 'credito_recusado', 'processo_pendencia'];

const ALL_SELECTABLE_STAGES: ProcessStage[] = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
  'cliente_inativo', 'credito_recusado', 'processo_pendencia',
];

const MOTIVO_INATIVIDADE_OPTIONS = [
  { value: 'recursos_proprios', label: 'Quitará por recursos próprios' },
  { value: 'outra_assessoria', label: 'Seguirá com outra assessoria' },
  { value: 'sozinho', label: 'Seguirá sozinho' },
  { value: 'nao_atendeu', label: 'Não atendeu' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | null, email: string): string {
  const src = name ?? email;
  return src.split(/[\s@]/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// ── Advance Stage Drawer ──────────────────────────────────────────────────────

interface AdvanceDrawerProps {
  process: ProcessCard;
  onClose: () => void;
}

function AdvanceDrawer({ process, onClose }: AdvanceDrawerProps) {
  const queryClient = useQueryClient();
  const otherStages = ALL_SELECTABLE_STAGES.filter(s => s !== process.stage);
  const [toStage, setToStage] = useState<ProcessStage>(otherStages[0]);
  const [motivoInatividade, setMotivoInatividade] = useState('recursos_proprios');
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.patch(`/processes/${process.id}/stage`, body).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['processes'] });
      void queryClient.invalidateQueries({ queryKey: ['process', process.id] });
      void queryClient.invalidateQueries({ queryKey: ['audit', process.id] });
      onClose();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e?.response?.data?.message ?? 'Erro ao mover etapa');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, string> = { toStage };
    if (toStage === 'cliente_inativo') body.motivoInatividade = motivoInatividade;
    if (toStage === 'credito_recusado') body.motivoRecusa = motivoRecusa;
    mutation.mutate(body);
  };

  return (
    <>
      <div className="ds-drawer-backdrop open" onClick={onClose} />
      <div className="ds-drawer open">
        <div className="ds-drawer-hdr">
          <Icon.Layout size={16} style={{ color: 'var(--accent)' }} />
          <h2>Mover etapa</h2>
          <button className="ds-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
            <Icon.X size={14} />
          </button>
        </div>

        <div className="ds-drawer-body">
          <div style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            padding: '10px 12px',
            background: 'var(--bg-subtle)',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #c084fc, #7c3aed)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
            }}>
              {initials(process.client.name, process.client.email)}
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{process.client.name ?? process.client.email}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Etapa atual:{' '}
                <span className="ds-badge" style={{ color: STAGE_COLORS[process.stage], background: STAGE_COLORS[process.stage] + '12', borderColor: STAGE_COLORS[process.stage] + '30' }}>
                  {STAGE_LABELS[process.stage]}
                </span>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} id="advance-form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="ds-field">
              <label>Para qual etapa?</label>
              <div className="ds-input">
                <select
                  value={toStage}
                  onChange={(e) => setToStage(e.target.value as ProcessStage)}
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}
                >
                  {otherStages.map(s => (
                    <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            </div>

            {toStage === 'cliente_inativo' && (
              <div className="ds-field">
                <label>Motivo da inatividade *</label>
                <div className="ds-input">
                  <select
                    value={motivoInatividade}
                    onChange={(e) => setMotivoInatividade(e.target.value)}
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}
                  >
                    {MOTIVO_INATIVIDADE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {toStage === 'credito_recusado' && (
              <div className="ds-field">
                <label>Motivo da recusa *</label>
                <div className="ds-input">
                  <input
                    type="text"
                    placeholder="Ex: Score de crédito insuficiente"
                    value={motivoRecusa}
                    onChange={(e) => setMotivoRecusa(e.target.value)}
                    required
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              padding: '10px 12px',
              background: 'var(--bg-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              color: 'var(--text-muted)',
            }}>
              <Icon.Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              A mudança de etapa é registrada no log de auditoria e o cliente será notificado automaticamente via N8N.
            </div>

            {error && (
              <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 10px', background: 'var(--red-soft)', borderRadius: 'var(--radius-sm)' }}>
                {error}
              </div>
            )}
          </form>
        </div>

        <div className="ds-drawer-foot">
          <button type="button" className="ds-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="advance-form"
            disabled={mutation.isPending || (toStage === 'credito_recusado' && !motivoRecusa.trim())}
            className="ds-btn accent"
          >
            {mutation.isPending ? 'Salvando...' : `→ ${STAGE_LABELS[toStage]}`}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Kanban Card ───────────────────────────────────────────────────────────────

interface KanbanCardProps {
  process: ProcessCard;
  onOpenProcess?: (id: string) => void;
  canMoveStage: boolean;
}

function KanbanCard({ process, onOpenProcess, canMoveStage }: KanbanCardProps) {
  const [showDrawer, setShowDrawer] = useState(false);
  const clientName = process.client.name ?? process.client.email;
  const progress = STAGE_PROGRESS[process.stage];
  const stageColor = STAGE_COLORS[process.stage];

  return (
    <>
      <div className="ds-kb-card" onClick={() => onOpenProcess?.(process.id)} style={{ cursor: onOpenProcess ? 'pointer' : undefined }}>
        <div className="ds-kb-card-hdr">
          <span className="ds-kb-card-id">{process.id.slice(0, 8)}</span>
        </div>
        <div className="ds-kb-card-name">{clientName}</div>
        {process.valorUnidade && (
          <div className="ds-kb-card-sub">
            R$ {Number(process.valorUnidade).toLocaleString('pt-BR')}
          </div>
        )}
        {process.analista && (
          <div className="ds-docbar">
            <span className="pill">{process.analista.name ?? process.analista.email}</span>
          </div>
        )}
        <div className="ds-kb-card-foot">
          <div className="ds-kb-avatar" style={{ background: stageColor }}>
            {initials(process.client.name, process.client.email)}
          </div>
          <div className="ds-kb-progress">
            <span style={{ width: `${progress}%`, background: stageColor }} />
          </div>
          {canMoveStage && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowDrawer(true); }}
              className="ds-btn accent sm"
              style={{ padding: '0 8px', height: 22, fontSize: 11 }}
            >
              →
            </button>
          )}
        </div>
      </div>

      {showDrawer && (
        <AdvanceDrawer process={process} onClose={() => setShowDrawer(false)} />
      )}
    </>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  stage: ProcessStage;
  cards: ProcessCard[];
  onOpenProcess?: (id: string) => void;
  canMoveStage: boolean;
}

function KanbanColumn({ stage, cards, onOpenProcess, canMoveStage }: KanbanColumnProps) {
  const color = STAGE_COLORS[stage];
  return (
    <div className="ds-kb-col">
      <div className="ds-kb-hdr">
        <div className="ds-kb-title">
          <span className="dot" style={{ background: color }} />
          {STAGE_LABELS[stage]}
          <span className="ds-kb-count">· {cards.length}</span>
        </div>
      </div>
      {cards.map(p => <KanbanCard key={p.id} process={p} onOpenProcess={onOpenProcess} canMoveStage={canMoveStage} />)}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface WorkflowPageProps {
  onOpenProcess?: (id: string) => void;
}

export function WorkflowPage({ onOpenProcess }: WorkflowPageProps = {}) {
  const { role } = useAuth();
  const isCliente = role === 'cliente';
  const canMoveStage = !isCliente;
  const [showSideStatuses, setShowSideStatuses] = useState(false);
  const [showNovoProcesso, setShowNovoProcesso] = useState(false);

  const { data: processes = [], isLoading, error } = useQuery<ProcessCard[]>({
    queryKey: ['processes'],
    queryFn: () => api.get<ProcessCard[]>('/processes').then(r => r.data),
    refetchInterval: 30_000,
  });

  const byStage = (stage: ProcessStage) => processes.filter(p => p.stage === stage);
  const sideCount = SIDE_STAGES.reduce((n, s) => n + byStage(s).length, 0);
  const activeCount = MAIN_STAGES.reduce((n, s) => n + byStage(s).length, 0);

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Workflow</h1>
          <p>Pipeline de financiamento · {activeCount} processo(s) ativo(s) · {MAIN_STAGES.length} etapas</p>
        </div>
        <div className="actions">
          {!isCliente && (
            <button className="ds-btn" onClick={() => setShowSideStatuses(v => !v)}>
              {showSideStatuses ? 'Ocultar' : 'Ver'} inativos/recusados ({sideCount})
            </button>
          )}
          {!isCliente && (
            <button className="ds-btn accent" onClick={() => setShowNovoProcesso(true)}>
              <Icon.Plus size={13} />
              Novo Processo
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-faint)', fontSize: 13 }}>
          Carregando processos...
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--red)', fontSize: 13 }}>
          Erro ao carregar processos. Verifique a conexão com o backend.
        </div>
      )}

      {!isLoading && !error && (
        <>
          {/* Stage summary bar */}
          <div className="ds-stage-bar">
            {MAIN_STAGES.map((stage, i) => (
              <div className="ds-stg" key={stage}>
                <div className="ds-stg-num">Etapa {i + 1}</div>
                <div className="ds-stg-name">{STAGE_LABELS[stage]}</div>
                <div className="ds-stg-count">{byStage(stage).length} processos</div>
                <span className="ds-stg-dot" style={{ background: STAGE_COLORS[stage] }} />
              </div>
            ))}
          </div>

          {/* Side statuses banner */}
          {sideCount > 0 && (
            <div className="ds-side-banner">
              {SIDE_STAGES.map(stage => {
                const n = byStage(stage).length;
                if (!n) return null;
                return (
                  <div
                    key={stage}
                    className="ds-side-pill"
                    style={{ borderColor: STAGE_COLORS[stage] + '40', background: STAGE_COLORS[stage] + '0d' }}
                  >
                    <span className="dot" style={{ background: STAGE_COLORS[stage] }} />
                    <strong>{n}</strong>
                    <span>{STAGE_LABELS[stage]}</span>
                  </div>
                );
              })}
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
                Fluxos fora da progressão padrão
              </span>
            </div>
          )}

          {/* Kanban board */}
          <div className="ds-kanban">
            {MAIN_STAGES.map(stage => (
              <KanbanColumn key={stage} stage={stage} cards={byStage(stage)} onOpenProcess={onOpenProcess} canMoveStage={canMoveStage} />
            ))}
          </div>

          {/* Side status columns */}
          {showSideStatuses && sideCount > 0 && (
            <>
              <div style={{ margin: '24px 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                Clientes fora da progressão padrão
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {SIDE_STAGES.map(stage => {
                  const cards = byStage(stage);
                  if (!cards.length) return null;
                  return (
                    <div className="ds-card" key={stage}>
                      <div className="ds-card-hdr">
                        <h3>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_COLORS[stage], display: 'inline-block' }} />
                          {STAGE_LABELS[stage]}
                        </h3>
                        <span className="meta">{cards.length}</span>
                      </div>
                      <div style={{ padding: 0 }}>
                        {cards.map(p => (
                          <div
                            key={p.id}
                            className="ds-doc-row"
                            onClick={() => onOpenProcess?.(p.id)}
                            style={{ cursor: onOpenProcess ? 'pointer' : undefined }}
                          >
                            <div className="ds-kb-avatar" style={{ background: STAGE_COLORS[stage], width: 28, height: 28, fontSize: 11 }}>
                              {initials(p.client.name, p.client.email)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="ds-doc-title">{p.client.name ?? p.client.email}</div>
                              {p.valorUnidade && (
                                <div className="ds-doc-sub">R$ {Number(p.valorUnidade).toLocaleString('pt-BR')}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {processes.length === 0 && (
            <div className="ds-card" style={{ marginTop: 16 }}>
              <div className="ds-card-body" style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>
                <div style={{ fontSize: 13, marginBottom: 12 }}>Nenhum processo cadastrado ainda.</div>
                {!isCliente && (
                  <button className="ds-btn accent" onClick={() => setShowNovoProcesso(true)}>
                    <Icon.Plus size={13} /> Criar primeiro processo
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {showNovoProcesso && (
        <NovoProcessoDrawer
          onClose={() => setShowNovoProcesso(false)}
          onSuccess={(id) => {
            setShowNovoProcesso(false);
            onOpenProcess?.(id);
          }}
        />
      )}
    </div>
  );
}
