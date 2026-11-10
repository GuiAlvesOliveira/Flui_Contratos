/**
 * Validade de documentos pelo mês de referência (holerite, extrato, conta de
 * consumo...). A regra fica isolada aqui — e testada em
 * document-validity.spec.ts — porque pode mudar:
 *
 *   vencimento = último dia do mês (mês de referência + validade em meses)
 *
 * Ex.: holerite de 03/2026 com validade de 3 meses vale até 30/06/2026. O
 * documento vale até o dia do vencimento, inclusive, e está vencido a partir
 * do dia seguinte. "Vencendo" = faltam EXPIRING_DAYS dias ou menos.
 *
 * Datas são do calendário de São Paulo (a API roda em UTC) e circulam como
 * texto: mês 'AAAA-MM', dia 'AAAA-MM-DD'.
 */

export const EXPIRING_DAYS = 15;
export const VALIDITY_TZ = 'America/Sao_Paulo';
/** Limite da validade configurável por tipo de documento (em meses). */
export const MAX_VALIDITY_MONTHS = 120;

/** "Hoje" no fuso de São Paulo, para consultas SQL. */
export const TODAY_SQL = `(now() AT TIME ZONE '${VALIDITY_TZ}')::date`;

export type ValidityStatus = 'valido' | 'vencendo' | 'vencido';

const DAY_MS = 86_400_000;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_BR_RE = /^(0[1-9]|1[0-2])\/(\d{4})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Aceita 'AAAA-MM' (campo de mês do navegador) ou 'MM/AAAA'; devolve 'AAAA-MM' ou null. */
export function parseReferenceMonth(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  const iso = MONTH_RE.exec(value);
  if (iso) return Number(iso[1]) >= 1900 ? value : null;
  const br = MONTH_BR_RE.exec(value);
  if (br) return Number(br[2]) >= 1900 ? `${br[2]}-${br[1]}` : null;
  return null;
}

function utcDay(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`data inválida: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Último dia de validade ('AAAA-MM-DD') de um documento do mês `referenceMonth`. */
export function computeValidUntil(
  referenceMonth: string,
  validityMonths: number,
): string {
  const month = parseReferenceMonth(referenceMonth);
  if (!month) throw new Error(`mês de referência inválido: ${referenceMonth}`);
  if (!Number.isInteger(validityMonths) || validityMonths < 1) {
    throw new Error(`validade inválida: ${validityMonths}`);
  }
  const [year, mon] = month.split('-').map(Number);
  // dia 0 do mês seguinte ao mês final = último dia do mês final; Date.UTC
  // faz a virada de ano (mês 13 = janeiro do ano seguinte)
  const last = new Date(Date.UTC(year, mon - 1 + validityMonths + 1, 0));
  return last.toISOString().slice(0, 10);
}

/** Primeiro dia do mês ('AAAA-MM-01'), como fica gravado no banco. */
export const monthStart = (referenceMonth: string) => `${referenceMonth}-01`;

/** Dia de hoje em São Paulo, 'AAAA-MM-DD'. */
export function todayInSaoPaulo(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: VALIDITY_TZ });
}

/** Mês corrente em São Paulo, 'AAAA-MM'. */
export const currentMonthInSaoPaulo = (now = new Date()) =>
  todayInSaoPaulo(now).slice(0, 7);

/** Mês de referência depois do mês corrente (não aceito). */
export const isFutureMonth = (referenceMonth: string, now = new Date()) =>
  referenceMonth > currentMonthInSaoPaulo(now);

/** Dias de `today` até `validUntil` (0 = vence hoje; negativo = vencido). */
export function daysUntil(validUntil: string, today: string): number {
  return Math.round((utcDay(validUntil) - utcDay(today)) / DAY_MS);
}

export function validityStatus(
  validUntil: string,
  today: string,
): ValidityStatus {
  const days = daysUntil(validUntil, today);
  if (days < 0) return 'vencido';
  return days <= EXPIRING_DAYS ? 'vencendo' : 'valido';
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' */
export function formatDateBr(date: string): string {
  const m = DATE_RE.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

/** 'AAAA-MM' (ou 'AAAA-MM-DD') → 'MM/AAAA' */
export function formatMonthBr(month: string): string {
  const [y, m] = month.split('-');
  return `${m}/${y}`;
}

/** "vence hoje", "vence amanhã", "vence em 12 dias" */
export function dueText(validUntil: string, today: string): string {
  const days = daysUntil(validUntil, today);
  if (days <= 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';
  return `vence em ${days} dias`;
}

/** Situação de validade de um documento, como a tela mostra. */
export interface DocumentValidity {
  // validade (meses) do tipo na lista da assessoria; null = não pede mês
  typeValidityMonths: number | null;
  // 'sem_referencia' = validado antes da regra (ou sem mês): nunca vence
  // sozinho; o analista revisa e informa o mês
  validityStatus: ValidityStatus | 'sem_referencia' | null;
  daysLeft: number | null;
}

/**
 * A validade só vale para o documento validado (a versão atual do arquivo).
 * Pendente, recebido ou rejeitado ainda não tem mês de referência.
 * Devolve null quando o documento não tem nada de validade a mostrar.
 */
export function documentValidity(
  doc: { status: string; validUntil: string | null },
  typeValidityMonths: number | null,
  today: string,
): DocumentValidity | null {
  if (doc.status === 'validado' && doc.validUntil) {
    return {
      typeValidityMonths,
      validityStatus: validityStatus(doc.validUntil, today),
      daysLeft: daysUntil(doc.validUntil, today),
    };
  }
  if (!typeValidityMonths) return null;
  return {
    typeValidityMonths,
    validityStatus: doc.status === 'validado' ? 'sem_referencia' : null,
    daysLeft: null,
  };
}
