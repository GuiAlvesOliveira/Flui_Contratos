import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cor do sistema por assessoria: o gestor escolhe, em Configurações, uma das
 * cores da paleta e ela vale para a equipe e para os clientes da assessoria.
 * A coluna guarda só o identificador da cor (ver tenants/tenant-theme.ts);
 * quem já existe fica com a cor padrão.
 */
export class AddTenantThemeColor1718502300000 implements MigrationInterface {
  name = 'AddTenantThemeColor1718502300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS theme_color VARCHAR(20) NOT NULL DEFAULT 'floresta'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants DROP COLUMN IF EXISTS theme_color`,
    );
  }
}
