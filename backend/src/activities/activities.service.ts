import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import type { ProcessStage } from '../processes/process.entity';

// The author may fix (edit) or withdraw (delete) an entry for this long; after
// that, a correction is a new entry. The gestor has general power: edits any
// entry at any time and removes any entry with a reason (moderation of what
// the client reads).
export const ACTIVITY_EDIT_WINDOW_HOURS = 24;
const EDIT_WINDOW_MS = ACTIVITY_EDIT_WINDOW_HOURS * 60 * 60 * 1000;

interface ProcessRow {
  id: string;
  client_id: string;
  analista_id: string | null;
  active: boolean;
}

interface ActivityRow {
  id: string;
  stage: ProcessStage;
  description: string;
  created_at: Date;
  edited_at: Date | null;
  edited_by: string | null;
  edited_by_name: string | null;
  author_id: string;
  author_name: string | null;
}

/** What the client reads: date and time, stage and description only. */
export interface ClientActivityView {
  id: string;
  createdAt: Date;
  stage: ProcessStage;
  description: string;
}

/** What the assessoria's team reads, with what the caller may do. */
export interface StaffActivityView extends ClientActivityView {
  editedAt: Date | null;
  editedBy: { id: string; name: string | null } | null;
  author: { id: string; name: string | null };
  canEdit: boolean;
  canDelete: boolean;
}

export interface ActivityHistory {
  canCreate: boolean;
  activities: (ClientActivityView | StaffActivityView)[];
}

const SELECT_ACTIVITY = `
  SELECT a.id, a.stage, a.description, a.created_at, a.edited_at,
         a.edited_by, e.name AS edited_by_name,
         a.author_id, u.name AS author_name
    FROM process_activities a
    LEFT JOIN users u ON u.id = a.author_id
    LEFT JOIN users e ON e.id = a.edited_by`;

// Short text for the audit log rows (shown in the process timeline to staff).
const excerpt = (text: string) =>
  text.length > 80 ? `${text.slice(0, 77)}...` : text;

/**
 * Histórico de Atividades of a process. Every query is scoped by the caller's
 * tenant (RN-01); a cliente only reaches their own process.
 */
@Injectable()
export class ActivitiesService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    processId: string,
    caller: RequestUserFull,
  ): Promise<ActivityHistory> {
    const process = await this.process(processId, caller);
    const rows = await this.dataSource.query<ActivityRow[]>(
      `${SELECT_ACTIVITY}
        WHERE a.process_id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL
        ORDER BY a.created_at DESC, a.id DESC`,
      [processId, caller.tenantId],
    );
    if (caller.role === 'cliente') {
      return { canCreate: false, activities: rows.map(clientView) };
    }
    return {
      canCreate: canCreate(process, caller),
      activities: rows.map((r) => staffView(r, caller)),
    };
  }

  async create(
    processId: string,
    description: string,
    caller: RequestUserFull,
  ): Promise<StaffActivityView> {
    const process = await this.process(processId, caller);
    if (caller.role !== 'analista' || process.analista_id !== caller.userId) {
      throw new ForbiddenException(
        'Só o analista responsável pelo processo pode registrar atividades',
      );
    }
    if (!process.active) {
      throw new UnprocessableEntityException(
        'Processo removido: não é possível registrar atividades',
      );
    }
    // Date, time and stage are taken by the database in the same statement:
    // the stage is the one the process is in at this exact moment.
    const [row] = await this.dataSource.query<ActivityRow[]>(
      `INSERT INTO process_activities
              (tenant_id, process_id, client_id, author_id, stage, description)
       SELECT p.tenant_id, p.id, p.client_id, $3, p.stage, $4
         FROM processes p
        WHERE p.id = $1 AND p.tenant_id = $2
       RETURNING id, stage, description, created_at, edited_at, author_id`,
      [processId, caller.tenantId, caller.userId, description],
    );
    return staffView({ ...row, author_name: caller.name ?? null }, caller);
  }

  async update(
    processId: string,
    id: string,
    description: string,
    caller: RequestUserFull,
  ): Promise<StaffActivityView> {
    await this.process(processId, caller);
    const activity = await this.activity(processId, id, caller);
    if (caller.role === 'dono') {
      // the gestor edits any entry, at any time
    } else if (activity.author_id !== caller.userId) {
      throw new ForbiddenException(
        'Só quem registrou a atividade (ou o gestor) pode editá-la',
      );
    } else if (!withinWindow(activity)) {
      throw new ForbiddenException(
        `O prazo de ${ACTIVITY_EDIT_WINDOW_HOURS} horas para editar esta atividade terminou. Registre uma nova atividade com a correção.`,
      );
    }
    if (description === activity.description)
      return staffView(activity, caller);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE process_activities
            SET description = $1, edited_at = now(), edited_by = $2
          WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL`,
        [description, caller.userId, id, caller.tenantId],
      );
      // RN-07: the previous text stays in the audit log
      await this.audit(manager, caller, processId, 'activity_edited', {
        activityId: id,
        label: excerpt(description),
        before: activity.description,
        authorId: activity.author_id,
      });
    });
    return staffView(await this.activity(processId, id, caller), caller);
  }

  async remove(
    processId: string,
    id: string,
    reason: string | undefined,
    caller: RequestUserFull,
  ) {
    await this.process(processId, caller);
    const activity = await this.activity(processId, id, caller);
    if (caller.role === 'dono') {
      if (!reason) {
        throw new BadRequestException('Informe o motivo da exclusão');
      }
    } else if (activity.author_id !== caller.userId) {
      throw new ForbiddenException(
        'Só quem registrou a atividade pode excluí-la',
      );
    } else if (!withinWindow(activity)) {
      throw new ForbiddenException(
        `O prazo de ${ACTIVITY_EDIT_WINDOW_HOURS} horas para excluir esta atividade terminou.`,
      );
    }

    // Never a physical delete: the entry leaves the history but stays in the
    // database, and the removal (with the text) goes to the audit log.
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE process_activities
            SET deleted_at = now(), deleted_by = $1, delete_reason = $2
          WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL`,
        [caller.userId, reason ?? null, id, caller.tenantId],
      );
      await this.audit(manager, caller, processId, 'activity_deleted', {
        activityId: id,
        label: excerpt(activity.description),
        reason: reason ?? null,
        description: activity.description,
      });
    });
    return { id, deleted: true };
  }

  // RN-01: the process must be of the caller's tenant; a cliente only reaches
  // their own (404 otherwise, as in GET /processes/:id).
  private async process(
    processId: string,
    caller: RequestUserFull,
  ): Promise<ProcessRow> {
    const [process] = await this.dataSource.query<ProcessRow[]>(
      `SELECT id, client_id, analista_id, active
         FROM processes WHERE id = $1 AND tenant_id = $2`,
      [processId, caller.tenantId],
    );
    if (
      !process ||
      (caller.role === 'cliente' && process.client_id !== caller.userId)
    ) {
      throw new NotFoundException('Processo não encontrado');
    }
    return process;
  }

  private async activity(
    processId: string,
    id: string,
    caller: RequestUserFull,
  ): Promise<ActivityRow> {
    const [activity] = await this.dataSource.query<ActivityRow[]>(
      `${SELECT_ACTIVITY}
        WHERE a.id = $1 AND a.process_id = $2 AND a.tenant_id = $3
          AND a.deleted_at IS NULL`,
      [id, processId, caller.tenantId],
    );
    if (!activity) throw new NotFoundException('Atividade não encontrada');
    return activity;
  }

  private audit(
    manager: EntityManager,
    caller: RequestUserFull,
    processId: string,
    action: 'activity_edited' | 'activity_deleted',
    metadata: Record<string, unknown>,
  ) {
    return manager.query(
      `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        caller.tenantId,
        processId,
        caller.userId,
        action,
        JSON.stringify(metadata),
      ],
    );
  }
}

function withinWindow(
  a: Pick<ActivityRow, 'created_at'>,
  now = Date.now(),
): boolean {
  return now - new Date(a.created_at).getTime() < EDIT_WINDOW_MS;
}

function canCreate(process: ProcessRow, caller: RequestUserFull): boolean {
  return (
    caller.role === 'analista' &&
    process.analista_id === caller.userId &&
    process.active
  );
}

function clientView(r: ActivityRow): ClientActivityView {
  return {
    id: r.id,
    createdAt: r.created_at,
    stage: r.stage,
    description: r.description,
  };
}

function staffView(r: ActivityRow, caller: RequestUserFull): StaffActivityView {
  const ownInWindow = r.author_id === caller.userId && withinWindow(r);
  return {
    ...clientView(r),
    editedAt: r.edited_at,
    editedBy: r.edited_by ? { id: r.edited_by, name: r.edited_by_name } : null,
    author: { id: r.author_id, name: r.author_name },
    canEdit: ownInWindow || caller.role === 'dono',
    canDelete: ownInWindow || caller.role === 'dono',
  };
}
