import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Validade de documentos pelo mês de referência, com avisos dentro da
 * plataforma.
 *
 * - document_types.validity_months: prazo de validade de cada item da Lista de
 *   Documentos da assessoria (o gestor altera em Configurações). Valores
 *   iniciais pedidos pelo PO, pelo nome do item: holerite e comprovante de
 *   endereço 3 meses, extrato bancário 6 meses. Sem prazo = não pede mês.
 * - documents: mês de referência (dia 1 do mês), último dia de validade, prazo
 *   usado no cálculo, quem informou e quando, e quando a rotina diária marcou o
 *   documento como vencido. Documentos já validados ficam sem mês: nunca vencem
 *   sozinhos ("mês de referência não informado", para o analista revisar).
 * - document_versions: o mês e a validade da versão validada (histórico).
 * - notifications: avisos persistidos (por enquanto, documento vencendo e
 *   vencido) — assessoria, processo, destinatário, documento, tipo, mensagem,
 *   criação, leitura e resolução. O índice único impede repetir o mesmo aviso
 *   para o mesmo documento, destinatário e ciclo de validade.
 */
export class AddDocumentValidity1718502200000 implements MigrationInterface {
  name = 'AddDocumentValidity1718502200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE document_types
        ADD COLUMN IF NOT EXISTS validity_months SMALLINT
          CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 120)`);
    await queryRunner.query(`
      UPDATE document_types SET validity_months = 3
       WHERE validity_months IS NULL
         AND (lower(label) LIKE 'holerite%' OR lower(label) LIKE 'comprovante de endere%')`);
    await queryRunner.query(`
      UPDATE document_types SET validity_months = 6
       WHERE validity_months IS NULL AND lower(label) LIKE 'extrato banc%'`);

    await queryRunner.query(`
      ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS reference_month DATE
          CHECK (reference_month IS NULL OR EXTRACT(DAY FROM reference_month) = 1),
        ADD COLUMN IF NOT EXISTS valid_until DATE,
        ADD COLUMN IF NOT EXISTS validity_months SMALLINT,
        ADD COLUMN IF NOT EXISTS reference_month_set_by UUID REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS reference_month_set_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ`);
    // a rotina diária procura os documentos validados perto do vencimento
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_documents_valid_until
         ON documents (valid_until) WHERE valid_until IS NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE document_versions
        ADD COLUMN IF NOT EXISTS reference_month DATE,
        ADD COLUMN IF NOT EXISTS valid_until DATE`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    UUID NOT NULL REFERENCES tenants(id),
        process_id   UUID REFERENCES processes(id) ON DELETE CASCADE,
        recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id  UUID REFERENCES documents(id) ON DELETE CASCADE,
        kind         VARCHAR(30) NOT NULL
                     CHECK (kind IN ('document_expiring', 'document_expired')),
        message      TEXT NOT NULL,
        valid_until  DATE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        read_at      TIMESTAMPTZ,
        resolved_at  TIMESTAMPTZ,
        CHECK (kind NOT IN ('document_expiring', 'document_expired')
               OR (document_id IS NOT NULL AND valid_until IS NOT NULL))
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_document_cycle
         ON notifications (document_id, kind, recipient_id, valid_until)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_recipient
         ON notifications (tenant_id, recipient_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notifications`);
    await queryRunner.query(`
      ALTER TABLE document_versions
        DROP COLUMN IF EXISTS valid_until,
        DROP COLUMN IF EXISTS reference_month`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_documents_valid_until`);
    await queryRunner.query(`
      ALTER TABLE documents
        DROP COLUMN IF EXISTS expired_at,
        DROP COLUMN IF EXISTS reference_month_set_at,
        DROP COLUMN IF EXISTS reference_month_set_by,
        DROP COLUMN IF EXISTS validity_months,
        DROP COLUMN IF EXISTS valid_until,
        DROP COLUMN IF EXISTS reference_month`);
    await queryRunner.query(
      `ALTER TABLE document_types DROP COLUMN IF EXISTS validity_months`,
    );
  }
}
