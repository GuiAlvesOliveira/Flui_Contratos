import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListAuditLogsDto } from './list-audit-logs.dto';

// Same options as the global ValidationPipe in main.ts.
async function errorsFor(query: Record<string, string>) {
  const dto = plainToInstance(ListAuditLogsDto, query);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('ListAuditLogsDto (GET /audit-logs query, BE-07)', () => {
  it('accepts the pagination alone, as the logs page sends it today', async () => {
    expect(await errorsFor({ limit: '100', offset: '0' })).toEqual([]);
  });

  it('accepts every filter together', async () => {
    expect(
      await errorsFor({
        limit: '25',
        offset: '50',
        processId: '3f8b0c5e-2a1d-4f6b-9c7e-1a2b3c4d5e6f',
        action: 'stage_change',
        from: '2026-10-01',
        to: '2026-10-07',
      }),
    ).toEqual([]);
  });

  it('rejects a process id that is not a UUID', async () => {
    expect(await errorsFor({ processId: '123' })).toEqual(['processId']);
  });

  it('rejects an action outside snake_case', async () => {
    expect(await errorsFor({ action: "x' OR 1=1 --" })).toEqual(['action']);
  });

  it('rejects dates outside AAAA-MM-DD or impossible dates', async () => {
    expect(await errorsFor({ from: '07/10/2026' })).toEqual(['from']);
    expect(await errorsFor({ to: '2026-02-30' })).toEqual(['to']);
    expect(await errorsFor({ from: '2026-10-07T10:00:00Z' })).toEqual(['from']);
  });

  it('rejects unknown query parameters', async () => {
    expect(await errorsFor({ tenantId: 'other' })).toEqual(['tenantId']);
  });
});
