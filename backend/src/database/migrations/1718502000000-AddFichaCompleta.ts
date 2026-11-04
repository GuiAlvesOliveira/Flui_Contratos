import { MigrationInterface, QueryRunner } from 'typeorm';
import { FICHA_PESSOAL_COLUMNS } from '../../ficha/ficha-pessoal.embedded';

/**
 * Ficha completa do proponente (dados que os formulários do banco pedem).
 * - users e process_participants ganham as mesmas colunas da ficha
 *   (FichaPessoal); o participante ganha também os dados básicos que o
 *   cliente já tinha (RG, telefone, nascimento, CEP, estado civil, e-mail).
 * - processes: quem é o 2º comprador/cônjuge e os dados do financiamento no
 *   banco (SFH, FGTS, percentual, conta para débito, seguradora).
 * - data_requests: dados que o analista pede ao cliente.
 * Tudo nulo por padrão: nenhuma linha existente muda.
 */
export class AddFichaCompleta1718502000000 implements MigrationInterface {
  name = 'AddFichaCompleta1718502000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const ficha = FICHA_PESSOAL_COLUMNS.map(
      ([col, type]) => `ADD COLUMN IF NOT EXISTS ${col} ${type}`,
    ).join(',\n');
    await queryRunner.query(`ALTER TABLE users ${ficha}`);
    await queryRunner.query(`ALTER TABLE process_participants ${ficha}`);
    await queryRunner.query(
      `ALTER TABLE process_participants
         ADD COLUMN IF NOT EXISTS rg VARCHAR(20),
         ADD COLUMN IF NOT EXISTS telefone VARCHAR(20),
         ADD COLUMN IF NOT EXISTS data_nascimento DATE,
         ADD COLUMN IF NOT EXISTS cep VARCHAR(8),
         ADD COLUMN IF NOT EXISTS estado_civil VARCHAR(20)
             CHECK (estado_civil IN ('solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel')),
         ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE processes
         ADD COLUMN IF NOT EXISTS segundo_comprador_id UUID
             REFERENCES process_participants(id) ON DELETE SET NULL,
         ADD COLUMN IF NOT EXISTS primeira_compra_sfh BOOLEAN,
         ADD COLUMN IF NOT EXISTS usa_fgts BOOLEAN,
         ADD COLUMN IF NOT EXISTS percentual_aquisicao_1 NUMERIC(5,2)
             CHECK (percentual_aquisicao_1 > 0 AND percentual_aquisicao_1 <= 100),
         ADD COLUMN IF NOT EXISTS banco_agencia VARCHAR(10),
         ADD COLUMN IF NOT EXISTS banco_conta VARCHAR(20),
         ADD COLUMN IF NOT EXISTS seguradora VARCHAR(20)
             CHECK (seguradora IN ('itau', 'tokio_marine'))`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        process_id UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
        client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fields TEXT[] NOT NULL CHECK (cardinality(fields) BETWEEN 1 AND 80),
        note VARCHAR(500),
        status VARCHAR(12) NOT NULL DEFAULT 'pendente'
            CHECK (status IN ('pendente', 'respondido', 'cancelado')),
        requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        answered_at TIMESTAMPTZ
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_data_requests_process
         ON data_requests (tenant_id, process_id, status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS data_requests`);
    await queryRunner.query(
      `ALTER TABLE processes
         DROP COLUMN IF EXISTS segundo_comprador_id,
         DROP COLUMN IF EXISTS primeira_compra_sfh,
         DROP COLUMN IF EXISTS usa_fgts,
         DROP COLUMN IF EXISTS percentual_aquisicao_1,
         DROP COLUMN IF EXISTS banco_agencia,
         DROP COLUMN IF EXISTS banco_conta,
         DROP COLUMN IF EXISTS seguradora`,
    );
    await queryRunner.query(
      `ALTER TABLE process_participants
         DROP COLUMN IF EXISTS rg, DROP COLUMN IF EXISTS telefone,
         DROP COLUMN IF EXISTS data_nascimento, DROP COLUMN IF EXISTS cep,
         DROP COLUMN IF EXISTS estado_civil, DROP COLUMN IF EXISTS email`,
    );
    const drop = FICHA_PESSOAL_COLUMNS.map(
      ([col]) => `DROP COLUMN IF EXISTS ${col}`,
    ).join(', ');
    await queryRunner.query(`ALTER TABLE process_participants ${drop}`);
    await queryRunner.query(`ALTER TABLE users ${drop}`);
  }
}
