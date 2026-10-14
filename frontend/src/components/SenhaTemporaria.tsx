import { useState } from 'react';
import { api } from '../api/axiosInstance';
import { apiErrorMessage } from '../lib/documentCatalog';
import * as Icon from './icons';

interface TemporaryPasswordView { temporaryPassword: string | null; createdAt: string | null }

// BE-18: mostra de novo a senha temporária de quem ainda não fez o primeiro
// acesso. A senha só é buscada no clique (não fica em cache) e cada consulta é
// registrada na auditoria. Se ela não foi guardada (cadastro anterior ao BE-18),
// dá para gerar outra; a anterior deixa de valer.
export function SenhaTemporaria({ userId }: { userId: string }) {
  const [senha, setSenha] = useState<string | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [confirmarNova, setConfirmarNova] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [copiada, setCopiada] = useState(false);

  async function executar(req: () => Promise<{ data: TemporaryPasswordView }>) {
    setCarregando(true);
    setErro('');
    try {
      const { data } = await req();
      setSenha(data.temporaryPassword);
      setIndisponivel(!data.temporaryPassword);
      setCopiada(false);
    } catch (err) {
      setErro(apiErrorMessage(err, 'Não foi possível buscar a senha temporária'));
    } finally {
      setCarregando(false);
      setConfirmarNova(false);
    }
  }

  const ver = () => executar(() => api.get<TemporaryPasswordView>(`/users/${userId}/temporary-password`));
  const gerar = () => executar(() => api.post<TemporaryPasswordView>(`/users/${userId}/temporary-password`));

  async function copiar() {
    if (!senha) return;
    try {
      await navigator.clipboard.writeText(senha);
      setCopiada(true);
    } catch { /* sem acesso à área de transferência: copia à mão */ }
  }

  if (erro) {
    return <span role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{erro}</span>;
  }

  if (senha) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <code aria-label="Senha temporária" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, padding: '2px 6px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, wordBreak: 'break-all' }}>
          {senha}
        </code>
        <button type="button" className="ds-btn ghost sm" onClick={() => void copiar()}>
          {copiada ? <><Icon.Check size={12} /> Copiada</> : 'Copiar'}
        </button>
        <button type="button" className="ds-btn ghost sm" onClick={() => setSenha(null)}>Ocultar</button>
      </span>
    );
  }

  if (indisponivel) {
    return confirmarNova ? (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        <span>A senha atual deixa de valer. Gerar outra?</span>
        <button type="button" className="ds-btn accent sm" disabled={carregando} onClick={() => void gerar()}>
          {carregando ? 'Gerando...' : 'Gerar'}
        </button>
        <button type="button" className="ds-btn ghost sm" onClick={() => setConfirmarNova(false)}>Cancelar</button>
      </span>
    ) : (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
        <span>Senha não guardada (cadastro antigo).</span>
        <button type="button" className="ds-btn ghost sm" onClick={() => setConfirmarNova(true)}>Gerar nova senha</button>
      </span>
    );
  }

  return (
    <button type="button" className="ds-btn ghost sm" disabled={carregando} onClick={() => void ver()}>
      {carregando ? 'Buscando...' : 'Ver senha temporária'}
    </button>
  );
}
