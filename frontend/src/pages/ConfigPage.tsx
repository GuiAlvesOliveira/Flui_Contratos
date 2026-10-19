import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';
import { SenhaTemporaria } from '../components/SenhaTemporaria';
import {
  apiErrorMessage, CATEGORY_LABELS, CATEGORY_ORDER, groupByCategory,
  type DocumentCategory, type DocumentTypeItem,
} from '../lib/documentCatalog';
import { isValidCpf, onlyDigits } from '../lib/validators';
import { LOGO_MAX_BYTES, LOGO_TYPES, useTenant, useTenantLogo, type TenantInfo } from '../lib/useTenant';

// PROD-04: nome e logo da assessoria. O gestor altera; o analista só consulta
// (a API recusa o PATCH com 403). O logo aparece no menu lateral e no portal
// do cliente; PNG ou JPG até 1 MB, guardado no armazenamento privado.
function AssessoriaCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: tenant, isLoading, isError } = useTenant();
  const logo = useTenantLogo(tenant);
  const [nome, setNome] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const done = (msg: string) => (data: TenantInfo) => {
    qc.setQueryData(['tenant', 'me'], data);
    setError('');
    setOk(msg);
    setConfirmRemove(false);
  };
  const onError = (err: unknown) => { setOk(''); setError(apiErrorMessage(err, 'Não foi possível salvar')); };

  const nameMut = useMutation({
    mutationFn: (name: string) => api.patch<TenantInfo>('/tenants/me', { name }).then(r => r.data),
    onSuccess: (data) => { done('Nome da assessoria salvo.')(data); setNome(null); },
    onError,
  });
  const logoMut = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return api.put<TenantInfo>('/tenants/me/logo', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
    onSuccess: done('Logo atualizado.'),
    onError,
  });
  const removeMut = useMutation({
    mutationFn: () => api.delete<TenantInfo>('/tenants/me/logo').then(r => r.data),
    onSuccess: done('Logo removido.'),
    onError,
  });

  function escolherLogo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!LOGO_TYPES.includes(f.type)) { setOk(''); setError('O logo precisa ser uma imagem PNG ou JPG.'); return; }
    if (f.size > LOGO_MAX_BYTES) { setOk(''); setError('O logo pode ter no máximo 1 MB.'); return; }
    setError('');
    logoMut.mutate(f);
  }

  const valorNome = nome ?? tenant?.name ?? '';
  const nomeValido = valorNome.trim().length >= 2 && valorNome.trim().length <= 100;
  const busy = nameMut.isPending || logoMut.isPending || removeMut.isPending;

  return (
    <div className="ds-card" style={{ marginBottom: 16 }}>
      <div className="ds-card-hdr">
        <h3>Assessoria</h3>
        <span className="meta">{canEdit ? 'nome e logo exibidos para a equipe e os clientes' : 'somente o gestor altera'}</span>
      </div>
      <div className="ds-card-body">
        {isLoading ? (
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Carregando...</div>
        ) : isError || !tenant ? (
          <div role="alert" style={{ fontSize: 13, color: 'var(--red)' }}>Não foi possível carregar os dados da assessoria.</div>
        ) : (
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="ds-tenant-logo-box" aria-label="Logo da assessoria">
              {logo ? <img src={logo} alt={`Logo de ${tenant.name}`} /> : <span>Sem logo</span>}
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              {canEdit ? (
                <form onSubmit={e => { e.preventDefault(); if (nomeValido) nameMut.mutate(valorNome.trim()); }}
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
                  <div className="ds-field" style={{ margin: 0, flex: '1 1 240px' }}>
                    <label htmlFor="assessoria-nome">Nome da assessoria</label>
                    <div className="ds-input">
                      <input id="assessoria-nome" value={valorNome} maxLength={100} onChange={e => { setNome(e.target.value); setOk(''); }} />
                    </div>
                  </div>
                  <button type="submit" className="ds-btn accent sm" style={{ height: 32 }}
                    disabled={!nomeValido || valorNome.trim() === tenant.name || busy}>
                    {nameMut.isPending ? 'Salvando...' : 'Salvar nome'}
                  </button>
                </form>
              ) : (
                <div style={{ marginBottom: 8 }}>
                  <div className="ds-section-label">Nome da assessoria</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{tenant.name}</div>
                </div>
              )}
              {canEdit && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg" aria-label="Arquivo do logo"
                    onChange={escolherLogo} style={{ display: 'none' }} />
                  <button type="button" className="ds-btn sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                    <Icon.Upload size={12} /> {logoMut.isPending ? 'Enviando...' : tenant.logo ? 'Trocar logo' : 'Enviar logo'}
                  </button>
                  {tenant.logo && !confirmRemove && (
                    <button type="button" className="ds-btn ghost sm" disabled={busy} onClick={() => setConfirmRemove(true)}>Remover logo</button>
                  )}
                  {confirmRemove && (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                      Remover o logo?
                      <button type="button" className="ds-btn sm" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => removeMut.mutate()}>Sim, remover</button>
                      <button type="button" className="ds-btn ghost sm" onClick={() => setConfirmRemove(false)}>Cancelar</button>
                    </span>
                  )}
                  <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>PNG ou JPG, até 1 MB.</span>
                </div>
              )}
              {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 10 }}>{error}</div>}
              {ok && <div role="status" style={{ fontSize: 12.5, color: 'var(--green)', marginTop: 10 }}>{ok}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface Draft {
  label: string;
  category: DocumentCategory;
  description: string;
}

const EMPTY: Draft = { label: '', category: 'pessoal', description: '' };

const selectStyle = { flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' } as const;

function CategorySelect({ value, onChange, label }: { value: DocumentCategory; onChange: (c: DocumentCategory) => void; label: string }) {
  return (
    <div className="ds-input">
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value as DocumentCategory)} style={selectStyle}>
        {CATEGORY_ORDER.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
      </select>
    </div>
  );
}

// BE-03: lista de documentos da assessoria. O gestor (dono) altera para a
// assessoria inteira; o analista só consulta. Itens são desativados, não
// apagados, para os documentos já solicitados manterem o histórico.
function ListaDocumentos({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [error, setError] = useState('');

  const queryKey = ['document-types', canEdit ? 'all' : 'active'];
  const { data: types = [], isLoading } = useQuery<DocumentTypeItem[]>({
    queryKey,
    queryFn: () =>
      api.get<DocumentTypeItem[]>('/document-types', { params: canEdit ? { includeInactive: true } : {} }).then(r => r.data),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['document-types'] });
  const onError = (err: unknown) => setError(apiErrorMessage(err, 'Erro ao salvar a lista'));

  const createMut = useMutation({
    mutationFn: (d: Draft) =>
      api.post('/document-types', { label: d.label.trim(), category: d.category, description: d.description.trim() || undefined }),
    onSuccess: () => { setDraft(EMPTY); setError(''); void refresh(); },
    onError,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<DocumentTypeItem> }) => api.patch(`/document-types/${id}`, body),
    onSuccess: () => { setEditing(null); setError(''); void refresh(); },
    onError,
  });

  const activeCount = types.filter(t => t.active).length;

  return (
    <div className="ds-card">
      <div className="ds-card-hdr">
        <h3>Lista de Documentos</h3>
        <span className="meta">{activeCount} documento{activeCount !== 1 ? 's' : ''} disponíve{activeCount !== 1 ? 'is' : 'l'} para solicitar</span>
      </div>
      <div className="ds-card-body">
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          São os únicos documentos que os analistas podem pedir aos clientes, e a lista vale para toda a assessoria.
          {canEdit ? ' Desativar um item tira ele da escolha, mas mantém os documentos já solicitados.' : ' Somente o gestor altera esta lista.'}
        </p>

        {canEdit && (
          <form
            onSubmit={e => { e.preventDefault(); if (draft.label.trim().length >= 2) createMut.mutate(draft); }}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 2fr) minmax(150px, 1fr) minmax(180px, 2fr) auto', gap: 8, alignItems: 'end', marginBottom: 14 }}
            className="ds-doc-form"
          >
            <div className="ds-field" style={{ margin: 0 }}>
              <label htmlFor="novo-doc-nome">Novo documento</label>
              <div className="ds-input">
                <input id="novo-doc-nome" value={draft.label} maxLength={120} placeholder="Ex.: Matrícula atualizada do imóvel"
                  onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
              </div>
            </div>
            <div className="ds-field" style={{ margin: 0 }}>
              <label>Categoria</label>
              <CategorySelect label="Categoria do novo documento" value={draft.category} onChange={c => setDraft(d => ({ ...d, category: c }))} />
            </div>
            <div className="ds-field" style={{ margin: 0 }}>
              <label htmlFor="novo-doc-orientacao">Orientação (opcional)</label>
              <div className="ds-input">
                <input id="novo-doc-orientacao" value={draft.description} maxLength={500} placeholder="Ex.: emitida há menos de 30 dias"
                  onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
              </div>
            </div>
            <button type="submit" className="ds-btn accent sm" style={{ height: 32 }} disabled={draft.label.trim().length < 2 || createMut.isPending}>
              <Icon.Plus size={12} /> Adicionar
            </button>
          </form>
        )}

        {error && <div className="ds-alert urgent" style={{ fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

        {isLoading ? (
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Carregando...</div>
        ) : types.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Nenhum documento na lista.</div>
        ) : (
          groupByCategory(types).map(([cat, list]) => (
            <div key={cat} style={{ marginBottom: 14 }}>
              <div className="ds-section-label">{CATEGORY_LABELS[cat]}</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                {list.map((t, idx) => {
                  const isEditing = editing?.id === t.id;
                  return (
                    <div key={t.id} data-testid={`tipo-${t.id}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: idx === 0 ? 'none' : '1px solid var(--border)', opacity: t.active ? 1 : 0.6, flexWrap: 'wrap' }}>
                      {isEditing ? (
                        <>
                          <div className="ds-input" style={{ flex: '2 1 180px' }}>
                            <input aria-label="Nome do documento" value={editing.draft.label} maxLength={120}
                              onChange={e => setEditing({ id: t.id, draft: { ...editing.draft, label: e.target.value } })} />
                          </div>
                          <div style={{ flex: '1 1 140px' }}>
                            <CategorySelect label="Categoria" value={editing.draft.category}
                              onChange={c => setEditing({ id: t.id, draft: { ...editing.draft, category: c } })} />
                          </div>
                          <div className="ds-input" style={{ flex: '2 1 180px' }}>
                            <input aria-label="Orientação" value={editing.draft.description} maxLength={500} placeholder="Orientação (opcional)"
                              onChange={e => setEditing({ id: t.id, draft: { ...editing.draft, description: e.target.value } })} />
                          </div>
                          <button className="ds-btn accent sm" disabled={editing.draft.label.trim().length < 2 || updateMut.isPending}
                            onClick={() => updateMut.mutate({ id: t.id, body: { label: editing.draft.label.trim(), category: editing.draft.category, description: editing.draft.description.trim() } })}>
                            Salvar
                          </button>
                          <button className="ds-btn ghost sm" onClick={() => setEditing(null)}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <div style={{ flex: 1, minWidth: 160 }}>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{t.label}</div>
                            {t.description && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t.description}</div>}
                          </div>
                          {!t.active && <span className="ds-badge neutral"><span className="dot" />Inativo</span>}
                          {canEdit && (
                            <>
                              <button className="ds-btn ghost sm" aria-label={`Editar ${t.label}`}
                                onClick={() => setEditing({ id: t.id, draft: { label: t.label, category: t.category, description: t.description ?? '' } })}>
                                <Icon.Edit size={12} /> Editar
                              </button>
                              <button className="ds-btn ghost sm" disabled={updateMut.isPending}
                                onClick={() => updateMut.mutate({ id: t.id, body: { active: !t.active } })}>
                                {t.active ? 'Desativar' : 'Reativar'}
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface ImportLine {
  line: number;
  name: string;
  email: string;
  role: string;
  success: boolean;
  error?: string;
  temporaryPassword?: string;
}
interface ImportResult { total: number; created: number; failed: number; results: ImportLine[] }

const ROLE_LABELS: Record<string, string> = { dono: 'Gestor', analista: 'Analista', cliente: 'Cliente' };

// Começa com o BOM para o Excel abrir o arquivo como UTF-8
const MODELO_CSV =
  String.fromCharCode(0xfeff) +
  'nome;sobrenome;email;cpf;perfil\r\n' +
  'Ana;Souza;ana.souza@exemplo.com;529.982.247-25;analista\r\n' +
  'Bruno;Lima;bruno.lima@exemplo.com;111.444.777-35;cliente\r\n';

function baixarModelo() {
  const url = URL.createObjectURL(new Blob([MODELO_CSV], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo-importacao-usuarios.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// BE-01: cadastro em lote pelo arquivo CSV. Cada linha passa pelas mesmas
// regras do cadastro individual; as linhas com erro não impedem as outras.
function ImportarUsuarios({ role }: { role: string | null }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return api.post<ImportResult>('/users/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data);
    },
    onSuccess: data => {
      setResult(data);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: err => setError(apiErrorMessage(err, 'Não foi possível importar o arquivo')),
  });

  return (
    <div className="ds-card" style={{ marginTop: 16 }}>
      <div className="ds-card-hdr">
        <h3>Importar usuários (CSV)</h3>
        <span className="meta">{role === 'dono' ? 'analistas e clientes' : 'clientes'}, até 100 por arquivo</span>
      </div>
      <div className="ds-card-body">
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Colunas: <strong>nome; sobrenome; email; cpf; perfil</strong> (perfil {role === 'dono' ? '“analista” ou “cliente”' : '“cliente”'}).
          Pode ser o CSV salvo pelo Excel. Cada pessoa recebe uma senha temporária, que precisa ser trocada no primeiro acesso.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="Arquivo CSV de usuários"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); setResult(null); }}
            style={{ fontSize: 12.5 }}
          />
          <button className="ds-btn accent sm" disabled={!file || mut.isPending}
            onClick={() => { if (file) { setError(''); mut.mutate(file); } }}>
            {mut.isPending ? 'Importando...' : 'Importar'}
          </button>
          <button className="ds-btn ghost sm" onClick={baixarModelo}>
            <Icon.Download size={12} /> Baixar modelo
          </button>
        </div>

        {error && <div className="ds-alert urgent" style={{ fontSize: 12.5, marginTop: 12 }}>{error}</div>}

        {result && (
          <div style={{ marginTop: 14 }}>
            <div role="status" style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>{result.created}</strong> de {result.total} usuário{result.total !== 1 ? 's' : ''} criado{result.created !== 1 ? 's' : ''}
              {result.failed > 0 && <> · <span style={{ color: 'var(--red)' }}>{result.failed} com erro</span></>}
            </div>
            <table className="ds-table" aria-label="Resultado da importação">
              <thead>
                <tr><th>Linha</th><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Resultado</th><th>Senha temporária</th></tr>
              </thead>
              <tbody>
                {result.results.map(r => (
                  <tr key={r.line}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.line}</td>
                    <td>{r.name || '—'}</td>
                    <td>{r.email || '—'}</td>
                    <td>{ROLE_LABELS[r.role] ?? (r.role || '—')}</td>
                    <td>
                      {r.success
                        ? <span className="ds-badge green"><span className="dot" />Criado</span>
                        : <span style={{ fontSize: 12, color: 'var(--red)' }}>{r.error}</span>}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{r.temporaryPassword ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.created > 0 && (
              <div className="ds-alert warn" style={{ fontSize: 12.5, marginTop: 10 }}>
                Repasse a senha temporária a cada pessoa. Até o primeiro acesso ela pode ser vista de novo: a dos analistas em Equipe e a dos clientes na página do processo.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface Analista {
  id: string;
  name: string | null;
  surname: string | null;
  email: string;
  status: 'invited' | 'active' | 'disabled';
  onboardingCompleted: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

interface NovoAnalista { name: string; surname: string; email: string; cpf: string }
const NOVO_VAZIO: NovoAnalista = { name: '', surname: '', email: '', cpf: '' };

// Ainda entra com a senha temporária (a API recusa depois da troca de senha)
const aguardandoPrimeiroAcesso = (a: Analista) => a.mustChangePassword && a.status !== 'disabled';

function situacao(a: Analista): { label: string; color: string } {
  if (a.status === 'disabled') return { label: 'Desativado', color: 'red' };
  if (a.status === 'invited' || a.mustChangePassword) return { label: 'Aguardando primeiro acesso', color: 'amber' };
  if (!a.onboardingCompleted) return { label: 'Cadastro incompleto', color: 'amber' };
  return { label: 'Ativo', color: 'green' };
}

// PROD-04: ações de cada analista na Equipe, pelos endpoints que já existiam —
// reenviar o convite (e-mail com o link para criar a senha) enquanto ele não fez
// o primeiro acesso, e desativar (bloqueia o acesso na hora) ou reativar.
function AcoesAnalista({ a }: { a: Analista }) {
  const qc = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const nome = a.name ?? a.email;

  const statusMut = useMutation({
    mutationFn: (status: 'active' | 'disabled') => api.patch(`/users/${a.id}/status`, { status }),
    onSuccess: (_d, status) => {
      setConfirmar(false);
      setMsg({ ok: true, text: status === 'disabled' ? 'Acesso desativado.' : 'Acesso reativado.' });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: err => setMsg({ ok: false, text: apiErrorMessage(err, 'Não foi possível alterar o acesso') }),
  });
  const inviteMut = useMutation({
    mutationFn: () => api.post(`/users/${a.id}/resend-invite`),
    onSuccess: () => {
      setMsg({ ok: true, text: `Convite reenviado para ${a.email}.` });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: err => setMsg({ ok: false, text: apiErrorMessage(err, 'Não foi possível reenviar o convite') }),
  });
  const busy = statusMut.isPending || inviteMut.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {aguardandoPrimeiroAcesso(a) && (
          <button className="ds-btn ghost sm" disabled={busy} aria-label={`Reenviar convite para ${nome}`}
            onClick={() => { setMsg(null); inviteMut.mutate(); }}>
            <Icon.Mail size={12} /> {inviteMut.isPending ? 'Enviando...' : 'Reenviar convite'}
          </button>
        )}
        {a.status === 'disabled' ? (
          <button className="ds-btn ghost sm" disabled={busy} aria-label={`Reativar ${nome}`}
            onClick={() => { setMsg(null); statusMut.mutate('active'); }}>
            <Icon.RotateCcw size={12} /> Reativar
          </button>
        ) : confirmar ? (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
            Desativar o acesso?
            <button className="ds-btn sm" style={{ color: 'var(--red)' }} disabled={busy}
              onClick={() => statusMut.mutate('disabled')}>Sim, desativar</button>
            <button className="ds-btn ghost sm" onClick={() => setConfirmar(false)}>Cancelar</button>
          </span>
        ) : (
          <button className="ds-btn ghost sm" style={{ color: 'var(--red)' }} disabled={busy} aria-label={`Desativar ${nome}`}
            onClick={() => { setMsg(null); setConfirmar(true); }}>
            <Icon.X size={12} /> Desativar
          </button>
        )}
      </div>
      {msg && (
        <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 11.5, color: msg.ok ? 'var(--green)' : 'var(--red)', whiteSpace: 'normal' }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}

// Equipe: o gestor cadastra os analistas da assessoria (POST /users). A senha
// temporária é aleatória (SEC-01) e precisa ser trocada no primeiro acesso; até
// lá o gestor pode vê-la de novo (BE-18), na coluna "Senha temporária".
function EquipeAnalistas() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<NovoAnalista>(NOVO_VAZIO);
  const [error, setError] = useState('');
  const [criado, setCriado] = useState<{ nome: string; email: string; senha: string } | null>(null);
  const [copiada, setCopiada] = useState(false);

  const { data: analistas = [], isLoading } = useQuery<Analista[]>({
    queryKey: ['users', 'analista'],
    queryFn: () => api.get<Analista[]>('/users', { params: { role: 'analista' } }).then(r => r.data),
  });

  const mut = useMutation({
    mutationFn: (f: NovoAnalista) =>
      api.post<{ temporaryPassword?: string }>('/users', {
        role: 'analista',
        name: f.name.trim(),
        ...(f.surname.trim() ? { surname: f.surname.trim() } : {}),
        email: f.email.trim().toLowerCase(),
        cpf: onlyDigits(f.cpf),
      }).then(r => r.data),
    onSuccess: (data, f) => {
      setCriado({ nome: [f.name.trim(), f.surname.trim()].filter(Boolean).join(' '), email: f.email.trim().toLowerCase(), senha: data.temporaryPassword ?? '' });
      setCopiada(false);
      setForm(NOVO_VAZIO);
      setAberto(false);
      setError('');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: err => setError(apiErrorMessage(err, 'Não foi possível cadastrar o analista')),
  });

  const set = (k: keyof NovoAnalista) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setForm(f => ({ ...f, [k]: v }));
  };

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Informe o nome do analista.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Informe um e-mail válido.');
    if (!isValidCpf(form.cpf)) return setError('CPF inválido. Confira os 11 dígitos.');
    setError('');
    mut.mutate(form);
  }

  async function copiar() {
    if (!criado) return;
    try {
      await navigator.clipboard.writeText(criado.senha);
      setCopiada(true);
    } catch { /* sem acesso à área de transferência: o gestor copia à mão */ }
  }

  const ordenados = [...analistas].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email, 'pt-BR'));

  return (
    <div className="ds-card" style={{ marginBottom: 16 }}>
      <div className="ds-card-hdr">
        <h3>Equipe</h3>
        <span className="meta">{analistas.length} analista{analistas.length !== 1 ? 's' : ''}</span>
        {!aberto && (
          <button className="ds-btn accent sm" style={{ marginLeft: 'auto' }}
            onClick={() => { setAberto(true); setCriado(null); setError(''); }}>
            <Icon.Plus size={12} /> Adicionar analista
          </button>
        )}
      </div>
      <div className="ds-card-body">
        {aberto && (
          <form onSubmit={enviar} aria-label="Novo analista" noValidate
            style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(140px, 1fr) minmax(200px, 1.5fr) minmax(140px, 1fr)', gap: 8, alignItems: 'end', marginBottom: 12 }}
            className="ds-doc-form">
            <div className="ds-field" style={{ margin: 0 }}>
              <label htmlFor="analista-nome">Nome</label>
              <div className="ds-input"><input id="analista-nome" value={form.name} maxLength={100} onChange={set('name')} autoFocus /></div>
            </div>
            <div className="ds-field" style={{ margin: 0 }}>
              <label htmlFor="analista-sobrenome">Sobrenome (opcional)</label>
              <div className="ds-input"><input id="analista-sobrenome" value={form.surname} maxLength={100} onChange={set('surname')} /></div>
            </div>
            <div className="ds-field" style={{ margin: 0 }}>
              <label htmlFor="analista-email">E-mail</label>
              <div className="ds-input"><input id="analista-email" type="email" value={form.email} maxLength={255} placeholder="nome@assessoria.com.br" onChange={set('email')} /></div>
            </div>
            <div className="ds-field" style={{ margin: 0 }}>
              <label htmlFor="analista-cpf">CPF</label>
              <div className="ds-input"><input id="analista-cpf" value={form.cpf} maxLength={14} inputMode="numeric" placeholder="000.000.000-00" onChange={set('cpf')} /></div>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="ds-btn ghost sm" onClick={() => { setAberto(false); setForm(NOVO_VAZIO); setError(''); }}>Cancelar</button>
              <button type="submit" className="ds-btn accent sm" disabled={mut.isPending}>
                {mut.isPending ? 'Cadastrando...' : 'Cadastrar analista'}
              </button>
            </div>
          </form>
        )}

        {error && (
          <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {criado && (
          <div role="status" style={{ fontSize: 12.5, padding: '10px 12px', background: 'var(--amber-soft)', border: '1px solid var(--amber-soft-border)', borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>
            <div><strong>{criado.nome}</strong> foi cadastrado. Repasse ao analista o e-mail <strong>{criado.email}</strong> e a senha temporária abaixo; no primeiro acesso ele cria a própria senha.</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <code aria-label="Senha temporária" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, wordBreak: 'break-all' }}>{criado.senha}</code>
              <button type="button" className="ds-btn ghost sm" onClick={() => void copiar()}>
                {copiada ? <><Icon.Check size={12} /> Copiada</> : 'Copiar senha'}
              </button>
            </div>
            <div style={{ marginTop: 6 }}>Até o primeiro acesso, ela também aparece na lista abaixo, em “Ver senha temporária”.</div>
          </div>
        )}

        {isLoading ? (
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Carregando...</div>
        ) : ordenados.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Nenhum analista cadastrado ainda.</div>
        ) : (
          <table className="ds-table" aria-label="Analistas da assessoria">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Situação</th><th>Cadastro</th><th>Senha temporária</th><th>Ações</th></tr></thead>
            <tbody>
              {ordenados.map(a => {
                const s = situacao(a);
                return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500 }}>{[a.name, a.surname].filter(Boolean).join(' ') || '—'}</td>
                    <td>{a.email}</td>
                    <td><span className={`ds-badge ${s.color}`}><span className="dot" />{s.label}</span></td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{new Date(a.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td>{aguardandoPrimeiroAcesso(a) ? <SenhaTemporaria userId={a.id} /> : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                    <td><AcoesAnalista a={a} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function ConfigPage({ role }: { role: string | null }) {
  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Configurações</h1>
          <p>Ajustes que valem para toda a assessoria.</p>
        </div>
      </div>
      <AssessoriaCard canEdit={role === 'dono'} />
      {role === 'dono' && <EquipeAnalistas />}
      <ListaDocumentos canEdit={role === 'dono'} />
      {(role === 'dono' || role === 'analista') && <ImportarUsuarios role={role} />}
    </div>
  );
}
