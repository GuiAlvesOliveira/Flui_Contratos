// PROD-06: endereço a partir do CEP, consultado direto do navegador — só o CEP
// sai daqui, nada passa pelo backend. ViaCEP primeiro; se ele estiver fora do
// ar, BrasilAPI. CEP inexistente devolve null; os dois fora do ar, erro.

export const cepDigits = (v: string) => v.replace(/\D/g, '');

export function formatCep(value: string | null | undefined): string {
  if (!value) return '—';
  const d = cepDigits(value);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : value;
}

export interface EnderecoCep { logradouro: string; bairro: string; cidade: string; uf: string }

// "Avenida Paulista, Bela Vista, São Paulo - SP" — o número fica para a pessoa completar
export function enderecoTexto(e: EnderecoCep): string {
  const cidade = e.cidade && e.uf ? `${e.cidade} - ${e.uf}` : e.cidade || e.uf;
  return [e.logradouro, e.bairro, cidade].filter(Boolean).join(', ');
}

export class CepIndisponivel extends Error {}

const TIMEOUT_MS = 5000;

async function getJson(url: string, signal?: AbortSignal): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const cancel = () => ctrl.abort();
  signal?.addEventListener('abort', cancel);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function buscarCep(cep: string, signal?: AbortSignal): Promise<EnderecoCep | null> {
  const d = cepDigits(cep);
  if (d.length !== 8) return null;

  try {
    const r = await getJson(`https://viacep.com.br/ws/${d}/json/`, signal);
    if (r.ok && r.data) {
      if (r.data.erro) return null;
      return { logradouro: text(r.data.logradouro), bairro: text(r.data.bairro), cidade: text(r.data.localidade), uf: text(r.data.uf) };
    }
  } catch {
    if (signal?.aborted) throw new CepIndisponivel('cancelado');
  }

  try {
    const r = await getJson(`https://brasilapi.com.br/api/cep/v1/${d}`, signal);
    if (r.ok && r.data) {
      return { logradouro: text(r.data.street), bairro: text(r.data.neighborhood), cidade: text(r.data.city), uf: text(r.data.state) };
    }
    if (r.status === 404) return null;
  } catch {
    if (signal?.aborted) throw new CepIndisponivel('cancelado');
  }
  throw new CepIndisponivel('CEP indisponível');
}
