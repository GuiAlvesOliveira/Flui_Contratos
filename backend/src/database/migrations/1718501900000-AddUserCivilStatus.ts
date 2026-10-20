import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estado civil e fonte de renda do proponente.
 * - processes.estado_civil passa a aceitar viúvo(a) e união estável, que a tela
 *   do processo já oferecia e o banco recusava. O CHECK novo é NOT VALID: as
 *   linhas existentes não são revalidadas (vêm da regra antiga, mais restrita),
 *   e toda gravação nova passa por ele.
 * - users.estado_civil / users.fonte_renda: o que o cliente declara no
 *   onboarding fica guardado nele e preenche os processos dele que ainda não
 *   têm esses dados (inclusive os criados depois).
 */
export class AddUserCivilStatus1718501900000 implements MigrationInterface {
  name = 'AddUserCivilStatus1718501900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // o nome do CHECK antigo é gerado pelo banco: procura pela definição
    await queryRunner.query(`
      DO $$
      DECLARE c record;
      BEGIN
        FOR c IN SELECT conname FROM pg_constraint
                  WHERE conrelid = 'processes'::regclass AND contype = 'c'
                    AND pg_get_constraintdef(oid) LIKE '%estado_civil%'
        LOOP
          EXECUTE format('ALTER TABLE processes DROP CONSTRAINT %I', c.conname);
        END LOOP;
      END $$`);
    await queryRunner.query(
      `ALTER TABLE processes ADD CONSTRAINT processes_estado_civil_check
         CHECK (estado_civil IN ('solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel'))
         NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE users
         ADD COLUMN IF NOT EXISTS estado_civil VARCHAR(20)
             CHECK (estado_civil IN ('solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel')),
         ADD COLUMN IF NOT EXISTS fonte_renda VARCHAR(20)
             CHECK (fonte_renda IN ('assalariado', 'nao_assalariado'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS estado_civil, DROP COLUMN IF EXISTS fonte_renda`,
    );
    await queryRunner.query(
      `ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_estado_civil_check`,
    );
    await queryRunner.query(
      `ALTER TABLE processes ADD CONSTRAINT processes_estado_civil_check
         CHECK (estado_civil IN ('casado', 'solteiro', 'divorciado')) NOT VALID`,
    );
  }
}
