# Webhooks para o n8n (RN-08, BE-15, BE-16)

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

Desfazer uma mudança de etapa no Log de Ações também é uma mudança de etapa (RN-08): vai pelo `stage-change`, com o `event_type` da etapa para onde o processo voltou e `undo: true`.

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
- `undo: true` aparece só quando a mudança veio do "desfazer" do Log de Ações.

## Assinatura (BE-16)

Os webhooks levam dados pessoais (e-mail, telefone). Para o n8n saber que a chamada veio mesmo do Flui:

- `X-Flui-Timestamp`: segundos desde 1970 (UTC).
- `X-Flui-Signature`: `sha256=<HMAC-SHA256 em hex de "<timestamp>.<corpo>" com o WEBHOOK_SECRET>`.

O timestamp entra na assinatura para o n8n recusar requisições antigas reenviadas (replay). Sem `WEBHOOK_SECRET` o backend envia sem assinatura e avisa no log ao subir em produção.

Os workflows versionados (abaixo) já trazem essa validação no nó **Validar assinatura (HMAC)**, logo depois do Webhook. A lógica é esta:

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

## Workflows versionados (RN-08)

Ficam em [`infra/n8n/workflows/`](../infra/n8n/workflows) e são importados no n8n como estão:

| Arquivo | Caminho | O que faz |
|---|---|---|
| `flui-stage-change.json` | `stage-change` | Webhook → Validar assinatura → **Ponto do fluxo** (Switch por `event_type`: recusa de crédito, análise bancária, pendência, assinatura, emissão e "outras etapas") → mensagem de cada ponto → Enviar e-mail. A pendência gera dois e-mails, cliente e analista. |
| `flui-documents-requested.json` | `documents-requested` | Webhook → Validar assinatura → lista dos documentos pedidos → Enviar e-mail ao cliente. |

Um pedido sem assinatura válida, ou com mais de 5 minutos, para no nó de validação: a execução fica com erro no n8n e nenhum e-mail sai. O "desfazer" (`undo: true`) troca o texto por "seu processo voltou para a etapa X".

### Configurar

1. Gerar um segredo: `openssl rand -hex 32`.
2. Backend: `WEBHOOK_SECRET` com esse valor e `N8N_WEBHOOK_BASE_URL` com o endereço do n8n. Azure: App Service `flui-api-dev` → Configuração → Variáveis de ambiente (ou no Key Vault, INFRA-17). Local: `.env.local` da raiz.
3. n8n:
   - **Local (Docker):** com o `WEBHOOK_SECRET` no `.env.local`, `docker compose --env-file ../../.env.local up -d n8n` em `infra/docker`. O compose já libera o módulo `crypto` e a leitura do segredo no nó Code.
   - **n8n Cloud:** não há variáveis de ambiente. Depois de importar, troque o texto `COLE_AQUI_O_WEBHOOK_SECRET` no nó "Validar assinatura (HMAC)" de cada workflow pelo segredo. Não versione o workflow com o segredo.
4. Criar uma credencial **SMTP** com o nome `Flui SMTP (Brevo)` (Brevo: `smtp-relay.brevo.com`, porta 587, usuário e chave SMTP da conta) e escolher essa credencial no nó "Enviar e-mail" de cada workflow, se o n8n não ligar sozinho. O remetente (`noreply@fluicontratos.com.br`) precisa estar validado no Brevo.
5. Importar os dois arquivos (menu **Import from file** do editor, ou pela CLI) e publicar:

```bash
docker cp infra/n8n/workflows/flui-stage-change.json docker-n8n-1:/tmp/
docker cp infra/n8n/workflows/flui-documents-requested.json docker-n8n-1:/tmp/
docker exec docker-n8n-1 n8n import:workflow --input=/tmp/flui-stage-change.json
docker exec docker-n8n-1 n8n import:workflow --input=/tmp/flui-documents-requested.json
docker exec docker-n8n-1 n8n publish:workflow --id=FluiStageChange1
docker exec docker-n8n-1 n8n publish:workflow --id=FluiDocsRequest1
docker restart docker-n8n-1
```

Os IDs são fixos: importar de novo atualiza os workflows em vez de duplicar.

### Verificado em 12/10/2026 (ambiente local)

Backend real apontando para o n8n local com estes workflows e um SMTP de teste (Mailpit): 12 ações pela API (os 6 pontos, o "desfazer" e as etapas sem ponto próprio) geraram 13 e-mails, com a pendência avisando cliente e analista. Um pedido assinado com segredo errado e outro reenviado com 10 minutos de atraso pararam na validação, sem e-mail.

## Testes

`backend/src/processes/webhooks.integration.spec.ts` sobe um servidor HTTP no lugar do n8n e confere, pelo `WebhookService` real, cada um dos 6 pontos (`event_type`, `process_id`, `tenant_id`, `timestamp`), o disparo duplo da pendência, o "desfazer" do Log de Ações (`undo: true`) e a assinatura (inclusive que um corpo alterado não confere).
