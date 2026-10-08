import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { TrackUsage } from '../decorators/track-usage.decorator';
import { TelemetryService } from '../services/telemetry.service';
import { UsageTelemetryInterceptor } from './usage-telemetry.interceptor';

// Application Insights replaced by a plain object the tests can switch on/off
jest.mock('applicationinsights', () => ({ defaultClient: undefined }));
const mockAppInsights = jest.requireMock<{
  defaultClient?: { trackEvent: jest.Mock };
}>('applicationinsights');

class Routes {
  @TrackUsage('stage_changed', (r) => {
    const res = r as { fromStage: string; toStage: string };
    return { fromStage: res.fromStage, toStage: res.toStage };
  })
  stage() {}

  @TrackUsage('login')
  me() {}

  plain() {}
}
const route = (name: keyof Routes) =>
  Object.getOwnPropertyDescriptor(Routes.prototype, name)!.value as () => void;

const user = {
  tenantId: 't1',
  userId: 'u1',
  role: 'analista',
  email: 'a@x.dev',
  name: 'Ana',
};
const ctx = (handler: () => void, withUser = true) =>
  ({
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => (withUser ? { user } : {}) }),
  }) as unknown as ExecutionContext;
const handler = (value: unknown): CallHandler => ({ handle: () => of(value) });

function make() {
  const telemetry = { track: jest.fn() };
  const interceptor = new UsageTelemetryInterceptor(
    new Reflector(),
    telemetry as unknown as TelemetryService,
  );
  return { interceptor, telemetry };
}

describe('VAL-04: usage telemetry', () => {
  afterEach(() => {
    mockAppInsights.defaultClient = undefined;
  });

  it('tracks a marked route after it succeeds, without personal data', async () => {
    const { interceptor, telemetry } = make();
    const res = { id: 'p1', fromStage: 'cadastro', toStage: 'analise_credito' };
    const out = await lastValueFrom(
      interceptor.intercept(ctx(route('stage')), handler(res)),
    );
    expect(out).toBe(res); // response untouched
    expect(telemetry.track).toHaveBeenCalledWith('stage_changed', {
      tenantId: 't1',
      userId: 'u1',
      role: 'analista',
      fromStage: 'cadastro',
      toStage: 'analise_credito',
    });
    const sent = JSON.stringify(telemetry.track.mock.calls[0]);
    expect(sent).not.toContain('a@x.dev');
    expect(sent).not.toContain('Ana');
  });

  it('does not track failed requests, unmarked routes or anonymous calls', async () => {
    const { interceptor, telemetry } = make();
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx(route('me')), {
          handle: () => throwError(() => new Error('403')),
        }),
      ),
    ).rejects.toThrow('403');
    await lastValueFrom(
      interceptor.intercept(ctx(route('plain')), handler({})),
    );
    await lastValueFrom(
      interceptor.intercept(ctx(route('me'), false), handler({})),
    );
    expect(telemetry.track).not.toHaveBeenCalled();
  });

  it('TelemetryService: no-op without App Insights; a failing client never throws', () => {
    const service = new TelemetryService();
    expect(() => service.track('login', { tenantId: 't1' })).not.toThrow();

    const trackEvent = jest.fn(() => {
      throw new Error('ingestão fora do ar');
    });
    mockAppInsights.defaultClient = { trackEvent };
    expect(() => service.track('login', { tenantId: 't1' })).not.toThrow();
    expect(trackEvent).toHaveBeenCalledWith({
      name: 'login',
      properties: { tenantId: 't1' },
    });
  });
});
