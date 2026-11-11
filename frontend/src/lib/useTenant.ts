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
  // cor do sistema escolhida pelo gestor (ver lib/theme.ts)
  themeColor: string;
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
  return useTenantLogoState(tenant).url;
}

// Para quem precisa saber também se a imagem não veio (armazenamento fora do
// ar): o menu lateral volta para a marca padrão em vez de esperar para sempre.
export function useTenantLogoState(tenant: TenantInfo | undefined): { url: string | null; failed: boolean } {
  const updatedAt = tenant?.logo?.updatedAt ?? null;
  const { data, isError } = useQuery<string>({
    queryKey: ['tenant', 'logo', updatedAt],
    queryFn: async () => {
      const r = await api.get<Blob>('/tenants/me/logo', { responseType: 'blob' });
      return blobToDataUrl(r.data);
    },
    enabled: !!updatedAt,
    staleTime: Infinity,
  });
  return { url: updatedAt ? data ?? null : null, failed: !!updatedAt && isError };
}
