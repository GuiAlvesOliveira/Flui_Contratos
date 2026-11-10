import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nextRunAt } from '../escalation/escalation.job';
import { DocumentExpiryService } from './document-expiry.service';

const CATCH_UP_DELAY_MS = 60_000;

/**
 * Validade de documentos: roda a verificação uma vez por dia, às
 * DOCUMENT_EXPIRY_HOUR (padrão 7h) de Brasília, e também um minuto depois do
 * boot (deploy, reinício) — os avisos ficam só na plataforma e não se repetem,
 * então rodar de novo não tem efeito colateral. DOCUMENT_EXPIRY_ENABLED=off
 * desliga.
 */
@Injectable()
export class DocumentExpiryJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DocumentExpiryJob.name);
  private readonly enabled: boolean;
  private readonly hour: number;
  private timer?: NodeJS.Timeout;
  private catchUp?: NodeJS.Timeout;
  private running: Promise<void> | null = null;

  constructor(
    private readonly service: DocumentExpiryService,
    config: ConfigService,
  ) {
    const flag = String(
      config.get('DOCUMENT_EXPIRY_ENABLED', 'on'),
    ).toLowerCase();
    this.enabled = flag !== 'off' && flag !== 'false';
    const h = Number(config.get('DOCUMENT_EXPIRY_HOUR', 7));
    this.hour = Number.isInteger(h) && h >= 0 && h <= 23 ? h : 7;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log(
        'Validade de documentos desligada (DOCUMENT_EXPIRY_ENABLED=off)',
      );
      return;
    }
    this.schedule();
    this.catchUp = setTimeout(() => void this.tick(), CATCH_UP_DELAY_MS);
    this.catchUp.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.timer);
    clearTimeout(this.catchUp);
  }

  private schedule(): void {
    const next = nextRunAt(new Date(), this.hour);
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, next.getTime() - Date.now());
    this.timer.unref();
    this.logger.log(
      `Validade de documentos: próxima verificação ${next.toISOString()}`,
    );
  }

  /** Uma verificação; chamadas simultâneas compartilham a mesma execução. */
  tick(): Promise<void> {
    this.running ??= this.service
      .run()
      .then((r) =>
        this.logger.log(
          `Validade de documentos (${r.today}): ${r.checked} documento(s) verificado(s), ${r.expired} vencido(s) marcado(s), ${r.notifications} aviso(s) criado(s), ${r.skipped} sem novidade, ${r.failed} com erro`,
        ),
      )
      .catch((err) =>
        this.logger.error(
          `Validade de documentos falhou: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
