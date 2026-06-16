import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';

@Injectable()
export class AuditService {
  constructor(private readonly dataSource: DataSource) {}

  async findAll(caller: RequestUserFull, limit = 50, offset = 0) {
    // Clamp pagination so a caller can't request an unbounded page (SEC-07).
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
    const safeOffset = Math.max(Math.trunc(offset) || 0, 0);
    return this.dataSource.query<unknown[]>(
      `SELECT al.*,
              u.name   AS actor_name,
              p.stage  AS current_stage,
              p.active AS process_active,
              c.name   AS client_name,
              c.email  AS client_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       LEFT JOIN processes p ON p.id = al.process_id
       LEFT JOIN users c ON c.id = p.client_id
       WHERE al.tenant_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2 OFFSET $3`,
      [caller.tenantId, safeLimit, safeOffset],
    );
  }

  async undo(logId: string, caller: RequestUserFull) {
    const [log] = await this.dataSource.query<{ action: string; process_id: string; from_state: string; to_state: string }[]>(
      `SELECT * FROM audit_logs WHERE id = $1 AND tenant_id = $2`,
      [logId, caller.tenantId],
    );
    if (!log) throw new NotFoundException('Entrada de log não encontrada');

    if (log.action === 'stage_change') {
      const [process] = await this.dataSource.query<{ stage: string }[]>(
        `SELECT stage FROM processes WHERE id = $1 AND tenant_id = $2`,
        [log.process_id, caller.tenantId],
      );
      if (!process || process.stage !== log.to_state) {
        throw new BadRequestException('Não é possível desfazer: o processo foi alterado após esta ação');
      }
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE processes SET stage = $1, updated_at = now() WHERE id = $2`,
          [log.from_state, log.process_id],
        );
        await manager.query(
          `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, from_state, to_state, metadata)
           VALUES ($1, $2, $3, 'stage_change_undo', $4, $5, $6)`,
          [caller.tenantId, log.process_id, caller.userId, log.to_state, log.from_state, JSON.stringify({ undid_log_id: logId })],
        );
      });
      return { undone: true, action: 'stage_change', processId: log.process_id };
    }

    if (log.action === 'process_deactivated') {
      const [process] = await this.dataSource.query<{ active: boolean }[]>(
        `SELECT active FROM processes WHERE id = $1 AND tenant_id = $2`,
        [log.process_id, caller.tenantId],
      );
      if (!process || process.active) {
        throw new BadRequestException('Processo já está ativo');
      }
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE processes SET active = true, updated_at = now() WHERE id = $1`,
          [log.process_id],
        );
        await manager.query(
          `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, from_state, to_state, metadata)
           VALUES ($1, $2, $3, 'process_reactivated', 'inactive', 'active', $4)`,
          [caller.tenantId, log.process_id, caller.userId, JSON.stringify({ undid_log_id: logId })],
        );
      });
      return { undone: true, action: 'process_reactivated', processId: log.process_id };
    }

    throw new BadRequestException('Esta ação não pode ser desfeita');
  }
}
