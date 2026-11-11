import { Fragment, useState } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';
import { ACTION_LABELS, stateLabel } from '../lib/auditActions';
import { apiErrorMessage } from '../lib/documentCatalog';
import { EmailsPanel } from '../components/EmailsPanel';
import { ROLE_LABELS } from '../lib/emailOutbox';

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
  // nos registros de e-mail (email_*): o assunto e o papel de quem recebe
  metadata?: { subject?: string; recipientRole?: string; error?: string } | null;
  // Total de eventos que atendem aos filtros, repetido em cada linha (BE-07)
  total_count?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;


const UNDOABLE_ACTIONS = new Set(['stage_change', 'process_deactivated']);

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function actionColor(action: string): string {
  if (action === 'process_deactivated' || action === 'document_deleted' || action === 'email_failed') return 'var(--red)';
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
  // Ações = o log de auditoria; E-mails = o controle do envio pelo gestor
  const [tab, setTab] = useState<'acoes' | 'emails'>('acoes');
  const [undoErrors, setUndoErrors] = useState<Record<string, string>>({});
  const [undoSuccess, setUndoSuccess] = useState<Record<string, true>>({});
  const [showEmailTest, setShowEmailTest] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null);
  const [testDetail, setTestDetail] = useState<{ to?: string; from?: string; error?: string }>({});
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Qualquer mudança de filtro volta para a primeira página.
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(0);
  };
  const clearFilters = () => changeFilter(() => { setActionFilter(''); setFromDate(''); setToDate(''); });
  const hasFilters = !!(actionFilter || fromDate || toDate);
  const invalidPeriod = !!(fromDate && toDate && fromDate > toDate);

  const emailTestMut = useMutation({
    mutationFn: (to: string) => api.post<{ ok: boolean; to: string; from?: string }>('/email/test', { to }).then(r => r.data),
    onSuccess: (data) => { setTestDetail({ to: data.to, from: data.from }); setTestResult('ok'); },
    onError: (err) => {
      setTestDetail({ error: apiErrorMessage(err, 'Falha no envio — o servidor não informou o motivo.') });
      setTestResult('error');
    },
    // o teste também aparece na tela de E-mails e no log
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['messaging-outbox'] });
      void qc.invalidateQueries({ queryKey: ['messaging-settings'] });
      void qc.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });

  // quantos e-mails esperam a liberação do gestor (mesma consulta da aba E-mails)
  const { data: emailSettings } = useQuery<{ held: number }>({
    queryKey: ['messaging-settings'],
    queryFn: () => api.get<{ held: number }>('/messaging/settings').then(r => r.data),
    refetchInterval: 15_000,
  });
  const heldEmails = emailSettings?.held ?? 0;

  const { data: logs = [], isLoading, isError, refetch } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs', { page, actionFilter, fromDate, toDate }],
    queryFn: () =>
      api
        .get<AuditLog[]>('/audit-logs', {
          params: {
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
            action: actionFilter || undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
          },
        })
        .then(r => r.data),
    enabled: !invalidPeriod,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const total = logs[0]?.total_count ?? logs.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstIdx = page * PAGE_SIZE;

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
            {tab === 'emails'
              ? 'Os e-mails da assessoria: o que saiu, o que falhou e o que espera a sua liberação'
              : isLoading
                ? 'Carregando...'
                : `${total} evento${total !== 1 ? 's' : ''} ${hasFilters ? 'encontrado' : 'registrado'}${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="actions">
          <button className="ds-btn ghost sm" onClick={() => { setShowEmailTest(v => !v); setTestResult(null); }}>
            <Icon.Mail size={13} />
            Testar e-mail
          </button>
          {tab === 'acoes' && (
            <button className="ds-btn ghost sm" onClick={() => refetch()}>
              <Icon.RotateCcw size={13} />
              Atualizar
            </button>
          )}
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
          </div>
          {/* o servidor diz o motivo (senha, rede, remetente, IP bloqueado no provedor) */}
          {testResult === 'ok' && (
            <div role="status" style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 500, marginTop: 10 }}>
              ✓ O servidor de e-mail aceitou a mensagem{testDetail.to ? ` para ${testDetail.to}` : ''}.
              <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
                {testDetail.from ? `Remetente: ${testDetail.from}. ` : ''}
                Se não chegar em alguns minutos, olhe a caixa de spam e confira se esse remetente está validado na conta do provedor.
              </span>
            </div>
          )}
          {testResult === 'error' && (
            <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 10 }}>
              ✗ {testDetail.error}
            </div>
          )}
        </div>
      )}

      <div className="ds-tabs" role="tablist" aria-label="Log de Ações">
        <button role="tab" aria-selected={tab === 'acoes'} className={`ds-tab${tab === 'acoes' ? ' active' : ''}`} onClick={() => setTab('acoes')}>
          Ações
        </button>
        <button role="tab" aria-selected={tab === 'emails'} className={`ds-tab${tab === 'emails' ? ' active' : ''}`} onClick={() => setTab('emails')}>
          E-mails
          {heldEmails > 0 && <span className="count" title="Aguardando a sua liberação">{heldEmails}</span>}
        </button>
      </div>

      {tab === 'emails' ? (
        <EmailsPanel onOpenProcess={onOpenProcess} />
      ) : (
      <>
      {/* Filtros */}
      <div className="ds-list-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="ds-input" style={{ flex: '0 0 230px' }}>
          <Icon.Filter size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <select
            aria-label="Filtrar por ação"
            value={actionFilter}
            onChange={e => changeFilter(() => setActionFilter(e.target.value))}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer' }}
          >
            <option value="">Todas as ações</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="ds-input" style={{ flex: '0 0 auto' }}>
          <Icon.Calendar size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>De</span>
          <input
            type="date"
            aria-label="Data inicial"
            value={fromDate}
            max={toDate || undefined}
            onChange={e => changeFilter(() => setFromDate(e.target.value))}
          />
        </div>
        <div className="ds-input" style={{ flex: '0 0 auto' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Até</span>
          <input
            type="date"
            aria-label="Data final"
            value={toDate}
            min={fromDate || undefined}
            onChange={e => changeFilter(() => setToDate(e.target.value))}
          />
        </div>
        {hasFilters && (
          <button className="ds-btn ghost sm" onClick={clearFilters}>
            <Icon.X size={12} />
            Limpar filtros
          </button>
        )}
      </div>

      {invalidPeriod && (
        <div className="ds-alert urgent" style={{ marginBottom: 16 }}>
          <Icon.AlertTriangle size={14} />
          <span>A data inicial é posterior à data final.</span>
        </div>
      )}

      {isError && (
        <div className="ds-alert urgent" style={{ marginBottom: 16 }}>
          <Icon.AlertTriangle size={14} />
          <span>Erro ao carregar logs.</span>
        </div>
      )}

      {invalidPeriod ? null : isLoading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando...</div>
      ) : logs.length === 0 ? (
        <div className="ds-card">
          <div className="ds-card-body" style={{ textAlign: 'center', padding: 60, color: 'var(--text-faint)', fontSize: 13 }}>
            {page > 0 ? (
              <>
                Nenhum evento nesta página.{' '}
                <button className="ds-btn ghost sm" onClick={() => setPage(0)}>Voltar para a primeira página</button>
              </>
            ) : hasFilters ? (
              'Nenhum evento encontrado para os filtros selecionados.'
            ) : (
              'Nenhuma ação registrada ainda.'
            )}
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
                  <Fragment key={log.id}>
                    <tr>
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
                        {/* cada disparo de e-mail: qual aviso e para quem (papel) */}
                        {log.action.startsWith('email_') && log.metadata?.subject && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, maxWidth: 320, overflowWrap: 'anywhere' }}>
                            {log.metadata.subject}
                            {log.metadata.recipientRole && ` · para ${(ROLE_LABELS[log.metadata.recipientRole] ?? log.metadata.recipientRole).toLowerCase()}`}
                          </div>
                        )}
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
                      <tr>
                        <td colSpan={6} style={{ padding: '0 16px 8px', fontSize: 11.5, color: 'var(--red)' }}>
                          {undoErrors[log.id]}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              Mostrando {firstIdx + 1}–{firstIdx + logs.length} de {total} eventos
            </span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="ds-btn ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  ← Anterior
                </button>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>Página {page + 1} de {totalPages}</span>
                <button className="ds-btn ghost sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
                  Próxima →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
