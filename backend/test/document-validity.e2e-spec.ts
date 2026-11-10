import { randomUUID } from 'crypto';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RequestUserFull } from '../src/auth/supabase.guard';
import { DocumentExpiryService } from '../src/document-expiry/document-expiry.service';
import { Document } from '../src/documents/document.entity';
import { DocumentType } from '../src/documents/document-type.entity';
import {
  computeValidUntil,
  todayInSaoPaulo,
} from '../src/documents/document-validity';
import { DocumentsService } from '../src/documents/documents.service';
import { MessagingService } from '../src/messaging/messaging.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { Process } from '../src/processes/process.entity';
import { ProcessesService } from '../src/processes/processes.service';
import { User } from '../src/users/user.entity';
import {
  createTestDb,
  describeDb,
  IDS,
  seedTwoTenants,
  type TestDb,
  undoMigrationsThrough,
} from './support/test-db';

// Validade de documentos pelo mês de referência com PostgreSQL de verdade:
// migrations do projeto, serviços reais (documentos, processos, notificações e
// a rotina diária) e duas assessorias para o isolamento.
const who = (tenantId: string, userId: string, role: string) =>
  ({ tenantId, userId, role }) as RequestUserFull;
const gestorA = who(IDS.tenantA, IDS.gestorA, 'dono');
const ana = who(IDS.tenantA, IDS.anaA, 'analista');
const bruno = who(IDS.tenantA, IDS.brunoA, 'analista');
const clienteA = who(IDS.tenantA, IDS.clienteA, 'cliente');
const gestorB = who(IDS.tenantB, IDS.gestorB, 'dono');
const analistaB = who(IDS.tenantB, IDS.analistaB, 'analista');
const clienteB = who(IDS.tenantB, IDS.clienteB, 'cliente');
// segunda cliente da assessoria A, com processo próprio (isolamento entre clientes)
const OUTRA_CLIENTE = 'a2000000-0000-4000-8000-000000000021';
const PROCESSO_OUTRA = 'a3000000-0000-4000-8000-000000000021';
const outraCliente = who(IDS.tenantA, OUTRA_CLIENTE, 'cliente');

const TODAY = todayInSaoPaulo();
const THIS_MONTH = TODAY.slice(0, 7);
const addDays = (n: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
const shiftMonth = (n: number) => {
  const [y, m] = THIS_MONTH.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

interface NotificationRow {
  id: string;
  tenant_id: string;
  process_id: string;
  recipient_id: string;
  document_id: string;
  kind: string;
  message: string;
  valid_until: string;
  read_at: Date | null;
  resolved_at: Date | null;
}

describeDb('Validade de documentos com banco real (e2e)', () => {
  let db: TestDb;
  let docs: DocumentsService;
  let processes: ProcessesService;
  let notifications: NotificationsService;
  let expiry: DocumentExpiryService;
  const ds = () => db.dataSource;
  const config = {
    get: (k: string) =>
      k === 'FRONTEND_URL' ? 'https://app.exemplo.dev' : undefined,
  } as unknown as ConfigService;
  const types: Record<string, string> = {};

  const newType = async (
    tenant: string,
    label: string,
    category: string,
    months: number | null,
  ) => {
    const [{ id }] = await ds().query<{ id: string }[]>(
      `INSERT INTO document_types (tenant_id, label, category, validity_months)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenant, label, category, months],
    );
    return id;
  };
  const newDoc = async (o: {
    tenant?: string;
    processId: string | null;
    userId: string;
    label: string;
    typeId?: string | null;
    status?: string;
    validUntil?: string | null;
  }) => {
    const id = randomUUID();
    await ds().query(
      `INSERT INTO documents (id, tenant_id, process_id, user_id, name, label, category,
                              document_type_id, status, validated, valid_until, reference_month, validity_months)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $10, $9::date,
               CASE WHEN $9::date IS NULL THEN NULL ELSE date_trunc('month', $9::date - interval '2 months')::date END,
               CASE WHEN $9::date IS NULL THEN NULL ELSE 3 END)`,
      [
        id,
        o.tenant ?? IDS.tenantA,
        o.processId,
        o.userId,
        o.label,
        o.processId ? 'renda' : 'pessoal',
        o.typeId ?? null,
        o.status ?? 'validado',
        o.validUntil ?? null,
        (o.status ?? 'validado') === 'validado',
      ],
    );
    return id;
  };
  const notes = (documentId: string) =>
    ds().query<NotificationRow[]>(
      `SELECT id, tenant_id, process_id, recipient_id, document_id, kind, message,
              valid_until::text AS valid_until, read_at, resolved_at
         FROM notifications WHERE document_id = $1 ORDER BY created_at, recipient_id`,
      [documentId],
    );
  const audit = (documentId: string, action: string) =>
    ds().query<
      {
        process_id: string;
        actor_id: string | null;
        metadata: Record<string, unknown>;
      }[]
    >(
      `SELECT process_id, actor_id, metadata FROM audit_logs
        WHERE action = $1 AND metadata->>'docId' = $2 ORDER BY created_at`,
      [action, documentId],
    );
  const docRow = async (id: string) =>
    (
      await ds().query<
        {
          status: string;
          reference_month: string | null;
          valid_until: string | null;
          expired_at: Date | null;
          reference_month_set_by: string | null;
        }[]
      >(
        `SELECT status, reference_month::text AS reference_month, valid_until::text AS valid_until,
                expired_at, reference_month_set_by
           FROM documents WHERE id = $1`,
        [id],
      )
    )[0];

  // Lista de documentos da assessoria B como existia antes da migration (o
  // teste da migration confere os valores iniciais aplicados a ela)
  const LEGACY_CATALOG = [
    'RG ou CNH',
    'Comprovante de Endereço',
    'Holerite (mês 2)',
    'Extrato Bancário (mês 1)',
    'Declaração de IRPF',
  ];
  let legacyDoc: string;

  beforeAll(async () => {
    db = await createTestDb('validade');
    await undoMigrationsThrough(ds(), 'AddDocumentValidity1718502200000');
    await seedTwoTenants(ds());
    for (const label of LEGACY_CATALOG) {
      await ds().query(
        `INSERT INTO document_types (tenant_id, label, category) VALUES ($1, $2, 'renda')`,
        [IDS.tenantB, label],
      );
    }
    [{ id: legacyDoc }] = await ds().query<{ id: string }[]>(
      `INSERT INTO documents (tenant_id, process_id, user_id, name, label, status, validated)
       VALUES ($1, $2, $3, 'Holerite (mês 2)', 'Holerite (mês 2)', 'validado', true)
       RETURNING id`,
      [IDS.tenantB, IDS.processoB, IDS.clienteB],
    );
    await ds().runMigrations();
    await ds().query(
      `INSERT INTO users (id, tenant_id, role, name, email, status, onboarding_completed)
       VALUES ($1, $2, 'cliente', 'Olga Outra', 'olga@e2e.exemplo.dev', 'active', true)`,
      [OUTRA_CLIENTE, IDS.tenantA],
    );
    await ds().query(
      `INSERT INTO processes (id, tenant_id, client_id, analista_id, stage)
       VALUES ($1, $2, $3, $4, 'cadastro')`,
      [PROCESSO_OUTRA, IDS.tenantA, OUTRA_CLIENTE, IDS.anaA],
    );
    types.holerite = await newType(IDS.tenantA, 'Holerite (mês 1)', 'renda', 3);
    types.extrato = await newType(
      IDS.tenantA,
      'Extrato Bancário (mês 1)',
      'renda',
      6,
    );
    types.endereco = await newType(
      IDS.tenantA,
      'Comprovante de Endereço',
      'pessoal',
      3,
    );
    types.rg = await newType(IDS.tenantA, 'RG ou CNH', 'pessoal', null);
    [{ id: types.extratoB }] = await ds().query<{ id: string }[]>(
      `SELECT id FROM document_types WHERE tenant_id = $1 AND label = 'Extrato Bancário (mês 1)'`,
      [IDS.tenantB],
    );

    const messaging = new MessagingService(config, {
      soon: jest.fn(),
    } as never);
    const storage = { isAvailable: false } as never;
    docs = new DocumentsService(
      ds().getRepository(Document),
      ds().getRepository(DocumentType),
      ds().getRepository(Process),
      ds().getRepository(User),
      storage,
      ds(),
      messaging,
    );
    processes = new ProcessesService(
      ds().getRepository(Process),
      ds().getRepository(User),
      ds(),
      messaging,
    );
    notifications = new NotificationsService(ds());
    expiry = new DocumentExpiryService(ds());
  }, 90_000);
  afterAll(async () => {
    await db?.drop();
  }, 60_000);

  describe('migration', () => {
    it('valores iniciais por nome do item: holerite e comprovante de endereço 3 meses, extrato 6; o resto sem prazo', async () => {
      const rows = await ds().query<
        { label: string; validity_months: number | null }[]
      >(
        `SELECT label, validity_months FROM document_types WHERE tenant_id = $1 ORDER BY label`,
        [IDS.tenantB],
      );
      expect(rows).toEqual([
        { label: 'Comprovante de Endereço', validity_months: 3 },
        { label: 'Declaração de IRPF', validity_months: null },
        { label: 'Extrato Bancário (mês 1)', validity_months: 6 },
        { label: 'Holerite (mês 2)', validity_months: 3 },
        { label: 'RG ou CNH', validity_months: null },
      ]);
      // documento já validado continua sem mês: nunca vence sozinho
      expect(await docRow(legacyDoc)).toMatchObject({
        status: 'validado',
        reference_month: null,
        valid_until: null,
        expired_at: null,
      });
    });
  });

  describe('mês de referência na validação', () => {
    it('sem o mês o analista não aprova; no futuro também não; com o mês grava o vencimento e o histórico', async () => {
      const id = await newDoc({
        processId: IDS.processoAna,
        userId: IDS.clienteA,
        label: 'Holerite (mês 1)',
        typeId: types.holerite,
        status: 'recebido',
      });
      await ds().query(
        `INSERT INTO document_versions (tenant_id, document_id, version, blob_path, uploaded_by)
         VALUES ($1, $2, 1, 'local://x.pdf', $3)`,
        [IDS.tenantA, id, IDS.clienteA],
      );

      await expect(
        docs.update(id, { status: 'validado' }, ana),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        docs.update(
          id,
          { status: 'validado', referenceMonth: shiftMonth(1) },
          ana,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        docs.update(id, { status: 'validado', referenceMonth: '2020-01' }, ana),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect((await docRow(id)).status).toBe('recebido'); // nada mudou

      await docs.update(
        id,
        { status: 'validado', referenceMonth: THIS_MONTH },
        ana,
      );
      const until = computeValidUntil(THIS_MONTH, 3);
      expect(await docRow(id)).toMatchObject({
        status: 'validado',
        reference_month: `${THIS_MONTH}-01`,
        valid_until: until,
        expired_at: null,
        reference_month_set_by: IDS.anaA,
      });
      const [version] = await ds().query<
        { reference_month: string; valid_until: string; status: string }[]
      >(
        `SELECT reference_month::text AS reference_month, valid_until::text AS valid_until, status
           FROM document_versions WHERE document_id = $1`,
        [id],
      );
      expect(version).toEqual({
        reference_month: `${THIS_MONTH}-01`,
        valid_until: until,
        status: 'validado',
      });
      const [log] = await audit(id, 'document_validated');
      expect(log).toEqual({
        process_id: IDS.processoAna,
        actor_id: IDS.anaA,
        metadata: {
          docId: id,
          label: 'Holerite (mês 1)',
          referenceMonth: THIS_MONTH,
          validUntil: until,
          validityMonths: 3,
        },
      });
    });

    it('tipo sem prazo (RG) é validado sem mês, como antes', async () => {
      const id = await newDoc({
        processId: null,
        userId: IDS.clienteA,
        label: 'RG ou CNH',
        typeId: types.rg,
        status: 'recebido',
      });
      await docs.update(
        id,
        { status: 'validado', processId: IDS.processoAna },
        ana,
      );
      expect(await docRow(id)).toMatchObject({
        status: 'validado',
        valid_until: null,
      });
      // documento pessoal: registrado no processo aberto na tela
      expect((await audit(id, 'document_validated'))[0].process_id).toBe(
        IDS.processoAna,
      );
    });

    it('a equipe de outra assessoria não valida (404)', async () => {
      const id = await newDoc({
        processId: IDS.processoAna,
        userId: IDS.clienteA,
        label: 'Holerite (mês 1)',
        typeId: types.holerite,
        status: 'recebido',
      });
      await expect(
        docs.update(
          id,
          { status: 'validado', referenceMonth: THIS_MONTH },
          gestorB,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect((await docRow(id)).status).toBe('recebido');
    });
  });

  describe('rotina diária', () => {
    it('faltando 15 dias: aviso "vencendo" ao cliente e ao analista, registrado no histórico; rodar de novo não repete', async () => {
      const id = await newDoc({
        processId: IDS.processoAna,
        userId: IDS.clienteA,
        label: 'Extrato Bancário (mês 1)',
        typeId: types.extrato,
        validUntil: addDays(15),
      });
      await expiry.run();
      const created = await notes(id);
      expect(
        created.map((n) => [n.recipient_id, n.kind, n.process_id, n.tenant_id]),
      ).toEqual(
        expect.arrayContaining([
          [IDS.clienteA, 'document_expiring', IDS.processoAna, IDS.tenantA],
          [IDS.anaA, 'document_expiring', IDS.processoAna, IDS.tenantA],
        ]),
      );
      expect(created).toHaveLength(2);
      const toClient = created.find((n) => n.recipient_id === IDS.clienteA)!;
      expect(toClient.message).toContain(
        'Seu documento "Extrato Bancário (mês 1)" vence em 15 dias',
      );
      expect(toClient.message).toContain('Envie um documento mais recente.');
      expect(await audit(id, 'document_expiry_notice')).toHaveLength(2);
      expect((await docRow(id)).expired_at).toBeNull();

      await expiry.run();
      await expiry.run();
      expect(await notes(id)).toHaveLength(2);
      expect(await audit(id, 'document_expiry_notice')).toHaveLength(2);
    });

    it('duas execuções ao mesmo tempo (duas instâncias da API) não duplicam o aviso', async () => {
      const ids = await Promise.all(
        [3, 7, 12].map((d) =>
          newDoc({
            processId: IDS.processoBruno,
            userId: IDS.clienteA,
            label: `Holerite (paralelo ${d})`,
            typeId: types.holerite,
            validUntil: addDays(d),
          }),
        ),
      );
      await Promise.all([expiry.run(), expiry.run(), expiry.run()]);
      for (const id of ids) {
        const created = await notes(id);
        expect(created.map((n) => n.recipient_id).sort()).toEqual(
          [IDS.brunoA, IDS.clienteA].sort(),
        );
      }
    });

    it('vencido: marca o documento, gera a pendência (RN-04 trava) e avisa "vencido" uma vez', async () => {
      // processo do Bruno está em Análise de Crédito: avançar exige documentos válidos
      const id = await newDoc({
        processId: IDS.processoBruno,
        userId: IDS.clienteA,
        label: 'Extrato Bancário (mês 2)',
        typeId: types.extrato,
        validUntil: addDays(-1),
      });
      await expiry.run();
      const row = await docRow(id);
      expect(row.expired_at).not.toBeNull();
      expect(row.status).toBe('validado'); // a validação continua no histórico
      const created = await notes(id);
      expect(created.map((n) => [n.recipient_id, n.kind]).sort()).toEqual(
        [
          [IDS.brunoA, 'document_expired'],
          [IDS.clienteA, 'document_expired'],
        ].sort(),
      );
      expect(
        created.find((n) => n.recipient_id === IDS.clienteA)!.message,
      ).toBe(
        `Seu documento "Extrato Bancário (mês 2)" está vencido (valia até ${addDays(-1).split('-').reverse().join('/')}). Envie um documento mais recente para o processo continuar.`,
      );
      expect(await audit(id, 'document_expired')).toEqual([
        {
          process_id: IDS.processoBruno,
          actor_id: null,
          metadata: {
            docId: id,
            label: 'Extrato Bancário (mês 2)',
            validUntil: addDays(-1),
          },
        },
      ]);
      await expiry.run();
      expect(await notes(id)).toHaveLength(2);
      expect(await audit(id, 'document_expired')).toHaveLength(1);

      const attempt = processes.advanceStage(
        IDS.processoBruno,
        { toStage: 'credito_aprovado' },
        bruno,
      );
      await expect(attempt).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      const err = (await processes
        .advanceStage(IDS.processoBruno, { toStage: 'credito_aprovado' }, bruno)
        .catch((e: UnprocessableEntityException) => e.getResponse())) as {
        message: string;
        pendingDocs: { label: string; status: string }[];
      };
      expect(err.message).toContain('documento(s) vencido(s)');
      expect(err.pendingDocs).toContainEqual({
        label: 'Extrato Bancário (mês 2)',
        status: 'vencido',
      });
    });

    it('o mesmo documento novo, validado com outro mês, recomeça a contagem: pendência resolvida e avisos antigos resolvidos', async () => {
      const id = await newDoc({
        processId: IDS.processoBruno,
        userId: IDS.clienteA,
        label: 'Holerite (mês 3)',
        typeId: types.holerite,
        validUntil: addDays(-2),
      });
      await expiry.run();
      expect((await notes(id)).every((n) => n.resolved_at === null)).toBe(true);

      // o cliente envia um holerite novo (nova versão) e o analista valida com o mês atual
      await ds().query(
        `UPDATE documents SET status = 'recebido', validated = false WHERE id = $1`,
        [id],
      );
      await docs.update(
        id,
        { status: 'validado', referenceMonth: THIS_MONTH },
        bruno,
      );
      const row = await docRow(id);
      expect(row).toMatchObject({
        valid_until: computeValidUntil(THIS_MONTH, 3),
        expired_at: null,
      });
      const after = await notes(id);
      expect(after.length).toBeGreaterThan(0);
      expect(after.every((n) => n.resolved_at !== null)).toBe(true);
      // o cliente não vê mais o aviso como pendente
      const { alerts } = await notifications.list(clienteA);
      expect(
        alerts.filter((a) => a.documentId === id).every((a) => a.resolved),
      ).toBe(true);
    });

    it('documento antigo sem mês de referência nunca é marcado como vencido', async () => {
      const id = await newDoc({
        processId: IDS.processoAna,
        userId: IDS.clienteA,
        label: 'Holerite antigo',
        typeId: types.holerite,
        validUntil: null,
      });
      await ds().query(
        `UPDATE documents SET created_at = now() - interval '2 years' WHERE id = $1`,
        [id],
      );
      await expiry.run();
      expect(await docRow(id)).toMatchObject({
        expired_at: null,
        valid_until: null,
      });
      expect(await notes(id)).toEqual([]);
      // e aparece para o analista como "mês de referência não informado"
      const list = await docs.getForProcess(IDS.processoAna, ana);
      expect(list.find((d) => d.id === id)).toMatchObject({
        validityStatus: 'sem_referencia',
      });
    });

    it('comprovante de endereço (pessoal): avisa o analista de cada processo do cliente', async () => {
      const id = await newDoc({
        processId: null,
        userId: IDS.clienteA,
        label: 'Comprovante de Endereço',
        typeId: types.endereco,
        validUntil: addDays(5),
      });
      await expiry.run();
      const created = await notes(id);
      expect(created.map((n) => n.recipient_id).sort()).toEqual(
        [IDS.anaA, IDS.brunoA, IDS.clienteA].sort(),
      );
      expect(created.find((n) => n.recipient_id === IDS.anaA)!.process_id).toBe(
        IDS.processoAna,
      );
      expect(
        created.find((n) => n.recipient_id === IDS.brunoA)!.process_id,
      ).toBe(IDS.processoBruno);
    });

    it('processo encerrado (Assinatura) ou removido não gera aviso', async () => {
      const assinado = randomUUID();
      await ds().query(
        `INSERT INTO processes (id, tenant_id, client_id, analista_id, stage) VALUES ($1, $2, $3, $4, 'assinatura')`,
        [assinado, IDS.tenantA, OUTRA_CLIENTE, IDS.anaA],
      );
      const removido = randomUUID();
      await ds().query(
        `INSERT INTO processes (id, tenant_id, client_id, analista_id, stage, active) VALUES ($1, $2, $3, $4, 'cadastro', false)`,
        [removido, IDS.tenantA, OUTRA_CLIENTE, IDS.anaA],
      );
      const a = await newDoc({
        processId: assinado,
        userId: OUTRA_CLIENTE,
        label: 'Holerite',
        typeId: types.holerite,
        validUntil: addDays(-3),
      });
      const b = await newDoc({
        processId: removido,
        userId: OUTRA_CLIENTE,
        label: 'Holerite',
        typeId: types.holerite,
        validUntil: addDays(2),
      });
      await expiry.run();
      expect(await notes(a)).toEqual([]);
      expect(await notes(b)).toEqual([]);
      expect((await docRow(a)).expired_at).toBeNull();
    });
  });

  describe('isolamento entre assessorias e entre clientes', () => {
    let docA: string;
    let docOutra: string;
    let docB: string;

    beforeAll(async () => {
      docA = await newDoc({
        processId: IDS.processoAna,
        userId: IDS.clienteA,
        label: 'Extrato (isolamento A)',
        typeId: types.extrato,
        validUntil: addDays(-4),
      });
      docOutra = await newDoc({
        processId: PROCESSO_OUTRA,
        userId: OUTRA_CLIENTE,
        label: 'Extrato (isolamento Olga)',
        typeId: types.extrato,
        validUntil: addDays(9),
      });
      docB = await newDoc({
        tenant: IDS.tenantB,
        processId: IDS.processoB,
        userId: IDS.clienteB,
        label: 'Extrato (isolamento B)',
        typeId: types.extratoB,
        validUntil: addDays(-4),
      });
      await expiry.run();
    });

    const alertDocs = async (caller: RequestUserFull) =>
      (await notifications.list(caller)).alerts.map((a) => a.documentId);

    it('cada aviso fica na assessoria do documento', async () => {
      for (const n of await notes(docA)) expect(n.tenant_id).toBe(IDS.tenantA);
      for (const n of await notes(docB)) expect(n.tenant_id).toBe(IDS.tenantB);
      expect((await notes(docB)).map((n) => n.recipient_id).sort()).toEqual(
        [IDS.analistaB, IDS.clienteB].sort(),
      );
    });

    it('a outra assessoria não vê avisos, processos nem documentos daqui', async () => {
      for (const caller of [gestorB, analistaB, clienteB]) {
        const seen = await alertDocs(caller);
        expect(seen).not.toContain(docA);
        expect(seen).not.toContain(docOutra);
      }
      expect(await alertDocs(clienteB)).toEqual([docB]);
      const painelB = await expiry.processes(gestorB);
      expect(painelB.processes.map((p) => p.processId)).toEqual([
        IDS.processoB,
      ]);
      const painelA = await expiry.processes(gestorA);
      expect(painelA.processes.map((p) => p.processId)).not.toContain(
        IDS.processoB,
      );
    });

    it('o cliente só vê os avisos e os documentos dos próprios processos', async () => {
      const deA = await alertDocs(clienteA);
      expect(deA).toContain(docA);
      expect(deA).not.toContain(docOutra);
      const daOutra = await alertDocs(outraCliente);
      expect(daOutra).toEqual([docOutra]);
      expect(daOutra).not.toContain(docA);

      const mine = await expiry.mine(outraCliente);
      expect(
        [...mine.expired, ...mine.expiring].map((d) => d.documentId),
      ).toEqual([docOutra]);
      const mineA = await expiry.mine(clienteA);
      expect(mineA.expired.map((d) => d.documentId)).toContain(docA);
      expect(
        [...mineA.expired, ...mineA.expiring].map((d) => d.documentId),
      ).not.toContain(docOutra);
    });

    it('o analista vê só os processos dele no painel; o gestor vê os da assessoria', async () => {
      const deBruno = await expiry.processes(bruno);
      expect(
        deBruno.processes.every((p) => p.processId === IDS.processoBruno),
      ).toBe(true);
      const deAna = await expiry.processes(ana);
      expect(deAna.processes.map((p) => p.processId)).toEqual(
        expect.arrayContaining([IDS.processoAna, PROCESSO_OUTRA]),
      );
      expect(deAna.processes.map((p) => p.processId)).not.toContain(
        IDS.processoBruno,
      );
      const doGestor = await expiry.processes(gestorA);
      expect(doGestor.processes.map((p) => p.processId)).toEqual(
        expect.arrayContaining([
          IDS.processoAna,
          IDS.processoBruno,
          PROCESSO_OUTRA,
        ]),
      );
    });

    it('ninguém marca como lido o aviso de outra pessoa ou de outra assessoria', async () => {
      const [doCliente] = (await notes(docA)).filter(
        (n) => n.recipient_id === IDS.clienteA,
      );
      await notifications.markRead(doCliente.id, gestorB); // outra assessoria
      await notifications.markRead(doCliente.id, outraCliente); // outra cliente
      await notifications.markRead(doCliente.id, ana); // a equipe também não lê pelo cliente
      await notifications.markAllRead(outraCliente);
      await notifications.markAllRead(gestorB);
      expect(
        (await notes(docA)).find((n) => n.id === doCliente.id)!.read_at,
      ).toBeNull();

      await notifications.markRead(doCliente.id, clienteA);
      expect(
        (await notes(docA)).find((n) => n.id === doCliente.id)!.read_at,
      ).not.toBeNull();
    });

    it('o histórico do processo mostra os avisos à equipe, mas o registro de destinatários fica fora do portal', async () => {
      const staff = await processes.getAuditLog(IDS.processoAna, ana);
      expect(staff.some((l) => l.action === 'document_expiry_notice')).toBe(
        true,
      );
      const portal = await processes.getAuditLog(IDS.processoAna, clienteA);
      expect(portal.some((l) => l.action === 'document_expiry_notice')).toBe(
        false,
      );
      expect(portal.some((l) => l.action === 'document_expired')).toBe(true);
      // e o cliente de outra assessoria não abre o processo
      await expect(
        processes.getAuditLog(IDS.processoAna, clienteB),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
