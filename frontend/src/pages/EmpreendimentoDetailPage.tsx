import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from '../components/icons';
import { useAuth } from '../auth/useAuth';

// ── Shared drawer sub-components ───────────────────────────────────────────────

interface UserOpt { id: string; name: string | null; email: string; cpf: string | null }
type ClienteMode = 'existente' | 'novo';

function NovaUnidadeDrawer({ empId, onClose }: { empId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [identificacao, setIdentificacao] = useState('');
  const [valor, setValor] = useState('');
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () => {
      const n = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
      return api.post('/unidades', {
        empreendimentoId: empId,
        identificacao: identificacao.trim(),
        valor: isNaN(n) ? undefined : n,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['unidades', empId] });
      onClose();
    },
    onError: (e: unknown) => {
      const axiosMsg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      const msg = Array.isArray(axiosMsg) ? axiosMsg.join('; ') : (axiosMsg ?? (e instanceof Error ? e.message : 'Erro desconhecido'));
      setError(msg);
    },
  });

  return (
    <>
      <div className="ds-drawer-backdrop open" onClick={onClose} />
      <div className="ds-drawer open" style={{ width: 400 }}>
        <div className="ds-drawer-hdr">
          <h2>Nova Unidade</h2>
          <button className="ds-btn ghost sm" onClick={onClose}><Icon.X size={14} /></button>
        </div>
        <div className="ds-drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="ds-field" style={{ marginBottom: 0 }}>
            <label>Identificação <span style={{ color: 'var(--red)' }}>*</span></label>
            <div className="ds-input">
              <input placeholder="Ex: Apto 101, Casa 5, Lote 12" value={identificacao}
                onChange={e => setIdentificacao(e.target.value)} style={{ flex: 1 }} autoFocus />
            </div>
          </div>
          <div className="ds-field" style={{ marginBottom: 0 }}>
            <label>Valor (R$)</label>
            <div className="ds-input">
              <input placeholder="0,00" value={valor}
                onChange={e => setValor(e.target.value)} style={{ flex: 1 }} />
            </div>
          </div>
          {error && (
            <div className="ds-alert urgent">
              <Icon.AlertTriangle size={14} /><span>{error}</span>
            </div>
          )}
        </div>
        <div className="ds-drawer-foot">
          <button className="ds-btn ghost" onClick={onClose}>Cancelar</button>
          <button className="ds-btn accent"
            disabled={!identificacao.trim() || mut.isPending}
            onClick={() => { setError(''); mut.mutate(); }}>
            {mut.isPending ? 'Criando...' : 'Criar Unidade'}
          </button>
        </div>
      </div>
    </>
  );
}

function AlocarClienteDrawer({
  unidade, empId, onClose, onSuccess,
}: {
  unidade: { id: string; identificacao: string; valor: number | null };
  empId: string;
  onClose: () => void;
  onSuccess: (processId: string) => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<ClienteMode>('existente');
  const [clienteId, setClienteId] = useState('');
  const [analistaId, setAnalistaId] = useState('');
  const [novoForm, setNovoForm] = useState({ name: '', email: '', cpf: '' });
  const [error, setError] = useState('');

  const { data: clientes = [] } = useQuery<UserOpt[]>({
    queryKey: ['users', 'cliente'],
    queryFn: () => api.get('/users', { params: { role: 'cliente' } }).then(r => r.data),
  });
  const { data: analistas = [] } = useQuery<UserOpt[]>({
    queryKey: ['users', 'analista'],
    queryFn: () => api.get('/users', { params: { role: 'analista' } }).then(r => r.data),
  });

  const mut = useMutation({
    mutationFn: async () => {
      let finalClienteId = clienteId;
      if (mode === 'novo') {
        const cpfDigits = novoForm.cpf.replace(/\D/g, '');
        if (cpfDigits.length !== 11) throw new Error('CPF deve ter 11 dígitos');
        const res = await api.post('/users', {
          name: novoForm.name.trim(),
          email: novoForm.email.trim(),
          cpf: cpfDigits,
          role: 'cliente',
        });
        finalClienteId = res.data.id;
        void qc.invalidateQueries({ queryKey: ['users', 'cliente'] });
      }
      const res = await api.post('/processes', {
        clientId: finalClienteId,
        analistaId: analistaId || undefined,
        unidadeId: unidade.id,
        valorUnidade: unidade.valor != null ? Number(unidade.valor) : undefined,
      });
      return res.data.id as string;
    },
    onSuccess: (processId) => {
      void qc.invalidateQueries({ queryKey: ['processes'] });
      void qc.invalidateQueries({ queryKey: ['processes', { empreendimentoId: empId }] });
      onSuccess(processId);
    },
    onError: (e: unknown) => {
      const axiosMsg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      const msg = Array.isArray(axiosMsg) ? axiosMsg.join('; ') : (axiosMsg ?? (e instanceof Error ? e.message : 'Erro desconhecido'));
      setError(msg);
    },
  });

  const canSubmit = mode === 'existente'
    ? !!clienteId
    : !!(novoForm.name.trim() && novoForm.email.trim() && novoForm.cpf.trim());

  return (
    <>
      <div className="ds-drawer-backdrop open" onClick={onClose} />
      <div className="ds-drawer open" style={{ width: 440 }}>
        <div className="ds-drawer-hdr">
          <div>
            <h2>Alocar Cliente</h2>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
              Unidade: <strong>{unidade.identificacao}</strong>
            </div>
          </div>
          <button className="ds-btn ghost sm" onClick={onClose}><Icon.X size={14} /></button>
        </div>

        <div className="ds-drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Mode toggle */}
          <div className="ds-seg" style={{ width: '100%' }}>
            <button className={`ds-seg-btn ${mode === 'existente' ? 'active' : ''}`}
              style={{ flex: 1 }} onClick={() => setMode('existente')}>
              <Icon.Users size={12} /> Cliente existente
            </button>
            <button className={`ds-seg-btn ${mode === 'novo' ? 'active' : ''}`}
              style={{ flex: 1 }} onClick={() => setMode('novo')}>
              <Icon.Plus size={12} /> Cadastrar novo
            </button>
          </div>

          {mode === 'existente' ? (
            <div className="ds-field" style={{ marginBottom: 0 }}>
              <label>Cliente <span style={{ color: 'var(--red)' }}>*</span></label>
              <select className="ds-input" value={clienteId}
                onChange={e => setClienteId(e.target.value)} style={{ width: '100%' }}>
                <option value="">Selecionar cliente...</option>
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.email}{c.cpf ? ` · ${c.cpf}` : ''}
                  </option>
                ))}
              </select>
              {clientes.length === 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>
                  Nenhum cliente — use "Cadastrar novo".
                </div>
              )}
            </div>
          ) : (
            <>
              {[
                { key: 'name', label: 'Nome completo', placeholder: 'Nome do cliente', type: 'text' },
                { key: 'email', label: 'E-mail', placeholder: 'email@exemplo.com', type: 'email' },
                { key: 'cpf', label: 'CPF (usado como senha)', placeholder: '000.000.000-00', type: 'text' },
              ].map(({ key, label, placeholder, type }) => (
                <div key={key} className="ds-field" style={{ marginBottom: 0 }}>
                  <label>{label} <span style={{ color: 'var(--red)' }}>*</span></label>
                  <div className="ds-input">
                    <input type={type} placeholder={placeholder}
                      value={novoForm[key as keyof typeof novoForm]}
                      onChange={e => setNovoForm(f => ({ ...f, [key]: e.target.value }))}
                      style={{ flex: 1 }} />
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', padding: '8px 10px', background: 'var(--surface-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                Login: e-mail + dígitos do CPF como senha.
              </div>
            </>
          )}

          <div className="ds-divider" />

          <div className="ds-field" style={{ marginBottom: 0 }}>
            <label>Analista Responsável</label>
            <select className="ds-input" value={analistaId}
              onChange={e => setAnalistaId(e.target.value)} style={{ width: '100%' }}>
              <option value="">— Sem analista designado —</option>
              {analistas.map(a => (
                <option key={a.id} value={a.id}>{a.name ?? a.email}</option>
              ))}
            </select>
          </div>

          {error && (
            <div className="ds-alert urgent">
              <Icon.AlertTriangle size={14} /><span>{error}</span>
            </div>
          )}
        </div>

        <div className="ds-drawer-foot">
          <button className="ds-btn ghost" onClick={onClose}>Cancelar</button>
          <button className="ds-btn accent"
            disabled={!canSubmit || mut.isPending}
            onClick={() => { setError(''); mut.mutate(); }}>
            {mut.isPending ? 'Criando processo...' : 'Alocar e Criar Processo'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface Empreendimento {
  id: string;
  nome: string;
  matriculaMae: string;
  endereco: string;
  cep: string;
  bancoFinanciador: string;
  construtoraInfo: string | null;
  incorporadoraContato: string | null;
  active: boolean;
  createdAt: string;
}

interface Unidade {
  id: string;
  identificacao: string;
  valor: number | null;
}

interface ProcessCard {
  id: string;
  stage: string;
  client: { id: string; name: string | null; email: string };
  analista: { id: string; name: string | null } | null;
  valorUnidade: number | null;
  updatedAt: string;
  unidade: Unidade | null;
}

type Tab = 'workflow' | 'unidades' | 'informacoes';

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
};

const MAIN_STAGES = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
];

function initials(name: string | null): string {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

function formatCurrency(v: number | null) {
  if (!v) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function WorkflowTab({ empId, onOpenProcess }: { empId: string; onOpenProcess: (id: string) => void }) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const { data: processes = [], isLoading } = useQuery<ProcessCard[]>({
    queryKey: ['processes', { empreendimentoId: empId }],
    queryFn: () => api.get('/processes', { params: { empreendimentoId: empId } }).then(r => r.data),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => api.delete(`/processes/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processes', { empreendimentoId: empId }] }),
  });

  const byStage = MAIN_STAGES.map(s => ({
    stage: s,
    cards: processes.filter(p => p.stage === s),
  }));

  if (isLoading) return <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando...</div>;

  return (
    <div className="ds-kanban" style={{ minHeight: 300 }}>
      {byStage.map(({ stage, cards }) => (
        <div className="ds-kb-col" key={stage}>
          <div className="ds-kb-hdr">
            <span className="ds-kb-title">{STAGE_LABELS[stage]}</span>
            <span className="ds-kb-count">{cards.length}</span>
          </div>
          <div className="ds-kb-body">
            {cards.map(p => (
              <div
                className="ds-kb-card"
                key={p.id}
                onClick={() => onOpenProcess(p.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="ds-kb-card-hdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <span className="ds-kb-card-name">{p.client.name ?? p.client.email}</span>
                  {role === 'dono' && (
                    <button
                      className="ds-btn ghost sm"
                      title="Remover alocação"
                      style={{ padding: '2px 4px', opacity: 0.6 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Remover a alocação de "${p.client.name ?? p.client.email}" desta unidade?`)) {
                          deactivateMut.mutate(p.id);
                        }
                      }}
                    >
                      <Icon.Trash size={12} />
                    </button>
                  )}
                </div>
                <div className="ds-kb-card-foot">
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {p.unidade ? p.unidade.identificacao : '—'}
                  </span>
                  {p.analista && (
                    <div className="ds-kb-avatar" title={p.analista.name ?? ''}>
                      {initials(p.analista.name)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function UnidadesTab({ empId, onOpenProcess }: { empId: string; onOpenProcess: (id: string) => void }) {
  const { role } = useAuth();
  const isDono = role === 'dono';
  const qc = useQueryClient();
  const { data: unidades = [], isLoading } = useQuery<Unidade[]>({
    queryKey: ['unidades', empId],
    queryFn: () => api.get('/unidades', { params: { empreendimentoId: empId } }).then(r => r.data),
  });
  const [showNovaUnidade, setShowNovaUnidade] = useState(false);
  const [alocarUnidade, setAlocarUnidade] = useState<Unidade | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const deleteUnidadeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/unidades/${id}`).then(r => r.data),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: ['unidades', empId] });
      setDeleteErrors(e => { const n = { ...e }; delete n[id]; return n; });
    },
    onError: (err: unknown, id) => {
      const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const msg = Array.isArray(axiosMsg) ? axiosMsg.join('; ') : (axiosMsg ?? (err instanceof Error ? err.message : 'Erro'));
      setDeleteErrors(e => ({ ...e, [id]: msg }));
    },
  });

  const handleDeleteUnidade = (id: string, identificacao: string) => {
    if (!window.confirm(`Excluir unidade "${identificacao}"? Esta ação não pode ser desfeita.`)) return;
    setDeleteErrors(e => { const n = { ...e }; delete n[id]; return n; });
    deleteUnidadeMut.mutate(id);
  };

  if (isLoading) return <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 24 }}>Carregando...</div>;

  return (
    <>
      <div className="ds-card">
        <div className="ds-card-hdr">
          Unidades
          <button className="ds-btn accent sm" style={{ marginLeft: 'auto' }}
            onClick={() => setShowNovaUnidade(true)}>
            <Icon.Plus size={12} /> Nova Unidade
          </button>
        </div>

        {unidades.length === 0 ? (
          <div className="ds-card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-faint)', fontSize: 13 }}>
            Nenhuma unidade cadastrada.{' '}
            <button className="ds-btn ghost sm" onClick={() => setShowNovaUnidade(true)}>
              Adicionar agora
            </button>
          </div>
        ) : (
          <table className="ds-table">
            <thead>
              <tr>
                <th>Identificação</th>
                <th>Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unidades.map(u => (
                <>
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>{u.identificacao}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(u.valor)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="ds-btn ghost sm" onClick={() => setAlocarUnidade(u)}>
                          <Icon.Plus size={12} /> Alocar Cliente
                        </button>
                        {isDono && (
                          <button
                            className="ds-btn ghost sm"
                            style={{ color: 'var(--red)' }}
                            onClick={() => handleDeleteUnidade(u.id, u.identificacao)}
                            title="Excluir unidade"
                          >
                            <Icon.Trash size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {deleteErrors[u.id] && (
                    <tr key={`err-${u.id}`}>
                      <td colSpan={3} style={{ padding: '0 16px 8px', fontSize: 11.5, color: 'var(--red)' }}>{deleteErrors[u.id]}</td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNovaUnidade && (
        <NovaUnidadeDrawer empId={empId} onClose={() => setShowNovaUnidade(false)} />
      )}

      {alocarUnidade && (
        <AlocarClienteDrawer
          unidade={alocarUnidade}
          empId={empId}
          onClose={() => setAlocarUnidade(null)}
          onSuccess={(processId) => {
            setAlocarUnidade(null);
            onOpenProcess(processId);
          }}
        />
      )}
    </>
  );
}

function InformacoesTab({ emp, empId }: { emp: Empreendimento; empId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    nome: emp.nome,
    matriculaMae: emp.matriculaMae,
    endereco: emp.endereco,
    cep: emp.cep,
    bancoFinanciador: emp.bancoFinanciador,
    construtoraInfo: emp.construtoraInfo ?? '',
    incorporadoraContato: emp.incorporadoraContato ?? '',
  });

  const mut = useMutation({
    mutationFn: (dto: typeof form) => api.patch(`/empreendimentos/${empId}`, dto).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['empreendimento', empId] });
      void qc.invalidateQueries({ queryKey: ['empreendimentos'] });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <div className="ds-card">
        <div className="ds-card-hdr">
          Informações do Empreendimento
          <button className="ds-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing(false)}>
            Cancelar
          </button>
        </div>
        <div className="ds-card-body">
          <form
            onSubmit={e => { e.preventDefault(); mut.mutate(form); }}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            {[
              { key: 'nome', label: 'Nome' },
              { key: 'matriculaMae', label: 'Matrícula Mãe' },
              { key: 'endereco', label: 'Endereço' },
              { key: 'cep', label: 'CEP' },
              { key: 'bancoFinanciador', label: 'Banco Financiador' },
              { key: 'construtoraInfo', label: 'Construtora' },
              { key: 'incorporadoraContato', label: 'Contato Incorporadora' },
            ].map(({ key, label }) => (
              <div key={key} className="ds-field" style={{ marginBottom: 0 }}>
                <label>{label}</label>
                <div className="ds-input">
                  <input
                    type="text"
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="ds-btn ghost sm" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button type="submit" className="ds-btn accent sm" disabled={mut.isPending}>
                {mut.isPending ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const rows = [
    { label: 'Nome', value: emp.nome },
    { label: 'Matrícula Mãe', value: emp.matriculaMae },
    { label: 'Endereço', value: emp.endereco },
    { label: 'CEP', value: emp.cep },
    { label: 'Banco Financiador', value: emp.bancoFinanciador },
    { label: 'Construtora', value: emp.construtoraInfo ?? '—' },
    { label: 'Contato Incorporadora', value: emp.incorporadoraContato ?? '—' },
    { label: 'Cadastrado em', value: new Date(emp.createdAt).toLocaleDateString('pt-BR') },
  ];

  return (
    <div className="ds-card">
      <div className="ds-card-hdr">
        Informações do Empreendimento
        <button className="ds-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing(true)}>
          <Icon.Edit size={12} /> Editar
        </button>
      </div>
      <div className="ds-card-body">
        <dl className="ds-kv">
          {rows.map(r => (
            <>
              <dt key={`dt-${r.label}`}>{r.label}</dt>
              <dd key={`dd-${r.label}`}>{r.value}</dd>
            </>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

interface Props {
  empId: string;
  onBack: () => void;
  onOpenProcess: (id: string) => void;
}

export function EmpreendimentoDetailPage({ empId, onBack, onOpenProcess }: Props) {
  const [tab, setTab] = useState<Tab>('workflow');

  const { data: emp, isLoading, isError } = useQuery<Empreendimento>({
    queryKey: ['empreendimento', empId],
    queryFn: () => api.get(`/empreendimentos/${empId}`).then(r => r.data),
  });

  const { data: processes = [] } = useQuery<ProcessCard[]>({
    queryKey: ['processes', { empreendimentoId: empId }],
    queryFn: () => api.get('/processes', { params: { empreendimentoId: empId } }).then(r => r.data),
  });

  if (isLoading) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 32 }}>Carregando...</div>;
  }

  if (isError || !emp) {
    return (
      <div style={{ padding: 32 }}>
        <div className="ds-alert urgent">Empreendimento não encontrado.</div>
        <button className="ds-btn ghost" style={{ marginTop: 12 }} onClick={onBack}>← Voltar</button>
      </div>
    );
  }

  const activeCount = processes.filter(p =>
    !['cliente_inativo', 'credito_recusado'].includes(p.stage)
  ).length;

  const TABS = [
    { id: 'workflow' as Tab, label: `Workflow (${activeCount})` },
    { id: 'unidades' as Tab, label: 'Unidades' },
    { id: 'informacoes' as Tab, label: 'Informações' },
  ];

  return (
    <div className="ds-page">
      {/* Breadcrumb back */}
      <button
        className="ds-btn ghost sm"
        style={{ marginBottom: 12, fontSize: 12 }}
        onClick={onBack}
      >
        ← Empreendimentos
      </button>

      {/* Hero */}
      <div className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-body" style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 'var(--radius)',
              background: 'var(--accent-soft)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon.Building size={24} style={{ color: 'var(--accent)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>{emp.nome}</h2>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
              <Icon.MapPin size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
              {emp.endereco} — CEP {emp.cep}
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {[
                { label: 'Banco', value: emp.bancoFinanciador },
                { label: 'Construtora', value: emp.construtoraInfo ?? '—' },
                { label: 'Processos ativos', value: String(activeCount) },
              ].map(stat => (
                <div key={stat.label}>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 2 }}>{stat.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{stat.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="ds-tabs" style={{ marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`ds-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'workflow' && (
        <WorkflowTab empId={empId} onOpenProcess={onOpenProcess} />
      )}
      {tab === 'unidades' && <UnidadesTab empId={empId} onOpenProcess={onOpenProcess} />}
      {tab === 'informacoes' && <InformacoesTab emp={emp} empId={empId} />}
    </div>
  );
}
