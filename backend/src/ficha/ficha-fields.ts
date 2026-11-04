// Ficha completa do proponente: a lista única dos campos que os formulários
// do banco pedem. A API valida por ela, a tela monta os formulários a partir
// dela (GET /ficha/fields) e o pedido de dados ao cliente cita as chaves.
//
// Chaves de um pedido/edição: `cliente.<campo>`, `segundo.<campo>` (2º
// comprador ou cônjuge, um participante do processo) e `processo.<campo>`.

export type FichaScope = 'pessoa' | 'processo';
export type FichaTarget = 'cliente' | 'segundo' | 'processo';
export type FichaFieldType =
  | 'text'
  | 'date'
  | 'enum'
  | 'boolean'
  | 'uf'
  | 'cep'
  | 'phone'
  | 'email'
  | 'percent'
  | 'digits'
  | 'participant';

export interface FichaField {
  key: string;
  label: string;
  group: string;
  scope: FichaScope;
  type: FichaFieldType;
  max?: number;
  options?: { value: string; label: string }[];
  /** e-mail do cliente é o login: só o do 2º comprador entra na ficha */
  onlySegundo?: boolean;
  /** campo que só faz sentido quando outro tem um certo valor */
  showIf?: { key: string; in: string[] };
  /** pedido normalmente no cadastro (os demais o analista solicita) */
  cadastro?: boolean;
}

export const FICHA_GROUPS: { id: string; label: string }[] = [
  { id: 'pessoais', label: 'Dados pessoais' },
  { id: 'documento', label: 'Documento de identificação' },
  { id: 'casamento', label: 'Estado civil e casamento' },
  { id: 'filiacao', label: 'Filiação' },
  { id: 'contato', label: 'Contato' },
  { id: 'endereco', label: 'Endereço residencial' },
  { id: 'banco', label: 'Financiamento no banco' },
];

const opts = (pairs: [string, string][]) =>
  pairs.map(([value, label]) => ({ value, label }));

export const ESTADO_CIVIL_OPTIONS = opts([
  ['solteiro', 'Solteiro(a)'],
  ['casado', 'Casado(a)'],
  ['divorciado', 'Divorciado(a)'],
  ['viuvo', 'Viúvo(a)'],
  ['uniao_estavel', 'União estável'],
]);

// União estável não é estado civil para o banco: ele pede o do registro civil
export const ESTADO_CIVIL_REGISTRO_OPTIONS = opts([
  ['solteiro', 'Solteiro(a)'],
  ['divorciado', 'Divorciado(a)'],
  ['viuvo', 'Viúvo(a)'],
  ['separado_judicialmente', 'Separado(a) judicialmente'],
  ['desquitado', 'Desquitado(a)'],
]);

export const REGIME_BENS_OPTIONS = opts([
  ['comunhao_parcial', 'Comunhão parcial de bens'],
  ['comunhao_universal', 'Comunhão universal de bens'],
  ['separacao_total', 'Separação total de bens'],
  ['participacao_final_aquestos', 'Participação final nos aquestos'],
  ['separacao_obrigatoria', 'Separação obrigatória de bens'],
]);

export const DOCUMENTO_TIPO_OPTIONS = opts([
  ['rg', 'RG'],
  ['rne', 'RNE'],
  ['oab', 'OAB'],
  ['crm', 'CRM'],
  ['crea', 'CREA'],
  ['cnh', 'CNH'],
]);

export const SEGURADORA_OPTIONS = opts([
  ['itau', 'Itaú Seguros'],
  ['tokio_marine', 'Tokio Marine'],
]);

export const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

const P = 'pessoa' as const;
const casado = { key: 'estadoCivil', in: ['casado'] };

export const FICHA_FIELDS: FichaField[] = [
  // pessoais
  {
    key: 'dataNascimento',
    label: 'Data de nascimento',
    group: 'pessoais',
    scope: P,
    type: 'date',
    cadastro: true,
  },
  {
    key: 'nacionalidade',
    label: 'Nacionalidade',
    group: 'pessoais',
    scope: P,
    type: 'text',
    max: 60,
  },
  {
    key: 'naturalidadeCidade',
    label: 'Cidade de nascimento',
    group: 'pessoais',
    scope: P,
    type: 'text',
    max: 120,
  },
  {
    key: 'naturalidadeUf',
    label: 'UF de nascimento',
    group: 'pessoais',
    scope: P,
    type: 'uf',
  },
  {
    key: 'genero',
    label: 'Gênero',
    group: 'pessoais',
    scope: P,
    type: 'enum',
    options: opts([
      ['feminino', 'Feminino'],
      ['masculino', 'Masculino'],
    ]),
  },
  {
    key: 'profissao',
    label: 'Profissão ou principal atividade',
    group: 'pessoais',
    scope: P,
    type: 'text',
    max: 120,
  },
  {
    key: 'empregadorInss',
    label:
      'É empregador, autônomo ou produtor rural com funcionários registrados?',
    group: 'pessoais',
    scope: P,
    type: 'boolean',
  },
  // documento
  {
    key: 'documentoTipo',
    label: 'Tipo de documento',
    group: 'documento',
    scope: P,
    type: 'enum',
    options: DOCUMENTO_TIPO_OPTIONS,
  },
  {
    key: 'rg',
    label: 'Número do documento',
    group: 'documento',
    scope: P,
    type: 'text',
    max: 20,
    cadastro: true,
  },
  {
    key: 'documentoEmissao',
    label: 'Data de expedição',
    group: 'documento',
    scope: P,
    type: 'date',
  },
  {
    key: 'documentoOrgao',
    label: 'Órgão expedidor',
    group: 'documento',
    scope: P,
    type: 'text',
    max: 30,
  },
  {
    key: 'documentoUf',
    label: 'UF do documento',
    group: 'documento',
    scope: P,
    type: 'uf',
  },
  // casamento
  {
    key: 'estadoCivil',
    label: 'Estado civil',
    group: 'casamento',
    scope: P,
    type: 'enum',
    options: ESTADO_CIVIL_OPTIONS,
    cadastro: true,
  },
  {
    key: 'estadoCivilRegistro',
    label: 'Estado civil no registro civil',
    group: 'casamento',
    scope: P,
    type: 'enum',
    options: ESTADO_CIVIL_REGISTRO_OPTIONS,
    showIf: { key: 'estadoCivil', in: ['uniao_estavel'] },
  },
  {
    key: 'dataCasamento',
    label: 'Data do casamento',
    group: 'casamento',
    scope: P,
    type: 'date',
    showIf: casado,
  },
  {
    key: 'regimeBens',
    label: 'Regime de bens',
    group: 'casamento',
    scope: P,
    type: 'enum',
    options: REGIME_BENS_OPTIONS,
    showIf: casado,
  },
  // filiação
  {
    key: 'filiacao1',
    label: 'Nome da mãe ou do pai (1)',
    group: 'filiacao',
    scope: P,
    type: 'text',
    max: 255,
  },
  {
    key: 'filiacao2',
    label: 'Nome da mãe ou do pai (2)',
    group: 'filiacao',
    scope: P,
    type: 'text',
    max: 255,
  },
  // contato
  {
    key: 'email',
    label: 'E-mail',
    group: 'contato',
    scope: P,
    type: 'email',
    max: 255,
    onlySegundo: true,
  },
  {
    key: 'telefone',
    label: 'Telefone celular',
    group: 'contato',
    scope: P,
    type: 'phone',
    cadastro: true,
  },
  {
    key: 'telefoneResidencial',
    label: 'Telefone residencial',
    group: 'contato',
    scope: P,
    type: 'phone',
  },
  {
    key: 'telefoneComercial',
    label: 'Telefone comercial',
    group: 'contato',
    scope: P,
    type: 'phone',
  },
  // endereço
  {
    key: 'cep',
    label: 'CEP',
    group: 'endereco',
    scope: P,
    type: 'cep',
    cadastro: true,
  },
  {
    key: 'logradouro',
    label: 'Logradouro',
    group: 'endereco',
    scope: P,
    type: 'text',
    max: 255,
    cadastro: true,
  },
  {
    key: 'numero',
    label: 'Número',
    group: 'endereco',
    scope: P,
    type: 'text',
    max: 20,
    cadastro: true,
  },
  {
    key: 'complemento',
    label: 'Complemento',
    group: 'endereco',
    scope: P,
    type: 'text',
    max: 120,
    cadastro: true,
  },
  {
    key: 'bairro',
    label: 'Bairro',
    group: 'endereco',
    scope: P,
    type: 'text',
    max: 120,
    cadastro: true,
  },
  {
    key: 'cidade',
    label: 'Cidade',
    group: 'endereco',
    scope: P,
    type: 'text',
    max: 120,
    cadastro: true,
  },
  {
    key: 'uf',
    label: 'UF',
    group: 'endereco',
    scope: P,
    type: 'uf',
    cadastro: true,
  },
  // processo
  {
    key: 'segundoCompradorId',
    label: '2º comprador ou cônjuge',
    group: 'banco',
    scope: 'processo',
    type: 'participant',
  },
  {
    key: 'primeiraCompraSfh',
    label: 'Primeira compra de imóvel residencial financiado (SFH)?',
    group: 'banco',
    scope: 'processo',
    type: 'boolean',
  },
  {
    key: 'usaFgts',
    label: 'Vai usar o FGTS como complemento?',
    group: 'banco',
    scope: 'processo',
    type: 'boolean',
  },
  {
    key: 'percentualAquisicao1',
    label: 'Percentual do imóvel do 1º comprador',
    group: 'banco',
    scope: 'processo',
    type: 'percent',
  },
  {
    key: 'bancoAgencia',
    label: 'Agência (conta para débito)',
    group: 'banco',
    scope: 'processo',
    type: 'digits',
    max: 10,
  },
  {
    key: 'bancoConta',
    label: 'Conta corrente (conta para débito)',
    group: 'banco',
    scope: 'processo',
    type: 'text',
    max: 20,
  },
  {
    key: 'seguradora',
    label: 'Seguradora preferida',
    group: 'banco',
    scope: 'processo',
    type: 'enum',
    options: SEGURADORA_OPTIONS,
  },
];

export const FICHA_FIELD_BY_KEY = new Map(FICHA_FIELDS.map((f) => [f.key, f]));

// Colunas que o usuário (cliente) já tinha antes da ficha; o participante
// ganhou as mesmas com o mesmo nome. Os demais campos de pessoa ficam no
// embutido `ficha` (FichaPessoal) das duas tabelas.
export const PESSOA_BASE_KEYS = [
  'dataNascimento',
  'rg',
  'telefone',
  'cep',
  'estadoCivil',
  'email',
] as const;

/** `cliente.genero` → { target: 'cliente', field } (ou null se não existe) */
export function parseFichaKey(
  fullKey: string,
): { target: FichaTarget; field: FichaField } | null {
  const [target, key, ...rest] = fullKey.split('.');
  if (rest.length > 0 || !key) return null;
  if (target !== 'cliente' && target !== 'segundo' && target !== 'processo')
    return null;
  const field = FICHA_FIELD_BY_KEY.get(key);
  if (!field) return null;
  if ((target === 'processo') !== (field.scope === 'processo')) return null;
  if (field.onlySegundo && target !== 'segundo') return null;
  return { target, field };
}

export function fichaLabel(fullKey: string): string {
  const parsed = parseFichaKey(fullKey);
  if (!parsed) return fullKey;
  const prefix = parsed.target === 'segundo' ? '2º comprador: ' : '';
  return `${prefix}${parsed.field.label}`;
}
