import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';

// ── Types ──────────────────────────────────────────────────────────────────────

type ProcessStage =
  | 'inicial' | 'cadastro' | 'analise_credito' | 'credito_aprovado'
  | 'analise_juridica' | 'juridico_aprovado' | 'cartorio' | 'assinatura'
  | 'cliente_inativo' | 'credito_recusado' | 'processo_pendencia';

interface ProcessDetail {
  id: string;
  stage: ProcessStage;
  fonteRenda: string | null;
  estadoCivil: string | null;
  valorUnidade: number | null;
  valorEmAberto: number | null;
  mipValue: number | null;
  dfiValue: number | null;
  motivoInatividade: string | null;
  motivoRecusa: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string | null; email: string; cpf: string | null; telefone: string | null };
  analista: { id: string; name: string | null; email: string } | null;
  unidade: {
    id: string;
    identificacao: string;
    valor: number | null;
    empreendimento: { id: string; nome: string; bancoFinanciador: string } | null;
  } | null;
}

interface AuditEntry {
  id: string;
  action: string;
  from_state: string | null;
  to_state: string | null;
  actor_name: string | null;
  created_at: string;
}

interface Document {
  id: string;
  label: string | null;
  name: string;
  category: string | null;
  status: 'pendente' | 'recebido' | 'validado' | 'rejeitado';
  notes: string | null;
  validatedByNotes: string | null;
  blobPath: string | null;
}

type Tab = 'workflow' | 'cadastro' | 'documentos' | 'atividade';

// ── Constants ──────────────────────────────────────────────────────────────────

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

const LINEAR_STAGES: ProcessStage[] = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
];

const SIDE_STAGES: ProcessStage[] = ['cliente_inativo', 'credito_recusado', 'processo_pendencia'];

const ALL_STAGES: ProcessStage[] = [...LINEAR_STAGES, ...SIDE_STAGES];

const MOTIVO_INATIVIDADE_OPTIONS = [
  { value: 'recursos_proprios', label: 'Quitará por recursos próprios' },
  { value: 'outra_assessoria', label: 'Seguirá com outra assessoria' },
  { value: 'sozinho', label: 'Seguirá sozinho' },
  { value: 'nao_atendeu', label: 'Não atendeu' },
];

const STATUS_BADGE: Record<Document['status'], { label: string; color: string; bg: string }> = {
  pendente:  { label: 'Pendente',  color: '#71717a', bg: '#f4f4f5' },
  recebido:  { label: 'Recebido',  color: '#2563eb', bg: '#eff6ff' },
  validado:  { label: 'Validado',  color: '#16a34a', bg: '#f0fdf4' },
  rejeitado: { label: 'Rejeitado', color: '#dc2626', bg: '#fef2f2' },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name: string | null) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

function formatCurrency(v: number | null | undefined) {
  if (!v) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v));
}

function daysAgo(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortId(id: string) {
  return `CLI-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

// ── Numbered Stage Steps ───────────────────────────────────────────────────────

function StageSteps({ stage }: { stage: ProcessStage }) {
  const isSide = SIDE_STAGES.includes(stage);
  const currentIdx = LINEAR_STAGES.indexOf(stage);
  const color = STAGE_COLORS[stage];

  return (
    <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 0 }}>
      {isSide ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 20,
            background: color + '18', border: `1px solid ${color}40`, color,
            fontSize: 12.5, fontWeight: 600,
          }}>
            {STAGE_LABELS[stage]}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {daysAgo(new Date().toISOString()) === 0 ? 'hoje' : `${daysAgo(new Date().toISOString())}d nesta situação`}
          </span>
        </div>
      ) : (
        LINEAR_STAGES.map((s, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          const stageColor = active ? STAGE_COLORS[s] : done ? '#22c55e' : undefined;
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'flex-start', flex: idx < LINEAR_STAGES.length - 1 ? 1 : 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 56 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  background: active ? STAGE_COLORS[s] : done ? '#22c55e' : 'transparent',
                  border: `2px solid ${stageColor ?? 'var(--border)'}`,
                  color: (active || done) ? '#fff' : 'var(--text-muted)',
                  flexShrink: 0,
                }}>
                  {done ? '✓' : idx + 1}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: active ? 600 : 400, color: active ? STAGE_COLORS[s] : done ? '#22c55e' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {STAGE_LABELS[s]}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>
                    {active ? `${daysAgo(new Date().toISOString()) === 0 ? 'hoje' : daysAgo(new Date().toISOString()) + 'd na fase'}` : done ? 'Concluído' : 'Pendente'}
                  </div>
                </div>
              </div>
              {idx < LINEAR_STAGES.length - 1 && (
                <div style={{
                  flex: 1, height: 2, marginTop: 13,
                  background: done ? '#22c55e' : 'var(--border)',
                }} />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Stage change modal ─────────────────────────────────────────────────────────

interface StageChangeProps {
  process: ProcessDetail;
  onClose: () => void;
}

interface GateError {
  message: string;
  pendingDocs: { label: string; status: string }[];
}

function parseGateError(err: unknown): GateError | string {
  const e = err as { response?: { status?: number; data?: { message?: string; pendingDocs?: { label: string; status: string }[] } } };
  if (e?.response?.status === 422 && e.response.data?.pendingDocs) {
    return { message: e.response.data.message ?? 'Documentos pendentes', pendingDocs: e.response.data.pendingDocs };
  }
  return e?.response?.data?.message ?? 'Erro ao mover etapa';
}

function GateErrorBox({ error }: { error: GateError | string }) {
  if (typeof error === 'string') {
    return (
      <div style={{ fontSize: 12, color: 'var(--red)', padding: '6px 10px', background: 'var(--red-soft)', borderRadius: 'var(--radius-sm)' }}>
        {error}
      </div>
    );
  }
  return (
    <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 'var(--radius-sm)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{error.message}</div>
      <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error.pendingDocs.map((d, i) => (
          <li key={i} style={{ fontSize: 11.5 }}>
            {d.label}
            <span style={{ marginLeft: 6, opacity: 0.7 }}>({d.status})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StageChangeModal({ process, onClose }: StageChangeProps) {
  const qc = useQueryClient();
  const otherStages = ALL_STAGES.filter(s => s !== process.stage);
  const [toStage, setToStage] = useState<ProcessStage>(otherStages[0]);
  const [motivoInatividade, setMotivoInatividade] = useState('recursos_proprios');
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [error, setError] = useState<GateError | string>('');

  const mut = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.patch(`/processes/${process.id}/stage`, body).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['processes'] });
      void qc.invalidateQueries({ queryKey: ['process', process.id] });
      void qc.invalidateQueries({ queryKey: ['audit', process.id] });
      onClose();
    },
    onError: (err: unknown) => setError(parseGateError(err)),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, string> = { toStage };
    if (toStage === 'cliente_inativo') body.motivoInatividade = motivoInatividade;
    if (toStage === 'credito_recusado' && !motivoRecusa.trim()) return;
    if (toStage === 'credito_recusado') body.motivoRecusa = motivoRecusa;
    mut.mutate(body);
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
        <div className="ds-drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Etapa atual: <strong>{STAGE_LABELS[process.stage]}</strong>
          </div>
          <form onSubmit={handleSubmit} id="stage-form" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="ds-field" style={{ marginBottom: 0 }}>
              <label>Para qual etapa?</label>
              <div className="ds-input">
                <select value={toStage} onChange={e => setToStage(e.target.value as ProcessStage)}
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}>
                  {otherStages.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                </select>
              </div>
            </div>
            {toStage === 'cliente_inativo' && (
              <div className="ds-field" style={{ marginBottom: 0 }}>
                <label>Motivo *</label>
                <div className="ds-input">
                  <select value={motivoInatividade} onChange={e => setMotivoInatividade(e.target.value)}
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}>
                    {MOTIVO_INATIVIDADE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            )}
            {toStage === 'credito_recusado' && (
              <div className="ds-field" style={{ marginBottom: 0 }}>
                <label>Motivo da recusa *</label>
                <div className="ds-input">
                  <input type="text" value={motivoRecusa} onChange={e => setMotivoRecusa(e.target.value)}
                    placeholder="Ex: Score insuficiente" required style={{ flex: 1 }} />
                </div>
              </div>
            )}
            {error !== '' && <GateErrorBox error={error} />}
          </form>
        </div>
        <div className="ds-drawer-foot">
          <button type="button" className="ds-btn ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" form="stage-form" className="ds-btn accent" disabled={mut.isPending}>
            {mut.isPending ? 'Salvando...' : `Confirmar → ${STAGE_LABELS[toStage]}`}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Quick advance/back buttons ─────────────────────────────────────────────────

function QuickStageButtons({ process, isAnalista }: { process: ProcessDetail; isAnalista: boolean }) {
  const qc = useQueryClient();
  const currentIdx = LINEAR_STAGES.indexOf(process.stage);
  const prevStage = currentIdx > 0 ? LINEAR_STAGES[currentIdx - 1] : null;
  const nextStage = currentIdx >= 0 && currentIdx < LINEAR_STAGES.length - 1 ? LINEAR_STAGES[currentIdx + 1] : null;
  const [gateError, setGateError] = useState<GateError | string>('');

  const mut = useMutation({
    mutationFn: (toStage: ProcessStage) =>
      api.patch(`/processes/${process.id}/stage`, { toStage }).then(r => r.data),
    onSuccess: () => {
      setGateError('');
      void qc.invalidateQueries({ queryKey: ['processes'] });
      void qc.invalidateQueries({ queryKey: ['process', process.id] });
      void qc.invalidateQueries({ queryKey: ['audit', process.id] });
    },
    onError: (err: unknown) => setGateError(parseGateError(err)),
  });

  if (!isAnalista) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {prevStage && (
          <button
            className="ds-btn ghost sm"
            disabled={mut.isPending}
            onClick={() => { setGateError(''); mut.mutate(prevStage); }}
          >
            ← Voltar
          </button>
        )}
        {nextStage && (
          <button
            className="ds-btn accent sm"
            disabled={mut.isPending}
            onClick={() => { setGateError(''); mut.mutate(nextStage); }}
            style={{ minWidth: 160 }}
          >
            Avançar para {STAGE_LABELS[nextStage]} →
          </button>
        )}
      </div>
      {gateError !== '' && <GateErrorBox error={gateError} />}
    </div>
  );
}

// ── WorkflowTab ────────────────────────────────────────────────────────────────

function WorkflowTab({ process, docs, isAnalista, onMoverEtapa }: {
  process: ProcessDetail;
  docs: Document[];
  isAnalista: boolean;
  onMoverEtapa: () => void;
}) {
  const { data: audit = [], isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['audit', process.id],
    queryFn: () => api.get(`/processes/${process.id}/audit`).then(r => r.data),
  });

  const docsValidados = docs.filter(d => d.status === 'validado').length;
  const currentIdx = LINEAR_STAGES.indexOf(process.stage);
  const nextStage = currentIdx >= 0 && currentIdx < LINEAR_STAGES.length - 1 ? LINEAR_STAGES[currentIdx + 1] : null;
  const isSide = SIDE_STAGES.includes(process.stage);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
      {/* Left: timeline */}
      <div className="ds-card">
        <div className="ds-card-hdr">
          Linha do tempo do processo
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-faint)' }}>
            {audit.length} evento(s)
          </span>
        </div>
        {isLoading && (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando...</div>
        )}
        {!isLoading && audit.length === 0 && (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 20px', textAlign: 'center' }}>
            Nenhuma atividade registrada ainda.
          </div>
        )}
        {!isLoading && audit.length > 0 && (
          <div style={{ padding: 0 }}>
            {audit.map((entry, idx) => (
              <div key={entry.id} style={{
                display: 'flex', gap: 14, padding: '14px 20px',
                borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, flexShrink: 0 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: '#f0f0f0', display: 'grid', placeItems: 'center', flexShrink: 0,
                  }}>
                    <Icon.Activity size={12} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  {idx < audit.length - 1 && (
                    <div style={{ width: 1, flex: 1, background: 'var(--border)', minHeight: 16, marginTop: 4 }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingBottom: idx < audit.length - 1 ? 4 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {entry.from_state && entry.to_state ? 'Mudança de etapa' : entry.action}
                    </span>
                    {entry.from_state && (
                      <span style={{
                        fontSize: 11, padding: '1px 6px', borderRadius: 4,
                        background: STAGE_COLORS[entry.from_state as ProcessStage] + '18',
                        color: STAGE_COLORS[entry.from_state as ProcessStage],
                      }}>
                        {STAGE_LABELS[entry.from_state as ProcessStage] ?? entry.from_state}
                      </span>
                    )}
                    {entry.to_state && (
                      <>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>→</span>
                        <span style={{
                          fontSize: 11, padding: '1px 6px', borderRadius: 4,
                          background: STAGE_COLORS[entry.to_state as ProcessStage] + '18',
                          color: STAGE_COLORS[entry.to_state as ProcessStage],
                        }}>
                          {STAGE_LABELS[entry.to_state as ProcessStage] ?? entry.to_state}
                        </span>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {entry.actor_name ?? 'Sistema'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
                    {fmtDate(entry.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: stage card */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="ds-card">
          <div className="ds-card-hdr">Etapa atual</div>
          <div className="ds-card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: STAGE_COLORS[process.stage], display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{STAGE_LABELS[process.stage]}</span>
            </div>
            <dl className="ds-kv" style={{ gap: '8px 0' }}>
              {!isSide && nextStage && (
                <>
                  <dt style={{ fontSize: 11.5 }}>Próxima etapa</dt>
                  <dd style={{ fontSize: 12 }}>{STAGE_LABELS[nextStage]}</dd>
                </>
              )}
              {process.unidade?.empreendimento?.bancoFinanciador && (
                <>
                  <dt style={{ fontSize: 11.5 }}>Banco</dt>
                  <dd style={{ fontSize: 12 }}>{process.unidade.empreendimento.bancoFinanciador}</dd>
                </>
              )}
              <dt style={{ fontSize: 11.5 }}>Docs validados</dt>
              <dd style={{ fontSize: 12 }}>{docsValidados}/{docs.length || '—'}</dd>
              {process.motivoInatividade && (
                <>
                  <dt style={{ fontSize: 11.5 }}>Motivo inatividade</dt>
                  <dd style={{ fontSize: 12, color: 'var(--red)' }}>{process.motivoInatividade}</dd>
                </>
              )}
              {process.motivoRecusa && (
                <>
                  <dt style={{ fontSize: 11.5 }}>Motivo recusa</dt>
                  <dd style={{ fontSize: 12, color: 'var(--red)' }}>{process.motivoRecusa}</dd>
                </>
              )}
            </dl>
          </div>
          {isAnalista && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <QuickStageButtons process={process} isAnalista={isAnalista} />
              <button
                className="ds-btn ghost sm"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={onMoverEtapa}
              >
                Mover para outra etapa...
              </button>
            </div>
          )}
        </div>

        {/* Financial quick view */}
        <div className="ds-card">
          <div className="ds-card-hdr">Financeiro</div>
          <div className="ds-card-body">
            <dl className="ds-kv" style={{ gap: '8px 0' }}>
              <dt style={{ fontSize: 11.5 }}>Valor da Unidade</dt>
              <dd style={{ fontSize: 12 }}>{formatCurrency(process.valorUnidade)}</dd>
              <dt style={{ fontSize: 11.5 }}>Em Aberto</dt>
              <dd style={{ fontSize: 12 }}>{formatCurrency(process.valorEmAberto)}</dd>
              <dt style={{ fontSize: 11.5 }}>MIP</dt>
              <dd style={{ fontSize: 12 }}>{formatCurrency(process.mipValue)}</dd>
              <dt style={{ fontSize: 11.5 }}>DFI</dt>
              <dd style={{ fontSize: 12 }}>{formatCurrency(process.dfiValue)}</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ParticipantesCard ──────────────────────────────────────────────────────────

interface Participant {
  id: string;
  name: string;
  cpf: string | null;
  declaredIncome: number;
}

function ParticipantesCard({ processId, isAnalista }: { processId: string; isAnalista: boolean }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', cpf: '', declaredIncome: '' });
  const [formError, setFormError] = useState('');

  const { data: participants = [], isLoading } = useQuery<Participant[]>({
    queryKey: ['participants', processId],
    queryFn: () => api.get(`/processes/${processId}/participants`).then(r => r.data),
  });

  // RN-06: the income composition is summed authoritatively on the backend.
  // Keyed under ['participants', processId, ...] so the add/remove mutations
  // below (which fuzzy-invalidate ['participants', processId]) also refresh it.
  const { data: composition } = useQuery<{ composedIncome: number; participantCount: number }>({
    queryKey: ['participants', processId, 'composition'],
    queryFn: () => api.get(`/processes/${processId}/income-composition`).then(r => r.data),
  });

  // Use the server total; fall back to a local sum only while it is loading.
  const totalRenda = composition?.composedIncome ?? participants.reduce((s, p) => s + Number(p.declaredIncome), 0);

  const addMut = useMutation({
    mutationFn: () => api.post(`/processes/${processId}/participants`, {
      name: form.name.trim(),
      cpf: form.cpf.trim() || undefined,
      declaredIncome: Number(form.declaredIncome),
    }).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['participants', processId] });
      setForm({ name: '', cpf: '', declaredIncome: '' });
      setShowForm(false);
      setFormError('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setFormError(Array.isArray(msg) ? msg.join('; ') : (msg ?? 'Erro ao adicionar'));
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/processes/${processId}/participants/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participants', processId] }),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Nome é obrigatório'); return; }
    if (!form.declaredIncome || isNaN(Number(form.declaredIncome))) { setFormError('Renda inválida'); return; }
    setFormError('');
    addMut.mutate();
  };

  return (
    <div className="ds-card">
      <div className="ds-card-hdr">
        Composição de Renda
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-faint)' }}>
          {participants.length} participante{participants.length !== 1 ? 's' : ''}
        </span>
        {isAnalista && !showForm && (
          <button className="ds-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setShowForm(true)}>
            <Icon.Plus size={12} /> Adicionar
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-faint)' }}>Carregando...</div>
      ) : (
        <div className="ds-card-body" style={{ padding: 0 }}>
          {participants.length > 0 && (
            <table className="ds-table" style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>CPF</th>
                  <th style={{ textAlign: 'right' }}>Renda Declarada</th>
                  {isAnalista && <th></th>}
                </tr>
              </thead>
              <tbody>
                {participants.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{p.cpf ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                      {formatCurrency(p.declaredIncome)}
                    </td>
                    {isAnalista && (
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="ds-btn ghost sm"
                          style={{ color: 'var(--red)' }}
                          onClick={() => {
                            if (window.confirm(`Remover "${p.name}" da composição de renda?`)) {
                              removeMut.mutate(p.id);
                            }
                          }}
                        >
                          <Icon.Trash size={12} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {participants.length > 1 && (
                <tfoot>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    <td colSpan={isAnalista ? 2 : 1} style={{ fontWeight: 600, fontSize: 12.5 }}>Total composto</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--accent)' }}>
                      {formatCurrency(totalRenda)}
                    </td>
                    {isAnalista && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          )}

          {participants.length === 0 && !showForm && (
            <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-faint)', textAlign: 'center' }}>
              Nenhum participante cadastrado.
              {isAnalista && ' Adicione ao menos um para calcular a renda total.'}
            </div>
          )}

          {showForm && (
            <form onSubmit={handleAdd} style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: participants.length > 0 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 2 }}>Novo participante</div>
              {[
                { key: 'name', label: 'Nome completo *', placeholder: '' },
                { key: 'cpf', label: 'CPF', placeholder: '000.000.000-00' },
                { key: 'declaredIncome', label: 'Renda declarada (R$) *', placeholder: '0.00', type: 'number' },
              ].map(({ key, label, placeholder, type }) => (
                <div key={key} className="ds-field" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: 12 }}>{label}</label>
                  <div className="ds-input">
                    <input
                      type={type ?? 'text'}
                      value={form[key as keyof typeof form]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      style={{ flex: 1 }}
                      min={type === 'number' ? '0' : undefined}
                      step={type === 'number' ? '0.01' : undefined}
                    />
                  </div>
                </div>
              ))}
              {formError && <div style={{ fontSize: 12, color: 'var(--red)' }}>{formError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="ds-btn ghost sm" onClick={() => { setShowForm(false); setFormError(''); }}>Cancelar</button>
                <button type="submit" className="ds-btn accent sm" disabled={addMut.isPending}>
                  {addMut.isPending ? 'Salvando...' : 'Adicionar'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── CadastroTab ────────────────────────────────────────────────────────────────

function CadastroTab({ process, role }: { process: ProcessDetail; role: string | null }) {
  const qc = useQueryClient();
  const { client, unidade } = process;
  const isAnalista = role === 'analista' || role === 'dono';
  const isCliente = role === 'cliente';
  const canEditProfile = isAnalista || isCliente;

  const [editingClient, setEditingClient] = useState(false);
  const [clientForm, setClientForm] = useState({
    name: client.name ?? '',
    cpf: client.cpf ?? '',
    telefone: client.telefone ?? '',
  });

  const [editingProcess, setEditingProcess] = useState(false);
  const [processForm, setProcessForm] = useState({
    estadoCivil: process.estadoCivil ?? '',
    fonteRenda: process.fonteRenda ?? '',
    valorUnidade: process.valorUnidade !== null ? String(process.valorUnidade) : '',
    valorEmAberto: process.valorEmAberto !== null ? String(process.valorEmAberto) : '',
    mipValue: process.mipValue !== null ? String(process.mipValue) : '',
    dfiValue: process.dfiValue !== null ? String(process.dfiValue) : '',
  });

  const clientMut = useMutation({
    mutationFn: (dto: typeof clientForm) =>
      api.patch(`/users/${client.id}/profile`, { ...dto, processId: process.id }).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['process', process.id] });
      void qc.invalidateQueries({ queryKey: ['audit', process.id] });
      setEditingClient(false);
    },
  });

  const processMut = useMutation({
    mutationFn: (dto: typeof processForm) => {
      const payload: Record<string, unknown> = {
        estadoCivil: dto.estadoCivil || null,
        fonteRenda: dto.fonteRenda || null,
        valorUnidade: dto.valorUnidade !== '' ? Number(dto.valorUnidade) : null,
        valorEmAberto: dto.valorEmAberto !== '' ? Number(dto.valorEmAberto) : null,
        mipValue: dto.mipValue !== '' ? Number(dto.mipValue) : null,
        dfiValue: dto.dfiValue !== '' ? Number(dto.dfiValue) : null,
      };
      return api.patch(`/processes/${process.id}`, payload).then(r => r.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['process', process.id] });
      void qc.invalidateQueries({ queryKey: ['processes'] });
      void qc.invalidateQueries({ queryKey: ['documents', process.id] });
      setEditingProcess(false);
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ds-card">
        <div className="ds-card-hdr">
          Dados do Proponente
          {canEditProfile && !editingClient && (
            <button className="ds-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setEditingClient(true)}>
              <Icon.Edit size={12} /> Editar
            </button>
          )}
        </div>
        <div className="ds-card-body">
          {editingClient ? (
            <form onSubmit={e => { e.preventDefault(); clientMut.mutate(clientForm); }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { key: 'name', label: 'Nome completo', placeholder: '' },
                { key: 'cpf', label: 'CPF', placeholder: '000.000.000-00' },
                { key: 'telefone', label: 'Telefone', placeholder: '(11) 99999-9999' },
              ].map(({ key, label, placeholder }) => (
                <div key={key} className="ds-field" style={{ marginBottom: 0 }}>
                  <label>{label}</label>
                  <div className="ds-input">
                    <input type="text" value={clientForm[key as keyof typeof clientForm]}
                      onChange={e => setClientForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder} style={{ flex: 1 }} />
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="ds-btn ghost sm" onClick={() => setEditingClient(false)}>Cancelar</button>
                <button type="submit" className="ds-btn accent sm" disabled={clientMut.isPending}>
                  {clientMut.isPending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          ) : (
            <dl className="ds-kv">
              <dt>Nome</dt><dd>{client.name ?? '—'}</dd>
              <dt>E-mail</dt><dd>{client.email}</dd>
              <dt>CPF</dt><dd>{client.cpf ?? '—'}</dd>
              <dt>Telefone</dt><dd>{client.telefone ?? '—'}</dd>
            </dl>
          )}
        </div>
      </div>

      <div className="ds-card">
        <div className="ds-card-hdr">
          Dados do Processo
          {isAnalista && !editingProcess && (
            <button className="ds-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setEditingProcess(true)}>
              <Icon.Edit size={12} /> Editar
            </button>
          )}
        </div>
        <div className="ds-card-body">
          {editingProcess ? (
            <form onSubmit={e => { e.preventDefault(); processMut.mutate(processForm); }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="ds-field" style={{ marginBottom: 0 }}>
                <label>Estado Civil</label>
                <div className="ds-input">
                  <select value={processForm.estadoCivil} onChange={e => setProcessForm(f => ({ ...f, estadoCivil: e.target.value }))}
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}>
                    <option value="">Selecionar...</option>
                    <option value="solteiro">Solteiro(a)</option>
                    <option value="casado">Casado(a)</option>
                    <option value="divorciado">Divorciado(a)</option>
                    <option value="viuvo">Viúvo(a)</option>
                    <option value="uniao_estavel">União Estável</option>
                  </select>
                </div>
              </div>
              <div className="ds-field" style={{ marginBottom: 0 }}>
                <label>Fonte de Renda</label>
                <div className="ds-input">
                  <select value={processForm.fonteRenda} onChange={e => setProcessForm(f => ({ ...f, fonteRenda: e.target.value }))}
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}>
                    <option value="">Selecionar...</option>
                    <option value="assalariado">Assalariado</option>
                    <option value="nao_assalariado">Não Assalariado</option>
                  </select>
                </div>
              </div>
              {[
                { key: 'valorUnidade', label: 'Valor da Unidade (R$)' },
                { key: 'valorEmAberto', label: 'Valor em Aberto (R$)' },
                { key: 'mipValue', label: 'MIP (R$)' },
                { key: 'dfiValue', label: 'DFI (R$)' },
              ].map(({ key, label }) => (
                <div key={key} className="ds-field" style={{ marginBottom: 0 }}>
                  <label>{label}</label>
                  <div className="ds-input">
                    <input
                      type="number" min="0" step="0.01"
                      value={processForm[key as keyof typeof processForm]}
                      onChange={e => setProcessForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder="0,00" style={{ flex: 1 }}
                    />
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="ds-btn ghost sm" onClick={() => setEditingProcess(false)}>Cancelar</button>
                <button type="submit" className="ds-btn accent sm" disabled={processMut.isPending}>
                  {processMut.isPending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          ) : (
            <dl className="ds-kv">
              <dt>Estado Civil</dt>
              <dd>{process.estadoCivil ?? '—'}</dd>
              <dt>Fonte de Renda</dt>
              <dd>
                {process.fonteRenda === 'assalariado' ? 'Assalariado' :
                 process.fonteRenda === 'nao_assalariado' ? 'Não Assalariado' : '—'}
              </dd>
              <dt>Valor da Unidade</dt>
              <dd>{formatCurrency(process.valorUnidade)}</dd>
              <dt>Valor em Aberto</dt>
              <dd>{formatCurrency(process.valorEmAberto)}</dd>
              <dt>MIP</dt>
              <dd>{formatCurrency(process.mipValue)}</dd>
              <dt>DFI</dt>
              <dd>{formatCurrency(process.dfiValue)}</dd>
            </dl>
          )}
        </div>
      </div>

      <ParticipantesCard processId={process.id} isAnalista={isAnalista} />

      {unidade && (
        <div className="ds-card">
          <div className="ds-card-hdr">Unidade</div>
          <div className="ds-card-body">
            <dl className="ds-kv">
              <dt>Empreendimento</dt>
              <dd>{unidade.empreendimento?.nome ?? '—'}</dd>
              <dt>Identificação</dt>
              <dd>{unidade.identificacao}</dd>
              <dt>Valor</dt>
              <dd>{formatCurrency(unidade.valor)}</dd>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DocumentosTab ──────────────────────────────────────────────────────────────

function ViewButton({ docId }: { docId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleView = async () => {
    setLoading(true);
    setError('');
    let objectUrl: string | null = null;
    try {
      // Download via authenticated backend proxy — storage URL never reaches the client
      const resp = await api.get(`/documents/${docId}/download`, {
        responseType: 'blob',
      });
      const contentType: string = (resp.headers as Record<string, string>)['content-type'] ?? 'application/octet-stream';
      const blob = new Blob([resp.data as BlobPart], { type: contentType });
      objectUrl = URL.createObjectURL(blob);
      // blob:// URLs are browser-session-local — cannot be shared or opened in another browser
      const win = window.open(objectUrl, '_blank', 'noopener');
      // Revoke after the tab had time to load the content
      if (win) {
        setTimeout(() => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, 10_000);
      }
    } catch {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setError('Falha ao carregar documento');
    } finally {
      setLoading(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button className="ds-btn ghost sm" onClick={handleView} disabled={loading}>
        <Icon.Paperclip size={12} />
        {loading ? 'Aguarde...' : 'Visualizar'}
      </button>
      {error && <span style={{ fontSize: 11, color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}

function UploadButton({ docId, processId }: { docId: string; processId: string }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post(`/documents/${docId}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      void qc.invalidateQueries({ queryKey: ['documents', processId] });
      void qc.invalidateQueries({ queryKey: ['audit', processId] });
    } catch {
      setError('Falha ao enviar arquivo');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile} style={{ display: 'none' }} />
      <span className="ds-btn ghost sm" style={{ pointerEvents: 'none' }}>
        {uploading ? 'Enviando...' : (
          <>
            <Icon.Upload size={12} /> Enviar
          </>
        )}
      </span>
      {error && <span style={{ fontSize: 11, color: 'var(--red)' }}>{error}</span>}
    </label>
  );
}

function DocumentosTab({ processId, role }: { processId: string; role: string | null }) {
  const qc = useQueryClient();
  const isAnalista = role === 'analista' || role === 'dono';
  const isCliente = role === 'cliente';

  const { data: docs = [], isLoading } = useQuery<Document[]>({
    queryKey: ['documents', processId],
    queryFn: () => api.get(`/processes/${processId}/documents`).then(r => r.data),
  });

  const initMut = useMutation({
    mutationFn: () => api.post(`/processes/${processId}/documents/init-checklist`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', processId] }),
  });

  const validateMut = useMutation({
    mutationFn: ({ docId, status, notes }: { docId: string; status: string; notes?: string }) =>
      api.patch(`/documents/${docId}`, { status, validatedByNotes: notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', processId] }),
  });

  if (isLoading) return <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando...</div>;

  const byCategory: Record<string, Document[]> = {};
  docs.forEach(d => {
    const cat = d.category ?? 'outros';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(d);
  });

  const catLabels: Record<string, string> = {
    pessoal: 'Documentos Pessoais',
    renda: 'Comprovação de Renda',
    outros: 'Outros',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isAnalista && docs.length === 0 && (
        <div className="ds-card">
          <div className="ds-card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Checklist ainda não inicializado.</span>
            <button className="ds-btn accent sm" onClick={() => initMut.mutate()} disabled={initMut.isPending}>
              {initMut.isPending ? 'Iniciando...' : 'Inicializar Checklist'}
            </button>
          </div>
        </div>
      )}
      {docs.length === 0 && !isAnalista && (
        <div className="ds-card">
          <div className="ds-card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-faint)', fontSize: 13 }}>
            Nenhum documento solicitado ainda.
          </div>
        </div>
      )}
      {Object.entries(byCategory).map(([cat, catDocs]) => (
        <div className="ds-card" key={cat}>
          <div className="ds-card-hdr">{catLabels[cat] ?? cat}</div>
          <div className="ds-card-body" style={{ padding: 0 }}>
            {catDocs.map((doc, idx) => {
              const badge = STATUS_BADGE[doc.status];
              const canUpload = isCliente && (doc.status === 'pendente' || doc.status === 'rejeitado');
              return (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: idx === 0 ? 'none' : '1px solid var(--border)' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                    background: doc.status === 'validado' ? '#dcfce7' : doc.status === 'rejeitado' ? '#fee2e2' : 'var(--bg-subtle)',
                    border: '1px solid var(--border)', display: 'grid', placeItems: 'center',
                  }}>
                    <Icon.FileText size={14} style={{ color: doc.status === 'validado' ? '#16a34a' : doc.status === 'rejeitado' ? '#dc2626' : 'var(--text-faint)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{doc.label ?? doc.name}</div>
                    {doc.validatedByNotes && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{doc.validatedByNotes}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 4, fontWeight: 500, color: badge.color, background: badge.bg, whiteSpace: 'nowrap' }}>
                    {badge.label}
                  </span>
                  {doc.blobPath && !doc.blobPath.startsWith('local://') && (
                    <ViewButton docId={doc.id} />
                  )}
                  {canUpload && <UploadButton docId={doc.id} processId={processId} />}
                  {isAnalista && doc.status === 'recebido' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="ds-btn ghost sm" style={{ color: '#16a34a' }}
                        onClick={() => validateMut.mutate({ docId: doc.id, status: 'validado' })} title="Validar">
                        <Icon.Check size={13} />
                      </button>
                      <button className="ds-btn ghost sm" style={{ color: '#dc2626' }}
                        onClick={() => validateMut.mutate({ docId: doc.id, status: 'rejeitado', notes: 'Documento inválido ou ilegível' })} title="Rejeitar">
                        <Icon.X size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── AtividadeTab ───────────────────────────────────────────────────────────────

function AtividadeTab({ processId }: { processId: string }) {
  const { data: audit = [], isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['audit', processId],
    queryFn: () => api.get(`/processes/${processId}/audit`).then(r => r.data),
  });

  if (isLoading) return <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando...</div>;

  if (audit.length === 0) {
    return (
      <div className="ds-card">
        <div className="ds-card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-faint)', fontSize: 13 }}>
          Nenhuma atividade registrada ainda.
        </div>
      </div>
    );
  }

  return (
    <div className="ds-card">
      <div className="ds-card-hdr">Histórico completo</div>
      <div className="ds-card-body" style={{ padding: 0 }}>
        {audit.map((entry, idx) => (
          <div key={entry.id} style={{ display: 'flex', gap: 14, padding: '12px 20px', borderTop: idx === 0 ? 'none' : '1px solid var(--border)' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f0f0f0', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon.Activity size={12} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {entry.from_state && entry.to_state
                  ? `${STAGE_LABELS[entry.from_state as ProcessStage] ?? entry.from_state} → ${STAGE_LABELS[entry.to_state as ProcessStage] ?? entry.to_state}`
                  : entry.action}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                {entry.actor_name ?? 'Sistema'} · {fmtDate(entry.created_at)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

interface Props {
  processId: string;
  onBack: () => void;
  role: string | null;
}

export function ProponenteDetailPage({ processId, onBack, role }: Props) {
  const [tab, setTab] = useState<Tab>('workflow');
  const [showMoverEtapa, setShowMoverEtapa] = useState(false);

  const { data: process, isLoading, isError } = useQuery<ProcessDetail>({
    queryKey: ['process', processId],
    queryFn: () => api.get(`/processes/${processId}`).then(r => r.data),
  });

  const { data: docs = [] } = useQuery<Document[]>({
    queryKey: ['documents', processId],
    queryFn: () => api.get(`/processes/${processId}/documents`).then(r => r.data),
  });

  const isAnalista = role === 'analista' || role === 'dono';

  if (isLoading) return <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 32 }}>Carregando...</div>;

  if (isError || !process) {
    return (
      <div style={{ padding: 32 }}>
        <div className="ds-alert urgent">Processo não encontrado.</div>
        <button className="ds-btn ghost" style={{ marginTop: 12 }} onClick={onBack}>← Voltar</button>
      </div>
    );
  }

  const { client, unidade } = process;
  const stageColor = STAGE_COLORS[process.stage];
  const docsValidados = docs.filter(d => d.status === 'validado').length;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'workflow', label: 'Workflow' },
    { id: 'cadastro', label: 'Cadastro' },
    { id: 'documentos', label: `Documentos${docs.length > 0 ? ` ${docsValidados}/${docs.length}` : ''}` },
    { id: 'atividade', label: 'Atividade' },
  ];

  return (
    <div className="ds-page">
      {/* Hero card */}
      <div className="ds-card" style={{ marginBottom: 0, borderRadius: 'var(--radius) var(--radius) 0 0', borderBottom: 'none' }}>
        <div className="ds-card-body" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {/* Avatar */}
            <div style={{
              width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #c084fc, #7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 17, fontWeight: 700, color: '#fff',
            }}>
              {initials(client.name)}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  {shortId(process.id)}
                </span>
                <span style={{
                  fontSize: 11.5, padding: '2px 8px', borderRadius: 12,
                  background: stageColor + '18', color: stageColor,
                  border: `1px solid ${stageColor}30`, fontWeight: 600,
                }}>
                  {STAGE_LABELS[process.stage]}
                </span>
              </div>
              <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>
                {client.name ?? client.email}
              </h2>
              {unidade && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 3 }}>
                  {unidade.empreendimento?.nome && `${unidade.empreendimento.nome} · `}
                  {unidade.identificacao}
                </div>
              )}
              <div style={{ fontSize: 12.5, color: 'var(--text-faint)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {client.cpf && <span>{client.cpf}</span>}
                {client.telefone && <span>{client.telefone}</span>}
                <span>{client.email}</span>
              </div>
            </div>

            {/* Financial stats */}
            <div style={{ display: 'flex', gap: 28, flexShrink: 0, alignItems: 'flex-start' }}>
              {process.valorUnidade && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                    Valor da Unidade
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px' }}>
                    {formatCurrency(process.valorUnidade)}
                  </div>
                </div>
              )}
              {process.valorEmAberto && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                    Em Aberto
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px' }}>
                    {formatCurrency(process.valorEmAberto)}
                  </div>
                </div>
              )}
              {unidade?.empreendimento?.bancoFinanciador && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                    Banco
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {unidade.empreendimento.bancoFinanciador}
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center', marginLeft: 8 }}>
              <button className="ds-btn ghost sm" onClick={onBack}>← Voltar</button>
              {isAnalista && (
                <button className="ds-btn accent sm" onClick={() => setShowMoverEtapa(true)} style={{ gap: 6 }}>
                  Avançar etapa <Icon.ChevronRight size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Numbered stage steps */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderTop: 'none', marginBottom: 0, borderBottom: 'none' }}>
        <StageSteps stage={process.stage} />
      </div>

      {/* Tabs */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderTop: 'none',
        borderRadius: '0 0 var(--radius) var(--radius)',
        marginBottom: 20,
      }}>
        <div className="ds-tabs" style={{ padding: '0 20px', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
          {TABS.map(t => (
            <button key={t.id} className={`ds-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'workflow' && <WorkflowTab process={process} docs={docs} isAnalista={isAnalista} onMoverEtapa={() => setShowMoverEtapa(true)} />}
      {tab === 'cadastro' && <CadastroTab process={process} role={role} />}
      {tab === 'documentos' && <DocumentosTab processId={processId} role={role} />}
      {tab === 'atividade' && <AtividadeTab processId={processId} />}

      {showMoverEtapa && (
        <StageChangeModal process={process} onClose={() => setShowMoverEtapa(false)} />
      )}
    </div>
  );
}
