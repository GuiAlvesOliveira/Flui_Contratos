import { Test } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import * as zlib from 'zlib';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { DashboardController } from '../src/dashboard/dashboard.controller';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import {
  createTestDb,
  describeDb,
  IDS,
  seedTwoTenants,
  type TestDb,
} from './support/test-db';

// PROD-03 — Relatórios pelo controller real, RolesGuard e a ValidationPipe do
// main.ts; um guard de teste coloca na requisição o usuário do cabeçalho x-as.
const users: Record<string, object> = {
  gestorA: { tenantId: IDS.tenantA, userId: IDS.gestorA, role: 'dono' },
  ana: { tenantId: IDS.tenantA, userId: IDS.anaA, role: 'analista' },
  clienteA: { tenantId: IDS.tenantA, userId: IDS.clienteA, role: 'cliente' },
  gestorB: { tenantId: IDS.tenantB, userId: IDS.gestorB, role: 'dono' },
};

class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user: unknown }>();
    req.user = users[req.headers['x-as']];
    return true;
  }
}

async function makeApp(providers: object[]): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ReportsController, DashboardController],
    providers: [
      ...(providers as never[]),
      { provide: APP_GUARD, useClass: FakeAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

// Lê as planilhas de um .xlsx (zip): nome do arquivo → XML
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
    const comp = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26);
    out.set(
      name,
      zlib.inflateRawSync(buf.subarray(start, start + comp)).toString('utf8'),
    );
    p += 46 + nameLen;
  }
  return out;
}
// Linhas de uma aba: cada célula como texto ou número
function rowsOf(xml: string): (string | number)[][] {
  return [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map(([, cells]) =>
    [
      ...cells.matchAll(
        /<c r="[A-Z]+\d+"[^>]*?(?:t="inlineStr"[^>]*)?>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/g,
      ),
    ].map(([, v, t]) =>
      v !== undefined
        ? Number(v)
        : t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
    ),
  );
}
const binary = (
  res: request.Response,
  cb: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Relatórios — papéis e validação (e2e, PROD-03)', () => {
  let app: INestApplication<App>;
  const reports = {
    ranking: jest.fn().mockResolvedValue({ days: 30, analistas: [] }),
    export: jest.fn().mockResolvedValue({
      file: Buffer.from('%PDF-1.4'),
      fileName: 'relatorio.pdf',
      contentType: 'application/pdf',
    }),
  };
  beforeAll(async () => {
    app = await makeApp([
      { provide: ReportsService, useValue: reports },
      {
        provide: DashboardService,
        useValue: { summary: jest.fn(), byAnalista: jest.fn() },
      },
    ]);
  });
  beforeEach(() => Object.values(reports).forEach((fn) => fn.mockClear()));
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  it('analista e cliente recebem 403 no ranking e na exportação', async () => {
    for (const as of ['ana', 'clienteA']) {
      await http().get('/reports/ranking').set('x-as', as).expect(403);
      await http()
        .get('/reports/export?format=xlsx')
        .set('x-as', as)
        .expect(403);
    }
    expect(reports.ranking).not.toHaveBeenCalled();
    expect(reports.export).not.toHaveBeenCalled();
  });

  it('o gestor exporta: tipo, nome do arquivo e sem cache', async () => {
    const res = await http()
      .get('/reports/export?format=pdf&days=90')
      .set('x-as', 'gestorA')
      .expect(200);
    expect(reports.export).toHaveBeenCalledWith(users.gestorA, 'pdf', '90');
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="relatorio.pdf"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['sem formato', '/reports/export'],
    ['formato desconhecido', '/reports/export?format=csv'],
    ['dias que não são número', '/reports/ranking?days=abc'],
    ['parâmetro desconhecido', '/reports/ranking?tenantId=outra'],
  ])('recusa %s (400)', async (_c, url) => {
    await http().get(url).set('x-as', 'gestorA').expect(400);
  });
});

describeDb(
  'Relatórios — mesmos números da tela e isolamento, com banco real (e2e, PROD-03)',
  () => {
    let db: TestDb;
    let app: INestApplication<App>;
    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      db = await createTestDb('reports');
      const ds = db.dataSource;
      await seedTwoTenants(ds);
      // Alfa: processo da Ana chegou à assinatura em 3 passos; o do Bruno andou 1 etapa
      const step = (
        tenant: string,
        process: string,
        from: string,
        to: string,
        daysAgo: number,
      ) =>
        ds.query(
          `INSERT INTO audit_logs (tenant_id, process_id, action, from_state, to_state, created_at)
         VALUES ($1, $2, 'stage_change', $3, $4, now() - make_interval(days => $5))`,
          [tenant, process, from, to, daysAgo],
        );
      await ds.query(
        `UPDATE processes SET created_at = now() - interval '20 days', stage = 'assinatura' WHERE id = $1`,
        [IDS.processoAna],
      );
      await step(IDS.tenantA, IDS.processoAna, 'inicial', 'cadastro', 18);
      await step(IDS.tenantA, IDS.processoAna, 'cadastro', 'cartorio', 10);
      await step(IDS.tenantA, IDS.processoAna, 'cartorio', 'assinatura', 4);
      await ds.query(
        `UPDATE processes SET created_at = now() - interval '12 days' WHERE id = $1`,
        [IDS.processoBruno],
      );
      await step(
        IDS.tenantA,
        IDS.processoBruno,
        'cadastro',
        'analise_credito',
        6,
      );
      // Beta: duas assinaturas que não podem aparecer para a Alfa
      await step(IDS.tenantB, IDS.processoB, 'cartorio', 'assinatura', 2);
      await step(IDS.tenantB, IDS.processoB, 'cartorio', 'assinatura', 1);
      app = await makeApp([
        ReportsService,
        DashboardService,
        { provide: DataSource, useValue: ds },
      ]);
    }, 60_000);
    afterAll(async () => {
      await app?.close();
      await db?.drop();
    });

    interface Ranking {
      analistaId: string | null;
      name: string;
      signed: number;
      activeProcesses: number;
      avgDays: number | null;
    }
    interface Summary {
      totals: { processes: number; averageTicket: number | null };
      period: { newProcesses: number; signed: number };
      funnel: { reached: number; pctOfTotal: number }[];
    }

    it('ranking só com analistas da própria assessoria e os números do período', async () => {
      const a = (
        await http()
          .get('/reports/ranking?days=30')
          .set('x-as', 'gestorA')
          .expect(200)
      ).body as { analistas: Ranking[] };
      expect(
        a.analistas.map((r) => [r.name, r.signed, r.activeProcesses]),
      ).toEqual([
        ['Ana', 1, 1],
        ['Bruno', 0, 1],
      ]);
      // Ana: 2 dias em Primeiro Contato, 8 em Cadastro e 6 em Cartório → média 5,3
      expect(a.analistas[0].avgDays).toBe(5.3);
      const b = (
        await http()
          .get('/reports/ranking?days=30')
          .set('x-as', 'gestorB')
          .expect(200)
      ).body as { analistas: Ranking[] };
      expect(b.analistas.map((r) => [r.name, r.signed])).toEqual([
        ['Bia Beta', 2],
      ]);
      const ids = b.analistas.map((r) => r.analistaId);
      expect(ids).not.toContain(IDS.anaA);
    });

    it('a planilha exportada tem exatamente os números da tela (summary + ranking)', async () => {
      const summary = (
        await http()
          .get('/dashboard/summary?days=30')
          .set('x-as', 'gestorA')
          .expect(200)
      ).body as Summary;
      const ranking = (
        await http()
          .get('/reports/ranking?days=30')
          .set('x-as', 'gestorA')
          .expect(200)
      ).body as { analistas: Ranking[] };
      const res = await http()
        .get('/reports/export?format=xlsx&days=30')
        .set('x-as', 'gestorA')
        .buffer(true)
        .parse(binary)
        .expect(200);
      const files = unzip(res.body as Buffer);
      const resumo = rowsOf(files.get('xl/worksheets/sheet1.xml')!);
      const funil = rowsOf(files.get('xl/worksheets/sheet2.xml')!);
      const rank = rowsOf(files.get('xl/worksheets/sheet4.xml')!);
      const value = (label: string) => resumo.find((r) => r[0] === label)?.[1];
      expect(value('Processos ativos')).toBe(summary.totals.processes);
      expect(value('Contratos assinados no período')).toBe(
        summary.period.signed,
      );
      expect(value('Processos novos no período')).toBe(
        summary.period.newProcesses,
      );
      expect(funil.slice(1).map((r) => [r[1], r[2]])).toEqual(
        summary.funnel.map((f) => [f.reached, f.pctOfTotal]),
      );
      expect(rank.slice(1).map((r) => [r[1], r[2], r[3]])).toEqual(
        ranking.analistas.map((r) => [r.name, r.signed, r.activeProcesses]),
      );
      expect(summary.period.signed).toBe(1); // as assinaturas da Beta não entram
      const [audit] = await db.dataSource.query<{ n: string }[]>(
        `SELECT count(*) AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'report_exported'`,
        [IDS.tenantA],
      );
      expect(Number(audit.n)).toBe(1);
    });

    it('o PDF exportado é da própria assessoria', async () => {
      const res = await http()
        .get('/reports/export?format=pdf&days=30')
        .set('x-as', 'gestorB')
        .buffer(true)
        .parse(binary)
        .expect(200);
      const pdf = res.body as Buffer;
      expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
      const text = pdf.toString('latin1');
      const streams = [...text.matchAll(/>>\nstream\n/g)]
        .map((m) => {
          const start = m.index + m[0].length;
          return zlib
            .inflateSync(
              pdf.subarray(start, text.indexOf('\nendstream', start)),
            )
            .toString('latin1');
        })
        .join('');
      // cada texto do PDF é uma string <hex> inteira: compara a célula completa
      const hex = (s: string) =>
        `<${Buffer.from(s, 'latin1').toString('hex')}>`;
      expect(streams).toContain(hex('Assessoria Beta'));
      expect(streams).toContain(hex('Bia Beta'));
      expect(streams).not.toContain(hex('Assessoria Alfa'));
      expect(streams).not.toContain(hex('Ana'));
    });
  },
);
