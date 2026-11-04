import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PDFCheckBox, PDFDocument, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { parseFichaKey } from '../ficha/ficha-fields';
import type { FichaSnapshot, FichaValues } from '../ficha/ficha.service';
import { buildItauComprador, buildItauSeguro, FilledField } from './itau';
import { fillPdf, toLatin1 } from './pdf-fill';
import { BANK_FORMS } from './templates';

const pessoa = (over: FichaValues = {}): FichaValues => ({
  dataNascimento: '1990-03-14',
  nacionalidade: 'Brasileira',
  naturalidadeCidade: 'São Paulo',
  naturalidadeUf: 'SP',
  genero: 'feminino',
  profissao: 'Engenheira',
  empregadorInss: false,
  documentoTipo: 'rg',
  rg: '12.345.678-9',
  documentoEmissao: '2010-01-20',
  documentoOrgao: 'SSP',
  documentoUf: 'SP',
  estadoCivil: 'solteiro',
  estadoCivilRegistro: null,
  dataCasamento: null,
  regimeBens: null,
  filiacao1: 'Maria Araújo',
  filiacao2: null,
  telefone: '11987654321',
  telefoneResidencial: null,
  telefoneComercial: null,
  email: null,
  cep: '01310100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  complemento: 'ap 12',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
  ...over,
});

function snap(
  o: {
    cliente?: FichaValues;
    segundo?: FichaValues | null;
    processo?: FichaValues;
    count?: number;
  } = {},
): FichaSnapshot {
  return {
    process: { id: 'p', tenantId: 't' } as never,
    cliente: {
      ...pessoa(o.cliente),
      nome: 'MARIA CONCEIÇÃO ARAÚJO',
      cpf: '12345678909',
      email: 'maria@exemplo.dev',
    },
    segundo:
      o.segundo === null || o.segundo === undefined
        ? null
        : {
            ...pessoa({ genero: 'masculino', ...o.segundo }),
            id: 's',
            nome: 'JOÃO ARAÚJO',
            cpf: '98765432100',
          },
    processo: {
      segundoCompradorId: null,
      primeiraCompraSfh: true,
      usaFgts: false,
      percentualAquisicao1: null,
      bancoAgencia: '1234',
      bancoConta: '56789-0',
      seguradora: 'itau',
      ...o.processo,
    },
    participantCount: o.count ?? (o.segundo ? 2 : 1),
  };
}
const val = (fields: FilledField[], name: string) =>
  fields.find((f) => f.name === name)?.value;
const casados = {
  estadoCivil: 'casado',
  dataCasamento: '2015-05-10',
  regimeBens: 'comunhao_parcial',
};

describe('Itaú — Formulário do Comprador (mapeamento)', () => {
  it('cliente solteiro, sem 2º comprador: 100% do imóvel e "não vive em união estável"', () => {
    const b = buildItauComprador(snap());
    expect(val(b.fields, 'EstadoCivil1#0')).toBe('1');
    expect(val(b.fields, 'Anexo/Garagem')).toBe('Escolha2');
    expect(val(b.fields, '% comprador 1')).toBe('100');
    expect(val(b.fields, 'Nome completo sem abreviações 2')).toBeUndefined();
    expect(b.missing).toEqual([]);
    expect(b.filled).toBe(b.total);
  });

  it('formata datas, CPF, CEP e telefone como o banco pede', () => {
    const b = buildItauComprador(snap());
    expect(val(b.fields, 'Data de Nascimento 1')).toBe('14/03/1990');
    expect(val(b.fields, 'CPF 1')).toBe('123.456.789-09');
    expect(val(b.fields, 'CEP 1')).toBe('01310-100');
    expect(val(b.fields, 'telefone celular 1')).toBe('(11) 98765-4321');
  });

  it('casados em comunhão parcial no mesmo endereço: 50/50, regime de cada um com o valor certo, sem repetir o endereço', () => {
    const b = buildItauComprador(
      snap({
        cliente: casados,
        segundo: { ...casados, regimeBens: 'separacao_total' },
      }),
    );
    expect(val(b.fields, 'EstadoCivil1#0')).toBe('3');
    expect(val(b.fields, 'EstadoCivil1#V1')).toBe('3');
    expect(val(b.fields, 'Regime Casamento1#0')).toBe('1');
    // no 2º comprador "separação total" é o valor 0 (no 1º é 2)
    expect(val(b.fields, 'Regime Casamento1#V1')).toBe('0');
    expect(val(b.fields, 'Anexo/Garagem')).toBeUndefined();
    expect(val(b.fields, '% comprador 1')).toBe('50');
    expect(val(b.fields, '% comprador 2')).toBe('50');
    expect(val(b.fields, 'residjunto1')).toBe('1');
    expect(val(b.fields, 'Endereço Residencial comp 21')).toBeUndefined();
    expect(val(b.fields, 'data casamento1')).toBe('10/05/2015');
  });

  it('união estável: vai o estado do registro civil + "vive em união estável: sim"', () => {
    const b = buildItauComprador(
      snap({
        cliente: {
          estadoCivil: 'uniao_estavel',
          estadoCivilRegistro: 'divorciado',
        },
      }),
    );
    expect(val(b.fields, 'EstadoCivil1#0')).toBe('2');
    expect(val(b.fields, 'Anexo/Garagem')).toBe('Escolha1');
  });

  it('percentual informado na ficha vale para os dois; endereço diferente é preenchido', () => {
    const b = buildItauComprador(
      snap({
        segundo: { logradouro: 'Rua B', numero: '5', cep: '20040002' },
        processo: { percentualAquisicao1: 70 },
      }),
    );
    expect(val(b.fields, '% comprador 1')).toBe('70');
    expect(val(b.fields, '% comprador 2')).toBe('30');
    expect(val(b.fields, 'residjunto1')).toBe('2');
    expect(val(b.fields, 'Endereço Residencial comp 21')).toBe('Rua B');
  });

  it('o que falta vira lista com a chave da ficha, para pedir ao cliente', () => {
    const b = buildItauComprador(
      snap({
        cliente: { ...casados, regimeBens: null, profissao: null },
        processo: { usaFgts: null },
      }),
    );
    const keys = b.missing.map((m) => m.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'cliente.regimeBens',
        'cliente.profissao',
        'processo.usaFgts',
      ]),
    );
    // casado(a) sem 2º comprador escolhido: o banco quer o cônjuge
    expect(b.missing.map((m) => m.label)).toContain(
      '2º comprador ou cônjuge (escolha na ficha)',
    );
    // sem 2º comprador e sem comunhão definida não há como presumir 50/50
    expect(
      b.missing.every((m) => m.key === null || parseFichaKey(m.key) !== null),
    ).toBe(true);
    expect(b.filled).toBeLessThan(b.total);
  });
});

describe('Itaú — Seguro Habitacional (mapeamento)', () => {
  it('preenche só identificação e seguradora; a declaração de saúde nunca', () => {
    const b = buildItauSeguro(
      snap({ segundo: {}, processo: { seguradora: 'tokio_marine' } }),
    );
    expect(val(b.fields, 'Seguradora')).toBe('Tokio Marine');
    expect(val(b.fields, 'CPF_4')).toBe('987.654.321-00');
    expect(b.fields.some((f) => /^Dropdown|Invalidez/.test(f.name))).toBe(
      false,
    );
  });
});

describe('Preenchimento do PDF', () => {
  async function synthetic(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.getForm();
    form.createTextField('Nome').addToPage(page, { x: 10, y: 10 });
    const curto = form.createTextField('UF');
    curto.setMaxLength(2);
    curto.addToPage(page, { x: 10, y: 60 });
    const r = form.createRadioGroup('Estado');
    r.addOptionToPage('1', page, { x: 10, y: 110 });
    r.addOptionToPage('3', page, { x: 40, y: 110 });
    return Buffer.from(await doc.save());
  }

  it('preenche texto e opção e o PDF continua editável', async () => {
    const out = await fillPdf(await synthetic(), [
      { kind: 'text', name: 'Nome', value: 'José Araújo' },
      { kind: 'text', name: 'UF', value: 'SPX' },
      { kind: 'radio', name: 'Estado', value: '3' },
    ]);
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField('Nome').getText()).toBe('José Araújo');
    expect(form.getTextField('UF').getText()).toBe('SP');
    expect(form.getRadioGroup('Estado').getSelected()).toBe('3');
  });

  it('campo que não existe no modelo = o banco trocou o formulário', async () => {
    await expect(
      fillPdf(await synthetic(), [{ kind: 'text', name: 'Outro', value: 'x' }]),
    ).rejects.toThrow(/modelo do banco mudou/);
  });

  it('caracteres fora do Latin-1 perdem o acento em vez de quebrar a geração', () => {
    expect(toLatin1('Dvořák Conceição ✓')).toBe('Dvorák Conceição ');
  });
});

// Modelos reais do Itaú: não vão para o repositório (classificados como
// internos), então este teste roda só onde BANK_FORM_TEMPLATES_DIR existe.
const dir = process.env.BANK_FORM_TEMPLATES_DIR;
const hasTemplates =
  !!dir && BANK_FORMS.every((t) => existsSync(join(dir, t.file)));
(hasTemplates ? describe : describe.skip)(
  'Modelos reais do Itaú (local)',
  () => {
    const full = [
      snap({
        cliente: casados,
        segundo: { ...casados, logradouro: 'Rua B', numero: '5' },
        processo: { percentualAquisicao1: 60 },
      }),
      snap({
        cliente: { estadoCivil: 'uniao_estavel', estadoCivilRegistro: 'viuvo' },
        segundo: {
          estadoCivil: 'uniao_estavel',
          estadoCivilRegistro: 'desquitado',
          email: 'joao@exemplo.dev',
        },
      }),
    ];
    for (const t of BANK_FORMS) {
      it(`${t.key}: todo campo mapeado existe no PDF e recebe o valor`, async () => {
        for (const s of full) {
          const built = t.build(s);
          const pdf = await fillPdf(
            readFileSync(join(dir!, t.file)),
            built.fields,
          );
          const form = (await PDFDocument.load(pdf)).getForm();
          for (const f of built.fields) {
            const field = form.getField(f.name);
            if (f.kind === 'text')
              expect((field as PDFTextField).getText()).toBe(
                toLatin1(f.value).slice(
                  0,
                  (field as PDFTextField).getMaxLength() ?? undefined,
                ),
              );
            else
              expect(
                field instanceof PDFCheckBox
                  ? null
                  : (field as PDFRadioGroup).getSelected(),
              ).toBe(f.value);
          }
        }
      });
    }
  },
);
