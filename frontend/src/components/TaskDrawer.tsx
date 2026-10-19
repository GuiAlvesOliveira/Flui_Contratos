import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';
import { apiErrorMessage } from '../lib/documentCatalog';
import { STAGE_LABELS, type ProcessStage } from '../lib/processStages';
import { TASK_STATUS_LABELS, useAssignees, type TaskItem, type TaskStatus } from '../lib/tasks';
import { todayIso } from '../lib/validators';

interface ProcessOption {
  id: string;
  stage: ProcessStage;
  client: { name: string | null; surname?: string | null; email: string };
  unidade: { identificacao: string } | null;
}

interface Props {
  task: TaskItem | null; // null = nova tarefa
  isGestor: boolean;
  initialDueDate?: string;
  initialProcessId?: string;
  onClose: () => void;
  onOpenProcess?: (processId: string) => void;
}

const processLabel = (p: ProcessOption) =>
  [
    [p.client.name, p.client.surname].filter(Boolean).join(' ') || p.client.email,
    p.unidade?.identificacao,
    STAGE_LABELS[p.stage] ?? p.stage,
  ].filter(Boolean).join(' · ');

const selectStyle = { flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer', minWidth: 0 } as const;

// PROD-01: criar ou editar uma tarefa. O analista só escolhe processos dele
// (GET /processes já devolve só os dele) e a tarefa é sempre dele; o gestor
// escolhe o responsável. A API confere as mesmas regras.
export function TaskDrawer({ task, isGestor, initialDueDate, initialProcessId, onClose, onOpenProcess }: Props) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? initialDueDate ?? todayIso());
  const [processId, setProcessId] = useState(task?.process?.id ?? initialProcessId ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assignee.id ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'a_fazer');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: processes = [] } = useQuery<ProcessOption[]>({
    queryKey: ['processes'],
    queryFn: () => api.get<ProcessOption[]>('/processes').then(r => r.data),
  });
  const { data: assignees = [] } = useAssignees();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const done = () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    onClose();
  };
  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      task ? api.patch(`/tasks/${task.id}`, body) : api.post('/tasks', body),
    onSuccess: done,
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Não foi possível salvar a tarefa')),
  });
  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/tasks/${task!.id}`),
    onSuccess: done,
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Não foi possível excluir a tarefa')),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (t.length < 3) return setError('Informe um título com pelo menos 3 caracteres.');
    if (!dueDate) return setError('Informe o prazo.');
    setError('');
    const desc = description.trim() || null;
    if (!task) {
      saveMut.mutate({
        title: t,
        dueDate,
        ...(desc ? { description: desc } : {}),
        ...(processId ? { processId } : {}),
        ...(isGestor && assigneeId ? { assigneeId } : {}),
      });
      return;
    }
    // Edição: só o que mudou
    const body: Record<string, unknown> = {};
    if (t !== task.title) body.title = t;
    if (desc !== (task.description ?? null)) body.description = desc;
    if (dueDate !== task.dueDate) body.dueDate = dueDate;
    if (status !== task.status) body.status = status;
    if (processId !== (task.process?.id ?? '')) body.processId = processId || null;
    if (isGestor && assigneeId && assigneeId !== task.assignee.id) body.assigneeId = assigneeId;
    if (Object.keys(body).length === 0) return onClose();
    saveMut.mutate(body);
  }

  // Processo atual que não aparece na lista (ex.: tarefa reatribuída) continua escolhível
  const processOptions = task?.process && !processes.some(p => p.id === task.process!.id)
    ? [{ id: task.process.id, label: `${task.process.clientName} · ${STAGE_LABELS[task.process.stage] ?? task.process.stage}` }]
    : [];
  const busy = saveMut.isPending || deleteMut.isPending;

  return (
    <>
      <div className="ds-drawer-backdrop open" onClick={busy ? undefined : onClose} />
      <div className="ds-drawer open" style={{ width: 460 }} role="dialog" aria-modal="true" aria-labelledby="task-drawer-title">
        <div className="ds-drawer-hdr">
          <Icon.CheckSquare size={16} />
          <h2 id="task-drawer-title">{task ? 'Tarefa' : 'Nova tarefa'}</h2>
          <button className="ds-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Fechar">
            <Icon.X size={14} />
          </button>
        </div>
        <form id="task-form" onSubmit={submit} noValidate className="ds-drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="ds-field">
            <label htmlFor="task-title">Título</label>
            <div className="ds-input">
              <input id="task-title" value={title} maxLength={200} autoFocus placeholder="Ex.: Cobrar holerite do cliente"
                onChange={e => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="ds-field">
            <label htmlFor="task-desc">Descrição (opcional)</label>
            <textarea id="task-desc" value={description} maxLength={2000} rows={3}
              onChange={e => setDescription(e.target.value)}
              style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
          <div className="ds-row-2">
            <div className="ds-field">
              <label htmlFor="task-due">Prazo</label>
              <div className="ds-input">
                <input id="task-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={selectStyle} />
              </div>
            </div>
            {task && (
              <div className="ds-field">
                <label htmlFor="task-status">Status</label>
                <div className="ds-input">
                  <select id="task-status" value={status} onChange={e => setStatus(e.target.value as TaskStatus)} style={selectStyle}>
                    {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map(s => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className="ds-field">
            <label htmlFor="task-process">Processo (opcional)</label>
            <div className="ds-input">
              <select id="task-process" value={processId} onChange={e => setProcessId(e.target.value)} style={selectStyle}>
                <option value="">Sem processo</option>
                {processOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                {processes.map(p => <option key={p.id} value={p.id}>{processLabel(p)}</option>)}
              </select>
            </div>
          </div>
          {isGestor ? (
            <div className="ds-field">
              <label htmlFor="task-assignee">Responsável</label>
              <div className="ds-input">
                <select id="task-assignee" value={assigneeId} onChange={e => setAssigneeId(e.target.value)} style={selectStyle}>
                  {!task && <option value="">Eu (gestor)</option>}
                  {assignees.map(a => <option key={a.id} value={a.id}>{a.name}{a.role === 'dono' ? ' (gestor)' : ''}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              {task ? <>Responsável: <strong>{task.assignee.name}</strong></> : 'A tarefa fica com você. Só o gestor atribui tarefas a outra pessoa.'}
            </div>
          )}
          {task && (
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
              Criada por {task.createdBy.name ?? '—'} em {new Date(task.createdAt).toLocaleDateString('pt-BR')}
              {task.completedAt && <> · concluída em {new Date(task.completedAt).toLocaleDateString('pt-BR')}</>}
            </div>
          )}
          {task?.process && onOpenProcess && (
            <button type="button" className="ds-btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }}
              onClick={() => onOpenProcess(task.process!.id)}>
              <Icon.ChevronRight size={12} /> Abrir processo de {task.process.clientName}
            </button>
          )}
          {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 8 }}>{error}</div>}
        </form>
        <div className="ds-drawer-foot">
          {task?.canDelete && (confirmDelete ? (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, marginRight: 'auto' }}>
              Excluir a tarefa?
              <button type="button" className="ds-btn sm" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => deleteMut.mutate()}>Sim, excluir</button>
              <button type="button" className="ds-btn ghost sm" onClick={() => setConfirmDelete(false)}>Não</button>
            </span>
          ) : (
            <button type="button" className="ds-btn ghost sm" style={{ color: 'var(--red)', marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}>
              <Icon.Trash size={12} /> Excluir
            </button>
          ))}
          <button type="button" className="ds-btn ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" form="task-form" className="ds-btn accent" disabled={busy}>
            {saveMut.isPending ? 'Salvando...' : task ? 'Salvar' : 'Criar tarefa'}
          </button>
        </div>
      </div>
    </>
  );
}
