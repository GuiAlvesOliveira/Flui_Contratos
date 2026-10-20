import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { primaryFrontendUrl } from '../common/frontend-url';
import type { ProcessStage } from '../processes/process.entity';
import {
  documentRejectedMessage,
  documentsRequestedMessage,
  type OutboundMessage,
  processStalledMessages,
  type Recipient,
  stageChangeMessages,
  type StalledInput,
} from './message-templates';
import { OutboxWorker } from './outbox.worker';

export interface StageChangeNotice {
  tenantId: string;
  processId: string;
  clientId: string;
  analistaId: string | null;
  fromStage: ProcessStage;
  toStage: ProcessStage;
  undo?: boolean;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * In-house messaging (BE-09_v2, replaces n8n). Each method renders the messages
 * of one event and writes them to `message_outbox` through the caller's
 * transaction `manager`: the message exists if, and only if, the change that
 * caused it was committed (RN-08_v2). The OutboxWorker sends them.
 */
@Injectable()
export class MessagingService {
  private readonly portalUrl: string;

  constructor(
    config: ConfigService,
    private readonly worker: OutboxWorker,
  ) {
    this.portalUrl = primaryFrontendUrl(config.get<string>('FRONTEND_URL'));
  }

  // RN-08_v2: every stage change, including an undo from the Log de Ações.
  async stageChanged(
    manager: EntityManager,
    n: StageChangeNotice,
  ): Promise<number> {
    const ids = [n.clientId, n.analistaId].filter((id): id is string => !!id);
    const people = await this.users(manager, n.tenantId, ids);
    const client = people.get(n.clientId) ?? null;
    const analista = n.analistaId ? (people.get(n.analistaId) ?? null) : null;
    const messages = stageChangeMessages(
      {
        client: recipient(client),
        analista: recipient(analista),
        clientName: client?.name ?? null,
        fromStage: n.fromStage,
        toStage: n.toStage,
        undo: n.undo,
      },
      await this.context(manager, n.tenantId),
    );
    return this.enqueue(manager, n.tenantId, n.processId, messages);
  }

  // BE-15_v2, point 1 of the flow: the client is asked for the documents.
  async documentsRequested(
    manager: EntityManager,
    n: {
      tenantId: string;
      processId: string;
      clientId: string;
      labels: string[];
    },
  ): Promise<number> {
    const client = recipient(
      (await this.users(manager, n.tenantId, [n.clientId])).get(n.clientId),
    );
    if (!client || n.labels.length === 0) return 0;
    const message = documentsRequestedMessage(
      client,
      n.labels,
      await this.context(manager, n.tenantId),
    );
    return this.enqueue(manager, n.tenantId, n.processId, [message]);
  }

  async documentRejected(
    manager: EntityManager,
    n: {
      tenantId: string;
      processId: string | null;
      clientId: string;
      label: string;
      notes: string | null;
    },
  ): Promise<number> {
    const client = recipient(
      (await this.users(manager, n.tenantId, [n.clientId])).get(n.clientId),
    );
    if (!client) return 0;
    const message = documentRejectedMessage(
      client,
      n.label,
      n.notes,
      await this.context(manager, n.tenantId),
    );
    return this.enqueue(manager, n.tenantId, n.processId, [message]);
  }

  // PROD-05_v2: alerta de processo parado, na transação que registra o alerta.
  // Destinatários procurados só dentro da assessoria do processo (RN-01).
  async processStalled(
    manager: EntityManager,
    n: Omit<StalledInput, 'recipients'> & {
      tenantId: string;
      processId: string;
      recipients: { id: string; role: 'analista' | 'gestor' }[];
    },
  ): Promise<number> {
    const people = await this.users(
      manager,
      n.tenantId,
      n.recipients.map((r) => r.id),
    );
    const recipients = n.recipients.flatMap((r) => {
      const person = recipient(people.get(r.id));
      return person ? [{ person, role: r.role }] : [];
    });
    if (recipients.length === 0) return 0;
    const messages = processStalledMessages(
      { ...n, recipients },
      await this.context(manager, n.tenantId),
    );
    return this.enqueue(manager, n.tenantId, n.processId, messages);
  }

  private async enqueue(
    manager: EntityManager,
    tenantId: string,
    processId: string | null,
    messages: OutboundMessage[],
  ): Promise<number> {
    for (const m of messages) {
      await manager.query(
        `INSERT INTO message_outbox
           (tenant_id, process_id, event_type, recipient_role, recipient, subject, html, text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          processId,
          m.eventType,
          m.recipientRole,
          m.to,
          m.subject,
          m.html,
          m.text,
        ],
      );
    }
    // The caller's transaction commits right after this returns; the worker
    // picks the messages up in a moment instead of waiting for its next poll.
    if (messages.length > 0) this.worker.soon();
    return messages.length;
  }

  // RN-01: recipients are looked up inside the tenant of the event only.
  private async users(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, UserRow>> {
    if (ids.length === 0) return new Map();
    const rows = await manager.query<UserRow[]>(
      `SELECT id, name, email FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async context(manager: EntityManager, tenantId: string) {
    const [tenant] = await manager.query<{ name: string }[]>(
      `SELECT name FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return {
      tenantName: tenant?.name ?? 'Sua assessoria',
      portalUrl: this.portalUrl,
    };
  }
}

function recipient(user: UserRow | null | undefined): Recipient | null {
  return user?.email ? { name: user.name, email: user.email } : null;
}
