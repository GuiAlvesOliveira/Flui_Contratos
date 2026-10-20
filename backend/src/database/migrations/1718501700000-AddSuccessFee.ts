import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PROD-09: success fee por contrato assinado.
 * - tenants.plano: plano da assessoria, definido pelo Super Admin fora do app
 *   (Essencial 1,5% · Profissional 1,0% · Escala 0,5% da comissão).
 * - processes.contrato_assinado_em: gravado quando o processo entra em Assinatura.
 * - processes.comissao_assessoria: comissão que a assessoria recebe no contrato.
 * - processes.taxa_success_fee: taxa do plano congelada na assinatura (fração,
 *   ex.: 0.0150), para uma troca de plano não mudar contratos já assinados.
 * Processos que já estão em Assinatura recebem a data da última entrada na
 * etapa (ou a última atualização) e a taxa do plano atual.
 */
export class AddSuccessFee1718501700000 implements MigrationInterface {
  name = 'AddSuccessFee1718501700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants
         ADD COLUMN IF NOT EXISTS plano VARCHAR(20) NOT NULL DEFAULT 'essencial'
             CHECK (plano IN ('essencial', 'profissional', 'escala'))`,
    );
    await queryRunner.query(
      `ALTER TABLE processes
         ADD COLUMN IF NOT EXISTS contrato_assinado_em TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS comissao_assessoria NUMERIC(15,2)
             CHECK (comissao_assessoria IS NULL OR comissao_assessoria >= 0),
         ADD COLUMN IF NOT EXISTS taxa_success_fee NUMERIC(6,4)
             CHECK (taxa_success_fee IS NULL OR (taxa_success_fee >= 0 AND taxa_success_fee <= 1))`,
    );
    await queryRunner.query(
      `UPDATE processes p
          SET contrato_assinado_em = COALESCE(
                (SELECT max(al.created_at) FROM audit_logs al
                  WHERE al.process_id = p.id AND al.action = 'stage_change'
                    AND al.to_state = 'assinatura'),
                p.updated_at),
              taxa_success_fee = CASE t.plano WHEN 'escala' THEN 0.005
                                              WHEN 'profissional' THEN 0.010
                                              ELSE 0.015 END
         FROM tenants t
        WHERE t.id = p.tenant_id AND p.stage = 'assinatura'
          AND p.contrato_assinado_em IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_processes_contrato_assinado
         ON processes (tenant_id, contrato_assinado_em)
         WHERE contrato_assinado_em IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_processes_contrato_assinado`,
    );
    await queryRunner.query(
      `ALTER TABLE processes
         DROP COLUMN IF EXISTS contrato_assinado_em,
         DROP COLUMN IF EXISTS comissao_assessoria,
         DROP COLUMN IF EXISTS taxa_success_fee`,
    );
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN IF EXISTS plano`);
  }
}
