import { useQuery } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';

// PROD-04: a assessoria de quem está logado (GET /tenants/me). O logo fica no
// armazenamento privado: a imagem vem da API com o token e vira um data URL,
// guardado no cache pela data da última troca (trocar o logo muda a chave).
export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  logo: { mimeType: string; updatedAt: string } | null;
}

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg'];

export function useTenant(enabled = true) {
  return useQuery<TenantInfo>({
    queryKey: ['tenant', 'me'],
    queryFn: () => api.get<TenantInfo>('/tenants/me').then(r => r.data),
    staleTime: 5 * 60_000,
    enabled,
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function useTenantLogo(tenant: TenantInfo | undefined): string | null {
  const updatedAt = tenant?.logo?.updatedAt ?? null;
  const { data } = useQuery<string>({
    queryKey: ['tenant', 'logo', updatedAt],
    queryFn: async () => {
      const r = await api.get<Blob>('/tenants/me/logo', { responseType: 'blob' });
      return blobToDataUrl(r.data);
    },
    enabled: !!updatedAt,
    staleTime: Infinity,
  });
  return updatedAt ? data ?? null : null;
}
