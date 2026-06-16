import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('N8N_WEBHOOK_BASE_URL', 'http://localhost:5678');
  }

  fireAndForget(event: string, payload: Record<string, unknown>): void {
    // In development, n8n "Listen for test event" uses /webhook-test/ prefix
    const isDev = this.config.get<string>('NODE_ENV') === 'development';
    const prefix = isDev ? 'webhook-test' : 'webhook';
    const url = `${this.baseUrl}/${prefix}/${event}`;
    // Bound the request so a slow/unreachable n8n can't hold a socket open (REL-01).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .catch((err: unknown) => {
        this.logger.warn(`Webhook ${event} failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => clearTimeout(timeout));
  }
}
