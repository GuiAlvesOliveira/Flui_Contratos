import { fit, PAGE_H, PAGE_W, PdfDoc, textWidth, type Rgb } from './pdf';
import { buildXlsx, type Cell } from './xlsx';

/**
 * PROD-03: o que a página Relatórios mostra, num formato só. A tela, a planilha
 * e o PDF saem destes mesmos valores (GET /dashboard/summary + ranking), com a
 * mesma formatação: porcentagens e dias com 1 casa, valores em reais.
 */
export interface ReportModel {
  tenantName: string;
  days: number;
  from: string; // AAAA-MM-DD
  to: string;
  generatedAt: Date;
  kpis: {
    processes: number;
    unitValue: number;
    averageTicket: number | null;
    withValue: number;
    newProcesses: number;
    stageChanges: number;
    signed: number;
  };
  funnel: {
    label: string;
    reached: number;
    pctOfTotal: number;
    stepRate: number | null;
  }[];
  stageTime: { label: string; avgDays: number | null; samples: number }[];
  ranking: {
    name: string;
    signed: number;
    activeProcesses: number;
    avgDays: number | null;
  }[];
}

const TZ = 'America/Sao_Paulo';
export const fmtInt = (n: number) => n.toLocaleString('pt-BR');
export const fmtMoney = (n: number | null) =>
  n === null
    ? '—'
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtPct = (n: number | null) =>
  n === null
    ? '—'
    : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const fmtDays = (n: number | null) =>
  n === null
    ? '—'
    : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dia${n === 1 ? '' : 's'}`;
export const fmtDate = (iso: string) =>
  `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtStamp = (d: Date) =>
  d
    .toLocaleString('pt-BR', {
      timeZone: TZ,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', '');

export const periodLabel = (m: ReportModel) =>
  `Últimos ${m.days} dias · ${fmtDate(m.from)} a ${fmtDate(m.to)}`;

// ── Excel ────────────────────────────────────────────────────────────────────

export function reportXlsx(m: ReportModel): Buffer {
  const head = (...t: string[]): Cell[] =>
    t.map((v) => ({ v, s: 'bold' as const }));
  const pct = (n: number | null): Cell =>
    n === null ? '—' : { v: n, s: 'percent' };
  const days = (n: number | null): Cell =>
    n === null ? '—' : { v: n, s: 'decimal' };
  return buildXlsx([
    {
      name: 'Resumo',
      widths: [34, 22],
      rows: [
        [{ v: `Relatório gerencial — ${m.tenantName}`, s: 'title' }],
        [periodLabel(m)],
        [`Gerado em ${fmtStamp(m.generatedAt)}`],
        [],
        head('Indicador', 'Valor'),
        ['Processos ativos', { v: m.kpis.processes, s: 'int' }],
        [
          'Valor das unidades (processos ativos)',
          { v: m.kpis.unitValue, s: 'money' },
        ],
        [
          'Ticket médio',
          m.kpis.averageTicket === null
            ? '—'
            : { v: m.kpis.averageTicket, s: 'money' },
        ],
        ['Processos com valor informado', { v: m.kpis.withValue, s: 'int' }],
        ['Processos novos no período', { v: m.kpis.newProcesses, s: 'int' }],
        ['Mudanças de etapa no período', { v: m.kpis.stageChanges, s: 'int' }],
        ['Contratos assinados no período', { v: m.kpis.signed, s: 'int' }],
      ],
    },
    {
      name: 'Funil de conversão',
      widths: [24, 12, 14, 30],
      rows: [
        head(
          'Etapa',
          'Chegaram',
          '% do total',
          'Conversão sobre a etapa anterior',
        ),
        ...m.funnel.map((f): Cell[] => [
          f.label,
          { v: f.reached, s: 'int' },
          pct(f.pctOfTotal),
          pct(f.stepRate),
        ]),
      ],
    },
    {
      name: 'Tempo por etapa',
      widths: [24, 22, 22],
      rows: [
        head('Etapa', 'Tempo médio (dias)', 'Saídas no período'),
        ...m.stageTime.map((s): Cell[] => [
          s.label,
          days(s.avgDays),
          { v: s.samples, s: 'int' },
        ]),
      ],
    },
    {
      name: 'Ranking de analistas',
      widths: [6, 30, 20, 18, 26],
      rows: [
        head(
          '#',
          'Analista',
          'Contratos assinados',
          'Processos ativos',
          'Tempo médio por etapa (dias)',
        ),
        ...m.ranking.map((r, i): Cell[] => [
          { v: i + 1, s: 'int' },
          r.name,
          { v: r.signed, s: 'int' },
          { v: r.activeProcesses, s: 'int' },
          days(r.avgDays),
        ]),
      ],
    },
  ]);
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const ACCENT: Rgb = [124, 58, 237];
const MUTED: Rgb = [113, 113, 122];
const SOFT: Rgb = [244, 244, 245];
const LEFT = 40;
const RIGHT = PAGE_W - 40;
const BOTTOM = PAGE_H - 56;

interface Column {
  title: string;
  width: number;
  align?: 'left' | 'right';
}

export function reportPdf(m: ReportModel): Buffer {
  const doc = new PdfDoc(`Relatório gerencial — ${m.tenantName}`);
  let y = 0;

  const header = () => {
    doc.rect(0, 0, PAGE_W, 6, ACCENT);
    doc.text(LEFT, 44, 'Relatório gerencial', { size: 18, bold: true });
    doc.text(RIGHT, 44, fit(m.tenantName, 260, 11, true), {
      size: 11,
      bold: true,
      align: 'right',
    });
    doc.text(LEFT, 62, periodLabel(m), { size: 9.5, color: MUTED });
    doc.text(RIGHT, 62, `Gerado em ${fmtStamp(m.generatedAt)}`, {
      size: 9.5,
      color: MUTED,
      align: 'right',
    });
    doc.line(LEFT, 74, RIGHT, 74);
    y = 96;
  };
  const newPage = () => {
    doc.addPage();
    header();
  };
  const section = (title: string, need = 60) => {
    if (y + need > BOTTOM) newPage();
    doc.text(LEFT, y, title, { size: 12.5, bold: true });
    y += 14;
  };
  const table = (
    cols: Column[],
    rows: string[][],
    bar?: (i: number) => { col: number; pct: number },
  ) => {
    const drawHead = () => {
      doc.rect(LEFT, y, RIGHT - LEFT, 20, SOFT);
      let x = LEFT;
      for (const c of cols) {
        const tx = c.align === 'right' ? x + c.width - 8 : x + 8;
        doc.text(tx, y + 13.5, c.title, {
          size: 8.5,
          bold: true,
          color: MUTED,
          align: c.align === 'right' ? 'right' : 'left',
        });
        x += c.width;
      }
      y += 20;
    };
    drawHead();
    rows.forEach((row, i) => {
      if (y + 20 > BOTTOM) {
        newPage();
        drawHead();
      }
      let x = LEFT;
      row.forEach((cell, j) => {
        const c = cols[j];
        const b = bar?.(i);
        if (b && b.col === j) {
          const max = c.width - 70;
          doc.rect(x + 8, y + 6, max, 8, SOFT);
          doc.rect(
            x + 8,
            y + 6,
            Math.max(0, Math.min(1, b.pct / 100)) * max,
            8,
            ACCENT,
          );
          doc.text(x + c.width - 8, y + 13.5, cell, {
            size: 9.5,
            align: 'right',
          });
        } else {
          const text = fit(cell, c.width - 16, 9.5);
          doc.text(
            c.align === 'right' ? x + c.width - 8 : x + 8,
            y + 13.5,
            text,
            { size: 9.5, align: c.align === 'right' ? 'right' : 'left' },
          );
        }
        x += c.width;
      });
      y += 20;
      doc.line(LEFT, y, RIGHT, y);
    });
    y += 22;
  };

  header();

  // Indicadores
  const kpis: [string, string, string][] = [
    ['Processos ativos', fmtInt(m.kpis.processes), 'agora'],
    ['Ticket médio', fmtMoney(m.kpis.averageTicket), 'processos ativos'],
    ['Contratos assinados', fmtInt(m.kpis.signed), 'no período'],
    ['Processos novos', fmtInt(m.kpis.newProcesses), 'no período'],
  ];
  const boxW = (RIGHT - LEFT - 3 * 10) / 4;
  kpis.forEach(([label, value, sub], i) => {
    const x = LEFT + i * (boxW + 10);
    // o valor diminui até caber na caixa (ex.: ticket médio na casa do milhão)
    let size = 15;
    while (size > 9 && textWidth(value, size, true) > boxW - 20) size -= 0.5;
    doc.rect(x, y, boxW, 62, SOFT);
    doc.text(x + 10, y + 17, fit(label, boxW - 20, 8.5), {
      size: 8.5,
      color: MUTED,
    });
    doc.text(x + 10, y + 39, fit(value, boxW - 20, size, true), {
      size,
      bold: true,
    });
    doc.text(x + 10, y + 53, fit(sub, boxW - 20, 7.5), {
      size: 7.5,
      color: MUTED,
    });
  });
  y += 84;
  doc.text(
    LEFT,
    y,
    `Valor das unidades em processos ativos: ${fmtMoney(m.kpis.unitValue)} (${fmtInt(m.kpis.withValue)} com valor informado) · ${fmtInt(m.kpis.stageChanges)} mudanças de etapa no período`,
    { size: 9, color: MUTED },
  );
  y += 28;

  section('Funil de conversão');
  table(
    [
      { title: 'Etapa', width: 150 },
      { title: 'Chegaram', width: 70, align: 'right' },
      { title: '% do total', width: 165, align: 'right' },
      {
        title: 'Conversão sobre a anterior',
        width: RIGHT - LEFT - 385,
        align: 'right',
      },
    ],
    m.funnel.map((f) => [
      f.label,
      fmtInt(f.reached),
      fmtPct(f.pctOfTotal),
      fmtPct(f.stepRate),
    ]),
    (i) => ({ col: 2, pct: m.funnel[i].pctOfTotal }),
  );

  section('Tempo médio por etapa');
  table(
    [
      { title: 'Etapa', width: 200 },
      { title: 'Tempo médio', width: 150, align: 'right' },
      { title: 'Saídas no período', width: RIGHT - LEFT - 350, align: 'right' },
    ],
    m.stageTime.map((s) => [s.label, fmtDays(s.avgDays), fmtInt(s.samples)]),
  );

  section('Ranking de analistas');
  if (m.ranking.length === 0) {
    doc.text(LEFT, y + 10, 'Nenhum analista na assessoria.', {
      size: 9.5,
      color: MUTED,
    });
    y += 30;
  } else {
    table(
      [
        { title: '#', width: 30, align: 'right' },
        { title: 'Analista', width: 175 },
        { title: 'Contratos assinados', width: 110, align: 'right' },
        { title: 'Processos ativos', width: 95, align: 'right' },
        {
          title: 'Tempo médio por etapa',
          width: RIGHT - LEFT - 410,
          align: 'right',
        },
      ],
      m.ranking.map((r, i) => [
        String(i + 1),
        r.name,
        fmtInt(r.signed),
        fmtInt(r.activeProcesses),
        fmtDays(r.avgDays),
      ]),
    );
  }

  const total = doc.pageCount;
  for (let i = 0; i < total; i++) {
    doc.onPage(i, () => {
      doc.line(LEFT, PAGE_H - 40, RIGHT, PAGE_H - 40);
      doc.text(
        LEFT,
        PAGE_H - 26,
        'Flui Contratos · relatório gerado a partir dos dados da assessoria',
        { size: 8, color: MUTED },
      );
      doc.text(RIGHT, PAGE_H - 26, `Página ${i + 1} de ${total}`, {
        size: 8,
        color: MUTED,
        align: 'right',
      });
    });
  }
  return doc.toBuffer();
}
