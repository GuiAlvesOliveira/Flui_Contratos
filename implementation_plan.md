# Flui Contratos — Implementation Plan

## Overview

Multi-tenant SaaS for real estate financing process management at Brazilian advisory firms.
Development is simultaneous across Cloud, Backend, and Frontend tracks.
Super Admin management happens via Azure Portal / CLI — no UI in the application.
Auth: **Supabase Auth** (replaced Microsoft Entra External ID).

---

## Local → Cloud Migration Strategy

All services that require infrastructure run locally via Docker Compose during development.
The exact same configuration is promoted to Azure via environment variable switching — no code changes required.

| Service | Local (Docker) | Cloud (Azure) |
|---|---|---|
| PostgreSQL | `postgres:16` container | Azure Database for PostgreSQL Flexible Server |
| n8n | `n8nio/n8n` container | Azure Container Apps |
| Blob Storage | Azurite emulator container | Azure Blob Storage |
| Backend | `npm run start:dev` (hot reload) | Azure App Service (Linux) |
| Frontend | `npm run dev` (Vite HMR) | Azure Static Web Apps |
| Monitoring | Console logs | Azure Application Insights |
| Auth | Supabase (cloud) | Supabase (same project) |

**How switching works:** a single `.env.local` (Docker) vs `.env.azure` (cloud) file controls all connection strings.
No conditional logic in application code — just env vars.

---

## Status Geral

| Fase | Status | Observação |
|---|---|---|
| Phase 0 — Repo & Docker | ✅ Concluída | Docker Compose, seed.sql, estrutura de pastas |
| Phase 1 — Cloud Azure | ✅ Concluída | Todos os recursos provisionados, seed aplicado no Azure |
| Phase 2 — Scaffolding | ✅ Concluída | NestJS + React; corrigidos: role dono/ceo, nullable, onboardingCompleted |
| Phase 3 — Auth Supabase | ✅ Concluída | Login E2E funcionando; SupabaseGuard usa getUser() (RS256); lazy binding ativo |
| Phase 4 — Multi-tenant completo | ✅ Concluída | POST /users validado: dono cria analista, 403 p/ criação não autorizada |
| Phase 5 — Onboarding Analista + Cliente | 🔄 Próxima | Analista sem email (CPF como senha), must_change_password, Ficha Cadastral |
| Phase 6 — Documentos + Kanban gate | ⬜ Pendente | Alinhamento dos stages com fluxo_processo.md pendente |

---

## Phase 0 — Repository & Environment Bootstrap ✅

**Objetivo:** monorepo structure, tooling, and Docker Compose running locally.

### Repository Structure

```
flui-contratos/
├── backend/              # NestJS API
├── frontend/             # React + Vite
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml      # local dev: postgres, n8n, azurite
│   │   └── docker-compose.prod.yml # cloud smoke-test override
│   ├── azure/
│   │   ├── provision.sh            # CLI script — provisions all Azure resources
│   │   └── env.azure.template      # template for cloud env vars
│   └── db/
│       └── seed.sql                # dev seed: 1 tenant, 3 users (one per role)
├── .env.local.template   # template for local Docker env vars
├── frontend/.env.local   # Vite env vars (git-ignored)
├── implementation_plan.md
└── CLAUDE.md
```

---

## Phase 1 — Cloud Infrastructure (`flui-dev`) 🔄

**Objetivo:** all Azure resources provisioned and interconnected. Resource group `flui-dev` já existe no Brazil South.

### Preparação (concluída)
- ✅ `infra/azure/provision.sh` — idempotente, cria todos os recursos
- ✅ `infra/azure/env.azure.template` — atualizado para Supabase (sem Entra)
- ✅ `infra/db/seed.sql` — schema completo (6 tabelas + índices) + 4 usuários dev

### Execução pendente

```bash
# 1. Provisionar recursos Azure
bash infra/azure/provision.sh

# 2. Criar .env.azure a partir do template e preencher os valores
cp infra/azure/env.azure.template .env.azure
# Preencher: DATABASE_PASSWORD (do Key Vault), SUPABASE_JWT_SECRET,
#            storage keys, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

# 3. Aplicar schema no banco Azure
psql "$DATABASE_URL" -f infra/db/seed.sql
```

### Recursos que serão criados
- PostgreSQL Flexible Server (Burstable B1ms)
- Storage Account + container `documentos` (soft delete 30 dias)
- App Service Plan B1 + Web App Node 20
- Azure Static Web App (Free)
- Log Analytics Workspace + Application Insights
- Key Vault (`flui-kv-dev`) com senha do PostgreSQL

### Done criteria
- Todos os recursos existem no resource group `flui-dev`
- `psql` contra o Azure DB executa `seed.sql` sem erros
- `GET https://flui-api-dev.azurewebsites.net/health` retorna `{ status: "ok" }`
- Application Insights dashboard mostra heartbeat do backend

---

## Phase 2 — Project Scaffolding ✅

**Concluída em 2026-04-30.**

### Backend (NestJS 11 + TypeScript)

```
backend/src/
├── auth/
│   └── supabase.guard.ts     # APP_GUARD global — valida JWT Supabase (HS256)
├── tenants/
│   └── tenant.entity.ts      # TypeORM entity
├── users/
│   └── user.entity.ts        # TypeORM entity
├── common/
│   ├── guards/
│   │   ├── tenant.guard.ts   # APP_GUARD global — DB lookup, 60s cache
│   │   └── roles.guard.ts    # por rota via @Roles()
│   ├── decorators/
│   │   ├── public.decorator.ts
│   │   └── roles.decorator.ts
├── health/
│   └── health.controller.ts  # GET /health (@Public)
└── me/
    └── me.controller.ts      # GET /me
```

### Frontend (React 19 + Vite + Tailwind CSS v4 + React Query v5)

```
frontend/src/
├── auth/
│   ├── supabaseClient.ts     # Supabase client singleton
│   ├── AuthProvider.tsx      # React Query provider
│   └── useAuth.ts            # session + GET /me hook
├── api/
│   └── axiosInstance.ts      # Bearer token via supabase.auth.getSession()
├── pages/
│   ├── LoginPage.tsx         # email/password via Supabase
│   ├── ComingSoon.tsx
│   └── Forbidden.tsx
└── router/
    └── AppRouter.tsx         # role-based routing
```

---

## Phase 3 — Auth Supabase 🔄

**Objetivo:** login funcionando end-to-end com isolamento real de tenant.

### Arquitetura de Autenticação

```
Supabase Auth                NestJS Backend              PostgreSQL
─────────────                ──────────────              ──────────
signInWithPassword  ──JWT──► SupabaseGuard               users
  (email, senha)             verifica HS256              (external_id,
                             extrai sub + email           email, role,
                                  │                       tenant_id)
                             TenantGuard
                             1. lookup por external_id
                             2. fallback: lookup por email
                                → UPDATE external_id = sub  ← vinculação lazy
                             3. não encontrado → 403
                             4. enriquece request.user
```

### Vinculação Lazy (external_id binding)

Usuários são criados no banco **antes** de ter conta no Supabase (via convite).
`external_id` começa NULL e é preenchido no **primeiro login**:

```
Primeiro login:
  TenantGuard → não acha por external_id
              → busca por email → encontrado
              → UPDATE users SET external_id = sub
              → prossegue normalmente
```

**Não é auto-provisioning** — o registro precisa existir. É apenas binding tardio.

### TenantGuard atualizado (pendente)

Adicionar ao `tenant.guard.ts` existente:
1. Se lookup por `external_id` falhar → fallback por `email`
2. Se encontrar por email → `UPDATE users SET external_id = ?`
3. Verifica `user.active` e `tenant.active`

### Seed de desenvolvimento (pendente)

`infra/db/seed.sql` já cria os usuários com `external_id = NULL`.
Após criar os usuários no Supabase Dashboard, vincular os UUIDs reais:
```sql
UPDATE users SET external_id = '<uuid-supabase>' WHERE email = 'gestor@fluicontratos.dev';
UPDATE users SET external_id = '<uuid-supabase>' WHERE email = 'analista@fluicontratos.dev';
UPDATE users SET external_id = '<uuid-supabase>' WHERE email = 'cliente@fluicontratos.dev';
-- O admin de plataforma não precisa de external_id se não logar pelo app
```

### Done criteria
- Login com email/senha no Supabase → redireciona por role
- `GET /me` retorna `{ id, name, email, role, tenantId, onboardingCompleted }`
- `GET /health` retorna 200 sem token
- Token inválido → 401
- Email não provisionado → 403

---

## Phase 4 — Multi-tenant Completo ✅

**Concluída.** Hierarquia de criação de usuários funcionando com isolamento garantido.

### O que foi implementado

```
admin  (tenant_id = NULL — plataforma)
  └─► cria: dono (qualquer tenant)

dono   (pertence a 1 tenant)
  └─► cria: analista (mesmo tenant) → via inviteUserByEmail

analista (pertence ao mesmo tenant que o dono)
  └─► cria: cliente (mesmo tenant)  → via inviteUserByEmail
```

Endpoints implementados:
- `POST /tenants` — admin only
- `POST /users` — hierarquia enforced, convite Supabase por email
- `GET /users`, `GET /users/:id`, `PATCH /users/:id/activate`

**Validado manualmente:** dono cria analista ✅ | 403 para criação não autorizada ✅

---

## Phase 5 — Onboarding Analista + Cliente 🔄

**Objetivo:** dois fluxos distintos de chegada — analista sem email (interno) e cliente via convite.

### 5.1 — Analista: criação sem email, senha = CPF

Analistas são funcionários internos da assessoria. Não recebem convite por e-mail.
O dono (gestor) cria o analista no sistema e repassa as credenciais presencialmente.

**Fluxo:**
```
Dono chama POST /users { role: 'analista', cpf, name, ... }
  → Backend gera email fictício: {cpf}@interno.fluicontratos
  → Backend chama supabase.auth.admin.createUser({
        email: fictício, password: cpf, email_confirm: true
    })
  → Insere em users com must_change_password = true
  → Retorna { temporaryPassword: cpf } (exibido uma vez ao dono)

Analista no primeiro login:
  → TenantGuard detecta must_change_password = true
  → Retorna 403 { code: 'PASSWORD_CHANGE_REQUIRED' }
  → Frontend redireciona para /change-password
  → PATCH /me/change-password { newPassword }
  → Backend atualiza Supabase + sets must_change_password = false

Analista no segundo login (onboarding):
  → onboarding_completed = false → redireciona para /analista/onboarding
  → Revisa e completa dados: nome, sobrenome, email real, telefone
  → PATCH /me/onboarding → onboarding_completed = true
```

**Migrações necessárias:**
```sql
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN telefone VARCHAR(20);
```

**Endpoints novos:**
```
PATCH /me/change-password     → atualiza senha no Supabase + must_change_password = false
PATCH /me/onboarding          → salva dados + onboarding_completed = true
POST  /users/bulk             → aceita array de usuários (estrutura pronta, sem parsing Excel por ora)
```

### 5.2 — Cliente: convite por email + Ficha Cadastral

Clientes recebem convite Supabase por e-mail (fluxo existente — mantém `inviteUserByEmail`).

**Ficha Cadastral (onboarding do cliente após primeiro login):**
- Nome completo, data de nascimento
- Telefone, e-mail para contato
- Endereço completo
- Estado civil (casado / solteiro / divorciado)
- Fonte de renda (assalariado / não assalariado)
- Composição de renda (sozinho ou compor renda)
- Valor da unidade + valor em aberto (pré-preenchido pelo analista)

Rota: `/cliente/onboarding` → `PATCH /me/onboarding`

### 5.3 — TenantGuard: interceptação de must_change_password

```typescript
if (found.mustChangePassword) {
  throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED' });
}
```

Frontend captura esse código no interceptor Axios e redireciona para `/change-password`.

### Done criteria
- Analista criado sem email real, loga com CPF como senha
- Primeiro login → interceptado → troca de senha obrigatória
- Segundo login → onboarding de dados completos
- Cliente recebe convite por email → loga → preenche Ficha Cadastral
- `POST /users/bulk` aceita array e processa sequencialmente (sem Excel parsing ainda)

---

## Phase 6 — Kanban Real + Documentos + Gate ⬜

**Objetivo:** alinhar o Kanban com o fluxo real do negócio (`fluxo_processo.md`) e implementar gate de documentos.

### 6.0 — Alinhamento dos stages (pré-requisito)

O schema atual usa `cadastro → analise_credito → analise_juridica → vistoria → contrato → cartorio`.
O fluxo real usa status distintos (ver `fluxo_processo.md` seção "Status do Sistema").

Migração necessária antes do restante da phase:
```sql
ALTER TABLE processes DROP CONSTRAINT processes_stage_check;
ALTER TABLE processes ADD CONSTRAINT processes_stage_check
  CHECK (stage IN (
    'cliente_ativo', 'cliente_inativo', 'aprovado', 'em_analise_banco',
    'credito_recusado', 'processo_pendencia', 'aguardando_assinatura',
    'em_emissao', 'juridico'
  ));

-- Novas colunas de processo (fluxo_processo.md §Schema)
ALTER TABLE processes ADD COLUMN unidade_id UUID REFERENCES unidades(id);
ALTER TABLE processes ADD COLUMN motivo_inatividade VARCHAR(50)
  CHECK (motivo_inatividade IN ('recursos_proprios','outra_assessoria','sozinho','nao_atendeu'));
ALTER TABLE processes ADD COLUMN fonte_renda VARCHAR(20)
  CHECK (fonte_renda IN ('assalariado','nao_assalariado'));
ALTER TABLE processes ADD COLUMN estado_civil VARCHAR(20)
  CHECK (estado_civil IN ('casado','solteiro','divorciado'));
ALTER TABLE processes ADD COLUMN data_nascimento DATE;
ALTER TABLE processes ADD COLUMN endereco TEXT;

-- Novas tabelas
CREATE TABLE empreendimentos ( ... );  -- ver fluxo_processo.md
CREATE TABLE unidades ( ... );         -- ver fluxo_processo.md
```

**Objetivo:** documentos funcionando e gate RN-04 ativo.

### Upload de Documentos

**Path no Azure Blob Storage:**
```
{tenant_id}/users/{user_id}/{filename}            ← docs pessoais (RG, CPF scan)
{tenant_id}/processes/{process_id}/{filename}     ← docs do processo/etapa
```

**Fluxo seguro (connection string nunca vai ao cliente):**
```
Cliente → POST /documents/upload (multipart/form-data)
        → Backend valida JWT + tenant_id
        → Backend faz upload via @azure/storage-blob SDK
        → Insere registro em documents (blob_path, mime_type, size_bytes)
        → Retorna { id, name } + SAS token temporário (1h) para leitura
```

### Gate Kanban (RN-04)

`ProcessService.advanceStage()` verifica, antes de avançar:
```
SELECT COUNT(*) FROM documents
WHERE process_id = :processId
  AND stage = :currentStage
  AND validated = false
  AND nome IN (<lista de docs obrigatórios da etapa>)
→ se COUNT > 0 → 422 "Documentos obrigatórios pendentes"
```

### Webhook n8n (RN-08/09)

Toda mudança de etapa dispara:
```
WebhookService.trigger(processId, fromStage, toStage, clientId)
  → POST {N8N_WEBHOOK_BASE_URL}/webhook/stage-change
  → n8n processa → envia SMS/email ao cliente
```

### Done criteria
- Upload funciona e retorna URL de leitura via SAS token
- Processo não avança sem documentos obrigatórios validados (verificar via API)
- Webhook chega ao n8n a cada mudança de etapa

---

## Database Schema (completo)

```sql
-- tenants
CREATE TABLE tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) UNIQUE NOT NULL,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- users
CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID REFERENCES tenants(id),   -- NULL para admin global
  external_id          VARCHAR(255) UNIQUE,           -- NULL até primeiro login
  role                 VARCHAR(20) NOT NULL
                         CHECK (role IN ('admin','dono','analista','cliente')),
  email                VARCHAR(255) NOT NULL,
  name                 VARCHAR(255),
  surname              VARCHAR(255),
  cpf                  VARCHAR(14),
  rg                   VARCHAR(20),
  active               BOOLEAN DEFAULT true,
  onboarding_completed BOOLEAN DEFAULT false,
  created_by           UUID REFERENCES users(id),
  invited_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_users_external_id ON users(external_id);
CREATE INDEX idx_users_email       ON users(email);
CREATE INDEX idx_users_tenant_id   ON users(tenant_id);

-- processes (Kanban de financiamento)
CREATE TABLE processes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  client_id   UUID NOT NULL REFERENCES users(id),
  analista_id UUID REFERENCES users(id),
  stage       VARCHAR(50) NOT NULL DEFAULT 'cadastro'
                CHECK (stage IN (
                  'cadastro','analise_credito','analise_juridica',
                  'vistoria','contrato','cartorio'
                )),
  mip_value   DECIMAL(15,2),   -- RN-05
  dfi_value   DECIMAL(15,2),   -- RN-05
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- process_participants (RN-06: composição de renda)
CREATE TABLE process_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id      UUID NOT NULL REFERENCES processes(id),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  name            VARCHAR(255) NOT NULL,
  cpf             VARCHAR(14),
  declared_income DECIMAL(15,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- documents
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  process_id   UUID REFERENCES processes(id),
  user_id      UUID REFERENCES users(id),
  stage        VARCHAR(50),
  name         VARCHAR(255) NOT NULL,
  blob_path    VARCHAR(500) NOT NULL,
  mime_type    VARCHAR(100),
  size_bytes   BIGINT,
  validated    BOOLEAN DEFAULT false,
  validated_by UUID REFERENCES users(id),
  validated_at TIMESTAMPTZ,
  uploaded_by  UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- audit_logs (RN-07)
CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  process_id UUID REFERENCES processes(id),
  actor_id   UUID REFERENCES users(id),
  action     VARCHAR(100) NOT NULL,
  from_state VARCHAR(100),
  to_state   VARCHAR(100),
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Business Rules Reference

| Regra | Descrição | Onde enforced |
|---|---|---|
| RN-01/RN-02 | Isolamento total entre tenants | TenantGuard (backend), nunca no frontend |
| RN-04 | Processo não avança sem documentos obrigatórios validados | `ProcessService.advanceStage()` |
| RN-05 | Todo processo deve incluir campos MIP e DFI | DTO validation + DB constraint |
| RN-06 | Renda = soma da renda de todos os participantes | Computed em `ProcessService` |
| RN-07 | Audit trail completo de toda mudança de etapa | `AuditInterceptor` + tabela `audit_logs` |
| RN-08/RN-09 | Toda mudança de etapa dispara webhook ao n8n | `WebhookService` dentro de `advanceStage()` |

---

## Decisões Arquiteturais Registradas

| Decisão | Escolha | Motivo |
|---|---|---|
| Provedor de auth | Supabase Auth | Entra External ID descontinuado/complexo |
| Auto-provisioning | Não — binding lazy por email | Só entra quem foi explicitamente criado |
| Admin sem tenant | `tenant_id = NULL` | Admin é da plataforma, não de uma assessoria |
| Convite via | Supabase Admin API | Evita implementar SMTP próprio |
| SAS token | Gerado no backend | Nunca expor connection string ao cliente |
| `external_id` timing | Populado no primeiro login | Simplifica criação de usuário |
| Roles | Enum na coluna (4 valores fixos) | Sem necessidade de RBAC dinâmico para TCC |
| Guards | APP_GUARD global (NestJS) | Proteção automática, sem esquecer rotas |
| Tenant no JWT | Nunca | Sempre do banco — imutável e auditável |
