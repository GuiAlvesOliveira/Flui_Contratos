# ADR 0004 — Enum de etapas unificado, com constraint no banco como fonte da verdade

**Status:** Aceito

## Contexto
O Kanban do protótipo e o fluxo real da assessoria divergiam nos nomes das etapas, e o `seed.sql` tinha constraints que divergiam do código.

## Decisão
Definir os 11 estados canônicos em `ProcessStage` (TypeScript) — 8 do caminho linear (Primeiro Contato → Assinatura) e 3 laterais (Inativo, Crédito Recusado, Pendência) — e espelhá-los num CHECK constraint criado pela migration `UnifyProcessStages`, que remapeia dados antigos antes de aplicar a constraint. As transições permitidas ficam em `ALLOWED_TRANSITIONS`, espelhadas no frontend só para oferecer os movimentos válidos.

## Consequências
Banco e código não divergem; qualquer valor inesperado é barrado. Criar uma etapa exige migration, atualização do enum e das transições, nos dois lados.
