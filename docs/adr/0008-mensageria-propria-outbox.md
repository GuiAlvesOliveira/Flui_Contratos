# ADR 0008 — Mensageria no próprio backend: fila (*outbox*) no PostgreSQL + worker com novas tentativas

**Status:** Aceito (13/10/2026) · Substitui o [ADR 0006](0006-automacao-n8n-webhooks.md) · **Regras:** RN-08, RN-09, RN-10 · **Itens:** BE-09_v2, RN-08_v2, BE-15_v2, BE-16_v2

## Contexto
O ADR 0006 levou as notificações para o n8n, chamado por webhook *fire-and-forget*. Na prática:

- o n8n só mandava e-mail, e o backend já mandava e-mail pelo mesmo SMTP (convite, senha, documento recusado);
- o cliente recebia **dois** e-mails por mudança de etapa (um do backend e um do n8n);
- a produção ficou sem instância do n8n, e os pedidos de documento, os avisos de pendência ao analista e o "desfazer" deixaram de sair, sem erro visível;
- o *fire-and-forget* perdia a mensagem se o n8n estivesse fora — a regra RN-08/RN-09 pede notificação confiável;
- manter o n8n custaria R$ 75–134/mês, mais um serviço para operar, um segredo HMAC e dados pessoais trafegando para outro sistema.

## Decisão
As notificações passam a ser do backend (`backend/src/messaging/`):

1. Cada ação que notifica grava a mensagem já pronta na tabela `message_outbox`, **na mesma transação** da mudança (padrão *transactional outbox*).
2. Um worker dentro da API (`OutboxWorker`) captura as mensagens devidas com `FOR UPDATE SKIP LOCKED` e uma reserva de 10 minutos, envia por SMTP e, em caso de falha, agenda nova tentativa (30 s, 2 min, 10 min, 30 min, 2 h; desiste na 6ª).
3. O envio é SMTP puro: Brevo hoje, Azure Communication Services trocando só as variáveis.
4. Mensagens enviadas ou com falha são apagadas após 30 dias. Links de convite e de senha não entram na fila.

O n8n, o `WebhookService`, a assinatura HMAC e os workflows de `infra/n8n/` foram removidos.

## Consequências
- Notificação confiável: não existe mudança gravada sem mensagem, e falha de SMTP vira nova tentativa em vez de perda.
- Escala horizontal: várias instâncias da API dividem a fila sem enviar duas vezes; o limite real passa a ser o plano do provedor de e-mail.
- Menos peças: sem serviço extra, sem custo extra, um único lugar para os textos (com testes).
- Mudar um texto de e-mail exige deploy da API (antes bastava editar o workflow no n8n).
- Canais novos (WhatsApp, SMS) e lembretes agendados passam a ser implementados no backend (PROD-11_v2, PROD-05_v2).

Detalhes de operação em [`docs/mensageria.md`](../mensageria.md).
