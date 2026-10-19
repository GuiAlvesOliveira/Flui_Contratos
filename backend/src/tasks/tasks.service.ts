import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import type { ProcessStage } from '../processes/process.entity';
import type {
  CreateTaskDto,
  ListTasksQueryDto,
  TaskStatus,
  UpdateTaskDto,
} from './dto/task.dto';

// Prazos são dias do calendário da assessoria (horário de Brasília).
const TODAY = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
const LIST_LIMIT = 500;

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  status: TaskStatus;
  process_id: string | null;
  client_name: string | null;
  client_email: string | null;
  process_stage: ProcessStage | null;
  assignee_id: string;
  assignee_name: string | null;
  assignee_email: string;
  created_by: string;
  creator_name: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  overdue: boolean;
  days_late: number | string;
}

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  status: TaskStatus;
  overdue: boolean;
  daysLate: number;
  process: { id: string; clientName: string; stage: ProcessStage } | null;
  assignee: { id: string; name: string };
  createdBy: { id: string; name: string | null };
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
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

const SELECT_TASK = `
  SELECT t.id, t.title, t.description, to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
         t.status, t.process_id,
         NULLIF(concat_ws(' ', c.name, c.surname), '') AS client_name,
         c.email AS client_email, p.stage AS process_stage,
         t.assignee_id, NULLIF(concat_ws(' ', a.name, a.surname), '') AS assignee_name,
         a.email AS assignee_email,
         t.created_by, NULLIF(concat_ws(' ', cb.name, cb.surname), '') AS creator_name,
         t.created_at, t.updated_at, t.completed_at,
         (t.status <> 'concluida' AND t.due_date < ${TODAY}) AS overdue,
         GREATEST(${TODAY} - t.due_date, 0) AS days_late
    FROM tasks t
    JOIN users a ON a.id = t.assignee_id
    JOIN users cb ON cb.id = t.created_by
    LEFT JOIN processes p ON p.id = t.process_id
    LEFT JOIN users c ON c.id = p.client_id`;

/**
 * PROD-01 — tarefas da assessoria. Toda consulta é filtrada pela assessoria de
 * quem chama (RN-01). O gestor vê e reatribui todas; o analista vê as que são
 * dele ou que ele criou, e só liga tarefas aos processos em que é o analista.
 * O cliente nem chega aqui (403 no controller).
 */
@Injectable()
export class TasksService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    caller: RequestUserFull,
    q: ListTasksQueryDto = {},
  ): Promise<{ tasks: TaskView[]; counts: TaskCounts }> {
    const params: unknown[] = [caller.tenantId];
    const where = ['t.tenant_id = $1', 't.deleted_at IS NULL'];
    const add = (sql: (n: string) => string, value: unknown) => {
      params.push(value);
      where.push(sql(`$${params.length}`));
    };
    if (caller.role !== 'dono') {
      add(
        (n) => `(t.assignee_id = ${n} OR t.created_by = ${n})`,
        caller.userId,
      );
    }
    if (q.assigneeId) add((n) => `t.assignee_id = ${n}`, q.assigneeId);
    if (q.processId) add((n) => `t.process_id = ${n}`, q.processId);
    if (q.from) add((n) => `t.due_date >= ${n}::date`, q.from);
    if (q.to) add((n) => `t.due_date <= ${n}::date`, q.to);

    // The counts ignore the status and deadline filters: they are the numbers
    // shown on the filter buttons themselves.
    const [c] = await this.dataSource.query<Record<keyof TaskCounts, string>[]>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE t.status <> 'concluida' AND t.due_date < ${TODAY}) AS atrasadas,
              COUNT(*) FILTER (WHERE t.due_date = ${TODAY}) AS hoje,
              COUNT(*) FILTER (WHERE t.due_date BETWEEN ${TODAY} AND ${TODAY} + 6) AS semana,
              COUNT(*) FILTER (WHERE t.status = 'a_fazer') AS a_fazer,
              COUNT(*) FILTER (WHERE t.status = 'em_andamento') AS em_andamento,
              COUNT(*) FILTER (WHERE t.status = 'concluida') AS concluida
         FROM tasks t WHERE ${where.join(' AND ')}`,
      params,
    );

    if (q.status) add((n) => `t.status = ${n}`, q.status);
    if (q.due === 'atrasadas') {
      where.push(`t.status <> 'concluida' AND t.due_date < ${TODAY}`);
    } else if (q.due === 'hoje') {
      where.push(`t.due_date = ${TODAY}`);
    } else if (q.due === 'semana') {
      where.push(`t.due_date BETWEEN ${TODAY} AND ${TODAY} + 6`);
    }
    const rows = await this.dataSource.query<TaskRow[]>(
      `${SELECT_TASK}
        WHERE ${where.join(' AND ')}
        ORDER BY (t.status = 'concluida'), t.due_date, t.created_at
        LIMIT ${LIST_LIMIT}`,
      params,
    );
    const counts = Object.fromEntries(
      Object.entries(c).map(([k, v]) => [k, Number(v)]),
    ) as unknown as TaskCounts;
    return { tasks: rows.map((r) => view(r, caller)), counts };
  }

  async findOne(id: string, caller: RequestUserFull): Promise<TaskView> {
    return view(await this.visible(id, caller), caller);
  }

  async create(dto: CreateTaskDto, caller: RequestUserFull): Promise<TaskView> {
    let assigneeId = caller.userId;
    if (dto.assigneeId && dto.assigneeId !== caller.userId) {
      if (caller.role !== 'dono') {
        throw new ForbiddenException(
          'Só o gestor atribui tarefas a outra pessoa',
        );
      }
      await this.assertAssignee(dto.assigneeId, caller);
      assigneeId = dto.assigneeId;
    }
    if (dto.processId) await this.assertProcess(dto.processId, caller);

    const [row] = await this.dataSource.query<{ id: string }[]>(
      `INSERT INTO tasks (tenant_id, process_id, title, description, assignee_id, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7)
       RETURNING id`,
      [
        caller.tenantId,
        dto.processId ?? null,
        dto.title,
        dto.description ?? null,
        assigneeId,
        dto.dueDate,
        caller.userId,
      ],
    );
    return this.findOne(row.id, caller);
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    caller: RequestUserFull,
  ): Promise<TaskView> {
    const task = await this.visible(id, caller);
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown, cast = '') => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };

    if (dto.title !== undefined) set('title', dto.title);
    if (dto.description !== undefined) set('description', dto.description);
    if (dto.dueDate !== undefined) set('due_date', dto.dueDate, '::date');
    if (dto.assigneeId !== undefined && dto.assigneeId !== task.assignee_id) {
      if (caller.role !== 'dono') {
        throw new ForbiddenException('Só o gestor reatribui tarefas');
      }
      await this.assertAssignee(dto.assigneeId, caller);
      set('assignee_id', dto.assigneeId);
    }
    if (dto.processId !== undefined && dto.processId !== task.process_id) {
      if (dto.processId) await this.assertProcess(dto.processId, caller);
      set('process_id', dto.processId);
    }
    if (dto.status !== undefined && dto.status !== task.status) {
      set('status', dto.status);
      if (dto.status === 'concluida') {
        sets.push('completed_at = now()');
        set('completed_by', caller.userId);
      } else {
        sets.push('completed_at = NULL', 'completed_by = NULL');
      }
    }
    if (sets.length === 0) return view(task, caller);

    params.push(id, caller.tenantId);
    await this.dataSource.query(
      `UPDATE tasks SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
          AND deleted_at IS NULL`,
      params,
    );
    return this.findOne(id, caller);
  }

  // Exclusão lógica: a tarefa sai da lista e do calendário, mas fica no banco.
  async remove(id: string, caller: RequestUserFull) {
    const task = await this.visible(id, caller);
    if (caller.role !== 'dono' && task.created_by !== caller.userId) {
      throw new ForbiddenException(
        'Só quem criou a tarefa (ou o gestor) pode excluí-la',
      );
    }
    await this.dataSource.query(
      `UPDATE tasks SET deleted_at = now(), deleted_by = $1
        WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
      [caller.userId, id, caller.tenantId],
    );
    return { id, deleted: true };
  }

  // Quem pode receber tarefas: a equipe ativa da assessoria (o gestor escolhe;
  // o analista só a si mesmo).
  async assignees(caller: RequestUserFull) {
    const params: unknown[] = [caller.tenantId];
    let only = '';
    if (caller.role !== 'dono') {
      params.push(caller.userId);
      only = 'AND id = $2';
    }
    const rows = await this.dataSource.query<
      {
        id: string;
        name: string | null;
        surname: string | null;
        email: string;
        role: string;
      }[]
    >(
      `SELECT id, name, surname, email, role FROM users
        WHERE tenant_id = $1 AND role IN ('dono', 'analista') AND status <> 'disabled' ${only}
        ORDER BY role DESC, name`,
      params,
    );
    return rows.map((u) => ({
      id: u.id,
      name: [u.name, u.surname].filter(Boolean).join(' ') || u.email,
      role: u.role,
    }));
  }

  // RN-01: a task of another assessoria — or, for an analista, one that is
  // neither theirs nor created by them — is a 404, as if it did not exist.
  private async visible(id: string, caller: RequestUserFull): Promise<TaskRow> {
    const [row] = await this.dataSource.query<TaskRow[]>(
      `${SELECT_TASK}
        WHERE t.id = $1 AND t.tenant_id = $2 AND t.deleted_at IS NULL`,
      [id, caller.tenantId],
    );
    if (
      !row ||
      (caller.role !== 'dono' &&
        row.assignee_id !== caller.userId &&
        row.created_by !== caller.userId)
    ) {
      throw new NotFoundException('Tarefa não encontrada');
    }
    return row;
  }

  // The analista links tasks only to the processes they handle; the gestor to
  // any active process of the assessoria.
  private async assertProcess(processId: string, caller: RequestUserFull) {
    const params: unknown[] = [processId, caller.tenantId];
    let own = '';
    if (caller.role !== 'dono') {
      params.push(caller.userId);
      own = 'AND analista_id = $3';
    }
    const [p] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM processes
        WHERE id = $1 AND tenant_id = $2 AND active = true ${own}`,
      params,
    );
    if (!p) throw new NotFoundException('Processo não encontrado');
  }

  private async assertAssignee(userId: string, caller: RequestUserFull) {
    const [u] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM users
        WHERE id = $1 AND tenant_id = $2 AND role IN ('dono', 'analista')
          AND status <> 'disabled'`,
      [userId, caller.tenantId],
    );
    if (!u) {
      throw new NotFoundException('Responsável não encontrado na assessoria');
    }
  }
}

function view(r: TaskRow, caller: RequestUserFull): TaskView {
  const isGestor = caller.role === 'dono';
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    status: r.status,
    overdue: r.overdue,
    daysLate: Number(r.days_late),
    process: r.process_id
      ? {
          id: r.process_id,
          clientName: r.client_name ?? r.client_email ?? 'Cliente',
          stage: r.process_stage as ProcessStage,
        }
      : null,
    assignee: { id: r.assignee_id, name: r.assignee_name ?? r.assignee_email },
    createdBy: { id: r.created_by, name: r.creator_name },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    canEdit: true,
    canReassign: isGestor,
    canDelete: isGestor || r.created_by === caller.userId,
  };
}
