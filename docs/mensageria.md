# Mensageria: e-mails automáticos do Flui (RN-08, RN-09, RN-10)

O próprio backend avisa o cliente (e, na pendência, o analista) a cada mudança de etapa, a cada pedido de documentos e a cada documento recusado. Até 13/10/2026 isso era feito pelo n8n; a decisão de trazer para o backend está no [ADR 0008](adr/0008-mensageria-propria-outbox.md).

## Como um e-mail sai

```
Ação na API (mover card, desfazer, pedir/recusar documento)
  └─ transação no PostgreSQL
       ├─ grava a mudança (processo / documento)
       ├─ grava o log de auditoria (RN-07)
       └─ grava a mensagem pronta na fila  message_outbox
            ├─ assessoria em "Com a minha liberação" (padrão) → status: held
            │     (espera o gestor liberar na tela E-mails do Log de Ações)
            └─ assessoria em "Automático" → status: pending
                        │
                        ▼  em ~0,3 s (aviso imediato) ou na próxima verificação (5 s)
OutboxWorker (dentro da API)  — só pega o que está pending
  ├─ respeita o limite diário da assessoria e o do servidor (o resto fica para amanhã)
  ├─ captura as mensagens devidas (FOR UPDATE SKIP LOCKED + reserva de 10 min)
  ├─ envia por SMTP (Brevo hoje; Azure Communication Services também serve)
  ├─ deu certo  → status: sent, sent_at
  └─ deu errado → nova tentativa em 30 s, 2 min, 10 min, 30 min, 2 h;
                  na 6ª falha → status: failed (fica no log da API)
```

- **A mensagem existe se, e somente se, a mudança foi gravada**: as duas entram na mesma transação. Se a gravação da fila falhar, a mudança de etapa inteira é desfeita.
- **O SMTP fora do ar não perde mensagem**: ela fica na fila e sai quando o servidor voltar.
- **Várias instâncias da API** podem rodar o worker ao mesmo tempo: o `SKIP LOCKED` faz cada mensagem ser capturada por uma só (testado no Postgres real com duas conexões simultâneas).
- **Sem SMTP configurado** (`SMTP_HOST/USER/PASS`), o worker não liga e as mensagens esperam na fila.

## O gestor controla o envio (tela E-mails do Log de Ações)

Ligar o SMTP não pode virar uma enxurrada de e-mails. Por isso o envio de cada assessoria fica nas mãos do gestor (`backend/src/messaging/outbox-admin.service.ts`, rotas `/messaging/*`, só para o perfil gestor):

- **Modo de envio** (`tenants.email_mode`):
  - `manual`, "Com a minha liberação" (padrão de toda assessoria): a mensagem é gravada na fila como sempre (RN-08), mas com status `held`. Só sai quando o gestor libera, uma a uma, as selecionadas ou todas.
  - `auto`, "Automático": a mensagem entra como `pending` e sai sozinha.
  - Voltar para manual **pausa na hora**: o que ainda não saiu vira `held`. Ligar o automático **não** libera o que estava retido.
- **Limite diário** (`tenants.email_daily_limit`, padrão 100, máximo 250): o worker nunca captura mais do que resta do dia (dia de Brasília). O que sobra fica para o dia seguinte, com o motivo visível na tela. Há também um teto do servidor somando todas as assessorias (`MESSAGING_DAILY_LIMIT`, padrão 250, abaixo da cota de 300/dia do Brevo gratuito).
- **Fila velha não é disparada**: mensagem `pending` há mais de `MESSAGE_MAX_AGE_HOURS` (48 h) ou `held` há mais de `MESSAGE_RETENTION_DAYS` vira `expired`. O gestor pode reenviar se ainda fizer sentido.
- **Cada mensagem tem uma situação**: `held` (aguardando liberação), `pending` (na fila), `sent`, `failed`, `cancelled` (cancelada pelo gestor), `expired`. O gestor pode ver o e-mail como o destinatário recebe, liberar, cancelar o que ainda não saiu e reenviar o que falhou, venceu ou foi cancelado. Uma mensagem já enviada não pode ser reenviada.
- **Tudo fica no Log de Ações** (RN-07): `email_sent`, `email_failed`, `email_released`, `email_cancelled`, `email_resent`, `email_expired` e `email_settings_updated`, com o processo, o assunto e o papel de quem recebe (o endereço não vai para o log). O cliente não vê esses registros na linha do tempo do processo.
- **Isolamento** (RN-01): toda consulta e toda ação é filtrada pela assessoria de quem chama; o gestor de uma assessoria não vê nem libera mensagem de outra.
- A migration `AddMessagingControl` passa para `held` tudo o que estava `pending` no momento do deploy: subir a versão não dispara nada acumulado.

Convite, redefinição de senha e o teste de e-mail saem na hora (são pedidos por uma pessoa e o link não pode ficar guardado), mas **contam no mesmo limite diário** e aparecem na tela do gestor, sem o conteúdo. Com o limite atingido eles não saem e ficam registrados como falha, com o motivo.

## Os 6 pontos do fluxo (`fluxo_processo.md`)

| Ponto | `event_type` | Quando | Destinatário |
|---|---|---|---|
| Solicitação de documentos | `documents_requested` | analista pede documentos da lista da assessoria | cliente |
| Notificação de recusa | `credit_refused` | entrada em Crédito Recusado | cliente |
| Atualização de análise bancária | `bank_analysis` | entrada em Análise de Crédito ou Crédito Aprovado | cliente |
| Alertas de pendências (disparo duplo) | `pending_alert` | entrada em Pendência | cliente **e** analista |
| Notificações de assinatura | `signature` | entrada em Assinatura | cliente |
| Triggers de emissão | `issuance` | entrada em Análise Jurídica, Jurídico Aprovado ou Cartório | cliente |

Além deles:

- `stage_changed`: as demais etapas (Primeiro Contato, Cadastro, Inativo).
- `document_rejected`: documento recusado, com a observação do analista.
- `process_stalled` (PROD-05_v2): alerta interno de **processo parado** há mais de `ESCALATION_DAYS` dias na mesma etapa (Assinatura, Inativo e Crédito Recusado não contam). Vai para o analista responsável; sem analista ativo, para os gestores da assessoria — nunca para o cliente. Um job diário (`backend/src/escalation`) grava o alerta em `process_escalations` e enfileira o e-mail na mesma transação, com uma trava por processo (`pg_advisory_xact_lock`): no máximo um alerta por processo a cada `ESCALATION_DAYS` dias, mesmo com mais de uma instância da API.
- **Desfazer** no Log de Ações é uma mudança de etapa: o cliente recebe "seu processo voltou para X".

Convite e redefinição de senha **não** passam pela fila: o link deles dá acesso à conta e não deve ficar gravado no banco. Continuam saindo direto pelo `EmailService`.

## O e-mail

Cada mensagem tem versão HTML e texto puro, com o nome da assessoria no rodapé e um botão para o portal (`FRONTEND_URL`, a primeira origem). Os textos ficam em `backend/src/messaging/message-templates.ts`; nomes, documentos e observações digitados por usuários são escapados no HTML.

## Configuração

| Variável | Padrão | Para que serve |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | — | servidor de envio (sem eles, nada é enviado) |
| `MESSAGING_POLL_MS` | `5000` | intervalo em que o worker olha a fila |
| `MESSAGE_RETENTION_DAYS` | `30` | mensagens enviadas, com falha, canceladas ou vencidas são apagadas depois disso (têm dados pessoais); o registro no Log de Ações permanece |
| `MESSAGING_DAILY_LIMIT` | `250` | teto de e-mails por dia somando todas as assessorias (o gestor ajusta o da própria assessoria na tela, até 250) |
| `MESSAGE_MAX_AGE_HOURS` | `48` | mensagem parada na fila há mais tempo que isso vence em vez de ser enviada |
| `MESSAGING_WORKER` | `on` | `off` deixa a instância só enfileirando, sem enviar |
| `ESCALATION_DAYS` | `7` | dias na mesma etapa para o alerta de processo parado (mesmo prazo do SLA do dashboard) |
| `ESCALATION_HOUR` | `8` | hora (Brasília) da verificação diária; se a API sobe entre essa hora e as 20h, verifica também 1 minuto depois do boot |
| `ESCALATION_ENABLED` | `on` | `off` desliga o alerta de processo parado nesta instância |

### Provedor: Brevo ou Azure Communication Services

O envio é SMTP puro, então trocar de provedor é só trocar as variáveis:

- **Brevo** (atual): `smtp-relay.brevo.com:587`. Plano gratuito: 300 e-mails/dia. A conta só aceita conexões dos IPs autorizados no painel (Segurança → IPs autorizados): os IPs de saída do App Service precisam estar lá, senão o envio falha com `525 5.7.1 Unauthorized IP address`. O remetente (`SMTP_FROM`) precisa estar validado na conta; com um remetente não validado o Brevo aceita a mensagem (250) e a descarta. O "Testar e-mail" do Log de Ações mostra o motivo da falha e o remetente usado.
- **Azure Communication Services** (`flui-contratos-comm` / `flui-email` já existem na assinatura): `smtp.azurecomm.net:587`, usuário SMTP criado a partir de um app do Entra ID. Com o domínio gerenciado pela Azure o limite é de 10 e-mails/hora, sem aumento; com o domínio `fluicontratos.com.br` verificado sobe para 100/hora (com aumento sob pedido). Custo: US$ 0,00025 por e-mail.

Nos dois casos, o remetente deve ser de um domínio autenticado (SPF e DKIM do `fluicontratos.com.br`) para os e-mails não caírem no spam: item INFRA-18.

## Consultas úteis

```sql
-- o que saiu e o que está pendente nas últimas 24 h
SELECT created_at, event_type, recipient_role, subject, status, attempts, last_error
  FROM message_outbox
 WHERE created_at > now() - interval '1 day'
 ORDER BY created_at DESC;

-- quanto cada assessoria enviou hoje (dia de Brasília) e o limite dela
SELECT t.name, t.email_mode, t.email_daily_limit,
       count(*) FILTER (WHERE m.status = 'sent' AND m.sent_at >=
         date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS enviados_hoje,
       count(*) FILTER (WHERE m.status = 'held') AS aguardando
  FROM tenants t LEFT JOIN message_outbox m ON m.tenant_id = t.id
 GROUP BY t.id;
```

Reenviar, liberar e cancelar se faz pela tela E-mails (fica registrado no Log de Ações com quem fez).

## Testes

- `messaging/message-templates.spec.ts`: os 6 pontos, o disparo duplo, o desfazer e o escape de HTML.
- `messaging/messaging.service.spec.ts`: a mensagem vai pela transação de quem chamou e os destinatários são buscados só no tenant do evento (RN-01).
- `messaging/outbox.worker.spec.ts`: captura com `SKIP LOCKED`, envio, novas tentativas, desistência, limpeza por retenção; limite diário da assessoria e do servidor, adiamento para o dia seguinte, vencimento da fila velha e o registro de cada disparo.
- `messaging/outbox-admin.service.spec.ts`: o controle do gestor (liberar, cancelar, reenviar, modo e limite), sempre dentro da assessoria de quem chama, e o limite diário dos envios diretos.
- `email/smtp-failure.spec.ts` e `email/email.service.spec.ts`: o motivo da falha do SMTP em português e os envios diretos sob o limite.
- `messaging/messaging.integration.spec.ts`: services reais → fila → worker → nodemailer → um servidor SMTP de verdade rodando no teste, inclusive o SMTP recusando (451) e a mensagem saindo na tentativa seguinte.
- `processes`, `audit` e `documents`: a mensagem entra na mesma transação da mudança, e uma mudança recusada não gera mensagem.

Verificado em 13/10/2026 (ambiente local): API real contra uma cópia do banco, com o SMTP real do Brevo, 14 ações pela API geraram 15 e-mails (a pendência avisou cliente e analista), todos enviados na primeira tentativa, entre 0,4 s e 1,3 s depois da ação.
