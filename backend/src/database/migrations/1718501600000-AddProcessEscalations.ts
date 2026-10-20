import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PROD-05_v2: alertas de processo parado. Cada linha é um alerta enviado (ou
 * tentado) para um processo; serve para não repetir o alerta antes de N dias e
 * como registro de quem foi avisado. `stage` é um retrato da etapa, sem CHECK.
 */
export class AddProcessEscalations1718501600000 implements MigrationInterface {
  name = 'AddProcessEscalations1718501600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS process_escalations (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      UUID NOT NULL REFERENCES tenants(id),
        process_id     UUID NOT NULL REFERENCES processes(id),
        stage          VARCHAR(50) NOT NULL,
        stage_since    TIMESTAMPTZ NOT NULL,
        days_in_stage  INT NOT NULL,
        recipient_role VARCHAR(20) NOT NULL
                       CHECK (recipient_role IN ('analista', 'gestor')),
        recipient_ids  UUID[] NOT NULL DEFAULT '{}',
        messages       INT NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // "houve alerta deste processo nos últimos N dias?"
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_process_escalations_process
         ON process_escalations (process_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_process_escalations_tenant
         ON process_escalations (tenant_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS process_escalations`);
  }
}
