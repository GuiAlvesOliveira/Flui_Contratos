import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Envio de e-mails sob controle do gestor da assessoria.
 *
 * - tenants.email_mode: 'manual' (padrão) — as mensagens são enfileiradas como
 *   sempre (RN-08), mas ficam retidas até o gestor liberar; 'auto' — o envio
 *   sai sozinho. tenants.email_daily_limit: teto de e-mails por dia da
 *   assessoria (o servidor ainda tem um teto global).
 * - message_outbox.status ganha 'held' (aguardando o gestor), 'cancelled'
 *   (cancelada pelo gestor) e 'expired' (ficou velha demais para enviar).
 * - Tudo o que estava pendente no momento desta migration passa a 'held':
 *   ligar o envio não dispara nada que estivesse acumulado na fila.
 */
// Tira a regra antiga das situações, qualquer que seja o nome que o banco deu a
// ela: se sobrasse uma regra só com pending/sent/failed, gravar uma mensagem
// retida falharia e levaria junto a mudança de etapa (mesma transação).
const DROP_STATUS_CHECKS = `
  DO $$
  DECLARE c record;
  BEGIN
    FOR c IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'message_outbox'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
      EXECUTE format('ALTER TABLE message_outbox DROP CONSTRAINT %I', c.conname);
    END LOOP;
  END $$`;

export class AddMessagingControl1718502400000 implements MigrationInterface {
  name = 'AddMessagingControl1718502400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS email_mode VARCHAR(10) NOT NULL DEFAULT 'manual'
          CHECK (email_mode IN ('manual', 'auto')),
        ADD COLUMN IF NOT EXISTS email_daily_limit INT NOT NULL DEFAULT 100
          CHECK (email_daily_limit BETWEEN 1 AND 1000)`);

    await queryRunner.query(DROP_STATUS_CHECKS);
    await queryRunner.query(`
      ALTER TABLE message_outbox
        ADD CONSTRAINT message_outbox_status_check
        CHECK (status IN ('pending', 'held', 'sent', 'failed', 'cancelled', 'expired'))`);
    await queryRunner.query(
      `UPDATE message_outbox SET status = 'held', updated_at = now() WHERE status = 'pending'`,
    );
    // A tela do gestor lista por assessoria e situação.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_message_outbox_tenant_status
         ON message_outbox (tenant_id, status, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_message_outbox_tenant_status`,
    );
    await queryRunner.query(
      `UPDATE message_outbox SET status = 'failed' WHERE status IN ('held', 'cancelled', 'expired')`,
    );
    await queryRunner.query(DROP_STATUS_CHECKS);
    await queryRunner.query(`
      ALTER TABLE message_outbox
        ADD CONSTRAINT message_outbox_status_check
        CHECK (status IN ('pending', 'sent', 'failed'))`);
    await queryRunner.query(
      `ALTER TABLE tenants DROP COLUMN IF EXISTS email_mode, DROP COLUMN IF EXISTS email_daily_limit`,
    );
  }
}
