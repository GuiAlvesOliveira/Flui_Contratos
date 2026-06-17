import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DB-01: makes the database `processes.stage` CHECK the single source of truth,
 * matching the ProcessStage enum in process.entity.ts (which the Kanban uses).
 *
 * Adapts ALL existing rows first: any legacy stage value (from the old seed
 * constraints — cliente_ativo, aprovado, em_analise_banco, vistoria, contrato,
 * etc.) is remapped to the closest canonical stage, so no current process
 * violates the new constraint and nothing has to be fixed by hand. Anything
 * unrecognized is parked in `processo_pendencia` for review rather than guessed.
 */
const CANONICAL_STAGES = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
  'cliente_inativo', 'credito_recusado', 'processo_pendencia',
];

export class UnifyProcessStages1718500100000 implements MigrationInterface {
  name = 'UnifyProcessStages1718500100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the legacy constraint so the remap can run unblocked.
    await queryRunner.query(
      `ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_stage_check`,
    );

    // 2. Remap legacy values to the canonical set (best-effort semantics).
    const remap: Record<string, string> = {
      cliente_ativo: 'cadastro',
      aprovado: 'credito_aprovado',
      em_analise_banco: 'analise_credito',
      aguardando_assinatura: 'assinatura',
      em_emissao: 'cartorio',
      juridico: 'analise_juridica',
      vistoria: 'analise_juridica',
      contrato: 'cartorio',
    };
    for (const [from, to] of Object.entries(remap)) {
      await queryRunner.query(`UPDATE processes SET stage = $1 WHERE stage = $2`, [to, from]);
    }

    // 3. Catch-all: anything still outside the canonical set is parked for review.
    await queryRunner.query(
      `UPDATE processes SET stage = 'processo_pendencia' WHERE stage <> ALL($1::text[])`,
      [CANONICAL_STAGES],
    );

    // 4. Canonical default + constraint.
    await queryRunner.query(`ALTER TABLE processes ALTER COLUMN stage SET DEFAULT 'inicial'`);
    await queryRunner.query(
      `ALTER TABLE processes ADD CONSTRAINT processes_stage_check
       CHECK (stage IN (${CANONICAL_STAGES.map((s) => `'${s}'`).join(', ')}))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the canonical constraint; the legacy (drifted) constraint is not
    // restored on purpose — there was no single correct previous state.
    await queryRunner.query(
      `ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_stage_check`,
    );
  }
}
