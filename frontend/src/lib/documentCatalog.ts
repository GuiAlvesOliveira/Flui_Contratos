// Catálogo de documentos da assessoria (BE-03) — espelha
// backend/src/documents/document-type.entity.ts.

export type DocumentCategory = 'pessoal' | 'renda' | 'imovel' | 'outros';

export interface DocumentTypeItem {
  id: string;
  label: string;
  category: DocumentCategory;
  description: string | null;
  active: boolean;
}

export const CATEGORY_ORDER: DocumentCategory[] = ['pessoal', 'renda', 'imovel', 'outros'];

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  pessoal: 'Documentos Pessoais',
  renda: 'Comprovação de Renda',
  imovel: 'Imóvel',
  outros: 'Outros',
};

// Agrupa na ordem das categorias, omitindo as vazias.
export function groupByCategory<T extends { category: string | null }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const c of CATEGORY_ORDER) groups.set(c, []);
  for (const it of items) {
    const c = it.category && groups.has(it.category) ? it.category : 'outros';
    groups.get(c)!.push(it);
  }
  return [...groups.entries()].filter(([, list]) => list.length > 0) as [DocumentCategory, T[]][];
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(msg) ? msg.join('; ') : (msg ?? fallback);
}
