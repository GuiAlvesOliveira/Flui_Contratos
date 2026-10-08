import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FE-23: forms filled in the app (DPS and financing) are stored as documents of
 * the process checklist, with their answers instead of a file. One form of each
 * type per process.
 */
export class AddDocumentForms1718500800000 implements MigrationInterface {
  name = 'AddDocumentForms1718500800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS form_type VARCHAR(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS form_data JSONB`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_process_form
         ON documents (process_id, form_type) WHERE form_type IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_documents_process_form`);
    await queryRunner.query(
      `ALTER TABLE documents DROP COLUMN IF EXISTS form_data`,
    );
    await queryRunner.query(
      `ALTER TABLE documents DROP COLUMN IF EXISTS form_type`,
    );
  }
}
