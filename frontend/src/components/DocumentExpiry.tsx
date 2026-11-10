import { useQuery } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';
import { STAGE_LABELS, type ProcessStage } from '../lib/processStages';
import { dueText, formatDay, type ValidityStatus } from '../lib/documentValidity';

// Documentos com validade pelo mês de referência que vencem em até 15 dias ou
// já venceram (GET /document-expiry/*). Atualiza sozinho a cada minuto.

interface ExpiryDocument {
  documentId: string;
  label: string;
  validUntil: string;
  status: ValidityStatus;
  daysLeft: number;
}

interface MineResponse {
  expired: (ExpiryDocument & { processId: string })[];
  expiring: (ExpiryDocument & { processId: string })[];
}

interface ProcessesResponse {
  expiringDays: number;
  processes: {
    processId: string;
    stage: ProcessStage;
    clientName: string;
    analistaName: string | null;
    expired: number;
    expiring: number;
    documents: ExpiryDocument[];
  }[];
}

const REFRESH_MS = 60_000;

function docText(d: ExpiryDocument): string {
  return d.status === 'vencido'
    ? `${d.label} — vencido (valia até ${formatDay(d.validUntil)})`
    : `${d.label} — ${dueText(d.daysLeft)} (${formatDay(d.validUntil)})`;
}

// Portal do cliente: aviso em destaque no topo enquanto houver documento vencido.
export function DocumentExpiryBanner({ onOpenDocument }: {
  onOpenDocument: (processId: string, documentId: string) => void;
}) {
  const { data } = useQuery<MineResponse>({
    queryKey: ['document-expiry', 'mine'],
    queryFn: () => api.get<MineResponse>('/document-expiry/mine').then(r => r.data),
    refetchInterval: REFRESH_MS,
  });
  const expired = Array.isArray(data?.expired) ? data.expired : [];
  if (expired.length === 0) return null;
  const first = expired[0];

  return (
    <div className="ds-page ds-expiry-banner-wrap">
    <div className="ds-expiry-banner" role="alert" data-testid="aviso-documento-vencido">
      <span className="ds-expiry-banner-icon"><Icon.AlertTriangle size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ds-expiry-banner-title">
          {expired.length === 1 ? 'Você tem um documento vencido' : `Você tem ${expired.length} documentos vencidos`}
        </div>
        <div className="ds-expiry-banner-desc">
          {expired.map(d => `${d.label} (valia até ${formatDay(d.validUntil)})`).join(' · ')}.
          {' '}Envie um documento mais recente para o seu processo continuar.
        </div>
      </div>
      <button className="ds-btn accent sm" onClick={() => onOpenDocument(first.processId, first.documentId)}>
        <Icon.Upload size={12} /> Enviar documento
      </button>
    </div>
    </div>
  );
}

// Painel da equipe: processos com documento vencendo ou vencido (o analista vê
// os dele; o gestor, os da assessoria). Vencidos primeiro.
export function DocumentExpiryCard({ onOpenDocument }: {
  onOpenDocument: (processId: string, documentId: string) => void;
}) {
  const { data, isLoading, isError } = useQuery<ProcessesResponse>({
    queryKey: ['document-expiry', 'processes'],
    queryFn: () => api.get<ProcessesResponse>('/document-expiry/processes').then(r => r.data),
    refetchInterval: REFRESH_MS,
  });
  const invalid = !!data && !Array.isArray(data.processes);
  const list = data && !invalid ? data.processes : [];
  const expiredTotal = list.reduce((n, p) => n + p.expired, 0);
  const expiringTotal = list.reduce((n, p) => n + p.expiring, 0);

  return (
    <div className="ds-card" data-testid="validade-card">
      <div className="ds-card-hdr">
        <h3>Documentos vencendo ou vencidos</h3>
        <span className="meta">vencem em até {data?.expiringDays ?? 15} dias</span>
      </div>
      {isError || invalid ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>
          Não foi possível carregar a validade dos documentos
        </div>
      ) : isLoading || !data ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Carregando...</div>
      ) : list.length === 0 ? (
        <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          Nenhum documento vencendo ou vencido
        </div>
      ) : (
        <>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {expiredTotal > 0 && <span className="ds-badge red"><span className="dot" />{expiredTotal} vencido{expiredTotal !== 1 ? 's' : ''}</span>}
            {expiringTotal > 0 && <span className="ds-badge amber"><span className="dot" />{expiringTotal} vencendo</span>}
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
              em {list.length} processo{list.length !== 1 ? 's' : ''}
            </span>
          </div>
          {list.map(p => (
            <button
              key={p.processId}
              type="button"
              className="ds-expiry-row"
              onClick={() => onOpenDocument(p.processId, p.documents[0].documentId)}
            >
              <div style={{ minWidth: 0 }}>
                <div className="pr-title">{p.clientName}</div>
                <div className="pr-sub">
                  {STAGE_LABELS[p.stage] ?? p.stage}{p.analistaName ? ` · ${p.analistaName}` : ''}
                </div>
                <ul className="ds-expiry-docs">
                  {p.documents.map(d => (
                    <li key={d.documentId} className={d.status === 'vencido' ? 'bad' : 'warn'}>{docText(d)}</li>
                  ))}
                </ul>
              </div>
              <span className={`ds-badge ${p.expired > 0 ? 'red' : 'amber'}`} style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap' }}>
                <span className="dot" />{p.expired > 0 ? 'Vencido' : 'Vencendo'}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
