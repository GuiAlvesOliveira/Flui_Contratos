# Flui_Contratos

Plataforma SaaS multi-tenant para a gestão de processos de financiamento imobiliário em assessorias (TCC — FECAP).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `backend/` | API NestJS + TypeORM (PostgreSQL), com `package.json` próprio |
| `frontend/` | React + Vite + Tailwind CSS v4, com `package.json` próprio |
| `infra/` | Docker Compose do ambiente local, seed do banco e scripts da Azure |

O `package.json` da raiz não tem dependências: só reúne atalhos que chamam os scripts de cada parte.

## Como rodar (a partir da raiz)

```bash
npm run install:all     # npm ci no backend e no frontend
npm run infra:up        # Postgres, n8n e Azurite (lê o .env.local da raiz)
npm run migration:run   # aplica as migrations no banco local
npm run dev:backend     # API em http://localhost:3000
npm run dev:frontend    # app em http://localhost:5173
```

| Script | O que faz |
|---|---|
| `npm run build` | build do backend e do frontend (`build:backend` / `build:frontend` para um só) |
| `npm test` | testes unitários e e2e do backend |
| `npm run test:cov` | testes unitários com o gate de cobertura do CI |
| `npm run check` | build + testes (o que o CI exige antes do deploy) |
| `npm run lint` | ESLint do backend (sem `--fix`) e do frontend; ainda acusa erros de formatação antigos |
| `npm run infra:ps` / `infra:down` | estado / parada dos containers locais (os volumes são mantidos) |

O seed de desenvolvimento (`infra/db/seed.sql`) é aplicado à parte, depois das migrations.
