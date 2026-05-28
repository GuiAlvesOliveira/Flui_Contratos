import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  process_id: string | null;
  actor_id: string | null;
  action: string;
  from_state: string | null;
  to_state: string | null;
  created_at: string;
  actor_name: string | null;
  current_stage: string | null;
  process_active: boolean | null;
  client_name: string | null;
  client_email: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  stage_change: 'Mudança de etapa',
  stage_change_undo: 'Desfez mudança de etapa',
  process_deactivated: 'Processo removido',
  process_reactivated: 'Processo reativado',
};

const STAGE_LABELS: Record<string, string> = {
  inicial: 'Primeiro Contato',
  cadastro: 'Cadastro',
  analise_credito: 'Análise de Crédito',
  credito_aprovado: 'Crédito Aprovado',
  analise_juridica: 'Análise Jurídica',
  juridico_aprovado: 'Jurídico Aprovado',
  cartorio: 'Cartório',
  assinatura: 'Assinatura',
  cliente_inativo: 'Inativo',
  credito_recusado: 'Crédito Recusado',
  processo_pendencia: 'Pendência',
  active: 'Ativo',
  inactive: 'Inativo',
};

const UNDOABLE_ACTIONS = new Set(['stage_change', 'process_deactivated']);

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function stateLabel(s: string | null) {
  if (!s) return '—';
  return STAGE_LABELS[s] ?? s;
}

function actionColor(action: string): string {
  if (action === 'process_deactivated') return 'var(--red)';
  if (action === 'process_reactivated') return 'var(--green, #22c55e)';
  if (action.endsWith('_undo')) return 'var(--amber, #f59e0b)';
  return 'var(--text-muted)';
}

// ── Main ───────────────────────────────────────────────────────────────────────

interface Props {
  onOpenProcess: (id: string) => void;
}

export function LogsPage({ onOpenProcess }: Props) {
  const qc = useQueryClient();
  const [undoErrors, setUndoErrors] = useState<Record<string, string>>({});
  const [undoSuccess, setUndoSuccess] = useState<Record<string, true>>({});
  const [showEmailTest, setShowEmailTest] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null);

  const emailTestMut = useMutation({
    mutationFn: (to: string) => api.post('/email/test', { to }).then(r => r.data),
    onSuccess: () => { setTestResult('ok'); },
    onError: () => { setTestResult('error'); },
  });

  const { data: logs = [], isLoading, isError, refetch } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs'],
    queryFn: () => api.get<AuditLog[]>('/audit-logs?limit=100').then(r => r.data),
    refetchInterval: 30_000,
  });

  const undoMut = useMutation({
    mutationFn: (logId: string) => api.post(`/audit-logs/${logId}/undo`).then(r => r.data),
    onSuccess: (_, logId) => {
      setUndoErrors(e => { const n = { ...e }; delete n[logId]; return n; });
      setUndoSuccess(s => ({ ...s, [logId]: true }));
      void qc.invalidateQueries({ queryKey: ['audit-logs'] });
      void qc.invalidateQueries({ queryKey: ['processes'] });
    },
    onError: (err: unknown, logId) => {
      const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const msg = Array.isArray(axiosMsg) ? axiosMsg.join('; ') : (axiosMsg ?? 'Erro ao desfazer');
      setUndoErrors(e => ({ ...e, [logId]: msg }));
    },
  });

  const handleUndo = (log: AuditLog) => {
    const actionLabel = ACTION_LABELS[log.action] ?? log.action;
    const who = log.client_name ?? log.client_email ?? 'este processo';
    if (!window.confirm(`Desfazer "${actionLabel}" de ${who}?`)) return;
    setUndoErrors(e => { const n = { ...e }; delete n[log.id]; return n; });
    setUndoSuccess(s => { const n = { ...s }; delete n[log.id]; return n; });
    undoMut.mutate(log.id);
  };

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Log de Ações</h1>
          <p>
            {isLoading ? 'Carregando...' : `${logs.length} evento${logs.length !== 1 ? 's' : ''} registrado${logs.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="actions">
          <button className="ds-btn ghost sm" onClick={() => { setShowEmailTest(v => !v); setTestResult(null); }}>
            <Icon.Mail size={13} />
            Testar e-mail
          </button>
          <button className="ds-btn ghost sm" onClick={() => refetch()}>
            <Icon.RotateCcw size={13} />
            Atualizar
          </button>
        </div>
      </div>

      {showEmailTest && (
        <div className="ds-card" style={{ marginBottom: 16, padding: '16px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Testar integração SMTP</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="ds-input" style={{ flex: '0 0 280px' }}>
              <Icon.Mail size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
              <input
                type="email"
                placeholder="destinatario@email.com"
                value={testEmail}
                onChange={e => { setTestEmail(e.target.value); setTestResult(null); }}
              />
            </div>
            <button
              className="ds-btn accent sm"
              disabled={!testEmail || emailTestMut.isPending}
              onClick={() => { setTestResult(null); emailTestMut.mutate(testEmail); }}
            >
              {emailTestMut.isPending ? 'Enviando...' : 'Enviar'}
            </button>
            {testResult === 'ok' && (
              <span style={{ fontSize: 12.5, color: 'var(--green, #22c55e)', fontWeight: 500 }}>
                ✓ E-mail enviado com sucesso
              </span>
            )}
            {testResult === 'error' && (
              <span style={{ fontSize: 12.5, color: 'var(--red)' }}>
                ✗ Falha no envio — verifique as variáveis SMTP no servidor
              </span>
            )}
          </div>
        </div>
      )}

      {isError && (
        <div className="ds-alert urgent" style={{ marginBottom: 16 }}>
          <Icon.AlertTriangle size={14} />
          <span>Erro ao carregar logs.</span>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando...</div>
      ) : logs.length === 0 ? (
        <div className="ds-card">
          <div className="ds-card-body" style={{ textAlign: 'center', padding: 60, color: 'var(--text-faint)', fontSize: 13 }}>
            Nenhuma ação registrada ainda.
          </div>
        </div>
      ) : (
        <div className="ds-card">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Responsável</th>
                <th>Cliente</th>
                <th>Ação</th>
                <th>De → Para</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const isUndoable = UNDOABLE_ACTIONS.has(log.action) && !!log.process_id;
                const hasError = !!undoErrors[log.id];
                const wasUndone = !!undoSuccess[log.id];
                return (
                  <>
                    <tr key={log.id}>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {fmtDate(log.created_at)}
                      </td>
                      <td style={{ fontSize: 13 }}>{log.actor_name ?? '—'}</td>
                      <td>
                        {log.process_id ? (
                          <button
                            className="ds-btn ghost sm"
                            style={{ fontWeight: 500, padding: 0, height: 'auto', color: 'var(--accent)' }}
                            onClick={() => onOpenProcess(log.process_id!)}
                          >
                            {log.client_name ?? log.client_email ?? '—'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 13 }}>{log.client_name ?? log.client_email ?? '—'}</span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: 12.5, color: actionColor(log.action) }}>
                          {ACTION_LABELS[log.action] ?? log.action}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {log.from_state || log.to_state ? (
                          <>
                            <span>{stateLabel(log.from_state)}</span>
                            {' → '}
                            <span style={{ fontWeight: 500 }}>{stateLabel(log.to_state)}</span>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {wasUndone ? (
                          <span style={{ fontSize: 11, color: 'var(--green, #22c55e)' }}>Desfeito</span>
                        ) : isUndoable ? (
                          <button
                            className="ds-btn ghost sm"
                            style={{ gap: 4 }}
                            onClick={() => handleUndo(log)}
                            disabled={undoMut.isPending}
                            title="Desfazer esta ação"
                          >
                            <Icon.RotateCcw size={12} />
                            Desfazer
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {hasError && (
                      <tr key={`err-${log.id}`}>
                        <td colSpan={6} style={{ padding: '0 16px 8px', fontSize: 11.5, color: 'var(--red)' }}>
                          {undoErrors[log.id]}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
