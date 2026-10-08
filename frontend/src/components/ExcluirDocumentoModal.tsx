import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';
import { apiErrorMessage } from '../lib/documentCatalog';

interface Props {
  doc: { id: string; label: string | null; name: string; blobPath: string | null; processId: string | null; category: string | null };
  processId: string; // processo aberto na tela (registra a exclusão de um documento pessoal)
  onClose: () => void;
}

// BE-10 / LGPD: exclusão definitiva — o arquivo é apagado do armazenamento e o
// registro do documento é removido. Com arquivo, exige confirmação explícita.
export function ExcluirDocumentoModal({ doc, processId, onClose }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const hasFile = !!doc.blobPath && !doc.blobPath.startsWith('local://');
  const isPersonal = doc.processId === null;
  const name = doc.label ?? doc.name;

  const deleteMut = useMutation({
    mutationFn: () =>
      api.delete(`/documents/${doc.id}`, {
        params: { reason: reason.trim() || undefined, processId },
      }).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents', processId] });
      void qc.invalidateQueries({ queryKey: ['audit', processId] });
      onClose();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Erro ao excluir o documento')),
  });

  return (
    <div className="ds-modal-overlay" onClick={onClose}>
      <div
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="excluir-doc-title"
        style={{ maxWidth: 460 }}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="excluir-doc-title" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)' }}>
          <Icon.Trash size={16} />
          {hasFile ? 'Excluir documento definitivamente' : 'Remover solicitação'}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 12px' }}>
          <strong style={{ color: 'var(--text)' }}>{name}</strong>
          {hasFile
            ? ' — o arquivo será apagado do armazenamento e os dados deste documento serão removidos do sistema (LGPD). Não é possível desfazer.'
            : ' — o cliente deixa de precisar enviar este documento.'}
        </p>
        {isPersonal && (
          <div className="ds-alert warn" style={{ borderRadius: 'var(--radius)', fontSize: 12.5, marginBottom: 12 }}>
            <Icon.AlertTriangle size={14} />
            <span>É um documento pessoal: ele é removido de todos os processos deste cliente.</span>
          </div>
        )}
        <div className="ds-field">
          <label htmlFor="excluir-doc-motivo">Motivo (opcional, fica no log de ações)</label>
          <div className="ds-input">
            <input
              id="excluir-doc-motivo"
              value={reason}
              maxLength={300}
              placeholder="Ex.: solicitação do titular (LGPD)"
              onChange={e => setReason(e.target.value)}
            />
          </div>
        </div>
        {hasFile && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            Entendo que a exclusão é definitiva.
          </label>
        )}
        {error && <div className="ds-alert urgent" style={{ fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="ds-btn ghost sm" onClick={onClose}>Cancelar</button>
          <button
            className="ds-btn sm"
            style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }}
            disabled={(hasFile && !confirmed) || deleteMut.isPending}
            onClick={() => { setError(''); deleteMut.mutate(); }}
          >
            {deleteMut.isPending ? 'Excluindo...' : hasFile ? 'Excluir definitivamente' : 'Remover solicitação'}
          </button>
        </div>
      </div>
    </div>
  );
}
