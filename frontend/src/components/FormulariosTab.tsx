import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';

// FE-23: DPS (Declaração Pessoal de Saúde, para o seguro MIP) e formulário de
// financiamento preenchidos no app. Cada envio vira um documento do checklist
// do processo, que o analista valida na aba Documentos (RN-04).

export interface FormDoc {
  id: string;
  status: 'pendente' | 'recebido' | 'validado' | 'rejeitado';
  validatedByNotes: string | null;
  formType?: 'dps' | 'financiamento' | null;
  formData?: Record<string, unknown> | null;
}

const DPS_QUESTIONS = [
  { key: 'tratamento', text: 'Está em tratamento médico ou usa medicamento de forma contínua?' },
  { key: 'doencaGrave', text: 'Tem ou já teve doença do coração, câncer, AVC, diabetes, doença renal crônica ou doença psiquiátrica?' },
  { key: 'internacao', text: 'Foi internado(a) ou fez cirurgia nos últimos 5 anos?' },
  { key: 'deficiencia', text: 'Tem deficiência física ou alguma limitação para o trabalho?' },
  { key: 'afastamento', text: 'Está afastado(a) do trabalho por saúde ou aposentado(a) por invalidez?' },
] as const;
type DpsKey = typeof DPS_QUESTIONS[number]['key'];

// Aceita "280.000,50", "15.000" (milhar), "280000.5" ou "72,5"
function parseNum(s: string): number {
  const t = s.trim();
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
}
const toText = (v: unknown) => (v === undefined || v === null ? '' : String(v).replace('.', ','));

function apiError(e: unknown): string {
  const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(msg) ? msg.join('; ') : (msg ?? 'Não foi possível enviar o formulário');
}

function StatusLine({ doc }: { doc?: FormDoc }) {
  if (!doc) return <span className="ds-form-status">Não enviado</span>;
  const map = {
    pendente: { text: 'Não enviado', cls: '' },
    recebido: { text: 'Enviado — aguardando validação do analista', cls: 'info' },
    validado: { text: 'Validado pelo analista', cls: 'ok' },
    rejeitado: { text: 'Rejeitado — corrija e envie de novo', cls: 'bad' },
  }[doc.status];
  return <span className={`ds-form-status ${map.cls}`} data-testid="form-status">{map.text}</span>;
}

function useSubmitForm(processId: string, type: 'dps' | 'financiamento') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => api.put(`/processes/${processId}/forms/${type}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents', processId] });
      void qc.invalidateQueries({ queryKey: ['audit', processId] });
    },
  });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ds-field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function YesNo({ name, value, onChange, disabled }: {
  name: string; value: boolean | null; onChange: (v: boolean) => void; disabled: boolean;
}) {
  return (
    <div className="ds-seg" role="radiogroup" aria-label={name}>
      {[true, false].map(v => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          className={`ds-seg-btn ${value === v ? 'active' : ''}`}
          onClick={() => onChange(v)}
        >
          {v ? 'Sim' : 'Não'}
        </button>
      ))}
    </div>
  );
}

function DpsCard({ processId, doc }: { processId: string; doc?: FormDoc }) {
  const saved = (doc?.formData ?? {}) as Record<string, unknown>;
  const [altura, setAltura] = useState(toText(saved.alturaCm));
  const [peso, setPeso] = useState(toText(saved.pesoKg));
  const [answers, setAnswers] = useState<Record<DpsKey, boolean | null>>(() => Object.fromEntries(
    DPS_QUESTIONS.map(q => [q.key, typeof saved[q.key] === 'boolean' ? saved[q.key] as boolean : null]),
  ) as Record<DpsKey, boolean | null>);
  const [detalhes, setDetalhes] = useState(String(saved.detalhes ?? ''));
  const [declaracao, setDeclaracao] = useState(saved.declaracao === true);
  const submit = useSubmitForm(processId, 'dps');
  const locked = doc?.status === 'validado';

  const anyYes = Object.values(answers).some(v => v === true);
  const ready = altura.trim() !== '' && peso.trim() !== ''
    && Object.values(answers).every(v => v !== null)
    && (!anyYes || detalhes.trim() !== '') && declaracao;

  const send = () => submit.mutate({
    alturaCm: Math.round(parseNum(altura)),
    pesoKg: parseNum(peso),
    ...answers,
    ...(anyYes ? { detalhes: detalhes.trim() } : {}),
    declaracao,
  });

  return (
    <div className="ds-card" data-testid="form-dps">
      <div className="ds-card-hdr">
        <h3>DPS — Declaração Pessoal de Saúde</h3>
        <StatusLine doc={doc} />
      </div>
      <div className="ds-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Exigida pela seguradora para o seguro MIP. As respostas são dados de saúde: ficam só no processo, visíveis
          ao cliente e à equipe da assessoria.
        </p>
        {doc?.status === 'rejeitado' && doc.validatedByNotes && (
          <div className="ds-alert urgent"><Icon.AlertTriangle size={14} /><span>{doc.validatedByNotes}</span></div>
        )}
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="ds-row-2">
            <Field label="Altura (cm) *">
              <div className="ds-input">
                <input inputMode="numeric" aria-label="Altura (cm)" value={altura} onChange={e => setAltura(e.target.value)} style={{ flex: 1 }} />
              </div>
            </Field>
            <Field label="Peso (kg) *">
              <div className="ds-input">
                <input inputMode="decimal" aria-label="Peso (kg)" value={peso} onChange={e => setPeso(e.target.value)} style={{ flex: 1 }} />
              </div>
            </Field>
          </div>
          {DPS_QUESTIONS.map(q => (
            <div key={q.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 13 }}>{q.text}</span>
              <YesNo
                name={q.text}
                value={answers[q.key]}
                disabled={locked}
                onChange={v => setAnswers(a => ({ ...a, [q.key]: v }))}
              />
            </div>
          ))}
          {anyYes && (
            <Field label="Conte mais sobre os itens marcados como Sim *">
              <textarea
                className="ds-input"
                aria-label="Detalhes"
                value={detalhes}
                onChange={e => setDetalhes(e.target.value)}
                rows={3}
                maxLength={1000}
                style={{ height: 'auto', padding: 8, resize: 'vertical' }}
              />
            </Field>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
            <input type="checkbox" checked={declaracao} onChange={e => setDeclaracao(e.target.checked)} />
            Declaro que as informações acima são verdadeiras e completas.
          </label>
        </fieldset>
        {submit.isError && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>{apiError(submit.error)}</div>}
        {locked ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Para alterar, o analista precisa rejeitar o formulário na aba Documentos.
          </div>
        ) : (
          <div>
            <button className="ds-btn accent" disabled={!ready || submit.isPending} onClick={send}>
              {submit.isPending ? 'Enviando...' : doc ? 'Enviar de novo' : 'Enviar DPS'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FinanciamentoCard({ processId, doc, readOnly }: { processId: string; doc?: FormDoc; readOnly: boolean }) {
  const saved = (doc?.formData ?? {}) as Record<string, unknown>;
  const [banco, setBanco] = useState(String(saved.banco ?? ''));
  const [sistema, setSistema] = useState(String(saved.sistemaAmortizacao ?? 'SAC'));
  const [prazo, setPrazo] = useState(toText(saved.prazoMeses));
  const [valor, setValor] = useState(toText(saved.valorFinanciado));
  const [entrada, setEntrada] = useState(toText(saved.valorEntrada));
  const [usaFgts, setUsaFgts] = useState<boolean | null>(typeof saved.usaFgts === 'boolean' ? saved.usaFgts : null);
  const [fgts, setFgts] = useState(toText(saved.valorFgts));
  const [taxa, setTaxa] = useState(toText(saved.taxaJurosAnual));
  const [obs, setObs] = useState(String(saved.observacoes ?? ''));
  const submit = useSubmitForm(processId, 'financiamento');
  const locked = readOnly || doc?.status === 'validado';

  if (readOnly && !doc) {
    return (
      <div className="ds-card" data-testid="form-financiamento">
        <div className="ds-card-hdr"><h3>Financiamento</h3><StatusLine /></div>
        <div className="ds-card-body" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          A assessoria ainda não preencheu os dados do financiamento.
        </div>
      </div>
    );
  }

  const ready = banco.trim().length >= 2 && prazo.trim() !== '' && valor.trim() !== '' && entrada.trim() !== ''
    && taxa.trim() !== '' && usaFgts !== null && (!usaFgts || fgts.trim() !== '');
  const send = () => submit.mutate({
    banco: banco.trim(),
    sistemaAmortizacao: sistema,
    prazoMeses: Math.round(parseNum(prazo)),
    valorFinanciado: parseNum(valor),
    valorEntrada: parseNum(entrada),
    usaFgts,
    ...(usaFgts ? { valorFgts: parseNum(fgts) } : {}),
    taxaJurosAnual: parseNum(taxa),
    ...(obs.trim() ? { observacoes: obs.trim() } : {}),
  });
  const input = (label: string, value: string, set: (v: string) => void, mode: 'numeric' | 'decimal' | 'text' = 'decimal') => (
    <Field label={`${label} *`}>
      <div className="ds-input">
        <input inputMode={mode} aria-label={label} value={value} onChange={e => set(e.target.value)} style={{ flex: 1 }} />
      </div>
    </Field>
  );

  return (
    <div className="ds-card" data-testid="form-financiamento">
      <div className="ds-card-hdr">
        <h3>Financiamento</h3>
        <StatusLine doc={doc} />
      </div>
      <div className="ds-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {doc?.status === 'rejeitado' && doc.validatedByNotes && !readOnly && (
          <div className="ds-alert urgent"><Icon.AlertTriangle size={14} /><span>{doc.validatedByNotes}</span></div>
        )}
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {input('Banco', banco, setBanco, 'text')}
          <div className="ds-row-2">
            <Field label="Sistema de amortização *">
              <div className="ds-input">
                <select aria-label="Sistema de amortização" value={sistema} onChange={e => setSistema(e.target.value)}
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13 }}>
                  <option value="SAC">SAC</option>
                  <option value="PRICE">Price</option>
                </select>
              </div>
            </Field>
            {input('Prazo (meses)', prazo, setPrazo, 'numeric')}
          </div>
          <div className="ds-row-2">
            {input('Valor financiado (R$)', valor, setValor)}
            {input('Entrada (R$)', entrada, setEntrada)}
          </div>
          <div className="ds-row-2">
            <Field label="Usa FGTS? *">
              <YesNo name="Usa FGTS?" value={usaFgts} onChange={setUsaFgts} disabled={locked} />
            </Field>
            {usaFgts ? input('Valor do FGTS (R$)', fgts, setFgts) : <div />}
          </div>
          {input('Taxa de juros (% ao ano)', taxa, setTaxa)}
          <Field label="Observações">
            <textarea className="ds-input" aria-label="Observações" value={obs} onChange={e => setObs(e.target.value)}
              rows={2} maxLength={1000} style={{ height: 'auto', padding: 8, resize: 'vertical' }} />
          </Field>
        </fieldset>
        {submit.isError && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>{apiError(submit.error)}</div>}
        {!readOnly && (doc?.status === 'validado' ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Para alterar, rejeite o formulário na aba Documentos e envie de novo.
          </div>
        ) : (
          <div>
            <button className="ds-btn accent" disabled={!ready || submit.isPending} onClick={send}>
              {submit.isPending ? 'Enviando...' : doc ? 'Enviar de novo' : 'Salvar financiamento'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormulariosTab({ processId, docs, role }: { processId: string; docs: FormDoc[]; role: string | null }) {
  const dps = docs.find(d => d.formType === 'dps');
  const fin = docs.find(d => d.formType === 'financiamento');
  return (
    <div className="ds-forms-grid">
      <DpsCard key={`dps-${dps?.id ?? 'novo'}-${dps?.status ?? ''}`} processId={processId} doc={dps} />
      <FinanciamentoCard
        key={`fin-${fin?.id ?? 'novo'}-${fin?.status ?? ''}`}
        processId={processId}
        doc={fin}
        readOnly={role === 'cliente'}
      />
    </div>
  );
}
