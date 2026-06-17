-- ─────────────────────────────────────────────────────────────
-- seed.sql — DEV SEED DATA ONLY (1 tenant, 4 users, sample empreendimentos)
--
-- The schema (DDL) is now owned by TypeORM migrations under
-- backend/src/database/migrations — NOT by this file anymore (DB-03).
-- Run order for a fresh database:
--   1. Apply migrations:  cd backend && npm run migration:run
--      (the deployed app also runs them on boot via migrationsRun)
--   2. Seed dev data:     psql ... -f infra/db/seed.sql
--
-- Idempotent via ON CONFLICT. external_id stays NULL until first Supabase login.
-- ─────────────────────────────────────────────────────────────

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
