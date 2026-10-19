import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as Icon from '../components/icons';
import { TaskDrawer } from '../components/TaskDrawer';
import {
  addDays, TASK_STATUS_LABELS, taskColor, useAssignees, useTasks, type TaskItem,
} from '../lib/tasks';
import { todayIso } from '../lib/validators';

interface Props {
  role: string | null;
  onOpenProcess: (processId: string) => void;
}

type Mode = 'mes' | 'semana';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MAX_CHIPS = 3;

// Datas AAAA-MM-DD tratadas em UTC, sem deslocamento de fuso
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const monthOf = (iso: string) => iso.slice(0, 7);
const firstOfMonth = (iso: string) => `${monthOf(iso)}-01`;
function lastOfMonth(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', ...opts });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function rangeOf(mode: Mode, anchor: string): { from: string; to: string } {
  if (mode === 'semana') {
    const from = addDays(anchor, -weekday(anchor));
    return { from, to: addDays(from, 6) };
  }
  const first = firstOfMonth(anchor);
  const last = lastOfMonth(anchor);
  return { from: addDays(first, -weekday(first)), to: addDays(last, 6 - weekday(last)) };
}

// PROD-02 — Calendário dos prazos das tarefas (PROD-01). Mês ou semana; cor por
// status e atrasadas em vermelho; o clique abre a tarefa (e dela, o processo).
// Teclado: setas mudam o dia, PageUp/PageDown mudam o mês (ou a semana), Home/End
// vão ao início e ao fim da semana; a lista do dia escolhido fica abaixo.
export function CalendarioPage({ role, onOpenProcess }: Props) {
  const isGestor = role === 'dono';
  const today = todayIso();
  const [mode, setMode] = useState<Mode>('mes');
  const [anchor, setAnchor] = useState(today); // dia selecionado
  const [assigneeId, setAssigneeId] = useState('');
  const [open, setOpen] = useState<TaskItem | 'new' | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const { from, to } = rangeOf(mode, anchor);
  const { data, isLoading, isError } = useTasks({ from, to, assigneeId });
  const { data: assignees = [] } = useAssignees();

  const byDay = useMemo(() => {
    const m = new Map<string, TaskItem[]>();
    for (const t of data?.tasks ?? []) m.set(t.dueDate, [...(m.get(t.dueDate) ?? []), t]);
    return m;
  }, [data]);

  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));

  const title = mode === 'mes'
    ? cap(fmt(anchor, { month: 'long', year: 'numeric' }))
    : `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const step = (n: number) => setAnchor(a => (mode === 'mes' ? addMonths(a, n) : addDays(a, 7 * n)));

  function select(iso: string, focus = false) {
    setAnchor(iso);
    if (focus) requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)?.focus());
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(anchor, -1),
      ArrowRight: () => addDays(anchor, 1),
      ArrowUp: () => addDays(anchor, -7),
      ArrowDown: () => addDays(anchor, 7),
      Home: () => addDays(anchor, -weekday(anchor)),
      End: () => addDays(anchor, 6 - weekday(anchor)),
      PageUp: () => (mode === 'mes' ? addMonths(anchor, -1) : addDays(anchor, -7)),
      PageDown: () => (mode === 'mes' ? addMonths(anchor, 1) : addDays(anchor, 7)),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    select(move(), true);
  }

  const selectedTasks = byDay.get(anchor) ?? [];
  const late = (data?.tasks ?? []).filter(t => t.overdue).length;

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Calendário</h1>
          <p>
            {isGestor ? 'Prazos das tarefas da equipe.' : 'Prazos das suas tarefas.'}
            {!isLoading && data && ` ${data.tasks.length} tarefa${data.tasks.length !== 1 ? 's' : ''} no período${late ? ` · ${late} atrasada${late !== 1 ? 's' : ''}` : ''}.`}
          </p>
        </div>
        <div className="actions">
          <button className="ds-btn accent" onClick={() => setOpen('new')}>
            <Icon.Plus size={13} /> Nova tarefa
          </button>
        </div>
      </div>

      <div className="ds-list-toolbar ds-cal-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="ds-btn sm" onClick={() => step(-1)} aria-label={mode === 'mes' ? 'Mês anterior' : 'Semana anterior'}>
            <Icon.ChevronRight size={13} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button className="ds-btn sm" onClick={() => select(today, true)}>Hoje</button>
          <button className="ds-btn sm" onClick={() => step(1)} aria-label={mode === 'mes' ? 'Próximo mês' : 'Próxima semana'}>
            <Icon.ChevronRight size={13} />
          </button>
          <h2 aria-live="polite" style={{ margin: '0 0 0 8px', fontSize: 16, fontWeight: 600 }}>{title}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {isGestor && (
            <div className="ds-input" style={{ flex: '0 0 210px' }}>
              <Icon.Users size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
              <select aria-label="Filtrar por analista" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}>
                <option value="">Toda a equipe</option>
                {assignees.map(a => <option key={a.id} value={a.id}>{a.name}{a.role === 'dono' ? ' (gestor)' : ''}</option>)}
              </select>
            </div>
          )}
          <div className="ds-seg" role="group" aria-label="Visão">
            {(['mes', 'semana'] as Mode[]).map(m => (
              <button key={m} className={`ds-seg-btn ${mode === m ? 'active' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === 'mes' ? 'Mês' : 'Semana'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ds-cal-legend" aria-label="Legenda">
        {(['a_fazer', 'em_andamento', 'concluida'] as const).map(s => (
          <span key={s}><span className={`ds-cal-dot ${taskColor({ status: s, overdue: false })}`} />{TASK_STATUS_LABELS[s]}</span>
        ))}
        <span><span className="ds-cal-dot red" />Atrasada</span>
        <span className="ds-cal-help">Setas mudam o dia · PageUp/PageDown mudam {mode === 'mes' ? 'o mês' : 'a semana'}</span>
      </div>

      {isError && <div role="alert" className="ds-card" style={{ padding: 16, color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>Não foi possível carregar as tarefas.</div>}

      <div className={`ds-cal ${mode === 'semana' ? 'week' : ''}`} role="grid" aria-label={`Calendário de ${title}`} aria-busy={isLoading} ref={gridRef} onKeyDown={onKey}>
        <div className="ds-cal-head" role="row">
          {WEEKDAYS.map(d => <div key={d} role="columnheader">{d}</div>)}
        </div>
        {weeks.map(week => (
          <div className="ds-cal-grid" role="row" key={week[0]}>
            {week.map(iso => {
              const list = byDay.get(iso) ?? [];
              const out = mode === 'mes' && monthOf(iso) !== monthOf(anchor);
              const hasLate = list.some(t => t.overdue);
              const limit = mode === 'mes' ? MAX_CHIPS : list.length;
              const label = `${fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })}${iso === today ? ', hoje' : ''}: ${list.length ? `${list.length} tarefa${list.length !== 1 ? 's' : ''}${hasLate ? ', com atrasada' : ''}` : 'nenhuma tarefa'}`;
              return (
                <div key={iso} role="gridcell" aria-selected={iso === anchor}
                  className={`ds-cal-day${out ? ' out' : ''}${iso === today ? ' today' : ''}${iso === anchor ? ' sel' : ''}`}
                  onClick={() => select(iso)}>
                  <button type="button" className="ds-cal-num" data-day={iso} tabIndex={iso === anchor ? 0 : -1} aria-label={label}
                    onClick={e => { e.stopPropagation(); select(iso); }}>
                    {Number(iso.slice(8))}
                  </button>
                  {list.length > 0 && (
                    <span className={`ds-cal-count ${hasLate ? 'red' : ''}`} aria-hidden="true">{list.length}</span>
                  )}
                  {list.slice(0, limit).map(t => (
                    <button type="button" key={t.id} tabIndex={-1} className={`ds-cal-chip ${taskColor(t)}${t.status === 'concluida' ? ' done' : ''}`}
                      title={`${t.title} · ${TASK_STATUS_LABELS[t.status]}${t.overdue ? ' (atrasada)' : ''}${isGestor ? ` · ${t.assignee.name}` : ''}`}
                      onClick={e => { e.stopPropagation(); setAnchor(iso); setOpen(t); }}>
                      {t.title}
                    </button>
                  ))}
                  {list.length > limit && (
                    <span className="ds-cal-more">+{list.length - limit} mais</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="ds-card" style={{ marginTop: 16 }} aria-live="polite">
        <div className="ds-card-hdr">
          <h3>{cap(fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long' }))}{anchor === today ? ' · hoje' : ''}</h3>
          <span className="meta">{selectedTasks.length} tarefa{selectedTasks.length !== 1 ? 's' : ''}</span>
          <button className="ds-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen('new')}>
            <Icon.Plus size={12} /> Nova tarefa neste dia
          </button>
        </div>
        {selectedTasks.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-faint)' }}>Nenhuma tarefa com prazo neste dia.</div>
        ) : (
          <ul className="ds-cal-daylist" aria-label="Tarefas do dia">
            {selectedTasks.map(t => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpen(t)}>
                  <span className={`ds-cal-dot ${taskColor(t)}`} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 500, textDecoration: t.status === 'concluida' ? 'line-through' : undefined }}>{t.title}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: t.overdue ? 'var(--red)' : 'var(--text-muted)' }}>
                      {t.overdue ? `Atrasada há ${t.daysLate} dia${t.daysLate !== 1 ? 's' : ''}` : TASK_STATUS_LABELS[t.status]}
                      {isGestor && ` · ${t.assignee.name}`}
                      {t.process && ` · ${t.process.clientName}`}
                    </span>
                  </span>
                  <Icon.ChevronRight size={13} style={{ color: 'var(--text-faint)' }} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <TaskDrawer
          task={open === 'new' ? null : open}
          isGestor={isGestor}
          initialDueDate={anchor}
          onClose={() => setOpen(null)}
          onOpenProcess={(id) => { setOpen(null); onOpenProcess(id); }}
        />
      )}
    </div>
  );
}
