import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';

// Audit log events each role is notified about (never their own actions)
export const NOTIFY_ACTIONS: Record<string, string[]> = {
  dono: [
    'stage_change',
    'document_upload',
    'form_submitted',
    'process_deactivated',
    'process_reactivated',
  ],
  analista: [
    'stage_change',
    'document_upload',
    'form_submitted',
    'process_deactivated',
    'process_reactivated',
    'profile_update',
  ],
  cliente: [
    'stage_change',
    'documents_requested',
    'document_validated',
    'document_rejected',
  ],
};

export const NOTIFICATION_WINDOW_DAYS = 30;
export const NOTIFICATION_LIMIT = 30;

interface NotificationRow {
  id: string;
  action: string;
  process_id: string;
  from_state: string | null;
  to_state: string | null;
  metadata: { label?: string; labels?: string[] } | null;
  created_at: Date;
  actor_name: string | null;
  client_name: string | null;
  client_email: string;
  read: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly dataSource: DataSource) {}

  // Events of the processes the user can see: the whole tenant for the gestor,
  // their own processes for the analista and the cliente. $1 tenant, $2 user,
  // $3 actions.
  private scope(caller: RequestUserFull) {
    const own =
      caller.role === 'analista'
        ? 'AND p.analista_id = $2'
        : caller.role === 'cliente'
          ? 'AND p.client_id = $2'
          : '';
    return {
      sql: `FROM audit_logs al
            JOIN processes p ON p.id = al.process_id AND p.active = true
            JOIN users c ON c.id = p.client_id
            LEFT JOIN users u ON u.id = al.actor_id
            LEFT JOIN notification_reads nr
              ON nr.audit_log_id = al.id AND nr.user_id = $2
           WHERE al.tenant_id = $1
             AND al.action = ANY($3::text[])
             AND al.actor_id IS DISTINCT FROM $2
             AND al.created_at >= now() - interval '${NOTIFICATION_WINDOW_DAYS} days'
             ${own}`,
      params: [
        caller.tenantId,
        caller.userId,
        NOTIFY_ACTIONS[caller.role] ?? [],
      ],
    };
  }

  // FE-29: latest events (30 days), unread count and documents waiting for the
  // user — to validate (gestor/analista) or to send (cliente).
  async list(caller: RequestUserFull) {
    const { sql, params } = this.scope(caller);
    const rows = await this.dataSource.query<NotificationRow[]>(
      `SELECT al.id, al.action, al.process_id, al.from_state, al.to_state,
              al.metadata, al.created_at, u.name AS actor_name,
              c.name AS client_name, c.email AS client_email,
              (nr.audit_log_id IS NOT NULL) AS read
       ${sql}
       ORDER BY al.created_at DESC
       LIMIT ${NOTIFICATION_LIMIT}`,
      params,
    );
    const [{ unread }] = await this.dataSource.query<[{ unread: string }]>(
      `SELECT COUNT(*) AS unread ${sql} AND nr.audit_log_id IS NULL`,
      params,
    );
    return {
      unread: Number(unread),
      pendingDocs: await this.pendingDocs(caller),
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        processId: r.process_id,
        fromState: r.from_state,
        toState: r.to_state,
        // only the document names; the rest of the metadata stays internal
        label: r.metadata?.label ?? null,
        labels: r.metadata?.labels ?? null,
        actorName: r.actor_name,
        clientName: r.client_name ?? r.client_email,
        createdAt: r.created_at,
        read: r.read,
      })),
    };
  }

  private async pendingDocs(caller: RequestUserFull): Promise<number> {
    let row: { n: string };
    if (caller.role === 'cliente') {
      [row] = await this.dataSource.query<[{ n: string }]>(
        `SELECT COUNT(*) AS n FROM documents d
           LEFT JOIN processes p ON p.id = d.process_id
          WHERE d.tenant_id = $1 AND d.user_id = $2
            AND d.status IN ('pendente', 'rejeitado')
            AND (d.process_id IS NULL OR p.active = true)`,
        [caller.tenantId, caller.userId],
      );
    } else if (caller.role === 'analista') {
      [row] = await this.dataSource.query<[{ n: string }]>(
        `SELECT COUNT(*) AS n FROM documents d
           JOIN processes p ON p.id = d.process_id
          WHERE d.tenant_id = $1 AND p.analista_id = $2 AND p.active = true
            AND d.status = 'recebido'`,
        [caller.tenantId, caller.userId],
      );
    } else {
      [row] = await this.dataSource.query<[{ n: string }]>(
        `SELECT COUNT(*) AS n FROM documents
          WHERE tenant_id = $1 AND status = 'recebido'`,
        [caller.tenantId],
      );
    }
    return Number(row.n);
  }

  // Only events of the caller's tenant can be marked; marking twice is a no-op.
  async markRead(id: string, caller: RequestUserFull) {
    await this.dataSource.query(
      `INSERT INTO notification_reads (tenant_id, user_id, audit_log_id)
       SELECT al.tenant_id, $2, al.id FROM audit_logs al
        WHERE al.id = $3 AND al.tenant_id = $1
       ON CONFLICT (user_id, audit_log_id) DO NOTHING`,
      [caller.tenantId, caller.userId, id],
    );
    return { ok: true };
  }

  async markAllRead(caller: RequestUserFull) {
    const { sql, params } = this.scope(caller);
    await this.dataSource.query(
      `INSERT INTO notification_reads (tenant_id, user_id, audit_log_id)
       SELECT al.tenant_id, $2, al.id ${sql} AND nr.audit_log_id IS NULL
       ON CONFLICT (user_id, audit_log_id) DO NOTHING`,
      params,
    );
    return { ok: true };
  }
}
