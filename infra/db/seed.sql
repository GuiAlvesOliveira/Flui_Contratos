-- ─────────────────────────────────────────────────────────────
-- seed.sql — Full schema + dev seed (1 tenant, 4 users)
-- Safe to re-run (idempotent via CREATE IF NOT EXISTS / ON CONFLICT).
-- external_id is NULL until first Supabase login (lazy binding).
-- ─────────────────────────────────────────────────────────────

-- ── Tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) UNIQUE NOT NULL,
  active     BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID         REFERENCES tenants(id),          -- NULL for platform admin
  external_id          VARCHAR(255) UNIQUE,                          -- NULL until first login
  role                 VARCHAR(20)  NOT NULL
                         CHECK (role IN ('admin', 'dono', 'analista', 'cliente')),
  email                VARCHAR(255) NOT NULL,
  name                 VARCHAR(255),
  surname              VARCHAR(255),
  cpf                  VARCHAR(14),
  rg                   VARCHAR(20),
  active               BOOLEAN      NOT NULL DEFAULT true,
  onboarding_completed BOOLEAN      NOT NULL DEFAULT false,
  created_by           UUID         REFERENCES users(id),
  invited_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email       ON users(email);
CREATE INDEX        IF NOT EXISTS idx_users_external_id ON users(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_users_tenant_id   ON users(tenant_id);

-- Phase 5 migrations (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telefone VARCHAR(20);

-- Phase 6 migrations (idempotent)

CREATE TABLE IF NOT EXISTS empreendimentos (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID         NOT NULL REFERENCES tenants(id),
  matricula_mae         VARCHAR(100) NOT NULL,
  endereco              TEXT         NOT NULL,
  cep                   VARCHAR(10)  NOT NULL,
  banco_financiador     VARCHAR(255) NOT NULL,
  construtora_info      TEXT,
  incorporadora_contato VARCHAR(255),
  active                BOOLEAN      NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_empreendimentos_tenant_id ON empreendimentos(tenant_id);

CREATE TABLE IF NOT EXISTS unidades (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id),
  empreendimento_id UUID         NOT NULL REFERENCES empreendimentos(id),
  identificacao     VARCHAR(100) NOT NULL,
  valor             DECIMAL(15,2),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unidades_empreendimento_id ON unidades(empreendimento_id);

-- Update processes stage constraint to match real business flow
ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_stage_check;
ALTER TABLE processes ADD CONSTRAINT processes_stage_check
  CHECK (stage IN (
    'inicial', 'cliente_ativo', 'cliente_inativo', 'aprovado',
    'em_analise_banco', 'credito_recusado', 'processo_pendencia',
    'aguardando_assinatura', 'em_emissao', 'juridico'
  ));
ALTER TABLE processes ALTER COLUMN stage SET DEFAULT 'inicial';

ALTER TABLE processes ADD COLUMN IF NOT EXISTS unidade_id       UUID         REFERENCES unidades(id);
ALTER TABLE processes ADD COLUMN IF NOT EXISTS valor_unidade    DECIMAL(15,2);
ALTER TABLE processes ADD COLUMN IF NOT EXISTS valor_em_aberto  DECIMAL(15,2);
ALTER TABLE processes ADD COLUMN IF NOT EXISTS motivo_inatividade VARCHAR(50)
  CHECK (motivo_inatividade IN ('recursos_proprios','outra_assessoria','sozinho','nao_atendeu'));
ALTER TABLE processes ADD COLUMN IF NOT EXISTS fonte_renda      VARCHAR(20)
  CHECK (fonte_renda IN ('assalariado','nao_assalariado'));
ALTER TABLE processes ADD COLUMN IF NOT EXISTS estado_civil     VARCHAR(20)
  CHECK (estado_civil IN ('casado','solteiro','divorciado'));
ALTER TABLE processes ADD COLUMN IF NOT EXISTS motivo_recusa    TEXT;

CREATE TABLE IF NOT EXISTS processes (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id),
  client_id   UUID         NOT NULL REFERENCES users(id),
  analista_id UUID         REFERENCES users(id),
  stage       VARCHAR(50)  NOT NULL DEFAULT 'cadastro'
                CHECK (stage IN (
                  'cadastro', 'analise_credito', 'analise_juridica',
                  'vistoria', 'contrato', 'cartorio'
                )),
  mip_value   DECIMAL(15,2),
  dfi_value   DECIMAL(15,2),
  active      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processes_tenant_id ON processes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_processes_client_id ON processes(client_id);

CREATE TABLE IF NOT EXISTS process_participants (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id      UUID         NOT NULL REFERENCES processes(id),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id),
  name            VARCHAR(255) NOT NULL,
  cpf             VARCHAR(14),
  declared_income DECIMAL(15,2) NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participants_process_id ON process_participants(process_id);

CREATE TABLE IF NOT EXISTS documents (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id),
  process_id   UUID         REFERENCES processes(id),
  user_id      UUID         REFERENCES users(id),
  stage        VARCHAR(50),
  name         VARCHAR(255) NOT NULL,
  blob_path    VARCHAR(500) NOT NULL,
  mime_type    VARCHAR(100),
  size_bytes   BIGINT,
  validated    BOOLEAN      NOT NULL DEFAULT false,
  validated_by UUID         REFERENCES users(id),
  validated_at TIMESTAMPTZ,
  uploaded_by  UUID         NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant_id  ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_process_id ON documents(process_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID         NOT NULL REFERENCES tenants(id),
  process_id UUID         REFERENCES processes(id),
  actor_id   UUID         REFERENCES users(id),
  action     VARCHAR(100) NOT NULL,
  from_state VARCHAR(100),
  to_state   VARCHAR(100),
  metadata   JSONB,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id  ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_process_id ON audit_logs(process_id);

-- Phase 7 migrations (idempotent)
ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS nome VARCHAR(255) NOT NULL DEFAULT '';

ALTER TABLE documents ALTER COLUMN blob_path DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS category VARCHAR(30);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_type  VARCHAR(50);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS label     VARCHAR(255);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status    VARCHAR(20) NOT NULL DEFAULT 'pendente';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS notes     TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS validated_by_notes TEXT;
UPDATE documents SET status = CASE WHEN validated = true THEN 'validado' ELSE 'recebido' END
  WHERE blob_path IS NOT NULL AND status = 'pendente';

-- Phase 8 migration: personal docs become client-level (process_id = NULL, shared across all client's processes)
UPDATE documents
SET process_id = NULL
WHERE doc_type IN ('rg_cnh', 'comprovante_endereco', 'cert_estado_civil')
  AND process_id IS NOT NULL;

-- ── Seed data ────────────────────────────────────────────────
-- external_id is left NULL here.
-- After creating users in the Supabase Dashboard, run:
--   UPDATE users SET external_id = '<supabase-uuid>' WHERE email = '<email>';

INSERT INTO tenants (id, name, slug)
VALUES ('a0000000-0000-4000-8000-000000000001', 'Assessoria Flui Dev', 'flui-dev')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (id, tenant_id, role, name, email)
VALUES
  (
    'b0000000-0000-4000-8000-000000000001',
    NULL,
    'admin',
    'Admin Plataforma',
    'admin@fluicontratos.dev'
  ),
  (
    'b0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'dono',
    'Gestor Dev',
    'gestor@fluicontratos.dev'
  ),
  (
    'b0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000001',
    'analista',
    'Analista Dev',
    'analista@fluicontratos.dev'
  ),
  (
    'b0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000001',
    'cliente',
    'Cliente Dev',
    'cliente@fluicontratos.dev'
  )
ON CONFLICT (id) DO NOTHING;

-- Phase 9 seed — empreendimento + unidade + test process
INSERT INTO empreendimentos (id, tenant_id, nome, matricula_mae, endereco, cep, banco_financiador, construtora_info, incorporadora_contato, active)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'Residencial Flui Dev',
  '123.456',
  'Rua das Palmeiras, 100 - São Paulo/SP',
  '01310-100',
  'Caixa Econômica Federal',
  'Construtora Alfa Ltda',
  'incorporadora@fluidev.com.br',
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO unidades (id, tenant_id, empreendimento_id, identificacao, valor)
VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'AP 101',
  350000.00
) ON CONFLICT (id) DO NOTHING;

INSERT INTO processes (id, tenant_id, client_id, analista_id, stage, unidade_id, valor_unidade, valor_em_aberto, active)
VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000004',
  'b0000000-0000-4000-8000-000000000003',
  'inicial',
  'd0000000-0000-4000-8000-000000000001',
  350000.00,
  280000.00,
  true
) ON CONFLICT (id) DO NOTHING;

-- ── Real test data: Jardim Paulista Premium (sem cliente fixo — criar pelo painel) ──

INSERT INTO empreendimentos (id, tenant_id, nome, matricula_mae, endereco, cep, banco_financiador, construtora_info, incorporadora_contato, active)
VALUES (
  'c0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001',
  'Jardim Paulista Premium',
  '789.012',
  'Av. Paulista, 1578 - Bela Vista - São Paulo/SP',
  '01310-200',
  'Bradesco Financiamentos',
  'Construtora Beta S.A.',
  'vendas@betasa.com.br',
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO unidades (id, tenant_id, empreendimento_id, identificacao, valor)
VALUES (
  'd0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',
  'AP 302 - Torre B',
  480000.00
) ON CONFLICT (id) DO NOTHING;
