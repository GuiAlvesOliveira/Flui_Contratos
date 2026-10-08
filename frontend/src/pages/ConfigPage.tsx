import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';
import {
  apiErrorMessage, CATEGORY_LABELS, CATEGORY_ORDER, groupByCategory,
  type DocumentCategory, type DocumentTypeItem,
} from '../lib/documentCatalog';

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

export function ConfigPage({ role }: { role: string | null }) {
  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Configurações</h1>
          <p>Ajustes que valem para toda a assessoria.</p>
        </div>
      </div>
      <ListaDocumentos canEdit={role === 'dono'} />
    </div>
  );
}
