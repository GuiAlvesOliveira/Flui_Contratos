import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Formulários do banco gerados a partir da ficha e salvos no processo (um
 * registro por geração, com o PDF no Blob privado). Só a equipe os vê.
 */
export class AddBankFormFiles1718502100000 implements MigrationInterface {
  name = 'AddBankFormFiles1718502100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bank_form_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        process_id UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
        form_key VARCHAR(40) NOT NULL,
        template_version VARCHAR(10) NOT NULL,
        blob_path VARCHAR(500) NOT NULL,
        size_bytes INTEGER NOT NULL,
        filled_fields INTEGER NOT NULL,
        total_fields INTEGER NOT NULL,
        generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_bank_form_files_process
         ON bank_form_files (tenant_id, process_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS bank_form_files`);
  }
}
