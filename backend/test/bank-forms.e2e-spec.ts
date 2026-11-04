import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import { Readable } from 'stream';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import type { RequestUserFull } from '../src/auth/supabase.guard';
import { BankFormsController } from '../src/bank-forms/bank-forms.controller';
import { BankFormsService } from '../src/bank-forms/bank-forms.service';
import type { FilledField } from '../src/bank-forms/itau';
import { FichaService } from '../src/ficha/ficha.service';
import { MessagingService } from '../src/messaging/messaging.service';
import {
  createTestDb,
  describeDb,
  IDS,
  seedTwoTenants,
  type TestDb,
} from './support/test-db';

// Formulários do banco com PostgreSQL de verdade: a equipe gera o PDF a partir
// da ficha, ele fica salvo no processo (Blob + registro + log) e só a equipe
// lista, baixa e apaga. O modelo real do Itaú não vai para o repositório: aqui
// um PDF sintético com os mesmos campos faz o papel dele.
const who = (tenantId: string, userId: string, role: string) =>
  ({ tenantId, userId, role }) as RequestUserFull;
const ana = who(IDS.tenantA, IDS.anaA, 'analista');
const gestorB = who(IDS.tenantB, IDS.gestorB, 'dono');
const P = IDS.processoAna;

async function templateFor(fields: FilledField[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  for (const f of fields) {
    if (f.kind === 'text')
      form.createTextField(f.name).addToPage(page, { x: 0, y: 0 });
    else
      form
        .createRadioGroup(f.name)
        .addOptionToPage(f.value, page, { x: 0, y: 0 });
  }
  return Buffer.from(await doc.save());
}

describeDb('Formulários do banco com banco real (e2e)', () => {
  let db: TestDb;
  let service: BankFormsService;
  const blobs = new Map<string, Buffer>();
  const storage = {
    isAvailable: true,
    upload: jest.fn((name: string, buf: Buffer) => {
      blobs.set(name, buf);
      return Promise.resolve(name);
    }),
    download: jest.fn((name: string) =>
      Promise.resolve({
        stream: Readable.from(blobs.get(name)!),
        contentType: 'application/pdf',
        contentLength: blobs.get(name)!.length,
      }),
    ),
    delete: jest.fn((name: string) => Promise.resolve(blobs.delete(name))),
  };
  const ds = () => db.dataSource;

  beforeAll(async () => {
    db = await createTestDb('bankforms');
    await seedTwoTenants(ds());
    await ds().query(
      `UPDATE users SET cpf = '12345678909', data_nascimento = '1990-03-14', estado_civil = 'solteiro' WHERE id = $1`,
      [IDS.clienteA],
    );
    const config = { get: () => undefined } as unknown as ConfigService;
    const ficha = new FichaService(
      ds(),
      new MessagingService(config, { soon: jest.fn() } as never),
    );
    service = new BankFormsService(ds(), ficha, storage as never);
    // modelo sintético com os campos que a ficha atual preenche
    jest.spyOn(service, 'loadTemplate').mockImplementation(async (t) => {
      const snap = await ficha.snapshot(P, ana);
      return templateFor(t.build(snap).fields);
    });
  }, 60_000);
  afterAll(async () => {
    await db?.drop();
  });

  it('só a equipe tem acesso às rotas (o PDF fica oculto do cliente)', () => {
    for (const m of ['list', 'generate', 'download', 'remove'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, BankFormsController.prototype[m]),
      ).toEqual(['dono', 'analista']);
    }
  });

  it('lista os formulários com o quanto a ficha já preenche e o que falta', async () => {
    const { forms, files } = await service.list(P, ana);
    expect(forms.map((f) => f.key)).toEqual(['itau-comprador', 'itau-seguro']);
    const comprador = forms[0];
    expect(comprador.filled).toBeGreaterThan(0);
    expect(comprador.filled).toBeLessThan(comprador.total);
    expect(comprador.missing.map((m) => m.key)).toContain('cliente.profissao');
    expect(files).toEqual([]);
  });

  it('gera e salva no processo: arquivo no Blob, registro e log, com o CPF preenchido', async () => {
    const out = await service.generate(P, 'itau-seguro', ana);
    const [row] = await ds().query<
      {
        blob_path: string;
        tenant_id: string;
        process_id: string;
        form_key: string;
        template_version: string;
        generated_by: string;
      }[]
    >(`SELECT * FROM bank_form_files WHERE id = $1`, [out.id]);
    expect(row).toMatchObject({
      tenant_id: IDS.tenantA,
      process_id: P,
      form_key: 'itau-seguro',
      template_version: '05/25',
      generated_by: IDS.anaA,
    });
    expect(row.blob_path).toBe(`${IDS.tenantA}/${P}/bank-forms/${out.id}.pdf`);
    const form = (await PDFDocument.load(blobs.get(row.blob_path)!)).getForm();
    expect(form.getTextField('CPF_3').getText()).toBe('123.456.789-09');
    const [log] = await ds().query<{ metadata: Record<string, unknown> }[]>(
      `SELECT metadata FROM audit_logs WHERE process_id = $1 AND action = 'bank_form_generated'`,
      [P],
    );
    expect(log.metadata).toMatchObject({
      fileId: out.id,
      formKey: 'itau-seguro',
    });
    expect(JSON.stringify(log.metadata)).not.toMatch(/123\.456|12345678909/);
    expect((await service.list(P, ana)).files.map((f) => f.id)).toEqual([
      out.id,
    ]);
  });

  it('baixa com o nome do banco, do formulário e do cliente', async () => {
    const [{ id }] = (await service.list(P, ana)).files;
    const file = await service.download(P, id, ana);
    expect(file.fileName).toBe(
      'Itaú - Proposta de Seguro Habitacional (MIP/DFI) - Carla Cliente.pdf',
    );
  });

  it('RN-01: outra assessoria não lista, não gera e não baixa', async () => {
    const [{ id }] = (await service.list(P, ana)).files;
    await expect(service.list(P, gestorB)).rejects.toThrow(
      /Processo não encontrado/,
    );
    await expect(service.generate(P, 'itau-seguro', gestorB)).rejects.toThrow(
      /Processo não encontrado/,
    );
    await expect(service.download(P, id, gestorB)).rejects.toThrow(
      /Processo não encontrado/,
    );
  });

  it('formulário desconhecido é 404 e apagar remove registro e arquivo', async () => {
    await expect(service.generate(P, 'banco-x', ana)).rejects.toThrow(
      /Formulário não encontrado/,
    );
    const [{ id }] = (await service.list(P, ana)).files;
    await service.remove(P, id, ana);
    expect(
      await ds().query<{ id: string }[]>(
        `SELECT id FROM bank_form_files WHERE id = $1`,
        [id],
      ),
    ).toEqual([]);
    expect(blobs.size).toBe(0);
  });
});
