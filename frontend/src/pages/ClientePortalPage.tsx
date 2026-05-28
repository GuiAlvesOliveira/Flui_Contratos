import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import { useAuth } from '../auth/useAuth';
import * as Icon from '../components/icons';

// ── Types ──────────────────────────────────────────────────────────────────────

type ProcessStage =
  | 'inicial' | 'cadastro' | 'analise_credito' | 'credito_aprovado'
  | 'analise_juridica' | 'juridico_aprovado' | 'cartorio' | 'assinatura'
  | 'cliente_inativo' | 'credito_recusado' | 'processo_pendencia';

interface ProcessCard {
  id: string;
  stage: ProcessStage;
  valorUnidade: number | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string | null; email: string };
  analista: { id: string; name: string | null; email: string } | null;
  unidade: { id: string; identificacao: string; valor: number | null } | null;
}

interface Document {
  id: string;
  label: string | null;
  name: string;
  category: string | null;
  docType: string | null;
  status: 'pendente' | 'recebido' | 'validado' | 'rejeitado';
  notes: string | null;
  validatedByNotes: string | null;
  blobPath: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

const MAIN_STAGES: ProcessStage[] = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
];

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

const STATUS_BADGE: Record<Document['status'], { label: string; cls: string }> = {
  pendente: { label: 'Pendente', cls: 'neutral' },
  recebido: { label: 'Enviado', cls: 'blue' },
  validado: { label: 'Aprovado', cls: 'green' },
  rejeitado: { label: 'Rejeitado', cls: 'red' },
};

function formatCurrency(v: number | null) {
  if (!v) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

// ── Stage progress ─────────────────────────────────────────────────────────────

function StageProgress({ stage }: { stage: ProcessStage }) {
  const sideStatuses: ProcessStage[] = ['cliente_inativo', 'credito_recusado', 'processo_pendencia'];
  if (sideStatuses.includes(stage)) {
    return (
      <div className="ds-alert warn" style={{ marginTop: 0 }}>
        <Icon.AlertTriangle size={14} />
        <span>Status: <strong>{STAGE_LABELS[stage]}</strong></span>
      </div>
    );
  }

  const currentIdx = MAIN_STAGES.indexOf(stage);

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden' }}>
        {MAIN_STAGES.map((s, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <div
              key={s}
              title={STAGE_LABELS[s]}
              style={{
                flex: 1,
                height: 8,
                background: active ? STAGE_COLORS[s] : done ? '#86efac' : 'var(--border)',
                transition: 'background 0.3s',
              }}
            />
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: STAGE_COLORS[stage] }}>
        {STAGE_LABELS[stage]}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
        Etapa {MAIN_STAGES.indexOf(stage) + 1} de {MAIN_STAGES.length}
      </div>
    </div>
  );
}

// ── Document list ──────────────────────────────────────────────────────────────

function DocumentChecklist({ processId }: { processId: string }) {
  const qc = useQueryClient();
  const { data: docs = [], isLoading } = useQuery<Document[]>({
    queryKey: ['documents', processId],
    queryFn: () => api.get(`/processes/${processId}/documents`).then(r => r.data),
  });

  const markReceived = useMutation({
    mutationFn: (docId: string) =>
      api.patch(`/documents/${docId}`, { status: 'recebido' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', processId] }),
  });

  if (isLoading) {
    return <div style={{ fontSize: 13, color: 'var(--text-faint)', padding: 24 }}>Carregando documentos...</div>;
  }

  if (docs.length === 0) {
    return (
      <div className="ds-card">
        <div className="ds-card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-faint)', fontSize: 13 }}>
          Nenhum documento solicitado ainda. Seu analista irá preparar a lista em breve.
        </div>
      </div>
    );
  }

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

  const pendingCount = docs.filter(d => d.status === 'pendente').length;
  const validatedCount = docs.filter(d => d.status === 'validado').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary bar */}
      <div
        style={{
          display: 'flex', gap: 20, padding: '12px 16px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', fontSize: 13,
        }}
      >
        <span><strong>{docs.length}</strong> <span style={{ color: 'var(--text-muted)' }}>total</span></span>
        <span><strong style={{ color: '#dc2626' }}>{pendingCount}</strong> <span style={{ color: 'var(--text-muted)' }}>pendentes</span></span>
        <span><strong style={{ color: '#16a34a' }}>{validatedCount}</strong> <span style={{ color: 'var(--text-muted)' }}>aprovados</span></span>
      </div>

      {Object.entries(byCategory).map(([cat, catDocs]) => (
        <div className="ds-card" key={cat}>
          <div className="ds-card-hdr">{catLabels[cat] ?? cat}</div>
          <div className="ds-card-body" style={{ padding: 0 }}>
            {catDocs.map((doc, idx) => {
              const badge = STATUS_BADGE[doc.status];
              return (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      width: 32, height: 32, borderRadius: 'var(--radius)',
                      background: doc.status === 'validado' ? '#dcfce7' : doc.status === 'rejeitado' ? '#fee2e2' : 'var(--surface)',
                      border: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon.FileText size={14} style={{ color: doc.status === 'validado' ? '#16a34a' : doc.status === 'rejeitado' ? '#dc2626' : 'var(--text-faint)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{doc.label ?? doc.name}</div>
                    {doc.validatedByNotes && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        {doc.validatedByNotes}
                      </div>
                    )}
                  </div>
                  <span className={`ds-badge ${badge.cls}`}>{badge.label}</span>
                  {doc.status === 'pendente' && (
                    <button
                      className="ds-btn ghost sm"
                      onClick={() => markReceived.mutate(doc.id)}
                      disabled={markReceived.isPending}
                      title="Marcar como enviado"
                      style={{ fontSize: 11.5 }}
                    >
                      Enviei
                    </button>
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

// ── Main ───────────────────────────────────────────────────────────────────────

export function ClientePortalPage() {
  const { logout, name } = useAuth();

  const { data: processes = [], isLoading } = useQuery<ProcessCard[]>({
    queryKey: ['my-processes'],
    queryFn: () => api.get('/processes').then(r => r.data),
  });

  const process = processes[0] ?? null;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        fontFamily: 'var(--font)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', height: 52,
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'var(--accent)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: '#fff',
            }}
          >
            F
          </div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Flui Contratos</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{name}</span>
          <button className="ds-btn ghost sm" onClick={logout}>Sair</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Meu Processo</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 28 }}>
          Acompanhe o andamento do seu financiamento imobiliário.
        </p>

        {isLoading && (
          <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>Carregando...</div>
        )}

        {!isLoading && !process && (
          <div className="ds-card">
            <div className="ds-card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-faint)', fontSize: 13 }}>
              Nenhum processo encontrado. Entre em contato com sua assessoria.
            </div>
          </div>
        )}

        {process && (
          <>
            {/* Stage progress */}
            <div className="ds-card" style={{ marginBottom: 20 }}>
              <div className="ds-card-hdr">Andamento do Processo</div>
              <div className="ds-card-body">
                <StageProgress stage={process.stage} />

                {process.unidade && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <dl className="ds-kv">
                      <dt>Unidade</dt>
                      <dd>{process.unidade.identificacao}</dd>
                      <dt>Valor</dt>
                      <dd>{formatCurrency(process.valorUnidade ?? process.unidade.valor)}</dd>
                      {process.analista && (
                        <>
                          <dt>Analista</dt>
                          <dd>{process.analista.name ?? process.analista.email}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                )}
              </div>
            </div>

            {/* Documents */}
            <div style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Documentos Necessários</h2>
              <DocumentChecklist processId={process.id} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
