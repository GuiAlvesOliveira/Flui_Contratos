import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PROD-01: tarefas da assessoria (ligar para o cliente, cobrar um documento,
 * agendar a vistoria...). O processo é opcional; prazo é um dia do calendário
 * (sem hora). Uma tarefa nunca é apagada fisicamente: a exclusão só preenche
 * deleted_* (mesma regra do Histórico de Atividades).
 */
export class AddTasks1718501500000 implements MigrationInterface {
  name = 'AddTasks1718501500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    UUID NOT NULL REFERENCES tenants(id),
        process_id   UUID REFERENCES processes(id),
        title        VARCHAR(200) NOT NULL
                     CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
        description  TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
        assignee_id  UUID NOT NULL REFERENCES users(id),
        due_date     DATE NOT NULL,
        status       VARCHAR(20) NOT NULL DEFAULT 'a_fazer'
                     CHECK (status IN ('a_fazer', 'em_andamento', 'concluida')),
        created_by   UUID NOT NULL REFERENCES users(id),
        completed_at TIMESTAMPTZ,
        completed_by UUID REFERENCES users(id),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at   TIMESTAMPTZ,
        deleted_by   UUID REFERENCES users(id)
      )`);
    // Lista e calendário: tarefas da assessoria por prazo, sem as excluídas.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tasks_tenant_due
         ON tasks (tenant_id, due_date) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tasks_assignee
         ON tasks (assignee_id, status) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tasks_process
         ON tasks (process_id) WHERE deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tasks`);
  }
}
