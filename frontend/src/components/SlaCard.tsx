import { useQuery } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import { STAGE_LABELS, type ProcessStage } from '../lib/processStages';

interface Sla {
  days: number;
  tracked: number;
  overdue: number;
  oldest: { processId: string; clientName: string; stage: ProcessStage; daysInStage: number }[];
}

// PROD-10: processos do analista parados há mais de 7 dias na mesma etapa (o
// prazo de atendimento). Vem do GET /dashboard/summary — o mesmo resumo do
// "Tempo médio por etapa" (período de 30 dias, cache compartilhado); o SLA é
// uma foto de agora e não depende do período.
export function SlaCard({ onOpenProcess }: { onOpenProcess: (id: string) => void }) {
  const { data, isLoading, isError } = useQuery<{ sla: Sla }>({
    queryKey: ['dashboard-summary', 30],
    queryFn: () => api.get<{ sla: Sla }>('/dashboard/summary', { params: { days: 30 } }).then(r => r.data),
    staleTime: 5 * 60_000,
  });
  const sla = data?.sla;
  // Resposta fora do formato vira erro no card, em vez de derrubar o painel
  const invalid = !!data && (!sla || !Array.isArray(sla.oldest));

  return (
    <div className="ds-card" data-testid="sla-card">
      <div className="ds-card-hdr">
        <h3>Fora do prazo</h3>
        <span className="meta">{sla && !invalid ? `mais de ${sla.days} dias na mesma etapa` : 'prazo de atendimento'}</span>
      </div>
      {isError || invalid ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>
          Não foi possível carregar o prazo de atendimento
        </div>
      ) : isLoading || !sla ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Carregando...</div>
      ) : (
        <>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: sla.overdue > 0 ? 'var(--amber)' : 'var(--green)' }}>
              {sla.overdue}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              de {sla.tracked} processo{sla.tracked !== 1 ? 's' : ''} em andamento
            </span>
          </div>
          {sla.oldest.length === 0 ? (
            <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
              Nenhum processo parado há mais de {sla.days} dias
            </div>
          ) : sla.oldest.map(p => (
            <button
              key={p.processId}
              type="button"
              className="ds-proc-row"
              onClick={() => onOpenProcess(p.processId)}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', font: 'inherit' }}
            >
              <div>
                <div className="pr-title">{p.clientName}</div>
                <div className="pr-sub">{STAGE_LABELS[p.stage]}</div>
              </div>
              <div className="pr-stage">{STAGE_LABELS[p.stage]}</div>
              <div className="pr-days" style={{ color: p.daysInStage > 14 ? 'var(--red)' : 'var(--amber)' }}>
                {p.daysInStage}d
              </div>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
