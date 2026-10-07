// Validação e formatação dos dados pessoais da ficha cadastral (FE-20).
// CPF e telefone são gravados só com dígitos e exibidos formatados.

export const onlyDigits = (v: string) => v.replace(/\D/g, '');

// CPF: 11 dígitos, não todos iguais, com os dois dígitos verificadores corretos.
export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

// Telefone brasileiro com DDD: fixo (10 dígitos) ou celular (11, começando com 9).
// Aceita o código do país (+55) na frente.
export function isValidTelefone(value: string): boolean {
  let tel = onlyDigits(value);
  if ((tel.length === 12 || tel.length === 13) && tel.startsWith('55')) tel = tel.slice(2);
  if (tel.length !== 10 && tel.length !== 11) return false;
  const ddd = Number(tel.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  if (tel.length === 11) return tel[2] === '9';
  return /[2-5]/.test(tel[2]); // fixo começa com 2–5
}

// Normaliza para gravar: só dígitos, sem o +55.
export function normalizeTelefone(value: string): string {
  const tel = onlyDigits(value);
  return (tel.length === 12 || tel.length === 13) && tel.startsWith('55') ? tel.slice(2) : tel;
}

export function formatCpf(value: string | null | undefined): string {
  if (!value) return '—';
  const d = onlyDigits(value);
  if (d.length !== 11) return value;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatTelefone(value: string | null | undefined): string {
  if (!value) return '—';
  const d = normalizeTelefone(value);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return value;
}

// 'AAAA-MM-DD' → 'DD/MM/AAAA', sem passar por Date (evita deslocamento de fuso).
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

// Idade completa em anos numa data de referência (hoje, por padrão).
export function ageOn(birth: string, ref: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birth);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = ref.getFullYear() - y;
  if (ref.getMonth() + 1 < mo || (ref.getMonth() + 1 === mo && ref.getDate() < d)) age--;
  return age;
}

export function todayIso(ref: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ref.getFullYear()}-${p(ref.getMonth() + 1)}-${p(ref.getDate())}`;
}
