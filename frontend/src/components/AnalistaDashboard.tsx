import { useQuery } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';

// ── Types ─────────────────────────────────────────────────────────────────────

type ProcessStage =
  | 'inicial' | 'cadastro' | 'analise_credito' | 'credito_aprovado'
  | 'analise_juridica' | 'juridico_aprovado' | 'cartorio' | 'assinatura'
  | 'cliente_inativo' | 'credito_recusado' | 'processo_pendencia';

interface ProcessCard {
  id: string;
  stage: ProcessStage;
  client: { id: string; name: string | null; email: string };
  analista: { id: string; name: string | null; email: string } | null;
  valorUnidade: number | null;
  updatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const MAIN_STAGES: ProcessStage[] = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
];

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, meta, icon }: { label: string; value: string | number; meta: string; icon: React.ReactNode }) {
  return (
    <div className="ds-kpi">
      <div className="ds-kpi-label">{icon}{label}</div>
      <div className="ds-kpi-value">{value}</div>
      <div className="ds-kpi-meta">{meta}</div>
    </div>
  );
}

function PhaseRow({ stage, count, total }: { stage: ProcessStage; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="ds-phase-row">
      <div className="ds-phase-name">
        <span className="ds-phase-dot" style={{ background: STAGE_COLORS[stage] }} />
        {STAGE_LABELS[stage]}
      </div>
      <div className="ds-phase-bar">
        <span style={{ width: `${pct}%`, background: STAGE_COLORS[stage] }} />
      </div>
      <div className="ds-phase-count">{count}</div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

interface Props {
  analistaName: string | null;
  onNavigate: (page: string) => void;
}

export function AnalistaDashboard({ analistaName, onNavigate }: Props) {
  const { data: processes = [], isLoading } = useQuery<ProcessCard[]>({
    queryKey: ['processes'],
    queryFn: () => api.get<ProcessCard[]>('/processes').then(r => r.data),
    refetchInterval: 60_000,
  });

  const { data: docStats } = useQuery<{ pending: number; total: number }>({
    queryKey: ['documents', 'stats'],
    queryFn: () => api.get<{ pending: number; total: number }>('/documents/stats').then(r => r.data),
    refetchInterval: 60_000,
  });

  const byStage = (s: ProcessStage) => processes.filter(p => p.stage === s);

  const activeProcesses = processes.filter(p => MAIN_STAGES.includes(p.stage) && p.stage !== 'inicial');
  const pendentes = byStage('processo_pendencia');
  const lateProcesses = activeProcesses
    .filter(p => daysSince(p.updatedAt) >= 7)
    .sort((a, b) => daysSince(b.updatedAt) - daysSince(a.updatedAt))
    .slice(0, 5);

  const recentUpdates = [...processes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 6);

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Meu Painel</h1>
          <p>
            {analistaName ? `Olá, ${analistaName.split(' ')[0]}` : 'Bem-vindo'} · {isLoading ? '…' : `${processes.length} processo${processes.length !== 1 ? 's' : ''} atribuído${processes.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="actions">
          <button className="ds-btn accent" onClick={() => onNavigate('workflow')}>
            <Icon.Layout size={13} />
            Ver workflow
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="ds-kpi-row">
        <KpiCard
          label="Meus processos ativos"
          value={isLoading ? '…' : activeProcesses.length}
          meta={`${processes.length} total atribuídos`}
          icon={<Icon.Activity size={12} />}
        />
        <KpiCard
          label="Em análise de crédito"
          value={isLoading ? '…' : byStage('analise_credito').length}
          meta="Recolhimento de documentos"
          icon={<Icon.Banknote size={12} />}
        />
        <KpiCard
          label="Com pendência"
          value={isLoading ? '…' : pendentes.length}
          meta="Requerem atenção imediata"
          icon={<Icon.AlertTriangle size={12} />}
        />
        <KpiCard
          label="Docs para validar"
          value={docStats == null ? '…' : docStats.pending}
          meta={docStats ? `${docStats.total} docs no total` : 'Aguardando validação'}
          icon={<Icon.FileText size={12} />}
        />
      </div>

      {/* Grid */}
      <div className="ds-dash-grid">

        {/* Distribuição por etapa */}
        <div className="ds-col-5">
          <div className="ds-card">
            <div className="ds-card-hdr">
              <h3>Meus processos por etapa</h3>
              <span className="meta">{processes.length} total</span>
            </div>
            <div className="ds-card-body" style={{ padding: 0 }}>
              {isLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Carregando...</div>
              ) : MAIN_STAGES.map(stage => (
                <PhaseRow key={stage} stage={stage} count={byStage(stage).length} total={processes.length} />
              ))}
            </div>
          </div>
        </div>

        {/* Alertas */}
        <div className="ds-col-7">
          <div className="ds-card">
            <div className="ds-card-hdr"><h3>Alertas</h3></div>
            <div className="ds-card-body" style={{ padding: 0 }}>
              {pendentes.length > 0 && pendentes.slice(0, 3).map(p => (
                <div key={p.id} className="ds-alert warn">
                  <div className="ds-alert-icon"><Icon.AlertTriangle size={14} /></div>
                  <div style={{ flex: 1 }}>
                    <div className="ds-alert-title">Processo com pendência</div>
                    <div className="ds-alert-desc">{p.client.name ?? p.client.email} · {daysSince(p.updatedAt)}d sem atualização</div>
                  </div>
                </div>
              ))}
              {byStage('credito_recusado').slice(0, 2).map(p => (
                <div key={p.id} className="ds-alert urgent">
                  <div className="ds-alert-icon"><Icon.AlertTriangle size={14} /></div>
                  <div style={{ flex: 1 }}>
                    <div className="ds-alert-title">Crédito recusado</div>
                    <div className="ds-alert-desc">{p.client.name ?? p.client.email} · Verificar possibilidade de defesa</div>
                  </div>
                </div>
              ))}
              {pendentes.length === 0 && byStage('credito_recusado').length === 0 && (
                <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                  Nenhum alerta no momento
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Processos sem atualização */}
        <div className="ds-col-8">
          <div className="ds-card">
            <div className="ds-card-hdr">
              <h3>Meus processos sem atualização recente</h3>
              <span className="meta">≥ 7 dias</span>
            </div>
            {lateProcesses.length > 0 ? (
              <div style={{ padding: 0 }}>
                {lateProcesses.map(p => (
                  <div key={p.id} className="ds-proc-row">
                    <div>
                      <div className="pr-title">{p.client.name ?? p.client.email}</div>
                      <div className="pr-sub">{STAGE_LABELS[p.stage]}</div>
                    </div>
                    <div className="pr-stage">{STAGE_LABELS[p.stage]}</div>
                    <div className="pr-days" style={{ color: daysSince(p.updatedAt) > 14 ? 'var(--red)' : 'var(--amber)' }}>
                      {daysSince(p.updatedAt)}d
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                {isLoading ? 'Carregando...' : 'Todos os processos estão atualizados'}
              </div>
            )}
          </div>
        </div>

        {/* Ação rápida */}
        <div className="ds-col-4">
          <div className="ds-card">
            <div className="ds-card-hdr"><h3>Ação rápida</h3></div>
            <div className="ds-card-body" style={{ padding: 0 }}>
              <div className="ds-pri">
                <div className="ds-pri-rank">1</div>
                <div style={{ flex: 1 }}>
                  <div className="ds-pri-title">Pendências</div>
                  <div className="ds-pri-sub">{pendentes.length} processo(s) com pendência</div>
                </div>
              </div>
              <div className="ds-pri">
                <div className="ds-pri-rank">2</div>
                <div style={{ flex: 1 }}>
                  <div className="ds-pri-title">Validar documentos</div>
                  <div className="ds-pri-sub">{docStats?.pending ?? '…'} doc(s) aguardando validação</div>
                </div>
              </div>
              <div className="ds-pri">
                <div className="ds-pri-rank">3</div>
                <div style={{ flex: 1 }}>
                  <div className="ds-pri-title">Crédito recusado</div>
                  <div className="ds-pri-sub">{byStage('credito_recusado').length} caso(s) para defesa</div>
                </div>
              </div>
              <div style={{ padding: '10px 12px' }}>
                <button
                  className="ds-btn accent"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => onNavigate('proponentes')}
                >
                  <Icon.Users size={13} />
                  Meus proponentes
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Atualizações recentes */}
        <div className="ds-col-12">
          <div className="ds-card">
            <div className="ds-card-hdr">
              <h3>Minhas atualizações recentes</h3>
              <span className="meta">{recentUpdates.length} processos</span>
            </div>
            <div className="ds-card-body" style={{ padding: 0 }}>
              {isLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Carregando...</div>
              ) : recentUpdates.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                  Nenhum processo atribuído ainda
                </div>
              ) : (
                <div className="ds-timeline" style={{ padding: '6px 14px' }}>
                  {recentUpdates.map(p => (
                    <div key={p.id} className="ds-tl-row">
                      <div className="ds-tl-time">
                        {new Date(p.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </div>
                      <div className="ds-tl-content">
                        <div className="ds-tl-title">{STAGE_LABELS[p.stage]}</div>
                        <div className="ds-tl-desc">
                          {p.client.name ?? p.client.email}
                          {p.valorUnidade ? ` · R$ ${Number(p.valorUnidade).toLocaleString('pt-BR')}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
