import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EscalationService } from './escalation.service';

// Horário de Brasília (sem horário de verão desde 2019): UTC−3.
const BRT_OFFSET_HOURS = 3;
const CATCH_UP_DELAY_MS = 60_000;
const BUSINESS_END_HOUR = 20;

export const brtHour = (now: Date) =>
  (now.getUTCHours() + 24 - BRT_OFFSET_HOURS) % 24;

/** Próxima ocorrência de `hour`:00 no horário de Brasília, depois de `now`. */
export function nextRunAt(now: Date, hour: number): Date {
  const brt = new Date(now.getTime() - BRT_OFFSET_HOURS * 3_600_000);
  const at = new Date(
    Date.UTC(
      brt.getUTCFullYear(),
      brt.getUTCMonth(),
      brt.getUTCDate(),
      hour + BRT_OFFSET_HOURS,
    ),
  );
  if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

/**
 * PROD-05_v2: roda a escalação uma vez por dia, às ESCALATION_HOUR (padrão 8h)
 * de Brasília. Se a API sobe no meio do horário comercial (deploy, reinício),
 * roda também um minuto depois do boot — a regra de "um alerta por processo a
 * cada N dias" impede repetição. ESCALATION_ENABLED=off desliga.
 */
@Injectable()
export class EscalationJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EscalationJob.name);
  private readonly enabled: boolean;
  private readonly hour: number;
  private timer?: NodeJS.Timeout;
  private catchUp?: NodeJS.Timeout;
  private running: Promise<void> | null = null;

  constructor(
    private readonly service: EscalationService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('ESCALATION_ENABLED', 'on') !== 'off';
    const h = Number(config.get('ESCALATION_HOUR', 8));
    this.hour = Number.isInteger(h) && h >= 0 && h <= 23 ? h : 8;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log(
        'Escalação de processos parados desligada (ESCALATION_ENABLED=off)',
      );
      return;
    }
    this.schedule();
    const h = brtHour(new Date());
    if (h >= this.hour && h < BUSINESS_END_HOUR) {
      this.catchUp = setTimeout(() => void this.tick(), CATCH_UP_DELAY_MS);
      this.catchUp.unref();
    }
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
      `Escalação de processos parados: mais de ${this.service.days} dias na etapa; próxima verificação ${next.toISOString()}`,
    );
  }

  /** Uma verificação; chamadas simultâneas compartilham a mesma execução. */
  tick(): Promise<void> {
    this.running ??= this.service
      .run()
      .then((r) =>
        this.logger.log(
          `Escalação: ${r.checked} processo(s) parado(s), ${r.alerted} alerta(s), ${r.messages} e-mail(s) na fila, ${r.skipped} já alertado(s), ${r.failed} com erro`,
        ),
      )
      .catch((err) =>
        this.logger.error(
          `Escalação falhou: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
