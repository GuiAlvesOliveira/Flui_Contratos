import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EscalationService } from '../src/escalation/escalation.service';
import { MessagingService } from '../src/messaging/messaging.service';
import {
  createTestDb,
  describeDb,
  IDS,
  seedTwoTenants,
  type TestDb,
} from './support/test-db';

// PROD-05_v2 — o job de escalação contra PostgreSQL de verdade: o serviço real,
// o MessagingService real gravando na message_outbox e as migrations do projeto.
const config = (days = 7) =>
  ({
    get: (key: string) =>
      key === 'ESCALATION_DAYS'
        ? String(days)
        : key === 'FRONTEND_URL'
          ? 'https://app.exemplo.dev'
          : undefined,
  }) as unknown as ConfigService;

const email = (id: string) => `${id}@e2e.exemplo.dev`;

interface Escalation {
  process_id: string;
  stage: string;
  days_in_stage: number;
  recipient_role: string;
  recipient_ids: string[];
  messages: number;
}
interface Outbox {
  process_id: string;
  event_type: string;
  recipient_role: string;
  recipient: string;
  subject: string;
  text: string;
  tenant_id: string;
}

describeDb(
  'Escalação de processos parados com banco real (e2e, PROD-05_v2)',
  () => {
    let db: TestDb;
    let ds: DataSource;
    let service: EscalationService;
    const messaging = () =>
      new MessagingService(config(), { soon: jest.fn() } as never);

    const escalations = (processId?: string) =>
      ds.query<Escalation[]>(
        `SELECT process_id, stage, days_in_stage, recipient_role, recipient_ids, messages
         FROM process_escalations ${processId ? 'WHERE process_id = $1' : ''} ORDER BY created_at`,
        processId ? [processId] : [],
      );
    const outbox = (processId: string) =>
      ds.query<Outbox[]>(
        `SELECT process_id, event_type, recipient_role, recipient, subject, text, tenant_id
         FROM message_outbox WHERE process_id = $1 ORDER BY created_at`,
        [processId],
      );
    // Processo "na etapa desde" N dias atrás (criação, sem mudança de etapa)
    const age = (id: string, days: number, extra = '') =>
      ds.query(
        `UPDATE processes SET created_at = now() - make_interval(days => $2)${extra} WHERE id = $1`,
        [id, days],
      );
    const newProcess = async (
      tenant: string,
      client: string,
      analista: string | null,
      stage: string,
      days: number,
    ) => {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO processes (id, tenant_id, client_id, analista_id, stage, created_at)
       VALUES ($1, $2, $3, $4, $5, now() - make_interval(days => $6))`,
        [id, tenant, client, analista, stage, days],
      );
      return id;
    };

    beforeAll(async () => {
      db = await createTestDb('escalation');
      ds = db.dataSource;
      await seedTwoTenants(ds);
      service = new EscalationService(ds, messaging(), config());
    }, 60_000);
    afterAll(async () => {
      await db?.drop();
    });

    it('processo parado há mais de 7 dias gera um alerta ao analista, na message_outbox', async () => {
      await age(IDS.processoAna, 10); // parado
      await age(IDS.processoBruno, 2); // recente
      await age(IDS.processoB, 3); // recente (outra assessoria)
      const run = await service.run();
      expect(run).toMatchObject({
        days: 7,
        checked: 1,
        alerted: 1,
        messages: 1,
        failed: 0,
      });
      expect(await escalations(IDS.processoAna)).toEqual([
        {
          process_id: IDS.processoAna,
          stage: 'cadastro',
          days_in_stage: 10,
          recipient_role: 'analista',
          recipient_ids: [IDS.anaA],
          messages: 1,
        },
      ]);
      const [msg] = await outbox(IDS.processoAna);
      expect(msg).toMatchObject({
        event_type: 'process_stalled',
        recipient_role: 'analista',
        recipient: email(IDS.anaA),
        subject: 'Flui — processo parado há 10 dias: Carla Cliente',
        tenant_id: IDS.tenantA,
      });
      expect(msg.text).toContain('está na etapa Cadastro há 10 dias');
      expect(msg.text).toContain('acima do prazo de 7 dias');
    });

    it('processo recente não gera alerta', async () => {
      expect(await escalations(IDS.processoBruno)).toEqual([]);
      expect(await outbox(IDS.processoBruno)).toEqual([]);
      expect(await escalations(IDS.processoB)).toEqual([]);
    });

    it('nova execução do job não duplica o alerta', async () => {
      const run = await service.run();
      expect(run).toMatchObject({ checked: 0, alerted: 0, messages: 0 });
      expect(await escalations(IDS.processoAna)).toHaveLength(1);
      expect(await outbox(IDS.processoAna)).toHaveLength(1);
    });

    it('Assinatura, Inativo e Crédito Recusado não geram alerta; Pendência gera', async () => {
      const isentos = await Promise.all(
        ['assinatura', 'cliente_inativo', 'credito_recusado'].map((stage) =>
          newProcess(IDS.tenantA, IDS.clienteA, IDS.brunoA, stage, 30),
        ),
      );
      const pendencia = await newProcess(
        IDS.tenantA,
        IDS.clienteA,
        IDS.brunoA,
        'processo_pendencia',
        30,
      );
      const run = await service.run();
      expect(run).toMatchObject({ checked: 1, alerted: 1 });
      for (const id of isentos) expect(await escalations(id)).toEqual([]);
      expect((await escalations(pendencia))[0]).toMatchObject({
        stage: 'processo_pendencia',
        recipient_ids: [IDS.brunoA],
      });
    });

    it('a última mudança de etapa reinicia a contagem', async () => {
      const id = await newProcess(
        IDS.tenantA,
        IDS.clienteA,
        IDS.brunoA,
        'analise_credito',
        40,
      );
      await ds.query(
        `INSERT INTO audit_logs (tenant_id, process_id, action, from_state, to_state, created_at)
       VALUES ($1, $2, 'stage_change', 'cadastro', 'analise_credito', now() - interval '2 days')`,
        [IDS.tenantA, id],
      );
      await service.run();
      expect(await escalations(id)).toEqual([]);
    });

    it('processo removido (inativo no sistema) não gera alerta', async () => {
      const id = await newProcess(
        IDS.tenantA,
        IDS.clienteA,
        IDS.brunoA,
        'cadastro',
        20,
      );
      await ds.query(`UPDATE processes SET active = false WHERE id = $1`, [id]);
      await service.run();
      expect(await escalations(id)).toEqual([]);
    });

    it('sem analista responsável, o alerta vai para o gestor — só da própria assessoria', async () => {
      await age(IDS.processoB, 9, ', analista_id = NULL');
      await service.run();
      expect((await escalations(IDS.processoB))[0]).toMatchObject({
        recipient_role: 'gestor',
        recipient_ids: [IDS.gestorB],
      });
      const msgs = await outbox(IDS.processoB);
      expect(
        msgs.map((m) => [m.recipient, m.recipient_role, m.tenant_id]),
      ).toEqual([[email(IDS.gestorB), 'gestor', IDS.tenantB]]);
      expect(msgs[0].text).toContain('não tem analista responsável');
    });

    it('com o analista desativado, os gestores recebem com o motivo', async () => {
      const id = await newProcess(
        IDS.tenantA,
        IDS.clienteA,
        IDS.desativadoA,
        'analise_juridica',
        8,
      );
      await service.run();
      expect((await escalations(id))[0]).toMatchObject({
        recipient_role: 'gestor',
        recipient_ids: [IDS.gestorA],
      });
      const [msg] = await outbox(id);
      expect(msg.recipient).toBe(email(IDS.gestorA));
      expect(msg.text).toContain(
        'O analista responsável (Davi Desativado) está desativado',
      );
    });

    it('duas instâncias da API rodando juntas geram um alerta só (trava por processo)', async () => {
      const ids = await Promise.all(
        [1, 2, 3].map(() =>
          newProcess(IDS.tenantA, IDS.clienteA, IDS.anaA, 'cadastro', 15),
        ),
      );
      // segunda "instância": outra conexão ao mesmo banco, com o próprio serviço
      const other = new DataSource({
        ...ds.options,
        migrations: [],
      });
      await other.initialize();
      try {
        const second = new EscalationService(other, messaging(), config());
        const [a, b] = await Promise.all([service.run(), second.run()]);
        expect(a.alerted + b.alerted).toBe(3);
        for (const id of ids) {
          expect(await escalations(id)).toHaveLength(1);
          expect(await outbox(id)).toHaveLength(1);
        }
      } finally {
        await other.destroy();
      }
    });

    it('depois de 7 dias sem sair da etapa, o processo é alertado de novo', async () => {
      await ds.query(
        `UPDATE process_escalations SET created_at = now() - interval '8 days' WHERE process_id = $1`,
        [IDS.processoAna],
      );
      await service.run();
      const rows = await escalations(IDS.processoAna);
      expect(rows).toHaveLength(2);
      expect(rows[1].days_in_stage).toBe(10);
    });

    it('o alerta e o e-mail são gravados na mesma transação: se a fila falha, nada fica', async () => {
      const id = await newProcess(
        IDS.tenantA,
        IDS.clienteA,
        IDS.anaA,
        'cadastro',
        12,
      );
      const broken = {
        processStalled: jest
          .fn()
          .mockRejectedValue(new Error('fila indisponível')),
      } as unknown as MessagingService;
      const run = await new EscalationService(ds, broken, config()).run();
      expect(run).toMatchObject({ alerted: 0, failed: 1 });
      expect(await escalations(id)).toEqual([]);
      expect(await outbox(id)).toEqual([]);
      // na próxima execução normal o processo é alertado
      await service.run();
      expect(await escalations(id)).toHaveLength(1);
    });
  },
);
