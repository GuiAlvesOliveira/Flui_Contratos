import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FE-29: which notifications (audit log events) each user has already read.
 * Notifications themselves are the audit log events; only the read flag is new.
 */
export class AddNotificationReads1718500700000 implements MigrationInterface {
  name = 'AddNotificationReads1718500700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        tenant_id    UUID NOT NULL REFERENCES tenants(id),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        audit_log_id UUID NOT NULL REFERENCES audit_logs(id) ON DELETE CASCADE,
        read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, audit_log_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_notification_reads_tenant ON notification_reads (tenant_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notification_reads`);
  }
}
