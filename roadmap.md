# Flui Contratos — Roadmap & Status

> Documento de contexto para novas sessões. Atualizar ao fim de cada fase.
> Última atualização: 2026-05-01

---

## Estado Atual: Phase 3 ✅ Concluída — próxima: Phase 4

### O que existe no repositório agora

```
flui-contratos/
├── backend/                          # NestJS 11 + TypeScript
│   ├── src/
│   │   ├── main.ts                   # bootstrap: ValidationPipe, CORS
│   │   ├── app.module.ts             # ConfigModule + TypeORM + módulos
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── jwt.strategy.ts       # JWKS dinâmico, extrai claims do token
│   │   │   └── jwt-auth.guard.ts
│   │   ├── common/
│   │   │   ├── guards/
│   │   │   │   ├── tenant.guard.ts   # 401/403 por tenant_id e role ausentes
│   │   │   │   └── roles.guard.ts    # verifica role vs @Roles()
│   │   │   └── decorators/
│   │   │       ├── roles.decorator.ts  # @Roles('ceo'|'analista'|'cliente')
│   │   │       └── public.decorator.ts # @Public() — sem auth
│   │   ├── health/
│   │   │   └── health.controller.ts  # GET /health → { status: "ok" }
│   │   └── me/
│   │       └── me.controller.ts      # GET /me → { externalId, email, tenantId, role }
│   └── package.json                  # NestJS 11, TypeORM, passport-jwt, jwks-rsa
│
├── frontend/                         # React 19 + Vite 8 + TypeScript
│   ├── src/
│   │   ├── main.tsx                  # <AuthProvider> wrappa o app
│   │   ├── App.tsx                   # delega para <AppRouter>
│   │   ├── index.css                 # @import "tailwindcss" (Tailwind v4)
│   │   ├── auth/
│   │   │   ├── msalConfig.ts         # PublicClientApplication (MSAL v5)
│   │   │   ├── AuthProvider.tsx      # MsalProvider + QueryClientProvider
│   │   │   └── useAuth.ts            # login, logout, tenantId, role, isAuthenticated
│   │   ├── api/
│   │   │   └── axiosInstance.ts      # acquireTokenSilent → Bearer header
│   │   ├── router/
│   │   │   └── AppRouter.tsx         # redirect por role: /ceo /analista /cliente
│   │   └── pages/
│   │       ├── ComingSoon.tsx        # placeholder por módulo
│   │       └── Forbidden.tsx         # página 403
│   ├── vite.config.ts                # plugin: @tailwindcss/vite + react
│   └── package.json                  # React 19, MSAL v5, React Query v5, React Router v7
│
├── infra/
│   ├── docker/
│   │   └── docker-compose.yml        # postgres:16 + n8nio/n8n + azurite
│   ├── azure/
│   │   ├── provision.sh              # script idempotente de provisionamento Azure
│   │   └── env.azure.template        # template de variáveis cloud
│   └── db/
│       └── seed.sql                  # schema tenants+users + seed de dev (idempotente)
│
├── .env.local                        # git-ignored — criado em 2026-04-30
├── .env.local.template               # template documentado (inclui JWKS_URI)
├── .gitignore
├── CLAUDE.md                         # instruções permanentes para o Claude Code
├── implementation_plan.md
└── roadmap.md                        # este arquivo
```

---

## Fases — Visão Geral

| Fase | Descrição | Status |
|---|---|---|
| **0** | Monorepo, Docker Compose, seed SQL, templates | ✅ Concluída |
| **1** | Infraestrutura Azure (`flui-dev`) via `provision.sh` | ⬜ Pendente |
| **2** | Scaffolding NestJS + React/Vite, health endpoint | ✅ Concluída |
| **3** | Multi-tenant + autenticação Entra External ID | ✅ Concluída |
| **4** | Módulos protegidos por papel (CEO, Analista, Cliente) + deploy dev Azure | ⬜ Pendente |

---

## Phase 0 ✅ — Decisões tomadas

- `docker-compose.yml` carrega variáveis via `--env-file .env.local` (não hardcoded).
- Azurite expõe as 3 portas padrão: 10000 (Blob), 10001 (Queue), 10002 (Table).
- `seed.sql` inclui `CREATE TABLE IF NOT EXISTS` e `ON CONFLICT DO NOTHING` — seguro de re-executar.
- `external_id` nos usuários seed são placeholders (`dev-external-id-*`) — serão substituídos pelos `sub` claims reais do Entra na Fase 3 (ainda pendente: IDs reais não foram atribuídos).
- `provision.sh` é idempotente: usa `az ... create` com `|| log "already exists"` em cada recurso.

### Como subir o ambiente local

```bash
# Subir os 3 serviços Docker
cd infra/docker
docker compose --env-file ../../.env.local up -d

# Verificar saúde
docker compose ps
# postgres: healthy | n8n: running | azurite: running

# Rodar o seed (substituir <container> pelo nome real)
docker exec -i <postgres-container> psql -U flui_admin -d flui_contratos_dev \
  < ../../infra/db/seed.sql
```

**Portas locais:**
| Serviço | Porta | Acesso |
|---|---|---|
| PostgreSQL | 5432 | `psql -h localhost -U flui_admin -d flui_contratos_dev` |
| n8n UI | 5678 | http://localhost:5678 (basic auth: admin / senha do .env.local) |
| Azurite Blob | 10000 | connection string no .env.local |

---

## Phase 1 ⬜ — O que precisa ser feito

**Executar `infra/azure/provision.sh`** após fazer login na Azure CLI:

```bash
az login
az account set --subscription <subscription-id>
bash infra/azure/provision.sh
```

Recursos que o script cria no resource group `flui-dev` (Brazil South):
- PostgreSQL Flexible Server (Burstable B1ms, PostgreSQL 16, SSL, acesso público desabilitado)
- Storage Account + container `documentos` (LRS, soft delete 30 dias, acesso público off)
- App Service Plan B1 (Linux) + Web App Node 20 (backend)
- Azure Static Web App Free tier (frontend)
- Log Analytics Workspace + Application Insights (workspace-based)
- Key Vault (senha do PostgreSQL armazenada aqui)

**Após o script:**
- Preencher `infra/azure/env.azure.template` → salvar como `.env.azure`
- Verificar Application Insights heartbeat

**Entra External ID — já configurado (feito antes da Phase 2):**

O tenant Entra External ID já existe e as app registrations estão criadas. Valores fixos:

| Variável | Valor |
|---|---|
| `ENTRA_TENANT_ID` | `1bedf64d-a679-4ea7-a9b0-8c971809fe8b` |
| `ENTRA_CLIENT_ID` | `2a392769-15f1-4dbc-b27c-c7444c39542e` |
| `ENTRA_AUDIENCE` | `api://2a392769-15f1-4dbc-b27c-c7444c39542e` |
| `ENTRA_ISSUER` | `https://fluicontratosoutlook.ciamlogin.com/1bedf64d-a679-4ea7-a9b0-8c971809fe8b/v2.0` |
| `JWKS_URI` | `https://fluicontratosoutlook.ciamlogin.com/1bedf64d-a679-4ea7-a9b0-8c971809fe8b/discovery/v2.0/keys` |
| `VITE_MSAL_AUTHORITY` | `https://fluicontratosoutlook.ciamlogin.com/1bedf64d-a679-4ea7-a9b0-8c971809fe8b` |
| `VITE_MSAL_SCOPE` | `api://2a392769-15f1-4dbc-b27c-c7444c39542e/access_as_user` |

**Ainda pendente da Phase 1/3:**
- Preencher `ENTRA_CLIENT_SECRET` em `.env.local` com o secret real do Azure Portal
- Criar os 3 usuários seed no Entra com custom attribute `tenant_id = 00000000-0000-0000-0000-000000000001`
- Atualizar `external_id` em `seed.sql` com os `sub` claims reais desses usuários

---

## Phase 2 ✅ — O que foi feito (2026-04-30)

### Backend — NestJS 11

Scaffold via `@nestjs/cli new . --package-manager npm --skip-git`.

**Dependências adicionadas:**
```
@nestjs/config  @nestjs/typeorm  typeorm  pg
@nestjs/passport  passport  passport-jwt  jwks-rsa
@types/passport-jwt
```

**Decisões:**
- `ConfigModule.forRoot({ envFilePath: ['../.env.local', '.env.local'], expandVariables: true, isGlobal: true })` — carrega do root do projeto quando rodando de `backend/`; `expandVariables: true` expande referências `${VAR}` dentro do arquivo.
- `TypeORM` configurado com `synchronize: false` (migrations only), SSL condicional por `NODE_ENV`.
- `ValidationPipe({ whitelist: true })` global.
- CORS habilitado para `http://localhost:5173` (variável `FRONTEND_URL` sobrescreve em prod).
- Arquivos de scaffold removidos: `app.controller.ts`, `app.service.ts`, `app.controller.spec.ts`.

**Endpoints implementados:**
- `GET /health` — sem auth, retorna `{ status: "ok" }`.
- `GET /me` — requer JWT válido com `tenant_id` e `role`, retorna claims do token sem consultar o banco.

### Frontend — React 19 + Vite 8

Scaffold via `npm create vite@latest . -- --template react-ts`.

**Dependências adicionadas:**
```
tailwindcss @tailwindcss/vite @tanstack/react-query
@azure/msal-react @azure/msal-browser axios react-router-dom
```

**Decisão crítica — Tailwind CSS v4:**
O npm instalou Tailwind v4 (não v3). V4 é completamente diferente:
- **Sem `tailwind.config.js`** — configuração via CSS ou plugin
- Usa `@tailwindcss/vite` como plugin no `vite.config.ts` (não PostCSS)
- CSS entry: `@import "tailwindcss"` (não `@tailwind base/components/utilities`)

**Versões instaladas relevantes:**
- MSAL Browser/React: v5 (quebra de API em relação a v2/v3 — ver Phase 3)
- React Router: v7
- React Query: v5

---

## Phase 3 ✅ — O que foi feito (2026-04-30)

### Backend — autenticação e guards

**`jwt.strategy.ts`:**
- Valida JWTs via JWKS dinâmico (busca chaves públicas de `JWKS_URI` em runtime, com cache)
- Authority: `fluicontratosoutlook.ciamlogin.com` (Entra External ID CIAM — **não** `login.microsoftonline.com`)
- Valida `issuer` e `audience` contra env vars
- Extrai do payload: `sub → externalId`, `email`, `tenant_id → tenantId`, `role`
- `tenant_id` e `role` são custom attributes do Entra — precisam estar configurados no user flow para aparecerem no access token

**`tenant.guard.ts`** (aplicado após `JwtAuthGuard`):
- 401 se não há `request.user` (token inválido/ausente)
- 403 se `tenantId` está vazio no payload (claim `tenant_id` ausente)
- 403 se `role` está vazio no payload (claim `role` ausente)
- `tenantId` e `role` **sempre** vêm do JWT — nunca de parâmetros do cliente

**`roles.guard.ts`:** usa `Reflector` para ler `@Roles()` e compara com `request.user.role`.

### Frontend — MSAL v5 + roteamento por role

**`msalConfig.ts` — decisões de MSAL v5:**
- `Configuration` deve ser importado como type: `import type { Configuration }`
- `CacheOptions` em v5 não tem `storeAuthStateInCookie` (removido) — só `cacheLocation: 'sessionStorage'`
- `knownAuthorities` recebe o hostname da authority (`fluicontratosoutlook.ciamlogin.com`) para que o MSAL aceite tokens desse issuer customizado

**`useAuth.ts`:**
- `tenantId` e `role` lidos de `account.idTokenClaims` (claims do ID token)
- Em produção, verificar se os custom attributes do Entra aparecem com os nomes exatos `tenant_id` e `role` no token — o Entra às vezes prefixa com `extension_`

**`AppRouter.tsx`:**
- Rota `/` chama `loginRedirect()` imediatamente se não autenticado
- Após login, redireciona por role: `ceo → /ceo`, `analista → /analista`, `cliente → /cliente`
- Role errado em rota protegida → `<Forbidden />` (403)
- Rotas desconhecidas → redirect para `/`

---

## Phase 4 ⬜ — O que precisa ser feito

### Pré-requisito

Antes de implementar Phase 4, o backend precisa conectar ao banco. Para isso:
1. Subir Docker (`docker compose up -d`)
2. Rodar `seed.sql`
3. Garantir que `ENTRA_CLIENT_SECRET` está preenchido em `.env.local`
4. Testar `GET /health` (200) e `GET /me` com token real (200 com claims)

### Backend — entidades TypeORM + endpoint stubs

**Entidades a criar** (todas com `tenant_id`, `created_at`, `updated_at`):
- `Tenant` — id, name, slug, active
- `User` — id, tenant_id, external_id, role, name, email, active
- `Process` — id, tenant_id, stage, mip_insurance, dfi_insurance, total_income
- `ProcessParticipant` — id, process_id, name, declared_income
- `Document` — id, process_id, tenant_id, stage, name, validated, blob_url
- `AuditLog` — id, process_id, tenant_id, actor_id, previous_stage, new_stage, timestamp

**Migration:** gerar via TypeORM CLI (`npm run typeorm migration:generate`), **não** usar `synchronize: true`.

**Endpoint stubs** (guards ativos, dados mock/vazios):
```
GET  /ceo/dashboard      → {}   (role: ceo)
GET  /ceo/team           → []   (role: ceo)
GET  /ceo/processes      → []   (role: ceo)

GET  /analista/kanban    → { stages: [], cards: [] }   (role: analista)
GET  /analista/clients   → []   (role: analista)
GET  /analista/documents → []   (role: analista)

GET  /cliente/process    → {}   (role: cliente)
GET  /cliente/timeline   → []   (role: cliente)
POST /cliente/documents  → 501  (role: cliente)
```

### Frontend — módulos com layout

Criar estrutura de módulos:
```
frontend/src/modules/
├── ceo/        # /ceo — sidebar: Dashboard, Equipe, Processos
├── analista/   # /analista — sidebar: Kanban, Clientes, Documentos
└── cliente/    # /cliente — header + Timeline, Documentos
```

Cada página do módulo renderiza `<ComingSoon />`. React Query hooks fazem chamadas aos stubs do backend.

### Deploy dev Azure

- Backend → Azure App Service via GitHub Actions (workflow a criar)
- Frontend → Azure Static Web App via GitHub Actions (auto-gerado pelo Azure ao linkar o repo)
- Ambos usam `.env.azure` como fonte de variáveis de produção

### Critérios de conclusão da Phase 4

- Login como cada usuário seed → cai na rota correta
- Acessar rota errada → 403
- Todas as chamadas stub retornam 200 com dados vazios (sem 401/403 indevidos)
- App rodando no Azure dev

---

## Regras de Negócio (referência rápida)

| Regra | Descrição | Onde implementar |
|---|---|---|
| RN-01/02 | Isolamento total entre tenants | `TenantGuard` (backend) — nunca no frontend |
| RN-04 | Processo não avança sem docs obrigatórios validados | `ProcessService.advanceStage()` — API level |
| RN-05 | Todo processo deve ter campos MIP e DFI (seguro) | DTO validation + constraint no DB |
| RN-06 | Renda = soma de todos os participantes | Campo computado em `ProcessService` |
| RN-07 | Audit trail completo de mudanças de estado | `AuditInterceptor` + entidade `AuditLog` |
| RN-08/09 | Toda mudança de etapa dispara webhook para n8n | `WebhookService` chamado em `advanceStage()` |

---

## Variáveis de ambiente — resumo completo

| Variável | `.env.local` (dev) | Observação |
|---|---|---|
| `POSTGRES_DB` | `flui_contratos_dev` | usado pelo Docker |
| `POSTGRES_USER` | `flui_admin` | usado pelo Docker |
| `POSTGRES_PASSWORD` | `FluiContratos2026FecapGJ!` | usado pelo Docker |
| `DATABASE_HOST` | `localhost` | |
| `DATABASE_PORT` | `5432` | |
| `DATABASE_NAME` | `flui_contratos_dev` | |
| `DATABASE_USER` | `flui_admin` | |
| `DATABASE_PASSWORD` | `FluiContratos2026FecapGJ!` | |
| `DATABASE_URL` | `postgresql://flui_admin:...@localhost:5432/flui_contratos_dev` | |
| `N8N_WEBHOOK_BASE_URL` | `http://localhost:5678` | |
| `AZURE_STORAGE_CONNECTION_STRING` | connection string Azurite | |
| `AZURE_STORAGE_CONTAINER_NAME` | `documentos` | |
| `ENTRA_TENANT_ID` | `1bedf64d-a679-4ea7-a9b0-8c971809fe8b` | fixo |
| `ENTRA_CLIENT_ID` | `2a392769-15f1-4dbc-b27c-c7444c39542e` | fixo |
| `ENTRA_CLIENT_SECRET` | `<preencher>` | **pendente** — buscar no Azure Portal |
| `ENTRA_AUDIENCE` | `api://2a392769-15f1-4dbc-b27c-c7444c39542e` | fixo |
| `ENTRA_ISSUER` | `https://fluicontratosoutlook.ciamlogin.com/.../v2.0` | fixo |
| `JWKS_URI` | `https://fluicontratosoutlook.ciamlogin.com/.../keys` | fixo — adicionado na Phase 3 |
| `VITE_API_BASE_URL` | `http://localhost:3000` | |
| `VITE_MSAL_CLIENT_ID` | `2a392769-15f1-4dbc-b27c-c7444c39542e` | fixo |
| `VITE_MSAL_AUTHORITY` | `https://fluicontratosoutlook.ciamlogin.com/...` | fixo |
| `VITE_MSAL_REDIRECT_URI` | `http://localhost:5173` | |
| `VITE_MSAL_SCOPE` | `api://2a392769-15f1-4dbc-b27c-c7444c39542e/access_as_user` | fixo |

Valores cloud ficam em `.env.azure` (git-ignored) e documentados em `infra/azure/env.azure.template`.

## Comandos de desenvolvimento

```bash
# ── Infraestrutura local (rodar antes do backend) ──────────────
cd infra/docker
docker compose --env-file ../../.env.local up -d

# ── Backend (porta 3000) ───────────────────────────────────────
cd backend
npm run start:dev   # dev com watch
npm run build       # compila TypeScript
npm run lint        # ESLint

# ── Frontend (porta 5173) ─────────────────────────────────────
cd frontend
npm run dev         # Vite HMR
npm run build       # tsc + vite build
npm run lint        # ESLint
```
