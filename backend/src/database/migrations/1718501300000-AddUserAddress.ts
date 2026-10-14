import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PROD-06: the cliente's address. The onboarding form already asked for it,
 * but there was nowhere to keep it. CEP is stored as 8 digits.
 */
export class AddUserAddress1718501300000 implements MigrationInterface {
  name = 'AddUserAddress1718501300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users
         ADD COLUMN IF NOT EXISTS cep      VARCHAR(8),
         ADD COLUMN IF NOT EXISTS endereco VARCHAR(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS cep, DROP COLUMN IF EXISTS endereco`,
    );
  }
}
