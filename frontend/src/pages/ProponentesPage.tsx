import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import { NovoProcessoDrawer } from '../components/NovoProcessoDrawer';
import * as Icon from '../components/icons';
import { useAuth } from '../auth/useAuth';

// ── Exportar CSV (BE-17) ─────────────────────────────────────────────────────

// Relatório de todos os processos da assessoria, só para o gestor. O arquivo vem
// pronto da API (UTF-8 com BOM, separado por ponto e vírgula, para o Excel).
function ExportCsvButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    setBusy(true);
    setError('');
    try {
      const resp = await api.get('/processes/export', { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `processos-${new Date().toLocaleDateString('sv-SE')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError('Não foi possível exportar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{error}</span>}
      <button className="ds-btn" onClick={handleExport} disabled={busy}>
        <Icon.Download size={13} />
        {busy ? 'Exportando...' : 'Exportar CSV'}
      </button>
    </>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ProcessStage =
  | 'inicial' | 'cadastro' | 'analise_credito' | 'credito_aprovado'
  | 'analise_juridica' | 'juridico_aprovado' | 'cartorio' | 'assinatura'
  | 'cliente_inativo' | 'credito_recusado' | 'processo_pendencia';

interface ProcessCard {
  id: string;
  stage: ProcessStage;
  valorUnidade: number | null;
  updatedAt: string;
  createdAt: string;
  client: { id: string; name: string | null; email: string; cpf: string | null };
  analista: { id: string; name: string | null } | null;
  unidade: { id: string; identificacao: string } | null;
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

const STAGE_BADGE: Record<ProcessStage, string> = {
  inicial: 'neutral',
  cadastro: 'blue',
  analise_credito: 'amber',
  credito_aprovado: 'green',
  analise_juridica: 'violet',
  juridico_aprovado: 'green',
  cartorio: 'blue',
  assinatura: 'green',
  cliente_inativo: 'neutral',
  credito_recusado: 'red',
  processo_pendencia: 'amber',
};

const MAIN_STAGES: ProcessStage[] = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
];

const SIDE_STAGES: ProcessStage[] = ['cliente_inativo', 'credito_recusado', 'processo_pendencia'];

const ALL_STAGES: ProcessStage[] = [...MAIN_STAGES, ...SIDE_STAGES];

// Proponentes (client groups) per page — a client's processes never split across pages.
const PAGE_SIZE = 20;
const SEM_ANALISTA = '__sem_analista__';

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function formatCurrency(v: number | null) {
  if (!v) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function initials(name: string | null, email: string) {
  if (name) return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

// ── Stage filter tabs ─────────────────────────────────────────────────────────

interface FilterTabProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function FilterTab({ label, count, active, onClick }: FilterTabProps) {
  return (
    <button
      className={`ds-chip ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {label}
      {count > 0 && (
        <span
          style={{
            marginLeft: 4,
            fontSize: 10,
            background: active ? 'rgba(255,255,255,0.3)' : 'var(--border)',
            color: active ? 'inherit' : 'var(--text-muted)',
            borderRadius: 10,
            padding: '0 5px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

interface Props {
  onOpenProcess: (id: string) => void;
}

export function ProponentesPage({ onOpenProcess }: Props) {
  const { role } = useAuth();
  const isDono = role === 'dono';
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<ProcessStage | 'todos'>('todos');
  const [analistaFilter, setAnalistaFilter] = useState<string>('todos');
  const [page, setPage] = useState(1);
  const [showDrawer, setShowDrawer] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const { data: processes = [], isLoading, isError } = useQuery<ProcessCard[]>({
    queryKey: ['processes'],
    queryFn: () => api.get('/processes').then(r => r.data),
    refetchInterval: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (processId: string) => api.delete(`/processes/${processId}`).then(r => r.data),
    onSuccess: (_, processId) => {
      void qc.invalidateQueries({ queryKey: ['processes'] });
      setDeleteErrors(e => { const n = { ...e }; delete n[processId]; return n; });
    },
    onError: (err: unknown, processId) => {
      const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const msg = Array.isArray(axiosMsg) ? axiosMsg.join('; ') : (axiosMsg ?? (err instanceof Error ? err.message : 'Erro'));
      setDeleteErrors(e => ({ ...e, [processId]: msg }));
    },
  });

  const handleDelete = (processId: string, clientName: string | null, unidade: string | null) => {
    const label = [clientName, unidade].filter(Boolean).join(' — ');
    if (!window.confirm(`Remover o processo "${label || processId}"? O cliente não será excluído.`)) return;
    setDeleteErrors(e => { const n = { ...e }; delete n[processId]; return n; });
    deleteMut.mutate(processId);
  };

  // An analista only receives their own processes from the API, so the filter
  // is only useful to the dono.
  const showAnalistaFilter = role !== 'analista';
  const analistas = [...new Map(
    processes.filter(p => p.analista).map(p => [p.analista!.id, p.analista!]),
  ).values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'));
  const hasSemAnalista = processes.some(p => !p.analista);

  // Every filter except the stage one: the stage tabs count within this set.
  const q = search.toLowerCase();
  const cpfQuery = search.replace(/\D/g, '');
  const base = processes.filter(p => {
    const matchAnalista =
      analistaFilter === 'todos' ||
      (analistaFilter === SEM_ANALISTA ? !p.analista : p.analista?.id === analistaFilter);
    const matchSearch =
      !search ||
      (p.client.name ?? '').toLowerCase().includes(q) ||
      p.client.email.toLowerCase().includes(q) ||
      (!!cpfQuery && (p.client.cpf ?? '').replace(/\D/g, '').includes(cpfQuery));
    return matchAnalista && matchSearch;
  });
  const filtered = base.filter(p => stageFilter === 'todos' || p.stage === stageFilter);

  const countFor = (stage: ProcessStage | 'todos') =>
    stage === 'todos' ? base.length : base.filter(p => p.stage === stage).length;

  // Group by client (one row block per proponente), newest activity first, then paginate.
  const groups = new Map<string, ProcessCard[]>();
  for (const p of filtered) {
    if (!groups.has(p.client.id)) groups.set(p.client.id, []);
    groups.get(p.client.id)!.push(p);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => {
    const latestA = Math.max(...a.map(p => new Date(p.updatedAt).getTime()));
    const latestB = Math.max(...b.map(p => new Date(p.updatedAt).getTime()));
    return latestB - latestA;
  });
  const totalPages = Math.max(1, Math.ceil(sortedGroups.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const firstIdx = (currentPage - 1) * PAGE_SIZE;
  const pageGroups = sortedGroups.slice(firstIdx, firstIdx + PAGE_SIZE);

  // Any filter change goes back to the first page.
  const changeFilter = (apply: () => void) => { apply(); setPage(1); };

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Proponentes</h1>
          <p>
            {isLoading ? 'Carregando...' : `${processes.length} processo${processes.length !== 1 ? 's' : ''} no total`}
          </p>
        </div>
        <div className="actions">
          {isDono && <ExportCsvButton />}
          <button className="ds-btn accent" onClick={() => setShowDrawer(true)}>
            <Icon.Plus size={13} />
            Novo Processo
          </button>
        </div>
      </div>

      {isError && (
        <div className="ds-alert urgent" style={{ marginBottom: 16 }}>
          <Icon.AlertTriangle size={14} />
          <span>Erro ao carregar processos.</span>
        </div>
      )}

      {/* Search + filter */}
      <div className="ds-list-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="ds-input" style={{ flex: '0 0 280px' }}>
          <Icon.Search size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            placeholder="Buscar nome, e-mail ou CPF..."
            value={search}
            onChange={e => changeFilter(() => setSearch(e.target.value))}
          />
        </div>

        {showAnalistaFilter && (
          <div className="ds-input" style={{ flex: '0 0 220px' }}>
            <Icon.Users size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
            <select
              value={analistaFilter}
              onChange={e => changeFilter(() => setAnalistaFilter(e.target.value))}
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}
            >
              <option value="todos">Todos os analistas</option>
              {analistas.map(a => (
                <option key={a.id} value={a.id}>{a.name ?? 'Analista sem nome'}</option>
              ))}
              {hasSemAnalista && <option value={SEM_ANALISTA}>Sem analista</option>}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <FilterTab
            label="Todos"
            count={countFor('todos')}
            active={stageFilter === 'todos'}
            onClick={() => changeFilter(() => setStageFilter('todos'))}
          />
          {ALL_STAGES.map(s => {
            const n = countFor(s);
            if (n === 0 && stageFilter !== s) return null;
            return (
              <FilterTab
                key={s}
                label={STAGE_LABELS[s]}
                count={n}
                active={stageFilter === s}
                onClick={() => changeFilter(() => setStageFilter(s))}
              />
            );
          })}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="ds-card">
          <div className="ds-card-body" style={{ textAlign: 'center', padding: 60, color: 'var(--text-faint)', fontSize: 13 }}>
            {search || stageFilter !== 'todos' || analistaFilter !== 'todos'
              ? 'Nenhum proponente encontrado para os filtros selecionados.'
              : 'Nenhum processo cadastrado ainda. Clique em "Novo Processo" para começar.'}
          </div>
        </div>
      ) : (
        <div className="ds-card">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Proponente</th>
                <th>Etapa</th>
                <th>Analista</th>
                <th>Unidade</th>
                <th>Valor</th>
                <th>Atualizado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageGroups.flatMap((group, groupIdx) =>
                group.map((p, idx) => {
                const days = daysSince(p.updatedAt);
                const isLate = days >= 7 && MAIN_STAGES.includes(p.stage);
                const processDeleteError = deleteErrors[p.id];
                const isFirstInGroup = idx === 0;
                return (
                  <Fragment key={p.id}>
                    <tr
                      onClick={() => onOpenProcess(p.id)}
                      style={{ cursor: 'pointer', borderTop: isFirstInGroup && groupIdx > 0 ? '2px solid var(--border)' : undefined }}
                    >
                      <td>
                        {isFirstInGroup ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 30, height: 30, borderRadius: '50%',
                              background: 'var(--accent-soft)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 11, fontWeight: 700, color: 'var(--accent)',
                              flexShrink: 0,
                            }}>
                              {initials(p.client.name, p.client.email)}
                            </div>
                            <div>
                              <div style={{ fontWeight: 500, fontSize: 13 }}>
                                {p.client.name ?? p.client.email}
                                {group.length > 1 && (
                                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-faint)', background: 'var(--bg-subtle)', padding: '1px 5px', borderRadius: 4 }}>
                                    {group.length}×
                                  </span>
                                )}
                              </div>
                              {p.client.cpf && (
                                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.client.cpf}</div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div style={{ paddingLeft: 40, fontSize: 12, color: 'var(--text-faint)' }}>↳</div>
                        )}
                      </td>
                      <td>
                        <span className={`ds-badge ${STAGE_BADGE[p.stage]}`}>
                          <span className="dot" />
                          {STAGE_LABELS[p.stage]}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                        {p.analista?.name ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                        {p.unidade?.identificacao ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                        {formatCurrency(p.valorUnidade)}
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: isLate ? 'var(--red)' : 'var(--text-faint)' }}>
                          {days === 0 ? 'hoje' : days === 1 ? 'ontem' : `${days}d`}
                          {isLate && ' ⚠'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                          {isDono && (
                            <button
                              className="ds-btn ghost sm"
                              style={{ color: 'var(--red)' }}
                              onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.client.name, p.unidade?.identificacao ?? null); }}
                              title="Remover processo"
                            >
                              <Icon.Trash size={13} />
                            </button>
                          )}
                          <Icon.ChevronRight size={14} style={{ color: 'var(--text-faint)' }} />
                        </div>
                      </td>
                    </tr>
                    {processDeleteError && (
                      <tr>
                        <td colSpan={7} style={{ padding: '0 16px 8px', fontSize: 11.5, color: 'var(--red)' }}>{processDeleteError}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
              )}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
            <span>
              {sortedGroups.length === 1
                ? '1 proponente'
                : `Mostrando ${firstIdx + 1}–${firstIdx + pageGroups.length} de ${sortedGroups.length} proponentes`}
            </span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="ds-btn ghost sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                  ← Anterior
                </button>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>Página {currentPage} de {totalPages}</span>
                <button className="ds-btn ghost sm" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
                  Próxima →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showDrawer && (
        <NovoProcessoDrawer
          onClose={() => setShowDrawer(false)}
          onSuccess={(id) => {
            setShowDrawer(false);
            onOpenProcess(id);
          }}
        />
      )}
    </div>
  );
}
