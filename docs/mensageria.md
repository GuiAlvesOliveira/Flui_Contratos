# Mensageria: e-mails automáticos do Flui (RN-08, RN-09, RN-10)

O próprio backend avisa o cliente (e, na pendência, o analista) a cada mudança de etapa, a cada pedido de documentos e a cada documento recusado. Até 13/10/2026 isso era feito pelo n8n; a decisão de trazer para o backend está no [ADR 0008](adr/0008-mensageria-propria-outbox.md).

## Como um e-mail sai

```
Ação na API (mover card, desfazer, pedir/recusar documento)
  └─ transação no PostgreSQL
       ├─ grava a mudança (processo / documento)
       ├─ grava o log de auditoria (RN-07)
       └─ grava a mensagem pronta na fila  message_outbox  (status: pending)
                        │
                        ▼  em ~0,3 s (aviso imediato) ou na próxima verificação (5 s)
OutboxWorker (dentro da API)
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
- **Desfazer** no Log de Ações é uma mudança de etapa: o cliente recebe "seu processo voltou para X".

Convite e redefinição de senha **não** passam pela fila: o link deles dá acesso à conta e não deve ficar gravado no banco. Continuam saindo direto pelo `EmailService`.

## O e-mail

Cada mensagem tem versão HTML e texto puro, com o nome da assessoria no rodapé e um botão para o portal (`FRONTEND_URL`, a primeira origem). Os textos ficam em `backend/src/messaging/message-templates.ts`; nomes, documentos e observações digitados por usuários são escapados no HTML.

## Configuração

| Variável | Padrão | Para que serve |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | — | servidor de envio (sem eles, nada é enviado) |
| `MESSAGING_POLL_MS` | `5000` | intervalo em que o worker olha a fila |
| `MESSAGE_RETENTION_DAYS` | `30` | mensagens enviadas ou com falha são apagadas depois disso (têm dados pessoais) |
| `MESSAGING_WORKER` | `on` | `off` deixa a instância só enfileirando, sem enviar |

### Provedor: Brevo ou Azure Communication Services

O envio é SMTP puro, então trocar de provedor é só trocar as variáveis:

- **Brevo** (atual): `smtp-relay.brevo.com:587`. Plano gratuito: 300 e-mails/dia.
- **Azure Communication Services** (`flui-contratos-comm` / `flui-email` já existem na assinatura): `smtp.azurecomm.net:587`, usuário SMTP criado a partir de um app do Entra ID. Com o domínio gerenciado pela Azure o limite é de 10 e-mails/hora, sem aumento; com o domínio `fluicontratos.com.br` verificado sobe para 100/hora (com aumento sob pedido). Custo: US$ 0,00025 por e-mail.

Nos dois casos, o remetente deve ser de um domínio autenticado (SPF e DKIM do `fluicontratos.com.br`) para os e-mails não caírem no spam: item INFRA-18.

## Consultas úteis

```sql
-- o que saiu e o que está pendente nas últimas 24 h
SELECT created_at, event_type, recipient_role, subject, status, attempts, last_error
  FROM message_outbox
 WHERE created_at > now() - interval '1 day'
 ORDER BY created_at DESC;

-- reenviar uma mensagem que falhou de vez
UPDATE message_outbox SET status = 'pending', attempts = 0, next_attempt_at = now()
 WHERE id = '<id>';
```

## Testes

- `messaging/message-templates.spec.ts`: os 6 pontos, o disparo duplo, o desfazer e o escape de HTML.
- `messaging/messaging.service.spec.ts`: a mensagem vai pela transação de quem chamou e os destinatários são buscados só no tenant do evento (RN-01).
- `messaging/outbox.worker.spec.ts`: captura com `SKIP LOCKED`, envio, novas tentativas, desistência, limpeza por retenção.
- `messaging/messaging.integration.spec.ts`: services reais → fila → worker → nodemailer → um servidor SMTP de verdade rodando no teste, inclusive o SMTP recusando (451) e a mensagem saindo na tentativa seguinte.
- `processes`, `audit` e `documents`: a mensagem entra na mesma transação da mudança, e uma mudança recusada não gera mensagem.

Verificado em 13/10/2026 (ambiente local): API real contra uma cópia do banco, com o SMTP real do Brevo, 14 ações pela API geraram 15 e-mails (a pendência avisou cliente e analista), todos enviados na primeira tentativa, entre 0,4 s e 1,3 s depois da ação.
