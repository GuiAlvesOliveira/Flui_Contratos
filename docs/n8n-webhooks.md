# Webhooks para o n8n (BE-15, BE-16)

O backend avisa o n8n por webhook (`POST <N8N_WEBHOOK_BASE_URL>/webhook/<caminho>`) a cada mudança de etapa e a cada pedido de documentos. O n8n cuida das notificações ao cliente (e-mail/SMS). O envio nunca bloqueia a operação: se o n8n estiver fora, a mudança de etapa acontece do mesmo jeito e a falha vai para o log (REL-01).

## Os 6 pontos do fluxo (`fluxo_processo.md`)

| Ponto | Caminho | `event_type` | Quando |
|---|---|---|---|
| Solicitação de documentos | `documents-requested` | `documents_requested` | analista pede documentos da lista da assessoria |
| Notificação de recusa | `stage-change` | `credit_refused` | entrada em Crédito Recusado |
| Atualização de análise bancária | `stage-change` | `bank_analysis` | entrada em Análise de Crédito ou Crédito Aprovado |
| Alertas de pendências (disparo duplo) | `stage-change` | `pending_alert` | entrada em Pendência — avisa cliente **e** analista |
| Notificações de assinatura | `stage-change` | `signature` | entrada em Assinatura |
| Triggers de emissão | `stage-change` | `issuance` | entrada em Análise Jurídica, Jurídico Aprovado ou Cartório |

As demais mudanças (Primeiro Contato, Cadastro, Inativo) vão como `stage_changed`.

## Payload

Todo webhook tem o envelope `event_type`, `process_id`, `tenant_id` e `timestamp` (ISO 8601). Os campos que já existiam continuam iguais, para não quebrar os fluxos montados antes.

```json
{
  "event_type": "pending_alert",
  "process_id": "03925c99-…",
  "tenant_id": "a0000000-…",
  "timestamp": "2026-10-08T19:40:00.000Z",
  "processId": "03925c99-…",
  "tenantId": "a0000000-…",
  "fromStage": "cadastro",
  "toStage": "processo_pendencia",
  "actorId": "…",
  "clientId": "…",
  "clientName": "Helena",
  "clientEmail": "helena@…",
  "clientPhone": "11…",
  "recipients": ["cliente", "analista"],
  "analistaName": "Rafael",
  "analistaEmail": "rafael@…",
  "analistaPhone": "11…"
}
```

- `recipients` diz quem deve ser avisado; só a pendência tem `["cliente", "analista"]` e os campos `analista*`.
- `documents-requested` traz `labels` (nomes dos documentos pedidos) no lugar de `fromStage`/`toStage`.

## Assinatura (BE-16)

Os webhooks levam dados pessoais (e-mail, telefone). Para o n8n saber que a chamada veio mesmo do Flui:

- `X-Flui-Timestamp`: segundos desde 1970 (UTC).
- `X-Flui-Signature`: `sha256=<HMAC-SHA256 em hex de "<timestamp>.<corpo>" com o WEBHOOK_SECRET>`.

O timestamp entra na assinatura para o n8n recusar requisições antigas reenviadas (replay). Sem `WEBHOOK_SECRET` o backend envia sem assinatura e avisa no log ao subir em produção.

### Configurar

1. Gerar um segredo: `openssl rand -hex 32`.
2. Azure: App Service `flui-api-dev` → Configuração → Variáveis de ambiente → `WEBHOOK_SECRET` (ou depois no Key Vault, INFRA-17).
3. n8n: guardar o mesmo valor como credential/variável `WEBHOOK_SECRET`.
4. Em cada workflow, logo depois do nó Webhook (com a opção **Raw Body** ligada, quando disponível), um nó **Code** que valida:

```js
const crypto = require('crypto');
const item = $input.first().json;
const headers = item.headers;
const secret = $env.WEBHOOK_SECRET; // ou o valor da credential
const ts = headers['x-flui-timestamp'];
const body = JSON.stringify(item.body); // o corpo enviado é JSON compacto, sem espaços
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
const got = headers['x-flui-signature'] || '';
const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300; // 5 minutos
if (!fresh || got.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
  throw new Error('Webhook sem assinatura válida do Flui');
}
return $input.all();
```

5. Criar no n8n o workflow do caminho `documents-requested` (novo); enquanto ele não existir, o n8n responde 404 e o backend só registra o aviso no log.

## Testes

`backend/src/processes/webhooks.integration.spec.ts` sobe um servidor HTTP no lugar do n8n e confere, pelo `WebhookService` real, cada um dos 6 pontos (`event_type`, `process_id`, `tenant_id`, `timestamp`), o disparo duplo da pendência e a assinatura (inclusive que um corpo alterado não confere).
