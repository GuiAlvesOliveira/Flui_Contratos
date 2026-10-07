import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';
import { NovoEmpreendimentoWizard } from '../components/NovoEmpreendimentoWizard';
import { useAuth } from '../auth/useAuth';

// ── Types ─────────────────────────────────────────────────────────────────────

type EmpStatus = 'em_andamento' | 'concluido' | 'sem_processos';

interface Empreendimento {
  id: string;
  nome: string;
  matriculaMae: string;
  endereco: string;
  cep: string;
  bancoFinanciador: string;
  construtoraInfo: string | null;
  incorporadoraContato: string | null;
  active: boolean;
  createdAt: string;
  // Counts and status computed by GET /empreendimentos (analista: own processes only)
  processCount: number;
  processosEmAndamento: number;
  processosConcluidos: number;
  status: EmpStatus;
}

type StatusFilter = 'todos' | EmpStatus;

const STATUS_META: Record<EmpStatus, { label: string; badge: string }> = {
  em_andamento: { label: 'Em andamento', badge: 'violet' },
  concluido: { label: 'Concluído', badge: 'green' },
  sem_processos: { label: 'Sem processos', badge: 'neutral' },
};

const STATUS_ORDER: EmpStatus[] = ['em_andamento', 'concluido', 'sem_processos'];

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface EmpCardProps {
  emp: Empreendimento;
  onClick: () => void;
  onDelete?: () => void;
  deleteError?: string;
}

function StatusBadge({ status }: { status: EmpStatus }) {
  const meta = STATUS_META[status] as (typeof STATUS_META)[EmpStatus] | undefined;
  if (!meta) return null; // API anterior ao status (deploy do backend em andamento)
  return <span className={`ds-badge ${meta.badge}`}><span className="dot" />{meta.label}</span>;
}

function EmpCard({ emp, onClick, onDelete, deleteError }: EmpCardProps) {
  return (
    <div className="ds-emp-card" onClick={onClick} style={{ cursor: 'pointer', position: 'relative' }}>
      <div
        className="ds-emp-cover"
        style={{
          background: 'linear-gradient(135deg, #7c3aed1f, #7c3aed08), repeating-linear-gradient(135deg, #f4f4f5 0 12px, #fafafa 12px 24px)',
        }}
      >
        <StatusBadge status={emp.status} />
        {onDelete && (
          <button
            className="ds-btn ghost sm"
            style={{ marginLeft: 'auto', color: 'var(--red)' }}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Excluir empreendimento"
          >
            <Icon.Trash size={13} />
          </button>
        )}
      </div>
      <div className="ds-emp-info">
        <div className="ds-emp-name">{emp.nome}</div>
        <div className="ds-emp-loc">
          <Icon.MapPin size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />
          {emp.endereco}
        </div>
        <div className="ds-emp-loc">
          <Icon.FileText size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />
          Matrícula {emp.matriculaMae}
        </div>
        {deleteError && (
          <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>{deleteError}</div>
        )}
        <div className="ds-emp-stats">
          <div title={`${emp.processosEmAndamento} em andamento · ${emp.processosConcluidos} concluído(s)`}>
            <div className="ds-emp-stat-l">Processos</div>
            <div className="ds-emp-stat-v">{emp.processCount}</div>
          </div>
          <div>
            <div className="ds-emp-stat-l">Banco</div>
            <div className="ds-emp-stat-v" style={{ fontSize: 11 }}>{emp.bancoFinanciador}</div>
          </div>
          {emp.construtoraInfo && (
            <div>
              <div className="ds-emp-stat-l">Construtora</div>
              <div className="ds-emp-stat-v" style={{ fontSize: 11 }}>{emp.construtoraInfo}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmpTableRow({ emp, onClick, onDelete, deleteError }: EmpCardProps) {
  return (
    <>
      <tr onClick={onClick} style={{ cursor: 'pointer' }}>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{emp.nome}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{emp.endereco}</div>
            </div>
          </div>
        </td>
        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{emp.matriculaMae}</td>
        <td>{emp.bancoFinanciador}</td>
        <td>{emp.construtoraInfo ?? '—'}</td>
        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{emp.processCount}</td>
        <td>
          <StatusBadge status={emp.status} />
        </td>
        <td style={{ textAlign: 'right' }}>
          {onDelete ? (
            <button
              className="ds-btn ghost sm"
              style={{ color: 'var(--red)' }}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Excluir"
            >
              <Icon.Trash size={13} />
            </button>
          ) : (
            <Icon.ChevronRight size={14} style={{ color: 'var(--text-faint)' }} />
          )}
        </td>
      </tr>
      {deleteError && (
        <tr>
          <td colSpan={7} style={{ padding: '0 16px 8px', fontSize: 11.5, color: 'var(--red)' }}>{deleteError}</td>
        </tr>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onOpen: (id: string) => void;
}

export function EmpreendimentosPage({ onOpen }: Props) {
  const { role } = useAuth();
  const isDono = role === 'dono';
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showWizard, setShowWizard] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const { data: empreendimentos = [], isLoading, isError } = useQuery<Empreendimento[]>({
    queryKey: ['empreendimentos'],
    queryFn: () => api.get('/empreendimentos').then(r => r.data),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/empreendimentos/${id}`).then(r => r.data),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: ['empreendimentos'] });
      setDeleteErrors(e => { const n = { ...e }; delete n[id]; return n; });
    },
    onError: (err: unknown, id) => {
      const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const msg = Array.isArray(axiosMsg) ? axiosMsg.join('; ') : (axiosMsg ?? (err instanceof Error ? err.message : 'Erro'));
      setDeleteErrors(e => ({ ...e, [id]: msg }));
    },
  });

  const handleDelete = (id: string, nome: string) => {
    if (!window.confirm(`Excluir "${nome}"? Esta ação não pode ser desfeita.`)) return;
    setDeleteErrors(e => { const n = { ...e }; delete n[id]; return n; });
    deleteMut.mutate(id);
  };

  const matchesSearch = (e: Empreendimento) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.nome.toLowerCase().includes(q) ||
      e.endereco.toLowerCase().includes(q) ||
      e.bancoFinanciador.toLowerCase().includes(q) ||
      e.matriculaMae.toLowerCase().includes(q)
    );
  };
  const searched = empreendimentos.filter(matchesSearch);
  const countFor = (s: StatusFilter) => (s === 'todos' ? searched.length : searched.filter(e => e.status === s).length);
  const filtered = statusFilter === 'todos' ? searched : searched.filter(e => e.status === statusFilter);
  const totalProcessos = empreendimentos.reduce((sum, e) => sum + (e.processCount ?? 0), 0);

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Empreendimentos</h1>
          <p>
            {isLoading
              ? 'Carregando...'
              : `${plural(empreendimentos.length, 'empreendimento cadastrado', 'empreendimentos cadastrados')} · ${plural(totalProcessos, 'processo', 'processos')}`}
          </p>
        </div>
        <div className="actions">
          <button className="ds-btn accent" onClick={() => setShowWizard(true)}>
            <Icon.Plus size={13} />
            Novo empreendimento
          </button>
        </div>
      </div>

      {isError && (
        <div className="ds-alert urgent" style={{ marginBottom: 16 }}>
          <Icon.AlertTriangle size={14} />
          <span>Erro ao carregar empreendimentos.</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="ds-list-toolbar">
        <div className="ds-input" style={{ flex: 1, maxWidth: 320 }}>
          <Icon.Search size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            placeholder="Buscar nome, endereço, banco ou matrícula..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Filtrar por status">
          {(['todos', ...STATUS_ORDER] as StatusFilter[]).map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                className={`ds-chip ${active ? 'active' : ''}`}
                aria-pressed={active}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'todos' ? 'Todos' : STATUS_META[s].label}
                <span
                  style={{
                    fontSize: 10,
                    background: active ? 'rgba(255,255,255,0.3)' : 'var(--border)',
                    color: active ? 'inherit' : 'var(--text-muted)',
                    borderRadius: 10,
                    padding: '0 5px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {countFor(s)}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ marginLeft: 'auto' }}>
          <div className="ds-seg">
            <button className={`ds-seg-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>
              <Icon.Grid size={13} />
            </button>
            <button className={`ds-seg-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>
              <Icon.List size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando empreendimentos...</div>
      ) : filtered.length === 0 ? (
        <div className="ds-card">
          <div className="ds-card-body" style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            {search || statusFilter !== 'todos'
              ? 'Nenhum empreendimento encontrado para os filtros selecionados.'
              : 'Nenhum empreendimento cadastrado ainda.'}
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="ds-emp-grid">
          {filtered.map((emp) => (
            <EmpCard
              key={emp.id}
              emp={emp}
              onClick={() => onOpen(emp.id)}
              onDelete={isDono ? () => handleDelete(emp.id, emp.nome) : undefined}
              deleteError={deleteErrors[emp.id]}
            />
          ))}
        </div>
      ) : (
        <div className="ds-card">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th>Matrícula</th>
                <th>Banco</th>
                <th>Construtora</th>
                <th>Processos</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <EmpTableRow
                  key={emp.id}
                  emp={emp}
                  onClick={() => onOpen(emp.id)}
                  onDelete={isDono ? () => handleDelete(emp.id, emp.nome) : undefined}
                  deleteError={deleteErrors[emp.id]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showWizard && (
        <NovoEmpreendimentoWizard
          onClose={() => setShowWizard(false)}
          onSuccess={(empId) => {
            setShowWizard(false);
            onOpen(empId);
          }}
        />
      )}
    </div>
  );
}
