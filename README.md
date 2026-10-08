# Flui_Contratos

Plataforma SaaS multi-tenant para a gestão de processos de financiamento imobiliário em assessorias (TCC — FECAP).

**Documentação:** [Diagnóstico do MVP e Product Backlog](docs/diagnostico_backlog.md) · [Decisões de arquitetura (ADR)](docs/adr/README.md) · [Métricas de uso](docs/metricas-de-uso.md) · [Webhooks do n8n](docs/n8n-webhooks.md) · [Auditoria técnica](DIAGNOSTICO.md) · [Pendências de produção](PRODUCAO.md) · [Backlog no GitHub Projects](https://github.com/users/GuiAlvesOliveira/projects/2)

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `backend/` | API NestJS + TypeORM (PostgreSQL), com `package.json` próprio |
| `frontend/` | React + Vite + Tailwind CSS v4, com `package.json` próprio |
| `infra/` | Docker Compose do ambiente local, seed do banco e scripts da Azure |
| `docs/` | Diagnóstico, ADRs e demais documentos versionados |

O `package.json` da raiz não tem dependências: só reúne atalhos que chamam os scripts de cada parte.

## Rodando localmente

### 1. Pré-requisitos

- Node.js 20 ou superior (o CI usa o 24) e npm
- Docker Desktop (Postgres, n8n e Azurite rodam em containers)
- Um projeto no [Supabase](https://supabase.com) para o login (o plano gratuito basta)

### 2. Variáveis de ambiente

```bash
cp .env.local.template .env.local     # backend + docker compose (raiz)
```

Preencha no `.env.local`, em Supabase Dashboard → Project Settings → API: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_JWT_SECRET`. O resto já vem com valores para o ambiente local (Postgres na porta 5434, Azurite como armazenamento). O SMTP é opcional: sem ele, os e-mails só não são enviados.

Crie também o `frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:3000
VITE_SUPABASE_URL=<mesma URL do Supabase>
VITE_SUPABASE_ANON_KEY=<mesma anon key>
```

Os dois arquivos `.env.local` são ignorados pelo Git; nunca versione chaves.

### 3. Dependências, infraestrutura e banco

```bash
npm run install:all     # npm ci no backend e no frontend
npm run infra:up        # Postgres, n8n e Azurite (lê o .env.local da raiz)
npm run migration:run   # cria o schema no banco local
docker compose -f infra/docker/docker-compose.yml --env-file .env.local exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < infra/db/seed.sql
```

O seed cria uma assessoria de desenvolvimento e os usuários `gestor@fluicontratos.dev` (gestor), `analista@fluicontratos.dev` e `cliente@fluicontratos.dev`. Para entrar com eles, crie os mesmos e-mails em Supabase → Authentication → Users, com a senha que quiser: no primeiro login a API liga a conta do Supabase ao usuário do banco pelo e-mail.

### 4. Subir a aplicação

```bash
npm run dev:backend     # API em http://localhost:3000 (GET /health responde {"status":"ok"})
npm run dev:frontend    # app em http://localhost:5173
```

Abra http://localhost:5173 e entre com um dos usuários do passo 3.

### 5. Testes e verificações

| Script | O que faz |
|---|---|
| `npm test` | testes unitários e e2e do backend |
| `npm run test:cov` | testes unitários com o gate de cobertura do CI |
| `npm run build` | build do backend e do frontend (`build:backend` / `build:frontend` para um só) |
| `npm run check` | build + testes (o que o CI exige antes do deploy) |
| `npm run lint` | ESLint do backend (sem `--fix`) e do frontend; ainda acusa erros de formatação antigos |
| `npm run infra:ps` / `infra:down` | estado / parada dos containers locais (os volumes são mantidos) |

## Produção

| Parte | Onde roda | Como é publicada |
|---|---|---|
| API | Azure App Service (`flui-api-dev`, Linux, Node LTS) | GitHub Actions `deploy-backend.yml` a cada push na `main` que mexa no backend |
| Frontend | Vercel, em https://fluicontratos.com.br | Integração Git da Vercel, a cada push na `main` |
| Banco | Azure Database for PostgreSQL | as migrations rodam sozinhas no boot da API |
| Arquivos | Azure Blob Storage (container privado) | — |
| Login | Supabase Auth | — |

**Pipeline da API:** em pull request para a `main`, roda só os testes (unitários com cobertura mínima e e2e). Em push na `main`: testes → build → pacote `.zip` enviado ao Blob Storage → o App Service passa a rodar o pacote novo (`WEBSITE_RUN_FROM_PACKAGE`). O frontend também é compilado em todo PR.

**Configuração:**
- *App Service (Application settings):* as mesmas variáveis do backend do `.env.local`, com os valores de produção (banco da Azure, Supabase, Blob Storage, SMTP), mais `NODE_ENV=production`, `FRONTEND_URL` com os domínios do frontend separados por vírgula (CORS) e `APPLICATIONINSIGHTS_CONNECTION_STRING`.
- *Vercel (Environment Variables):* `VITE_API_BASE_URL`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
- *GitHub (Secrets do repositório):* `AZURE_CREDENTIALS`, `AZURE_WEBAPP_NAME`, `AZURE_STORAGE_CONN_STRING` e os três `VITE_*`.

**Problemas conhecidos:**
- *API devolvendo 503 sem mudança de código:* conferir a validade (`se=`) do link SAS em `WEBSITE_RUN_FROM_PACKAGE`; o pipeline gera um link de 1 ano a cada deploy.
- *Erro de CORS no navegador:* o domínio do frontend precisa estar em `FRONTEND_URL`.
- *Migration nova:* testar antes numa cópia descartável do banco local (aplicar, reverter e aplicar de novo); uma migration com erro impede a API de subir.
