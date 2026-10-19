import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';
import { apiErrorMessage } from '../lib/documentCatalog';
import { STAGE_LABELS, type ProcessStage } from '../lib/processStages';
import { todayIso } from '../lib/validators';

// PROD-03 — Relatórios do gestor. Funil, tempo por etapa e ticket médio vêm de
// GET /dashboard/summary (o mesmo do dashboard); o ranking de analistas de
// GET /reports/ranking. Os arquivos (GET /reports/export) saem dos mesmos
// números, com a mesma formatação desta tela.

interface Summary {
  days: number;
  generatedAt: string;
  totals: { processes: number; unitValue: number; averageTicket: number | null; withValue: number };
  funnel: { stage: ProcessStage; reached: number; pctOfTotal: number; stepRate: number | null }[];
  period: { newProcesses: number; stageChanges: number; signed: number };
  avgDaysInStage: { stage: ProcessStage; avgDays: number | null; samples: number }[];
}
interface RankingRow { analistaId: string | null; name: string; signed: number; activeProcesses: number; avgDays: number | null }

const PERIODS = [7, 30, 90, 180, 365];
const SIDE_STAGES: ProcessStage[] = ['cliente_inativo', 'credito_recusado', 'processo_pendencia'];

const fmtInt = (n: number) => n.toLocaleString('pt-BR');
const fmtMoney = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtPct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const fmtDays = (n: number | null) =>
  n === null ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dia${n === 1 ? '' : 's'}`;
const fmtDate = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function RelatoriosPage({ role }: { role: string | null }) {
  const [days, setDays] = useState(30);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState('');
  const isGestor = role === 'dono';

  const summaryQ = useQuery<Summary>({
    queryKey: ['dashboard-summary', days],
    queryFn: () => api.get<Summary>('/dashboard/summary', { params: { days } }).then(r => r.data),
    staleTime: 5 * 60_000, // a API guarda o resumo por 5 minutos
    enabled: isGestor,
  });
  const rankingQ = useQuery<{ days: number; analistas: RankingRow[] }>({
    queryKey: ['reports-ranking', days],
    queryFn: () => api.get('/reports/ranking', { params: { days } }).then(r => r.data),
    enabled: isGestor,
  });

  if (!isGestor) {
    return (
      <div className="ds-page">
        <div className="ds-card"><div className="ds-card-body" style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          Os relatórios da assessoria são exclusivos do gestor.
        </div></div>
      </div>
    );
  }

  async function exportar(format: 'xlsx' | 'pdf') {
    setExporting(format);
    setExportError('');
    try {
      const resp = await api.get('/reports/export', { params: { format, days }, responseType: 'blob' });
      const url = URL.createObjectURL(resp.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-${todayIso()}-${days}dias.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setExportError(apiErrorMessage(err, 'Não foi possível gerar o arquivo'));
    } finally {
      setExporting(null);
    }
  }

  const s = summaryQ.data;
  const ranking = rankingQ.data?.analistas ?? [];
  const generated = s ? new Date(s.generatedAt) : null;
  const from = generated ? new Date(generated.getTime() - days * 86_400_000) : null;
  const stageRows = (s?.avgDaysInStage ?? []).filter(r => !SIDE_STAGES.includes(r.stage) || r.samples > 0);
  const maxDays = Math.max(1, ...stageRows.map(r => r.avgDays ?? 0));
  const loading = summaryQ.isLoading || rankingQ.isLoading;
  const failed = summaryQ.isError || rankingQ.isError;

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Relatórios</h1>
          <p>
            {generated && from
              ? `Últimos ${days} dias · ${fmtDate(from)} a ${fmtDate(generated)} · atualizado às ${generated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`
              : 'Indicadores da assessoria no período.'}
          </p>
        </div>
        <div className="actions">
          <button className="ds-btn" disabled={!!exporting || loading || failed} onClick={() => void exportar('xlsx')}>
            <Icon.Download size={13} /> {exporting === 'xlsx' ? 'Gerando...' : 'Exportar Excel'}
          </button>
          <button className="ds-btn" disabled={!!exporting || loading || failed} onClick={() => void exportar('pdf')}>
            <Icon.FileText size={13} /> {exporting === 'pdf' ? 'Gerando...' : 'Exportar PDF'}
          </button>
        </div>
      </div>

      <div className="ds-list-toolbar">
        <div className="ds-seg" role="group" aria-label="Período">
          {PERIODS.map(d => (
            <button key={d} className={`ds-seg-btn ${days === d ? 'active' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>
              {d} dias
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Excel e PDF trazem os mesmos números desta tela.</span>
      </div>
      {exportError && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 12 }}>{exportError}</div>}

      {failed ? (
        <div role="alert" className="ds-card" style={{ padding: 24, textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>Não foi possível carregar os relatórios.</div>
      ) : loading || !s ? (
        <div className="ds-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Carregando...</div>
      ) : (
        <>
          <div className="ds-kpi-row" data-testid="report-kpis">
            {[
              { label: 'Processos ativos', value: fmtInt(s.totals.processes), meta: `${fmtInt(s.totals.withValue)} com valor informado`, icon: <Icon.Layout size={13} /> },
              { label: 'Ticket médio', value: fmtMoney(s.totals.averageTicket), meta: `Total: ${fmtMoney(s.totals.unitValue)}`, icon: <Icon.Banknote size={13} /> },
              { label: 'Contratos assinados', value: fmtInt(s.period.signed), meta: `nos últimos ${days} dias`, icon: <Icon.Check size={13} /> },
              { label: 'Processos novos', value: fmtInt(s.period.newProcesses), meta: `${fmtInt(s.period.stageChanges)} mudanças de etapa`, icon: <Icon.TrendingUp size={13} /> },
            ].map(k => (
              <div className="ds-kpi" key={k.label}>
                <div className="ds-kpi-label">{k.icon}{k.label}</div>
                <div className="ds-kpi-value" style={{ fontSize: 22 }}>{k.value}</div>
                <div className="ds-kpi-meta">{k.meta}</div>
              </div>
            ))}
          </div>

          <div className="ds-dash-grid">
            <div className="ds-card ds-col-7">
              <div className="ds-card-hdr"><h3>Funil de conversão</h3><span className="meta">processos ativos, até a etapa mais avançada</span></div>
              <table className="ds-table" aria-label="Funil de conversão">
                <thead><tr><th>Etapa</th><th style={{ textAlign: 'right' }}>Chegaram</th><th style={{ width: '38%' }}>% do total</th><th style={{ textAlign: 'right' }}>Sobre a anterior</th></tr></thead>
                <tbody>
                  {s.funnel.map(f => (
                    <tr key={f.stage}>
                      <td>{STAGE_LABELS[f.stage]}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(f.reached)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="ds-phase-bar" style={{ flex: 1 }}><span style={{ width: `${f.pctOfTotal}%`, background: 'var(--accent)' }} /></div>
                          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'right' }}>{fmtPct(f.pctOfTotal)}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{fmtPct(f.stepRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ds-card ds-col-5">
              <div className="ds-card-hdr"><h3>Tempo médio por etapa</h3><span className="meta">saídas no período</span></div>
              <table className="ds-table" aria-label="Tempo médio por etapa">
                <thead><tr><th>Etapa</th><th style={{ textAlign: 'right' }}>Tempo médio</th><th style={{ textAlign: 'right' }}>Saídas</th></tr></thead>
                <tbody>
                  {stageRows.map(r => (
                    <tr key={r.stage}>
                      <td>
                        {STAGE_LABELS[r.stage]}
                        <div className="ds-phase-bar" style={{ marginTop: 4, height: 4 }}><span style={{ width: `${((r.avgDays ?? 0) / maxDays) * 100}%`, background: 'var(--accent)' }} /></div>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDays(r.avgDays)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{fmtInt(r.samples)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ds-card ds-col-12">
              <div className="ds-card-hdr"><h3>Ranking de analistas</h3><span className="meta">contratos assinados e tempo médio nos últimos {days} dias; processos ativos agora</span></div>
              {ranking.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-faint)' }}>Nenhum analista na assessoria.</div>
              ) : (
                <table className="ds-table" aria-label="Ranking de analistas">
                  <thead><tr><th style={{ width: 40 }}>#</th><th>Analista</th><th style={{ textAlign: 'right' }}>Contratos assinados</th><th style={{ textAlign: 'right' }}>Processos ativos</th><th style={{ textAlign: 'right' }}>Tempo médio por etapa</th></tr></thead>
                  <tbody>
                    {ranking.map((r, i) => (
                      <tr key={r.analistaId ?? 'sem-analista'}>
                        <td style={{ color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                        <td style={{ fontWeight: 500, color: r.analistaId ? undefined : 'var(--text-muted)' }}>{r.name}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtInt(r.signed)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(r.activeProcesses)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDays(r.avgDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
