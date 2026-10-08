import { STAGE_LABELS, type ProcessStage } from './process.entity';

export interface ExportRow {
  id: string;
  stage: ProcessStage;
  created_at: Date | string;
  client_name: string | null;
  client_surname: string | null;
  client_email: string;
  analista_name: string | null;
  empreendimento: string | null;
  unidade: string | null;
  valor_unidade: string | number | null;
}

const HEADER = [
  'Código',
  'Proponente',
  'Etapa',
  'Criado em',
  'Analista',
  'Empreendimento',
  'Unidade',
  'Valor da unidade (R$)',
];

// Byte order mark: makes Excel read the file as UTF-8
export const UTF8_BOM = String.fromCharCode(0xfeff);

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

// A cell the spreadsheet will not execute: text starting with =, +, -, @ (or
// tab/CR) gets a leading apostrophe (formula injection), and values with the
// separator, quotes or line breaks are quoted.
export function csvCell(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// BE-17: made for Excel in pt-BR — UTF-8 BOM, semicolon separator, dd/mm/aaaa
// dates and comma decimals. Same code the app shows (CLI-xxxx).
export function processesCsv(rows: ExportRow[]): string {
  const body = rows.map((r) => [
    `CLI-${r.id.replace(/-/g, '').slice(0, 4).toUpperCase()}`,
    [r.client_name, r.client_surname].filter(Boolean).join(' ') ||
      r.client_email,
    STAGE_LABELS[r.stage] ?? r.stage,
    dateFmt.format(new Date(r.created_at)),
    r.analista_name ?? '',
    r.empreendimento ?? '',
    r.unidade ?? '',
    r.valor_unidade == null
      ? ''
      : Number(r.valor_unidade).toFixed(2).replace('.', ','),
  ]);
  const lines = [HEADER, ...body].map((cols) => cols.map(csvCell).join(';'));
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}
