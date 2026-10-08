# Métricas de uso (VAL-04)

Eventos de uso enviados ao **Application Insights** (`flui-insights-dev`, tabela `customEvents`) para acompanhar a adoção do Flui e montar um funil básico: **entrou no app → criou processo → avançou etapa**.

## Como funciona

- As rotas que contam como uso levam o decorator `@TrackUsage(...)` (`backend/src/common/decorators/track-usage.decorator.ts`).
- O `UsageTelemetryInterceptor` (global) envia o evento **só quando a requisição dá certo**; erro não conta como uso.
- O `TelemetryService` não faz nada sem `APPLICATIONINSIGHTS_CONNECTION_STRING` (ambiente local e testes). Se o envio falhar, a requisição segue normalmente.
- O App Insights é iniciado em `backend/src/telemetry-init.ts`, **o primeiro import do `main.ts`**. Isso é necessário para que as requisições HTTP também sejam coletadas: antes, o setup rodava depois de o Express ser carregado e nenhuma requisição chegava ao App Insights.

## Eventos

| Evento | Quando | Dimensões além de `tenantId`, `userId`, `role` |
|---|---|---|
| `login` | `GET /me` — o app chama ao entrar (login ou sessão retomada) | — |
| `process_created` | `POST /processes` | — |
| `stage_changed` | `PATCH /processes/:id/stage` (botão, arrastar no Kanban, novo processo pela coluna) | `fromStage`, `toStage` |
| `document_uploaded` | `POST /documents/:id/upload` | — |
| `form_submitted` | `PUT /processes/:id/forms/dps` ou `/financiamento` | `form` |

**Privacidade (LGPD):** os eventos levam só ids internos (`tenantId`, `userId`), o papel e as etapas. Nada de nome, e-mail, CPF ou conteúdo de documento/formulário.

## Consultas (App Insights → Logs)

Funil dos últimos 30 dias, por usuário da equipe:

```kusto
customEvents
| where timestamp > ago(30d) and name in ('login', 'process_created', 'stage_changed')
| extend userId = tostring(customDimensions.userId), role = tostring(customDimensions.role)
| where role in ('dono', 'analista')
| summarize entrou = countif(name == 'login') > 0,
            criou = countif(name == 'process_created') > 0,
            avancou = countif(name == 'stage_changed') > 0 by userId
| summarize ['1. Entrou no app'] = countif(entrou),
            ['2. Criou processo'] = countif(entrou and criou),
            ['3. Avançou etapa'] = countif(entrou and avancou)
```

Uso por dia e por evento:

```kusto
customEvents
| where timestamp > ago(30d)
| summarize total = count() by name, dia = bin(timestamp, 1d)
| render columnchart
```

Para onde os processos estão andando:

```kusto
customEvents
| where timestamp > ago(30d) and name == 'stage_changed'
| summarize total = count() by destino = tostring(customDimensions.toStage)
| order by total desc
```

Assessorias ativas (pelo menos um login no período):

```kusto
customEvents
| where timestamp > ago(30d) and name == 'login'
| summarize usuarios = dcount(tostring(customDimensions.userId)), acessos = count() by tenantId = tostring(customDimensions.tenantId)
```

Pelo terminal (Azure CLI, só leitura):

```bash
az monitor app-insights query --app <appId do flui-insights-dev> --analytics-query "customEvents | where timestamp > ago(7d) | summarize total=count() by name"
```
