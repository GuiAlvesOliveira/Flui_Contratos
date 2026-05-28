# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Flui Contratos is a multi-tenant SaaS platform for managing real estate financing (financiamento imobiliário) processes at Brazilian advisory firms (assessorias imobiliárias). TCC project at FECAP by Guilherme Alves de Oliveira e Oliveira and João Pedro Lima Paulo.

The core UI is a Kanban board mirroring the actual financing pipeline:

**Cadastro → Análise de Crédito → Análise Jurídica → Vistoria → Contrato → Cartório**

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + Tailwind CSS + React Query |
| Backend | NestJS + TypeScript |
| Database | Azure Database for PostgreSQL |
| File storage | Azure Blob Storage |
| Auth | Supabase Auth |
| Hosting | Azure App Service (API) + Azure Static Web Hosting (frontend) |
| Automation | n8n (webhook-driven, decoupled service) |
| Monitoring | Azure Application Insights |

## Architecture

**Client-Server + layered MVC + SOA for automation.**

- React (View) ↔ NestJS controllers (Controller) ↔ PostgreSQL entities (Model)
- n8n runs as an independent service; NestJS fires webhooks on Kanban status changes to trigger automated client notifications
- Multi-tenant: each assessoria company is a fully isolated tenant (shared database, row-level isolation by tenant ID)

## User Roles

- **Super Admin** — full platform control, manages tenant onboarding, this management is going to be on cloud's azure portal, not on the project itself
- **CEO/Gestor** — strategic dashboards, team management, read-only process visibility
- **Analista** — operational: create clients, move Kanban cards, manage document checklists
- **Cliente** — restricted portal: view own process timeline, upload documents, receive notifications

## Critical Business Rules

These rules affect how features must be implemented — do not skip or soften them:

- **RN-01/RN-02**: Full data isolation between tenants. Never leak cross-tenant data.
- **RN-04**: A financing process **cannot advance** to the next Kanban stage unless all mandatory documents for the current stage are validated. Gate this at the API level, not just the UI.
- **RN-05**: Every financing must include MIP and DFI insurance fields.
- **RN-06**: Income composition = sum of all participants' declared income (multiple participants per process).
- **RN-07**: Full audit trail — every process status change must be logged with timestamp, actor, and previous/new state.
- **RN-08/RN-09**: Every Kanban status change fires a webhook to n8n, which handles client notifications (SMS/email). This must be reliable; treat it as a side-effect of every stage transition.

## Development Commands

```bash
# ── Local infrastructure (run first) ──────────────────────────
cd infra/docker
docker compose --env-file ../../.env.local up -d

# ── Backend (NestJS + TypeScript) ─────────────────────────────
cd backend
npm install
npm run start:dev  # dev server with watch (port 3000)
npm run build      # compile TypeScript
npm run lint       # ESLint
npm run test       # unit tests
npm run test:e2e   # end-to-end tests

# ── Frontend (React + Vite + Tailwind CSS v4) ─────────────────
cd frontend
npm install
npm run dev        # dev server (port 5173)
npm run build      # production build (tsc + vite)
npm run lint       # ESLint
```

## Key Architecture Notes

- `backend/src/auth/supabase.guard.ts` — global APP_GUARD. Validates Supabase JWT via `SUPABASE_JWT_SECRET` (HS256). Extracts `sub` and `email` from token. Respects `@Public()`.
- `backend/src/common/guards/tenant.guard.ts` — global APP_GUARD, runs after SupabaseGuard. Looks up user by `external_id` in PostgreSQL, enriches `request.user` with `{ tenantId, role, userId, name }`. 60s in-memory cache. Respects `@Public()`.
- `backend/src/common/guards/roles.guard.ts` — use with `@Roles('ceo' | 'analista' | 'cliente')` decorator on controller methods.
- `backend/src/tenants/tenant.entity.ts` + `backend/src/users/user.entity.ts` — TypeORM entities mapping existing DB tables (created by `infra/db/seed.sql`).
- `GET /health` — public (`@Public()` decorator), no auth required.
- `GET /me` — protected. Returns `{ id, name, email, role, tenantId }` from DB lookup.
- `frontend/src/auth/supabaseClient.ts` — Supabase client singleton, reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `frontend/src/auth/useAuth.ts` — subscribes to Supabase auth state; calls `GET /me` after login to get role/tenantId from API.
- `frontend/src/api/axiosInstance.ts` — attaches Bearer token from `supabase.auth.getSession()` on every request.
- `frontend/src/pages/LoginPage.tsx` — email/password login form using `supabase.auth.signInWithPassword`.
- Tailwind CSS v4 (no `tailwind.config.js`) — configured via `@tailwindcss/vite` plugin in `vite.config.ts`. CSS entry: `@import "tailwindcss"`.

## Environment

- `.env.local` at project root (git-ignored) — loaded by backend via `envFilePath: ['../.env.local']`
- `frontend/.env.local` (git-ignored) — loaded by Vite; contains `VITE_*` vars
- Backend needs: `SUPABASE_JWT_SECRET` (from Supabase Dashboard → Project Settings → API → JWT Secret)
- Frontend needs: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (from Supabase Dashboard → Project Settings → API)
- Multi-tenancy: `tenant_id` and `role` are NEVER in the JWT — always resolved from PostgreSQL by `external_id` (Supabase user UUID)
