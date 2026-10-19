import * as zlib from 'zlib';
import { fit, PdfDoc, textWidth, winAnsi } from './pdf';
import { reportPdf, reportXlsx, type ReportModel } from './report-files';
import { buildXlsx, columnName, crc32, xmlText } from './xlsx';

// Lê um .zip (só o necessário para conferir o que foi gerado): diretório
// central → entradas → conteúdo descompactado, conferindo o CRC de cada uma.
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const comp = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lnameLen = buf.readUInt16LE(local + 26);
    const data = zlib.inflateRawSync(
      buf.subarray(local + 30 + lnameLen, local + 30 + lnameLen + comp),
    );
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString('utf8'));
    p += 46 + nameLen;
  }
  return out;
}

// Conteúdo das páginas de um PDF gerado aqui (streams FlateDecode)
function pdfStreams(buf: Buffer): string[] {
  const text = buf.toString('latin1');
  const out: string[] = [];
  const re = />>\nstream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('\nendstream', start);
    out.push(zlib.inflateSync(buf.subarray(start, end)).toString('latin1'));
  }
  return out;
}
const hex = (s: string) => winAnsi(s).toString('hex');

const model = (over: Partial<ReportModel> = {}): ReportModel => ({
  tenantName: 'Assessoria Alfa & Cia',
  days: 30,
  from: '2026-09-19',
  to: '2026-10-19',
  generatedAt: new Date('2026-10-19T23:30:00Z'),
  kpis: {
    processes: 6,
    unitValue: 1850000,
    averageTicket: 370000,
    withValue: 5,
    newProcesses: 2,
    stageChanges: 9,
    signed: 1,
  },
  funnel: [
    { label: 'Primeiro Contato', reached: 6, pctOfTotal: 100, stepRate: null },
    { label: 'Cadastro', reached: 5, pctOfTotal: 83.3, stepRate: 83.3 },
    { label: 'Assinatura', reached: 1, pctOfTotal: 16.7, stepRate: 50 },
  ],
  stageTime: [
    { label: 'Cadastro', avgDays: 2.5, samples: 4 },
    { label: 'Análise de Crédito', avgDays: null, samples: 0 },
  ],
  ranking: [
    { name: 'Ana Souza', signed: 1, activeProcesses: 3, avgDays: 4.2 },
    { name: 'Bruno <Lima>', signed: 0, activeProcesses: 2, avgDays: null },
  ],
  ...over,
});

describe('xlsx (PROD-03)', () => {
  it('nomes de coluna e escape de texto', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'ZZ',
      'AAA',
    ]);
    expect(xmlText('a & b <c> "d"\u0001')).toBe(
      'a &amp; b &lt;c&gt; &quot;d&quot;',
    );
  });

  it('CRC32 igual ao do zlib do Node', () => {
    const z = zlib as unknown as { crc32?: (b: Buffer) => number };
    const data = Buffer.from('Relatório gerencial — Flui', 'utf8');
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926); // valor de referência do CRC-32
    if (z.crc32) expect(crc32(data)).toBe(z.crc32(data));
  });

  it('gera um pacote OOXML válido: partes, abas, números e textos', () => {
    const files = unzip(
      buildXlsx([
        {
          name: 'Aba: 1/2',
          widths: [10, 20],
          rows: [
            [{ v: 'Título', s: 'bold' }, 'x'],
            ['Valor', { v: 1234.5, s: 'money' }],
            [null, 3],
          ],
        },
      ]),
    );
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(files.get('xl/workbook.xml')).toContain(
      '<sheet name="Aba  1 2" sheetId="1" r:id="rId1"/>',
    );
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain(
      '<col min="2" max="2" width="20" customWidth="1"/>',
    );
    expect(sheet).toContain(
      '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Título</t></is></c>',
    );
    expect(sheet).toContain('<c r="B2" s="3"><v>1234.5</v></c>');
    expect(sheet).toContain('<row r="3"><c r="B3"><v>3</v></c></row>');
  });
});

describe('pdf (PROD-03)', () => {
  it('estrutura: cabeçalho, objetos nas posições do xref, trailer e %%EOF', () => {
    const doc = new PdfDoc('Teste');
    doc.text(40, 40, 'Olá');
    doc.addPage();
    doc.text(40, 40, 'Página 2');
    const buf = doc.toBuffer();
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text
      .slice(startxref)
      .split('\n')
      .filter((l) => / 00000 n $/.test(l));
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(
        `${i + 1} 0 obj`,
      );
    });
    expect(text).toContain('/Type /Pages /Kids [');
    expect(text).toContain('/Count 2');
  });

  it('texto em WinAnsi (acentos) e larguras da Helvetica', () => {
    expect(winAnsi('Ação é já').toString('hex')).toBe('41e7e36f20e9206ae1');
    expect(winAnsi('→ seta').toString('latin1')).toBe('-> seta');
    expect(winAnsi('Ω').toString('latin1')).toBe('?');
    expect(textWidth('AAAA', 10)).toBeCloseTo(26.68, 2);
    expect(textWidth('ã', 10)).toBe(textWidth('a', 10));
    expect(textWidth('W', 10, true)).toBeCloseTo(9.44, 2);
    const cut = fit('Um nome de analista bem comprido', 60, 10);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut, 10)).toBeLessThanOrEqual(60);
    expect(fit('Curto', 60, 10)).toBe('Curto');
  });
});

describe('relatório em Excel e PDF com os mesmos números (PROD-03)', () => {
  it('planilha: resumo, funil, tempo por etapa e ranking', () => {
    const files = unzip(reportXlsx(model()));
    const wb = files.get('xl/workbook.xml')!;
    for (const name of [
      'Resumo',
      'Funil de conversão',
      'Tempo por etapa',
      'Ranking de analistas',
    ]) {
      expect(wb).toContain(`name="${name}"`);
    }
    const [resumo, funil, tempo, ranking] = [1, 2, 3, 4].map(
      (i) => files.get(`xl/worksheets/sheet${i}.xml`)!,
    );
    expect(resumo).toContain('Relatório gerencial — Assessoria Alfa &amp; Cia');
    expect(resumo).toContain('Últimos 30 dias · 19/09/2026 a 19/10/2026');
    expect(resumo).toContain('<v>370000</v>'); // ticket médio
    expect(resumo).toContain('<v>1850000</v>');
    expect(funil).toContain('<v>83.3</v>');
    expect(funil).toMatch(/Primeiro Contato.*<v>100<\/v>.*—/);
    expect(tempo).toContain('<v>2.5</v>');
    expect(ranking).toContain('Bruno &lt;Lima&gt;');
    expect(ranking).toMatch(/Ana Souza.*<v>1<\/v>.*<v>3<\/v>.*<v>4.2<\/v>/);
  });

  it('PDF: mesmos valores, formatados como na tela', () => {
    const pages = pdfStreams(reportPdf(model())).join('\n');
    for (const t of [
      'Relatório gerencial',
      'Assessoria Alfa & Cia',
      'Últimos 30 dias · 19/09/2026 a 19/10/2026',
      'Gerado em 19/10/2026 20:30',
      'R$ 370.000,00',
      '83,3%',
      '2,5 dias',
      'Ana Souza',
      '4,2 dias',
      'Página 1 de 1',
    ]) {
      expect(pages).toContain(`<${hex(t)}>`);
    }
  });

  it('muitos analistas viram mais páginas, com o cabeçalho e "Página X de Y" em todas', () => {
    const ranking = Array.from({ length: 60 }, (_, i) => ({
      name: `Analista ${i + 1}`,
      signed: 0,
      activeProcesses: i,
      avgDays: null,
    }));
    const buf = reportPdf(model({ ranking }));
    const pages = pdfStreams(buf);
    expect(pages.length).toBeGreaterThan(1);
    expect(buf.toString('latin1')).toContain(`/Count ${pages.length}`);
    pages.forEach((p, i) => {
      expect(p).toContain(`<${hex(`Página ${i + 1} de ${pages.length}`)}>`);
      expect(p).toContain(`<${hex('Relatório gerencial')}>`);
    });
    expect(pages.join('')).toContain(`<${hex('Analista 60')}>`);
  });

  it('sem analistas, o PDF diz isso em vez de uma tabela vazia', () => {
    expect(pdfStreams(reportPdf(model({ ranking: [] }))).join('')).toContain(
      `<${hex('Nenhum analista na assessoria.')}>`,
    );
  });
});
