import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RN-04 / BR-01: records the stage a process was in when it was put on hold
 * (processo_pendencia), so it can only resume at or before that stage instead
 * of jumping ahead past the document gate.
 *
 * Processes already on hold are backfilled from the audit trail (RN-07 logs
 * every stage change). Rows with no usable history stay NULL and keep the old
 * behaviour (any resume target), still subject to the document gate.
 */
export class AddStageBeforePendencia1718500200000 implements MigrationInterface {
  name = 'AddStageBeforePendencia1718500200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE processes ADD COLUMN IF NOT EXISTS stage_before_pendencia VARCHAR(50)`,
    );
    await queryRunner.query(
      `UPDATE processes p
          SET stage_before_pendencia = last.from_state
         FROM (SELECT DISTINCT ON (process_id) process_id, from_state
                 FROM audit_logs
                WHERE action = 'stage_change' AND to_state = 'processo_pendencia'
                ORDER BY process_id, created_at DESC) last
        WHERE p.id = last.process_id
          AND p.stage = 'processo_pendencia'
          AND p.stage_before_pendencia IS NULL
          AND last.from_state IN ('cadastro', 'analise_credito', 'credito_aprovado',
                                  'analise_juridica', 'juridico_aprovado', 'cartorio')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE processes DROP COLUMN IF EXISTS stage_before_pendencia`,
    );
  }
}
