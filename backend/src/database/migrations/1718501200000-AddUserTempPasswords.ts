import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-18: the temporary password of an analista/cliente who has not signed in
 * yet, encrypted by the API (never in plain text). One row per user, deleted
 * when the person sets their own password or the user is deleted.
 */
export class AddUserTempPasswords1718501200000 implements MigrationInterface {
  name = 'AddUserTempPasswords1718501200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS user_temp_passwords (
         user_id    UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
         tenant_id  UUID         NOT NULL REFERENCES tenants(id),
         secret     TEXT         NOT NULL,
         created_by UUID         REFERENCES users(id) ON DELETE SET NULL,
         created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_temp_passwords`);
  }
}
