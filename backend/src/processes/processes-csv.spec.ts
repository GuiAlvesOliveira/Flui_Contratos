import {
  csvCell,
  processesCsv,
  UTF8_BOM,
  type ExportRow,
} from './processes-csv';

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  id: '0392f00d-0000-4000-8000-000000000001',
  stage: 'analise_credito',
  created_at: '2026-05-20T22:13:50Z',
  client_name: 'Helena',
  client_surname: 'Narduci',
  client_email: 'helena@exemplo.dev',
  analista_name: 'Rafael',
  empreendimento: 'Residencial Aurora',
  unidade: 'AP 102',
  valor_unidade: '400000.00',
  ...over,
});

describe('BE-17: processes CSV', () => {
  it('starts with the UTF-8 BOM and a pt-BR header, one line per process', () => {
    const csv = processesCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Código;Proponente;Etapa;Criado em;Analista;Empreendimento;Unidade;Valor da unidade (R$)',
      'CLI-0392;Helena Narduci;Análise de Crédito;20/05/2026;Rafael;Residencial Aurora;AP 102;400000,00',
      '',
    ]);
  });

  it('uses the São Paulo date, falls back to the e-mail and leaves blanks empty', () => {
    const csv = processesCsv([
      row({
        created_at: '2026-05-21T01:30:00Z', // still 20/05 in São Paulo
        client_name: null,
        client_surname: null,
        analista_name: null,
        empreendimento: null,
        unidade: null,
        valor_unidade: null,
        stage: 'cliente_inativo',
      }),
    ]);
    expect(csv.split('\r\n')[1]).toBe(
      'CLI-0392;helena@exemplo.dev;Inativo;20/05/2026;;;;',
    );
  });

  it('neutralizes formulas and quotes separators, quotes and line breaks', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(
      `"'=HYPERLINK(""http://x"")"`,
    );
    expect(csvCell('+5511999')).toBe("'+5511999");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('Torre A; bloco 2')).toBe('"Torre A; bloco 2"');
    expect(csvCell('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
    expect(csvCell('Ana')).toBe('Ana');
    expect(csvCell(null)).toBe('');
  });
});
