import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { stageEventType, WebhookService } from './webhook.service';

function makeService(nodeEnv: string) {
  const config = {
    get: jest.fn((key: string, def?: unknown) => {
      if (key === 'N8N_WEBHOOK_BASE_URL') return 'http://n8n.test';
      if (key === 'NODE_ENV') return nodeEnv;
      return def;
    }),
  } as unknown as ConfigService;
  return new WebhookService(config);
}

// Lets the fire-and-forget .catch()/.finally() chain settle (clears the timeout).
const flush = () => new Promise((r) => setImmediate(r));

describe('WebhookService.fireAndForget (RN-08/09, REL-01)', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('posts to the test webhook path in development', async () => {
    makeService('development').fireAndForget('stage-change', { a: 1 });
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://n8n.test/webhook-test/stage-change',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('posts to the live webhook path outside development', async () => {
    makeService('production').fireAndForget('stage-change', {});
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('http://n8n.test/webhook/stage-change', expect.anything());
  });

  it('swallows transport failures so a stage change is never blocked (REL-01)', async () => {
    fetchMock.mockRejectedValue(new Error('n8n down'));
    expect(() => makeService('production').fireAndForget('x', {})).not.toThrow();
    await flush();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('BE-15: event_type of each stage', () => {
  it('maps the stages of the six n8n points', () => {
    expect(stageEventType('credito_recusado')).toBe('credit_refused');
    expect(stageEventType('analise_credito')).toBe('bank_analysis');
    expect(stageEventType('credito_aprovado')).toBe('bank_analysis');
    expect(stageEventType('processo_pendencia')).toBe('pending_alert');
    expect(stageEventType('assinatura')).toBe('signature');
    expect(stageEventType('analise_juridica')).toBe('issuance');
    expect(stageEventType('cartorio')).toBe('issuance');
    expect(stageEventType('cadastro')).toBe('stage_changed');
    expect(stageEventType('cliente_inativo')).toBe('stage_changed');
  });
});
