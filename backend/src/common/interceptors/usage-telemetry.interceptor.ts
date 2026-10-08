import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import type { RequestUserFull } from '../../auth/supabase.guard';
import {
  TRACK_USAGE_KEY,
  type TrackUsageMeta,
} from '../decorators/track-usage.decorator';
import { TelemetryService } from '../services/telemetry.service';

/**
 * VAL-04: sends the usage event of a @TrackUsage route once the handler
 * succeeds (errors are not usage). Dimensions are internal ids, role and the
 * route's own fields — no name, e-mail or CPF — so the funnel login → process
 * created → stage changed can be built per tenant and per user.
 */
@Injectable()
export class UsageTelemetryInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly telemetry: TelemetryService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<TrackUsageMeta | undefined>(
      TRACK_USAGE_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const user = context
      .switchToHttp()
      .getRequest<{ user?: RequestUserFull }>().user;
    return next.handle().pipe(
      tap((response) => {
        if (!user) return;
        const extra = meta.props?.(response) ?? {};
        const properties: Record<string, string> = {
          tenantId: user.tenantId ?? '',
          userId: user.userId,
          role: user.role,
        };
        for (const [k, v] of Object.entries(extra)) {
          if (v !== undefined) properties[k] = v;
        }
        this.telemetry.track(meta.name, properties);
      }),
    );
  }
}
