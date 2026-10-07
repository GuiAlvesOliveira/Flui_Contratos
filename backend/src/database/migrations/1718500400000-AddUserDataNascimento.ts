import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FE-20: birth date on the proponente's ficha cadastral. The onboarding form
 * already asked for it, but there was no column to store it. Nullable, so
 * existing users are untouched and the field stays optional.
 */
export class AddUserDataNascimento1718500400000 implements MigrationInterface {
  name = 'AddUserDataNascimento1718500400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS data_nascimento DATE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS data_nascimento`,
    );
  }
}
