import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PROD-04: the assessoria's logo. The file lives in the private storage
 * container under the tenant's own prefix; the row only keeps its key, type
 * and when it changed (the UI uses it to refresh the cached image).
 */
export class AddTenantBranding1718501400000 implements MigrationInterface {
  name = 'AddTenantBranding1718501400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants
         ADD COLUMN IF NOT EXISTS logo_path       VARCHAR(500),
         ADD COLUMN IF NOT EXISTS logo_mime       VARCHAR(50),
         ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants
         DROP COLUMN IF EXISTS logo_path,
         DROP COLUMN IF EXISTS logo_mime,
         DROP COLUMN IF EXISTS logo_updated_at`,
    );
  }
}
