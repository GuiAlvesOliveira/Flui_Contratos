import { MigrationInterface, QueryRunner } from 'typeorm';

// Snapshot of the starting catalog at the time of this migration (kept here on
// purpose: later edits to DEFAULT_DOCUMENT_TYPES must not change what an old
// migration does).
const DEFAULTS: [string, string][] = [
  ['RG ou CNH', 'pessoal'],
  ['Comprovante de Endereço', 'pessoal'],
  ['Certidão de Estado Civil', 'pessoal'],
  ['Holerite (mês 1)', 'renda'],
  ['Holerite (mês 2)', 'renda'],
  ['Holerite (mês 3)', 'renda'],
  ['Declaração de IRPF', 'renda'],
  ['Extrato Bancário (mês 1)', 'renda'],
  ['Extrato Bancário (mês 2)', 'renda'],
  ['Extrato Bancário (mês 3)', 'renda'],
  ['Extrato Bancário (mês 4)', 'renda'],
  ['Extrato Bancário (mês 5)', 'renda'],
  ['Extrato Bancário (mês 6)', 'renda'],
];

/**
 * BE-03: per-tenant document catalog ("Lista de Documentos"). The analista
 * requests documents for a process by picking catalog entries; the gestor
 * edits the catalog. Every existing tenant gets the starting catalog, and
 * existing documents are linked to their entry by label.
 */
export class AddDocumentTypes1718500500000 implements MigrationInterface {
  name = 'AddDocumentTypes1718500500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS document_types (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID NOT NULL REFERENCES tenants(id),
        label       VARCHAR(120) NOT NULL,
        category    VARCHAR(30) NOT NULL
                    CHECK (category IN ('pessoal', 'renda', 'imovel', 'outros')),
        description TEXT,
        active      BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_document_types_tenant_label
         ON document_types (tenant_id, lower(label))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_document_types_tenant ON document_types (tenant_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_type_id UUID
         REFERENCES document_types(id) ON DELETE SET NULL`,
    );

    // Starting catalog for every tenant that has none yet
    const values = DEFAULTS.map(
      (_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`,
    ).join(', ');
    await queryRunner.query(
      `INSERT INTO document_types (tenant_id, label, category)
       SELECT t.id, d.label, d.category
         FROM tenants t
        CROSS JOIN (VALUES ${values}) AS d(label, category)
        WHERE NOT EXISTS (SELECT 1 FROM document_types x WHERE x.tenant_id = t.id)`,
      DEFAULTS.flat(),
    );

    // Link the documents already requested to their catalog entry
    await queryRunner.query(
      `UPDATE documents d
          SET document_type_id = dt.id
         FROM document_types dt
        WHERE d.document_type_id IS NULL
          AND dt.tenant_id = d.tenant_id
          AND lower(dt.label) = lower(COALESCE(d.label, d.name))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE documents DROP COLUMN IF EXISTS document_type_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS document_types`);
  }
}
