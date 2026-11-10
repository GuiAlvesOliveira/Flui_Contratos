// Validade de documentos pelo mês de referência — espelha
// backend/src/documents/document-validity.ts (a API é quem decide; aqui é só
// a prévia na tela). vencimento = último dia do mês (referência + validade);
// vale até esse dia, inclusive. "Vencendo" = faltam 15 dias ou menos.

export const EXPIRING_DAYS = 15;
const TZ = 'America/Sao_Paulo';

export type ValidityStatus = 'valido' | 'vencendo' | 'vencido';

/** Hoje em São Paulo, 'AAAA-MM-DD'. */
export const todaySp = (now = new Date()) => now.toLocaleDateString('sv-SE', { timeZone: TZ });

/** Mês corrente em São Paulo, 'AAAA-MM' (limite do campo de mês). */
export const currentMonthSp = (now = new Date()) => todaySp(now).slice(0, 7);

/** Último dia de validade ('AAAA-MM-DD') de um documento do mês 'AAAA-MM'. */
export function computeValidUntil(referenceMonth: string, validityMonths: number): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(referenceMonth);
  if (!m || !Number.isInteger(validityMonths) || validityMonths < 1) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + validityMonths + 1, 0));
  return last.toISOString().slice(0, 10);
}

/** Dias de hoje até `validUntil` (0 = vence hoje; negativo = vencido). */
export function daysUntil(validUntil: string, today = todaySp()): number {
  return Math.round((Date.parse(`${validUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function validityStatus(validUntil: string, today = todaySp()): ValidityStatus {
  const d = daysUntil(validUntil, today);
  return d < 0 ? 'vencido' : d <= EXPIRING_DAYS ? 'vencendo' : 'valido';
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' */
export const formatDay = (date: string) => date.slice(0, 10).split('-').reverse().join('/');

/** 'AAAA-MM' ou 'AAAA-MM-DD' → 'MM/AAAA' */
export const formatMonth = (month: string) => {
  const [y, m] = month.split('-');
  return `${m}/${y}`;
};

/** Digitação do mês no formato MM/AAAA (a barra entra sozinha). */
export function maskMonth(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 6);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/** 'MM/AAAA' → 'AAAA-MM'; null se incompleto ou inválido. */
export function parseMonthBr(value: string): string | null {
  const m = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(value.trim());
  return m && Number(m[2]) >= 1900 ? `${m[2]}-${m[1]}` : null;
}

/** "vence hoje", "vence amanhã", "vence em 12 dias" */
export function dueText(days: number): string {
  if (days <= 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';
  return `vence em ${days} dias`;
}

/** Selo de validade do documento no checklist. */
export function validityBadge(
  status: ValidityStatus | 'sem_referencia' | null | undefined,
  validUntil: string | null | undefined,
  daysLeft: number | null | undefined,
): { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' } | null {
  if (status === 'sem_referencia') return { label: 'Mês de referência não informado', tone: 'neutral' };
  if (!status || !validUntil) return null;
  const date = formatDay(validUntil);
  if (status === 'vencido') return { label: `Valia até ${date}`, tone: 'red' };
  if (status === 'vencendo') {
    const text = dueText(daysLeft ?? daysUntil(validUntil));
    return { label: `${text.charAt(0).toUpperCase()}${text.slice(1)} · ${date}`, tone: 'amber' };
  }
  return { label: `Válido até ${date}`, tone: 'green' };
}
