# ADR 0007 — Migrations idempotentes + seed como contrato de "banco recriável"

**Status:** Aceito

## Contexto
O time e a banca precisam recriar o banco do zero, de forma confiável, em qualquer máquina.

## Decisão
Todo DDL vive em migrations TypeORM idempotentes (`IF NOT EXISTS`), executadas no boot da API (`migrationsRun: true`) e pela CLI (`npm run migration:run`). O `infra/db/seed.sql` popula só dados de desenvolvimento, depois das migrations.

## Consequências
Ambiente reprodutível e deploy sem passo manual de schema. Uma migration com erro derruba o boot da API: toda migration nova é testada antes numa cópia descartável do banco local (aplicar, reverter e aplicar de novo).
