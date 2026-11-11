import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';
import { apiErrorMessage } from '../lib/documentCatalog';
import {
  EMAIL_EVENT_LABELS,
  EMAIL_STATUS,
  EMAIL_STATUS_ORDER,
  ROLE_LABELS,
  type EmailStatus,
} from '../lib/emailOutbox';

// Tela "E-mails" do Log de Ações: o gestor decide se os e-mails da assessoria
// saem sozinhos ou esperam a liberação dele, define o teto do dia e vê cada
// mensagem (o que saiu, o que falhou, o que está esperando).

interface Settings {
  mode: 'manual' | 'auto';
  dailyLimit: number;
  maxDailyLimit: number;
  sentToday: number;
  held: number;
  pending: number;
  failed: number;
  sending: { configured: boolean; running: boolean; sender: string };
}

interface OutboxItem {
  id: string;
  createdAt: string;
  eventType: string;
  recipientRole: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  nextAttemptAt: string | null;
  processId: string | null;
  clientName: string | null;
  hasContent: boolean;
}

interface OutboxPage {
  items: OutboxItem[];
  counts: Record<EmailStatus, number>;
}

interface Content {
  id: string;
  subject: string;
  recipient: string;
  html: string;
  text: string;
}

const PAGE_SIZE = 25;

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Props {
  onOpenProcess: (id: string) => void;
}

export function EmailsPanel({ onOpenProcess }: Props) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<EmailStatus | ''>('held');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<OutboxItem | null>(null);
  // o que o gestor está digitando no limite; null = mostra o valor salvo
  const [limitEdit, setLimitEdit] = useState<string | null>(null);
  // confirmação na própria tela para o que dispara ou descarta várias mensagens
  const [confirm, setConfirm] = useState<'auto' | 'release-all' | 'cancel-all' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const settingsQ = useQuery<Settings>({
    queryKey: ['messaging-settings'],
    queryFn: () => api.get<Settings>('/messaging/settings').then(r => r.data),
    refetchInterval: 15_000,
  });
  const settings = settingsQ.data;

  const listQ = useQuery<OutboxPage>({
    queryKey: ['messaging-outbox', { status, page }],
    queryFn: () =>
      api
        .get<OutboxPage>('/messaging/outbox', {
          params: { status: status || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        })
        .then(r => r.data),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const items = listQ.data?.items ?? [];
  const counts = listQ.data?.counts;
  const totalAll = counts ? EMAIL_STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0) : 0;
  const total = counts ? (status ? counts[status] : totalAll) : items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['messaging-settings'] });
    void qc.invalidateQueries({ queryKey: ['messaging-outbox'] });
    void qc.invalidateQueries({ queryKey: ['audit-logs'] });
  };
  const fail = (fallback: string) => (err: unknown) =>
    setNotice({ kind: 'error', text: apiErrorMessage(err, fallback) });

  const settingsMut = useMutation({
    mutationFn: (body: { mode?: 'manual' | 'auto'; dailyLimit?: number }) =>
      api.put<Settings>('/messaging/settings', body).then(r => r.data),
    onSuccess: (data, body) => {
      qc.setQueryData(['messaging-settings'], data);
      setConfirm(null);
      if (body.dailyLimit !== undefined) setLimitEdit(null);
      setNotice({
        kind: 'ok',
        text: body.mode === 'manual'
          ? 'Envio pausado: os e-mails passam a esperar a sua liberação.'
          : body.mode === 'auto'
            ? 'Envio automático ligado. O que já estava aguardando continua aguardando a sua liberação.'
            : `Limite diário alterado para ${data.dailyLimit} e-mails.`,
      });
      refresh();
    },
    onError: fail('Não foi possível salvar a configuração.'),
  });

  const releaseMut = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      api.post<{ released: number }>('/messaging/outbox/release', body).then(r => r.data),
    onSuccess: ({ released }) => {
      setSelected(new Set());
      setConfirm(null);
      setNotice({
        kind: 'ok',
        text: released === 0
          ? 'Nenhuma mensagem estava aguardando liberação.'
          : `${plural(released, 'mensagem liberada', 'mensagens liberadas')} para envio.`,
      });
      refresh();
    },
    onError: fail('Não foi possível liberar.'),
  });

  const cancelMut = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      api.post<{ cancelled: number }>('/messaging/outbox/cancel', body).then(r => r.data),
    onSuccess: ({ cancelled }) => {
      setSelected(new Set());
      setConfirm(null);
      setNotice({
        kind: 'ok',
        text: cancelled === 0
          ? 'Nenhuma mensagem para cancelar.'
          : `${plural(cancelled, 'mensagem cancelada', 'mensagens canceladas')}: não ${cancelled === 1 ? 'será enviada' : 'serão enviadas'}.`,
      });
      refresh();
    },
    onError: fail('Não foi possível cancelar.'),
  });

  const resendMut = useMutation({
    mutationFn: (id: string) =>
      api.post<{ resent: number }>(`/messaging/outbox/${id}/resend`).then(r => r.data),
    onSuccess: () => {
      setNotice({ kind: 'ok', text: 'Mensagem colocada de novo na fila de envio.' });
      refresh();
    },
    onError: fail('Não foi possível reenviar.'),
  });

  const busy = releaseMut.isPending || cancelMut.isPending || resendMut.isPending || settingsMut.isPending;

  const changeStatus = (s: EmailStatus | '') => {
    setStatus(s);
    setPage(0);
    setSelected(new Set());
  };

  // só o que ainda não saiu pode ser marcado
  const selectable = items.filter(m => m.status === 'held' || m.status === 'pending');
  const allSelected = selectable.length > 0 && selectable.every(m => selected.has(m.id));
  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map(m => m.id)));
  const selectedItems = items.filter(m => selected.has(m.id));
  const selectedHeld = selectedItems.filter(m => m.status === 'held').map(m => m.id);

  const limitDraft = limitEdit ?? (settings ? String(settings.dailyLimit) : '');
  const limitNumber = Number(limitDraft);
  const limitValid = !!settings && Number.isInteger(limitNumber) && limitNumber >= 1 && limitNumber <= settings.maxDailyLimit;
  const limitChanged = !!settings && limitNumber !== settings.dailyLimit;
  const leftToday = settings ? Math.max(0, settings.dailyLimit - settings.sentToday) : 0;
  const cancellable = (counts?.held ?? 0) + (counts?.pending ?? 0);

  return (
    <div>
      {/* ── Controle do envio ───────────────────────────────────────────── */}
      <div className="ds-card" style={{ marginBottom: 16 }}>
        <div className="ds-card-hdr">
          <h3><Icon.Mail size={14} /> Envio de e-mails da assessoria</h3>
          {settings && (
            <span className={`ds-badge ${settings.mode === 'auto' ? 'green' : 'amber'}`}>
              <span className="dot" />
              {settings.mode === 'auto' ? 'Envio automático' : 'Aguardando a sua liberação'}
            </span>
          )}
        </div>
        <div className="ds-card-body">
          {settingsQ.isError && (
            <div role="alert" style={{ fontSize: 13, color: 'var(--red)' }}>
              Não foi possível carregar a configuração de e-mails.
            </div>
          )}
          {!settings && settingsQ.isLoading && (
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Carregando...</div>
          )}
          {settings && (
            <>
              {(!settings.sending.configured || !settings.sending.running) && (
                <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--amber)', background: 'var(--amber-soft)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 14 }}>
                  <Icon.AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {!settings.sending.configured
                      ? 'O servidor está sem as credenciais de e-mail (SMTP): as mensagens ficam guardadas na fila e nenhuma é enviada.'
                      : 'O envio está desligado neste servidor: as mensagens ficam guardadas na fila.'}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 340px', minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Como os e-mails saem
                  </div>
                  <div className="ds-seg" role="group" aria-label="Modo de envio">
                    <button
                      type="button"
                      className={`ds-seg-btn${settings.mode === 'manual' ? ' active' : ''}`}
                      aria-pressed={settings.mode === 'manual'}
                      disabled={busy}
                      onClick={() => { setConfirm(null); if (settings.mode !== 'manual') settingsMut.mutate({ mode: 'manual' }); }}
                    >
                      Com a minha liberação
                    </button>
                    <button
                      type="button"
                      className={`ds-seg-btn${settings.mode === 'auto' ? ' active' : ''}`}
                      aria-pressed={settings.mode === 'auto'}
                      disabled={busy}
                      onClick={() => { if (settings.mode !== 'auto') setConfirm('auto'); }}
                    >
                      Automático
                    </button>
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '8px 0 0', maxWidth: 520 }}>
                    {settings.mode === 'manual'
                      ? 'Cada aviso de processo (mudança de etapa, pedido de documentos, documento recusado, processo parado) fica guardado aqui e só sai quando você liberar.'
                      : 'Os avisos de processo saem sozinhos, até o limite diário abaixo. Voltar para "Com a minha liberação" pausa o envio na hora.'}
                    {' '}Convites e redefinições de senha saem na hora em que são pedidos, e também contam no limite.
                  </p>
                  {confirm === 'auto' && (
                    <div role="alertdialog" aria-label="Ligar o envio automático" style={{ marginTop: 12, padding: '12px 14px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', background: 'var(--bg-subtle)', maxWidth: 520 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Ligar o envio automático?</div>
                      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '4px 0 10px' }}>
                        A partir de agora, os novos avisos saem sem passar por você, até {plural(settings.dailyLimit, 'e-mail', 'e-mails')} por dia.
                        {settings.held > 0 && ` ${plural(settings.held, 'mensagem que já está aguardando continua', 'mensagens que já estão aguardando continuam')} aguardando: nada acumulado é disparado.`}
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="ds-btn accent sm" disabled={busy} onClick={() => settingsMut.mutate({ mode: 'auto' })}>
                          {settingsMut.isPending ? 'Ligando...' : 'Ligar envio automático'}
                        </button>
                        <button className="ds-btn ghost sm" onClick={() => setConfirm(null)}>Manter como está</button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ flex: '0 1 300px', minWidth: 240 }}>
                  <label htmlFor="email-daily-limit" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Limite de e-mails por dia
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div className="ds-input" style={{ width: 110 }}>
                      <input
                        id="email-daily-limit"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={settings.maxDailyLimit}
                        value={limitDraft}
                        onChange={e => setLimitEdit(e.target.value)}
                        aria-describedby="email-daily-limit-hint"
                      />
                    </div>
                    <button
                      className="ds-btn sm"
                      disabled={!limitValid || !limitChanged || busy}
                      onClick={() => settingsMut.mutate({ dailyLimit: limitNumber })}
                    >
                      Salvar
                    </button>
                  </div>
                  <p id="email-daily-limit-hint" style={{ fontSize: 12.5, color: limitValid || !limitDraft ? 'var(--text-muted)' : 'var(--red)', margin: '8px 0 0' }}>
                    {limitValid || !limitDraft
                      ? <>Hoje: <strong style={{ color: 'var(--text)' }}>{settings.sentToday}</strong> de {settings.dailyLimit} enviados ({leftToday === 0 ? 'limite atingido, o restante sai amanhã' : `${plural(leftToday, 'restante', 'restantes')}`}). Máximo: {settings.maxDailyLimit}.</>
                      : `Informe um número inteiro de 1 a ${settings.maxDailyLimit}.`}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '6px 0 0', overflowWrap: 'anywhere' }}>
                    Remetente: {settings.sending.sender}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, padding: '9px 12px',
            borderRadius: 'var(--radius)',
            color: notice.kind === 'error' ? 'var(--red)' : 'var(--green)',
            background: notice.kind === 'error' ? 'var(--red-soft)' : 'var(--green-soft)',
          }}
        >
          {notice.kind === 'error' ? <Icon.AlertTriangle size={14} /> : <Icon.Check size={14} />}
          <span style={{ flex: 1 }}>{notice.text}</span>
          <button className="ds-btn ghost sm" aria-label="Fechar aviso" onClick={() => setNotice(null)} style={{ padding: '0 6px' }}>
            <Icon.X size={12} />
          </button>
        </div>
      )}

      {/* ── Situações ───────────────────────────────────────────────────── */}
      <div className="ds-list-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        {EMAIL_STATUS_ORDER.map(s => (
          <button
            key={s}
            type="button"
            className={`ds-chip${status === s ? ' active' : ''}`}
            aria-pressed={status === s}
            onClick={() => changeStatus(s)}
          >
            {EMAIL_STATUS[s].tab}
            <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>{counts ? counts[s] : '–'}</span>
          </button>
        ))}
        <button
          type="button"
          className={`ds-chip${status === '' ? ' active' : ''}`}
          aria-pressed={status === ''}
          onClick={() => changeStatus('')}
        >
          Todos
          <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>{counts ? totalAll : '–'}</span>
        </button>
        <span style={{ flex: 1 }} />
        <button className="ds-btn ghost sm" onClick={refresh}>
          <Icon.RotateCcw size={13} />
          Atualizar
        </button>
      </div>

      {/* ── Ações em lote ───────────────────────────────────────────────── */}
      {(selected.size > 0 || (counts?.held ?? 0) > 0 || cancellable > 0) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
          {selected.size > 0 ? (
            <>
              <span>{plural(selected.size, 'selecionada', 'selecionadas')}</span>
              <button
                className="ds-btn accent sm"
                disabled={busy || selectedHeld.length === 0}
                title={selectedHeld.length === 0 ? 'Só mensagens aguardando liberação podem ser liberadas' : undefined}
                onClick={() => releaseMut.mutate({ ids: selectedHeld })}
              >
                <Icon.Check size={12} />
                Liberar {selectedHeld.length > 0 ? selectedHeld.length : ''}
              </button>
              <button className="ds-btn sm" disabled={busy} onClick={() => cancelMut.mutate({ ids: [...selected] })}>
                <Icon.X size={12} />
                Cancelar envio
              </button>
              <button className="ds-btn ghost sm" onClick={() => setSelected(new Set())}>Limpar seleção</button>
            </>
          ) : confirm === 'release-all' ? (
            <span role="alertdialog" aria-label="Liberar todas" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text)' }}>
                Liberar {plural(counts?.held ?? 0, 'mensagem', 'mensagens')}? {leftToday < (counts?.held ?? 0)
                  ? `Hoje saem até ${leftToday}; o restante sai nos próximos dias, respeitando o limite.`
                  : 'Elas saem em seguida.'}
              </span>
              <button className="ds-btn accent sm" disabled={busy} onClick={() => releaseMut.mutate({ all: true })}>Liberar todas</button>
              <button className="ds-btn ghost sm" onClick={() => setConfirm(null)}>Voltar</button>
            </span>
          ) : confirm === 'cancel-all' ? (
            <span role="alertdialog" aria-label="Cancelar todas" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text)' }}>
                Cancelar {plural(cancellable, 'mensagem que ainda não saiu', 'mensagens que ainda não saíram')}? Elas não serão enviadas.
              </span>
              <button className="ds-btn sm" style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }} disabled={busy} onClick={() => cancelMut.mutate({ all: true })}>Cancelar todas</button>
              <button className="ds-btn ghost sm" onClick={() => setConfirm(null)}>Voltar</button>
            </span>
          ) : (
            <>
              {(counts?.held ?? 0) > 0 && (
                <button className="ds-btn sm" disabled={busy} onClick={() => setConfirm('release-all')}>
                  <Icon.Check size={12} />
                  Liberar todas as {counts!.held} aguardando
                </button>
              )}
              {cancellable > 0 && (
                <button className="ds-btn ghost sm" disabled={busy} onClick={() => setConfirm('cancel-all')}>
                  Cancelar tudo o que não saiu
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Lista ───────────────────────────────────────────────────────── */}
      {listQ.isError ? (
        <div className="ds-card">
          <div className="ds-card-body" role="alert" style={{ fontSize: 13, color: 'var(--red)' }}>
            Erro ao carregar os e-mails.
          </div>
        </div>
      ) : listQ.isLoading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando...</div>
      ) : items.length === 0 ? (
        <div className="ds-card">
          <div className="ds-card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-faint)', fontSize: 13 }}>
            {page > 0 ? (
              <>
                Nenhum e-mail nesta página.{' '}
                <button className="ds-btn ghost sm" onClick={() => setPage(0)}>Voltar para a primeira página</button>
              </>
            ) : status ? EMAIL_STATUS[status].empty : 'Nenhum e-mail registrado ainda.'}
          </div>
        </div>
      ) : (
        <div className="ds-card" style={{ overflowX: 'auto' }}>
          <table className="ds-table" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 34, paddingRight: 0 }}>
                  {selectable.length > 0 && (
                    <input type="checkbox" aria-label="Selecionar todas desta página" checked={allSelected} onChange={toggleAll} />
                  )}
                </th>
                <th>Criado em</th>
                <th>Aviso</th>
                <th>Para</th>
                <th>Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(m => {
                const st = EMAIL_STATUS[m.status];
                const canSelect = m.status === 'held' || m.status === 'pending';
                const canResend = (m.status === 'failed' || m.status === 'expired' || m.status === 'cancelled') && m.hasContent;
                return (
                  <tr key={m.id}>
                    <td style={{ paddingRight: 0 }}>
                      {canSelect && (
                        <input
                          type="checkbox"
                          aria-label={`Selecionar: ${m.subject}`}
                          checked={selected.has(m.id)}
                          onChange={() => toggle(m.id)}
                        />
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(m.createdAt)}</td>
                    <td style={{ maxWidth: 340 }}>
                      <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{m.subject}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {EMAIL_EVENT_LABELS[m.eventType] ?? m.eventType}
                        {m.processId && m.clientName && (
                          <>
                            {' · processo de '}
                            <button
                              className="ds-btn ghost sm"
                              style={{ fontWeight: 500, padding: 0, height: 'auto', color: 'var(--accent)', fontSize: 12 }}
                              onClick={() => onOpenProcess(m.processId!)}
                            >
                              {m.clientName}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      <div style={{ overflowWrap: 'anywhere' }}>{m.recipient}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{ROLE_LABELS[m.recipientRole] ?? m.recipientRole}</div>
                    </td>
                    <td style={{ maxWidth: 260 }}>
                      <span className={`ds-badge ${st.color}`}><span className="dot" />{st.label}</span>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, overflowWrap: 'anywhere' }}>
                        {m.status === 'sent' && m.sentAt && `em ${fmtDate(m.sentAt)}`}
                        {m.status === 'pending' && (m.lastError
                          ? <>{m.lastError}{m.nextAttemptAt && ` (próxima tentativa: ${fmtDate(m.nextAttemptAt)})`}</>
                          : 'sai em instantes')}
                        {(m.status === 'failed' || m.status === 'expired') && (m.lastError ?? '')}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {m.hasContent && (
                        <button className="ds-btn ghost sm" onClick={() => setPreview(m)} title="Ver o e-mail como o destinatário recebe">
                          Ver
                        </button>
                      )}
                      {m.status === 'held' && (
                        <button className="ds-btn accent sm" style={{ marginLeft: 4 }} disabled={busy} onClick={() => releaseMut.mutate({ ids: [m.id] })}>
                          Liberar
                        </button>
                      )}
                      {canSelect && (
                        <button className="ds-btn ghost sm" style={{ marginLeft: 4 }} disabled={busy} onClick={() => cancelMut.mutate({ ids: [m.id] })}>
                          Cancelar
                        </button>
                      )}
                      {canResend && (
                        <button className="ds-btn sm" style={{ marginLeft: 4 }} disabled={busy} onClick={() => resendMut.mutate(m.id)}>
                          Reenviar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              Mostrando {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + items.length} de {total}
            </span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="ds-btn ghost sm" disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(new Set()); }}>← Anterior</button>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>Página {page + 1} de {totalPages}</span>
                <button className="ds-btn ghost sm" disabled={page + 1 >= totalPages} onClick={() => { setPage(page + 1); setSelected(new Set()); }}>Próxima →</button>
              </div>
            )}
          </div>
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '12px 2px 0' }}>
        Cada liberação, envio, falha e cancelamento também fica registrado na aba Ações. Os e-mails são apagados desta lista depois de 30 dias; o registro no log permanece.
      </p>

      {preview && <EmailPreview item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// O e-mail como o destinatário recebe. O HTML vai num iframe isolado (sandbox
// sem scripts): nada do conteúdo roda nem alcança a sessão do gestor.
function EmailPreview({ item, onClose }: { item: OutboxItem; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<Content>({
    queryKey: ['messaging-outbox-content', item.id],
    queryFn: () => api.get<Content>(`/messaging/outbox/${item.id}`).then(r => r.data),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ds-modal-overlay" onClick={onClose}>
      <div
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-preview-title"
        style={{ maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', margin: 16 }}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="email-preview-title" style={{ overflowWrap: 'anywhere' }}>{item.subject}</h2>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px', overflowWrap: 'anywhere' }}>
          Para {item.recipient} ({ROLE_LABELS[item.recipientRole] ?? item.recipientRole}) · {EMAIL_STATUS[item.status].label.toLowerCase()}
        </p>
        {isLoading && <div style={{ fontSize: 13, color: 'var(--text-faint)', padding: 24 }}>Carregando...</div>}
        {isError && <div role="alert" style={{ fontSize: 13, color: 'var(--red)', padding: 12 }}>Não foi possível abrir o e-mail.</div>}
        {data && (
          <iframe
            title="Conteúdo do e-mail"
            sandbox=""
            srcDoc={data.html}
            style={{ width: '100%', flex: 1, minHeight: 380, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: '#fff' }}
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="ds-btn sm" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
