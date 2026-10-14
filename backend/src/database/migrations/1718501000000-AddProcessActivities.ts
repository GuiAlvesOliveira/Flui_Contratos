import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Histórico de Atividades: what the analista did while following the
 * financing (calls, document reminders, messages), written by hand.
 * `stage` is a snapshot of the process stage when the entry was created and is
 * never rewritten — no CHECK against the current stage list, so old entries
 * survive a future rename of the stages (same as audit_logs).
 * Entries are never physically deleted: a removal only sets deleted_*.
 */
export class AddProcessActivities1718501000000 implements MigrationInterface {
  name = 'AddProcessActivities1718501000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS process_activities (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id),
        process_id    UUID NOT NULL REFERENCES processes(id),
        client_id     UUID NOT NULL REFERENCES users(id),
        author_id     UUID NOT NULL REFERENCES users(id),
        stage         VARCHAR(30) NOT NULL,
        description   TEXT NOT NULL
                      CHECK (char_length(btrim(description)) BETWEEN 3 AND 2000),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        edited_at     TIMESTAMPTZ,
        deleted_at    TIMESTAMPTZ,
        deleted_by    UUID REFERENCES users(id),
        delete_reason TEXT
      )`);
    // The history of a process, newest first, without the removed entries.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_process_activities_process
         ON process_activities (process_id, created_at DESC) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_process_activities_tenant
         ON process_activities (tenant_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS process_activities`);
  }
}
