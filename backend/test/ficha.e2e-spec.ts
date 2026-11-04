import { ConfigService } from '@nestjs/config';
import type { RequestUserFull } from '../src/auth/supabase.guard';
import { FichaService } from '../src/ficha/ficha.service';
import { MeService } from '../src/me/me.service';
import { MessagingService } from '../src/messaging/messaging.service';
import { User } from '../src/users/user.entity';
import {
  createTestDb,
  describeDb,
  IDS,
  seedTwoTenants,
  type TestDb,
} from './support/test-db';

// Ficha completa com PostgreSQL de verdade: a equipe preenche os dados do
// cliente, do 2º comprador e do financiamento; pede o que falta ao cliente
// (e-mail na fila na mesma transação) e ele responde só o que foi pedido.
const who = (tenantId: string, userId: string, role: string) =>
  ({ tenantId, userId, role }) as RequestUserFull;
const ana = who(IDS.tenantA, IDS.anaA, 'analista');
const clienteA = who(IDS.tenantA, IDS.clienteA, 'cliente');
const gestorB = who(IDS.tenantB, IDS.gestorB, 'dono');
const clienteB = who(IDS.tenantB, IDS.clienteB, 'cliente');
// erro de regra: confere a mensagem (string ou lista, como o ValidationPipe)
async function rejects(promise: Promise<unknown>, re: RegExp) {
  const err = await promise.then(
    () => null,
    (e: { message?: string; response?: unknown }) => e,
  );
  expect(err).not.toBeNull();
  expect(JSON.stringify(err!.response ?? err!.message)).toMatch(re);
}
const P = IDS.processoAna;
const SEG = 'a4000000-0000-4000-8000-000000000001';
const OUTRO_PROC_PART = 'a4000000-0000-4000-8000-000000000002';

describeDb('Ficha completa com banco real (e2e)', () => {
  let db: TestDb;
  let ficha: FichaService;
  const ds = () => db.dataSource;
  const config = {
    get: (k: string) =>
      k === 'FRONTEND_URL' ? 'https://app.exemplo.dev' : undefined,
  } as unknown as ConfigService;

  beforeAll(async () => {
    db = await createTestDb('ficha');
    await seedTwoTenants(ds());
    await ds().query(
      `INSERT INTO process_participants (id, process_id, tenant_id, name, cpf, declared_income) VALUES
         ($1, $2, $4, 'João Cônjuge', '98765432100', 3000),
         ($3, $5, $4, 'Outro Processo', NULL, 1000)`,
      [SEG, P, OUTRO_PROC_PART, IDS.tenantA, IDS.processoBruno],
    );
    ficha = new FichaService(
      ds(),
      new MessagingService(config, { soon: jest.fn() } as never),
    );
  }, 60_000);
  afterAll(async () => {
    await db?.drop();
  });

  it('a equipe grava cliente, 2º comprador e financiamento numa vez; o endereço antigo é montado das partes', async () => {
    const out = await ficha.patchFicha(
      P,
      {
        processo: {
          segundoCompradorId: SEG,
          usaFgts: true,
          percentualAquisicao1: '60',
          seguradora: 'itau',
        },
        cliente: {
          genero: 'feminino',
          profissao: 'Engenheira',
          estadoCivil: 'casado',
          regimeBens: 'comunhao_parcial',
          dataCasamento: '2015-05-10',
          logradouro: 'Rua das Flores',
          numero: '12',
          bairro: 'Centro',
          cidade: 'São Paulo',
          uf: 'sp',
          cep: '01310-100',
          telefoneComercial: '(11) 3333-4444',
        },
        segundo: {
          genero: 'masculino',
          dataNascimento: '1988-01-02',
          email: 'Joao@Exemplo.dev',
          estadoCivil: 'casado',
        },
      },
      ana,
    );
    expect(out.processo).toMatchObject({
      segundoCompradorId: SEG,
      usaFgts: true,
      percentualAquisicao1: 60,
      seguradora: 'itau',
    });
    expect(out.cliente).toMatchObject({
      genero: 'feminino',
      uf: 'SP',
      cep: '01310100',
      estadoCivil: 'casado',
    });
    expect(out.segundo).toMatchObject({
      id: SEG,
      nome: 'João Cônjuge',
      email: 'joao@exemplo.dev',
      dataNascimento: '1988-01-02',
    });

    const [u] = await ds().query<
      { endereco: string; estado_civil: string; telefone_comercial: string }[]
    >(
      `SELECT endereco, estado_civil, telefone_comercial FROM users WHERE id = $1`,
      [IDS.clienteA],
    );
    expect(u).toEqual({
      endereco: 'Rua das Flores, 12, Centro, São Paulo - SP',
      estado_civil: 'casado',
      telefone_comercial: '1133334444',
    });
    const [p] = await ds().query<{ estado_civil: string }[]>(
      `SELECT estado_civil FROM processes WHERE id = $1`,
      [P],
    );
    expect(p.estado_civil).toBe('casado');
  });

  it('RN-07: a edição fica no log com as chaves, nunca com os valores pessoais', async () => {
    const [log] = await ds().query<
      { actor_id: string; metadata: { fields: string[] } }[]
    >(
      `SELECT actor_id, metadata FROM audit_logs WHERE process_id = $1 AND action = 'ficha_updated' ORDER BY created_at DESC LIMIT 1`,
      [P],
    );
    expect(log.actor_id).toBe(IDS.anaA);
    expect(log.metadata.fields).toEqual(
      expect.arrayContaining([
        'cliente.profissao',
        'segundo.email',
        'processo.usaFgts',
      ]),
    );
    expect(JSON.stringify(log.metadata)).not.toMatch(
      /Engenheira|exemplo\.dev|Flores/,
    );
  });

  it('valida tudo antes de gravar: um campo errado não salva nenhum', async () => {
    await rejects(
      ficha.patchFicha(
        P,
        { cliente: { profissao: 'Médica', cep: '123' } },
        ana,
      ),
      /CEP: o CEP tem 8 dígitos/,
    );
    await rejects(
      ficha.patchFicha(P, { cliente: { email: 'x@y.dev' } }, ana),
      /não permitido/,
    );
    const [u] = await ds().query<{ profissao: string }[]>(
      `SELECT profissao FROM users WHERE id = $1`,
      [IDS.clienteA],
    );
    expect(u.profissao).toBe('Engenheira');
  });

  it('o 2º comprador precisa ser participante do próprio processo', async () => {
    await rejects(
      ficha.patchFicha(
        P,
        { processo: { segundoCompradorId: OUTRO_PROC_PART } },
        ana,
      ),
      /participante deste processo/,
    );
  });

  it('RN-01: outra assessoria não lê nem grava a ficha', async () => {
    await rejects(ficha.getFicha(P, gestorB), /Processo não encontrado/);
    await rejects(
      ficha.patchFicha(P, { cliente: { profissao: 'X' } }, gestorB),
      /Processo não encontrado/,
    );
  });

  it('pedido de dados: aviso ao cliente na fila e no log, na mesma transação', async () => {
    const req = await ficha.createRequest(
      P,
      {
        fields: [
          'cliente.filiacao1',
          'segundo.profissao',
          'processo.bancoConta',
        ],
        note: 'para o Itaú',
      },
      ana,
    );
    expect(req.labels).toEqual([
      'Nome da mãe ou do pai (1)',
      '2º comprador: Profissão ou principal atividade',
      'Conta corrente (conta para débito)',
    ]);
    const outbox = await ds().query<
      { event_type: string; recipient: string }[]
    >(
      `SELECT event_type, recipient FROM message_outbox WHERE process_id = $1 AND event_type = 'data_requested'`,
      [P],
    );
    expect(outbox).toEqual([
      {
        event_type: 'data_requested',
        recipient: `${IDS.clienteA}@e2e.exemplo.dev`,
      },
    ]);
    const [log] = await ds().query<{ metadata: { labels: string[] } }[]>(
      `SELECT metadata FROM audit_logs WHERE process_id = $1 AND action = 'data_requested'`,
      [P],
    );
    expect(log.metadata.labels).toHaveLength(3);
  });

  it('não dá para pedir campo inexistente nem trocar o 2º comprador pelo cliente', async () => {
    await rejects(
      ficha.createRequest(P, { fields: ['processo.segundoCompradorId'] }, ana),
      /não permitido/,
    );
    await rejects(ficha.createRequest(P, { fields: [] }, ana), /ao menos um/);
  });

  it('o cliente vê só os pedidos pendentes do próprio processo, com os valores atuais', async () => {
    const list = await ficha.listRequests(P, clienteA);
    expect(list).toHaveLength(1);
    expect(list[0].values).toEqual({
      'cliente.filiacao1': null,
      'segundo.profissao': null,
      'processo.bancoConta': null,
    });
    await rejects(ficha.listRequests(P, clienteB), /Processo não encontrado/);
  });

  it('o cliente responde só o que foi pedido; responder de novo é recusado', async () => {
    const [req] = await ficha.listRequests(P, clienteA);
    await rejects(
      ficha.answerRequest(
        P,
        req.id,
        { 'cliente.profissao': 'Outra' },
        clienteA,
      ),
      /não permitido/,
    );
    await ficha.answerRequest(
      P,
      req.id,
      { 'cliente.filiacao1': 'Maria Silva', 'processo.bancoConta': '12345-6' },
      clienteA,
    );
    const [u] = await ds().query<{ filiacao_1: string; profissao: string }[]>(
      `SELECT filiacao_1, profissao FROM users WHERE id = $1`,
      [IDS.clienteA],
    );
    expect(u).toEqual({ filiacao_1: 'Maria Silva', profissao: 'Engenheira' });
    const [r] = await ds().query<
      { status: string; answered_at: Date | null }[]
    >(`SELECT status, answered_at FROM data_requests WHERE id = $1`, [req.id]);
    expect(r.status).toBe('respondido');
    expect(r.answered_at).not.toBeNull();
    await rejects(
      ficha.answerRequest(P, req.id, {}, clienteA),
      /já foi respondido/,
    );
    expect(await ficha.listRequests(P, clienteA)).toEqual([]);
  });

  it('a equipe cancela um pedido pendente', async () => {
    const req = await ficha.createRequest(
      P,
      { fields: ['cliente.nacionalidade'] },
      ana,
    );
    await ficha.cancelRequest(P, req.id, ana);
    await rejects(ficha.cancelRequest(P, req.id, ana), /não encontrado/);
  });

  it('onboarding: o endereço em partes é salvo e o texto antigo montado delas', async () => {
    const me = new MeService(
      ds().getRepository(User),
      {} as never,
      { invalidateUser: jest.fn() } as never,
      { remove: jest.fn() } as never,
      ds(),
    );
    await me.completeOnboarding(clienteB, {
      name: 'Caio',
      cep: '20040-002',
      logradouro: 'Av. Rio Branco',
      numero: '1',
      complemento: 'sala 2',
      bairro: 'Centro',
      cidade: 'Rio de Janeiro',
      uf: 'RJ',
    });
    const [u] = await ds().query<
      { logradouro: string; uf: string; endereco: string; cep: string }[]
    >(`SELECT logradouro, uf, endereco, cep FROM users WHERE id = $1`, [
      IDS.clienteB,
    ]);
    expect(u).toEqual({
      logradouro: 'Av. Rio Branco',
      uf: 'RJ',
      endereco: 'Av. Rio Branco, 1 - sala 2, Centro, Rio de Janeiro - RJ',
      cep: '20040002',
    });
  });
});
