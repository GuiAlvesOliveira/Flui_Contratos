import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PROD-14: the gestor may edit any entry of the Histórico de Atividades, so an
 * entry keeps who changed its text last (the author stays the same).
 */
export class AddActivityEditedBy1718501100000 implements MigrationInterface {
  name = 'AddActivityEditedBy1718501100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE process_activities
         ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES users(id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE process_activities DROP COLUMN IF EXISTS edited_by`,
    );
  }
}
