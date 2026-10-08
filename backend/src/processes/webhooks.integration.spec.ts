import { createServer, type IncomingHttpHeaders, type Server } from 'http';
import { AddressInfo } from 'net';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import {
  signWebhook,
  WebhookService,
} from '../common/services/webhook.service';
import { DocumentsService } from '../documents/documents.service';
import { Document } from '../documents/document.entity';
import { DocumentType } from '../documents/document-type.entity';
import { User } from '../users/user.entity';
import { Process, type ProcessStage } from './process.entity';
import { ProcessesService } from './processes.service';

// BE-15 + BE-16: the six n8n points of fluxo_processo.md reach a real HTTP
// endpoint (a local stand-in for n8n) through the real WebhookService.

const SECRET = 'segredo-de-teste';
interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  raw: string;
  body: Record<string, unknown>;
}
let server: Server;
let baseUrl: string;
let received: Received[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        headers: req.headers,
        raw,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  received = [];
});

const waitFor = async (n: number) => {
  for (let i = 0; i < 100 && received.length < n; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return received;
};

function webhook(secret: string | undefined = SECRET) {
  const values: Record<string, string | undefined> = {
    N8N_WEBHOOK_BASE_URL: baseUrl,
    NODE_ENV: 'production',
    WEBHOOK_SECRET: secret,
  };
  const config = {
    get: (key: string, def?: string) => values[key] ?? def,
  } as unknown as ConfigService;
  return new WebhookService(config);
}

const caller = {
  tenantId: 't1',
  userId: 'a1',
  role: 'analista',
} as RequestUserFull;
const people: Record<string, Partial<User>> = {
  c1: { id: 'c1', name: 'Helena', email: 'helena@x.dev', telefone: '1199' },
  an1: { id: 'an1', name: 'Rafael', email: 'rafael@x.dev', telefone: '1188' },
};

function processes(stage: ProcessStage) {
  const process = {
    id: 'p1',
    tenantId: 't1',
    clientId: 'c1',
    analistaId: 'an1',
    stage,
    stageBeforePendencia: null,
    mipValue: 10,
    dfiValue: 5,
  };
  const manager = { update: jest.fn(), query: jest.fn() };
  const service = new ProcessesService(
    {
      findOne: jest.fn().mockResolvedValue(process),
    } as unknown as Repository<Process>,
    {
      findOne: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(people[where.id] ?? null),
      ),
    } as unknown as Repository<User>,
    {
      // RN-04 gate: every document validated
      query: jest.fn().mockResolvedValue([{ total: '1', pending: '0' }]),
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
    } as unknown as DataSource,
    webhook(),
    { sendStageChange: jest.fn() } as never,
  );
  return service;
}

// point -> [from, to, expected event_type]
const STAGE_POINTS: [string, ProcessStage, ProcessStage, string][] = [
  [
    'Notificação de recusa',
    'analise_credito',
    'credito_recusado',
    'credit_refused',
  ],
  [
    'Atualização de análise bancária',
    'cadastro',
    'analise_credito',
    'bank_analysis',
  ],
  [
    'Alertas de pendências (duplo)',
    'cadastro',
    'processo_pendencia',
    'pending_alert',
  ],
  ['Notificações de assinatura', 'cartorio', 'assinatura', 'signature'],
  [
    'Triggers de emissão (entrada no jurídico)',
    'credito_aprovado',
    'analise_juridica',
    'issuance',
  ],
];

describe('BE-15/BE-16: n8n webhooks for the six points of the flow', () => {
  it.each(STAGE_POINTS)(
    '%s: %s → %s sends event_type %s',
    async (_point, from, to, eventType) => {
      await processes(from).advanceStage(
        'p1',
        { toStage: to, motivoRecusa: 'Score insuficiente' },
        caller,
      );
      const [hit] = await waitFor(1);
      expect(hit.path).toBe('/webhook/stage-change');
      expect(hit.body).toMatchObject({
        event_type: eventType,
        process_id: 'p1',
        tenant_id: 't1',
        fromStage: from,
        toStage: to,
        clientEmail: 'helena@x.dev',
      });
      expect(Number.isNaN(Date.parse(hit.body.timestamp as string))).toBe(
        false,
      );
    },
  );

  it('pendência goes to the client AND the analista at the same time (RN-10)', async () => {
    await processes('cadastro').advanceStage(
      'p1',
      { toStage: 'processo_pendencia' },
      caller,
    );
    const [hit] = await waitFor(1);
    expect(hit.body).toMatchObject({
      recipients: ['cliente', 'analista'],
      clientEmail: 'helena@x.dev',
      analistaEmail: 'rafael@x.dev',
      analistaPhone: '1188',
    });
  });

  it('Solicitação de documentos: documents_requested with the requested labels', async () => {
    const created = [{ label: 'RG ou CNH' }, { label: 'Holerite (mês 1)' }];
    const service = new DocumentsService(
      {
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((x: object) => x),
        save: jest.fn().mockResolvedValue(created),
      } as unknown as Repository<Document>,
      {
        find: jest.fn().mockResolvedValue([
          { id: 'ty1', label: 'RG ou CNH', category: 'pessoal' },
          { id: 'ty2', label: 'Holerite (mês 1)', category: 'renda' },
        ]),
      } as unknown as Repository<DocumentType>,
      {
        findOne: jest.fn().mockResolvedValue({ id: 'p1', clientId: 'c1' }),
      } as unknown as Repository<Process>,
      {
        findOne: jest.fn().mockResolvedValue(people.c1),
      } as unknown as Repository<User>,
      {} as never,
      { query: jest.fn() } as unknown as DataSource,
      {} as never,
      webhook(),
    );
    await service.requestDocuments('p1', ['ty1', 'ty2'], caller);
    const [hit] = await waitFor(1);
    expect(hit.path).toBe('/webhook/documents-requested');
    expect(hit.body).toMatchObject({
      event_type: 'documents_requested',
      process_id: 'p1',
      tenant_id: 't1',
      labels: ['RG ou CNH', 'Holerite (mês 1)'],
      clientEmail: 'helena@x.dev',
    });
  });

  it('BE-16: every request is signed with HMAC-SHA256 over "<timestamp>.<body>"', async () => {
    await processes('cadastro').advanceStage(
      'p1',
      { toStage: 'analise_credito' },
      caller,
    );
    const [hit] = await waitFor(1);
    const ts = hit.headers['x-flui-timestamp'] as string;
    expect(ts).toMatch(/^\d{10}$/);
    expect(hit.headers['x-flui-signature']).toBe(
      signWebhook(SECRET, ts, hit.raw),
    );
    // a forged body does not match the signature
    expect(signWebhook(SECRET, ts, hit.raw.replace('p1', 'p2'))).not.toBe(
      hit.headers['x-flui-signature'],
    );
  });

  it('BE-16: without WEBHOOK_SECRET the request still goes, unsigned', async () => {
    webhook('').fireAndForget('stage-change', { a: 1 });
    const [hit] = await waitFor(1);
    expect(hit.headers['x-flui-signature']).toBeUndefined();
    expect(hit.headers['x-flui-timestamp']).toBeDefined();
  });
});
