# ADR 0006 — Automação desacoplada via n8n, com webhooks *fire-and-forget*

**Status:** Aceito · **Regras:** RN-08, RN-09 · **Itens:** BE-15, BE-16

## Contexto
As notificações ao cliente (e-mail, SMS) não podem travar nem derrubar a mudança de etapa de um processo.

## Decisão
O `WebhookService` dispara eventos para o n8n de forma *fire-and-forget*, depois que a transação do processo foi gravada; o n8n orquestra as notificações fora do caminho da requisição.

## Consequências
Falha de notificação não afeta o núcleo, e as automações mudam sem redeploy. A entrega é de melhor esforço.

- **BE-15:** todo webhook leva `event_type`, `process_id`, `tenant_id` e `timestamp`. Os 6 pontos do fluxo (documentos solicitados, recusa, análise bancária, pendência com disparo duplo, assinatura e emissão) têm cada um o seu `event_type`.
- **BE-16:** cada chamada é assinada com HMAC-SHA256 (`X-Flui-Signature`) de `"<timestamp>.<corpo>"` com o `WEBHOOK_SECRET`, para o n8n conferir a origem e recusar reenvios antigos.

Detalhes em [`docs/n8n-webhooks.md`](../n8n-webhooks.md).
