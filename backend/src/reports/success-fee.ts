import { csvCell, UTF8_BOM } from '../processes/processes-csv';

/**
 * PROD-09 — success fee da Flui por contrato assinado. A taxa vem do plano da
 * assessoria (definido pelo Super Admin fora do app) e incide sobre a comissão
 * que a assessoria recebe, nunca sobre o valor do financiamento.
 */
export type Plano = 'essencial' | 'profissional' | 'escala';

// Em pontos-base (1,5% = 150) para a conta ser feita com inteiros
export const PLAN_BPS: Record<Plano, number> = {
  essencial: 150,
  profissional: 100,
  escala: 50,
};
export const PLAN_LABELS: Record<Plano, string> = {
  essencial: 'Essencial',
  profissional: 'Profissional',
  escala: 'Escala',
};
// Sugestão de comissão da assessoria: 2% do valor do financiamento
export const SUGGESTED_COMMISSION = 0.02;

/** Taxa do plano em SQL (fração, ex.: 0.015), para gravar no processo ao assinar. */
export const planRateSql = (plano: string) =>
  `(CASE ${plano} WHEN 'escala' THEN 0.005 WHEN 'profissional' THEN 0.010 ELSE 0.015 END)`;

/**
 * Valor do financiamento em SQL: o do formulário de financiamento (FE-23),
 * se já foi preenchido; senão, o valor em aberto do processo.
 */
export const financingSql = (p: string) =>
  `COALESCE((SELECT (d.form_data->>'valorFinanciado')::numeric
               FROM documents d
              WHERE d.process_id = ${p}.id AND d.form_type = 'financiamento'
              ORDER BY d.created_at DESC LIMIT 1),
            ${p}.valor_em_aberto)`;

/**
 * success fee = comissão × taxa, arredondado em centavos (metade para cima),
 * com inteiros: o mesmo resultado do ROUND(numeric, 2) do PostgreSQL.
 */
export function successFee(commission: number, rate: number): number {
  const cents = Math.round(commission * 100);
  const bps = Math.round(rate * 10_000);
  return Math.floor((cents * bps + 5_000) / 10_000) / 100;
}

export interface SignedContract {
  processId: string;
  signedAt: string; // ISO
  month: string; // AAAA-MM (horário de Brasília)
  clientName: string;
  analistaName: string | null;
  financing: number | null;
  commission: number | null;
  rate: number | null;
  fee: number | null;
}

export interface MonthTotal {
  month: string;
  contracts: number;
  commission: number;
  fee: number;
  pending: number; // contratos sem comissão informada
}

export function monthTotals(
  year: number,
  contracts: SignedContract[],
): MonthTotal[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const list = contracts.filter((c) => c.month === month);
    const sum = (f: (c: SignedContract) => number | null) =>
      Math.round(list.reduce((s, c) => s + Math.round((f(c) ?? 0) * 100), 0)) /
      100;
    return {
      month,
      contracts: list.length,
      commission: sum((c) => c.commission),
      fee: sum((c) => c.fee),
      pending: list.filter((c) => c.commission === null).length,
    };
  });
}

const money = (n: number | null) =>
  n === null ? '' : n.toFixed(2).replace('.', ',');
const pct = (n: number | null) =>
  n === null ? '' : `${(n * 100).toFixed(1).replace('.', ',')}%`;
const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
export const monthLabel = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(0, 4)}`;

/** CSV para o Excel em pt-BR: um contrato por linha e o total do ano no fim. */
export function successFeeCsv(
  contracts: SignedContract[],
  totals: MonthTotal[],
): string {
  const header = [
    'Mês',
    'Assinado em',
    'Cliente',
    'Analista',
    'Valor do financiamento (R$)',
    'Comissão da assessoria (R$)',
    'Taxa da Flui',
    'Success fee (R$)',
  ];
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
  const rows = contracts.map((c) => [
    monthLabel(c.month),
    date(c.signedAt),
    c.clientName,
    c.analistaName ?? '',
    money(c.financing),
    c.commission === null ? 'a informar' : money(c.commission),
    pct(c.rate),
    money(c.fee),
  ]);
  const sum = (f: (t: MonthTotal) => number) =>
    totals.reduce((s, t) => s + Math.round(f(t) * 100), 0) / 100;
  const total = [
    'Total',
    `${totals.reduce((s, t) => s + t.contracts, 0)} contrato(s)`,
    '',
    '',
    '',
    money(sum((t) => t.commission)),
    '',
    money(sum((t) => t.fee)),
  ];
  const lines = [header, ...rows, total].map((cols) =>
    cols.map(csvCell).join(';'),
  );
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}
