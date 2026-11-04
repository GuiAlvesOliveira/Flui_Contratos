import { fichaLabel } from '../ficha/ficha-fields';
import type { FichaValue } from '../ficha/ficha-values';
import type { FichaSnapshot, FichaValues } from '../ficha/ficha.service';

// Mapeamento ficha → campos dos PDFs do Itaú (Formulário do Comprador versão
// 02/25 e Proposta de Seguro Habitacional versão 05/25). Os valores dos
// botões de opção NÃO seguem a ordem visual do formulário e mudam entre o 1º e
// o 2º comprador; foram conferidos pela posição de cada botão no PDF.

export type FilledField =
  | { kind: 'text'; name: string; value: string }
  | { kind: 'radio'; name: string; value: string };

export interface Missing {
  /** chave da ficha (para pedir ao cliente); null = dado de outro cadastro */
  key: string | null;
  label: string;
}

export interface BuiltForm {
  fields: FilledField[];
  missing: Missing[];
  filled: number;
  total: number;
}

class Builder {
  fields: FilledField[] = [];
  missing: Missing[] = [];
  total = 0;

  text(
    name: string,
    value: FichaValue | undefined,
    key: string | null,
    label?: string,
    required = true,
  ) {
    if (required) this.total++;
    if (value === null || value === undefined || value === '') {
      if (required)
        this.missing.push({
          key,
          label: label ?? (key ? fichaLabel(key) : name),
        });
      return;
    }
    if (!required) this.total++;
    this.fields.push({ kind: 'text', name, value: String(value) });
  }

  radio(
    name: string,
    value: string | null | undefined,
    key: string | null,
    required = true,
  ) {
    if (required) this.total++;
    if (!value) {
      if (required)
        this.missing.push({ key, label: key ? fichaLabel(key) : name });
      return;
    }
    if (!required) this.total++;
    this.fields.push({ kind: 'radio', name, value });
  }

  done(): BuiltForm {
    const filled = this.fields.length;
    return {
      fields: this.fields,
      missing: this.missing,
      filled,
      total: Math.max(this.total, filled),
    };
  }
}

// ── formatação ───────────────────────────────────────────────────────────────
export const fmtDate = (v: FichaValue) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
    ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`
    : null;
export const fmtCpf = (v: FichaValue) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11
    ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    : d || null;
};
export const fmtCep = (v: FichaValue) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d || null;
};
export const fmtPhone = (v: FichaValue) => {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11)
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || null;
};
const yesNo = (v: FichaValue, sim: string, nao: string) =>
  v === true ? sim : v === false ? nao : null;

// ── valores dos botões de opção (por posição no PDF) ────────────────────────
const GENERO: Record<string, string> = { feminino: '1', masculino: '2' };
const DOC_TIPO: Record<string, string> = {
  rg: '1',
  rne: '2',
  oab: '3',
  crm: '4',
  crea: '5',
  cnh: '6',
};
const ESTADO_CIVIL: Record<string, string> = {
  solteiro: '1',
  divorciado: '2',
  casado: '3',
  separado_judicialmente: '4',
  viuvo: '5',
  desquitado: '6',
};
const REGIME_1: Record<string, string> = {
  comunhao_parcial: '1',
  separacao_total: '2',
  comunhao_universal: '4',
  participacao_final_aquestos: '5',
  separacao_obrigatoria: 'Escolha6',
};
const REGIME_2: Record<string, string> = {
  comunhao_parcial: '1',
  separacao_total: '0',
  comunhao_universal: '2',
  participacao_final_aquestos: '3',
  separacao_obrigatoria: '4',
};
const COMUNHAO = ['comunhao_parcial', 'comunhao_universal'];

const NOMES = {
  1: {
    nome: 'Nome completo sem abreviações 1',
    nasc: 'Data de Nascimento 1',
    nac: 'Nacionalidade 1',
    natCidade: 'Cidade de Nascimento 1',
    natUf: 'UF Nascimento 1',
    genero: 'Gênero1#0',
    cpf: 'CPF 1',
    profissao: 'Profissão principal ocupação ou atividade 1',
    docTipo: 'Tipo de Documento1#0',
    docNum: 'Número de documento 1',
    docEmissao: 'Data de expedição 1',
    docOrgao: 'Órgão expedidor 1',
    docUf: 'UF 1',
    estadoCivil: 'EstadoCivil1#0',
    dataCasamento: 'data casamento1',
    telRes: 'telefone residencial 1',
    telCel: 'telefone celular 1',
    telCom: 'telefone comercial 1',
    email: 'e-mail 1',
    regime: 'Regime Casamento1#0',
    uniao: 'Anexo/Garagem',
    uniaoSim: 'Escolha1',
    uniaoNao: 'Escolha2',
    fil1: 'Filiação 1',
    fil2: 'Filiação 2',
    end: 'Endereço Residencial 1',
    num: 'Número 1',
    compl: 'Complemento1',
    bairro: 'Bairro 1',
    cidade: 'Cidade 1',
    uf: 'Estado 1',
    cep: 'CEP 1',
    corresp: 'Corresp1#0',
    inss: 'INSS1',
    pct: '% comprador 1',
  },
  2: {
    nome: 'Nome completo sem abreviações 2',
    nasc: 'Data de Nascimento 2',
    nac: 'Nacionalidade 2',
    natCidade: 'Cidade de Nascimento 2',
    natUf: 'UF Nascimento 2',
    genero: 'Gênero1#1',
    cpf: 'CPF 2',
    profissao: 'Profissão principal ocupação ou atividade 2',
    docTipo: 'Tipo de Documento1#1',
    docNum: 'Número de documento 2',
    docEmissao: 'Data de expedição 2',
    docOrgao: 'Órgão expedidor 2',
    docUf: 'UF 2',
    estadoCivil: 'EstadoCivil1#V1',
    dataCasamento: 'data casamento#V1',
    telRes: 'telefone residencial #V1',
    telCel: 'telefone celular #V1',
    telCom: 'telefone comercial#V1',
    email: 'e-mail#V1',
    regime: 'Regime Casamento1#V1',
    uniao: 'União estável1#V1',
    uniaoSim: '1',
    uniaoNao: '2',
    fil1: 'Filiação#V1',
    fil2: 'Filiação#V2',
    end: 'Endereço Residencial comp 21',
    num: 'Número comp 21',
    compl: 'Complementocomp 21',
    bairro: 'Bairro comp 21',
    cidade: 'Cidade comp 21',
    uf: 'Estado comp 21',
    cep: 'CEP comp 21',
    corresp: 'correspcomp1',
    inss: 'INSS2',
    pct: '% comprador 2',
  },
} as const;

const ENDERECO_KEYS = ['logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'];
const temEndereco = (p: FichaValues) => ENDERECO_KEYS.some((k) => p[k]);
const mesmoEndereco = (a: FichaValues, b: FichaValues) =>
  ['cep', 'logradouro', 'numero', 'complemento'].every(
    (k) => (a[k] ?? '') === (b[k] ?? ''),
  );

function comprador(
  b: Builder,
  n: 1 | 2,
  p: FichaValues & { nome: string | null; cpf: string | null },
  outro?: FichaValues,
) {
  const N = NOMES[n];
  const t = n === 1 ? 'cliente' : 'segundo';
  const k = (key: string) => `${t}.${key}`;
  b.text(
    N.nome,
    p.nome,
    null,
    n === 1 ? 'Nome completo do cliente' : '2º comprador: nome',
  );
  b.text(N.nasc, fmtDate(p.dataNascimento), k('dataNascimento'));
  b.text(N.nac, p.nacionalidade, k('nacionalidade'));
  b.text(N.natCidade, p.naturalidadeCidade, k('naturalidadeCidade'));
  b.text(N.natUf, p.naturalidadeUf, k('naturalidadeUf'));
  b.radio(N.genero, GENERO[String(p.genero)], k('genero'));
  b.text(
    N.cpf,
    fmtCpf(p.cpf),
    null,
    n === 1 ? 'CPF do cliente' : '2º comprador: CPF',
  );
  b.text(N.profissao, p.profissao, k('profissao'));
  b.radio(N.docTipo, DOC_TIPO[String(p.documentoTipo)], k('documentoTipo'));
  b.text(N.docNum, p.rg, k('rg'));
  b.text(N.docEmissao, fmtDate(p.documentoEmissao), k('documentoEmissao'));
  b.text(N.docOrgao, p.documentoOrgao, k('documentoOrgao'));
  b.text(N.docUf, p.documentoUf, k('documentoUf'));

  // estado civil: união estável vai como o estado do registro civil + "vive em união estável: sim"
  const ec = p.estadoCivil as string | null;
  if (ec === 'uniao_estavel') {
    b.radio(
      N.estadoCivil,
      ESTADO_CIVIL[String(p.estadoCivilRegistro)],
      k('estadoCivilRegistro'),
    );
    b.radio(N.uniao, N.uniaoSim, k('estadoCivil'));
  } else {
    b.radio(N.estadoCivil, ec ? ESTADO_CIVIL[ec] : null, k('estadoCivil'));
    if (ec && ec !== 'casado') b.radio(N.uniao, N.uniaoNao, k('estadoCivil'));
  }
  if (ec === 'casado') {
    b.text(N.dataCasamento, fmtDate(p.dataCasamento), k('dataCasamento'));
    b.radio(
      N.regime,
      (n === 1 ? REGIME_1 : REGIME_2)[String(p.regimeBens)],
      k('regimeBens'),
    );
  }

  b.text(
    N.telRes,
    fmtPhone(p.telefoneResidencial),
    k('telefoneResidencial'),
    undefined,
    false,
  );
  b.text(N.telCel, fmtPhone(p.telefone), k('telefone'));
  b.text(
    N.telCom,
    fmtPhone(p.telefoneComercial),
    k('telefoneComercial'),
    undefined,
    false,
  );
  b.text(
    N.email,
    p.email,
    n === 1 ? null : k('email'),
    n === 1 ? 'E-mail do cliente' : undefined,
    n === 1,
  );
  b.text(N.fil1, p.filiacao1, k('filiacao1'));
  b.text(N.fil2, p.filiacao2, k('filiacao2'), undefined, false);

  // 2º comprador no mesmo endereço do 1º: só marca "sim"
  if (n === 2 && outro) {
    if (!temEndereco(p)) {
      b.missing.push({
        key: k('logradouro'),
        label: '2º comprador: endereço residencial',
      });
      b.total++;
      return;
    }
    const junto = mesmoEndereco(p, outro);
    b.radio('residjunto1', junto ? '1' : '2', null);
    if (junto) {
      b.radio(N.corresp, '1', null, false);
      return;
    }
  }
  b.text(N.end, p.logradouro, k('logradouro'));
  b.text(N.num, p.numero, k('numero'));
  b.text(N.compl, p.complemento, k('complemento'), undefined, false);
  b.text(N.bairro, p.bairro, k('bairro'));
  b.text(N.cidade, p.cidade, k('cidade'));
  b.text(N.uf, p.uf, k('uf'));
  b.text(N.cep, fmtCep(p.cep), k('cep'));
  // correspondência na residência (outro endereço o analista marca à mão)
  b.radio(N.corresp, '1', null, false);
}

export function buildItauComprador(s: FichaSnapshot): BuiltForm {
  const b = new Builder();
  const { cliente, segundo, processo } = s;
  comprador(b, 1, cliente);
  b.radio(
    NOMES[1].inss,
    yesNo(cliente.empregadorInss, '1', '2'),
    'cliente.empregadorInss',
  );

  if (segundo) {
    comprador(b, 2, segundo, cliente);
    b.radio(
      NOMES[2].inss,
      yesNo(segundo.empregadorInss, '1', '2'),
      'segundo.empregadorInss',
    );
  } else if (cliente.estadoCivil === 'casado' || s.participantCount > 1) {
    // casado(a) ou renda composta: o banco quer o cônjuge/2º comprador
    b.total++;
    b.missing.push({
      key: null,
      label: '2º comprador ou cônjuge (escolha na ficha)',
    });
  }

  // percentual: informado na ficha; senão 100% para um comprador e 50/50 para
  // casados em comunhão (regra impressa no próprio formulário)
  const p1 = processo.percentualAquisicao1 as number | null;
  const comunhao =
    cliente.estadoCivil === 'casado' &&
    COMUNHAO.includes(String(cliente.regimeBens));
  const pct1 = p1 ?? (!segundo ? 100 : comunhao ? 50 : null);
  const fmtPct = (v: number) =>
    String(Math.round(v * 100) / 100).replace('.', ',');
  b.text(
    NOMES[1].pct,
    pct1 === null ? null : fmtPct(pct1),
    'processo.percentualAquisicao1',
  );
  if (segundo && pct1 !== null)
    b.text(NOMES[2].pct, fmtPct(100 - pct1), 'processo.percentualAquisicao1');

  b.radio('FGTS', yesNo(processo.usaFgts, '1', '2'), 'processo.usaFgts');
  b.radio(
    'SFH',
    yesNo(processo.primeiraCompraSfh, 'Escolha1', 'Escolha2'),
    'processo.primeiraCompraSfh',
  );
  b.text(
    'N da agência do Itaú',
    processo.bancoAgencia,
    'processo.bancoAgencia',
  );
  b.text(
    'N da conta corrente do Itaú',
    processo.bancoConta,
    'processo.bancoConta',
  );
  return b.done();
}

// Seguro habitacional: só a identificação e a seguradora. A declaração de
// saúde fica sempre em branco — quem responde é o próprio segurado.
export function buildItauSeguro(s: FichaSnapshot): BuiltForm {
  const b = new Builder();
  const { cliente, segundo, processo } = s;
  b.radio(
    'Seguradora',
    processo.seguradora === 'itau'
      ? 'Itaú'
      : processo.seguradora === 'tokio_marine'
        ? 'Tokio Marine'
        : null,
    'processo.seguradora',
  );
  b.text(
    'Nome completo não utilizar abreviações',
    cliente.nome,
    null,
    'Nome completo do cliente',
  );
  b.text(
    'Data de Nascimento_3',
    fmtDate(cliente.dataNascimento),
    'cliente.dataNascimento',
  );
  b.text('CPF_3', fmtCpf(cliente.cpf), null, 'CPF do cliente');
  if (segundo) {
    b.text(
      'Nome completo não utilizar abreviações_2',
      segundo.nome,
      null,
      '2º comprador: nome',
    );
    b.text(
      'Data de Nascimento_4',
      fmtDate(segundo.dataNascimento),
      'segundo.dataNascimento',
    );
    b.text('CPF_4', fmtCpf(segundo.cpf), null, '2º comprador: CPF');
  }
  return b.done();
}
