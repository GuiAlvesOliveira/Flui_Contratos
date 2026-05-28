import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import { DevApiMenu } from './DevApiMenu';
import { useAuth } from '../auth/useAuth';

// ── Types ─────────────────────────────────────────────────────────────────────

type ProcessStage =
  | 'inicial' | 'cliente_ativo' | 'cliente_inativo' | 'aprovado'
  | 'em_analise_banco' | 'credito_recusado' | 'processo_pendencia'
  | 'aguardando_assinatura' | 'em_emissao' | 'juridico';

interface ProcessUser { id: string; name: string | null; email: string; }
interface ProcessCard {
  id: string;
  stage: ProcessStage;
  clientId: string;
  client: ProcessUser;
  analista: ProcessUser | null;
  valorUnidade: number | null;
  valorEmAberto: number | null;
  updatedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<ProcessStage, string> = {
  inicial: 'Primeiro Contato',
  cliente_ativo: 'Cliente Ativo',
  aprovado: 'Aprovado',
  em_analise_banco: 'Análise Banco',
  aguardando_assinatura: 'Ag. Assinatura',
  processo_pendencia: 'Pendência',
  em_emissao: 'Em Emissão',
  juridico: 'Jurídico',
  cliente_inativo: 'Inativo',
  credito_recusado: 'Crédito Recusado',
};

const KANBAN_COLUMNS: ProcessStage[] = [
  'inicial', 'cliente_ativo', 'aprovado', 'em_analise_banco',
  'aguardando_assinatura', 'processo_pendencia', 'em_emissao', 'juridico',
];

const TERMINAL_COLUMNS: ProcessStage[] = ['cliente_inativo', 'credito_recusado'];

const NEXT_STAGES: Record<ProcessStage, ProcessStage[]> = {
  inicial: ['cliente_ativo', 'cliente_inativo'],
  cliente_ativo: ['aprovado'],
  aprovado: ['em_analise_banco'],
  em_analise_banco: ['aguardando_assinatura', 'credito_recusado'],
  aguardando_assinatura: ['processo_pendencia', 'em_emissao'],
  processo_pendencia: ['aguardando_assinatura'],
  em_emissao: ['juridico'],
  cliente_inativo: [],
  credito_recusado: [],
  juridico: [],
};

const COLUMN_COLORS: Record<ProcessStage, string> = {
  inicial: 'border-gray-300 bg-gray-50',
  cliente_ativo: 'border-blue-300 bg-blue-50',
  aprovado: 'border-green-300 bg-green-50',
  em_analise_banco: 'border-yellow-300 bg-yellow-50',
  aguardando_assinatura: 'border-purple-300 bg-purple-50',
  processo_pendencia: 'border-red-300 bg-red-50',
  em_emissao: 'border-indigo-300 bg-indigo-50',
  juridico: 'border-teal-300 bg-teal-50',
  cliente_inativo: 'border-gray-300 bg-gray-50',
  credito_recusado: 'border-red-300 bg-red-50',
};

// ── Stage advance modal ───────────────────────────────────────────────────────

interface AdvanceModalProps {
  process: ProcessCard;
  onClose: () => void;
  onAdvanced: () => void;
}

function AdvanceModal({ process, onClose, onAdvanced }: AdvanceModalProps) {
  const queryClient = useQueryClient();
  const nextStages = NEXT_STAGES[process.stage];
  const [toStage, setToStage] = useState<ProcessStage>(nextStages[0]);
  const [motivoInatividade, setMotivoInatividade] = useState('recursos_proprios');
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.patch(`/processes/${process.id}/stage`, body).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['processes'] });
      onAdvanced();
      onClose();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e?.response?.data?.message ?? 'Erro ao avançar etapa');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, string> = { toStage };
    if (toStage === 'cliente_inativo') body.motivoInatividade = motivoInatividade;
    if (toStage === 'credito_recusado') body.motivoRecusa = motivoRecusa;
    mutation.mutate(body);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Avançar etapa</h2>
        <p className="text-sm text-gray-500">
          Cliente: <strong>{process.client.name ?? process.client.email}</strong>
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {nextStages.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Para qual etapa?</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={toStage}
                onChange={(e) => setToStage(e.target.value as ProcessStage)}
              >
                {nextStages.map((s) => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            </div>
          )}

          {toStage === 'cliente_inativo' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Motivo *</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={motivoInatividade}
                onChange={(e) => setMotivoInatividade(e.target.value)}
              >
                <option value="recursos_proprios">Quitará por recursos próprios</option>
                <option value="outra_assessoria">Seguirá com outra assessoria</option>
                <option value="sozinho">Seguirá sozinho</option>
                <option value="nao_atendeu">Não atendeu</option>
              </select>
            </div>
          )}

          {toStage === 'credito_recusado' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Motivo da recusa *</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ex: Score de crédito insuficiente"
                value={motivoRecusa}
                onChange={(e) => setMotivoRecusa(e.target.value)}
                required
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
              Cancelar
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg cursor-pointer">
              {mutation.isPending ? 'Salvando...' : `→ ${STAGE_LABELS[toStage]}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Kanban card ───────────────────────────────────────────────────────────────

function Card({ process }: { process: ProcessCard }) {
  const [showModal, setShowModal] = useState(false);
  const hasNext = NEXT_STAGES[process.stage].length > 0;
  const clientName = process.client.name ?? process.client.email;

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm space-y-2">
        <p className="font-medium text-gray-800 text-sm leading-tight">{clientName}</p>
        {process.valorUnidade && (
          <p className="text-xs text-gray-500">
            R$ {Number(process.valorUnidade).toLocaleString('pt-BR')}
          </p>
        )}
        {process.analista && (
          <p className="text-xs text-gray-400">Analista: {process.analista.name ?? process.analista.email}</p>
        )}
        {hasNext && (
          <button
            onClick={() => setShowModal(true)}
            className="w-full text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded py-1 cursor-pointer transition-colors"
          >
            Avançar →
          </button>
        )}
      </div>

      {showModal && (
        <AdvanceModal
          process={process}
          onClose={() => setShowModal(false)}
          onAdvanced={() => setShowModal(false)}
        />
      )}
    </>
  );
}

// ── Kanban column ─────────────────────────────────────────────────────────────

function Column({ stage, cards }: { stage: ProcessStage; cards: ProcessCard[] }) {
  return (
    <div className={`flex-shrink-0 w-56 rounded-xl border-2 ${COLUMN_COLORS[stage]} flex flex-col`}>
      <div className="px-3 py-2 border-b border-inherit">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          {STAGE_LABELS[stage]}
        </span>
        <span className="ml-1.5 text-xs text-gray-400">({cards.length})</span>
      </div>
      <div className="p-2 flex flex-col gap-2 flex-1 min-h-24">
        {cards.map((p) => <Card key={p.id} process={p} />)}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function KanbanPage() {
  const { role } = useAuth();
  const [showTerminal, setShowTerminal] = useState(false);

  const { data: processes = [], isLoading, error } = useQuery<ProcessCard[]>({
    queryKey: ['processes'],
    queryFn: () => api.get<ProcessCard[]>('/processes').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const byStage = (stage: ProcessStage) => processes.filter((p) => p.stage === stage);
  const terminalCount = TERMINAL_COLUMNS.reduce((n, s) => n + byStage(s).length, 0);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        Carregando processos...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center text-red-500">
        Erro ao carregar processos.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <h1 className="text-base font-semibold text-gray-900">Flui Contratos</h1>
        <span className="text-xs text-gray-400">Pipeline de Financiamento</span>
        <span className="ml-auto text-xs text-gray-500">{processes.length} processo(s)</span>
        <button
          onClick={() => setShowTerminal((v) => !v)}
          className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1 cursor-pointer"
        >
          {showTerminal ? 'Ocultar' : 'Ver'} inativos/recusados ({terminalCount})
        </button>
      </header>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-3 h-full" style={{ minWidth: 'max-content' }}>
          {KANBAN_COLUMNS.map((stage) => (
            <Column key={stage} stage={stage} cards={byStage(stage)} />
          ))}

          {showTerminal && TERMINAL_COLUMNS.map((stage) => (
            <Column key={stage} stage={stage} cards={byStage(stage)} />
          ))}
        </div>
      </div>

      {role === 'dono' && <DevApiMenu />}
    </div>
  );
}
