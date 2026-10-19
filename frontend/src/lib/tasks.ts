import { useQuery } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import type { ProcessStage } from './processStages';

// PROD-01 — tarefas da assessoria. Espelha backend/src/tasks (GET /tasks).
export type TaskStatus = 'a_fazer' | 'em_andamento' | 'concluida';
export type TaskDueFilter = 'atrasadas' | 'hoje' | 'semana';

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  dueDate: string; // AAAA-MM-DD
  status: TaskStatus;
  overdue: boolean;
  daysLate: number;
  process: { id: string; clientName: string; stage: ProcessStage } | null;
  assignee: { id: string; name: string };
  createdBy: { id: string; name: string | null };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canEdit: boolean;
  canReassign: boolean;
  canDelete: boolean;
}

export interface TaskCounts {
  total: number;
  atrasadas: number;
  hoje: number;
  semana: number;
  a_fazer: number;
  em_andamento: number;
  concluida: number;
}

export interface TaskList { tasks: TaskItem[]; counts: TaskCounts }
export interface Assignee { id: string; name: string; role: string }

export interface TaskQuery {
  assigneeId?: string;
  status?: TaskStatus;
  due?: TaskDueFilter;
  from?: string;
  to?: string;
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  a_fazer: 'A fazer',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
};

// Cor do badge de cada status (classes ds-badge); atrasada sobrepõe em vermelho
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  a_fazer: 'blue',
  em_andamento: 'amber',
  concluida: 'green',
};

export const taskColor = (t: Pick<TaskItem, 'status' | 'overdue'>) =>
  t.overdue ? 'red' : TASK_STATUS_COLORS[t.status];

export function useTasks(params: TaskQuery, enabled = true) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => !!v));
  return useQuery<TaskList>({
    queryKey: ['tasks', clean],
    queryFn: () => api.get<TaskList>('/tasks', { params: clean }).then(r => r.data),
    enabled,
  });
}

export function useAssignees() {
  return useQuery<Assignee[]>({
    queryKey: ['tasks', 'assignees'],
    queryFn: () => api.get<Assignee[]>('/tasks/assignees').then(r => r.data),
    staleTime: 5 * 60_000,
  });
}

// Prazo em texto curto: "Atrasada há 2 dias", "Hoje", "Amanhã" ou a data
export function dueLabel(t: Pick<TaskItem, 'dueDate' | 'overdue' | 'daysLate' | 'status'>, today: string): string {
  if (t.overdue) return t.daysLate === 1 ? 'Atrasada há 1 dia' : `Atrasada há ${t.daysLate} dias`;
  if (t.status !== 'concluida' && t.dueDate === today) return 'Hoje';
  if (t.status !== 'concluida' && t.dueDate === addDays(today, 1)) return 'Amanhã';
  const [y, m, d] = t.dueDate.split('-');
  return `${d}/${m}/${y}`;
}

// Datas AAAA-MM-DD sem passar pelo fuso: a conta é feita em UTC
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
