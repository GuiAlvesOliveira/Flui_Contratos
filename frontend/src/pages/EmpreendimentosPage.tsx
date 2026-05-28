import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';
import { NovoEmpreendimentoWizard } from '../components/NovoEmpreendimentoWizard';
import { useAuth } from '../auth/useAuth';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Empreendimento {
  id: string;
  nome: string;
  endereco: string;
  cep: string;
  bancoFinanciador: string;
  construtoraInfo: string | null;
  incorporadoraContato: string | null;
  active: boolean;
  createdAt: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface EmpCardProps {
  emp: Empreendimento;
  onClick: () => void;
  onDelete?: () => void;
  deleteError?: string;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
          <span className="label">Ativo</span>
        </div>
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
        {deleteError && (
          <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>{deleteError}</div>
        )}
        <div className="ds-emp-stats">
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
        <td>{emp.bancoFinanciador}</td>
        <td>{emp.construtoraInfo ?? '—'}</td>
        <td>
          <span className="ds-badge green"><span className="dot" />Ativo</span>
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
          <td colSpan={5} style={{ padding: '0 16px 8px', fontSize: 11.5, color: 'var(--red)' }}>{deleteError}</td>
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

  const filtered = empreendimentos.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.nome.toLowerCase().includes(q) ||
      e.endereco.toLowerCase().includes(q) ||
      e.bancoFinanciador.toLowerCase().includes(q)
    );
  });

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Empreendimentos</h1>
          <p>
            {isLoading ? 'Carregando...' : `${empreendimentos.length} empreendimento${empreendimentos.length !== 1 ? 's' : ''} cadastrado${empreendimentos.length !== 1 ? 's' : ''}`}
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
            placeholder="Buscar nome, endereço ou banco..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
            {search ? 'Nenhum empreendimento encontrado para a busca.' : 'Nenhum empreendimento cadastrado ainda.'}
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
                <th>Banco</th>
                <th>Construtora</th>
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
