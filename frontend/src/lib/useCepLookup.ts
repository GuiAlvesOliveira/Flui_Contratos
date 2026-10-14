import { useCallback, useEffect, useRef, useState } from 'react';
import { buscarCep, cepDigits, enderecoTexto } from './cep';

export type CepEstado = 'idle' | 'buscando' | 'ok' | 'nao-encontrado' | 'indisponivel';

export const CEP_MENSAGEM: Record<CepEstado, string> = {
  idle: '',
  buscando: 'Buscando o endereço pelo CEP...',
  ok: 'Endereço preenchido pelo CEP. Confira e complete com o número.',
  'nao-encontrado': 'CEP não encontrado. Preencha o endereço manualmente.',
  indisponivel: 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.',
};

// PROD-06: chamado a cada mudança do campo CEP (nunca ao abrir o formulário, para
// não trocar um endereço já salvo). Com 8 dígitos novos, busca e entrega o
// endereço para quem chamou; uma busca nova cancela a anterior.
export function useCepLookup() {
  const [estado, setEstado] = useState<CepEstado>('idle');
  const ultimo = useRef('');
  const atual = useRef<AbortController | null>(null);

  useEffect(() => () => atual.current?.abort(), []);

  const buscar = useCallback((valor: string, aplicar: (endereco: string) => void) => {
    const d = cepDigits(valor);
    if (d.length !== 8) {
      atual.current?.abort();
      ultimo.current = '';
      setEstado('idle');
      return;
    }
    if (d === ultimo.current) return;
    ultimo.current = d;
    atual.current?.abort();
    const ctrl = new AbortController();
    atual.current = ctrl;
    setEstado('buscando');
    buscarCep(d, ctrl.signal)
      .then(e => {
        if (ctrl.signal.aborted) return;
        if (!e) { setEstado('nao-encontrado'); return; }
        aplicar(enderecoTexto(e));
        setEstado('ok');
      })
      .catch(() => { if (!ctrl.signal.aborted) setEstado('indisponivel'); });
  }, []);

  return { estado, mensagem: CEP_MENSAGEM[estado], buscar };
}
