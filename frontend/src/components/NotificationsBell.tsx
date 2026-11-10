import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';
import { actionLabel, stateLabel } from '../lib/auditActions';

export interface NotificationItem {
  id: string;
  action: string;
  processId: string;
  fromState: string | null;
  toState: string | null;
  label: string | null;
  labels: string[] | null;
  actorName: string | null;
  clientName: string;
  createdAt: string;
  read: boolean;
}

// Aviso guardado para o usuário (documento vencendo ou vencido)
export interface AlertItem {
  id: string;
  kind: 'document_expiring' | 'document_expired' | string;
  processId: string | null;
  documentId: string | null;
  message: string;
  validUntil: string | null;
  createdAt: string;
  read: boolean;
  resolved: boolean;
}

interface NotificationsResponse {
  unread: number;
  pendingDocs: number;
  alerts?: AlertItem[];
  items: NotificationItem[];
}

const KEY = ['notifications'];

function notificationText(n: NotificationItem): string {
  switch (n.action) {
    case 'stage_change': return `Mudou para ${stateLabel(n.toState)}`;
    case 'document_upload': return `Documento enviado: ${n.label ?? 'documento'}`;
    case 'documents_requested': return `Documentos solicitados: ${(n.labels ?? []).join(', ')}`;
    case 'data_requested': return `Dados solicitados: ${(n.labels ?? []).join(', ')}`;
    case 'data_request_answered': return 'O cliente enviou os dados pedidos';
    case 'document_validated': return `Documento validado: ${n.label ?? 'documento'}`;
    case 'document_rejected': return `Documento rejeitado: ${n.label ?? 'documento'} — envie de novo`;
    case 'profile_update': return 'Cadastro do proponente atualizado';
    case 'form_submitted': return `Formulário enviado: ${n.label ?? 'formulário'}`;
    default: return actionLabel(n.action);
  }
}

function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `há ${d} d` : new Date(iso).toLocaleDateString('pt-BR');
}

// FE-29: sino da topbar com as notificações do usuário (mudanças de etapa e
// documentos dos processos que ele acompanha), contagem de não lidas e
// documentos esperando por ele. Os avisos de validade (documento vencendo ou
// vencido) vêm primeiro, com o botão que leva direto ao documento; abrir o
// aviso marca como lido. A lista se atualiza sozinha a cada minuto.
export function NotificationsBell({ isCliente, onOpenProcess, onOpenDocument }: {
  isCliente: boolean;
  onOpenProcess: (id: string) => void;
  onOpenDocument: (processId: string, documentId: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const { data } = useQuery<NotificationsResponse>({
    queryKey: KEY,
    queryFn: () => api.get<NotificationsResponse>('/notifications').then(r => r.data),
    refetchInterval: 60_000,
  });
  const unread = data?.unread ?? 0;
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onMutate: (id) => {
      qc.setQueryData<NotificationsResponse>(KEY, old => old && {
        ...old,
        unread: Math.max(0, old.unread - (
          old.items.some(i => i.id === id && !i.read) ||
          (old.alerts ?? []).some(a => a.id === id && !a.read && !a.resolved) ? 1 : 0)),
        items: old.items.map(i => (i.id === id ? { ...i, read: true } : i)),
        alerts: (old.alerts ?? []).map(a => (a.id === id ? { ...a, read: true } : a)),
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  // Fecha ao clicar fora ou com Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openItem = (n: NotificationItem) => {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    onOpenProcess(n.processId);
  };

  const openAlert = (a: AlertItem) => {
    if (!a.read) markRead.mutate(a.id);
    setOpen(false);
    if (a.processId && a.documentId) onOpenDocument(a.processId, a.documentId);
    else if (a.processId) onOpenProcess(a.processId);
  };

  return (
    <div className="ds-notif-wrap" ref={wrap}>
      <button
        className="ds-tb-icon-btn"
        title="Notificações"
        aria-label={unread > 0 ? `Notificações, ${unread} não lida${unread !== 1 ? 's' : ''}` : 'Notificações'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) void qc.invalidateQueries({ queryKey: KEY });
          setOpen(o => !o);
        }}
      >
        <Icon.Bell size={15} />
        {unread > 0 && <span className="ds-tb-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="ds-notif" role="dialog" aria-label="Notificações">
          <div className="ds-notif-hdr">
            <strong>Notificações</strong>
            {unread > 0 && (
              <button className="ds-btn ghost sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          {data && data.pendingDocs > 0 && (
            <div className="ds-notif-pending" data-testid="notif-pending">
              <Icon.FileText size={13} />
              {isCliente
                ? `${data.pendingDocs} documento${data.pendingDocs !== 1 ? 's' : ''} para enviar`
                : `${data.pendingDocs} documento${data.pendingDocs !== 1 ? 's' : ''} aguardando validação`}
            </div>
          )}
          {alerts.length > 0 && (
            <>
              <div className="ds-notif-section">Validade de documentos</div>
              <ul className="ds-notif-list" data-testid="notif-alertas">
                {alerts.map(a => {
                  const expired = a.kind === 'document_expired';
                  const pending = !a.resolved;
                  return (
                    <li key={a.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        className={`ds-notif-alert ${!a.read && pending ? 'unread' : ''} ${expired ? 'expired' : ''}`}
                        onClick={() => openAlert(a)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAlert(a); } }}
                      >
                        {!a.read && pending && <span className="ds-notif-dot" aria-label="não lida" />}
                        <span className="ds-notif-title" style={{ color: expired && pending ? 'var(--red)' : undefined }}>
                          {expired ? 'Documento vencido' : 'Documento vencendo'}
                        </span>
                        <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{a.message}</span>
                        <span className="ds-notif-alert-foot">
                          <span className="ds-notif-sub">
                            {a.resolved ? 'Resolvido · documento atualizado' : timeAgo(a.createdAt)}
                          </span>
                          {pending && a.documentId && (
                            <button
                              type="button"
                              className="ds-btn accent sm"
                              onClick={e => { e.stopPropagation(); openAlert(a); }}
                            >
                              {isCliente ? 'Enviar documento' : 'Ver documento'}
                            </button>
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {data && data.items.length > 0 && <div className="ds-notif-section">Atualizações</div>}
            </>
          )}
          {!data ? (
            <div className="ds-notif-empty">Carregando...</div>
          ) : data.items.length === 0 ? (
            alerts.length > 0 ? null :
            <div className="ds-notif-empty">Nenhuma notificação nos últimos 30 dias</div>
          ) : (
            <ul className="ds-notif-list">
              {data.items.map(n => (
                <li key={n.id}>
                  <button className={`ds-notif-item ${n.read ? '' : 'unread'}`} onClick={() => openItem(n)}>
                    {!n.read && <span className="ds-notif-dot" aria-label="não lida" />}
                    <span className="ds-notif-title">{notificationText(n)}</span>
                    <span className="ds-notif-sub">
                      {isCliente ? '' : `${n.clientName} · `}por {n.actorName ?? 'Sistema'} · {timeAgo(n.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
