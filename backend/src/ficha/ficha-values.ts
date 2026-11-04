import { FichaField, UFS } from './ficha-fields';

export type FichaValue = string | number | boolean | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * Valida e normaliza um valor da ficha. Vazio limpa o campo (null).
 * Devolve a mensagem de erro em pt-BR quando o valor não serve.
 */
export function normalizeFichaValue(
  field: FichaField,
  raw: unknown,
): { value: FichaValue } | { error: string } {
  if (
    raw === null ||
    raw === undefined ||
    (typeof raw === 'string' && raw.trim() === '')
  ) {
    return { value: null };
  }
  const bad = (msg: string) => ({ error: `${field.label}: ${msg}` });

  switch (field.type) {
    case 'boolean':
      return typeof raw === 'boolean'
        ? { value: raw }
        : bad('responda sim ou não');
    case 'percent': {
      const n =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string'
            ? Number(raw.replace(',', '.'))
            : NaN;
      if (!Number.isFinite(n) || n <= 0 || n > 100)
        return bad('informe um percentual entre 0 e 100');
      return { value: Math.round(n * 100) / 100 };
    }
  }

  if (typeof raw !== 'string') return bad('valor inválido');
  const text = raw.trim().replace(/\s+/g, ' ');

  switch (field.type) {
    case 'text':
      return text.length > (field.max ?? 255)
        ? bad(`use no máximo ${field.max ?? 255} caracteres`)
        : { value: text };
    case 'date': {
      if (!isRealDate(text)) return bad('data inválida');
      if (text < '1900-01-01') return bad('data inválida');
      if (text > new Date().toISOString().slice(0, 10))
        return bad('a data não pode estar no futuro');
      return { value: text };
    }
    case 'enum':
      return field.options?.some((o) => o.value === text)
        ? { value: text }
        : bad('opção inválida');
    case 'uf': {
      const uf = text.toUpperCase();
      return (UFS as readonly string[]).includes(uf)
        ? { value: uf }
        : bad('UF inválida');
    }
    case 'cep': {
      const d = text.replace(/\D/g, '');
      return d.length === 8 ? { value: d } : bad('o CEP tem 8 dígitos');
    }
    case 'phone': {
      const d = text.replace(/\D/g, '');
      return d.length === 10 || d.length === 11
        ? { value: d }
        : bad('informe DDD e número');
    }
    case 'email': {
      const e = text.toLowerCase();
      return EMAIL.test(e) && e.length <= (field.max ?? 255)
        ? { value: e }
        : bad('e-mail inválido');
    }
    case 'digits': {
      const d = text.replace(/\D/g, '');
      return d.length > 0 && d.length <= (field.max ?? 20)
        ? { value: d }
        : bad('use só números');
    }
    case 'participant':
      return UUID.test(text)
        ? { value: text.toLowerCase() }
        : bad('participante inválido');
  }
  return bad('valor inválido');
}
