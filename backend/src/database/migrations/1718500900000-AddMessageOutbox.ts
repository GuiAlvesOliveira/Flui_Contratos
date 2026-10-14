import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-09_v2 / RN-08_v2: in-house messaging, replacing n8n. Every notification is
 * written to this outbox in the same transaction as the change that caused it
 * (stage change, documents requested, document rejected); a worker in the API
 * sends it and retries with backoff, so a failed SMTP call no longer loses it.
 */
export class AddMessageOutbox1718500900000 implements MigrationInterface {
  name = 'AddMessageOutbox1718500900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS message_outbox (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL REFERENCES tenants(id),
        process_id      UUID REFERENCES processes(id) ON DELETE SET NULL,
        event_type      VARCHAR(40) NOT NULL,
        channel         VARCHAR(20) NOT NULL DEFAULT 'email',
        recipient_role  VARCHAR(20) NOT NULL,
        recipient       VARCHAR(255) NOT NULL,
        subject         VARCHAR(255) NOT NULL,
        html            TEXT NOT NULL,
        text            TEXT NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'failed')),
        attempts        INT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_error      TEXT,
        sent_at         TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // The worker only looks at pending messages that are due.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_message_outbox_due
         ON message_outbox (next_attempt_at) WHERE status = 'pending'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_message_outbox_tenant
         ON message_outbox (tenant_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS message_outbox`);
  }
}
