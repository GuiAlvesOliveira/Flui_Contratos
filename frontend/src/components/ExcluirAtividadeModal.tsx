import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';
import { apiErrorMessage } from '../lib/documentCatalog';

interface Props {
  processId: string;
  activity: { id: string; description: string };
  // O gestor exclui a qualquer momento, mas precisa dizer o motivo; o autor
  // retira o próprio registro nas primeiras 24 horas, com motivo opcional.
  reasonRequired: boolean;
  onClose: () => void;
}

// Histórico de Atividades: a exclusão nunca é definitiva. A atividade sai do
// histórico (inclusive do portal do cliente) e o registro fica no Log de Ações.
export function ExcluirAtividadeModal({ processId, activity, reasonRequired, onClose }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const excerpt = activity.description.length > 160
    ? `${activity.description.slice(0, 157)}...`
    : activity.description;

  const deleteMut = useMutation({
    mutationFn: () =>
      api.delete(`/processes/${processId}/activities/${activity.id}`, {
        params: { reason: reason.trim() || undefined },
      }).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activities', processId] });
      void qc.invalidateQueries({ queryKey: ['audit', processId] });
      onClose();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Erro ao excluir a atividade')),
  });

  const missingReason = reasonRequired && !reason.trim();

  return (
    <div className="ds-modal-overlay" onClick={onClose}>
      <div
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="excluir-atividade-title"
        style={{ maxWidth: 460 }}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="excluir-atividade-title" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)' }}>
          <Icon.Trash size={16} />
          Excluir atividade
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text)', margin: '6px 0 4px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          “{excerpt}”
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          A atividade sai do histórico, inclusive do portal do cliente. O registro e o motivo ficam guardados no Log de Ações.
        </p>
        <div className="ds-field">
          <label htmlFor="excluir-atividade-motivo">
            {reasonRequired ? 'Motivo da exclusão *' : 'Motivo (opcional)'}
          </label>
          <div className="ds-input">
            <input
              id="excluir-atividade-motivo"
              value={reason}
              maxLength={500}
              placeholder="Ex.: informação registrada no processo errado"
              onChange={e => setReason(e.target.value)}
            />
          </div>
        </div>
        {error && <div className="ds-alert urgent" style={{ fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="ds-btn ghost sm" onClick={onClose}>Cancelar</button>
          <button
            className="ds-btn sm"
            style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }}
            disabled={missingReason || deleteMut.isPending}
            onClick={() => { setError(''); deleteMut.mutate(); }}
          >
            {deleteMut.isPending ? 'Excluindo...' : 'Excluir atividade'}
          </button>
        </div>
      </div>
    </div>
  );
}
