import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createServer, type Server, type Socket } from 'net';
import type { AddressInfo } from 'net';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { RequestUserFull } from '../auth/supabase.guard';
import { DocumentsService } from '../documents/documents.service';
import type { Document } from '../documents/document.entity';
import type { DocumentType } from '../documents/document-type.entity';
import { EmailService } from '../email/email.service';
import type { Process, ProcessStage } from '../processes/process.entity';
import { ProcessesService } from '../processes/processes.service';
import type { User } from '../users/user.entity';
import { MessagingService } from './messaging.service';
import { OutboxWorker } from './outbox.worker';

// BE-09_v2 + BE-15_v2 + RN-08_v2: the real services queue the messages, the
// real worker sends them through nodemailer to a real SMTP server (a minimal
// one, listening on localhost inside this test). Only the database is an
// in-memory stand-in for the few statements involved.

// ── Minimal SMTP server ─────────────────────────────────────────────────────

interface Mail {
  from: string;
  to: string[];
  data: string;
}

let server: Server;
let port: number;
let inbox: Mail[] = [];
let rejectData = false; // answer DATA with a temporary failure (451)

function session(socket: Socket) {
  let buffer = '';
  let inData = false;
  let mail: Mail = { from: '', to: [], data: '' };
  const reply = (line: string) => socket.write(`${line}\r\n`);
  reply('220 localhost ESMTP teste');
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('latin1');
    for (;;) {
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        mail.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        if (rejectData) {
          reply('451 4.3.0 caixa temporariamente indisponível');
        } else {
          inbox.push(mail);
          reply('250 2.0.0 ok');
        }
        mail = { from: '', to: [], data: '' };
        continue;
      }
      const nl = buffer.indexOf('\r\n');
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO')
        reply('250-localhost\r\n250 AUTH PLAIN LOGIN');
      else if (cmd === 'AUTH') reply('235 2.7.0 autenticado');
      else if (cmd === 'MAIL') {
        mail.from = line.replace(/^MAIL FROM:\s*<([^>]*)>.*$/i, '$1');
        reply('250 ok');
      } else if (cmd === 'RCPT') {
        mail.to.push(line.replace(/^RCPT TO:\s*<([^>]*)>.*$/i, '$1'));
        reply('250 ok');
      } else if (cmd === 'DATA') {
        inData = true;
        reply('354 fim com <CRLF>.<CRLF>');
      } else if (cmd === 'QUIT') {
        reply('221 tchau');
        socket.end();
      } else reply('250 ok');
    }
  });
}

// Unfolds a header and decodes its MIME encoded-words (=?UTF-8?Q|B?...?=).
function header(raw: string, name: string): string {
  const head = raw.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ');
  const line = head
    .split('\r\n')
    .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return (line ?? '')
    .slice(name.length + 1)
    .trim()
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(
      /=\?utf-8\?([qb])\?([^?]*)\?=/gi,
      (_m, enc: string, text: string) =>
        enc.toLowerCase() === 'b'
          ? Buffer.from(text, 'base64').toString('utf8')
          : Buffer.from(
              text
                .replace(/_/g, ' ')
                .replace(/=([0-9a-f]{2})/gi, (_x, h: string) =>
                  String.fromCharCode(parseInt(h, 16)),
                ),
              'latin1',
            ).toString('utf8'),
    );
}

// The text/plain part, quoted-printable decoded.
function plainText(raw: string): string {
  const part = raw.split(/Content-Type: text\/plain/i)[1] ?? '';
  const body = part
    .split('\r\n\r\n')
    .slice(1)
    .join('\r\n\r\n')
    .split(/\r\n--/)[0];
  return Buffer.from(
    body
      .replace(/=\r\n/g, '')
      .replace(/=([0-9A-F]{2})/g, (_x, h: string) =>
        String.fromCharCode(parseInt(h, 16)),
      ),
    'latin1',
  ).toString('utf8');
}

beforeAll(async () => {
  server = createServer(session);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  inbox = [];
  rejectData = false;
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// ── In-memory database (only what this flow touches) ───────────────────────

interface OutboxRecord {
  id: string;
  tenant_id: string;
  process_id: string | null;
  event_type: string;
  recipient_role: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  status: string;
  attempts: number;
  due: boolean;
  last_error: string | null;
}

const TENANT = 't1';
const people = [
  { id: 'c1', tenant_id: TENANT, name: 'Helena', email: 'helena@exemplo.dev' },
  { id: 'an1', tenant_id: TENANT, name: 'Rafael', email: 'rafael@exemplo.dev' },
];

function database(processStage: () => ProcessStage) {
  const outbox: OutboxRecord[] = [];
  const audit: unknown[][] = [];
  const query = (sql: string, params: unknown[] = []): Promise<unknown> => {
    if (sql.includes('FROM users')) {
      const ids = params[1] as string[];
      return Promise.resolve(
        people.filter((p) => p.tenant_id === params[0] && ids.includes(p.id)),
      );
    }
    if (sql.includes('FROM tenants'))
      return Promise.resolve([{ name: 'Assessoria Exemplo' }]);
    if (sql.includes('INSERT INTO message_outbox')) {
      const [
        tenant_id,
        process_id,
        event_type,
        recipient_role,
        recipient,
        subject,
        html,
        text,
      ] = params as string[];
      outbox.push({
        id: `m${outbox.length + 1}`,
        tenant_id,
        process_id,
        event_type,
        recipient_role,
        recipient,
        subject,
        html,
        text,
        status: 'pending',
        attempts: 0,
        due: true,
        last_error: null,
      });
      return Promise.resolve([]);
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      audit.push(params);
      return Promise.resolve([]);
    }
    if (sql.includes('FOR UPDATE SKIP LOCKED')) {
      const due = outbox
        .filter((m) => m.status === 'pending' && m.due)
        .slice(0, params[0] as number);
      due.forEach((m) => {
        m.attempts++;
        m.due = false; // leased
      });
      return Promise.resolve([due.map((m) => ({ ...m })), due.length]);
    }
    if (sql.includes("SET status = 'sent'")) {
      const m = outbox.find((r) => r.id === params[0])!;
      m.status = 'sent';
      return Promise.resolve([[], 1]);
    }
    if (sql.includes('UPDATE message_outbox')) {
      const m = outbox.find((r) => r.id === params[0])!;
      m.status = params[1] as string;
      m.last_error = params[3] as string;
      return Promise.resolve([[], 1]);
    }
    // RN-04 gate: every document validated
    if (sql.includes('FROM documents'))
      return Promise.resolve([{ total: '1', pending: '0' }]);
    // AuditService.undo: the log entry and the process
    if (sql.includes('FROM audit_logs WHERE id')) {
      return Promise.resolve([
        {
          action: 'stage_change',
          process_id: 'p1',
          from_state: 'cadastro',
          to_state: processStage(),
        },
      ]);
    }
    if (sql.includes('SELECT stage, client_id, analista_id FROM processes')) {
      return Promise.resolve([
        { stage: processStage(), client_id: 'c1', analista_id: 'an1' },
      ]);
    }
    return Promise.resolve([]);
  };
  const manager = {
    query: jest.fn(query),
    update: jest.fn(),
  } as unknown as EntityManager;
  const dataSource = {
    query: jest.fn(query),
    transaction: jest.fn((cb: (m: EntityManager) => unknown) => cb(manager)),
  } as unknown as DataSource;
  return { outbox, audit, dataSource };
}

function config(values: Record<string, string>) {
  return {
    get: (key: string, def?: unknown) => values[key] ?? def,
  } as unknown as ConfigService;
}

function system(stage: ProcessStage) {
  let current = stage;
  const db = database(() => current);
  const cfg = config({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_USER: 'flui',
    SMTP_PASS: 'segredo',
    SMTP_FROM: 'Flui Contratos <noreply@fluicontratos.com.br>',
    FRONTEND_URL: 'https://fluicontratos.com.br',
  });
  const email = new EmailService(cfg);
  const worker = new OutboxWorker(db.dataSource, email, cfg);
  const messaging = new MessagingService(cfg, worker);
  const process = {
    id: 'p1',
    tenantId: TENANT,
    clientId: 'c1',
    analistaId: 'an1',
    get stage() {
      return current;
    },
    stageBeforePendencia: null,
    mipValue: 10,
    dfiValue: 5,
  };
  const processes = new ProcessesService(
    {
      findOne: jest.fn().mockResolvedValue(process),
    } as unknown as Repository<Process>,
    {} as Repository<User>,
    db.dataSource,
    messaging,
  );
  const move = async (to: ProcessStage) => {
    await processes.advanceStage(
      'p1',
      { toStage: to, motivoRecusa: 'Score', motivoInatividade: 'Desistiu' },
      caller,
    );
    current = to;
  };
  return {
    ...db,
    worker,
    messaging,
    move,
    audit: new AuditService(db.dataSource, messaging),
    setStage: (s: ProcessStage) => (current = s),
  };
}

const caller = {
  tenantId: TENANT,
  userId: 'a1',
  role: 'analista',
} as RequestUserFull;

// ── The flow ─────────────────────────────────────────────────────────────────

describe('in-house messaging, end to end over SMTP', () => {
  it.each<[string, ProcessStage, ProcessStage, string[], string]>([
    [
      'recusa',
      'analise_credito',
      'credito_recusado',
      ['helena@exemplo.dev'],
      'Flui Contratos — resultado da análise de crédito',
    ],
    [
      'análise bancária',
      'cadastro',
      'analise_credito',
      ['helena@exemplo.dev'],
      'Flui Contratos — seu processo está em análise no banco',
    ],
    [
      'pendência (duplo)',
      'cadastro',
      'processo_pendencia',
      ['helena@exemplo.dev', 'rafael@exemplo.dev'],
      'Flui Contratos — pendência no seu processo',
    ],
    [
      'assinatura',
      'cartorio',
      'assinatura',
      ['helena@exemplo.dev'],
      'Flui Contratos — contrato pronto para assinatura',
    ],
    [
      'emissão',
      'credito_aprovado',
      'analise_juridica',
      ['helena@exemplo.dev'],
      'Flui Contratos — Análise Jurídica',
    ],
    [
      'outras etapas',
      'inicial',
      'cadastro',
      ['helena@exemplo.dev'],
      'Flui Contratos — seu processo está em Cadastro',
    ],
  ])(
    '%s: %s → %s reaches the inbox',
    async (_point, from, to, recipients, subject) => {
      const s = system(from);
      await s.move(to);
      expect(s.outbox.map((m) => m.status)).toEqual(
        recipients.map(() => 'pending'),
      );
      await s.worker.drain();
      expect(inbox.map((m) => m.to[0])).toEqual(recipients);
      expect(header(inbox[0].data, 'Subject')).toBe(subject);
      expect(inbox[0].from).toBe('noreply@fluicontratos.com.br');
      expect(s.outbox.every((m) => m.status === 'sent')).toBe(true);
    },
  );

  it('the e-mail is multipart (HTML + text) and reads correctly', async () => {
    const s = system('cadastro');
    await s.move('analise_credito');
    await s.worker.drain();
    const raw = inbox[0].data;
    expect(header(raw, 'To')).toBe('helena@exemplo.dev');
    expect(raw).toMatch(/Content-Type: multipart\/alternative/i);
    expect(raw).toMatch(/Content-Type: text\/html/i);
    const text = plainText(raw);
    expect(text).toContain('Olá, Helena!');
    expect(text).toContain('a documentação foi enviada ao banco');
    expect(text).toContain('Assessoria Exemplo acompanha o seu financiamento');
  });

  it('undo in the Log de Ações: the client is told the process went back', async () => {
    const s = system('analise_credito');
    await s.audit.undo('log1', caller);
    await s.worker.drain();
    expect(inbox).toHaveLength(1);
    expect(header(inbox[0].data, 'Subject')).toBe(
      'Flui Contratos — seu processo voltou para Cadastro',
    );
  });

  it('SMTP down: the message stays queued with the error, and goes out on a later try', async () => {
    const s = system('cadastro');
    await s.move('analise_credito');
    rejectData = true;
    await expect(s.worker.drain()).resolves.toEqual({
      sent: 0,
      retried: 1,
      failed: 0,
    });
    expect(inbox).toHaveLength(0);
    expect(s.outbox[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(s.outbox[0].last_error).toContain('451');

    // the backoff is over (in the database: next_attempt_at <= now())
    rejectData = false;
    s.outbox[0].due = true;
    await expect(s.worker.drain()).resolves.toEqual({
      sent: 1,
      retried: 0,
      failed: 0,
    });
    expect(inbox).toHaveLength(1);
    expect(s.outbox[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });
});

describe('documents, end to end over SMTP', () => {
  function documents(s: ReturnType<typeof system>) {
    const types = [
      {
        id: 'ty-rg',
        tenantId: TENANT,
        label: 'RG ou CNH',
        category: 'pessoal',
        active: true,
      },
      {
        id: 'ty-hol',
        tenantId: TENANT,
        label: 'Holerite (mês 1)',
        category: 'renda',
        active: true,
      },
    ];
    const doc = {
      id: 'd1',
      tenantId: TENANT,
      processId: 'p1',
      userId: 'c1',
      label: 'Holerite (mês 1)',
      name: 'Holerite (mês 1)',
    };
    return new DocumentsService(
      {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(doc),
        create: jest.fn((x: object) => x),
        save: jest.fn((x: unknown) => Promise.resolve(x)),
      } as unknown as Repository<Document>,
      {
        find: jest.fn().mockResolvedValue(types),
      } as unknown as Repository<DocumentType>,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'p1',
          tenantId: TENANT,
          clientId: 'c1',
          analistaId: 'an1',
        }),
      } as unknown as Repository<Process>,
      {} as Repository<User>,
      {} as never,
      s.dataSource,
      s.messaging,
    );
  }

  it('point 1: requested documents are listed in the e-mail', async () => {
    const s = system('cadastro');
    await documents(s).requestDocuments('p1', ['ty-rg', 'ty-hol'], caller);
    await s.worker.drain();
    expect(header(inbox[0].data, 'Subject')).toBe(
      'Flui Contratos — documentos solicitados',
    );
    expect(plainText(inbox[0].data)).toContain(
      '• RG ou CNH\r\n• Holerite (mês 1)',
    );
  });

  it('a rejected document goes back to the client with the note', async () => {
    const s = system('cadastro');
    await documents(s).update(
      'd1',
      { status: 'rejeitado', notes: 'Documento cortado' },
      caller,
    );
    await s.worker.drain();
    expect(header(inbox[0].data, 'Subject')).toBe(
      'Flui Contratos — documento "Holerite (mês 1)" precisa ser reenviado',
    );
    expect(plainText(inbox[0].data)).toContain('Documento cortado');
  });
});
