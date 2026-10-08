# ADR 0006 — Automação desacoplada via n8n, com webhooks *fire-and-forget*

**Status:** Aceito · **Regras:** RN-08, RN-09 · **Itens:** BE-15, BE-16

## Contexto
As notificações ao cliente (e-mail, SMS) não podem travar nem derrubar a mudança de etapa de um processo.

## Decisão
O `WebhookService` dispara eventos para o n8n de forma *fire-and-forget*, depois que a transação do processo foi gravada; o n8n orquestra as notificações fora do caminho da requisição.

## Consequências
Falha de notificação não afeta o núcleo, e as automações mudam sem redeploy. A entrega é de melhor esforço; o mapeamento dos gatilhos e a assinatura das chamadas são os itens BE-15 e BE-16.
