import { useQuery } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';

// Ficha completa do proponente: a lista de campos vem da API (GET
// /ficha/fields), a mesma que valida as gravações e os pedidos ao cliente.

export type FichaTarget = 'cliente' | 'segundo' | 'processo';
export type FichaValue = string | number | boolean | null;
export type FichaValues = Record<string, FichaValue>;

export interface FichaField {
  key: string;
  label: string;
  group: string;
  scope: 'pessoa' | 'processo';
  type: 'text' | 'date' | 'enum' | 'boolean' | 'uf' | 'cep' | 'phone' | 'email' | 'percent' | 'digits' | 'participant';
  max?: number;
  options?: { value: string; label: string }[];
  onlySegundo?: boolean;
  showIf?: { key: string; in: string[] };
  cadastro?: boolean;
}

export interface FichaDef {
  groups: { id: string; label: string }[];
  fields: FichaField[];
}

export interface FichaData {
  cliente: FichaValues & { nome: string | null; cpf: string | null; email: string | null };
  segundo: (FichaValues & { id: string; nome: string; cpf: string | null }) | null;
  processo: FichaValues;
  participants: { id: string; name: string; cpf: string | null }[];
}

export interface DataRequest {
  id: string;
  fields: string[];
  labels: string[];
  note: string | null;
  status: 'pendente' | 'respondido' | 'cancelado';
  createdAt: string;
  answeredAt: string | null;
  requestedBy: string | null;
  values?: FichaValues;
}

export interface BankFormMissing { key: string | null; label: string }
export interface BankForm {
  key: string;
  bank: string;
  label: string;
  version: string;
  filled: number;
  total: number;
  missing: BankFormMissing[];
  available: boolean;
}
export interface BankFormFile {
  id: string;
  formKey: string;
  label: string;
  bank: string | null;
  version: string;
  filledFields: number;
  totalFields: number;
  createdAt: string;
  generatedBy: string | null;
}

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export function useFichaDef() {
  return useQuery<FichaDef>({
    queryKey: ['ficha-fields'],
    queryFn: () => api.get('/ficha/fields').then(r => r.data),
    staleTime: Infinity,
  });
}

export const fichaKeys = {
  ficha: (processId: string) => ['ficha', processId] as const,
  requests: (processId: string) => ['ficha', processId, 'requests'] as const,
  bankForms: (processId: string) => ['ficha', processId, 'bank-forms'] as const,
};

/** pedidos de dados: o cliente recebe só os pendentes do próprio processo */
export function useDadosSolicitados(processId: string, enabled: boolean) {
  return useQuery<DataRequest[]>({
    queryKey: fichaKeys.requests(processId),
    queryFn: () => api.get(`/processes/${processId}/data-requests`).then(r => r.data),
    enabled,
  });
}

/** campos de um alvo, na ordem da lista, já sem os que não se aplicam */
export function fieldsFor(def: FichaDef, target: FichaTarget): FichaField[] {
  return def.fields.filter(f =>
    target === 'processo' ? f.scope === 'processo' : f.scope === 'pessoa' && (target === 'segundo' || !f.onlySegundo),
  );
}

/** campo condicional (ex.: regime de bens só para casados) */
export function isVisible(f: FichaField, values: FichaValues): boolean {
  if (!f.showIf) return true;
  return f.showIf.in.includes(String(values[f.showIf.key] ?? ''));
}

export function displayValue(f: FichaField, v: FichaValue, participants: FichaData['participants'] = []): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  switch (f.type) {
    case 'date': return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
    case 'enum': return f.options?.find(o => o.value === s)?.label ?? s;
    case 'boolean': return v === true ? 'Sim' : 'Não';
    case 'percent': return `${s.replace('.', ',')}%`;
    case 'cep': return s.length === 8 ? `${s.slice(0, 5)}-${s.slice(5)}` : s;
    case 'phone':
      if (s.length === 11) return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
      if (s.length === 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
      return s;
    case 'participant': return participants.find(p => p.id === s)?.name ?? 'Participante';
    default: return s;
  }
}

/** valor de entrada do formulário (sempre string, '' = vazio) */
export function inputValue(f: FichaField, v: FichaValue): string {
  if (v === null || v === undefined) return '';
  if (f.type === 'boolean') return v ? 'sim' : 'nao';
  return String(v);
}

/** de volta para a API: '' limpa o campo */
export function apiValue(f: FichaField, raw: string): FichaValue {
  if (raw.trim() === '') return null;
  if (f.type === 'boolean') return raw === 'sim';
  if (f.type === 'percent') return Number(raw.replace(',', '.'));
  return raw;
}

export function targetOf(fullKey: string): FichaTarget {
  return fullKey.split('.')[0] as FichaTarget;
}
