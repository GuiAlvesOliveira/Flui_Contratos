import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';
import {
  apiErrorMessage, CATEGORY_LABELS, groupByCategory, type DocumentTypeItem,
} from '../lib/documentCatalog';

interface Props {
  processId: string;
  // Tipos já solicitados (por id do catálogo ou, em registros antigos, pelo nome)
  requestedTypeIds: Set<string>;
  requestedLabels: Set<string>;
  onClose: () => void;
}

// BE-03: o analista escolhe, entre os cards fixos da lista da assessoria, os
// documentos que o cliente deve enviar. Não há campo livre: só o que está na lista.
export function SolicitarDocumentosModal({ processId, requestedTypeIds, requestedLabels, onClose }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const { data: types = [], isLoading } = useQuery<DocumentTypeItem[]>({
    queryKey: ['document-types'],
    queryFn: () => api.get<DocumentTypeItem[]>('/document-types').then(r => r.data),
  });

  const isRequested = (t: DocumentTypeItem) =>
    requestedTypeIds.has(t.id) || requestedLabels.has(t.label.toLowerCase());

  const toggle = (id: string) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const requestMut = useMutation({
    mutationFn: () =>
      api.post(`/processes/${processId}/documents/request`, { documentTypeIds: [...selected] }).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents', processId] });
      void qc.invalidateQueries({ queryKey: ['audit', processId] });
      onClose();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Erro ao solicitar documentos')),
  });

  return (
    <div className="ds-modal-overlay" onClick={onClose}>
      <div
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="solicitar-docs-title"
        style={{ maxWidth: 720, maxHeight: '86vh', display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid var(--border)' }}>
          <h2 id="solicitar-docs-title">Solicitar documentos</h2>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            Escolha na lista da assessoria o que o cliente deve enviar. A lista é mantida pelo gestor em Configurações → Lista de Documentos.
          </p>
        </div>

        <div style={{ padding: '14px 22px', overflowY: 'auto', flex: 1 }}>
          {isLoading ? (
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Carregando lista...</div>
          ) : types.length === 0 ? (
            <div className="ds-alert warn" style={{ borderRadius: 'var(--radius)' }}>
              <Icon.AlertTriangle size={14} />
              <span>A lista de documentos da assessoria está vazia. Peça ao gestor para cadastrar em Configurações → Lista de Documentos.</span>
            </div>
          ) : (
            groupByCategory(types).map(([cat, list]) => (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div className="ds-section-label">{CATEGORY_LABELS[cat]}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                  {list.map(t => {
                    const already = isRequested(t);
                    const checked = already || selected.has(t.id);
                    return (
                      <label
                        key={t.id}
                        data-testid={`doc-card-${t.id}`}
                        style={{
                          display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 10px',
                          border: `1px solid ${checked && !already ? 'var(--accent)' : 'var(--border)'}`,
                          background: already ? 'var(--bg-subtle)' : checked ? 'var(--accent-soft)' : '#fff',
                          borderRadius: 'var(--radius-sm)', cursor: already ? 'default' : 'pointer',
                          opacity: already ? 0.75 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={already}
                          onChange={() => toggle(t.id)}
                          aria-label={t.label}
                          style={{ marginTop: 2 }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{t.label}</span>
                          {t.description && (
                            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{t.description}</span>
                          )}
                          {already && (
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Já solicitado</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
          {error && <div className="ds-alert urgent" style={{ fontSize: 12.5, marginTop: 8 }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)', marginRight: 'auto' }}>
            {selected.size} documento{selected.size !== 1 ? 's' : ''} selecionado{selected.size !== 1 ? 's' : ''}
          </span>
          <button className="ds-btn ghost sm" onClick={onClose}>Cancelar</button>
          <button
            className="ds-btn accent sm"
            disabled={selected.size === 0 || requestMut.isPending}
            onClick={() => { setError(''); requestMut.mutate(); }}
          >
            {requestMut.isPending ? 'Solicitando...' : 'Solicitar documentos'}
          </button>
        </div>
      </div>
    </div>
  );
}
