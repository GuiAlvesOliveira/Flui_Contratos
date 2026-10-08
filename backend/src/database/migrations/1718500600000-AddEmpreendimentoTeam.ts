import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FE-27: analistas assigned to an empreendimento (its team). The gestor adds
 * and removes members on the empreendimento page.
 */
export class AddEmpreendimentoTeam1718500600000 implements MigrationInterface {
  name = 'AddEmpreendimentoTeam1718500600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS empreendimento_team (
        tenant_id         UUID NOT NULL REFERENCES tenants(id),
        empreendimento_id UUID NOT NULL REFERENCES empreendimentos(id) ON DELETE CASCADE,
        user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        added_by          UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (empreendimento_id, user_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_empreendimento_team_tenant ON empreendimento_team (tenant_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS empreendimento_team`);
  }
}
