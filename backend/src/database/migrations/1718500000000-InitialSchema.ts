import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline schema — the DDL that previously lived (and drifted) in
 * infra/db/seed.sql, now owned by migrations (DB-02/DB-03). Every statement is
 * idempotent (IF NOT EXISTS), so this is a safe no-op on the already-provisioned
 * database and builds the full schema from scratch on a fresh one. Table-creation
 * order respects the foreign keys (fixes the seed.sql ordering bug, DB-02).
 *
 * The `processes.stage` CHECK is intentionally NOT created here — it is owned by
 * the UnifyProcessStages migration, which also remaps any legacy data (DB-01).
 */
export class InitialSchema1718500000000 implements MigrationInterface {
  name = 'InitialSchema1718500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS tenants (
        id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        name       VARCHAR(255) NOT NULL,
        slug       VARCHAR(100) UNIQUE NOT NULL,
        active     BOOLEAN      NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`,

      `CREATE TABLE IF NOT EXISTS users (
        id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id            UUID         REFERENCES tenants(id),
        external_id          VARCHAR(255) UNIQUE,
        role                 VARCHAR(20)  NOT NULL CHECK (role IN ('admin','dono','analista','cliente')),
        email                VARCHAR(255) NOT NULL,
        name                 VARCHAR(255),
        surname              VARCHAR(255),
        cpf                  VARCHAR(14),
        rg                   VARCHAR(20),
        active               BOOLEAN      NOT NULL DEFAULT true,
        onboarding_completed BOOLEAN      NOT NULL DEFAULT false,
        must_change_password BOOLEAN      NOT NULL DEFAULT false,
        telefone             VARCHAR(20),
        created_by           UUID         REFERENCES users(id),
        invited_at           TIMESTAMPTZ,
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS telefone VARCHAR(20)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email       ON users(email)`,
      `CREATE INDEX        IF NOT EXISTS idx_users_external_id ON users(external_id) WHERE external_id IS NOT NULL`,
      `CREATE INDEX        IF NOT EXISTS idx_users_tenant_id   ON users(tenant_id)`,

      `CREATE TABLE IF NOT EXISTS empreendimentos (
        id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id             UUID         NOT NULL REFERENCES tenants(id),
        nome                  VARCHAR(255) NOT NULL DEFAULT '',
        matricula_mae         VARCHAR(100) NOT NULL,
        endereco              TEXT         NOT NULL,
        cep                   VARCHAR(10)  NOT NULL,
        banco_financiador     VARCHAR(255) NOT NULL,
        construtora_info      TEXT,
        incorporadora_contato VARCHAR(255),
        active                BOOLEAN      NOT NULL DEFAULT true,
        created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`,
      `ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS nome VARCHAR(255) NOT NULL DEFAULT ''`,
      `CREATE INDEX IF NOT EXISTS idx_empreendimentos_tenant_id ON empreendimentos(tenant_id)`,

      `CREATE TABLE IF NOT EXISTS unidades (
        id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         UUID         NOT NULL REFERENCES tenants(id),
        empreendimento_id UUID         NOT NULL REFERENCES empreendimentos(id),
        identificacao     VARCHAR(100) NOT NULL,
        valor             DECIMAL(15,2),
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_unidades_empreendimento_id ON unidades(empreendimento_id)`,

      `CREATE TABLE IF NOT EXISTS processes (
        id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          UUID         NOT NULL REFERENCES tenants(id),
        client_id          UUID         NOT NULL REFERENCES users(id),
        analista_id        UUID         REFERENCES users(id),
        unidade_id         UUID         REFERENCES unidades(id),
        stage              VARCHAR(50)  NOT NULL DEFAULT 'inicial',
        mip_value          DECIMAL(15,2),
        dfi_value          DECIMAL(15,2),
        valor_unidade      DECIMAL(15,2),
        valor_em_aberto    DECIMAL(15,2),
        motivo_inatividade VARCHAR(50)  CHECK (motivo_inatividade IN ('recursos_proprios','outra_assessoria','sozinho','nao_atendeu')),
        fonte_renda        VARCHAR(20)  CHECK (fonte_renda IN ('assalariado','nao_assalariado')),
        estado_civil       VARCHAR(20)  CHECK (estado_civil IN ('casado','solteiro','divorciado')),
        motivo_recusa      TEXT,
        active             BOOLEAN      NOT NULL DEFAULT true,
        created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`,
      // Existing databases that predate the Phase-6 columns get them here.
      `ALTER TABLE processes ADD COLUMN IF NOT EXISTS unidade_id       UUID REFERENCES unidades(id)`,
      `ALTER TABLE processes ADD COLUMN IF NOT EXISTS valor_unidade    DECIMAL(15,2)`,
      `ALTER TABLE processes ADD COLUMN IF NOT EXISTS valor_em_aberto  DECIMAL(15,2)`,
      `ALTER TABLE processes ADD COLUMN IF NOT EXISTS motivo_inatividade VARCHAR(50)`,
      `ALTER TABLE processes ADD COLUMN IF NOT EXISTS fonte_renda      VARCHAR(20)`,
      `ALTER TABLE processes ADD COLUMN IF NOT EXISTS estado_civil     VARCHAR(20)`,
      `ALTER TABLE processes ADD COLUMN IF NOT EXISTS motivo_recusa    TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_processes_tenant_id ON processes(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_processes_client_id ON processes(client_id)`,

      `CREATE TABLE IF NOT EXISTS process_participants (
        id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        process_id      UUID          NOT NULL REFERENCES processes(id),
        tenant_id       UUID          NOT NULL REFERENCES tenants(id),
        name            VARCHAR(255)  NOT NULL,
        cpf             VARCHAR(14),
        declared_income DECIMAL(15,2) NOT NULL,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_participants_process_id ON process_participants(process_id)`,

      `CREATE TABLE IF NOT EXISTS documents (
        id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          UUID         NOT NULL REFERENCES tenants(id),
        process_id         UUID         REFERENCES processes(id),
        user_id            UUID         REFERENCES users(id),
        stage              VARCHAR(50),
        name               VARCHAR(255) NOT NULL,
        blob_path          VARCHAR(500),
        mime_type          VARCHAR(100),
        size_bytes         BIGINT,
        validated          BOOLEAN      NOT NULL DEFAULT false,
        validated_by       UUID         REFERENCES users(id),
        validated_at       TIMESTAMPTZ,
        uploaded_by        UUID         REFERENCES users(id),
        category           VARCHAR(30),
        doc_type           VARCHAR(50),
        label              VARCHAR(255),
        status             VARCHAR(20)  NOT NULL DEFAULT 'pendente',
        notes              TEXT,
        validated_by_notes TEXT,
        created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`,
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS category           VARCHAR(30)`,
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_type           VARCHAR(50)`,
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS label              VARCHAR(255)`,
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS status             VARCHAR(20) NOT NULL DEFAULT 'pendente'`,
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS notes              TEXT`,
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS validated_by_notes TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_documents_tenant_id  ON documents(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_documents_process_id ON documents(process_id)`,

      `CREATE TABLE IF NOT EXISTS audit_logs (
        id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id  UUID         NOT NULL REFERENCES tenants(id),
        process_id UUID         REFERENCES processes(id),
        actor_id   UUID         REFERENCES users(id),
        action     VARCHAR(100) NOT NULL,
        from_state VARCHAR(100),
        to_state   VARCHAR(100),
        metadata   JSONB,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id  ON audit_logs(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_process_id ON audit_logs(process_id)`,
    ];

    for (const sql of statements) {
      await queryRunner.query(sql);
    }
  }

  // Baseline migration — intentionally not reversible (reverting would drop the
  // whole schema). Use a fresh database instead of reverting.
  public async down(): Promise<void> {
    // no-op
  }
}
