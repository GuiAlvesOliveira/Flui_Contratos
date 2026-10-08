import { Injectable, Logger } from '@nestjs/common';
import * as appInsights from 'applicationinsights';

/**
 * VAL-04: usage events as Application Insights customEvents. Without App
 * Insights configured (local, tests) it does nothing, and a telemetry failure
 * never breaks the request.
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  track(name: string, properties: Record<string, string>) {
    const client = appInsights.defaultClient;
    if (!client) return;
    try {
      client.trackEvent({ name, properties });
    } catch (e) {
      this.logger.warn(`telemetria não enviada (${name}): ${String(e)}`);
    }
  }
}
