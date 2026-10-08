# ADR 0005 — Gate de documentos (RN-04) aplicado na API

**Status:** Aceito · **Regra:** RN-04 · **Itens:** BE-03

## Contexto
O processo não pode avançar sem os documentos obrigatórios validados. É uma regra crítica e não pode depender do frontend.

## Decisão
- O avanço de etapa na API valida a transição e, a partir da Análise de Crédito, exige que todos os documentos do processo (e os pessoais do cliente) estejam validados. Um processo sem nenhum documento solicitado é bloqueado (falha fechada).
- Os documentos exigidos vêm da **Lista de Documentos da assessoria**: o gestor mantém a lista em Configurações, e o analista escolhe dela o que pedir em cada processo, sem campo livre (BE-03).

## Consequências
A regra vale mesmo para chamadas diretas à API, e a lógica fica centralizada e testada. A interface só reflete o que a API permite.
