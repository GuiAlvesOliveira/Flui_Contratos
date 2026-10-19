import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';
import { TaskDrawer } from '../components/TaskDrawer';
import { apiErrorMessage } from '../lib/documentCatalog';
import {
  dueLabel, TASK_STATUS_LABELS, taskColor, useAssignees, useTasks,
  type TaskDueFilter, type TaskItem, type TaskStatus,
} from '../lib/tasks';
import { todayIso } from '../lib/validators';

interface Props {
  role: string | null;
  onOpenProcess: (processId: string) => void;
}

const STATUS_FILTERS: { id: TaskStatus | ''; label: string }[] = [
  { id: '', label: 'Todas' },
  { id: 'a_fazer', label: 'A fazer' },
  { id: 'em_andamento', label: 'Em andamento' },
  { id: 'concluida', label: 'Concluídas' },
];
const DUE_FILTERS: { id: TaskDueFilter | ''; label: string }[] = [
  { id: '', label: 'Qualquer prazo' },
  { id: 'atrasadas', label: 'Atrasadas' },
  { id: 'hoje', label: 'Vencem hoje' },
  { id: 'semana', label: 'Próximos 7 dias' },
];

// PROD-01 — Tarefas da equipe. O analista vê as dele; o gestor vê as da
// assessoria inteira e filtra por responsável. Atrasada = prazo vencido e não
// concluída (destacada em vermelho).
export function TarefasPage({ role, onOpenProcess }: Props) {
  const isGestor = role === 'dono';
  const qc = useQueryClient();
  const [assigneeId, setAssigneeId] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [due, setDue] = useState<TaskDueFilter | ''>('');
  const [editing, setEditing] = useState<TaskItem | 'new' | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);

  const { data, isLoading, isError } = useTasks({ assigneeId, status: status || undefined, due: due || undefined });
  const { data: assignees = [] } = useAssignees();
  const tasks = data?.tasks ?? [];
  const counts = data?.counts;
  const today = todayIso();

  const toggleMut = useMutation({
    mutationFn: (t: TaskItem) => api.patch(`/tasks/${t.id}`, { status: t.status === 'concluida' ? 'a_fazer' : 'concluida' }),
    onSuccess: () => { setRowError(null); void qc.invalidateQueries({ queryKey: ['tasks'] }); },
    onError: (err: unknown, t) => setRowError({ id: t.id, text: apiErrorMessage(err, 'Não foi possível atualizar a tarefa') }),
  });

  const subtitle = isLoading || !counts
    ? 'Carregando...'
    : `${counts.total - counts.concluida} em aberto · ${counts.atrasadas} atrasada${counts.atrasadas !== 1 ? 's' : ''} · ${counts.hoje} para hoje`;

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Tarefas</h1>
          <p>{isGestor ? 'Tarefas de toda a equipe da assessoria.' : 'Suas tarefas e as que você criou.'} {subtitle}</p>
        </div>
        <div className="actions">
          <button className="ds-btn accent" onClick={() => setEditing('new')}>
            <Icon.Plus size={13} /> Nova tarefa
          </button>
        </div>
      </div>

      {counts && (
        <div className="ds-kpi-row compact-mobile">
          {[
            { label: 'Atrasadas', value: counts.atrasadas, meta: 'prazo vencido, não concluídas', color: counts.atrasadas > 0 ? 'var(--red)' : undefined, icon: <Icon.AlertTriangle size={13} /> },
            { label: 'Vencem hoje', value: counts.hoje, meta: 'prazo hoje', icon: <Icon.Clock size={13} /> },
            { label: 'Em andamento', value: counts.em_andamento, meta: `${counts.a_fazer} a fazer`, icon: <Icon.Activity size={13} /> },
            { label: 'Concluídas', value: counts.concluida, meta: `de ${counts.total} no total`, icon: <Icon.Check size={13} /> },
          ].map(k => (
            <div className="ds-kpi" key={k.label}>
              <div className="ds-kpi-label">{k.icon}{k.label}</div>
              <div className="ds-kpi-value" style={{ color: k.color }}>{k.value}</div>
              <div className="ds-kpi-meta">{k.meta}</div>
            </div>
          ))}
        </div>
      )}

      <div className="ds-list-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        {isGestor && (
          <div className="ds-input" style={{ flex: '0 0 220px' }}>
            <Icon.Users size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
            <select aria-label="Filtrar por responsável" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}>
              <option value="">Todos os responsáveis</option>
              {assignees.map(a => <option key={a.id} value={a.id}>{a.name}{a.role === 'dono' ? ' (gestor)' : ''}</option>)}
            </select>
          </div>
        )}
        <div className="ds-seg" role="group" aria-label="Filtrar por status">
          {STATUS_FILTERS.map(f => (
            <button key={f.id || 'todas'} className={`ds-seg-btn ${status === f.id ? 'active' : ''}`} aria-pressed={status === f.id}
              onClick={() => setStatus(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="ds-seg" role="group" aria-label="Filtrar por prazo">
          {DUE_FILTERS.map(f => (
            <button key={f.id || 'todos'} className={`ds-seg-btn ${due === f.id ? 'active' : ''}`} aria-pressed={due === f.id}
              onClick={() => setDue(f.id)}>
              {f.label}{f.id && counts ? ` (${counts[f.id]})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="ds-card">
        {isError ? (
          <div role="alert" style={{ padding: 24, textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>Não foi possível carregar as tarefas.</div>
        ) : isLoading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Carregando...</div>
        ) : tasks.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            {status || due || assigneeId ? 'Nenhuma tarefa com esses filtros.' : 'Nenhuma tarefa ainda. Crie a primeira em "Nova tarefa".'}
          </div>
        ) : (
          <table className="ds-table" aria-label="Tarefas">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>Tarefa</th>
                <th>Processo</th>
                {isGestor && <th>Responsável</th>}
                <th>Prazo</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.id} data-overdue={t.overdue || undefined}
                  style={t.overdue ? { boxShadow: 'inset 3px 0 0 var(--red)' } : undefined}>
                  <td>
                    <input type="checkbox" checked={t.status === 'concluida'} disabled={toggleMut.isPending}
                      aria-label={t.status === 'concluida' ? `Reabrir "${t.title}"` : `Concluir "${t.title}"`}
                      onChange={() => toggleMut.mutate(t)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  </td>
                  <td>
                    <button className="ds-btn ghost sm" onClick={() => setEditing(t)}
                      style={{ padding: 0, height: 'auto', fontWeight: 500, fontSize: 13, color: 'var(--text)', textDecoration: t.status === 'concluida' ? 'line-through' : undefined, textAlign: 'left' }}>
                      {t.title}
                    </button>
                    {t.description && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.description}
                      </div>
                    )}
                    {/* No celular a tabela rola para o lado: prazo e status também aparecem aqui */}
                    <div className="ds-only-mobile" style={{ fontSize: 11.5, marginTop: 2, color: t.overdue ? 'var(--red)' : 'var(--text-muted)' }}>
                      {dueLabel(t, today)} · {TASK_STATUS_LABELS[t.status]}{isGestor ? ` · ${t.assignee.name}` : ''}
                    </div>
                    {rowError?.id === t.id && <div role="alert" style={{ fontSize: 11.5, color: 'var(--red)' }}>{rowError.text}</div>}
                  </td>
                  <td>
                    {t.process ? (
                      <button className="ds-btn ghost sm" style={{ padding: 0, height: 'auto', color: 'var(--accent)', fontWeight: 500 }}
                        onClick={() => onOpenProcess(t.process!.id)}>
                        {t.process.clientName}
                      </button>
                    ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                  </td>
                  {isGestor && <td>{t.assignee.name}</td>}
                  <td style={{ whiteSpace: 'nowrap', color: t.overdue ? 'var(--red)' : undefined, fontWeight: t.overdue ? 600 : undefined }}>
                    {t.overdue && <Icon.AlertTriangle size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />}
                    {dueLabel(t, today)}
                  </td>
                  <td>
                    <span className={`ds-badge ${taskColor(t)}`}><span className="dot" />{TASK_STATUS_LABELS[t.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <TaskDrawer
          task={editing === 'new' ? null : editing}
          isGestor={isGestor}
          onClose={() => setEditing(null)}
          onOpenProcess={(id) => { setEditing(null); onOpenProcess(id); }}
        />
      )}
    </div>
  );
}
