import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import type { ProcessStage } from '../../processes/process.entity';

// BE-15: the six n8n points of fluxo_processo.md, sent as `event_type`. Stage
// changes outside them keep the generic `stage_changed`.
export type WebhookEventType =
  | 'documents_requested'
  | 'credit_refused'
  | 'bank_analysis'
  | 'pending_alert'
  | 'signature'
  | 'issuance'
  | 'stage_changed';

const STAGE_EVENTS: Partial<Record<ProcessStage, WebhookEventType>> = {
  credito_recusado: 'credit_refused',
  analise_credito: 'bank_analysis',
  credito_aprovado: 'bank_analysis',
  processo_pendencia: 'pending_alert',
  assinatura: 'signature',
  analise_juridica: 'issuance',
  juridico_aprovado: 'issuance',
  cartorio: 'issuance',
};

export function stageEventType(toStage: ProcessStage): WebhookEventType {
  return STAGE_EVENTS[toStage] ?? 'stage_changed';
}

// BE-16: HMAC-SHA256 of "<timestamp>.<body>" — signing the timestamp too lets
// n8n reject replays of an old request.
export function signWebhook(
  secret: string,
  timestamp: string,
  body: string,
): string {
  const hmac = createHmac('sha256', secret).update(`${timestamp}.${body}`);
  return `sha256=${hmac.digest('hex')}`;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly baseUrl: string;
  private readonly secret: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('N8N_WEBHOOK_BASE_URL', 'http://localhost:5678');
    this.secret = this.config.get<string>('WEBHOOK_SECRET') || undefined;
    if (!this.secret && this.config.get<string>('NODE_ENV') === 'production') {
      this.logger.warn(
        'WEBHOOK_SECRET não configurado: os webhooks do n8n vão sem assinatura (BE-16)',
      );
    }
  }

  // BE-15: common envelope — n8n identifies the event and the process without
  // depending on the URL path; the previous fields stay for existing flows.
  fireEvent(
    path: string,
    eventType: WebhookEventType,
    ids: { processId: string; tenantId: string | null | undefined },
    payload: Record<string, unknown>,
  ): void {
    this.fireAndForget(path, {
      event_type: eventType,
      process_id: ids.processId,
      tenant_id: ids.tenantId ?? null,
      timestamp: new Date().toISOString(),
      ...payload,
    });
  }

  fireAndForget(event: string, payload: Record<string, unknown>): void {
    // In development, n8n "Listen for test event" uses /webhook-test/ prefix
    const isDev = this.config.get<string>('NODE_ENV') === 'development';
    const prefix = isDev ? 'webhook-test' : 'webhook';
    const url = `${this.baseUrl}/${prefix}/${event}`;
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Flui-Timestamp': timestamp,
    };
    if (this.secret) {
      headers['X-Flui-Signature'] = signWebhook(this.secret, timestamp, body);
    }
    // Bound the request so a slow/unreachable n8n can't hold a socket open (REL-01).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
      .catch((err: unknown) => {
        this.logger.warn(`Webhook ${event} failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => clearTimeout(timeout));
  }
}
