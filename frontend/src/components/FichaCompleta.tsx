import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import { apiErrorMessage } from '../lib/documentCatalog';
import { useCepLookup } from '../lib/useCepLookup';
import {
  apiValue, displayValue, fichaKeys, useDadosSolicitados, fieldsFor, inputValue, isVisible, targetOf, UFS, useFichaDef,
  type BankForm, type BankFormFile, type DataRequest, type FichaData, type FichaDef, type FichaField,
  type FichaTarget, type FichaValues,
} from '../lib/ficha';
import * as Icon from './icons';

// Ficha completa do proponente (dados dos formulários do banco), pedidos de
// dados ao cliente e os formulários do banco salvos no processo.

const TARGET_LABEL: Record<FichaTarget, string> = {
  cliente: '1º comprador (cliente)',
  segundo: '2º comprador ou cônjuge',
  processo: 'Financiamento no banco',
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ── campo de formulário montado pela definição ─────────────────────────────────
function FichaInput({ field, value, onChange, participants, id }: {
  field: FichaField; value: string; onChange: (v: string) => void;
  participants: FichaData['participants']; id: string;
}) {
  const select = (opts: { value: string; label: string }[]) => (
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">—</option>
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  let input;
  switch (field.type) {
    case 'enum': input = select(field.options ?? []); break;
    case 'boolean': input = select([{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }]); break;
    case 'uf': input = select(UFS.map(u => ({ value: u, label: u }))); break;
    case 'participant': input = select(participants.map(p => ({ value: p.id, label: p.name }))); break;
    case 'date': input = <input id={id} type="date" value={value} onChange={e => onChange(e.target.value)} />; break;
    case 'percent': input = <input id={id} type="number" min={0} max={100} step="0.01" value={value} onChange={e => onChange(e.target.value)} />; break;
    default:
      input = (
        <input id={id} type={field.type === 'email' ? 'email' : 'text'} value={value} maxLength={field.max ?? (field.type === 'cep' ? 9 : 20)}
          inputMode={['cep', 'phone', 'digits'].includes(field.type) ? 'numeric' : undefined}
          onChange={e => onChange(e.target.value)} />
      );
  }
  return (
    <div className="ds-field">
      <label htmlFor={id}>{field.label}</label>
      <div className="ds-input">{input}</div>
    </div>
  );
}

// valores do formulário de um alvo, com o CEP preenchendo o endereço
function useFichaForm(fields: FichaField[], initial: FichaValues) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.key, inputValue(f, initial[f.key] ?? null)])),
  );
  const cep = useCepLookup();
  const set = (key: string, v: string) => {
    setForm(prev => ({ ...prev, [key]: v }));
    if (key === 'cep') {
      cep.buscar(v, (_t, e) => setForm(prev => ({ ...prev, logradouro: e.logradouro, bairro: e.bairro, cidade: e.cidade, uf: e.uf })));
    }
  };
  const current: FichaValues = Object.fromEntries(fields.map(f => [f.key, apiValue(f, form[f.key] ?? '')]));
  const changed = (orig: FichaValues) =>
    Object.fromEntries(fields.filter(f => (orig[f.key] ?? null) !== current[f.key]).map(f => [f.key, current[f.key]]));
  return { form, set, current, changed, cep };
}

function GroupedInputs({ def, fields, form, set, current, participants, prefix }: {
  def: FichaDef; fields: FichaField[]; form: Record<string, string>; set: (k: string, v: string) => void;
  current: FichaValues; participants: FichaData['participants']; prefix: string;
}) {
  return (
    <>
      {def.groups.map(g => {
        const list = fields.filter(f => f.group === g.id && isVisible(f, current));
        if (list.length === 0) return null;
        return (
          <fieldset key={g.id} style={{ border: 0, padding: 0, margin: '6px 0 0' }}>
            <legend style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{g.label}</legend>
            {list.map(f => (
              <FichaInput key={f.key} id={`${prefix}-${f.key}`} field={f} value={form[f.key] ?? ''}
                onChange={v => set(f.key, v)} participants={participants} />
            ))}
          </fieldset>
        );
      })}
    </>
  );
}

// ── edição pela equipe ─────────────────────────────────────────────────────────
function FichaDrawer({ processId, target, def, data, onClose }: {
  processId: string; target: FichaTarget; def: FichaDef; data: FichaData; onClose: () => void;
}) {
  const qc = useQueryClient();
  const fields = fieldsFor(def, target);
  const orig: FichaValues = (target === 'cliente' ? data.cliente : target === 'segundo' ? data.segundo : data.processo) ?? {};
  const { form, set, current, changed, cep } = useFichaForm(fields, orig);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/processes/${processId}/ficha`, { [target]: changed(orig) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ficha', processId] });
      qc.invalidateQueries({ queryKey: ['process', processId] });
      onClose();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Não foi possível salvar a ficha')),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (Object.keys(changed(orig)).length === 0) { onClose(); return; }
    save.mutate();
  };
  const title = target === 'segundo' && data.segundo ? `${TARGET_LABEL.segundo} — ${data.segundo.nome}` : TARGET_LABEL[target];
  return (
    <>
      <div className="ds-drawer-backdrop open" onClick={save.isPending ? undefined : onClose} />
      <div className="ds-drawer open" style={{ width: 480 }} role="dialog" aria-modal="true" aria-labelledby="ficha-drawer-title">
        <div className="ds-drawer-hdr">
          <h2 id="ficha-drawer-title" style={{ margin: 0, fontSize: 15 }}>Editar ficha · {title}</h2>
          <button className="ds-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Fechar"><Icon.X size={14} /></button>
        </div>
        <form id="ficha-form" onSubmit={submit} noValidate className="ds-drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <GroupedInputs def={def} fields={fields} form={form} set={set} current={current} participants={data.participants} prefix={`ficha-${target}`} />
          {cep.mensagem && <p role="status" style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{cep.mensagem}</p>}
          {error && <div className="ds-alert warn" role="alert" style={{ marginTop: 8 }}>{error}</div>}
        </form>
        <div className="ds-drawer-foot">
          <button type="button" className="ds-btn ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" form="ficha-form" className="ds-btn accent" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── pedido de dados ao cliente ─────────────────────────────────────────────────
function SolicitarDadosModal({ processId, def, data, preselect, onClose }: {
  processId: string; def: FichaDef; data: FichaData; preselect: string[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(preselect));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const targets: FichaTarget[] = data.segundo ? ['cliente', 'segundo', 'processo'] : ['cliente', 'processo'];
  const send = useMutation({
    mutationFn: () => api.post(`/processes/${processId}/data-requests`, { fields: [...chosen], note: note.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: fichaKeys.requests(processId) }); onClose(); },
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Não foi possível enviar o pedido')),
  });
  const toggle = (k: string) => setChosen(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  return (
    <div className="ds-modal-overlay" onClick={onClose}>
      <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="solicitar-dados-title"
        style={{ maxWidth: 720, maxHeight: '86vh', display: 'flex', flexDirection: 'column', padding: 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid var(--border)' }}>
          <h2 id="solicitar-dados-title">Solicitar dados ao cliente</h2>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            O cliente recebe um e-mail e responde pelo portal. Os campos vazios da ficha já vêm marcados.
          </p>
        </div>
        <div style={{ padding: '12px 22px', overflowY: 'auto', flex: 1 }}>
          {targets.map(t => (
            <div key={t} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{TARGET_LABEL[t]}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px 12px' }}>
                {fieldsFor(def, t).filter(f => f.type !== 'participant').map(f => {
                  const k = `${t}.${f.key}`;
                  return (
                    <label key={k} style={{ display: 'flex', gap: 6, fontSize: 12.5, alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={chosen.has(k)} onChange={() => toggle(k)} />
                      <span>{f.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="ds-field">
            <label htmlFor="solicitar-dados-nota">Mensagem ao cliente (opcional)</label>
            <textarea id="solicitar-dados-nota" value={note} maxLength={500} rows={2} onChange={e => setNote(e.target.value)}
              style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit' }} />
          </div>
          {error && <div className="ds-alert warn" role="alert">{error}</div>}
        </div>
        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ marginRight: 'auto', fontSize: 12.5, color: 'var(--text-muted)' }}>{chosen.size} dado{chosen.size !== 1 ? 's' : ''}</span>
          <button className="ds-btn ghost" onClick={onClose}>Cancelar</button>
          <button className="ds-btn accent" disabled={chosen.size === 0 || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? 'Enviando…' : 'Enviar pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── formulários do banco (só a equipe) ─────────────────────────────────────────
function FormulariosBancoCard({ processId, onRequest }: { processId: string; onRequest: (keys: string[]) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const { data } = useQuery<{ forms: BankForm[]; files: BankFormFile[] }>({
    queryKey: fichaKeys.bankForms(processId),
    queryFn: () => api.get(`/processes/${processId}/bank-forms`).then(r => r.data),
  });
  const generate = useMutation({
    mutationFn: (key: string) => api.post(`/processes/${processId}/bank-forms/${key}`),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: fichaKeys.bankForms(processId) }); },
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Não foi possível gerar o formulário')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/processes/${processId}/bank-forms/files/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: fichaKeys.bankForms(processId) }),
  });
  const download = async (f: BankFormFile) => {
    const res = await api.get(`/processes/${processId}/bank-forms/files/${f.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${f.bank ?? 'Banco'} - ${f.label}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="ds-card" data-testid="formularios-banco">
      <div className="ds-card-hdr">
        Formulários do banco
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-faint)' }}>salvos no processo · o cliente não vê</span>
      </div>
      <div className="ds-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {(data?.forms ?? []).map(f => {
          const pct = f.total ? Math.round((f.filled / f.total) * 100) : 0;
          const requestable = f.missing.map(m => m.key).filter((k): k is string => !!k);
          return (
            <div key={f.key} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{f.bank} — {f.label}</strong>
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>versão {f.version}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12.5 }}>{f.filled} de {f.total} campos ({pct}%)</span>
              </div>
              <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, margin: '6px 0' }} aria-hidden>
                <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--green)' : 'var(--accent)', borderRadius: 3 }} />
              </div>
              {f.missing.length > 0 && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0' }}>
                  Falta: {f.missing.map(m => m.label).join(', ')}.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="ds-btn accent sm" disabled={!f.available || generate.isPending} onClick={() => generate.mutate(f.key)}>
                  {generate.isPending && generate.variables === f.key ? 'Gerando…' : 'Gerar e salvar no processo'}
                </button>
                {requestable.length > 0 && (
                  <button className="ds-btn sm" onClick={() => onRequest(requestable)}>Pedir o que falta ao cliente</button>
                )}
                {!f.available && <span style={{ fontSize: 12, color: 'var(--amber)' }}>Modelo do formulário indisponível no servidor.</span>}
              </div>
            </div>
          );
        })}
        {error && <div className="ds-alert warn" role="alert">{error}</div>}
        <div>
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Gerados</div>
          {(data?.files ?? []).length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>Nenhum formulário gerado ainda.</div>
          ) : (
            <table className="ds-table">
              <thead><tr><th>Formulário</th><th>Preenchido</th><th>Gerado em</th><th /></tr></thead>
              <tbody>
                {data!.files.map(f => (
                  <tr key={f.id}>
                    <td>{f.bank} — {f.label} <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>v{f.version}</span></td>
                    <td>{f.filledFields}/{f.totalFields}</td>
                    <td>{fmtDateTime(f.createdAt)}{f.generatedBy ? ` · ${f.generatedBy}` : ''}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="ds-btn ghost sm" onClick={() => download(f)}>Baixar</button>
                      <button className="ds-btn ghost sm" style={{ color: 'var(--red)' }}
                        onClick={() => { if (window.confirm('Excluir este formulário gerado?')) remove.mutate(f.id); }}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── visão da equipe ────────────────────────────────────────────────────────────
function PessoaCard({ title, target, def, values, participants, onEdit, extra }: {
  title: string; target: FichaTarget; def: FichaDef; values: FichaValues; participants: FichaData['participants'];
  onEdit?: () => void; extra?: React.ReactNode;
}) {
  const fields = fieldsFor(def, target).filter(f => isVisible(f, values));
  const missing = fields.filter(f => displayValue(f, values[f.key] ?? null, participants) === null).length;
  return (
    <div className="ds-card" data-testid={`ficha-${target}`}>
      <div className="ds-card-hdr">
        {title}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: missing ? 'var(--amber)' : 'var(--green)' }}>
          {missing ? `${missing} em branco` : 'completo'}
        </span>
        {onEdit && <button className="ds-btn sm" style={{ marginLeft: 8 }} onClick={onEdit}>Editar</button>}
      </div>
      <div className="ds-card-body">
        {extra}
        {def.groups.map(g => {
          const list = fields.filter(f => f.group === g.id);
          if (list.length === 0) return null;
          return (
            <Fragment key={g.id}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', margin: '12px 0 4px' }}>{g.label}</div>
              <dl className="ds-kv" style={{ gridTemplateColumns: '190px 1fr' }}>
                {list.map(f => {
                  const v = displayValue(f, values[f.key] ?? null, participants);
                  return (
                    <Fragment key={f.key}>
                      <dt>{f.label}</dt>
                      <dd style={v === null ? { color: 'var(--amber)', fontWeight: 400 } : undefined}>{v ?? 'Não informado'}</dd>
                    </Fragment>
                  );
                })}
              </dl>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function PedidosCard({ processId, onNew }: { processId: string; onNew: () => void }) {
  const qc = useQueryClient();
  const { data: requests = [] } = useQuery<DataRequest[]>({
    queryKey: fichaKeys.requests(processId),
    queryFn: () => api.get(`/processes/${processId}/data-requests`).then(r => r.data),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(`/processes/${processId}/data-requests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: fichaKeys.requests(processId) }),
  });
  const STATUS = { pendente: 'Aguardando o cliente', respondido: 'Respondido', cancelado: 'Cancelado' } as const;
  return (
    <div className="ds-card" data-testid="ficha-pedidos">
      <div className="ds-card-hdr">
        Dados pedidos ao cliente
        <button className="ds-btn sm" style={{ marginLeft: 'auto' }} onClick={onNew}>Solicitar dados</button>
      </div>
      <div className="ds-card-body">
        {requests.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>Nenhum pedido. Use "Solicitar dados" para pedir ao cliente o que falta na ficha.</div>
        ) : requests.map(r => (
          <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong>{STATUS[r.status]}</strong>
              <span style={{ color: 'var(--text-faint)' }}>{fmtDateTime(r.createdAt)}{r.requestedBy ? ` · ${r.requestedBy}` : ''}</span>
              {r.status === 'pendente' && (
                <button className="ds-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => cancel.mutate(r.id)}>Cancelar pedido</button>
              )}
            </div>
            <div style={{ color: 'var(--text-muted)' }}>{r.labels.join(', ')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FichaEquipe({ processId, def }: { processId: string; def: FichaDef }) {
  const { data } = useQuery<FichaData>({
    queryKey: fichaKeys.ficha(processId),
    queryFn: () => api.get(`/processes/${processId}/ficha`).then(r => r.data),
  });
  const [editing, setEditing] = useState<FichaTarget | null>(null);
  const [requesting, setRequesting] = useState<string[] | null>(null);
  const emptyKeys = useMemo(() => {
    if (!data) return [];
    const keys: string[] = [];
    for (const t of ['cliente', 'segundo', 'processo'] as const) {
      const values = t === 'cliente' ? data.cliente : t === 'segundo' ? data.segundo : data.processo;
      if (!values) continue;
      for (const f of fieldsFor(def, t)) {
        if (f.type !== 'participant' && isVisible(f, values) && (values[f.key] ?? null) === null) keys.push(`${t}.${f.key}`);
      }
    }
    return keys;
  }, [data, def]);
  if (!data) return <div className="ds-card"><div className="ds-card-body">Carregando a ficha…</div></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ds-dash-grid">
        <div className="ds-col-6">
          <PessoaCard title={`${TARGET_LABEL.cliente} — ${data.cliente.nome ?? 'sem nome'}`} target="cliente" def={def}
            values={data.cliente} participants={data.participants} onEdit={() => setEditing('cliente')} />
        </div>
        <div className="ds-col-6" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.segundo ? (
            <PessoaCard title={`${TARGET_LABEL.segundo} — ${data.segundo.nome}`} target="segundo" def={def}
              values={data.segundo} participants={data.participants} onEdit={() => setEditing('segundo')} />
          ) : (
            <div className="ds-card" data-testid="ficha-segundo">
              <div className="ds-card-hdr">{TARGET_LABEL.segundo}</div>
              <div className="ds-card-body" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {data.participants.length === 0
                  ? 'Cadastre o cônjuge ou o 2º comprador na Composição de Renda (aba Cadastro) e escolha-o em "Financiamento no banco".'
                  : 'Escolha o 2º comprador em "Financiamento no banco" para preencher os dados dele.'}
              </div>
            </div>
          )}
          <PessoaCard title={TARGET_LABEL.processo} target="processo" def={def} values={data.processo}
            participants={data.participants} onEdit={() => setEditing('processo')} />
        </div>
      </div>
      <PedidosCard processId={processId} onNew={() => setRequesting(emptyKeys)} />
      <FormulariosBancoCard processId={processId} onRequest={keys => setRequesting(keys)} />
      {editing && <FichaDrawer processId={processId} target={editing} def={def} data={data} onClose={() => setEditing(null)} />}
      {requesting && (
        <SolicitarDadosModal processId={processId} def={def} data={data} preselect={requesting} onClose={() => setRequesting(null)} />
      )}
    </div>
  );
}

// ── visão do cliente: responder o que a assessoria pediu ───────────────────────
function PedidoCliente({ processId, def, request }: { processId: string; def: FichaDef; request: DataRequest }) {
  const qc = useQueryClient();
  const byKey = new Map(def.fields.map(f => [f.key, f]));
  const items = request.fields
    .map(k => ({ fullKey: k, field: byKey.get(k.split('.')[1]) }))
    .filter((i): i is { fullKey: string; field: FichaField } => !!i.field);
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map(i => [i.fullKey, inputValue(i.field, request.values?.[i.fullKey] ?? null)])),
  );
  const [error, setError] = useState('');
  const cep = useCepLookup();
  const set = (fullKey: string, v: string) => {
    setForm(prev => ({ ...prev, [fullKey]: v }));
    const [t, k] = fullKey.split('.');
    if (k === 'cep') {
      cep.buscar(v, (_x, e) => setForm(prev => {
        const next = { ...prev };
        for (const [part, val] of Object.entries({ logradouro: e.logradouro, bairro: e.bairro, cidade: e.cidade, uf: e.uf })) {
          if (`${t}.${part}` in next) next[`${t}.${part}`] = val;
        }
        return next;
      }));
    }
  };
  const answer = useMutation({
    mutationFn: () => api.post(`/processes/${processId}/data-requests/${request.id}/answer`, {
      values: Object.fromEntries(items.map(i => [i.fullKey, apiValue(i.field, form[i.fullKey] ?? '')])),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: fichaKeys.requests(processId) }),
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Não foi possível enviar os dados')),
  });
  const segValues = Object.fromEntries(items.map(i => [i.field.key, apiValue(i.field, form[i.fullKey] ?? '')]));
  return (
    <form className="ds-card" data-testid="dados-solicitados" noValidate
      onSubmit={e => { e.preventDefault(); setError(''); answer.mutate(); }}>
      <div className="ds-card-hdr">Dados solicitados pela assessoria</div>
      <div className="ds-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Sua assessoria precisa destes dados para preencher os formulários do banco.{request.note ? ` Mensagem: "${request.note}"` : ''}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0 14px' }}>
          {items.filter(i => isVisible(i.field, { ...segValues })).map(i => (
            <FichaInput key={i.fullKey} id={`pedido-${i.fullKey}`}
              field={{ ...i.field, label: targetOf(i.fullKey) === 'segundo' ? `2º comprador: ${i.field.label}` : i.field.label }}
              value={form[i.fullKey] ?? ''} onChange={v => set(i.fullKey, v)} participants={[]} />
          ))}
        </div>
        {cep.mensagem && <p role="status" style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{cep.mensagem}</p>}
        {error && <div className="ds-alert warn" role="alert">{error}</div>}
        <div>
          <button type="submit" className="ds-btn accent" disabled={answer.isPending}>{answer.isPending ? 'Enviando…' : 'Enviar dados'}</button>
        </div>
      </div>
    </form>
  );
}

export function FichaCompleta({ processId, role }: { processId: string; role: string | null }) {
  const { data: def } = useFichaDef();
  const isCliente = role === 'cliente';
  const { data: pedidos = [] } = useDadosSolicitados(processId, isCliente);
  if (!def) return null;
  if (isCliente) {
    return pedidos.length === 0 ? null : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {pedidos.map(r => <PedidoCliente key={r.id} processId={processId} def={def} request={r} />)}
      </div>
    );
  }
  return <FichaEquipe processId={processId} def={def} />;
}
